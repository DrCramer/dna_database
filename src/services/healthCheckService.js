const { query, pool, getPoolStats, checkConnectionHealth } = require('../config/database');
const { logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

class HealthCheckService {
    constructor() {
        this.checks = new Map();
        this.initializeChecks();
    }

    initializeChecks() {
        // Database connectivity check
        this.checks.set('database', {
            name: 'Database Connection',
            check: this.checkDatabase.bind(this),
            critical: true
        });

        // Database schema check
        this.checks.set('schema', {
            name: 'Database Schema',
            check: this.checkSchema.bind(this),
            critical: true
        });

        // Organizational structure check
        this.checks.set('organizational', {
            name: 'Organizational Structure',
            check: this.checkOrganizationalStructure.bind(this),
            critical: false
        });

        // Database pool health check
        this.checks.set('pool', {
            name: 'Database Pool',
            check: this.checkDatabasePool.bind(this),
            critical: true
        });

        // Concurrency handling check
        this.checks.set('concurrency', {
            name: 'Concurrency Management',
            check: this.checkConcurrency.bind(this),
            critical: false
        });

        // Container autonomy check
        this.checks.set('autonomy', {
            name: 'Container Autonomy',
            check: this.checkContainerAutonomy.bind(this),
            critical: false
        });

        // File system check
        this.checks.set('filesystem', {
            name: 'File System',
            check: this.checkFileSystem.bind(this),
            critical: false
        });

        // Memory usage check
        this.checks.set('memory', {
            name: 'Memory Usage',
            check: this.checkMemory.bind(this),
            critical: false
        });

        // Data persistence check
        this.checks.set('persistence', {
            name: 'Data Persistence',
            check: this.checkDataPersistence.bind(this),
            critical: false
        });
    }

    async checkDatabase() {
        try {
            const healthResult = await checkConnectionHealth();
            
            if (!healthResult.healthy) {
                return {
                    status: 'unhealthy',
                    error: healthResult.error
                };
            }
            
            return {
                status: 'healthy',
                details: {
                    responseTime: `${healthResult.responseTime}ms`,
                    currentTime: healthResult.currentTime,
                    poolStats: healthResult.poolStats
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async checkSchema() {
        try {
            // Check if required tables exist
            const requiredTables = [
                'users', 'dna_profiles', 'match_results', 
                'operation_history', 'user_sessions', 'file_uploads'
            ];

            // Check if organizational tables exist (optional for backward compatibility)
            const organizationalTables = [
                'organizations', 'departments', 'master_arrays', 
                'expert_groups', 'tasks', 'task_comments', 'task_results'
            ];

            const allTables = [...requiredTables, ...organizationalTables];

            const tableCheckQuery = `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = ANY($1)
            `;
            
            const result = await query(tableCheckQuery, [allTables]);
            const existingTables = result.rows.map(row => row.table_name);
            const missingRequiredTables = requiredTables.filter(table => !existingTables.includes(table));
            const missingOrganizationalTables = organizationalTables.filter(table => !existingTables.includes(table));

            if (missingRequiredTables.length > 0) {
                return {
                    status: 'unhealthy',
                    error: `Missing required tables: ${missingRequiredTables.join(', ')}`
                };
            }

            // Check if STR loci configuration exists
            const strLociResult = await query('SELECT COUNT(*) as count FROM str_loci_config');
            const strLociCount = parseInt(strLociResult.rows[0].count);

            const isMultiUserReady = missingOrganizationalTables.length === 0;

            return {
                status: 'healthy',
                details: {
                    requiredTables: requiredTables.length,
                    organizationalTables: organizationalTables.length - missingOrganizationalTables.length,
                    totalTables: existingTables.length,
                    strLociConfigured: strLociCount,
                    multiUserReady: isMultiUserReady,
                    missingOrganizationalTables: missingOrganizationalTables
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async checkFileSystem() {
        try {
            const directories = ['uploads', 'exports', 'logs'];
            const checks = {};

            for (const dir of directories) {
                try {
                    await fs.access(dir);
                    const stats = await fs.stat(dir);
                    checks[dir] = {
                        exists: true,
                        writable: true,
                        size: stats.size
                    };
                } catch (error) {
                    checks[dir] = {
                        exists: false,
                        writable: false,
                        error: error.message
                    };
                }
            }

            const allHealthy = Object.values(checks).every(check => check.exists);
            
            return {
                status: allHealthy ? 'healthy' : 'degraded',
                details: checks
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async checkMemory() {
        try {
            const memUsage = process.memoryUsage();
            const heapLimit = require('v8').getHeapStatistics().heap_size_limit;
            const totalMem = memUsage.heapTotal;
            const usedMem = memUsage.heapUsed;
            const memoryUsagePercent = (usedMem / heapLimit) * 100;

            return {
                status: memoryUsagePercent > 90 ? 'degraded' : 'healthy',
                details: {
                    heapUsed: `${Math.round(usedMem / 1024 / 1024)}MB`,
                    heapTotal: `${Math.round(totalMem / 1024 / 1024)}MB`,
                    heapLimit: `${Math.round(heapLimit / 1024 / 1024)}MB`,
                    usagePercent: `${memoryUsagePercent.toFixed(2)}%`,
                    external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async checkDatabasePool() {
        try {
            const poolStats = getPoolStats();
            const utilizationPercent = ((poolStats.totalCount - poolStats.idleCount) / poolStats.totalCount) * 100;

            return {
                status: utilizationPercent > 90 ? 'degraded' : 'healthy',
                details: {
                    ...poolStats,
                    utilizationPercent: `${utilizationPercent.toFixed(2)}%`
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async checkConcurrency() {
        try {
            const concurrencyService = require('./concurrencyService');
            const stats = concurrencyService.getConcurrencyStats();
            
            const totalWaiting = Object.values(stats.queueStats)
                .reduce((sum, queue) => sum + queue.waiting, 0);
            
            return {
                status: totalWaiting > 50 ? 'degraded' : 'healthy',
                details: {
                    activeQueues: stats.activeQueues,
                    totalWaiting,
                    maxConcurrentOperations: stats.maxConcurrentOperations
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async checkOrganizationalStructure() {
        try {
            // Check if organizational tables exist
            const organizationalTables = ['organizations', 'departments', 'master_arrays', 'expert_groups'];
            const tableCheckQuery = `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = ANY($1)
            `;
            
            const result = await query(tableCheckQuery, [organizationalTables]);
            const existingTables = result.rows.map(row => row.table_name);
            const missingTables = organizationalTables.filter(table => !existingTables.includes(table));

            if (missingTables.length === organizationalTables.length) {
                return {
                    status: 'degraded',
                    message: 'Running in single-user mode - organizational tables not found',
                    details: {
                        mode: 'single-user',
                        missingTables
                    }
                };
            }

            if (missingTables.length > 0) {
                return {
                    status: 'degraded',
                    message: 'Partial organizational structure',
                    details: {
                        mode: 'partial-multi-user',
                        existingTables: existingTables.length,
                        missingTables
                    }
                };
            }

            // Check organizational data
            const orgResult = await query('SELECT COUNT(*) as count FROM organizations');
            const deptResult = await query('SELECT COUNT(*) as count FROM departments');
            const masterArrayResult = await query('SELECT COUNT(*) as count FROM master_arrays');

            const orgCount = parseInt(orgResult.rows[0].count);
            const deptCount = parseInt(deptResult.rows[0].count);
            const masterArrayCount = parseInt(masterArrayResult.rows[0].count);

            return {
                status: 'healthy',
                details: {
                    mode: 'multi-user',
                    organizations: orgCount,
                    departments: deptCount,
                    masterArrays: masterArrayCount,
                    tablesComplete: true
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async checkContainerAutonomy() {
        try {
            const checks = {};

            // Check if running in container
            checks.inContainer = process.env.DOCKER_CONTAINER === 'true' || 
                               require('fs').existsSync('/.dockerenv');

            // Check if all dependencies are bundled
            try {
                await fs.access('node_modules');
                checks.dependenciesBundled = true;
            } catch (error) {
                checks.dependenciesBundled = false;
            }

            // Check if database is accessible (not external)
            const dbUrl = process.env.DATABASE_URL || '';
            checks.databaseLocal = !dbUrl.includes('amazonaws.com') && 
                                  !dbUrl.includes('azure.com') && 
                                  !dbUrl.includes('googleapis.com');

            // Check if required directories exist
            const requiredDirs = ['uploads', 'exports', 'logs'];
            checks.directoriesReady = true;
            
            for (const dir of requiredDirs) {
                try {
                    await fs.access(dir);
                } catch (error) {
                    checks.directoriesReady = false;
                    break;
                }
            }

            const autonomyScore = Object.values(checks).filter(Boolean).length;
            const totalChecks = Object.keys(checks).length;
            const autonomyPercent = (autonomyScore / totalChecks) * 100;

            return {
                status: autonomyPercent >= 75 ? 'healthy' : 'degraded',
                details: {
                    ...checks,
                    autonomyScore: `${autonomyScore}/${totalChecks}`,
                    autonomyPercent: `${autonomyPercent.toFixed(1)}%`
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async checkDataPersistence() {
        try {
            const dataPersistenceService = require('./dataPersistenceService');
            const status = dataPersistenceService.getVerificationStatus();
            
            if (!status.lastVerification) {
                return {
                    status: 'degraded',
                    message: 'No persistence verification has been run yet',
                    details: {
                        isRunning: status.isRunning,
                        interval: status.verificationInterval
                    }
                };
            }

            const lastResult = status.lastVerification;
            const timeSinceLastCheck = Date.now() - new Date(lastResult.timestamp).getTime();
            const isStale = timeSinceLastCheck > (status.verificationInterval * 2);

            return {
                status: isStale ? 'degraded' : 
                       lastResult.overall === 'success' ? 'healthy' : 'degraded',
                details: {
                    lastVerification: lastResult.timestamp,
                    lastResult: lastResult.overall,
                    timeSinceLastCheck: `${Math.round(timeSinceLastCheck / 1000)}s`,
                    isStale,
                    isRunning: status.isRunning
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async runAllChecks() {
        const results = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development',
            version: process.env.npm_package_version || '1.0.0',
            checks: {}
        };

        let hasUnhealthy = false;
        let hasDegraded = false;

        for (const [key, checkConfig] of this.checks) {
            try {
                const checkResult = await checkConfig.check();
                results.checks[key] = {
                    name: checkConfig.name,
                    ...checkResult
                };

                if (checkResult.status === 'unhealthy') {
                    hasUnhealthy = true;
                    if (checkConfig.critical) {
                        results.status = 'unhealthy';
                    }
                } else if (checkResult.status === 'degraded') {
                    hasDegraded = true;
                }
            } catch (error) {
                results.checks[key] = {
                    name: checkConfig.name,
                    status: 'unhealthy',
                    error: error.message
                };
                hasUnhealthy = true;
                if (checkConfig.critical) {
                    results.status = 'unhealthy';
                }
            }
        }

        // Set overall status
        if (!hasUnhealthy && hasDegraded) {
            results.status = 'degraded';
        }

        return results;
    }

    async getReadinessCheck() {
        // Readiness check - only critical components
        const criticalChecks = ['database', 'schema'];
        const results = {
            status: 'ready',
            timestamp: new Date().toISOString(),
            checks: {}
        };

        for (const checkKey of criticalChecks) {
            const checkConfig = this.checks.get(checkKey);
            if (checkConfig) {
                try {
                    const checkResult = await checkConfig.check();
                    results.checks[checkKey] = {
                        name: checkConfig.name,
                        ...checkResult
                    };

                    if (checkResult.status === 'unhealthy') {
                        results.status = 'not_ready';
                    }
                } catch (error) {
                    results.checks[checkKey] = {
                        name: checkConfig.name,
                        status: 'unhealthy',
                        error: error.message
                    };
                    results.status = 'not_ready';
                }
            }
        }

        return results;
    }

    async getLivenessCheck() {
        // Simple liveness check - just verify the process is responsive
        return {
            status: 'alive',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            pid: process.pid
        };
    }
}

module.exports = new HealthCheckService();
