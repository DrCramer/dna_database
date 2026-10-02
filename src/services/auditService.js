const { query } = require('../config/database');
const { logger } = require('../utils/logger');

class AuditService {
    constructor() {
        this.complianceLevels = {
            STANDARD: 'standard',
            HIGH: 'high',
            CRITICAL: 'critical'
        };
        
        this.accessTypes = {
            READ: 'read',
            write: 'write',
            delete: 'delete',
            export: 'export'
        };
        
        this.dataClassifications = {
            PUBLIC: 'public',
            INTERNAL: 'internal',
            SENSITIVE: 'sensitive',
            RESTRICTED: 'restricted'
        };

        // Multi-user operation types
        this.operationTypes = {
            ORGANIZATION_CREATE: 'organization_create',
            ORGANIZATION_UPDATE: 'organization_update',
            ORGANIZATION_DELETE: 'organization_delete',
            DEPARTMENT_CREATE: 'department_create',
            DEPARTMENT_UPDATE: 'department_update',
            DEPARTMENT_DELETE: 'department_delete',
            EXPERT_GROUP_CREATE: 'expert_group_create',
            EXPERT_GROUP_UPDATE: 'expert_group_update',
            EXPERT_GROUP_DELETE: 'expert_group_delete',
            EXPERT_GROUP_MEMBER_ADD: 'expert_group_member_add',
            EXPERT_GROUP_MEMBER_REMOVE: 'expert_group_member_remove',
            TASK_CREATE: 'task_create',
            TASK_UPDATE: 'task_update',
            TASK_ASSIGN: 'task_assign',
            TASK_STATUS_CHANGE: 'task_status_change',
            TASK_APPROVE: 'task_approve',
            TASK_COMMENT_ADD: 'task_comment_add',
            TASK_RESULT_ADD: 'task_result_add',
            MASTER_ARRAY_CREATE: 'master_array_create',
            MASTER_ARRAY_UPDATE: 'master_array_update',
            MASTER_ARRAY_PROFILE_ADD: 'master_array_profile_add',
            MASTER_ARRAY_PROFILE_REMOVE: 'master_array_profile_remove',
            USER_ROLE_CHANGE: 'user_role_change',
            USER_DEPARTMENT_CHANGE: 'user_department_change',
            PERMISSION_GRANT: 'permission_grant',
            PERMISSION_REVOKE: 'permission_revoke'
        };
    }

    // Log audit events for data modifications
    async logAuditEvent(params) {
        try {
            const {
                userId,
                tableName,
                recordId,
                action,
                oldValues = null,
                newValues = null,
                ipAddress = null,
                userAgent = null,
                sessionId = null,
                complianceLevel = this.complianceLevels.STANDARD,
                departmentId = null,
                organizationId = null
            } = params;

            const result = await query(
                `SELECT log_audit_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as audit_id`,
                [
                    userId,
                    tableName,
                    recordId,
                    action,
                    oldValues ? JSON.stringify(oldValues) : null,
                    newValues ? JSON.stringify(newValues) : null,
                    ipAddress,
                    userAgent,
                    sessionId,
                    complianceLevel
                ]
            );

            // Store additional organizational context if available
            if (departmentId || organizationId) {
                await this.logOrganizationalContext(result.rows[0].audit_id, departmentId, organizationId);
            }

            logger.info(`Audit event logged: ${action} on ${tableName}`, {
                auditId: result.rows[0].audit_id,
                userId,
                tableName,
                recordId,
                departmentId,
                organizationId
            });

            return result.rows[0].audit_id;
        } catch (error) {
            logger.error('Failed to log audit event:', error);
            throw error;
        }
    }

    // Log organizational operations
    async logOrganizationalOperation(params) {
        try {
            const {
                userId,
                operationType,
                resourceType,
                resourceId,
                resourceName = null,
                departmentId = null,
                organizationId = null,
                details = {},
                ipAddress = null,
                userAgent = null
            } = params;

            const result = await query(
                `INSERT INTO operation_history 
                 (user_id, operation_type, resource_type, resource_id, resource_name, 
                  department_id, organization_id, operation_details, ip_address, user_agent, timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
                 RETURNING id`,
                [
                    userId,
                    operationType,
                    resourceType,
                    resourceId,
                    resourceName,
                    departmentId,
                    organizationId,
                    JSON.stringify(details),
                    ipAddress,
                    userAgent
                ]
            );

            logger.info(`Organizational operation logged: ${operationType}`, {
                operationId: result.rows[0].id,
                userId,
                resourceType,
                resourceId,
                departmentId,
                organizationId
            });

            return result.rows[0].id;
        } catch (error) {
            logger.error('Failed to log organizational operation:', error);
            throw error;
        }
    }

    // Log task management operations
    async logTaskOperation(params) {
        try {
            const {
                userId,
                taskId,
                operationType,
                oldStatus = null,
                newStatus = null,
                assignedToUser = null,
                assignedToGroup = null,
                details = {},
                departmentId = null
            } = params;

            const operationDetails = {
                ...details,
                oldStatus,
                newStatus,
                assignedToUser,
                assignedToGroup
            };

            return await this.logOrganizationalOperation({
                userId,
                operationType,
                resourceType: 'task',
                resourceId: taskId,
                departmentId,
                details: operationDetails
            });
        } catch (error) {
            logger.error('Failed to log task operation:', error);
            throw error;
        }
    }

    // Log expert group operations
    async logExpertGroupOperation(params) {
        try {
            const {
                userId,
                groupId,
                operationType,
                memberUserId = null,
                details = {},
                departmentId = null
            } = params;

            const operationDetails = {
                ...details,
                memberUserId
            };

            return await this.logOrganizationalOperation({
                userId,
                operationType,
                resourceType: 'expert_group',
                resourceId: groupId,
                departmentId,
                details: operationDetails
            });
        } catch (error) {
            logger.error('Failed to log expert group operation:', error);
            throw error;
        }
    }

    // Log master array operations
    async logMasterArrayOperation(params) {
        try {
            const {
                userId,
                masterArrayId,
                operationType,
                profileId = null,
                profileCount = null,
                details = {},
                departmentId = null
            } = params;

            const operationDetails = {
                ...details,
                profileId,
                profileCount
            };

            return await this.logOrganizationalOperation({
                userId,
                operationType,
                resourceType: 'master_array',
                resourceId: masterArrayId,
                departmentId,
                details: operationDetails
            });
        } catch (error) {
            logger.error('Failed to log master array operation:', error);
            throw error;
        }
    }

    // Store organizational context for audit events
    async logOrganizationalContext(auditId, departmentId, organizationId) {
        try {
            if (!auditId) return;

            await query(
                `UPDATE audit_logs 
                 SET operation_details = COALESCE(operation_details, '{}')::jsonb || 
                     jsonb_build_object('department_id', $2, 'organization_id', $3)
                 WHERE id = $1`,
                [auditId, departmentId, organizationId]
            );
        } catch (error) {
            logger.error('Failed to log organizational context:', error);
            // Don't throw - this is supplementary information
        }
    }

    // Log data access events
    async logDataAccess(params) {
        try {
            const {
                userId,
                resourceType,
                resourceId,
                accessType,
                accessGranted,
                denialReason = null,
                ipAddress = null,
                userAgent = null,
                sessionId = null,
                dataClassification = this.dataClassifications.SENSITIVE
            } = params;

            const result = await query(
                `SELECT log_data_access($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as access_log_id`,
                [
                    userId,
                    resourceType,
                    resourceId,
                    accessType,
                    accessGranted,
                    denialReason,
                    ipAddress,
                    userAgent,
                    sessionId,
                    dataClassification
                ]
            );

            logger.info(`Data access logged: ${accessType} on ${resourceType}`, {
                accessLogId: result.rows[0].access_log_id,
                userId,
                resourceType,
                resourceId,
                accessGranted
            });

            return result.rows[0].access_log_id;
        } catch (error) {
            logger.error('Failed to log data access:', error);
            throw error;
        }
    }

    // Log compliance events
    async logComplianceEvent(params) {
        try {
            const {
                eventType,
                severity = 'info',
                description,
                affectedTable = null,
                affectedRecordId = null,
                userId = null
            } = params;

            const result = await query(
                `SELECT log_compliance_event($1, $2, $3, $4, $5, $6) as event_id`,
                [eventType, severity, description, affectedTable, affectedRecordId, userId]
            );

            logger.info(`Compliance event logged: ${eventType}`, {
                eventId: result.rows[0].event_id,
                severity,
                description
            });

            return result.rows[0].event_id;
        } catch (error) {
            logger.error('Failed to log compliance event:', error);
            throw error;
        }
    }

    // Secure data deletion with audit trail
    async secureDelete(params) {
        try {
            const {
                tableName,
                recordId,
                deletionReason,
                deletedBy,
                deletionMethod = 'soft'
            } = params;

            const result = await query(
                `SELECT secure_delete_record($1, $2, $3, $4, $5) as success`,
                [tableName, recordId, deletionReason, deletedBy, deletionMethod]
            );

            const success = result.rows[0].success;

            logger.info(`Secure deletion ${success ? 'completed' : 'failed'}`, {
                tableName,
                recordId,
                deletionMethod,
                deletedBy
            });

            return success;
        } catch (error) {
            logger.error('Secure deletion failed:', error);
            throw error;
        }
    }
    // Get audit logs with filtering
    async getAuditLogs(filters = {}) {
        try {
            const {
                userId = null,
                tableName = null,
                action = null,
                startDate = null,
                endDate = null,
                complianceLevel = null,
                limit = 100,
                offset = 0
            } = filters;

            let whereConditions = [];
            let params = [];
            let paramIndex = 1;

            if (userId) {
                whereConditions.push(`user_id = $${paramIndex++}`);
                params.push(userId);
            }

            if (tableName) {
                whereConditions.push(`table_name = $${paramIndex++}`);
                params.push(tableName);
            }

            if (action) {
                whereConditions.push(`action = $${paramIndex++}`);
                params.push(action);
            }

            if (startDate) {
                whereConditions.push(`timestamp >= $${paramIndex++}`);
                params.push(startDate);
            }

            if (endDate) {
                whereConditions.push(`timestamp <= $${paramIndex++}`);
                params.push(endDate);
            }

            if (complianceLevel) {
                whereConditions.push(`compliance_level = $${paramIndex++}`);
                params.push(complianceLevel);
            }

            const whereClause = whereConditions.length > 0 
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            const queryText = `
                SELECT 
                    al.*,
                    u.username,
                    u.email
                FROM audit_logs al
                LEFT JOIN users u ON al.user_id = u.id
                ${whereClause}
                ORDER BY al.timestamp DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            params.push(limit, offset);

            const result = await query(queryText, params);

            return result.rows;
        } catch (error) {
            logger.error('Failed to get audit logs:', error);
            throw error;
        }
    }

    // Get data access logs
    async getDataAccessLogs(filters = {}) {
        try {
            const {
                userId = null,
                resourceType = null,
                accessType = null,
                accessGranted = null,
                startDate = null,
                endDate = null,
                limit = 100,
                offset = 0
            } = filters;

            let whereConditions = [];
            let params = [];
            let paramIndex = 1;

            if (userId) {
                whereConditions.push(`user_id = $${paramIndex++}`);
                params.push(userId);
            }

            if (resourceType) {
                whereConditions.push(`resource_type = $${paramIndex++}`);
                params.push(resourceType);
            }

            if (accessType) {
                whereConditions.push(`access_type = $${paramIndex++}`);
                params.push(accessType);
            }

            if (accessGranted !== null) {
                whereConditions.push(`access_granted = $${paramIndex++}`);
                params.push(accessGranted);
            }

            if (startDate) {
                whereConditions.push(`timestamp >= $${paramIndex++}`);
                params.push(startDate);
            }

            if (endDate) {
                whereConditions.push(`timestamp <= $${paramIndex++}`);
                params.push(endDate);
            }

            const whereClause = whereConditions.length > 0 
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            const queryText = `
                SELECT 
                    dal.*,
                    u.username,
                    u.email
                FROM data_access_log dal
                LEFT JOIN users u ON dal.user_id = u.id
                ${whereClause}
                ORDER BY dal.timestamp DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            params.push(limit, offset);

            const result = await query(queryText, params);

            return result.rows;
        } catch (error) {
            logger.error('Failed to get data access logs:', error);
            throw error;
        }
    }

    // Get compliance events
    async getComplianceEvents(filters = {}) {
        try {
            const {
                eventType = null,
                severity = null,
                resolved = null,
                startDate = null,
                endDate = null,
                limit = 100,
                offset = 0
            } = filters;

            let whereConditions = [];
            let params = [];
            let paramIndex = 1;

            if (eventType) {
                whereConditions.push(`event_type = $${paramIndex++}`);
                params.push(eventType);
            }

            if (severity) {
                whereConditions.push(`severity = $${paramIndex++}`);
                params.push(severity);
            }

            if (resolved !== null) {
                whereConditions.push(`resolved = $${paramIndex++}`);
                params.push(resolved);
            }

            if (startDate) {
                whereConditions.push(`timestamp >= $${paramIndex++}`);
                params.push(startDate);
            }

            if (endDate) {
                whereConditions.push(`timestamp <= $${paramIndex++}`);
                params.push(endDate);
            }

            const whereClause = whereConditions.length > 0 
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            const queryText = `
                SELECT 
                    ce.*,
                    u1.username as user_username,
                    u2.username as resolved_by_username
                FROM compliance_events ce
                LEFT JOIN users u1 ON ce.user_id = u1.id
                LEFT JOIN users u2 ON ce.resolved_by = u2.id
                ${whereClause}
                ORDER BY ce.timestamp DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            params.push(limit, offset);

            const result = await query(queryText, params);

            return result.rows;
        } catch (error) {
            logger.error('Failed to get compliance events:', error);
            throw error;
        }
    }

    // Resolve compliance event
    async resolveComplianceEvent(eventId, resolvedBy, resolutionNotes) {
        try {
            await query(
                `UPDATE compliance_events 
                 SET resolved = true, resolved_by = $1, resolved_at = CURRENT_TIMESTAMP, resolution_notes = $2
                 WHERE id = $3`,
                [resolvedBy, resolutionNotes, eventId]
            );

            logger.info(`Compliance event resolved: ${eventId}`, {
                resolvedBy,
                resolutionNotes
            });

            return true;
        } catch (error) {
            logger.error('Failed to resolve compliance event:', error);
            throw error;
        }
    }

    // Get data retention policies
    async getRetentionPolicies() {
        try {
            const result = await query(
                `SELECT * FROM data_retention_policies WHERE is_active = true ORDER BY table_name`
            );

            return result.rows;
        } catch (error) {
            logger.error('Failed to get retention policies:', error);
            throw error;
        }
    }

    // Apply data retention policies (cleanup old data)
    async applyRetentionPolicies() {
        try {
            const policies = await this.getRetentionPolicies();
            let totalCleaned = 0;

            for (const policy of policies) {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - policy.retention_period_days);

                let cleanedCount = 0;

                if (policy.deletion_method === 'hard') {
                    // Hard delete old records
                    const result = await query(
                        `DELETE FROM ${policy.table_name} WHERE created_at < $1`,
                        [cutoffDate]
                    );
                    cleanedCount = result.rowCount;
                } else if (policy.deletion_method === 'soft') {
                    // Soft delete old records (if table supports it)
                    try {
                        const result = await query(
                            `UPDATE ${policy.table_name} SET is_active = false WHERE created_at < $1 AND is_active = true`,
                            [cutoffDate]
                        );
                        cleanedCount = result.rowCount;
                    } catch (error) {
                        // Table might not have is_active column
                        logger.warn(`Soft delete not supported for ${policy.table_name}:`, error.message);
                    }
                }

                if (cleanedCount > 0) {
                    logger.info(`Retention policy applied to ${policy.table_name}: ${cleanedCount} records processed`);
                    
                    // Log compliance event
                    await this.logComplianceEvent({
                        eventType: 'DATA_RETENTION_APPLIED',
                        severity: 'info',
                        description: `Applied retention policy to ${policy.table_name}: ${cleanedCount} records processed`,
                        affectedTable: policy.table_name
                    });
                }

                totalCleaned += cleanedCount;
            }

            logger.info(`Data retention policies applied: ${totalCleaned} total records processed`);
            return totalCleaned;
        } catch (error) {
            logger.error('Failed to apply retention policies:', error);
            throw error;
        }
    }

    // Get organizational operation history with department filtering
    async getOrganizationalOperations(filters = {}) {
        try {
            const {
                userId = null,
                operationType = null,
                resourceType = null,
                departmentId = null,
                organizationId = null,
                startDate = null,
                endDate = null,
                limit = 100,
                offset = 0
            } = filters;

            let whereConditions = [];
            let params = [];
            let paramIndex = 1;

            if (userId) {
                whereConditions.push(`oh.user_id = $${paramIndex++}`);
                params.push(userId);
            }

            if (operationType) {
                whereConditions.push(`oh.operation_type = $${paramIndex++}`);
                params.push(operationType);
            }

            if (resourceType) {
                whereConditions.push(`oh.resource_type = $${paramIndex++}`);
                params.push(resourceType);
            }

            if (departmentId) {
                whereConditions.push(`oh.department_id = $${paramIndex++}`);
                params.push(departmentId);
            }

            if (organizationId) {
                whereConditions.push(`oh.organization_id = $${paramIndex++}`);
                params.push(organizationId);
            }

            if (startDate) {
                whereConditions.push(`oh.timestamp >= $${paramIndex++}`);
                params.push(startDate);
            }

            if (endDate) {
                whereConditions.push(`oh.timestamp <= $${paramIndex++}`);
                params.push(endDate);
            }

            const whereClause = whereConditions.length > 0 
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            const queryText = `
                SELECT 
                    oh.*,
                    u.username,
                    u.email,
                    d.name as department_name,
                    o.name as organization_name
                FROM operation_history oh
                LEFT JOIN users u ON oh.user_id = u.id
                LEFT JOIN departments d ON oh.department_id = d.id
                LEFT JOIN organizations o ON oh.organization_id = o.id
                ${whereClause}
                ORDER BY oh.timestamp DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            params.push(limit, offset);

            const result = await query(queryText, params);

            return result.rows;
        } catch (error) {
            logger.error('Failed to get organizational operations:', error);
            throw error;
        }
    }

    // Get task operation history
    async getTaskOperations(filters = {}) {
        try {
            const {
                taskId = null,
                userId = null,
                departmentId = null,
                operationType = null,
                startDate = null,
                endDate = null,
                limit = 100,
                offset = 0
            } = filters;

            const taskFilters = {
                ...filters,
                resourceType: 'task'
            };

            if (taskId) {
                taskFilters.resourceId = taskId;
            }

            return await this.getOrganizationalOperations(taskFilters);
        } catch (error) {
            logger.error('Failed to get task operations:', error);
            throw error;
        }
    }

    // Get department-specific audit summary
    async getDepartmentAuditSummary(departmentId, startDate = null, endDate = null) {
        try {
            let dateFilter = '';
            let params = [departmentId];
            let paramIndex = 2;

            if (startDate) {
                dateFilter += ` AND oh.timestamp >= $${paramIndex++}`;
                params.push(startDate);
            }

            if (endDate) {
                dateFilter += ` AND oh.timestamp <= $${paramIndex++}`;
                params.push(endDate);
            }

            const queryText = `
                SELECT 
                    oh.operation_type,
                    oh.resource_type,
                    COUNT(*) as operation_count,
                    COUNT(DISTINCT oh.user_id) as unique_users,
                    MIN(oh.timestamp) as first_operation,
                    MAX(oh.timestamp) as last_operation
                FROM operation_history oh
                WHERE oh.department_id = $1 ${dateFilter}
                GROUP BY oh.operation_type, oh.resource_type
                ORDER BY operation_count DESC
            `;

            const result = await query(queryText, params);

            return result.rows;
        } catch (error) {
            logger.error('Failed to get department audit summary:', error);
            throw error;
        }
    }

    // Get user activity summary for department
    async getDepartmentUserActivity(departmentId, startDate = null, endDate = null) {
        try {
            let dateFilter = '';
            let params = [departmentId];
            let paramIndex = 2;

            if (startDate) {
                dateFilter += ` AND oh.timestamp >= $${paramIndex++}`;
                params.push(startDate);
            }

            if (endDate) {
                dateFilter += ` AND oh.timestamp <= $${paramIndex++}`;
                params.push(endDate);
            }

            const queryText = `
                SELECT 
                    u.id,
                    u.username,
                    u.email,
                    u.role,
                    COUNT(oh.id) as total_operations,
                    COUNT(DISTINCT oh.operation_type) as operation_types,
                    MIN(oh.timestamp) as first_activity,
                    MAX(oh.timestamp) as last_activity
                FROM users u
                LEFT JOIN operation_history oh ON u.id = oh.user_id AND oh.department_id = $1 ${dateFilter}
                WHERE u.department_id = $1 AND u.is_active = true
                GROUP BY u.id, u.username, u.email, u.role
                ORDER BY total_operations DESC
            `;

            const result = await query(queryText, params);

            return result.rows;
        } catch (error) {
            logger.error('Failed to get department user activity:', error);
            throw error;
        }
    }

    // Enhanced getAuditLogs with department filtering
    async getAuditLogsWithDepartmentFilter(filters = {}) {
        try {
            const {
                userId = null,
                tableName = null,
                action = null,
                startDate = null,
                endDate = null,
                complianceLevel = null,
                departmentId = null,
                organizationId = null,
                limit = 100,
                offset = 0
            } = filters;

            let whereConditions = [];
            let params = [];
            let paramIndex = 1;

            if (userId) {
                whereConditions.push(`al.user_id = $${paramIndex++}`);
                params.push(userId);
            }

            if (tableName) {
                whereConditions.push(`al.table_name = $${paramIndex++}`);
                params.push(tableName);
            }

            if (action) {
                whereConditions.push(`al.action = $${paramIndex++}`);
                params.push(action);
            }

            if (startDate) {
                whereConditions.push(`al.timestamp >= $${paramIndex++}`);
                params.push(startDate);
            }

            if (endDate) {
                whereConditions.push(`al.timestamp <= $${paramIndex++}`);
                params.push(endDate);
            }

            if (complianceLevel) {
                whereConditions.push(`al.compliance_level = $${paramIndex++}`);
                params.push(complianceLevel);
            }

            // Department filtering for multi-user audit
            if (departmentId) {
                whereConditions.push(`(
                    u.department_id = $${paramIndex++} OR 
                    (al.operation_details->>'department_id')::integer = $${paramIndex++}
                )`);
                params.push(departmentId, departmentId);
            }

            // Organization filtering
            if (organizationId) {
                whereConditions.push(`(
                    u.organization_id = $${paramIndex++} OR 
                    (al.operation_details->>'organization_id')::integer = $${paramIndex++}
                )`);
                params.push(organizationId, organizationId);
            }

            const whereClause = whereConditions.length > 0 
                ? `WHERE ${whereConditions.join(' AND ')}`
                : '';

            const queryText = `
                SELECT 
                    al.*,
                    u.username,
                    u.email,
                    u.department_id,
                    u.organization_id,
                    d.name as department_name,
                    o.name as organization_name
                FROM audit_logs al
                LEFT JOIN users u ON al.user_id = u.id
                LEFT JOIN departments d ON u.department_id = d.id
                LEFT JOIN organizations o ON u.organization_id = o.id
                ${whereClause}
                ORDER BY al.timestamp DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            params.push(limit, offset);

            const result = await query(queryText, params);

            return result.rows;
        } catch (error) {
            logger.error('Failed to get audit logs with department filter:', error);
            throw error;
        }
    }
}

module.exports = new AuditService();