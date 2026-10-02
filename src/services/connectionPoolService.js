const { Pool } = require('pg');
const { logger } = require('../utils/logger');
const config = require('../config/environment');

class ConnectionPoolService {
    constructor() {
        this.pools = new Map(); // Department-specific pools
        this.mainPool = null;
        this.poolStats = new Map();
        this.maxPoolsPerDepartment = parseInt(process.env.MAX_POOLS_PER_DEPARTMENT) || 2;
        this.cleanupInterval = null;
        
        this.initializeMainPool();
        this.startCleanupTimer();
    }

    initializeMainPool() {
        const dbConfig = {
            connectionString: config.getConnectionString(),
            ssl: false, // Disabled for internal network
            max: parseInt(process.env.DB_POOL_MAX) || 30,
            min: parseInt(process.env.DB_POOL_MIN) || 8,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            acquireTimeoutMillis: 15000,
            application_name: 'dna_analysis_main_pool'
        };

        this.mainPool = new Pool(dbConfig);
        
        this.mainPool.on('error', (err) => {
            logger.error('Main pool error:', err);
        });

        this.mainPool.on('connect', (client) => {
            logger.debug('Main pool client connected');
        });
    }

    async initialize() {
        await this.mainPool.query('SELECT 1');
        return true;
    }

    // Get or create department-specific pool
    getDepartmentPool(departmentId) {
        if (!departmentId) {
            return this.mainPool;
        }

        const poolKey = `dept_${departmentId}`;
        
        if (this.pools.has(poolKey)) {
            const poolInfo = this.pools.get(poolKey);
            poolInfo.lastUsed = Date.now();
            return poolInfo.pool;
        }

        // Create new department pool
        const departmentConfig = {
            connectionString: config.getConnectionString(),
            ssl: false, // Disabled for internal network
            max: Math.min(parseInt(process.env.DB_POOL_MAX_PER_DEPT) || 10, 15),
            min: parseInt(process.env.DB_POOL_MIN_PER_DEPT) || 2,
            idleTimeoutMillis: 20000, // Shorter idle timeout for department pools
            connectionTimeoutMillis: 5000,
            acquireTimeoutMillis: 10000,
            application_name: `dna_analysis_dept_${departmentId}`
        };

        const departmentPool = new Pool(departmentConfig);
        
        departmentPool.on('error', (err) => {
            logger.error(`Department pool error (${departmentId}):`, err);
        });

        departmentPool.on('connect', (client) => {
            logger.debug(`Department pool client connected (${departmentId})`);
            
            // Set department context for all connections in this pool
            client.query(`SET app.current_department_id = '${departmentId}'`)
                .catch(err => {
                    logger.warn(`Failed to set department context for ${departmentId}:`, err.message);
                });
        });

        const poolInfo = {
            pool: departmentPool,
            departmentId,
            created: Date.now(),
            lastUsed: Date.now(),
            queryCount: 0
        };

        this.pools.set(poolKey, poolInfo);
        logger.info(`Created department pool for department ${departmentId}`);

        return departmentPool;
    }

    // Execute query with department context
    async executeWithDepartmentContext(query, params, departmentId, options = {}) {
        const pool = this.getDepartmentPool(departmentId);
        const start = Date.now();
        
        try {
            // Update usage statistics
            if (departmentId) {
                const poolKey = `dept_${departmentId}`;
                const poolInfo = this.pools.get(poolKey);
                if (poolInfo) {
                    poolInfo.queryCount++;
                    poolInfo.lastUsed = Date.now();
                }
            }

            const result = await pool.query(query, params);
            const duration = Date.now() - start;
            
            // Log slow queries
            if (duration > 1000) {
                logger.warn('Slow department query detected', {
                    departmentId,
                    duration,
                    query: query.substring(0, 100) + '...',
                    rows: result.rowCount
                });
            }

            return result;
        } catch (error) {
            logger.error('Department query failed', {
                departmentId,
                error: error.message,
                query: query.substring(0, 100) + '...'
            });
            throw error;
        }
    }

    // Execute transaction with department context
    async executeTransactionWithDepartmentContext(callback, departmentId, options = {}) {
        const pool = this.getDepartmentPool(departmentId);
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Set isolation level if specified
            if (options.isolationLevel && options.isolationLevel !== 'READ COMMITTED') {
                await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
            }
            
            // Ensure department context is set
            if (departmentId) {
                await client.query('SET LOCAL app.current_department_id = $1', [departmentId]);
            }
            
            const result = await callback(client);
            await client.query('COMMIT');
            
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                logger.error('Rollback failed:', rollbackError);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    // Get comprehensive pool statistics
    getPoolStatistics() {
        const stats = {
            mainPool: {
                totalCount: this.mainPool.totalCount,
                idleCount: this.mainPool.idleCount,
                waitingCount: this.mainPool.waitingCount
            },
            departmentPools: {},
            totalDepartmentPools: this.pools.size,
            summary: {
                totalConnections: this.mainPool.totalCount,
                totalIdleConnections: this.mainPool.idleCount,
                totalWaitingConnections: this.mainPool.waitingCount
            }
        };

        for (const [poolKey, poolInfo] of this.pools) {
            const pool = poolInfo.pool;
            stats.departmentPools[poolKey] = {
                departmentId: poolInfo.departmentId,
                totalCount: pool.totalCount,
                idleCount: pool.idleCount,
                waitingCount: pool.waitingCount,
                queryCount: poolInfo.queryCount,
                created: poolInfo.created,
                lastUsed: poolInfo.lastUsed,
                ageMinutes: Math.round((Date.now() - poolInfo.created) / 60000)
            };

            // Add to summary
            stats.summary.totalConnections += pool.totalCount;
            stats.summary.totalIdleConnections += pool.idleCount;
            stats.summary.totalWaitingConnections += pool.waitingCount;
        }

        return stats;
    }

    // Cleanup unused department pools
    async cleanupUnusedPools() {
        const now = Date.now();
        const maxIdleTime = parseInt(process.env.DEPT_POOL_MAX_IDLE_TIME) || 300000; // 5 minutes
        const poolsToRemove = [];

        for (const [poolKey, poolInfo] of this.pools) {
            const idleTime = now - poolInfo.lastUsed;
            
            if (idleTime > maxIdleTime && poolInfo.queryCount === 0) {
                poolsToRemove.push(poolKey);
            }
        }

        for (const poolKey of poolsToRemove) {
            const poolInfo = this.pools.get(poolKey);
            
            try {
                await poolInfo.pool.end();
                this.pools.delete(poolKey);
                logger.info(`Cleaned up unused department pool: ${poolKey}`);
            } catch (error) {
                logger.error(`Failed to cleanup department pool ${poolKey}:`, error);
            }
        }

        return poolsToRemove.length;
    }

    // Start cleanup timer
    startCleanupTimer() {
        const cleanupInterval = parseInt(process.env.POOL_CLEANUP_INTERVAL) || 300000; // 5 minutes
        
        this.cleanupInterval = setInterval(async () => {
            try {
                const cleaned = await this.cleanupUnusedPools();
                if (cleaned > 0) {
                    logger.info(`Cleaned up ${cleaned} unused department pools`);
                }
            } catch (error) {
                logger.error('Pool cleanup failed:', error);
            }
        }, cleanupInterval);
    }

    // Stop cleanup timer
    stopCleanupTimer() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    // Graceful shutdown
    async shutdown() {
        logger.info('Shutting down connection pool service...');
        
        this.stopCleanupTimer();
        
        // Close all department pools
        const shutdownPromises = [];
        
        for (const [poolKey, poolInfo] of this.pools) {
            shutdownPromises.push(
                poolInfo.pool.end().catch(error => {
                    logger.error(`Failed to close department pool ${poolKey}:`, error);
                })
            );
        }
        
        // Close main pool
        shutdownPromises.push(
            this.mainPool.end().catch(error => {
                logger.error('Failed to close main pool:', error);
            })
        );
        
        await Promise.all(shutdownPromises);
        
        this.pools.clear();
        logger.info('Connection pool service shutdown completed');
    }

    // Health check for all pools
    async healthCheck() {
        const results = {
            mainPool: { healthy: false },
            departmentPools: {},
            overall: false
        };

        try {
            // Check main pool
            const mainResult = await this.mainPool.query('SELECT 1 as health_check');
            results.mainPool = {
                healthy: true,
                connections: this.mainPool.totalCount
            };
        } catch (error) {
            results.mainPool = {
                healthy: false,
                error: error.message
            };
        }

        // Check department pools
        let healthyDeptPools = 0;
        
        for (const [poolKey, poolInfo] of this.pools) {
            try {
                await poolInfo.pool.query('SELECT 1 as health_check');
                results.departmentPools[poolKey] = {
                    healthy: true,
                    departmentId: poolInfo.departmentId,
                    connections: poolInfo.pool.totalCount
                };
                healthyDeptPools++;
            } catch (error) {
                results.departmentPools[poolKey] = {
                    healthy: false,
                    departmentId: poolInfo.departmentId,
                    error: error.message
                };
            }
        }

        results.overall = results.mainPool.healthy && 
                         (this.pools.size === 0 || healthyDeptPools === this.pools.size);

        return results;
    }
}

module.exports = new ConnectionPoolService();
