const express = require('express');
const router = express.Router();
const auditService = require('../services/auditService');
const auditExportService = require('../services/auditExportService');
const { authenticate, adminOnly } = require('../middleware/auth');
const { auditDataAccess, auditComplianceOperation } = require('../middleware/auditLogger');
const { logger } = require('../utils/logger');
const path = require('path');

// All audit routes require admin access
router.use(authenticate);
router.use(adminOnly);

// Get audit logs
router.get('/logs', 
    auditDataAccess('audit_logs', 'read', 'restricted'),
    async (req, res) => {
        try {
            const filters = {
                userId: req.query.userId,
                tableName: req.query.tableName,
                action: req.query.action,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                complianceLevel: req.query.complianceLevel,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0
            };

            const logs = await auditService.getAuditLogs(filters);

            res.json({
                success: true,
                data: logs,
                pagination: {
                    limit: filters.limit,
                    offset: filters.offset,
                    total: logs.length
                }
            });
        } catch (error) {
            logger.error('Failed to get audit logs:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve audit logs'
            });
        }
    }
);

// Get data access logs
router.get('/access-logs',
    auditDataAccess('data_access_log', 'read', 'restricted'),
    async (req, res) => {
        try {
            const filters = {
                userId: req.query.userId,
                resourceType: req.query.resourceType,
                accessType: req.query.accessType,
                accessGranted: req.query.accessGranted === 'true' ? true : 
                              req.query.accessGranted === 'false' ? false : null,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0
            };

            const logs = await auditService.getDataAccessLogs(filters);

            res.json({
                success: true,
                data: logs,
                pagination: {
                    limit: filters.limit,
                    offset: filters.offset,
                    total: logs.length
                }
            });
        } catch (error) {
            logger.error('Failed to get data access logs:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve data access logs'
            });
        }
    }
);

// Get compliance events
router.get('/compliance-events',
    auditDataAccess('compliance_events', 'read', 'restricted'),
    async (req, res) => {
        try {
            const filters = {
                eventType: req.query.eventType,
                severity: req.query.severity,
                resolved: req.query.resolved === 'true' ? true : 
                         req.query.resolved === 'false' ? false : null,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0
            };

            const events = await auditService.getComplianceEvents(filters);

            res.json({
                success: true,
                data: events,
                pagination: {
                    limit: filters.limit,
                    offset: filters.offset,
                    total: events.length
                }
            });
        } catch (error) {
            logger.error('Failed to get compliance events:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve compliance events'
            });
        }
    }
);

// Resolve compliance event
router.patch('/compliance-events/:eventId/resolve',
    auditComplianceOperation('COMPLIANCE_EVENT_RESOLVED', 'info'),
    async (req, res) => {
        try {
            const { eventId } = req.params;
            const { resolutionNotes } = req.body;

            if (!resolutionNotes) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Resolution notes are required'
                });
            }

            const success = await auditService.resolveComplianceEvent(
                eventId,
                req.user.id,
                resolutionNotes
            );

            if (success) {
                res.json({
                    success: true,
                    message: 'Compliance event resolved successfully'
                });
            } else {
                res.status(404).json({
                    error: 'Not Found',
                    message: 'Compliance event not found'
                });
            }
        } catch (error) {
            logger.error('Failed to resolve compliance event:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to resolve compliance event'
            });
        }
    }
);

// Get data retention policies
router.get('/retention-policies',
    auditDataAccess('data_retention_policies', 'read', 'internal'),
    async (req, res) => {
        try {
            const policies = await auditService.getRetentionPolicies();

            res.json({
                success: true,
                data: policies
            });
        } catch (error) {
            logger.error('Failed to get retention policies:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve retention policies'
            });
        }
    }
);

// Apply data retention policies (manual trigger)
router.post('/retention-policies/apply',
    auditComplianceOperation('DATA_RETENTION_MANUAL_TRIGGER', 'warning'),
    async (req, res) => {
        try {
            const cleanedCount = await auditService.applyRetentionPolicies();

            res.json({
                success: true,
                message: `Data retention policies applied successfully`,
                recordsProcessed: cleanedCount
            });
        } catch (error) {
            logger.error('Failed to apply retention policies:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to apply retention policies'
            });
        }
    }
);

// Secure delete record
router.delete('/secure-delete/:tableName/:recordId',
    auditComplianceOperation('SECURE_DELETE_MANUAL', 'critical'),
    async (req, res) => {
        try {
            const { tableName, recordId } = req.params;
            const { deletionReason, deletionMethod = 'soft' } = req.body;

            if (!deletionReason) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Deletion reason is required'
                });
            }

            // Validate table name to prevent SQL injection
            const allowedTables = ['dna_profiles', 'match_results', 'user_sessions', 'file_uploads'];
            if (!allowedTables.includes(tableName)) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Invalid table name'
                });
            }

            const success = await auditService.secureDelete({
                tableName,
                recordId,
                deletionReason,
                deletedBy: req.user.id,
                deletionMethod
            });

            if (success) {
                res.json({
                    success: true,
                    message: 'Record deleted securely'
                });
            } else {
                res.status(500).json({
                    error: 'Internal Server Error',
                    message: 'Secure deletion failed'
                });
            }
        } catch (error) {
            logger.error('Secure deletion failed:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Secure deletion failed'
            });
        }
    }
);

// Export audit data to Excel
router.post('/export/excel',
    auditDataAccess('audit_export', 'export', 'restricted'),
    async (req, res) => {
        try {
            const exportOptions = {
                exportType: req.body.exportType || 'full_audit',
                dateRange: req.body.dateRange || null,
                departmentId: req.body.departmentId || null,
                organizationId: req.body.organizationId || null,
                includeUserDetails: req.body.includeUserDetails !== false,
                includeSystemEvents: req.body.includeSystemEvents || false,
                filename: req.body.filename || null
            };

            const userInfo = {
                userId: req.user.id,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            };

            const exportResult = await auditExportService.exportAuditToExcel(exportOptions, userInfo);

            res.json({
                success: true,
                data: exportResult,
                message: 'Audit Excel export generated successfully'
            });
        } catch (error) {
            logger.error('Failed to export audit to Excel:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to generate audit Excel export'
            });
        }
    }
);

// Export audit data to PDF
router.post('/export/pdf',
    auditDataAccess('audit_export', 'export', 'restricted'),
    async (req, res) => {
        try {
            const exportOptions = {
                exportType: req.body.exportType || 'full_audit',
                dateRange: req.body.dateRange || null,
                departmentId: req.body.departmentId || null,
                organizationId: req.body.organizationId || null,
                includeUserDetails: req.body.includeUserDetails !== false,
                includeSystemEvents: req.body.includeSystemEvents || false,
                filename: req.body.filename || null
            };

            const userInfo = {
                userId: req.user.id,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            };

            const exportResult = await auditExportService.exportAuditToPDF(exportOptions, userInfo);

            res.json({
                success: true,
                data: exportResult,
                message: 'Audit PDF export generated successfully'
            });
        } catch (error) {
            logger.error('Failed to export audit to PDF:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to generate audit PDF export'
            });
        }
    }
);

// Download audit export file
router.get('/export/download/:exportId',
    auditDataAccess('audit_export', 'read', 'restricted'),
    async (req, res) => {
        try {
            const { exportId } = req.params;

            const fileInfo = await auditExportService.getExportFile(exportId);

            res.setHeader('Content-Type', fileInfo.mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.filename}"`);
            res.setHeader('Content-Length', fileInfo.size);

            res.sendFile(path.resolve(fileInfo.filePath));
        } catch (error) {
            logger.error('Failed to download audit export:', error);
            
            if (error.message.includes('not found') || error.message.includes('expired')) {
                res.status(404).json({
                    error: 'Not Found',
                    message: 'Audit export file not found or expired'
                });
            } else {
                res.status(500).json({
                    error: 'Internal Server Error',
                    message: 'Failed to download audit export'
                });
            }
        }
    }
);

// Get organizational operations (enhanced endpoint for multi-user system)
router.get('/organizational-operations',
    auditDataAccess('operation_history', 'read', 'restricted'),
    async (req, res) => {
        try {
            const filters = {
                userId: req.query.userId,
                operationType: req.query.operationType,
                resourceType: req.query.resourceType,
                departmentId: req.query.departmentId,
                organizationId: req.query.organizationId,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                limit: parseInt(req.query.limit) || 100,
                offset: parseInt(req.query.offset) || 0
            };

            const operations = await auditService.getOrganizationalOperations(filters);

            res.json({
                success: true,
                data: operations,
                pagination: {
                    limit: filters.limit,
                    offset: filters.offset,
                    total: operations.length
                }
            });
        } catch (error) {
            logger.error('Failed to get organizational operations:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve organizational operations'
            });
        }
    }
);

// Get department audit summary
router.get('/department-summary/:departmentId',
    auditDataAccess('operation_history', 'read', 'restricted'),
    async (req, res) => {
        try {
            const { departmentId } = req.params;
            const { startDate, endDate } = req.query;

            const summary = await auditService.getDepartmentAuditSummary(
                departmentId,
                startDate,
                endDate
            );

            const userActivity = await auditService.getDepartmentUserActivity(
                departmentId,
                startDate,
                endDate
            );

            res.json({
                success: true,
                data: {
                    operationSummary: summary,
                    userActivity: userActivity
                }
            });
        } catch (error) {
            logger.error('Failed to get department audit summary:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve department audit summary'
            });
        }
    }
);

module.exports = router;