/**
 * Population Manager - Manages population allele frequency data and validation
 * 
 * This service handles storage, validation, and retrieval of population
 * allele frequency data used in Bayesian calculations.
 */

const { logger } = require('../../utils/logger');
const { query, transaction } = require('../../config/database');
const ConnectionPoolService = require('../connectionPoolService');

class PopulationManager {
    constructor(bayesianEngine = null) {
        this.cache = new Map(); // In-memory cache for frequently accessed data
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
        this.bayesianEngine = bayesianEngine; // Reference to BayesianEngine for cache invalidation
        this.connectionPool = null; // Will be set by BayesianEngine
    }

    /**
     * Load population data for a specific population
     * @param {string} populationId - Population identifier
     * @returns {Promise<Object>} Population data with allele frequencies
     */
    async loadPopulationData(populationId) {
        try {
            // Check cache first
            const cacheKey = `population_${populationId}`;
            const cached = this.cache.get(cacheKey);
            
            if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
                logger.debug(`Population data cache hit for ${populationId}`);
                return cached.data;
            }

            // Load from database using optimized query if connection pool is available
            let result;
            if (this.connectionPool) {
                result = await this.connectionPool.getPopulationData(populationId);
            } else {
                result = await query(`
                    SELECT 
                        population_id,
                        population_name,
                        locus_name,
                        allele,
                        frequency,
                        sample_size,
                        inbreeding_coefficient,
                        updated_at
                    FROM population_data
                    WHERE population_id = $1
                    ORDER BY locus_name, allele
                `, [populationId]);
            }

            if (result.rows.length === 0) {
                throw new Error(`Population data not found for ID: ${populationId}`);
            }

            // Organize data by locus
            const populationData = {
                populationId: populationId,
                name: result.rows[0].population_name,
                locusFrequencies: new Map(),
                sampleSize: result.rows[0].sample_size,
                inbreedingCoefficient: parseFloat(result.rows[0].inbreeding_coefficient),
                lastUpdated: result.rows[0].updated_at
            };

            // Group frequencies by locus
            const locusByName = {};
            result.rows.forEach(row => {
                if (!locusByName[row.locus_name]) {
                    locusByName[row.locus_name] = {
                        locusName: row.locus_name,
                        frequencies: new Map(),
                        sampleSize: row.sample_size,
                        populationId: row.population_id
                    };
                }
                
                locusByName[row.locus_name].frequencies.set(row.allele, parseFloat(row.frequency));
            });

            // Convert to Map
            Object.keys(locusByName).forEach(locusName => {
                populationData.locusFrequencies.set(locusName, locusByName[locusName]);
            });

            // ДИАГНОСТИЧЕСКОЕ ЛОГИРОВАНИЕ для отладки проблемы
            logger.debug(`🔍 PopulationManager: Загружено ${populationData.locusFrequencies.size} локусов для популяции ${populationId}`);
            const loadedLoci = Array.from(populationData.locusFrequencies.keys());
            logger.debug(`🔍 PopulationManager: Первые 10 локусов: ${loadedLoci.slice(0, 10).join(', ')}`);
            
            // Проверяем проблемные локусы
            const problematicLoci = ['D6S477', 'D15S659', 'D19S253', 'D3S3045', 'D4S2366', 'D6S1043', 'D8S1132', 'D10S1435', 'Penta E', 'Penta D'];
            problematicLoci.forEach(locus => {
                const found = populationData.locusFrequencies.has(locus);
                logger.debug(`🔍 PopulationManager: Локус "${locus}": ${found ? 'найден' : 'НЕ НАЙДЕН'}`);
                
                if (!found) {
                    // Ищем похожие
                    const similar = loadedLoci.filter(loaded => 
                        loaded.toLowerCase().trim() === locus.toLowerCase().trim() ||
                        loaded.includes(locus) || 
                        locus.includes(loaded)
                    );
                    if (similar.length > 0) {
                        logger.debug(`🔍 PopulationManager: Похожие на "${locus}": ${similar.join(', ')}`);
                    }
                }
            });

            // Cache the result
            this.cache.set(cacheKey, {
                data: populationData,
                timestamp: Date.now()
            });

            logger.info(`Loaded population data for ${populationId}: ${populationData.locusFrequencies.size} loci`);
            return populationData;

        } catch (error) {
            logger.error(`Failed to load population data for ${populationId}:`, error);
            throw error;
        }
    }

    /**
     * Validate allele frequencies for a locus
     * @param {Map} frequencies - Map of allele -> frequency
     * @param {string} locusName - Name of the locus
     * @returns {Object} Validation result
     */
    validateFrequencies(frequencies, locusName) {
        const result = {
            isValid: true,
            errors: [],
            warnings: []
        };

        if (!frequencies || frequencies.size === 0) {
            result.isValid = false;
            result.errors.push(`No frequencies provided for locus ${locusName}`);
            return result;
        }

        // Calculate sum of frequencies
        let sum = 0;
        const tolerance = 0.001; // Allow small rounding errors

        for (const [allele, frequency] of frequencies) {
            // Check individual frequency bounds
            if (frequency < 0 || frequency > 1) {
                result.isValid = false;
                result.errors.push(`Invalid frequency ${frequency} for allele ${allele} in locus ${locusName}`);
            }

            // Check for very low frequencies
            if (frequency < 0.0001) {
                result.warnings.push(`Very low frequency ${frequency} for allele ${allele} in locus ${locusName}`);
            }

            sum += frequency;
        }

        // Check if frequencies sum to 1.0 (within tolerance)
        if (Math.abs(sum - 1.0) > tolerance) {
            result.isValid = false;
            result.errors.push(`Frequencies for locus ${locusName} sum to ${sum.toFixed(6)}, expected 1.0`);
        }

        return result;
    }

    /**
     * Update population data for a specific population
     * @param {string} populationId - Population identifier
     * @param {Object} populationData - New population data
     * @returns {Promise<void>}
     */
    async updatePopulation(populationId, populationData) {
        try {
            await transaction(async (client) => {
                // Validate all frequencies first
                const validationErrors = [];
                
                for (const [locusName, locusData] of populationData.locusFrequencies) {
                    const validation = this.validateFrequencies(locusData.frequencies, locusName);
                    if (!validation.isValid) {
                        validationErrors.push(...validation.errors);
                    }
                }

                if (validationErrors.length > 0) {
                    throw new Error(`Validation failed: ${validationErrors.join('; ')}`);
                }

                // Delete existing data for this population
                await client.query('DELETE FROM population_data WHERE population_id = $1', [populationId]);

                // Insert new data
                for (const [locusName, locusData] of populationData.locusFrequencies) {
                    for (const [allele, frequency] of locusData.frequencies) {
                        await client.query(`
                            INSERT INTO population_data 
                            (population_id, population_name, locus_name, allele, frequency, sample_size, inbreeding_coefficient)
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                        `, [
                            populationId,
                            populationData.name,
                            locusName,
                            allele,
                            frequency,
                            locusData.sampleSize || populationData.sampleSize,
                            populationData.inbreedingCoefficient || 0.0
                        ]);
                    }
                }

                logger.info(`Updated population data for ${populationId}`);
            });

            // Invalidate cache
            this.invalidateCache(populationId);
            
            // Invalidate Bayesian analysis cache for this population
            if (this.bayesianEngine) {
                await this.bayesianEngine.invalidatePopulationCache(populationId);
            }

        } catch (error) {
            logger.error(`Failed to update population ${populationId}:`, error);
            throw error;
        }
    }

    /**
     * List all available populations
     * @returns {Promise<Array>} Array of population information
     */
    async listAvailablePopulations() {
        try {
            const result = await query(`
                SELECT 
                    population_id,
                    population_name,
                    COUNT(DISTINCT locus_name) as loci_count,
                    COUNT(*) as total_alleles,
                    AVG(sample_size) as avg_sample_size,
                    MAX(updated_at) as last_updated
                FROM population_data
                GROUP BY population_id, population_name
                ORDER BY population_name
            `);

            return result.rows.map(row => ({
                populationId: row.population_id,
                name: row.population_name,
                lociCount: parseInt(row.loci_count),
                totalAlleles: parseInt(row.total_alleles),
                avgSampleSize: Math.round(parseFloat(row.avg_sample_size)),
                lastUpdated: row.last_updated
            }));

        } catch (error) {
            logger.error('Failed to list available populations:', error);
            throw error;
        }
    }

    /**
     * Get allele frequency for a specific allele at a locus
     * @param {string} populationId - Population identifier
     * @param {string} locusName - Locus name
     * @param {string} allele - Allele value
     * @returns {Promise<number|null>} Allele frequency or null if not found
     */
    async getAlleleFrequency(populationId, locusName, allele) {
        try {
            const populationData = await this.loadPopulationData(populationId);
            const locusData = populationData.locusFrequencies.get(locusName);
            
            if (!locusData) {
                return null;
            }
            
            return locusData.frequencies.get(allele) || null;

        } catch (error) {
            logger.error(`Failed to get allele frequency for ${populationId}/${locusName}/${allele}:`, error);
            return null;
        }
    }

    /**
     * Check if population has data for all required loci
     * @param {string} populationId - Population identifier
     * @param {Array<string>} requiredLoci - Array of required locus names
     * @returns {Promise<Object>} Coverage analysis
     */
    async checkLociCoverage(populationId, requiredLoci) {
        try {
            const populationData = await this.loadPopulationData(populationId);
            const availableLoci = Array.from(populationData.locusFrequencies.keys());
            
            const missing = requiredLoci.filter(locus => !availableLoci.includes(locus));
            const coverage = (requiredLoci.length - missing.length) / requiredLoci.length;
            
            return {
                totalRequired: requiredLoci.length,
                available: availableLoci.length,
                missing: missing,
                coverage: coverage,
                isComplete: missing.length === 0
            };

        } catch (error) {
            logger.error(`Failed to check loci coverage for ${populationId}:`, error);
            throw error;
        }
    }

    /**
     * Set reference to BayesianEngine for cache invalidation
     * @param {BayesianEngine} bayesianEngine - BayesianEngine instance
     */
    setBayesianEngine(bayesianEngine) {
        this.bayesianEngine = bayesianEngine;
        this.connectionPool = bayesianEngine.connectionPool;
    }

    /**
     * Invalidate cache for a specific population
     * @param {string} populationId - Population identifier
     */
    invalidateCache(populationId) {
        const cacheKey = `population_${populationId}`;
        this.cache.delete(cacheKey);
        logger.debug(`Cache invalidated for population ${populationId}`);
    }

    /**
     * Clear all cached population data
     */
    clearCache() {
        this.cache.clear();
        logger.info('Population data cache cleared');
    }

    /**
     * Export population data in standard format
     * @param {string} populationId - Population identifier
     * @param {string} format - Export format ('json', 'csv')
     * @returns {Promise<string>} Exported data
     */
    async exportPopulationData(populationId, format = 'json') {
        try {
            const populationData = await this.loadPopulationData(populationId);
            
            if (format === 'json') {
                return JSON.stringify({
                    populationId: populationData.populationId,
                    name: populationData.name,
                    sampleSize: populationData.sampleSize,
                    inbreedingCoefficient: populationData.inbreedingCoefficient,
                    lastUpdated: populationData.lastUpdated,
                    loci: Array.from(populationData.locusFrequencies.entries()).map(([locusName, locusData]) => ({
                        locusName,
                        frequencies: Object.fromEntries(locusData.frequencies),
                        sampleSize: locusData.sampleSize
                    }))
                }, null, 2);
            }
            
            if (format === 'csv') {
                let csv = 'Population,Locus,Allele,Frequency,SampleSize\n';
                
                for (const [locusName, locusData] of populationData.locusFrequencies) {
                    for (const [allele, frequency] of locusData.frequencies) {
                        csv += `${populationData.name},${locusName},${allele},${frequency},${locusData.sampleSize}\n`;
                    }
                }
                
                return csv;
            }
            
            throw new Error(`Unsupported export format: ${format}`);

        } catch (error) {
            logger.error(`Failed to export population data for ${populationId}:`, error);
            throw error;
        }
    }
}

module.exports = PopulationManager;