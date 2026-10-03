const express = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../services/authService');
const User = require('../models/User');
const { getProfileUploadPermissions, validateUploadPermissionFields } = require('../utils/profileUploadPermissions');
const { authenticate, adminOnly } = require('../middleware/auth');
const { logAuthOperation } = require('../middleware/operationLogger');
const OperationHistory = require('../models/OperationHistory');
const { 
    validateLogin, 
    validateRegister, 
    validateRefreshToken,
    validateChangePassword 
} = require('../middleware/validation');
const { logger } = require('../utils/logger');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too Many Requests', message: 'Слишком много попыток входа. Попробуйте позже.' }
});

// Helper function to get client info
function getClientInfo(req) {
    return {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || 'Unknown'
    };
}

// POST /api/auth/login - User login
router.post('/login', authLimiter, validateLogin, logAuthOperation(OperationHistory.OPERATION_TYPES.LOGIN), async (req, res) => {
    try {
        const { username, password } = req.body;
        const clientInfo = getClientInfo(req);

        const result = await authService.login(
            username, 
            password, 
            clientInfo.ipAddress, 
            clientInfo.userAgent
        );

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: result
        });

    } catch (error) {
        logger.error('Login failed:', error.message);
        
        res.status(401).json({
            error: 'Authentication Failed',
            message: error.message === 'Invalid credentials' 
                ? 'Неверное имя пользователя или пароль' 
                : 'Ошибка входа'
        });
    }
});

// POST /api/auth/register - User registration with organizational context
router.post('/register', authenticate, adminOnly, validateRegister, async (req, res) => {
    try {
        const { username, email, password, role, organization_id, department_id } = req.body;
        const clientInfo = getClientInfo(req);

        // Only admins can create admin users or system administrators
        if (role === 'admin' || role === 'system_administrator') {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Admin and system administrator users can only be created by existing administrators'
            });
        }

        // Validate organizational context for non-admin roles
        if (role === 'department_head' || role === 'user_analyst') {
            if (!department_id) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Department assignment is required for department heads and user analysts'
                });
            }

            // Verify department exists and is active
            const { query } = require('../config/database');
            const deptResult = await query(
                'SELECT id, organization_id FROM departments WHERE id = $1 AND is_active = true',
                [department_id]
            );

            if (deptResult.rows.length === 0) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Invalid or inactive department'
                });
            }

            // Set organization_id from department if not provided
            const actualOrgId = organization_id || deptResult.rows[0].organization_id;

            const result = await authService.register(
                { 
                    username, 
                    email, 
                    password, 
                    role, 
                    organization_id: actualOrgId, 
                    department_id 
                },
                clientInfo.ipAddress,
                clientInfo.userAgent
            );

            res.status(201).json({
                success: true,
                message: 'Registration successful',
                data: result
            });
        } else {
            // For viewer role, no organizational context required
            const result = await authService.register(
                { username, email, password, role },
                clientInfo.ipAddress,
                clientInfo.userAgent
            );

            res.status(201).json({
                success: true,
                message: 'Registration successful',
                data: result
            });
        }

    } catch (error) {
        logger.error('Registration failed:', error.message);
        
        if (error.message.includes('already exists')) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'Username or email already exists'
            });
        }

        if (error.code === '23505') { // PostgreSQL unique constraint violation
            return res.status(409).json({
                error: 'Conflict',
                message: 'Username or email already exists'
            });
        }

        res.status(400).json({
            error: 'Registration Failed',
            message: 'Registration failed. Please try again.'
        });
    }
});

// POST /api/auth/logout - User logout
router.post('/logout', authenticate, logAuthOperation(OperationHistory.OPERATION_TYPES.LOGOUT), async (req, res) => {
    try {
        const clientInfo = getClientInfo(req);
        
        await authService.logout(
            req.token,
            clientInfo.ipAddress,
            clientInfo.userAgent
        );

        res.status(200).json({
            success: true,
            message: 'Logout successful'
        });

    } catch (error) {
        logger.error('Logout failed:', error.message);
        
        res.status(500).json({
            error: 'Logout Failed',
            message: 'Logout failed. Please try again.'
        });
    }
});

// GET /api/auth/me - Get current user info with organizational context
router.get('/me', authenticate, async (req, res) => {
    try {
        // Get organizational context
        let organizationInfo = null;
        let departmentInfo = null;
        let expertGroups = [];
        const accessibleDepartments = await req.user.getAccessibleDepartments();

        if (req.user.organization_id) {
            const organization = await req.user.getOrganization();
            organizationInfo = organization ? organization.toJSON() : null;
        }

        if (req.activeDepartmentId) {
            const department = await req.user.getDepartment(req.activeDepartmentId);
            departmentInfo = department ? department.toJSON() : null;
        }

        // Get user's expert groups
        expertGroups = await req.user.getExpertGroups();

        res.status(200).json({
            success: true,
            data: {
                user: {
                    ...req.user.toJSON(),
                    accessible_departments: accessibleDepartments,
                    active_department_id: req.activeDepartmentId
                },
                organizationalContext: {
                    organization: organizationInfo,
                    department: departmentInfo,
                    expertGroups: expertGroups.map(group => group.toJSON()),
                    accessibleDepartments
                },
                session: {
                    expires_at: req.session.expires_at,
                    created_at: req.session.created_at
                }
            }
        });

    } catch (error) {
        logger.error('Get user info failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user information'
        });
    }
});

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', validateRefreshToken, async (req, res) => {
    try {
        const { refreshToken } = req.body;
        const clientInfo = getClientInfo(req);

        const result = await authService.refreshToken(
            refreshToken,
            clientInfo.ipAddress,
            clientInfo.userAgent
        );

        res.status(200).json({
            success: true,
            message: 'Token refreshed successfully',
            data: result
        });

    } catch (error) {
        logger.error('Token refresh failed:', error.message);
        
        res.status(401).json({
            error: 'Token Refresh Failed',
            message: 'Invalid or expired refresh token'
        });
    }
});

// POST /api/auth/change-password - Change user password
router.post('/change-password', authenticate, validateChangePassword, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        // Verify current password
        const isValidPassword = await req.user.verifyPassword(currentPassword);
        if (!isValidPassword) {
            return res.status(400).json({
                error: 'Invalid Password',
                message: 'Current password is incorrect'
            });
        }

        // Update password
        await req.user.changePassword(newPassword);

        // Log operation
        const clientInfo = getClientInfo(req);
        await authService.logOperation(req.user.id, 'PASSWORD_CHANGE', clientInfo);

        res.status(200).json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        logger.error('Password change failed:', error.message);
        
        res.status(500).json({
            error: 'Password Change Failed',
            message: 'Failed to change password. Please try again.'
        });
    }
});

// POST /api/auth/logout-all - Logout from all devices
router.post('/logout-all', authenticate, async (req, res) => {
    try {
        await authService.invalidateAllUserSessions(req.user.id);

        res.status(200).json({
            success: true,
            message: 'Logged out from all devices successfully'
        });

    } catch (error) {
        logger.error('Logout all failed:', error.message);
        
        res.status(500).json({
            error: 'Logout Failed',
            message: 'Failed to logout from all devices'
        });
    }
});

// GET /api/auth/sessions - Get user's active sessions (authenticated users only)
router.get('/sessions', authenticate, async (req, res) => {
    try {
        const { query } = require('../config/database');
        
        const result = await query(
            `SELECT id, expires_at, created_at, ip_address, user_agent, is_active
             FROM user_sessions 
             WHERE user_id = $1 AND is_active = true 
             ORDER BY created_at DESC`,
            [req.user.id]
        );

        res.status(200).json({
            success: true,
            data: {
                sessions: result.rows,
                total: result.rows.length
            }
        });

    } catch (error) {
        logger.error('Get sessions failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve sessions'
        });
    }
});

// DELETE /api/auth/sessions/:sessionId - Revoke specific session
router.delete('/sessions/:sessionId', authenticate, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { query } = require('../config/database');

        // Only allow users to revoke their own sessions
        const result = await query(
            'UPDATE user_sessions SET is_active = false WHERE id = $1 AND user_id = $2',
            [sessionId, req.user.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Session not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Session revoked successfully'
        });

    } catch (error) {
        logger.error('Session revocation failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to revoke session'
        });
    }
});

// POST /api/auth/register-with-department - Register user with department assignment (admin/department_head only)
router.post('/register-with-department', authenticate, adminOnly, async (req, res) => {
    try {
        const { username, email, password, role, department_id, department_ids, organization_id } = req.body;
        if (!validateUploadPermissionFields(req.body)) {
            return res.status(400).json({ code: 'INVALID_UPLOAD_PERMISSIONS', message: 'Права загрузки должны быть логическими значениями true/false.' });
        }
        const uploadPermissions = getProfileUploadPermissions(req.body);
        const clientInfo = getClientInfo(req);
        const requestedDepartmentIds = Array.isArray(department_ids)
            ? [...new Set(department_ids.filter(Boolean))]
            : (department_id ? [department_id] : []);

        // Validate required fields
        if (!username || !email || !password || !role) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Username, email, password, and role are required'
            });
        }

        // Validate role
        const validRoles = ['user_analyst', 'department_head', 'system_administrator', 'viewer'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid role specified'
            });
        }

        // For roles requiring department, validate department assignment
        if ((role === 'user_analyst' || role === 'department_head') && requestedDepartmentIds.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Department assignment is required for this role'
            });
        }

        // Verify department exists if provided
        if (requestedDepartmentIds.length > 0) {
            const { query } = require('../config/database');
            const deptResult = await query(
                `SELECT id, organization_id
                 FROM departments
                 WHERE id = ANY($1::uuid[]) AND is_active = true`,
                [requestedDepartmentIds]
            );

            if (deptResult.rows.length !== requestedDepartmentIds.length) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'One or more selected departments are invalid or inactive'
                });
            }

            const primaryDepartmentId = requestedDepartmentIds[0];
            const primaryDepartment = deptResult.rows.find((department) => department.id === primaryDepartmentId) || deptResult.rows[0];
            const actualOrgId = organization_id || primaryDepartment.organization_id;

            const result = await authService.register(
                { 
                    username, 
                    email, 
                    password, 
                    role, 
                    organization_id: actualOrgId, 
                    department_id: primaryDepartmentId,
                    ...uploadPermissions
                },
                clientInfo.ipAddress,
                clientInfo.userAgent
            );

            if (result.user?.id) {
                const createdUser = await User.findById(result.user.id);
                if (createdUser) {
                    await createdUser.syncAccessibleDepartments(requestedDepartmentIds, actualOrgId);
                    result.user = {
                        ...result.user,
                        department_id: createdUser.department_id,
                        organization_id: createdUser.organization_id,
                        accessible_departments: createdUser.accessible_departments
                    };
                }
            }

            res.status(201).json({
                success: true,
                message: 'User registered successfully with department assignment',
                data: result
            });
        } else {
            // Register without organizational context
            const result = await authService.register(
                { username, email, password, role, ...uploadPermissions },
                clientInfo.ipAddress,
                clientInfo.userAgent
            );

            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                data: result
            });
        }

    } catch (error) {
        logger.error('Department user registration failed:', error.message);
        
        if (error.message.includes('already exists')) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'Username or email already exists'
            });
        }

        res.status(400).json({
            error: 'Registration Failed',
            message: 'Failed to register user with department assignment'
        });
    }
});

// PUT /api/auth/assign-department - Assign user to department (admin/department_head only)
router.put('/assign-department', authenticate, adminOnly, async (req, res) => {
    try {
        const { user_id, department_id } = req.body;

        if (!user_id || !department_id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'User ID and department ID are required'
            });
        }

        // Verify user exists
        const User = require('../models/User');
        const user = await User.findById(user_id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        // Verify department exists
        const { query } = require('../config/database');
        const deptResult = await query(
            'SELECT id, organization_id FROM departments WHERE id = $1 AND is_active = true',
            [department_id]
        );

        if (deptResult.rows.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid or inactive department'
            });
        }

        // Assign user to department and organization
        await user.assignToDepartment(department_id);
        await user.assignToOrganization(deptResult.rows[0].organization_id);

        // Invalidate all user sessions to force re-authentication with new context
        await authService.invalidateAllUserSessions(user_id);

        res.status(200).json({
            success: true,
            message: 'User assigned to department successfully',
            data: {
                user_id,
                department_id,
                organization_id: deptResult.rows[0].organization_id
            }
        });

    } catch (error) {
        logger.error('Department assignment failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to assign user to department'
        });
    }
});

// GET /api/auth/organizational-context - Get organizational context for current user
router.get('/organizational-context', authenticate, async (req, res) => {
    try {
        const accessibleDepartments = await req.user.getAccessibleDepartments();
        const context = {
            user: {
                ...req.user.toJSON(),
                accessible_departments: accessibleDepartments,
                active_department_id: req.activeDepartmentId
            },
            organization: null,
            department: null,
            accessibleDepartments,
            expertGroups: [],
            accessibleMasterArrays: [],
            permissions: null
        };

        // Get organization info
        if (req.user.organization_id) {
            const organization = await req.user.getOrganization();
            context.organization = organization ? organization.toJSON() : null;
        }

        // Get department info
        if (req.activeDepartmentId) {
            const department = await req.user.getDepartment(req.activeDepartmentId);
            context.department = department ? department.toJSON() : null;
        }

        // Get expert groups
        context.expertGroups = await req.user.getExpertGroups();

        // Get accessible master arrays
        context.accessibleMasterArrays = await req.user.getAccessibleMasterArrays();

        // Get effective permissions
        const PermissionService = require('../services/permissionService');
        context.permissions = await PermissionService.getEffectivePermissions(req.user.id);

        res.status(200).json({
            success: true,
            data: context
        });

    } catch (error) {
        logger.error('Get organizational context failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve organizational context'
        });
    }
});

module.exports = router;
