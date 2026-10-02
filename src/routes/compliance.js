const express = require('express');
const router = express.Router();
const scheduledJobService = require('../services/scheduledJobService');
const auditService = require('../services/auditService');
const { authenticate, adminOnly } = require('../middleware/auth');
const { auditDataAccess, auditComplianceOperation } = require('../middleware/auditLogger');
const { logger } = require('../utils/logger');

// All compliance routes require admin access
router.use(authenticate);
router.use(adminOnly);

// Get compliance monitoring dashboard
router.get('/dashboard',
    auditDataAccess('compliance_dashboard', 'read', 'restricted'),
    async (req, res) => {
        try {
            const dashboardData = await scheduledJobService.getComplianceMonitoringData();

            res.json({
                success: true,
                data: dashboardData
            });
        } catch (error) {
            logger.error('Failed to get compliance dashboard:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve compliance dashboard'
            });
        }
    }
);

// Get scheduled job status
router.get('/jobs/status',
    auditDataAccess('scheduled_jobs', 'read', 'internal'),
    async (req, res) => {
        try {
            const jobStatus = scheduledJobService.getJobStatus();

            res.json({
                success: true,
                data: jobStatus
            });
        } catch (error) {
            logger.error('Failed to get job status:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve job status'
            });
        }
    }
);

// Start a scheduled job
router.post('/jobs/:jobName/start',
    auditComplianceOperation('SCHEDULED_JOB_START', 'warning'),
    async (req, res) => {
        try {
            const { jobName } = req.params;
            
            const success = scheduledJobService.startJob(jobName);
            
            if (success) {
                res.json({
                    success: true,
                    message: `Job ${jobName} started successfully`
                });
            } else {
                res.status(404).json({
                    error: 'Not Found',
                    message: `Job ${jobName} not found`
                });
            }
        } catch (error) {
            logger.error('Failed to start job:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to start job'
            });
        }
    }
);

// Stop a scheduled job
router.post('/jobs/:jobName/stop',
    auditComplianceOperation('SCHEDULED_JOB_STOP', 'warning'),
    async (req, res) => {
        try {
            const { jobName } = req.params;
            
            const success = scheduledJobService.stopJob(jobName);
            
            if (success) {
                res.json({
                    success: true,
                    message: `Job ${jobName} stopped successfully`
                });
            } else {
                res.status(404).json({
                    error: 'Not Found',
                    message: `Job ${jobName} not found`
                });
            }
        } catch (error) {
            logger.error('Failed to stop job:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to stop job'
            });
        }
    }
);

// Manually trigger data retention cleanup
router.post('/jobs/data-retention/trigger',
    auditComplianceOperation('MANUAL_DATA_RETENTION_TRIGGER', 'critical'),
    async (req, res) => {
        try {
            const cleanedCount = await scheduledJobService.triggerDataRetentionCleanup();

            res.json({
                success: true,
                message: 'Data retention cleanup completed',
                recordsProcessed: cleanedCount
            });
        } catch (error) {
            logger.error('Failed to trigger data retention cleanup:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to trigger data retention cleanup'
            });
        }
    }
);

// Manually trigger session cleanup
router.post('/jobs/session-cleanup/trigger',
    auditComplianceOperation('MANUAL_SESSION_CLEANUP_TRIGGER', 'info'),
    async (req, res) => {
        try {
            const cleanedCount = await scheduledJobService.triggerSessionCleanup();

            res.json({
                success: true,
                message: 'Session cleanup completed',
                sessionsRemoved: cleanedCount
            });
        } catch (error) {
            logger.error('Failed to trigger session cleanup:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to trigger session cleanup'
            });
        }
    }
);

// Generate compliance report
router.get('/report',
    auditDataAccess('compliance_report', 'read', 'restricted'),
    async (req, res) => {
        try {
            const { startDate, endDate, format = 'json' } = req.query;
            
            // Get audit logs for the period
            const auditLogs = await auditService.getAuditLogs({
                startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default 30 days
                endDate: endDate ? new Date(endDate) : new Date(),
                limit: 10000
            });
            
            // Get data access logs
            const accessLogs = await auditService.getDataAccessLogs({
                startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate: endDate ? new Date(endDate) : new Date(),
                limit: 10000
            });
            
            // Get compliance events
            const complianceEvents = await auditService.getComplianceEvents({
                startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate: endDate ? new Date(endDate) : new Date(),
                limit: 1000
            });
            
            const report = {
                reportPeriod: {
                    startDate: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                    endDate: endDate || new Date().toISOString()
                },
                summary: {
                    totalAuditEvents: auditLogs.length,
                    totalDataAccess: accessLogs.length,
                    totalComplianceEvents: complianceEvents.length,
                    deniedAccess: accessLogs.filter(log => !log.access_granted).length,
                    criticalEvents: complianceEvents.filter(event => event.severity === 'critical').length,
                    unresolvedEvents: complianceEvents.filter(event => !event.resolved).length
                },
                auditLogs: auditLogs.slice(0, 100), // Limit for response size
                accessLogs: accessLogs.slice(0, 100),
                complianceEvents: complianceEvents.slice(0, 50),
                generatedAt: new Date().toISOString(),
                generatedBy: req.user.username
            };
            
            if (format === 'csv') {
                // Convert to CSV format (simplified)
                const csv = [
                    'Type,Timestamp,User,Action,Details',
                    ...auditLogs.slice(0, 100).map(log => 
                        `Audit,${log.timestamp},${log.username || 'System'},${log.action},"${log.table_name}"`
                    ),
                    ...accessLogs.slice(0, 100).map(log => 
                        `Access,${log.timestamp},${log.username || 'Anonymous'},${log.access_type},"${log.resource_type}"`
                    )
                ].join('\n');
                
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename="compliance-report.csv"');
                res.send(csv);
            } else {
                res.json({
                    success: true,
                    data: report
                });
            }
        } catch (error) {
            logger.error('Failed to generate compliance report:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to generate compliance report'
            });
        }
    }
);

module.exports = router;