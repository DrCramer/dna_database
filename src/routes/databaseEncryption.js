const express = require('express');
const router = express.Router();
const databaseEncryptionService = require('../services/databaseEncryptionService');
const { authenticate, adminOnly } = require('../middleware/auth');
const { auditDataAccess, auditComplianceOperation } = require('../middleware/auditLogger');
const { logger } = require('../utils/logger');

// All database encryption routes require admin access
router.use(authenticate);
router.use(adminOnly);

// Get encryption compliance report
router.get('/compliance-report',
    auditDataAccess('encryption_config', 'read', 'restricted'),
    async (req, res) => {
        try {
            const report = await databaseEncryptionService.getEncryptionComplianceReport();

            res.json({
                success: true,
                data: report,
                message: 'Encryption compliance report generated successfully'
            });
        } catch (error) {
            logger.error('Failed to generate encryption compliance report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to generate encryption compliance report'
            });
        }
    }
);

// Validate encryption integrity for a specific record
router.post('/validate-integrity',
    auditDataAccess('encryption_audit_log', 'write', 'restricted'),
    async (req, res) => {
        try {
            const { tableName, recordId } = req.body;

            if (!tableName || !recordId) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Table name and record ID are required'
                });
            }

            // Validate table name to prevent SQL injection
            const allowedTables = [
                'dna_profiles', 'master_array_profiles', 'match_results', 
                'tasks', 'task_results', 'users', 'task_comments'
            ];
            
            if (!allowedTables.includes(tableName)) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Invalid table name'
                });
            }

            const integrityResult = await databaseEncryptionService.validateEncryptionIntegrity(
                tableName, 
                recordId
            );

            res.json({
                success: true,
                data: integrityResult,
                message: 'Encryption integrity validation completed'
            });
        } catch (error) {
            logger.error('Failed to validate encryption integrity:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to validate encryption integrity'
            });
        }
    }
);

// Perform bulk encryption for a table
router.post('/bulk-encrypt/:tableName',
    auditComplianceOperation('BULK_ENCRYPTION_INITIATED', 'warning'),
    async (req, res) => {
        try {
            const { tableName } = req.params;
            const { batchSize = 100 } = req.body;

            // Validate table name
            const allowedTables = [
                'dna_profiles', 'master_array_profiles', 'match_results', 
                'tasks', 'task_results', 'task_comments'
            ];
            
            if (!allowedTables.includes(tableName)) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Invalid table name for bulk encryption'
                });
            }

            // Validate batch size
            if (batchSize < 1 || batchSize > 1000) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Batch size must be between 1 and 1000'
                });
            }

            logger.info(`Bulk encryption initiated for table: ${tableName}`, {
                userId: req.user.id,
                batchSize
            });

            // Start bulk encryption (this is a long-running operation)
            const encryptionResult = await databaseEncryptionService.bulkEncryptTable(
                tableName,
                req.user.id,
                batchSize
            );

            res.json({
                success: true,
                data: encryptionResult,
                message: `Bulk encryption completed for ${tableName}`
            });
        } catch (error) {
            logger.error('Bulk encryption failed:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Bulk encryption operation failed'
            });
        }
    }
);

// Get encryption audit logs
router.get('/audit-logs',
    auditDataAccess('encryption_audit_log', 'read', 'restricted'),
    async (req, res) => {
        try {
            const {
                tableName = null,
                operation = null,
                success = null,
                startDate = null,
                endDate = null,
                limit = 100,
                offset = 0
            } = req.query;

            let whereConditions = [];
            let params = [];
            let paramIndex = 1;

            if (tableName) {
                whereConditions.push(`table_name = $${paramIndex++}`);
                params.push(tableName);
            }

            if (operation) {
                whereConditions.push(`operation = $${paramIndex++}`);
                params.push(operation);
            }

            if (success !== null) {
                whereConditions.push(`success = $${paramIndex++}`);
                params.push(success === 'true');
            }

            if (startDate) {
                whereConditions.push(`performed_at >= $${paramIndex++}`);
                params.push(startDate);
            }

            if (endDate) {
                whereConditions.push(`performed_at <= $${paramIndex++}`);
                params.push(endDate);
            }

            const whereClause = whereConditions.length > 0 
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            const queryText = `
                SELECT 
                    eal.*,
                    u.username as performed_by_username
                FROM encryption_audit_log eal
                LEFT JOIN users u ON eal.performed_by = u.id
                ${whereClause}
                ORDER BY eal.performed_at DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            params.push(parseInt(limit), parseInt(offset));

            const { query } = require('../config/database');
            const result = await query(queryText, params);

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    total: result.rows.length
                }
            });
        } catch (error) {
            logger.error('Failed to get encryption audit logs:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve encryption audit logs'
            });
        }
    }
);

// Get encryption configuration
router.get('/config',
    auditDataAccess('encryption_config', 'read', 'internal'),
    async (req, res) => {
        try {
            const { query } = require('../config/database');
            const result = await query(`
                SELECT 
                    table_name,
                    column_name,
                    encryption_type,
                    key_rotation_interval,
                    last_key_rotation,
                    is_active,
                    CASE 
                        WHEN last_key_rotation + (key_rotation_interval || ' days')::INTERVAL < CURRENT_TIMESTAMP 
                        THEN true 
                        ELSE false 
                    END as needs_rotation
                FROM encryption_config 
                WHERE is_active = true
                ORDER BY table_name, column_name
            `);

            res.json({
                success: true,
                data: result.rows
            });
        } catch (error) {
            logger.error('Failed to get encryption configuration:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve encryption configuration'
            });
        }
    }
);

// Update encryption configuration
router.patch('/config/:tableName/:columnName',
    auditComplianceOperation('ENCRYPTION_CONFIG_UPDATE', 'info'),
    async (req, res) => {
        try {
            const { tableName, columnName } = req.params;
            const { keyRotationInterval, isActive } = req.body;

            const { query } = require('../config/database');
            
            let updateFields = [];
            let updateValues = [];
            let paramIndex = 1;

            if (keyRotationInterval !== undefined) {
                updateFields.push(`key_rotation_interval = $${paramIndex++}`);
                updateValues.push(parseInt(keyRotationInterval));
            }

            if (isActive !== undefined) {
                updateFields.push(`is_active = $${paramIndex++}`);
                updateValues.push(isActive);
            }

            if (updateFields.length === 0) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'No valid fields to update'
                });
            }

            updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
            updateValues.push(tableName, columnName);

            const result = await query(`
                UPDATE encryption_config 
                SET ${updateFields.join(', ')}
                WHERE table_name = $${paramIndex++} AND column_name = $${paramIndex++}
                RETURNING *
            `, updateValues);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Encryption configuration not found'
                });
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Encryption configuration updated successfully'
            });
        } catch (error) {
            logger.error('Failed to update encryption configuration:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to update encryption configuration'
            });
        }
    }
);

// Check key rotation needs
router.get('/key-rotation-status',
    auditDataAccess('encryption_config', 'read', 'internal'),
    async (req, res) => {
        try {
            const { query } = require('../config/database');
            const result = await query(`
                SELECT 
                    table_name,
                    column_name,
                    last_key_rotation,
                    key_rotation_interval,
                    CASE 
                        WHEN last_key_rotation + (key_rotation_interval || ' days')::INTERVAL < CURRENT_TIMESTAMP 
                        THEN true 
                        ELSE false 
                    END as needs_rotation,
                    EXTRACT(DAYS FROM (CURRENT_TIMESTAMP - last_key_rotation)) as days_since_rotation
                FROM encryption_config 
                WHERE is_active = true
                ORDER BY needs_rotation DESC, days_since_rotation DESC
            `);

            const needingRotation = result.rows.filter(row => row.needs_rotation);
            
            res.json({
                success: true,
                data: {
                    allConfigurations: result.rows,
                    needingRotation: needingRotation,
                    summary: {
                        totalConfigurations: result.rows.length,
                        needingRotation: needingRotation.length,
                        upToDate: result.rows.length - needingRotation.length
                    }
                }
            });
        } catch (error) {
            logger.error('Failed to check key rotation status:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to check key rotation status'
            });
        }
    }
);

// Manual key rotation trigger (placeholder - actual key rotation would require careful implementation)
router.post('/rotate-keys/:tableName/:columnName',
    auditComplianceOperation('MANUAL_KEY_ROTATION', 'critical'),
    async (req, res) => {
        try {
            const { tableName, columnName } = req.params;

            logger.warn('Manual key rotation requested', {
                tableName,
                columnName,
                userId: req.user.id
            });

            // This is a placeholder - actual key rotation would require:
            // 1. Generating new encryption keys
            // 2. Re-encrypting all data with new keys
            // 3. Updating encryption configuration
            // 4. Comprehensive testing and validation

            res.json({
                success: false,
                message: 'Manual key rotation is not yet implemented. This operation requires careful planning and system maintenance window.',
                recommendation: 'Please contact system administrator for key rotation procedures.'
            });
        } catch (error) {
            logger.error('Key rotation request failed:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Key rotation request failed'
            });
        }
    }
);

module.exports = router;