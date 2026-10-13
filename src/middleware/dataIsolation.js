const AccessPolicyService = require('../services/security/AccessPolicyService');
const { logger } = require('../utils/logger');
const auditService = require("../services/audit/auditService");

/**
 * Data Isolation Middleware
 * Provides data-level permission checking and department boundary enforcement
 * Ensures strict isolation between departments for all data operations
 */

class DataIsolationMiddleware {
    /**
     * Validate department data isolation for any data operation
     * Ensures users can only access data within their department boundaries
     */
    static validateDepartmentIsolation() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userDepartmentId = req.user?.department_id;
                const userRole = req.user?.role;

                if (!userId || !userDepartmentId) {
                    return res.status(401).json({
                        error: 'Authentication required',
                        message: 'User and department context required for data access'
                    });
                }

                // System administrators bypass department isolation
                if (AccessPolicyService.bypassesLegacyBoundary(req.user)) {
                    return next();
                }

                // Extract data identifiers from request
                const dataContext = this.extractDataContext(req);
                
                // Validate each data access
                for (const context of dataContext) {
                    const isAllowed = await this.validateDataAccess(
                        userId, 
                        userDepartmentId, 
                        context.type, 
                        context.id
                    );

                    if (!isAllowed) {
                        // Log isolation violation
                        await auditService.logDataAccess({
                            userId,
                            resourceType: context.type,
                            resourceId: context.id,
                            accessType: req.method.toLowerCase(),
                            accessGranted: false,
                            denialReason: 'Department isolation violation',
                            ipAddress: req.ip,
                            userAgent: req.get('User-Agent'),
                            dataClassification: 'sensitive'
                        });

                        logger.warn(`Department isolation violation: User ${userId} from department ${userDepartmentId} attempted to access ${context.type}:${context.id}`);
                        
                        return res.status(403).json({
                            error: 'Forbidden',
                            message: 'Access denied: Department isolation violation',
                            details: `Cannot access ${context.type} from different department`
                        });
                    }
                }

                next();
            } catch (error) {
                logger.error('Error in department isolation validation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    /**
     * Extract data context from request parameters, body, and query
     */
    static extractDataContext(req) {
        const contexts = [];

        // Profile data
        if (req.params.profileId || req.body.profile_id) {
            contexts.push({
                type: 'profile',
                id: req.params.profileId || req.body.profile_id
            });
        }

        // Task data
        if (req.params.taskId || req.body.task_id) {
            contexts.push({
                type: 'task',
                id: req.params.taskId || req.body.task_id
            });
        }

        // Expert group data
        if (req.params.groupId || req.body.group_id) {
            contexts.push({
                type: 'expert_group',
                id: req.params.groupId || req.body.group_id
            });
        }

        // Master array data
        if (req.params.masterArrayId || req.body.master_array_id) {
            contexts.push({
                type: 'master_array',
                id: req.params.masterArrayId || req.body.master_array_id
            });
        }

        // Department data
        if (req.params.departmentId || req.body.department_id) {
            contexts.push({
                type: 'department',
                id: req.params.departmentId || req.body.department_id
            });
        }

        // User data (for user management operations)
        if (req.params.userId || req.body.user_id) {
            contexts.push({
                type: 'user',
                id: req.params.userId || req.body.user_id
            });
        }

        // Generic ID parameter
        if (req.params.id && contexts.length === 0) {
            // Try to determine type from route path
            const path = req.route?.path || req.path;
            let type = 'unknown';
            
            if (path.includes('/profiles')) type = 'profile';
            else if (path.includes('/tasks')) type = 'task';
            else if (path.includes('/groups')) type = 'expert_group';
            else if (path.includes('/master-arrays')) type = 'master_array';
            else if (path.includes('/departments')) type = 'department';
            else if (path.includes('/users')) type = 'user';

            if (type !== 'unknown') {
                contexts.push({
                    type,
                    id: req.params.id
                });
            }
        }

        return contexts;
    }

    /**
     * Validate data access based on department isolation rules
     */
    static async validateDataAccess(userId, userDepartmentId, dataType, dataId) { return AccessPolicyService.legacyValidateDataAccess(userId, userDepartmentId, dataType, dataId); }

    /**
     * Validate profile access - users can access their own profiles and department master array profiles
     */
    static async validateProfileAccess(userId, userDepartmentId, profileId) { return AccessPolicyService.legacyValidateProfileAccess(userId, userDepartmentId, profileId); }

    /**
     * Validate task access - users can access tasks in their department
     */
    static async validateTaskAccess(userId, userDepartmentId, taskId) { return AccessPolicyService.legacyValidateTaskAccess(userId, userDepartmentId, taskId); }

    /**
     * Validate expert group access - users can access groups in their department
     */
    static async validateExpertGroupAccess(userId, userDepartmentId, groupId) { return AccessPolicyService.legacyValidateExpertGroupAccess(userId, userDepartmentId, groupId); }

    /**
     * Validate master array access - users can only access their department's master array
     */
    static async validateMasterArrayAccess(userId, userDepartmentId, masterArrayId) { return AccessPolicyService.legacyValidateMasterArrayAccess(userId, userDepartmentId, masterArrayId); }

    /**
     * Validate department access - users can only access their own department
     */
    static async validateDepartmentAccess(userId, userDepartmentId, departmentId) { return AccessPolicyService.legacyValidateDepartmentAccess(userId, userDepartmentId, departmentId); }

    /**
     * Validate user access - users can access other users in their department
     */
    static async validateUserAccess(userId, userDepartmentId, targetUserId) { return AccessPolicyService.legacyValidateUserAccess(userId, userDepartmentId, targetUserId); }

    /**
     * Validate cross-department data sharing (for special cases)
     * This should be used sparingly and with explicit authorization
     */
    static validateCrossDepartmentAccess() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userRole = req.user?.role;
                const sharedAccessToken = req.headers['x-shared-access-token'];

                // Only system administrators and department heads can initiate cross-department access
                if (!AccessPolicyService.canInitiateCrossDepartment(req.user)) {
                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'Cross-department access requires elevated privileges'
                    });
                }

                // Validate shared access token if provided
                if (sharedAccessToken) {
                    const isValidToken = await this.validateSharedAccessToken(
                        userId, 
                        sharedAccessToken, 
                        req.params.departmentId
                    );

                    if (!isValidToken) {
                        await auditService.logDataAccess({
                            userId,
                            resourceType: 'department',
                            resourceId: req.params.departmentId,
                            accessType: 'cross_department',
                            accessGranted: false,
                            denialReason: 'Invalid shared access token',
                            ipAddress: req.ip,
                            userAgent: req.get('User-Agent')
                        });

                        return res.status(403).json({
                            error: 'Forbidden',
                            message: 'Invalid shared access token'
                        });
                    }
                }

                // Log cross-department access
                await auditService.logOrganizationalOperation({
                    userId,
                    operationType: 'CROSS_DEPARTMENT_ACCESS',
                    resourceType: 'department',
                    resourceId: req.params.departmentId,
                    departmentId: req.user.department_id,
                    details: {
                        targetDepartment: req.params.departmentId,
                        accessType: 'cross_department',
                        hasSharedToken: !!sharedAccessToken
                    },
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent')
                });

                next();
            } catch (error) {
                logger.error('Error in cross-department access validation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    /**
     * Validate shared access token for cross-department operations
     */
    static async validateSharedAccessToken(userId, token, targetDepartmentId) { return AccessPolicyService.legacyValidateSharedAccessToken(userId, token, targetDepartmentId); }

    /**
     * Middleware to log all data access attempts for audit purposes
     */
    static logDataAccess() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                
                if (userId) {
                    const dataContext = this.extractDataContext(req);
                    
                    // Log each data access
                    for (const context of dataContext) {
                        await auditService.logDataAccess({
                            userId,
                            resourceType: context.type,
                            resourceId: context.id,
                            accessType: req.method.toLowerCase(),
                            accessGranted: true, // Will be updated if access is denied
                            ipAddress: req.ip,
                            userAgent: req.get('User-Agent'),
                            dataClassification: 'sensitive'
                        });
                    }
                }

                next();
            } catch (error) {
                logger.error('Error logging data access:', error);
                next(); // Continue even if logging fails
            }
        };
    }

    /**
     * Validate bulk operations to ensure all data belongs to user's department
     */
    static validateBulkOperation(dataType) {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const userDepartmentId = req.user?.department_id;
                const userRole = req.user?.role;

                if (!userId || !userDepartmentId) {
                    return res.status(401).json({
                        error: 'Authentication required',
                        message: 'User and department context required'
                    });
                }

                // System administrators bypass validation
                if (AccessPolicyService.bypassesLegacyBoundary(req.user)) {
                    return next();
                }

                // Extract bulk data IDs from request
                const dataIds = req.body.ids || req.body.profileIds || req.body.taskIds || [];

                if (dataIds.length === 0) {
                    return next(); // No bulk data to validate
                }

                // Validate each item in the bulk operation
                for (const dataId of dataIds) {
                    const isAllowed = await this.validateDataAccess(
                        userId,
                        userDepartmentId,
                        dataType,
                        dataId
                    );

                    if (!isAllowed) {
                        await auditService.logDataAccess({
                            userId,
                            resourceType: dataType,
                            resourceId: dataId,
                            accessType: 'bulk_operation',
                            accessGranted: false,
                            denialReason: 'Bulk operation department isolation violation',
                            ipAddress: req.ip,
                            userAgent: req.get('User-Agent')
                        });

                        return res.status(403).json({
                            error: 'Forbidden',
                            message: `Bulk operation denied: Item ${dataId} not accessible`,
                            details: 'All items in bulk operation must belong to your department'
                        });
                    }
                }

                next();
            } catch (error) {
                logger.error('Error in bulk operation validation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }
}

module.exports = DataIsolationMiddleware;