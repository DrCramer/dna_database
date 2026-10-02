/**
 * Quality Metrics - Store and retrieve quality metrics for genetic profiles
 * 
 * This service manages storage, retrieval, and filtering of quality metrics
 * including contamination probability, degradation index, and analysis metadata.
 */

const { logger } = require('../../utils/logger');
const { query, transaction } = require('../../config/database');

class QualityMetrics {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 15 * 60 * 1000; // 15 minutes
    }

    /**
     * Store quality metrics for a sample
     * @param {string} sampleId - Sample identifier
     * @param {string} profileId - Profile UUID
     * @param {Object} metrics - Quality metrics object
     * @returns {Promise<number>} Metrics record ID
     */
    async storeMetrics(sampleId, profileId, metrics) {
        try {
            const result = await query(`
                INSERT INTO sample_quality_metrics 
                (sample_id, profile_id, contamination_probability, degradation_index, 
                 quality_score, flagged_loci, population_used, analysis_metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `, [
                sampleId,
                profileId,
                metrics.contaminationProbability || null,
                metrics.degradationIndex || null,
                metrics.qualityScore || null,
                metrics.flaggedLoci || [],
                metrics.populationUsed || null,
                JSON.stringify(metrics.analysisMetadata || {})
            ]);

            const metricsId = result.rows[0].id;
            logger.info(`Quality metrics stored for sample ${sampleId}, metrics ID: ${metricsId}`);
            
            // Invalidate cache for this profile
            this.invalidateProfileCache(profileId);
            
            return metricsId;

        } catch (error) {
            logger.error(`Failed to store quality metrics for sample ${sampleId}:`, error);
            throw error;
        }
    }

    /**
     * Retrieve quality metrics for a specific profile
     * @param {string} profileId - Profile UUID
     * @returns {Promise<Array>} Array of quality metrics records
     */
    async getMetricsByProfile(profileId) {
        try {
            // Check cache first
            const cacheKey = `profile_${profileId}`;
            const cached = this.cache.get(cacheKey);
            
            if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
                logger.debug(`Quality metrics cache hit for profile ${profileId}`);
                return cached.data;
            }

            const result = await query(`
                SELECT 
                    id,
                    sample_id,
                    contamination_probability,
                    degradation_index,
                    quality_score,
                    flagged_loci,
                    analysis_timestamp,
                    population_used,
                    analysis_metadata
                FROM sample_quality_metrics
                WHERE profile_id = $1
                ORDER BY analysis_timestamp DESC
            `, [profileId]);

            const metrics = result.rows.map(row => ({
                id: row.id,
                sampleId: row.sample_id,
                contaminationProbability: row.contamination_probability ? parseFloat(row.contamination_probability) : null,
                degradationIndex: row.degradation_index ? parseFloat(row.degradation_index) : null,
                qualityScore: row.quality_score ? parseFloat(row.quality_score) : null,
                flaggedLoci: row.flagged_loci || [],
                analysisTimestamp: row.analysis_timestamp,
                populationUsed: row.population_used,
                analysisMetadata: row.analysis_metadata || {}
            }));

            // Cache the result
            this.cache.set(cacheKey, {
                data: metrics,
                timestamp: Date.now()
            });

            return metrics;

        } catch (error) {
            logger.error(`Failed to get quality metrics for profile ${profileId}:`, error);
            throw error;
        }
    }

    /**
     * Retrieve quality metrics with filtering options
     * @param {Object} filters - Filter criteria
     * @returns {Promise<Array>} Filtered quality metrics
     */
    async getMetricsWithFilters(filters = {}) {
        try {
            let whereConditions = [];
            let params = [];
            let paramIndex = 1;

            // Date range filter
            if (filters.startDate) {
                whereConditions.push(`analysis_timestamp >= $${paramIndex}`);
                params.push(filters.startDate);
                paramIndex++;
            }

            if (filters.endDate) {
                whereConditions.push(`analysis_timestamp <= $${paramIndex}`);
                params.push(filters.endDate);
                paramIndex++;
            }

            // Quality threshold filters
            if (filters.minQualityScore !== undefined) {
                whereConditions.push(`quality_score >= $${paramIndex}`);
                params.push(filters.minQualityScore);
                paramIndex++;
            }

            if (filters.maxContaminationProbability !== undefined) {
                whereConditions.push(`contamination_probability <= $${paramIndex}`);
                params.push(filters.maxContaminationProbability);
                paramIndex++;
            }

            if (filters.maxDegradationIndex !== undefined) {
                whereConditions.push(`degradation_index <= $${paramIndex}`);
                params.push(filters.maxDegradationIndex);
                paramIndex++;
            }

            // Population filter
            if (filters.populationUsed) {
                whereConditions.push(`population_used = $${paramIndex}`);
                params.push(filters.populationUsed);
                paramIndex++;
            }

            // Sample ID filter
            if (filters.sampleId) {
                whereConditions.push(`sample_id = $${paramIndex}`);
                params.push(filters.sampleId);
                paramIndex++;
            }

            const whereClause = whereConditions.length > 0 ? 
                `WHERE ${whereConditions.join(' AND ')}` : '';

            const orderBy = filters.orderBy || 'analysis_timestamp DESC';
            const limit = filters.limit ? `LIMIT ${parseInt(filters.limit)}` : '';

            const result = await query(`
                SELECT 
                    sqm.*,
                    dp.sample_name,
                    u.username as analyzed_by
                FROM sample_quality_metrics sqm
                JOIN dna_profiles dp ON sqm.profile_id = dp.id
                LEFT JOIN users u ON dp.user_id = u.id
                ${whereClause}
                ORDER BY ${orderBy}
                ${limit}
            `, params);

            return result.rows.map(row => ({
                id: row.id,
                sampleId: row.sample_id,
                sampleName: row.sample_name,
                profileId: row.profile_id,
                contaminationProbability: row.contamination_probability ? parseFloat(row.contamination_probability) : null,
                degradationIndex: row.degradation_index ? parseFloat(row.degradation_index) : null,
                qualityScore: row.quality_score ? parseFloat(row.quality_score) : null,
                flaggedLoci: row.flagged_loci || [],
                analysisTimestamp: row.analysis_timestamp,
                populationUsed: row.population_used,
                analysisMetadata: row.analysis_metadata || {},
                analyzedBy: row.analyzed_by
            }));

        } catch (error) {
            logger.error('Failed to get filtered quality metrics:', error);
            throw error;
        }
    }

    /**
     * Update quality metrics for an existing record
     * @param {number} metricsId - Metrics record ID
     * @param {Object} updates - Updated metrics values
     * @returns {Promise<void>}
     */
    async updateMetrics(metricsId, updates) {
        try {
            const setClause = [];
            const params = [];
            let paramIndex = 1;

            if (updates.contaminationProbability !== undefined) {
                setClause.push(`contamination_probability = $${paramIndex}`);
                params.push(updates.contaminationProbability);
                paramIndex++;
            }

            if (updates.degradationIndex !== undefined) {
                setClause.push(`degradation_index = $${paramIndex}`);
                params.push(updates.degradationIndex);
                paramIndex++;
            }

            if (updates.qualityScore !== undefined) {
                setClause.push(`quality_score = $${paramIndex}`);
                params.push(updates.qualityScore);
                paramIndex++;
            }

            if (updates.flaggedLoci !== undefined) {
                setClause.push(`flagged_loci = $${paramIndex}`);
                params.push(updates.flaggedLoci);
                paramIndex++;
            }

            if (updates.analysisMetadata !== undefined) {
                setClause.push(`analysis_metadata = $${paramIndex}`);
                params.push(JSON.stringify(updates.analysisMetadata));
                paramIndex++;
            }

            if (setClause.length === 0) {
                throw new Error('No updates provided');
            }

            params.push(metricsId);

            const result = await query(`
                UPDATE sample_quality_metrics 
                SET ${setClause.join(', ')}, analysis_timestamp = CURRENT_TIMESTAMP
                WHERE id = $${paramIndex}
                RETURNING profile_id
            `, params);

            if (result.rows.length === 0) {
                throw new Error(`Quality metrics record not found: ${metricsId}`);
            }

            // Invalidate cache for this profile
            this.invalidateProfileCache(result.rows[0].profile_id);
            
            logger.info(`Quality metrics updated for record ${metricsId}`);

        } catch (error) {
            logger.error(`Failed to update quality metrics ${metricsId}:`, error);
            throw error;
        }
    }

    /**
     * Delete quality metrics record
     * @param {number} metricsId - Metrics record ID
     * @returns {Promise<void>}
     */
    async deleteMetrics(metricsId) {
        try {
            const result = await query(`
                DELETE FROM sample_quality_metrics 
                WHERE id = $1
                RETURNING profile_id
            `, [metricsId]);

            if (result.rows.length === 0) {
                throw new Error(`Quality metrics record not found: ${metricsId}`);
            }

            // Invalidate cache for this profile
            this.invalidateProfileCache(result.rows[0].profile_id);
            
            logger.info(`Quality metrics deleted for record ${metricsId}`);

        } catch (error) {
            logger.error(`Failed to delete quality metrics ${metricsId}:`, error);
            throw error;
        }
    }

    /**
     * Get quality metrics summary statistics
     * @param {Object} filters - Optional filters
     * @returns {Promise<Object>} Summary statistics
     */
    async getMetricsSummary(filters = {}) {
        try {
            let whereConditions = [];
            let params = [];
            let paramIndex = 1;

            // Apply same filters as getMetricsWithFilters
            if (filters.startDate) {
                whereConditions.push(`analysis_timestamp >= $${paramIndex}`);
                params.push(filters.startDate);
                paramIndex++;
            }

            if (filters.endDate) {
                whereConditions.push(`analysis_timestamp <= $${paramIndex}`);
                params.push(filters.endDate);
                paramIndex++;
            }

            if (filters.populationUsed) {
                whereConditions.push(`population_used = $${paramIndex}`);
                params.push(filters.populationUsed);
                paramIndex++;
            }

            const whereClause = whereConditions.length > 0 ? 
                `WHERE ${whereConditions.join(' AND ')}` : '';

            const result = await query(`
                SELECT 
                    COUNT(*) as total_records,
                    AVG(contamination_probability) as avg_contamination,
                    AVG(degradation_index) as avg_degradation,
                    AVG(quality_score) as avg_quality,
                    COUNT(CASE WHEN contamination_probability > 0.1 THEN 1 END) as high_contamination_count,
                    COUNT(CASE WHEN degradation_index > 0.7 THEN 1 END) as high_degradation_count,
                    COUNT(CASE WHEN quality_score < 0.5 THEN 1 END) as low_quality_count
                FROM sample_quality_metrics
                ${whereClause}
            `, params);

            const row = result.rows[0];
            
            return {
                totalRecords: parseInt(row.total_records),
                averageContamination: row.avg_contamination ? parseFloat(row.avg_contamination) : null,
                averageDegradation: row.avg_degradation ? parseFloat(row.avg_degradation) : null,
                averageQuality: row.avg_quality ? parseFloat(row.avg_quality) : null,
                highContaminationCount: parseInt(row.high_contamination_count),
                highDegradationCount: parseInt(row.high_degradation_count),
                lowQualityCount: parseInt(row.low_quality_count)
            };

        } catch (error) {
            logger.error('Failed to get quality metrics summary:', error);
            throw error;
        }
    }

    /**
     * Invalidate cache for a specific profile
     * @param {string} profileId - Profile UUID
     */
    invalidateProfileCache(profileId) {
        const cacheKey = `profile_${profileId}`;
        this.cache.delete(cacheKey);
        logger.debug(`Quality metrics cache invalidated for profile ${profileId}`);
    }

    /**
     * Clear all cached quality metrics
     */
    clearCache() {
        this.cache.clear();
        logger.info('Quality metrics cache cleared');
    }

    /**
     * Create audit trail entry for quality assessment
     * @param {string} profileId - Profile UUID
     * @param {string} userId - User who performed the assessment
     * @param {Object} assessmentDetails - Details of the assessment
     * @returns {Promise<void>}
     */
    async createAuditTrail(profileId, userId, assessmentDetails) {
        try {
            await query(`
                INSERT INTO operation_history 
                (user_id, operation_type, operation_details)
                VALUES ($1, 'quality_assessment', $2)
            `, [userId, JSON.stringify({
                profileId: profileId,
                assessmentType: 'bayesian_quality_metrics',
                ...assessmentDetails,
                timestamp: new Date()
            })]);

            logger.debug(`Audit trail created for quality assessment of profile ${profileId}`);

        } catch (error) {
            logger.error('Failed to create audit trail:', error);
            // Don't throw - audit trail failure shouldn't break the main operation
        }
    }
}

module.exports = QualityMetrics;