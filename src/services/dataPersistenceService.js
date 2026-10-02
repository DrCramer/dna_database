const { query, transaction, verifyDataPersistence } = require('../config/database');
const { logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');

class DataPersistenceService {
    constructor() {
        this.verificationInterval = parseInt(process.env.PERSISTENCE_CHECK_INTERVAL) || 300000; // 5 minutes
        this.verificationTimer = null;
        this.lastVerification = null;
        this.verificationResults = [];
        this.maxResultHistory = 100;
    }

    // Start periodic persistence verification
    startPeriodicVerification() {
        if (this.verificationTimer) {
            clearInterval(this.verificationTimer);
        }
        
        logger.info(`Starting periodic data persistence verification (interval: ${this.verificationInterval}ms)`);
        
        this.verificationTimer = setInterval(async () => {
            try {
                await this.runFullVerification();
            } catch (error) {
                logger.error('Periodic persistence verification failed:', error);
            }
        }, this.verificationInterval);
        
        // Run initial verification
        setImmediate(() => this.runFullVerification());
    }

    // Stop periodic verification
    stopPeriodicVerification() {
        if (this.verificationTimer) {
            clearInterval(this.verificationTimer);
            this.verificationTimer = null;
            logger.info('Stopped periodic data persistence verification');
        }
    }

    // Run comprehensive persistence verification
    async runFullVerification() {
        const startTime = Date.now();
        logger.debug('Starting full data persistence verification');
        
        const results = {
            timestamp: new Date().toISOString(),
            duration: 0,
            overall: 'success',
            checks: {}
        };
        
        try {
            // 1. Database connectivity and basic operations
            results.checks.database = await this.verifyDatabasePersistence();
            
            // 2. File system persistence
            results.checks.filesystem = await this.verifyFileSystemPersistence();
            
            // 3. Transaction integrity
            results.checks.transactions = await this.verifyTransactionIntegrity();
            
            // 4. Data consistency across restarts
            results.checks.consistency = await this.verifyDataConsistency();
            
            // 5. Backup and recovery verification
            results.checks.backup = await this.verifyBackupIntegrity();
            
            // Determine overall status
            const hasFailures = Object.values(results.checks).some(check => check.status === 'failed');
            const hasWarnings = Object.values(results.checks).some(check => check.status === 'warning');
            
            if (hasFailures) {
                results.overall = 'failed';
            } else if (hasWarnings) {
                results.overall = 'warning';
            }
            
            results.duration = Date.now() - startTime;
            this.lastVerification = results;
            
            // Store result in history
            this.verificationResults.unshift(results);
            if (this.verificationResults.length > this.maxResultHistory) {
                this.verificationResults = this.verificationResults.slice(0, this.maxResultHistory);
            }
            
            if (results.overall === 'success') {
                logger.info(`Data persistence verification completed successfully in ${results.duration}ms`);
            } else {
                logger.warn(`Data persistence verification completed with issues in ${results.duration}ms`);
            }
            
            return results;
            
        } catch (error) {
            results.duration = Date.now() - startTime;
            results.overall = 'error';
            results.error = error.message;
            
            logger.error('Data persistence verification failed:', error);
            return results;
        }
    }

    // Verify database persistence across operations
    async verifyDatabasePersistence() {
        try {
            const testData = {
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                data: { test: true, random: Math.random() }
            };
            
            // Test basic CRUD operations
            await transaction(async (client) => {
                // Insert test record
                await client.query(`
                    INSERT INTO operation_history (id, user_id, operation_type, operation_details, timestamp) 
                    VALUES ($1, NULL, 'persistence_test', $2, $3)
                `, [testData.id, testData.data, testData.timestamp]);
                
                // Verify insert
                const selectResult = await client.query(
                    'SELECT * FROM operation_history WHERE id = $1',
                    [testData.id]
                );
                
                if (selectResult.rows.length === 0) {
                    throw new Error('Test record not found after insert');
                }
                
                // Update test record
                const updatedData = { ...testData.data, updated: true };
                await client.query(
                    'UPDATE operation_history SET operation_details = $1 WHERE id = $2',
                    [updatedData, testData.id]
                );
                
                // Verify update
                const updateResult = await client.query(
                    'SELECT operation_details FROM operation_history WHERE id = $1',
                    [testData.id]
                );
                
                if (!updateResult.rows[0].operation_details.updated) {
                    throw new Error('Test record update not persisted');
                }
                
                // Clean up
                await client.query('DELETE FROM operation_history WHERE id = $1', [testData.id]);
            });
            
            return {
                status: 'success',
                message: 'Database persistence verification passed',
                testId: testData.id
            };
            
        } catch (error) {
            return {
                status: 'failed',
                message: 'Database persistence verification failed',
                error: error.message
            };
        }
    }

    // Verify file system persistence
    async verifyFileSystemPersistence() {
        try {
            const testDir = path.join('logs', `temp_persistence_test_${randomUUID()}`);
            const testFile = path.join(testDir, `test_${Date.now()}.txt`);
            const testContent = `Persistence test: ${new Date().toISOString()}`;
            
            // Create test directory
            await fs.mkdir(testDir, { recursive: true });
            
            // Write test file
            await fs.writeFile(testFile, testContent, 'utf8');
            
            // Verify file exists and content is correct
            const readContent = await fs.readFile(testFile, 'utf8');
            if (readContent !== testContent) {
                throw new Error('File content mismatch');
            }
            
            // Test file modification
            const modifiedContent = testContent + '\nModified';
            await fs.writeFile(testFile, modifiedContent, 'utf8');
            
            const rereadContent = await fs.readFile(testFile, 'utf8');
            if (rereadContent !== modifiedContent) {
                throw new Error('File modification not persisted');
            }
            
            // Clean up
            await fs.unlink(testFile);
            await fs.rmdir(testDir);
            
            return {
                status: 'success',
                message: 'File system persistence verification passed',
                testFile
            };
            
        } catch (error) {
            return {
                status: 'failed',
                message: 'File system persistence verification failed',
                error: error.message
            };
        }
    }

    // Verify transaction integrity and rollback behavior
    async verifyTransactionIntegrity() {
        try {
            const testId = randomUUID();
            
            // Test successful transaction
            await transaction(async (client) => {
                await client.query(`
                    INSERT INTO operation_history (id, user_id, operation_type, operation_details) 
                    VALUES ($1, NULL, 'transaction_test', $2)
                `, [testId, { test: 'success' }]);
            });
            
            // Verify record exists
            const successResult = await query(
                'SELECT id FROM operation_history WHERE id = $1',
                [testId]
            );
            
            if (successResult.rows.length === 0) {
                throw new Error('Successful transaction not persisted');
            }
            
            // Test failed transaction (should rollback)
            const failTestId = randomUUID();
            
            try {
                await transaction(async (client) => {
                    await client.query(`
                        INSERT INTO operation_history (id, user_id, operation_type, operation_details) 
                        VALUES ($1, NULL, 'transaction_test', $2)
                    `, [failTestId, { test: 'fail' }]);
                    
                    // Force an error to trigger rollback
                    throw new Error('Intentional transaction failure');
                });
            } catch (error) {
                // Expected to fail
            }
            
            // Verify rollback worked (record should not exist)
            const failResult = await query(
                'SELECT id FROM operation_history WHERE id = $1',
                [failTestId]
            );
            
            if (failResult.rows.length > 0) {
                throw new Error('Failed transaction was not rolled back');
            }
            
            // Clean up successful test record
            await query('DELETE FROM operation_history WHERE id = $1', [testId]);
            
            return {
                status: 'success',
                message: 'Transaction integrity verification passed',
                successTestId: testId,
                failTestId: failTestId
            };
            
        } catch (error) {
            return {
                status: 'failed',
                message: 'Transaction integrity verification failed',
                error: error.message
            };
        }
    }

    // Verify data consistency across container restarts
    async verifyDataConsistency() {
        try {
            // Check for orphaned records or inconsistent states
            const checks = [];
            
            // Check for DNA profiles without users
            const orphanedProfiles = await query(`
                SELECT dp.id, dp.sample_name 
                FROM dna_profiles dp 
                LEFT JOIN users u ON dp.user_id = u.id 
                WHERE u.id IS NULL
            `);
            
            if (orphanedProfiles.rows.length > 0) {
                checks.push({
                    type: 'orphaned_profiles',
                    count: orphanedProfiles.rows.length,
                    severity: 'warning'
                });
            }

            // Check for match results without profiles
            const orphanedMatches = await query(`
                SELECT mr.id 
                FROM match_results mr 
                LEFT JOIN dna_profiles dp1 ON mr.profile_id_1 = dp1.id 
                LEFT JOIN dna_profiles dp2 ON mr.profile_id_2 = dp2.id 
                WHERE dp1.id IS NULL OR dp2.id IS NULL
            `);
            
            if (orphanedMatches.rows.length > 0) {
                checks.push({
                    type: 'orphaned_matches',
                    count: orphanedMatches.rows.length,
                    severity: 'warning'
                });
            }

            // Check organizational data consistency (if tables exist)
            const orgTablesExist = await query(`
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('organizations', 'departments', 'master_arrays')
            `);
            
            if (parseInt(orgTablesExist.rows[0].count) === 3) {
                // Check for departments without organizations
                const orphanedDepartments = await query(`
                    SELECT d.id, d.name 
                    FROM departments d 
                    LEFT JOIN organizations o ON d.organization_id = o.id 
                    WHERE o.id IS NULL
                `);
                
                if (orphanedDepartments.rows.length > 0) {
                    checks.push({
                        type: 'orphaned_departments',
                        count: orphanedDepartments.rows.length,
                        severity: 'error'
                    });
                }

                // Check for departments without master arrays
                const departmentsWithoutMasterArrays = await query(`
                    SELECT d.id, d.name 
                    FROM departments d 
                    LEFT JOIN master_arrays ma ON d.master_array_id = ma.id 
                    WHERE ma.id IS NULL AND d.is_active = true
                `);
                
                if (departmentsWithoutMasterArrays.rows.length > 0) {
                    checks.push({
                        type: 'departments_without_master_arrays',
                        count: departmentsWithoutMasterArrays.rows.length,
                        severity: 'error'
                    });
                }

                // Check for users without departments
                const usersWithoutDepartments = await query(`
                    SELECT u.id, u.username 
                    FROM users u 
                    LEFT JOIN departments d ON u.department_id = d.id 
                    WHERE d.id IS NULL AND u.is_active = true
                `);
                
                if (usersWithoutDepartments.rows.length > 0) {
                    checks.push({
                        type: 'users_without_departments',
                        count: usersWithoutDepartments.rows.length,
                        severity: 'warning'
                    });
                }

                // Check for profiles with users from different departments (if needed)
                // Note: dna_profiles don't have department_id directly, they inherit it through user_id
                // This check is commented out as it's not applicable to current schema
                /*
                const profileDepartmentMismatches = await query(`
                    SELECT dp.id, dp.sample_name 
                    FROM dna_profiles dp 
                    JOIN users u ON dp.user_id = u.id 
                    WHERE u.department_id IS NOT NULL 
                `);
                
                if (profileDepartmentMismatches.rows.length > 0) {
                    checks.push({
                        type: 'profile_department_associations',
                        count: profileDepartmentMismatches.rows.length,
                        severity: 'info'
                    });
                }
                */
            }
            
            // Check for expired sessions
            const expiredSessions = await query(`
                SELECT COUNT(*) as count 
                FROM user_sessions 
                WHERE expires_at < NOW() AND is_active = true
            `);
            
            if (parseInt(expiredSessions.rows[0].count) > 0) {
                checks.push({
                    type: 'expired_sessions',
                    count: parseInt(expiredSessions.rows[0].count),
                    severity: 'info'
                });
            }
            
            const hasErrors = checks.some(check => check.severity === 'error');
            const hasWarnings = checks.some(check => check.severity === 'warning');
            
            return {
                status: hasErrors ? 'failed' : hasWarnings ? 'warning' : 'success',
                message: 'Data consistency verification completed',
                checks,
                organizationalDataChecked: parseInt(orgTablesExist.rows[0].count) === 3
            };
            
        } catch (error) {
            return {
                status: 'failed',
                message: 'Data consistency verification failed',
                error: error.message
            };
        }
    }

    // Verify backup integrity (basic check)
    async verifyBackupIntegrity() {
        try {
            // Check if critical tables have data
            const tables = ['users', 'dna_profiles', 'str_loci_config'];
            const tableCounts = {};
            
            for (const table of tables) {
                const result = await query(`SELECT COUNT(*) as count FROM ${table}`);
                tableCounts[table] = parseInt(result.rows[0].count);
            }
            
            // Verify minimum expected data
            const issues = [];
            
            if (tableCounts.users === 0) {
                issues.push('No users found in database');
            }
            
            if (tableCounts.str_loci_config < 39) {
                issues.push(`Insufficient STR loci configuration (${tableCounts.str_loci_config}/39)`);
            }
            
            return {
                status: issues.length > 0 ? 'warning' : 'success',
                message: 'Backup integrity verification completed',
                tableCounts,
                issues
            };
            
        } catch (error) {
            return {
                status: 'failed',
                message: 'Backup integrity verification failed',
                error: error.message
            };
        }
    }

    // Get verification status and history
    getVerificationStatus() {
        return {
            lastVerification: this.lastVerification,
            verificationInterval: this.verificationInterval,
            isRunning: this.verificationTimer !== null,
            historyCount: this.verificationResults.length
        };
    }

    // Get verification history
    getVerificationHistory(limit = 10) {
        return this.verificationResults.slice(0, limit);
    }

    // Manual verification trigger
    async triggerVerification() {
        logger.info('Manual data persistence verification triggered');
        return await this.runFullVerification();
    }
}

module.exports = new DataPersistenceService();
