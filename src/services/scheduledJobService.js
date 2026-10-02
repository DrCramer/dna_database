const cron = require('node-cron');
const auditService = require('./auditService');
const { logger } = require('../utils/logger');

class ScheduledJobService {
    constructor() {
        this.jobs = new Map();
        this.isInitialized = false;
    }

    // Initialize scheduled jobs
    initialize() {
        if (this.isInitialized) {
            logger.warn('Scheduled jobs already initialized');
            return;
        }

        try {
            // Schedule data retention cleanup - runs daily at 2 AM
            this.scheduleDataRetentionCleanup();
            
            // Schedule session cleanup - runs every hour
            this.scheduleSessionCleanup();
            
            // Schedule audit log cleanup - runs weekly on Sunday at 3 AM
            this.scheduleAuditLogCleanup();

            this.isInitialized = true;
            logger.info('Scheduled jobs initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize scheduled jobs:', error);
            throw error;
        }
    }

    // Schedule data retention policy enforcement
    scheduleDataRetentionCleanup() {
        const job = cron.schedule('0 2 * * *', async () => {
            try {
                logger.info('Starting scheduled data retention cleanup');
                
                const cleanedCount = await auditService.applyRetentionPolicies();
                
                // Log compliance event
                await auditService.logComplianceEvent({
                    eventType: 'SCHEDULED_DATA_RETENTION',
                    severity: 'info',
                    description: `Scheduled data retention cleanup completed: ${cleanedCount} records processed`
                });
                
                logger.info(`Scheduled data retention cleanup completed: ${cleanedCount} records processed`);
            } catch (error) {
                logger.error('Scheduled data retention cleanup failed:', error);
                
                // Log compliance event for failure
                await auditService.logComplianceEvent({
                    eventType: 'SCHEDULED_DATA_RETENTION_FAILED',
                    severity: 'error',
                    description: `Scheduled data retention cleanup failed: ${error.message}`
                }).catch(logError => {
                    logger.error('Failed to log compliance event:', logError);
                });
            }
        }, {
            scheduled: false,
            timezone: 'UTC'
        });

        this.jobs.set('dataRetentionCleanup', job);
        
        if (process.env.NODE_ENV !== 'test') {
            job.start();
            logger.info('Data retention cleanup job scheduled (daily at 2 AM UTC)');
        }
    }

    // Schedule session cleanup
    scheduleSessionCleanup() {
        const job = cron.schedule('0 * * * *', async () => {
            try {
                logger.info('Starting scheduled session cleanup');
                
                const { query } = require('../config/database');
                
                // Clean up expired sessions
                const result = await query(
                    'DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP OR is_active = false'
                );
                
                if (result.rowCount > 0) {
                    logger.info(`Cleaned up ${result.rowCount} expired sessions`);
                    
                    // Log compliance event
                    await auditService.logComplianceEvent({
                        eventType: 'SCHEDULED_SESSION_CLEANUP',
                        severity: 'info',
                        description: `Scheduled session cleanup completed: ${result.rowCount} sessions removed`
                    });
                }
            } catch (error) {
                logger.error('Scheduled session cleanup failed:', error);
                
                // Log compliance event for failure
                await auditService.logComplianceEvent({
                    eventType: 'SCHEDULED_SESSION_CLEANUP_FAILED',
                    severity: 'error',
                    description: `Scheduled session cleanup failed: ${error.message}`
                }).catch(logError => {
                    logger.error('Failed to log compliance event:', logError);
                });
            }
        }, {
            scheduled: false,
            timezone: 'UTC'
        });

        this.jobs.set('sessionCleanup', job);
        
        if (process.env.NODE_ENV !== 'test') {
            job.start();
            logger.info('Session cleanup job scheduled (hourly)');
        }
    }

    // Schedule audit log cleanup
    scheduleAuditLogCleanup() {
        const job = cron.schedule('0 3 * * 0', async () => {
            try {
                logger.info('Starting scheduled audit log cleanup');
                
                const { query } = require('../config/database');
                
                // Get audit log retention period
                const retentionResult = await query(
                    `SELECT retention_period_days FROM data_retention_policies 
                     WHERE table_name = 'audit_logs' AND is_active = true`
                );
                
                if (retentionResult.rows.length === 0) {
                    logger.warn('No retention policy found for audit_logs');
                    return;
                }
                
                const retentionDays = retentionResult.rows[0].retention_period_days;
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
                
                // Archive old audit logs (soft delete by moving to archive table)
                const archiveResult = await query(
                    `INSERT INTO audit_logs_archive 
                     SELECT * FROM audit_logs 
                     WHERE timestamp < $1`,
                    [cutoffDate]
                );
                
                // Delete archived logs from main table
                const deleteResult = await query(
                    'DELETE FROM audit_logs WHERE timestamp < $1',
                    [cutoffDate]
                );
                
                if (deleteResult.rowCount > 0) {
                    logger.info(`Archived ${deleteResult.rowCount} old audit log entries`);
                    
                    // Log compliance event
                    await auditService.logComplianceEvent({
                        eventType: 'SCHEDULED_AUDIT_LOG_CLEANUP',
                        severity: 'info',
                        description: `Scheduled audit log cleanup completed: ${deleteResult.rowCount} entries archived`
                    });
                }
            } catch (error) {
                // If archive table doesn't exist, just log the error
                if (error.message.includes('audit_logs_archive')) {
                    logger.warn('Audit logs archive table not found, skipping archival');
                } else {
                    logger.error('Scheduled audit log cleanup failed:', error);
                    
                    // Log compliance event for failure
                    await auditService.logComplianceEvent({
                        eventType: 'SCHEDULED_AUDIT_LOG_CLEANUP_FAILED',
                        severity: 'error',
                        description: `Scheduled audit log cleanup failed: ${error.message}`
                    }).catch(logError => {
                        logger.error('Failed to log compliance event:', logError);
                    });
                }
            }
        }, {
            scheduled: false,
            timezone: 'UTC'
        });

        this.jobs.set('auditLogCleanup', job);
        
        if (process.env.NODE_ENV !== 'test') {
            job.start();
            logger.info('Audit log cleanup job scheduled (weekly on Sunday at 3 AM UTC)');
        }
    }
    // Start a specific job
    startJob(jobName) {
        const job = this.jobs.get(jobName);
        if (job) {
            job.start();
            logger.info(`Started job: ${jobName}`);
            return true;
        } else {
            logger.error(`Job not found: ${jobName}`);
            return false;
        }
    }

    // Stop a specific job
    stopJob(jobName) {
        const job = this.jobs.get(jobName);
        if (job) {
            job.stop();
            logger.info(`Stopped job: ${jobName}`);
            return true;
        } else {
            logger.error(`Job not found: ${jobName}`);
            return false;
        }
    }

    // Stop all jobs
    stopAllJobs() {
        for (const [jobName, job] of this.jobs.entries()) {
            job.stop();
            logger.info(`Stopped job: ${jobName}`);
        }
        logger.info('All scheduled jobs stopped');
    }

    // Get job status
    getJobStatus() {
        const status = {};
        for (const [jobName, job] of this.jobs.entries()) {
            status[jobName] = {
                running: job.running || false,
                scheduled: job.scheduled || false
            };
        }
        return status;
    }

    // Manually trigger data retention cleanup
    async triggerDataRetentionCleanup() {
        try {
            logger.info('Manually triggering data retention cleanup');
            
            const cleanedCount = await auditService.applyRetentionPolicies();
            
            // Log compliance event
            await auditService.logComplianceEvent({
                eventType: 'MANUAL_DATA_RETENTION_TRIGGER',
                severity: 'warning',
                description: `Manual data retention cleanup triggered: ${cleanedCount} records processed`
            });
            
            logger.info(`Manual data retention cleanup completed: ${cleanedCount} records processed`);
            return cleanedCount;
        } catch (error) {
            logger.error('Manual data retention cleanup failed:', error);
            throw error;
        }
    }

    // Manually trigger session cleanup
    async triggerSessionCleanup() {
        try {
            logger.info('Manually triggering session cleanup');
            
            const { query } = require('../config/database');
            
            // Clean up expired sessions
            const result = await query(
                'DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP OR is_active = false'
            );
            
            logger.info(`Manual session cleanup completed: ${result.rowCount} sessions removed`);
            
            // Log compliance event
            await auditService.logComplianceEvent({
                eventType: 'MANUAL_SESSION_CLEANUP_TRIGGER',
                severity: 'info',
                description: `Manual session cleanup triggered: ${result.rowCount} sessions removed`
            });
            
            return result.rowCount;
        } catch (error) {
            logger.error('Manual session cleanup failed:', error);
            throw error;
        }
    }

    // Get compliance monitoring dashboard data
    async getComplianceMonitoringData() {
        try {
            const { query } = require('../config/database');
            
            // Get recent compliance events
            const recentEvents = await auditService.getComplianceEvents({
                limit: 50,
                offset: 0
            });
            
            // Get unresolved compliance events
            const unresolvedEvents = await auditService.getComplianceEvents({
                resolved: false,
                limit: 100,
                offset: 0
            });
            
            // Get data retention policy status
            const retentionPolicies = await auditService.getRetentionPolicies();
            
            // Get audit log statistics
            const auditStats = await query(`
                SELECT 
                    COUNT(*) as total_logs,
                    COUNT(CASE WHEN timestamp > CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 1 END) as last_24h,
                    COUNT(CASE WHEN timestamp > CURRENT_TIMESTAMP - INTERVAL '7 days' THEN 1 END) as last_7d,
                    COUNT(CASE WHEN compliance_level = 'critical' THEN 1 END) as critical_events
                FROM audit_logs
            `);
            
            // Get data access statistics
            const accessStats = await query(`
                SELECT 
                    COUNT(*) as total_access,
                    COUNT(CASE WHEN access_granted = false THEN 1 END) as denied_access,
                    COUNT(CASE WHEN timestamp > CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 1 END) as last_24h_access
                FROM data_access_log
            `);
            
            return {
                recentEvents,
                unresolvedEvents: unresolvedEvents.length,
                retentionPolicies,
                auditStatistics: auditStats.rows[0],
                accessStatistics: accessStats.rows[0],
                jobStatus: this.getJobStatus(),
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Failed to get compliance monitoring data:', error);
            throw error;
        }
    }
}

module.exports = new ScheduledJobService();