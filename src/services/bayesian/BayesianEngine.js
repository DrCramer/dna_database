/**
 * Bayesian Engine - Central orchestrator for all Bayesian calculations
 * 
 * This class coordinates between specialized analysis modules and manages
 * population data access, error propagation, and result formatting.
 */

const { logger } = require('../../utils/logger');
const { query, transaction } = require('../../config/database');
const CacheService = require('../cacheService');
const connectionPoolService = require('../connectionPoolService');

class BayesianEngine {
    constructor() {
        this.lrCalculator = null;
        this.contaminationDetector = null;
        this.degradationAnalyzer = null;
        this.duplicateFinder = null;
        this.populationManager = null;
        this.systemParameters = null;
        this.cacheService = new CacheService();
        this.connectionPool = connectionPoolService;
    }

    /**
     * Initialize the Bayesian Engine with required services
     */
    async initialize() {
        try {
            // Validate that all required services are injected
            if (!this.lrCalculator) {
                throw new Error('LRCalculator service is required');
            }
            if (!this.contaminationDetector) {
                throw new Error('ContaminationDetector service is required');
            }
            if (!this.degradationAnalyzer) {
                throw new Error('DegradationAnalyzer service is required');
            }
            if (!this.duplicateFinder) {
                throw new Error('DuplicateFinder service is required');
            }
            if (!this.populationManager) {
                throw new Error('PopulationManager service is required');
            }
            if (!this.systemParameters) {
                throw new Error('SystemParameters service is required');
            }

            // Initialize system parameters
            await this.systemParameters.initializeDefaults();
            
            // Initialize cache service
            await this.cacheService.initialize();
            
            // Initialize connection pool service
            await this.connectionPool.initialize();
            
            // Set reference in PopulationManager for cache invalidation
            if (this.populationManager && typeof this.populationManager.setBayesianEngine === 'function') {
                this.populationManager.setBayesianEngine(this);
            }
            
            logger.info('Bayesian Engine initialized successfully with all services');
            return true;
        } catch (error) {
            logger.error('Failed to initialize Bayesian Engine:', error);
            throw error;
        }
    }

    /**
     * Calculate Likelihood Ratio between two genetic profiles
     * @param {Object} profile1 - First genetic profile
     * @param {Object} profile2 - Second genetic profile  
     * @param {string} populationId - Population dataset identifier
     * @returns {Promise<Object>} LR calculation result
     */
    async calculateLR(profile1, profile2, populationId) {
        try {
            this.validateProfiles(profile1, profile2);
            
            if (!populationId) {
                throw new Error('Population ID is required for LR calculation');
            }

            // Check Redis cache first
            const cachedResult = await this.cacheService.getLRResult(profile1.id, profile2.id, populationId);
            if (cachedResult) {
                logger.info(`LR calculation Redis cache hit for profiles ${profile1.id} and ${profile2.id}`);
                return cachedResult;
            }

            // Fallback to database cache
            const dbCachedResult = await this.getCachedResult('LR', profile1.id, profile2.id, populationId);
            if (dbCachedResult) {
                logger.info(`LR calculation database cache hit for profiles ${profile1.id} and ${profile2.id}`);
                // Store in Redis for faster future access
                await this.cacheService.cacheLRResult(profile1.id, profile2.id, populationId, dbCachedResult.resultData);
                return dbCachedResult.resultData;
            }

            // Load population data
            const populationData = await this.populationManager.loadPopulationData(populationId);
            
            // Get system parameters
            const parameters = await this.getSystemParameters();
            
            // Delegate to LR Calculator
            const result = await this.lrCalculator.calculateProfileLR(profile1, profile2, populationData);
            
            // Store result in both Redis and database cache
            await this.cacheService.cacheLRResult(profile1.id, profile2.id, populationId, result);
            await this.storeAnalysisResult('LR', profile1.id, profile2.id, result, populationId, parameters);
            
            logger.info(`LR calculation completed for profiles ${profile1.id} and ${profile2.id}: LR=${result.overallLR}`);
            
            return result;
        } catch (error) {
            logger.error('LR calculation failed:', error);
            throw new Error(`LR calculation failed: ${error.message}`);
        }
    }

    /**
     * Detect contamination in a genetic profile
     * @param {Object} profile - Genetic profile to analyze
     * @param {string} populationId - Population dataset identifier
     * @returns {Promise<Object>} Contamination detection result
     */
    async detectContamination(profile, populationId) {
        try {
            this.validateProfile(profile);
            
            if (!populationId) {
                throw new Error('Population ID is required for contamination detection');
            }

            // Check Redis cache first
            const cachedResult = await this.cacheService.getContaminationResult(profile.id, populationId);
            if (cachedResult) {
                logger.info(`Contamination detection Redis cache hit for profile ${profile.id}`);
                return cachedResult;
            }

            // Fallback to database cache
            const dbCachedResult = await this.getCachedResult('contamination', profile.id, null, populationId);
            if (dbCachedResult) {
                logger.info(`Contamination detection database cache hit for profile ${profile.id}`);
                // Store in Redis for faster future access
                await this.cacheService.cacheContaminationResult(profile.id, populationId, dbCachedResult.resultData);
                return dbCachedResult.resultData;
            }

            // Load population data
            const populationData = await this.populationManager.loadPopulationData(populationId);
            
            // Get system parameters
            const parameters = await this.getSystemParameters();
            
            // Delegate to Contamination Detector
            const result = await this.contaminationDetector.analyzeProfile(profile, populationData);
            
            // Store result in both Redis and database cache
            await this.cacheService.cacheContaminationResult(profile.id, populationId, result);
            await this.storeAnalysisResult('contamination', profile.id, null, result, populationId, parameters);
            
            // Store quality metrics
            if (this.qualityMetrics) {
                await this.qualityMetrics.storeMetrics(profile.sampleId || profile.id, profile.id, {
                    contaminationProbability: result.contaminationProbability,
                    analysisType: 'contamination',
                    populationUsed: populationId
                });
            }
            
            logger.info(`Contamination detection completed for profile ${profile.id}: contaminated=${result.isContaminated}, probability=${result.contaminationProbability}`);
            
            return result;
        } catch (error) {
            logger.error('Contamination detection failed:', error);
            throw new Error(`Contamination detection failed: ${error.message}`);
        }
    }

    /**
     * Assess degradation in a genetic profile
     * @param {Object} profile - Genetic profile to analyze
     * @returns {Promise<Object>} Degradation assessment result
     */
    async assessDegradation(profile) {
        try {
            this.validateProfile(profile);
            
            // Check Redis cache first
            const cachedResult = await this.cacheService.getDegradationResult(profile.id);
            if (cachedResult) {
                logger.info(`Degradation assessment Redis cache hit for profile ${profile.id}`);
                return cachedResult;
            }

            // Fallback to database cache
            const dbCachedResult = await this.getCachedResult('degradation', profile.id, null, 'N/A');
            if (dbCachedResult) {
                logger.info(`Degradation assessment database cache hit for profile ${profile.id}`);
                // Store in Redis for faster future access
                await this.cacheService.cacheDegradationResult(profile.id, dbCachedResult.resultData);
                return dbCachedResult.resultData;
            }

            // Get system parameters
            const parameters = await this.getSystemParameters();
            
            // Delegate to Degradation Analyzer
            const result = await this.degradationAnalyzer.calculateDegradationIndex(profile);
            
            // Store result in both Redis and database cache
            await this.cacheService.cacheDegradationResult(profile.id, result);
            await this.storeAnalysisResult('degradation', profile.id, null, result, 'N/A', parameters);
            
            // Store quality metrics
            if (this.qualityMetrics) {
                await this.qualityMetrics.storeMetrics(profile.sampleId || profile.id, profile.id, {
                    degradationIndex: result.degradationIndex,
                    qualityScore: result.qualityScore,
                    analysisType: 'degradation'
                });
            }
            
            logger.info(`Degradation assessment completed for profile ${profile.id}: index=${result.degradationIndex}, quality=${result.qualityScore}`);
            
            return result;
        } catch (error) {
            logger.error('Degradation assessment failed:', error);
            throw new Error(`Degradation assessment failed: ${error.message}`);
        }
    }

    /**
     * Generate a simple hash for search space for database caching
     * @param {Array} searchSpace - Array of profiles
     * @returns {string} Hash string
     */
    generateSearchSpaceHashForDB(searchSpace) {
        // Простой хэш на основе количества профилей и их ID
        const profileIds = searchSpace.map(p => p.id).sort();
        const hashInput = `${profileIds.length}_${profileIds.slice(0, 5).join('')}`;
        return hashInput.substring(0, 32); // Ограничиваем длину
    }

    /**
     * Find duplicate profiles in database
     * @param {Object} targetProfile - Profile to search for duplicates
     * @param {Array} searchSpace - Array of profiles to search within
     * @param {string} populationId - Population dataset identifier
     * @returns {Promise<Array>} Array of potential duplicate results
     */
    async findDuplicates(targetProfile, searchSpace, populationId) {
        try {
            this.validateProfile(targetProfile);
            
            if (!Array.isArray(searchSpace)) {
                throw new Error('Search space must be an array of profiles');
            }
            
            if (!populationId) {
                throw new Error('Population ID is required for duplicate detection');
            }

            // Check Redis cache first
            const searchSpaceHash = this.cacheService.generateSearchSpaceHash(searchSpace);
            const cachedResult = await this.cacheService.getDuplicateResults(targetProfile.id, searchSpaceHash, populationId);
            if (cachedResult) {
                logger.info(`Duplicate search Redis cache hit for profile ${targetProfile.id}`);
                return cachedResult;
            }

            // Fallback to database cache
            // Для поиска дубликатов используем хэш вместо составного ключа
            const searchSpaceHashForDB = this.generateSearchSpaceHashForDB(searchSpace);
            const dbCachedResult = await this.getCachedResult('duplicate', targetProfile.id, null, populationId);
            if (dbCachedResult) {
                logger.info(`Duplicate search database cache hit for profile ${targetProfile.id}`);
                // Store in Redis for faster future access
                await this.cacheService.cacheDuplicateResults(targetProfile.id, searchSpaceHash, populationId, dbCachedResult.resultData);
                return dbCachedResult.resultData;
            }

            // Load population data
            const populationData = await this.populationManager.loadPopulationData(populationId);
            
            // Get system parameters
            const parameters = await this.getSystemParameters();
            
            // Delegate to Duplicate Finder
            const results = await this.duplicateFinder.searchDuplicates(targetProfile, searchSpace, parameters.duplicateProbabilityThreshold || 0.95);
            
            // Store result in both Redis and database cache
            await this.cacheService.cacheDuplicateResults(targetProfile.id, searchSpaceHash, populationId, results);
            await this.storeAnalysisResult('duplicate', targetProfile.id, null, results, populationId, parameters);
            
            logger.info(`Duplicate search completed for profile ${targetProfile.id}: ${results.length} potential duplicates found`);
            
            return results;
        } catch (error) {
            logger.error('Duplicate search failed:', error);
            throw new Error(`Duplicate search failed: ${error.message}`);
        }
    }

    /**
     * Validate genetic profile structure
     * @param {Object} profile - Profile to validate
     * @throws {Error} If profile is invalid
     */
    validateProfile(profile) {
        if (!profile) {
            throw new Error('Profile is required');
        }
        
        if (!profile.id) {
            throw new Error('Profile ID is required');
        }
        
        if (!profile.str_data && !profile.loci) {
            throw new Error('Profile must contain genetic data (str_data or loci)');
        }
    }

    /**
     * Validate two profiles for comparison
     * @param {Object} profile1 - First profile
     * @param {Object} profile2 - Second profile
     * @throws {Error} If profiles are invalid
     */
    validateProfiles(profile1, profile2) {
        this.validateProfile(profile1);
        this.validateProfile(profile2);
        
        if (profile1.id === profile2.id) {
            throw new Error('Cannot compare profile with itself');
        }
    }

    /**
     * Get system parameters for Bayesian calculations
     * @returns {Promise<Object>} System parameters
     */
    async getSystemParameters() {
        try {
            const result = await query(`
                SELECT parameter_name, parameter_value, parameter_type
                FROM system_parameters
                ORDER BY parameter_name
            `);
            
            const parameters = {};
            result.rows.forEach(row => {
                parameters[row.parameter_name] = parseFloat(row.parameter_value);
            });
            
            return parameters;
        } catch (error) {
            logger.error('Failed to retrieve system parameters:', error);
            // Return default parameters if database query fails
            return {
                duplicateProbabilityThreshold: 0.95,
                contaminationThreshold: 0.05,
                degradationThreshold: 0.3
            };
        }
    }

    /**
     * Store analysis result in cache
     * @param {string} analysisType - Type of analysis
     * @param {string} profile1Id - First profile ID
     * @param {string} profile2Id - Second profile ID (optional)
     * @param {Object} resultData - Analysis result data
     * @param {string} populationUsed - Population dataset used
     * @param {Object} parametersUsed - Parameters used in analysis
     * @returns {Promise<number>} Result ID
     */
    async storeAnalysisResult(analysisType, profile1Id, profile2Id, resultData, populationUsed, parametersUsed) {
        try {
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24); // Cache for 24 hours
            
            const result = await query(`
                INSERT INTO bayesian_analysis_results 
                (analysis_type, profile1_id, profile2_id, result_data, population_used, parameters_used, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [analysisType, profile1Id, profile2Id, JSON.stringify(resultData), populationUsed, JSON.stringify(parametersUsed), expiresAt]);
            
            return result.rows[0].id;
        } catch (error) {
            logger.error('Failed to store analysis result:', error);
            // Don't throw error, just log it - caching is not critical
            return null;
        }
    }

    /**
     * Retrieve cached analysis result
     * @param {string} analysisType - Type of analysis
     * @param {string} profile1Id - First profile ID
     * @param {string} profile2Id - Second profile ID (optional)
     * @param {string} populationUsed - Population dataset used
     * @returns {Promise<Object|null>} Cached result or null
     */
    async getCachedResult(analysisType, profile1Id, profile2Id, populationUsed) {
        try {
            const result = await query(`
                SELECT result_data, parameters_used, created_at
                FROM bayesian_analysis_results
                WHERE analysis_type = $1 
                AND profile1_id = $2 
                AND ($3::uuid IS NULL OR profile2_id = $3)
                AND population_used = $4
                AND (expires_at IS NULL OR expires_at > NOW())
                ORDER BY created_at DESC
                LIMIT 1
            `, [analysisType, profile1Id, profile2Id, populationUsed]);
            
            if (result.rows.length > 0) {
                return {
                    resultData: result.rows[0].result_data,
                    parametersUsed: result.rows[0].parameters_used,
                    createdAt: result.rows[0].created_at
                };
            }
            
            return null;
        } catch (error) {
            logger.error('Failed to retrieve cached result:', error);
            return null; // Don't throw, just return null to skip cache
        }
    }

    /**
     * Invalidate all cached results for a population
     * @param {string} populationId - Population dataset ID
     * @returns {Promise<number>} Number of cache entries invalidated
     */
    async invalidatePopulationCache(populationId) {
        try {
            let totalInvalidated = 0;
            
            // Invalidate Redis cache
            if (this.cacheService.isConnected) {
                const redisInvalidated = await this.cacheService.invalidatePopulationCache(populationId);
                totalInvalidated += redisInvalidated;
            }
            
            // Invalidate database cache
            const result = await query(`
                DELETE FROM bayesian_analysis_results
                WHERE population_used = $1
            `, [populationId]);
            
            totalInvalidated += result.rowCount || 0;
            
            logger.info(`Invalidated ${totalInvalidated} cached results for population ${populationId}`);
            return totalInvalidated;
        } catch (error) {
            logger.error('Failed to invalidate population cache:', error);
            return 0;
        }
    }

    /**
     * Invalidate all cached results for a profile
     * @param {string} profileId - Profile ID
     * @returns {Promise<number>} Number of cache entries invalidated
     */
    async invalidateProfileCache(profileId) {
        try {
            let totalInvalidated = 0;
            
            // Invalidate Redis cache
            if (this.cacheService.isConnected) {
                const redisInvalidated = await this.cacheService.invalidateProfileCache(profileId);
                totalInvalidated += redisInvalidated;
            }
            
            // Invalidate database cache
            const result = await query(`
                DELETE FROM bayesian_analysis_results
                WHERE profile1_id = $1 OR profile2_id = $1
            `, [profileId]);
            
            totalInvalidated += result.rowCount || 0;
            
            logger.info(`Invalidated ${totalInvalidated} cached results for profile ${profileId}`);
            return totalInvalidated;
        } catch (error) {
            logger.error('Failed to invalidate profile cache:', error);
            return 0;
        }
    }

    /**
     * Warm cache with frequently accessed data
     * @param {Array} frequentProfiles - Array of frequently accessed profile pairs
     * @param {string} populationId - Population dataset ID
     * @returns {Promise<number>} Number of cache entries warmed
     */
    async warmCache(frequentProfiles, populationId) {
        try {
            if (this.cacheService.isConnected) {
                return await this.cacheService.warmCache(frequentProfiles, populationId);
            }
            return 0;
        } catch (error) {
            logger.error('Failed to warm cache:', error);
            return 0;
        }
    }

    /**
     * Get cache statistics
     * @returns {Promise<Object>} Cache statistics
     */
    async getCacheStats() {
        try {
            const redisStats = await this.cacheService.getStats();
            
            // Get database cache stats
            const dbResult = await query(`
                SELECT 
                    analysis_type,
                    COUNT(*) as count,
                    MIN(created_at) as oldest,
                    MAX(created_at) as newest
                FROM bayesian_analysis_results
                WHERE expires_at IS NULL OR expires_at > NOW()
                GROUP BY analysis_type
            `);
            
            return {
                redis: redisStats,
                database: {
                    entries: dbResult.rows
                }
            };
        } catch (error) {
            logger.error('Failed to get cache stats:', error);
            return { error: error.message };
        }
    }
}

module.exports = BayesianEngine;