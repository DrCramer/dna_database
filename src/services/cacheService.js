/**
 * Cache Service - Redis-based caching for Bayesian analysis results
 * 
 * This service provides high-performance caching for LR calculations,
 * contamination detection, degradation analysis, and duplicate search results.
 */

const redis = require('redis');
const { logger } = require('../utils/logger');
const { config: { redis: redisConfig } } = require('../config/environment');

class CacheService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.defaultTTL = 24 * 60 * 60; // 24 hours in seconds
        this.keyPrefix = 'bayesian:';
    }

    /**
     * Initialize Redis connection
     */
    async initialize() {
        try {
            if (!redisConfig.url && !redisConfig.host) {
                logger.warn('Redis configuration not found, caching will be disabled');
                return false;
            }

            const clientOptions = {
                socket: {
                    host: redisConfig.host,
                    port: redisConfig.port
                }
            };

            if (redisConfig.password) {
                clientOptions.password = redisConfig.password;
            }

            if (redisConfig.db) {
                clientOptions.database = redisConfig.db;
            }

            // Use URL if provided, otherwise use individual options
            if (redisConfig.url) {
                this.client = redis.createClient({ url: redisConfig.url });
            } else {
                this.client = redis.createClient(clientOptions);
            }

            // Set up error handlers
            this.client.on('error', (err) => {
                logger.error('Redis client error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                logger.info('Redis client connected');
                this.isConnected = true;
            });

            this.client.on('disconnect', () => {
                logger.warn('Redis client disconnected');
                this.isConnected = false;
            });

            // Connect to Redis
            await this.client.connect();
            
            logger.info('Cache service initialized successfully');
            return true;
        } catch (error) {
            logger.error('Failed to initialize cache service:', error);
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Generate cache key for LR calculation
     * @param {string} profile1Id - First profile ID
     * @param {string} profile2Id - Second profile ID
     * @param {string} populationId - Population dataset ID
     * @returns {string} Cache key
     */
    generateLRKey(profile1Id, profile2Id, populationId) {
        // Sort profile IDs to ensure consistent key regardless of order
        const sortedIds = [profile1Id, profile2Id].sort();
        return `${this.keyPrefix}lr:${sortedIds[0]}:${sortedIds[1]}:${populationId}`;
    }

    /**
     * Generate cache key for contamination analysis
     * @param {string} profileId - Profile ID
     * @param {string} populationId - Population dataset ID
     * @returns {string} Cache key
     */
    generateContaminationKey(profileId, populationId) {
        return `${this.keyPrefix}contamination:${profileId}:${populationId}`;
    }

    /**
     * Generate cache key for degradation analysis
     * @param {string} profileId - Profile ID
     * @returns {string} Cache key
     */
    generateDegradationKey(profileId) {
        return `${this.keyPrefix}degradation:${profileId}`;
    }

    /**
     * Generate cache key for duplicate search
     * @param {string} profileId - Target profile ID
     * @param {string} searchSpaceHash - Hash of search space
     * @param {string} populationId - Population dataset ID
     * @returns {string} Cache key
     */
    generateDuplicateKey(profileId, searchSpaceHash, populationId) {
        return `${this.keyPrefix}duplicate:${profileId}:${searchSpaceHash}:${populationId}`;
    }

    /**
     * Store LR calculation result in cache
     * @param {string} profile1Id - First profile ID
     * @param {string} profile2Id - Second profile ID
     * @param {string} populationId - Population dataset ID
     * @param {Object} result - LR calculation result
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<boolean>} Success status
     */
    async cacheLRResult(profile1Id, profile2Id, populationId, result, ttl = this.defaultTTL) {
        if (!this.isConnected) {
            return false;
        }

        try {
            const key = this.generateLRKey(profile1Id, profile2Id, populationId);
            const value = JSON.stringify({
                result,
                timestamp: new Date().toISOString(),
                type: 'lr'
            });

            await this.client.setEx(key, ttl, value);
            logger.debug(`LR result cached with key: ${key}`);
            return true;
        } catch (error) {
            logger.error('Failed to cache LR result:', error);
            return false;
        }
    }

    /**
     * Retrieve LR calculation result from cache
     * @param {string} profile1Id - First profile ID
     * @param {string} profile2Id - Second profile ID
     * @param {string} populationId - Population dataset ID
     * @returns {Promise<Object|null>} Cached result or null
     */
    async getLRResult(profile1Id, profile2Id, populationId) {
        if (!this.isConnected) {
            return null;
        }

        try {
            const key = this.generateLRKey(profile1Id, profile2Id, populationId);
            const cached = await this.client.get(key);
            
            if (cached) {
                const parsed = JSON.parse(cached);
                logger.debug(`LR result cache hit for key: ${key}`);
                return parsed.result;
            }
            
            return null;
        } catch (error) {
            logger.error('Failed to retrieve LR result from cache:', error);
            return null;
        }
    }

    /**
     * Store contamination analysis result in cache
     * @param {string} profileId - Profile ID
     * @param {string} populationId - Population dataset ID
     * @param {Object} result - Contamination analysis result
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<boolean>} Success status
     */
    async cacheContaminationResult(profileId, populationId, result, ttl = this.defaultTTL) {
        if (!this.isConnected) {
            return false;
        }

        try {
            const key = this.generateContaminationKey(profileId, populationId);
            const value = JSON.stringify({
                result,
                timestamp: new Date().toISOString(),
                type: 'contamination'
            });

            await this.client.setEx(key, ttl, value);
            logger.debug(`Contamination result cached with key: ${key}`);
            return true;
        } catch (error) {
            logger.error('Failed to cache contamination result:', error);
            return false;
        }
    }

    /**
     * Retrieve contamination analysis result from cache
     * @param {string} profileId - Profile ID
     * @param {string} populationId - Population dataset ID
     * @returns {Promise<Object|null>} Cached result or null
     */
    async getContaminationResult(profileId, populationId) {
        if (!this.isConnected) {
            return null;
        }

        try {
            const key = this.generateContaminationKey(profileId, populationId);
            const cached = await this.client.get(key);
            
            if (cached) {
                const parsed = JSON.parse(cached);
                logger.debug(`Contamination result cache hit for key: ${key}`);
                return parsed.result;
            }
            
            return null;
        } catch (error) {
            logger.error('Failed to retrieve contamination result from cache:', error);
            return null;
        }
    }

    /**
     * Store degradation analysis result in cache
     * @param {string} profileId - Profile ID
     * @param {Object} result - Degradation analysis result
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<boolean>} Success status
     */
    async cacheDegradationResult(profileId, result, ttl = this.defaultTTL) {
        if (!this.isConnected) {
            return false;
        }

        try {
            const key = this.generateDegradationKey(profileId);
            const value = JSON.stringify({
                result,
                timestamp: new Date().toISOString(),
                type: 'degradation'
            });

            await this.client.setEx(key, ttl, value);
            logger.debug(`Degradation result cached with key: ${key}`);
            return true;
        } catch (error) {
            logger.error('Failed to cache degradation result:', error);
            return false;
        }
    }

    /**
     * Retrieve degradation analysis result from cache
     * @param {string} profileId - Profile ID
     * @returns {Promise<Object|null>} Cached result or null
     */
    async getDegradationResult(profileId) {
        if (!this.isConnected) {
            return null;
        }

        try {
            const key = this.generateDegradationKey(profileId);
            const cached = await this.client.get(key);
            
            if (cached) {
                const parsed = JSON.parse(cached);
                logger.debug(`Degradation result cache hit for key: ${key}`);
                return parsed.result;
            }
            
            return null;
        } catch (error) {
            logger.error('Failed to retrieve degradation result from cache:', error);
            return null;
        }
    }

    /**
     * Store duplicate search result in cache
     * @param {string} profileId - Target profile ID
     * @param {string} searchSpaceHash - Hash of search space
     * @param {string} populationId - Population dataset ID
     * @param {Array} results - Duplicate search results
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<boolean>} Success status
     */
    async cacheDuplicateResults(profileId, searchSpaceHash, populationId, results, ttl = this.defaultTTL) {
        if (!this.isConnected) {
            return false;
        }

        try {
            const key = this.generateDuplicateKey(profileId, searchSpaceHash, populationId);
            const value = JSON.stringify({
                results,
                timestamp: new Date().toISOString(),
                type: 'duplicate'
            });

            await this.client.setEx(key, ttl, value);
            logger.debug(`Duplicate results cached with key: ${key}`);
            return true;
        } catch (error) {
            logger.error('Failed to cache duplicate results:', error);
            return false;
        }
    }

    /**
     * Retrieve duplicate search results from cache
     * @param {string} profileId - Target profile ID
     * @param {string} searchSpaceHash - Hash of search space
     * @param {string} populationId - Population dataset ID
     * @returns {Promise<Array|null>} Cached results or null
     */
    async getDuplicateResults(profileId, searchSpaceHash, populationId) {
        if (!this.isConnected) {
            return null;
        }

        try {
            const key = this.generateDuplicateKey(profileId, searchSpaceHash, populationId);
            const cached = await this.client.get(key);
            
            if (cached) {
                const parsed = JSON.parse(cached);
                logger.debug(`Duplicate results cache hit for key: ${key}`);
                return parsed.results;
            }
            
            return null;
        } catch (error) {
            logger.error('Failed to retrieve duplicate results from cache:', error);
            return null;
        }
    }

    /**
     * Invalidate all cached results for a specific population
     * @param {string} populationId - Population dataset ID
     * @returns {Promise<number>} Number of keys deleted
     */
    async invalidatePopulationCache(populationId) {
        if (!this.isConnected) {
            return 0;
        }

        try {
            // Find all keys related to this population
            const patterns = [
                `${this.keyPrefix}lr:*:${populationId}`,
                `${this.keyPrefix}contamination:*:${populationId}`,
                `${this.keyPrefix}duplicate:*:${populationId}`
            ];

            let deletedCount = 0;
            
            for (const pattern of patterns) {
                const keys = await this.client.keys(pattern);
                if (keys.length > 0) {
                    const deleted = await this.client.del(keys);
                    deletedCount += deleted;
                }
            }

            logger.info(`Invalidated ${deletedCount} cached results for population ${populationId}`);
            return deletedCount;
        } catch (error) {
            logger.error('Failed to invalidate population cache:', error);
            return 0;
        }
    }

    /**
     * Invalidate all cached results for a specific profile
     * @param {string} profileId - Profile ID
     * @returns {Promise<number>} Number of keys deleted
     */
    async invalidateProfileCache(profileId) {
        if (!this.isConnected) {
            return 0;
        }

        try {
            // Find all keys related to this profile
            const patterns = [
                `${this.keyPrefix}lr:${profileId}:*`,
                `${this.keyPrefix}lr:*:${profileId}:*`,
                `${this.keyPrefix}contamination:${profileId}:*`,
                `${this.keyPrefix}degradation:${profileId}`,
                `${this.keyPrefix}duplicate:${profileId}:*`
            ];

            let deletedCount = 0;
            
            for (const pattern of patterns) {
                const keys = await this.client.keys(pattern);
                if (keys.length > 0) {
                    const deleted = await this.client.del(keys);
                    deletedCount += deleted;
                }
            }

            logger.info(`Invalidated ${deletedCount} cached results for profile ${profileId}`);
            return deletedCount;
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
        if (!this.isConnected || !Array.isArray(frequentProfiles)) {
            return 0;
        }

        try {
            let warmedCount = 0;
            
            // This would typically be called with pre-computed results
            // For now, we'll just log the warming attempt
            logger.info(`Cache warming initiated for ${frequentProfiles.length} profile pairs with population ${populationId}`);
            
            // In a real implementation, you would:
            // 1. Check if results are already cached
            // 2. If not, trigger background calculation
            // 3. Store results in cache
            
            return warmedCount;
        } catch (error) {
            logger.error('Failed to warm cache:', error);
            return 0;
        }
    }

    /**
     * Get cache statistics
     * @returns {Promise<Object>} Cache statistics
     */
    async getStats() {
        if (!this.isConnected) {
            return { connected: false };
        }

        try {
            const info = await this.client.info('memory');
            const keyspace = await this.client.info('keyspace');
            
            return {
                connected: true,
                memory: info,
                keyspace: keyspace,
                prefix: this.keyPrefix
            };
        } catch (error) {
            logger.error('Failed to get cache stats:', error);
            return { connected: false, error: error.message };
        }
    }

    /**
     * Generate hash for search space to use as cache key component
     * @param {Array} searchSpace - Array of profiles
     * @returns {string} Hash of search space
     */
    generateSearchSpaceHash(searchSpace) {
        if (!Array.isArray(searchSpace)) {
            return 'empty';
        }
        
        // Create a simple hash based on profile IDs and count
        const profileIds = searchSpace.map(p => p.id || p.profileId).sort();
        const hashInput = `${profileIds.length}:${profileIds.slice(0, 10).join(':')}`;
        
        // Simple hash function (in production, consider using crypto.createHash)
        let hash = 0;
        for (let i = 0; i < hashInput.length; i++) {
            const char = hashInput.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        return Math.abs(hash).toString(36);
    }

    /**
     * Close Redis connection
     */
    async close() {
        if (this.client && this.isConnected) {
            try {
                await this.client.quit();
                logger.info('Cache service connection closed');
            } catch (error) {
                logger.error('Error closing cache service:', error);
            }
        }
    }
}

module.exports = CacheService;
