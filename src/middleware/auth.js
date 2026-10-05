const authService = require('../services/authService');
const User = require('../models/User');
const PermissionService = require('../services/permissionService');
const auditService = require('../services/auditService');
const { logger } = require('../utils/logger');
const rateLimit = require('express-rate-limit');
const { requestContext } = require('./requestContext');

// Extract token from request headers or query params (for SSE)
function extractToken(req) {
    // Сначала проверяем query параметр (для SSE)
    if (req.query && req.query.token) {
        return req.query.token;
    }
    
    // Затем проверяем заголовок Authorization
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return null;
    }

    // Support both "Bearer token" and "token" formats
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    
    return authHeader;
}

function extractActiveDepartmentId(req) {
    return req.headers['x-active-department-id'] || req.headers['X-Active-Department-Id'];
}

// Authentication middleware - verify JWT token
async function authenticate(req, res, next) {
    requestContext(req, res, () => {});
    let checkingOrganizationalContext = false;
    let authenticatedUserId = null;
    try {
        const token = extractToken(req);
        
        if (!token) {
            // Log failed authentication attempt
            await auditService.logDataAccess({
                userId: null,
                resourceType: 'authentication',
                resourceId: null,
                accessType: 'authenticate',
                accessGranted: false,
                denialReason: 'No access token provided',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });

            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Access token is required'
            });
        }

        // Verify token
        const decoded = authService.verifyToken(token);
        
        // Validate session exists and is active
        const session = await authService.validateSession(token);
        if (!session) {
            // Log failed session validation
            await auditService.logDataAccess({
                userId: decoded?.id || null,
                resourceType: 'authentication',
                resourceId: null,
                accessType: 'authenticate',
                accessGranted: false,
                denialReason: 'Invalid or expired session',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });

            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid or expired session'
            });
        }

        // Get fresh user data with organizational context
        checkingOrganizationalContext = true;
        authenticatedUserId = decoded.id;
        const user = await User.findById(decoded.id);
        if (!user) {
            // Log user not found
            await auditService.logDataAccess({
                userId: decoded.id,
                resourceType: 'authentication',
                resourceId: null,
                accessType: 'authenticate',
                accessGranted: false,
                denialReason: 'User not found',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });

            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User not found'
            });
        }

        const accessibleDepartments = await user.getAccessibleDepartments();
        const activeDepartmentIdFromHeader = extractActiveDepartmentId(req);
        const fallbackDepartmentId = user.department_id || accessibleDepartments[0]?.id || null;
        const allowedDepartmentIds = accessibleDepartments
            .filter(department => user.role === 'system_administrator' || department.organization_id === user.organization_id)
            .map(department => department.id);

        let activeDepartmentId = fallbackDepartmentId;

        if (activeDepartmentIdFromHeader) {
            if (!allowedDepartmentIds.includes(activeDepartmentIdFromHeader)) {
                logger.warn('PROFILE_ACCESS_DENIED', {
                    userId: user.id, profileId: req.params.id || null,
                    activeDepartmentId: activeDepartmentIdFromHeader, requestId: req.requestId
                });
                return res.status(403).json({
                    error: 'Forbidden', code: 'PROFILE_ACCESS_DENIED', requestId: req.requestId,
                    message: 'Selected department is not available for this user'
                });
            }

            activeDepartmentId = activeDepartmentIdFromHeader;
        }

        // Validate organizational context matches token
        if (decoded.organization_id !== user.organization_id || 
            decoded.department_id !== user.department_id) {
            logger.warn(`Organizational context mismatch for user ${user.username}`);
            
            // Log organizational context mismatch
            await auditService.logDataAccess({
                userId: user.id,
                resourceType: 'authentication',
                resourceId: null,
                accessType: 'authenticate',
                accessGranted: false,
                denialReason: 'Organizational context mismatch',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });

            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Organizational context has changed, please re-authenticate'
            });
        }

        // Log successful authentication
        await auditService.logDataAccess({
            userId: user.id,
            resourceType: 'authentication',
            resourceId: null,
            accessType: 'authenticate',
            accessGranted: true,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        // Attach user, token, and organizational context to request
        req.user = user;
        req.token = token;
        req.session = session;
        req.user.accessible_departments = accessibleDepartments;
        req.activeDepartmentId = activeDepartmentId;
        req.organizationalContext = {
            organization_id: user.organization_id,
            department_id: activeDepartmentId,
            primary_department_id: user.department_id,
            accessible_departments: accessibleDepartments,
            role: user.role
        };

        next();
    } catch (error) {
        if (checkingOrganizationalContext) {
            logger.error('PROFILE_ACCESS_CHECK_ERROR', {
                userId: authenticatedUserId, profileId: req.params.id || null,
                activeDepartmentId: extractActiveDepartmentId(req) || null,
                requestId: req.requestId, error: error.message, code: error.code
            });
            return res.status(500).json({
                error: 'Internal server error', message: 'Failed to check organizational access',
                code: 'PROFILE_ACCESS_CHECK_ERROR', requestId: req.requestId
            });
        }
        logger.error('Authentication failed:', error.message);
        
        // Log authentication error
        await auditService.logDataAccess({
            userId: null,
            resourceType: 'authentication',
            resourceId: null,
            accessType: 'authenticate',
            accessGranted: false,
            denialReason: `Authentication error: ${error.message}`,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });
        
        if (error.message.includes('expired')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Token has expired'
            });
        }

        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid token'
        });
    }
}

// Authorization middleware - check user roles with organizational context
function authorize(allowedRoles = []) {
    return (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }

            // If no roles specified, just check if user is authenticated
            if (allowedRoles.length === 0) {
                return next();
            }

            // Map legacy roles to new role system
            const roleMapping = {
                'analyst': 'user_analyst'
                // admin and department_head stay as is
            };

            const userRole = roleMapping[req.user.role] || req.user.role;
            const mappedAllowedRoles = allowedRoles.map(role => roleMapping[role] || role);

            // Check if user has required role
            if (!mappedAllowedRoles.includes(userRole)) {
                logger.warn(`Access denied for user ${req.user.username} with role ${req.user.role}. Required roles: ${allowedRoles.join(', ')}`);
                
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Insufficient permissions'
                });
            }

            next();
        } catch (error) {
            logger.error('Authorization failed:', error.message);
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Authorization check failed'
            });
        }
    };
}

// Optional authentication - don't fail if no token provided
async function optionalAuth(req, res, next) {
    try {
        const token = extractToken(req);
        
        if (!token) {
            return next();
        }

        // Try to verify token
        const decoded = authService.verifyToken(token);
        const session = await authService.validateSession(token);
        
        if (session) {
            const user = await User.findById(decoded.id);
            if (user) {
                req.user = user;
                req.token = token;
                req.session = session;
            }
        }

        next();
    } catch (error) {
        // Ignore authentication errors for optional auth
        logger.debug('Optional authentication failed:', error.message);
        next();
    }
}

// System administrator only middleware
const systemAdminOnly = authorize(['admin']);

// Department head or system administrator middleware
const departmentHeadOrAdmin = authorize(['department_head', 'system_administrator', 'admin']);

// User analyst, department head, or system administrator middleware
const analystOrAbove = authorize(['user_analyst', 'department_head', 'system_administrator', 'admin']);

// Any authenticated user middleware
const authenticated = authorize([]);

// Legacy compatibility middleware
const adminOnly = authorize(['admin']);
const adminOrAnalyst = authorize(['admin', 'department_head', 'user_analyst']);
const adminOrDepartmentHead = authorize(['admin', 'department_head']);

// Resource ownership middleware - check if user owns the resource or is admin
function requireOwnershipOrAdmin(resourceUserIdField = 'user_id') {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }

            // Admins can access any resource
            if (req.user.role === 'admin') {
                return next();
            }

            // For other users, check ownership
            const resourceUserId = req.resource ? req.resource[resourceUserIdField] : req.params.userId;
            
            if (!resourceUserId) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Resource ownership cannot be determined'
                });
            }

            if (resourceUserId !== req.user.id) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You can only access your own resources'
                });
            }

            next();
        } catch (error) {
            logger.error('Ownership check failed:', error.message);
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Ownership verification failed'
            });
        }
    };
}

// Permission check for specific operations with organizational context
function requirePermission(operation) {
    const permissions = {
        'user_management': ['admin', 'department_head'],
        'profile_upload': ['admin', 'department_head', 'user_analyst'],
        'profile_delete': ['admin', 'department_head', 'user_analyst'],
        'analysis_run': ['admin', 'department_head', 'user_analyst'],
        'export_data': ['admin', 'department_head', 'user_analyst'],
        'view_profiles': ['admin', 'department_head'],
        'view_results': ['admin', 'department_head', 'user_analyst'],
        'master_array_management': ['admin', 'department_head'],
        'task_management': ['admin', 'department_head'],
        'organization_management': ['admin'],
        'expert_group_management': ['admin', 'department_head'],
        'task_assignment': ['admin', 'department_head'],
        'task_approval': ['admin', 'department_head'],
        'audit_access': ['admin', 'department_head'],
        'system_settings': ['admin'],
        'view_tasks': ['admin', 'department_head', 'user_analyst'],
        'create_tasks': ['admin', 'department_head'],
        'department_management': ['admin', 'department_head']
    };

    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }

            const allowedRoles = permissions[operation];
            if (!allowedRoles) {
                logger.error(`Unknown permission operation: ${operation}`);
                return res.status(500).json({
                    error: 'Internal Server Error',
                    message: 'Permission configuration error'
                });
            }

            // Map legacy roles to new role system
            const roleMapping = {
                'analyst': 'user_analyst'
                // admin and department_head stay as is
            };

            const userRole = roleMapping[req.user.role] || req.user.role;

            if (!allowedRoles.includes(userRole) && !allowedRoles.includes(req.user.role)) {
                logger.warn(`Permission denied for user ${req.user.username} with role ${req.user.role} for operation ${operation}`);
                
                return res.status(403).json({
                    error: 'Forbidden',
                    message: `Insufficient permissions for ${operation.replace('_', ' ')}`
                });
            }

            next();
        } catch (error) {
            logger.error('Permission check failed:', error.message);
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Permission check failed'
            });
        }
    };
}

// Rate limiting by role
function roleBasedRateLimit() {
    const adminLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 50000, // Highest limit for administrators
        message: 'Слишком много запросов от администратора'
    });

    const departmentHeadLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 25000, // High limit for department heads
        message: 'Слишком много запросов от руководителя'
    });

    const analystLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10000, // Medium limit for experts
        message: 'Слишком много запросов от эксперта'
    });

    return (req, res, next) => {
        if (!req.user) {
            return next();
        }

        const role = req.user.role;
        switch (role) {
            case 'admin':
                return adminLimiter(req, res, next);
            case 'department_head':
                return departmentHeadLimiter(req, res, next);
            case 'user_analyst':
            case 'analyst': // Legacy compatibility
                return analystLimiter(req, res, next);
            default:
                return analystLimiter(req, res, next); // По умолчанию как эксперт
        }
    };
}

// Organizational access control middleware
function requireOrganizationalAccess(resourceType, action) {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Authentication required'
                });
            }

            const resourceId = req.params.id || req.body.id || req.params.resourceId;
            const hasPermission = await PermissionService.checkUserPermission(
                req.user.id, 
                action, 
                resourceType, 
                resourceId
            );

            if (!hasPermission) {
                logger.warn(`Organizational access denied: User ${req.user.username} attempted ${action} on ${resourceType}:${resourceId}`);
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Access denied to this resource'
                });
            }

            next();
        } catch (error) {
            logger.error('Error in organizational access middleware:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

// Department isolation middleware
function requireDepartmentAccess() {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id;
            const departmentId = req.params.departmentId || req.body.department_id;

            if (!userId || !departmentId) {
                return res.status(400).json({ error: 'User ID and department ID required' });
            }

            const hasAccess = await PermissionService.validateDataAccess(userId, 'department', departmentId);

            if (!hasAccess) {
                logger.warn(`Department access denied: User ${userId} attempted to access department ${departmentId}`);
                return res.status(403).json({ error: 'Department access denied' });
            }

            next();
        } catch (error) {
            logger.error('Error in department access middleware:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

// Master array access middleware
function requireMasterArrayAccess() {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id;
            const masterArrayId = req.params.masterArrayId || req.body.master_array_id;

            if (!userId || !masterArrayId) {
                return res.status(400).json({ error: 'User ID and master array ID required' });
            }

            const hasAccess = await PermissionService.canAccessMasterArray(userId, masterArrayId);

            if (!hasAccess) {
                logger.warn(`Master array access denied: User ${userId} attempted to access master array ${masterArrayId}`);
                return res.status(403).json({ error: 'Master array access denied' });
            }

            next();
        } catch (error) {
            logger.error('Error in master array access middleware:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

// Task management access middleware
function requireTaskAccess() {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id;
            const taskId = req.params.taskId || req.body.task_id || req.params.id;

            if (!userId || !taskId) {
                return res.status(400).json({ error: 'User ID and task ID required' });
            }

            const hasAccess = await PermissionService.canManageTask(userId, taskId);

            if (!hasAccess) {
                logger.warn(`Task access denied: User ${userId} attempted to access task ${taskId}`);
                return res.status(403).json({ error: 'Task access denied' });
            }

            next();
        } catch (error) {
            logger.error('Error in task access middleware:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

// Session management with organizational context
async function refreshSessionContext(req, res, next) {
    try {
        if (!req.user || !req.token) {
            return next();
        }

        // Check if organizational context has changed
        const currentUser = await User.findById(req.user.id);
        if (!currentUser) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User not found'
            });
        }

        // If organizational context changed, invalidate session
        if (currentUser.organization_id !== req.user.organization_id ||
            currentUser.department_id !== req.user.department_id) {
            
            await authService.invalidateSession(req.token);
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Organizational context has changed, please re-authenticate'
            });
        }

        next();
    } catch (error) {
        logger.error('Error refreshing session context:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

const AccessControlMiddleware = require('./accessControl');

module.exports = {
    authenticate,
    authorize,
    optionalAuth,
    // Legacy compatibility middleware
    adminOnly,
    adminOrAnalyst,
    adminOrDepartmentHead,
    // New three-level role middleware
    systemAdminOnly,
    departmentHeadOrAdmin,
    analystOrAbove,
    authenticated,
    requireOwnershipOrAdmin,
    requirePermission,
    roleBasedRateLimit,
    extractToken,
    extractActiveDepartmentId,
    // New organizational access control middleware
    requireOrganizationalAccess,
    requireDepartmentAccess,
    requireMasterArrayAccess,
    requireTaskAccess,
    refreshSessionContext,
    // Comprehensive access control middleware
    AccessControlMiddleware
};
