const PermissionService = require('../services/permissionService');
const auditService = require('../services/auditService');
const { logger } = require('../utils/logger');
const { query } = require('../config/database');

/**
 * Comprehensive Access Control Middleware
 * Provides department boundary validation, role-based authorization,
 * and master array access control for multi-user system
 */

class AccessControlMiddleware {
    // Department boundary validation middleware
    static validateDepartmentBoundary() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userDepartmentId = req.user?.department_id;

                if (!userId || !userDepartmentId) {
                    return res.status(401).json({ 
                        error: 'Authentication required',
                        message: 'User and department context required'
                    });
                }

                // Extract department context from request
                const targetDepartmentId = req.params.departmentId || 
                                         req.body.department_id || 
                                         req.query.department_id;

                // System administrators can access any department
                if (req.user.role === 'system_administrator') {
                    return next();
                }

                // For other users, validate department access
                if (targetDepartmentId && targetDepartmentId !== userDepartmentId) {
                    // Log unauthorized access attempt
                    await auditService.logDataAccess({
                        userId,
                        resourceType: 'department',
                        resourceId: targetDepartmentId,
                        accessType: 'read',
                        accessGranted: false,
                        denialReason: 'Department boundary violation',
                        ipAddress: req.ip,
                        userAgent: req.get('User-Agent')
                    });

                    logger.warn(`Department boundary violation: User ${userId} from department ${userDepartmentId} attempted to access department ${targetDepartmentId}`);
                    
                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'Access denied: Department boundary violation'
                    });
                }

                next();
            } catch (error) {
                logger.error('Error in department boundary validation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Resource ownership validation
    static validateResourceOwnership(resourceType, resourceIdParam = 'id') {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userDepartmentId = req.user?.department_id;
                const resourceId = req.params[resourceIdParam] || req.body.id;

                if (!userId || !resourceId) {
                    return res.status(400).json({ 
                        error: 'Bad Request',
                        message: 'User ID and resource ID required'
                    });
                }

                // System administrators can access any resource
                if (req.user.role === 'system_administrator') {
                    return next();
                }

                // Validate resource access based on type
                let hasAccess = false;
                let resourceDepartmentId = null;

                switch (resourceType) {
                    case 'profile':
                        const profileResult = await query(
                            `SELECT dp.user_id, u.department_id 
                             FROM dna_profiles dp 
                             JOIN users u ON dp.user_id = u.id 
                             WHERE dp.id = $1 AND dp.is_active = true`,
                            [resourceId]
                        );
                        
                        if (profileResult.rows.length > 0) {
                            resourceDepartmentId = profileResult.rows[0].department_id;
                            hasAccess = resourceDepartmentId === userDepartmentId ||
                                       profileResult.rows[0].user_id === userId;
                        }
                        break;

                    case 'task':
                        const taskResult = await query(
                            `SELECT department_id, created_by, assigned_to_user, assigned_to_group
                             FROM tasks 
                             WHERE id = $1 AND is_active = true`,
                            [resourceId]
                        );
                        
                        if (taskResult.rows.length > 0) {
                            const task = taskResult.rows[0];
                            resourceDepartmentId = task.department_id;
                            
                            // Check if user has access to this task
                            hasAccess = task.department_id === userDepartmentId &&
                                       (task.created_by === userId || 
                                        task.assigned_to_user === userId ||
                                        await this.isUserInExpertGroup(userId, task.assigned_to_group));
                        }
                        break;

                    case 'master_array':
                        const masterArrayResult = await query(
                            `SELECT department_id FROM master_arrays 
                             WHERE id = $1 AND is_active = true`,
                            [resourceId]
                        );
                        
                        if (masterArrayResult.rows.length > 0) {
                            resourceDepartmentId = masterArrayResult.rows[0].department_id;
                            hasAccess = resourceDepartmentId === userDepartmentId;
                        }
                        break;

                    case 'expert_group':
                        const groupResult = await query(
                            `SELECT department_id FROM expert_groups 
                             WHERE id = $1 AND is_active = true`,
                            [resourceId]
                        );
                        
                        if (groupResult.rows.length > 0) {
                            resourceDepartmentId = groupResult.rows[0].department_id;
                            hasAccess = resourceDepartmentId === userDepartmentId;
                        }
                        break;

                    default:
                        logger.warn(`Unknown resource type for ownership validation: ${resourceType}`);
                        return res.status(400).json({
                            error: 'Bad Request',
                            message: 'Unknown resource type'
                        });
                }

                if (!hasAccess) {
                    // Log unauthorized access attempt
                    await auditService.logDataAccess({
                        userId,
                        resourceType,
                        resourceId,
                        accessType: 'read',
                        accessGranted: false,
                        denialReason: 'Resource ownership violation',
                        ipAddress: req.ip,
                        userAgent: req.get('User-Agent')
                    });

                    logger.warn(`Resource access denied: User ${userId} attempted to access ${resourceType}:${resourceId}`);
                    
                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'Access denied: Resource not accessible'
                    });
                }

                // Log successful access
                await auditService.logDataAccess({
                    userId,
                    resourceType,
                    resourceId,
                    accessType: 'read',
                    accessGranted: true,
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent')
                });

                next();
            } catch (error) {
                logger.error('Error in resource ownership validation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Role-based operation authorization
    static requireRolePermission(operation, resourceType) {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userRole = req.user?.role;

                if (!userId || !userRole) {
                    return res.status(401).json({ 
                        error: 'Authentication required',
                        message: 'User role context required'
                    });
                }

                const resourceId = req.params.id || req.body.id || null;
                const hasPermission = await PermissionService.checkUserPermission(
                    userId, 
                    operation, 
                    resourceType, 
                    resourceId
                );

                if (!hasPermission) {
                    // Log permission denial
                    await auditService.logDataAccess({
                        userId,
                        resourceType,
                        resourceId,
                        accessType: operation,
                        accessGranted: false,
                        denialReason: `Insufficient role permissions: ${userRole}`,
                        ipAddress: req.ip,
                        userAgent: req.get('User-Agent')
                    });

                    logger.warn(`Permission denied: User ${userId} with role ${userRole} attempted ${operation} on ${resourceType}:${resourceId}`);
                    
                    return res.status(403).json({
                        error: 'Forbidden',
                        message: `Insufficient permissions for ${operation.replace('_', ' ')}`
                    });
                }

                next();
            } catch (error) {
                logger.error('Error in role permission check:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Master array access control
    static validateMasterArrayAccess() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userDepartmentId = req.user?.department_id;
                const masterArrayId = req.params.masterArrayId || 
                                    req.body.master_array_id || 
                                    req.params.id;

                if (!userId || !masterArrayId) {
                    return res.status(400).json({ 
                        error: 'Bad Request',
                        message: 'User ID and master array ID required'
                    });
                }

                // System administrators can access any master array
                if (req.user.role === 'system_administrator') {
                    return next();
                }

                // Check if master array belongs to user's department
                const result = await query(
                    `SELECT department_id, name FROM master_arrays 
                     WHERE id = $1 AND is_active = true`,
                    [masterArrayId]
                );

                if (result.rows.length === 0) {
                    return res.status(404).json({
                        error: 'Not Found',
                        message: 'Master array not found'
                    });
                }

                const masterArray = result.rows[0];

                if (masterArray.department_id !== userDepartmentId) {
                    // Log unauthorized access attempt
                    await auditService.logDataAccess({
                        userId,
                        resourceType: 'master_array',
                        resourceId: masterArrayId,
                        accessType: 'read',
                        accessGranted: false,
                        denialReason: 'Master array department mismatch',
                        ipAddress: req.ip,
                        userAgent: req.get('User-Agent')
                    });

                    logger.warn(`Master array access denied: User ${userId} from department ${userDepartmentId} attempted to access master array ${masterArrayId} from department ${masterArray.department_id}`);
                    
                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'Access denied: Master array not accessible'
                    });
                }

                // Store master array info in request for later use
                req.masterArray = masterArray;

                next();
            } catch (error) {
                logger.error('Error in master array access validation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Task access control with expert group validation
    static validateTaskAccess() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userDepartmentId = req.user?.department_id;
                const taskId = req.params.taskId || req.params.id || req.body.task_id;

                if (!userId || !taskId) {
                    return res.status(400).json({ 
                        error: 'Bad Request',
                        message: 'User ID and task ID required'
                    });
                }

                // System administrators can access any task
                if (req.user.role === 'system_administrator') {
                    return next();
                }

                // Get task details
                const result = await query(
                    `SELECT t.*, d.name as department_name
                     FROM tasks t
                     JOIN departments d ON t.department_id = d.id
                     WHERE t.id = $1 AND t.is_active = true`,
                    [taskId]
                );

                if (result.rows.length === 0) {
                    return res.status(404).json({
                        error: 'Not Found',
                        message: 'Task not found'
                    });
                }

                const task = result.rows[0];

                // Check department access
                if (task.department_id !== userDepartmentId) {
                    await auditService.logDataAccess({
                        userId,
                        resourceType: 'task',
                        resourceId: taskId,
                        accessType: 'read',
                        accessGranted: false,
                        denialReason: 'Task department mismatch',
                        ipAddress: req.ip,
                        userAgent: req.get('User-Agent')
                    });

                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'Access denied: Task not accessible'
                    });
                }

                // Check if user has access to this specific task
                let hasTaskAccess = false;

                // Department heads can access all tasks in their department
                if (req.user.role === 'department_head') {
                    hasTaskAccess = true;
                } 
                // Task creator can access their tasks
                else if (task.created_by === userId) {
                    hasTaskAccess = true;
                }
                // Assigned user can access their tasks
                else if (task.assigned_to_user === userId) {
                    hasTaskAccess = true;
                }
                // Expert group members can access group tasks
                else if (task.assigned_to_group) {
                    hasTaskAccess = await this.isUserInExpertGroup(userId, task.assigned_to_group);
                }

                if (!hasTaskAccess) {
                    await auditService.logDataAccess({
                        userId,
                        resourceType: 'task',
                        resourceId: taskId,
                        accessType: 'read',
                        accessGranted: false,
                        denialReason: 'Task assignment mismatch',
                        ipAddress: req.ip,
                        userAgent: req.get('User-Agent')
                    });

                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'Access denied: Task not assigned to you'
                    });
                }

                // Store task info in request for later use
                req.task = task;

                next();
            } catch (error) {
                logger.error('Error in task access validation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Data export access control
    static validateExportAccess(dataType) {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userRole = req.user?.role;
                const userDepartmentId = req.user?.department_id;

                if (!userId) {
                    return res.status(401).json({ 
                        error: 'Authentication required',
                        message: 'User context required for export'
                    });
                }

                // Check if user has export permissions
                const hasExportPermission = await PermissionService.checkUserPermission(
                    userId, 
                    'export', 
                    dataType
                );

                if (!hasExportPermission) {
                    await auditService.logDataAccess({
                        userId,
                        resourceType: dataType,
                        resourceId: null,
                        accessType: 'export',
                        accessGranted: false,
                        denialReason: `No export permission for ${dataType}`,
                        ipAddress: req.ip,
                        userAgent: req.get('User-Agent')
                    });

                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'Export permission denied'
                    });
                }

                // Log export attempt
                await auditService.logOrganizationalOperation({
                    userId,
                    operationType: 'DATA_EXPORT_INITIATED',
                    resourceType: dataType,
                    resourceId: null,
                    departmentId: userDepartmentId,
                    details: {
                        exportType: dataType,
                        userRole: userRole
                    },
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent')
                });

                next();
            } catch (error) {
                logger.error('Error in export access validation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Helper method to check if user is in expert group
    static async isUserInExpertGroup(userId, groupId) {
        if (!groupId) return false;
        
        try {
            const result = await query(
                `SELECT 1 FROM expert_group_members 
                 WHERE user_id = $1 AND expert_group_id = $2 AND is_active = true`,
                [userId, groupId]
            );
            
            return result.rows.length > 0;
        } catch (error) {
            logger.error('Error checking expert group membership:', error);
            return false;
        }
    }

    // Comprehensive access logging middleware
    static logAccess() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                
                if (userId) {
                    const originalSend = res.send;
                    
                    res.send = function(data) {
                        // Log the access after response is sent
                        setImmediate(async () => {
                            try {
                                await auditService.logDataAccess({
                                    userId,
                                    resourceType: req.route?.path || req.path,
                                    resourceId: req.params.id || null,
                                    accessType: req.method.toLowerCase(),
                                    accessGranted: res.statusCode < 400,
                                    denialReason: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
                                    ipAddress: req.ip,
                                    userAgent: req.get('User-Agent')
                                });
                            } catch (error) {
                                logger.error('Error logging access:', error);
                            }
                        });
                        
                        originalSend.call(this, data);
                    };
                }
                
                next();
            } catch (error) {
                logger.error('Error in access logging middleware:', error);
                next(); // Continue even if logging fails
            }
        };
    }
}

module.exports = AccessControlMiddleware;