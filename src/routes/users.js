const express = require('express');
const User = require('../models/User');
const authService = require('../services/authService');
const { authenticate, adminOnly, departmentHeadOrAdmin } = require('../middleware/auth');
const { 
    validateUpdateRole, 
    validateUpdateProfile,
    validateUUID,
    validatePagination,
    validateRegister,
    validateResetPassword,
    validateUpdateStatus,
    validateSearchUsers
} = require('../middleware/validation');
const { logger } = require('../utils/logger');

const router = express.Router();

// Helper function to get client info
function getClientInfo(req) {
    return {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || 'Unknown'
    };
}

// GET /api/users - Get all users with organizational filtering
router.get('/', authenticate, departmentHeadOrAdmin, validatePagination, async (req, res) => {
    try {
        const { page, limit, organization_id, department_id } = req.query;
        const offset = (page - 1) * limit;

        const { query } = require('../config/database');
        
        let whereConditions = ['users.is_active = true'];
        let queryParams = [];
        let paramIndex = 1;

        // System administrators can filter by organization/department
        // Department heads can only see their own department
        if (req.user.role === 'department_head') {
            // For now, department heads can see all users
            // Later can be restricted to their department only
        } else if (req.user.role === 'admin') {
            if (organization_id) {
                whereConditions.push(`users.organization_id = $${paramIndex}`);
                queryParams.push(organization_id);
                paramIndex++;
            }
            if (department_id) {
                whereConditions.push(`EXISTS (
                    SELECT 1
                    FROM user_departments ud_filter
                    WHERE ud_filter.user_id = users.id
                      AND ud_filter.department_id = $${paramIndex}
                )`);
                queryParams.push(department_id);
                paramIndex++;
            }
        }

        const whereClause = whereConditions.join(' AND ');

        // Get total count
        const countQuery = `
            SELECT COUNT(*) 
            FROM users 
            LEFT JOIN organizations o ON users.organization_id = o.id
            LEFT JOIN departments d ON users.department_id = d.id
            WHERE ${whereClause}
        `;
        const countResult = await query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].count);

        // Get paginated users with organizational context
        const usersQuery = `
            SELECT users.id, users.username, users.email, users.role, 
                   users.created_at, users.last_login, users.is_active,
                   users.organization_id, users.department_id,
                   o.name as organization_name,
                   d.name as department_name,
                   COALESCE(
                     json_agg(
                       DISTINCT jsonb_build_object(
                         'id', d_all.id,
                         'name', d_all.name,
                         'organization_id', d_all.organization_id,
                         'is_primary', ud.is_primary
                       )
                     ) FILTER (WHERE d_all.id IS NOT NULL),
                     '[]'::json
                   ) AS accessible_departments,
                   COALESCE(
                     string_agg(DISTINCT d_all.name, ', ' ORDER BY d_all.name),
                     d.name,
                     ''
                   ) AS department_names
            FROM users 
            LEFT JOIN organizations o ON users.organization_id = o.id
            LEFT JOIN departments d ON users.department_id = d.id
            LEFT JOIN user_departments ud ON ud.user_id = users.id
            LEFT JOIN departments d_all ON d_all.id = ud.department_id AND d_all.is_active = true
            WHERE ${whereClause}
            GROUP BY users.id, o.name, d.name
            ORDER BY users.created_at DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(limit, offset);

        const result = await query(usersQuery, queryParams);

        res.status(200).json({
            success: true,
            data: {
                users: result.rows.map(row => ({
                    ...new User({
                        ...row,
                        accessible_departments: row.accessible_departments
                    }).toJSON(),
                    organization_name: row.organization_name,
                    department_name: row.department_name,
                    department_names: row.department_names
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                },
                context: {
                    user_role: req.user.role,
                    filtered_organization_id: organization_id,
                    filtered_department_id: department_id || (req.user.role === 'department_head' ? req.user.department_id : null)
                }
            }
        });

    } catch (error) {
        logger.error('Get users failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve users'
        });
    }
});

// GET /api/users/context - Get current user's organizational context
router.get('/context', authenticate, async (req, res) => {
    try {
        const { query } = require('../config/database');
        const activeDepartmentId = req.activeDepartmentId || req.user.department_id;
        
        // Get user's organizational context
        const result = await query(`
            SELECT 
                u.id, u.username, u.role,
                o.id as organization_id, o.name as organization_name, o.description as organization_description,
                d.id as department_id, d.name as department_name, d.description as department_description,
                d.master_array_id
            FROM users u
            LEFT JOIN organizations o ON u.organization_id = o.id
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE u.id = $1 AND u.is_active = true
        `, [req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User context not found'
            });
        }

        const row = result.rows[0];
        const accessibleDepartments = await req.user.getAccessibleDepartments();
        const activeDepartment = accessibleDepartments.find((department) => department.id === activeDepartmentId) || null;
        
        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: row.id,
                    username: row.username,
                    role: row.role,
                    active_department_id: activeDepartmentId,
                    accessible_departments: accessibleDepartments
                },
                organization: row.organization_id ? {
                    id: row.organization_id,
                    name: row.organization_name,
                    description: row.organization_description
                } : null,
                department: activeDepartment ? {
                    id: activeDepartment.id,
                    name: activeDepartment.name,
                    description: activeDepartment.description,
                    master_array_id: activeDepartment.id === row.department_id ? row.master_array_id : null
                } : null
            }
        });

    } catch (error) {
        logger.error('Get user context failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user context'
        });
    }
});

// GET /api/users/department - Get users in current user's department
router.get('/department', authenticate, async (req, res) => {
    try {
        const { query } = require('../config/database');
        const activeDepartmentId = req.activeDepartmentId || req.user.department_id;
        const { role } = req.query;

        if (!activeDepartmentId) {
            return res.status(200).json({
                success: true,
                data: []
            });
        }
        
        let queryText = `
            SELECT DISTINCT u.id, u.username, u.email, u.role, u.created_at, u.is_active
            FROM users u
            JOIN user_departments ud ON ud.user_id = u.id
            WHERE ud.department_id = $1 AND u.is_active = true
        `;
        const params = [activeDepartmentId];

        if (role) {
            params.push(role);
            queryText += ` AND u.role = $2`;
        }

        queryText += ` ORDER BY username ASC`;

        const result = await query(queryText, params);

        res.status(200).json({
            success: true,
            data: result.rows.map(row => new User(row).toJSON())
        });

    } catch (error) {
        logger.error('Get department users failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve department users'
        });
    }
});

// GET /api/users/stats - Get user statistics (admin only)
router.get('/stats', authenticate, adminOnly, async (req, res) => {
    try {
        const { query } = require('../config/database');

        // Get user statistics
        const userStats = await query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_count,
                COUNT(CASE WHEN role = 'analyst' THEN 1 END) as analyst_count,
                COUNT(CASE WHEN role = 'viewer' THEN 1 END) as viewer_count,
                COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
                COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_users,
                COUNT(CASE WHEN last_login > CURRENT_TIMESTAMP - INTERVAL '30 days' THEN 1 END) as active_last_30_days
            FROM users
        `);

        // Get recent registrations
        const recentRegistrations = await query(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM users 
            WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `);

        // Get operation statistics
        const operationStats = await query(`
            SELECT 
                operation_type,
                COUNT(*) as count,
                COUNT(CASE WHEN success = true THEN 1 END) as successful,
                COUNT(CASE WHEN success = false THEN 1 END) as failed
            FROM operation_history 
            WHERE timestamp > CURRENT_TIMESTAMP - INTERVAL '30 days'
            GROUP BY operation_type
            ORDER BY count DESC
        `);

        res.status(200).json({
            success: true,
            data: {
                userStats: userStats.rows[0],
                recentRegistrations: recentRegistrations.rows,
                operationStats: operationStats.rows
            }
        });

    } catch (error) {
        logger.error('Get user stats failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user statistics'
        });
    }
});

// GET /api/users/search - Search users (admin only)
router.get('/search', authenticate, adminOnly, validateSearchUsers, async (req, res) => {
    try {
        const { q, role, status, page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const { query } = require('../config/database');

        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        // Build search conditions
        if (q) {
            whereConditions.push(`(username ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
            queryParams.push(`%${q}%`);
            paramIndex++;
        }

        if (role && ['admin', 'analyst', 'viewer'].includes(role)) {
            whereConditions.push(`role = $${paramIndex}`);
            queryParams.push(role);
            paramIndex++;
        }

        if (status === 'active') {
            whereConditions.push('is_active = true');
        } else if (status === 'inactive') {
            whereConditions.push('is_active = false');
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Get total count
        const countQuery = `SELECT COUNT(*) FROM users ${whereClause}`;
        const countResult = await query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].count);

        // Get paginated results
        const searchQuery = `
            SELECT id, username, email, role, created_at, last_login, is_active 
            FROM users 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(limit, offset);

        const result = await query(searchQuery, queryParams);
        const users = result.rows.map(row => new User(row));

        res.status(200).json({
            success: true,
            data: {
                users: users.map(user => user.toJSON()),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                searchParams: { q, role, status }
            }
        });

    } catch (error) {
        logger.error('Search users failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to search users'
        });
    }
});

// POST /api/users - Create new user (admin only)
router.post('/', authenticate, departmentHeadOrAdmin, validateRegister, async (req, res) => {
    try {
        const { username, email, password, role } = req.body;
        const clientInfo = getClientInfo(req);

        const result = await authService.register(
            { username, email, password, role },
            clientInfo.ipAddress,
            clientInfo.userAgent
        );

        // Log admin action
        await authService.logOperation(req.user.id, 'USER_CREATE', {
            ...clientInfo,
            targetUserId: result.user.id,
            targetUsername: result.user.username,
            assignedRole: role
        });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                user: result.user
            }
        });

    } catch (error) {
        logger.error('Create user failed:', error.message);
        
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
            error: 'User Creation Failed',
            message: 'Failed to create user. Please try again.'
        });
    }
});

// PUT /api/users/:id/role - Update user role (admin only)
router.put('/:id/role', authenticate, adminOnly, validateUUID, validateUpdateRole, async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        const clientInfo = getClientInfo(req);

        // Prevent admin from changing their own role
        if (id === req.user.id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cannot change your own role'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const oldRole = user.role;
        await user.updateRole(role);

        // Log admin action
        await authService.logOperation(req.user.id, 'USER_ROLE_UPDATE', {
            ...clientInfo,
            targetUserId: user.id,
            targetUsername: user.username,
            oldRole,
            newRole: role
        });

        res.status(200).json({
            success: true,
            message: 'User role updated successfully',
            data: {
                user: user.toJSON()
            }
        });

    } catch (error) {
        logger.error('Update user role failed:', error.message);
        
        res.status(500).json({
            error: 'Role Update Failed',
            message: 'Failed to update user role'
        });
    }
});

// PUT /api/users/:id/status - Activate/deactivate user (admin only)
router.put('/:id/status', authenticate, adminOnly, validateUUID, validateUpdateStatus, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        const clientInfo = getClientInfo(req);

        // Prevent admin from deactivating themselves
        if (id === req.user.id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cannot change your own status'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        if (is_active) {
            await user.activate();
        } else {
            await user.deactivate();
            // Invalidate all sessions for deactivated user
            await authService.invalidateAllUserSessions(user.id);
        }

        // Log admin action
        await authService.logOperation(req.user.id, 'USER_STATUS_UPDATE', {
            ...clientInfo,
            targetUserId: user.id,
            targetUsername: user.username,
            newStatus: is_active ? 'active' : 'inactive'
        });

        res.status(200).json({
            success: true,
            message: `User ${is_active ? 'activated' : 'deactivated'} successfully`,
            data: {
                user: user.toJSON()
            }
        });

    } catch (error) {
        logger.error('Update user status failed:', error.message);
        
        res.status(500).json({
            error: 'Status Update Failed',
            message: 'Failed to update user status'
        });
    }
});

// GET /api/users/:id/history - Get user operation history (admin only)
router.get('/:id/history', authenticate, adminOnly, validateUUID, validatePagination, async (req, res) => {
    try {
        const { id } = req.params;
        const { page, limit } = req.query;
        const offset = (page - 1) * limit;

        const { query } = require('../config/database');

        // Verify user exists
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        // Get total count
        const countResult = await query(
            'SELECT COUNT(*) FROM operation_history WHERE user_id = $1',
            [id]
        );
        const total = parseInt(countResult.rows[0].count);

        // Get paginated history
        const result = await query(
            `SELECT operation_type, operation_details, timestamp, ip_address, user_agent, success
             FROM operation_history 
             WHERE user_id = $1 
             ORDER BY timestamp DESC 
             LIMIT $2 OFFSET $3`,
            [id, limit, offset]
        );

        res.status(200).json({
            success: true,
            data: {
                user: user.toJSON(),
                history: result.rows,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get user history failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user history'
        });
    }
});

// GET /api/users/me/profile - Get current user profile (authenticated users)
router.get('/me/profile', authenticate, async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: {
                user: req.user.toJSON()
            }
        });

    } catch (error) {
        logger.error('Get profile failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve profile'
        });
    }
});

// PUT /api/users/me/profile - Update current user profile (authenticated users)
router.put('/me/profile', authenticate, validateUpdateProfile, async (req, res) => {
    try {
        const { email } = req.body;
        const clientInfo = getClientInfo(req);

        if (email) {
            // Check if email is already taken by another user
            const existingUser = await User.findByEmail(email);
            if (existingUser && existingUser.id !== req.user.id) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'Email already exists'
                });
            }

            // Update email
            const { query } = require('../config/database');
            await query(
                'UPDATE users SET email = $1 WHERE id = $2',
                [email, req.user.id]
            );

            req.user.email = email;
        }

        // Log operation
        await authService.logOperation(req.user.id, 'PROFILE_UPDATE', {
            ...clientInfo,
            updatedFields: Object.keys(req.body)
        });

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: req.user.toJSON()
            }
        });

    } catch (error) {
        logger.error('Update profile failed:', error.message);
        
        if (error.code === '23505') { // PostgreSQL unique constraint violation
            return res.status(409).json({
                error: 'Conflict',
                message: 'Email already exists'
            });
        }

        res.status(500).json({
            error: 'Profile Update Failed',
            message: 'Failed to update profile'
        });
    }
});

// GET /api/users/me/history - Get current user's operation history
router.get('/me/history', authenticate, validatePagination, async (req, res) => {
    try {
        const { page, limit } = req.query;
        const offset = (page - 1) * limit;

        const { query } = require('../config/database');

        // Get total count
        const countResult = await query(
            'SELECT COUNT(*) FROM operation_history WHERE user_id = $1',
            [req.user.id]
        );
        const total = parseInt(countResult.rows[0].count);

        // Get paginated history
        const result = await query(
            `SELECT operation_type, operation_details, timestamp, ip_address, success
             FROM operation_history 
             WHERE user_id = $1 
             ORDER BY timestamp DESC 
             LIMIT $2 OFFSET $3`,
            [req.user.id, limit, offset]
        );

        res.status(200).json({
            success: true,
            data: {
                history: result.rows,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get user history failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve history'
        });
    }
});

// POST /api/users/:id/reset-password - Reset user password (admin only)
router.post('/:id/reset-password', authenticate, adminOnly, validateUUID, validateResetPassword, async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        const clientInfo = getClientInfo(req);

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Password must be at least 8 characters long'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        // Change password
        await user.changePassword(newPassword);

        // Invalidate all user sessions to force re-login
        await authService.invalidateAllUserSessions(user.id);

        // Log admin action
        await authService.logOperation(req.user.id, 'PASSWORD_RESET', {
            ...clientInfo,
            targetUserId: user.id,
            targetUsername: user.username
        });

        res.status(200).json({
            success: true,
            message: 'Password reset successfully. User must login again.'
        });

    } catch (error) {
        logger.error('Reset password failed:', error.message);
        
        res.status(500).json({
            error: 'Password Reset Failed',
            message: 'Failed to reset password'
        });
    }
});

// GET /api/users/search - Search users (admin only)
router.get('/search', authenticate, adminOnly, validateSearchUsers, async (req, res) => {
    try {
        const { q, role, status, page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const { query } = require('../config/database');

        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        // Build search conditions
        if (q) {
            whereConditions.push(`(username ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
            queryParams.push(`%${q}%`);
            paramIndex++;
        }

        if (role && ['admin', 'analyst', 'viewer'].includes(role)) {
            whereConditions.push(`role = $${paramIndex}`);
            queryParams.push(role);
            paramIndex++;
        }

        if (status === 'active') {
            whereConditions.push('is_active = true');
        } else if (status === 'inactive') {
            whereConditions.push('is_active = false');
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Get total count
        const countQuery = `SELECT COUNT(*) FROM users ${whereClause}`;
        const countResult = await query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].count);

        // Get paginated results
        const searchQuery = `
            SELECT id, username, email, role, created_at, last_login, is_active 
            FROM users 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(limit, offset);

        const result = await query(searchQuery, queryParams);
        const users = result.rows.map(row => new User(row));

        res.status(200).json({
            success: true,
            data: {
                users: users.map(user => user.toJSON()),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                searchParams: { q, role, status }
            }
        });

    } catch (error) {
        logger.error('Search users failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to search users'
        });
    }
});

// PUT /api/users/:id - Update user (admin only)
router.put('/:id', authenticate, departmentHeadOrAdmin, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, email, role, organization_id, department_id, department_ids } = req.body;
        const clientInfo = getClientInfo(req);
        const requestedDepartmentIds = Array.isArray(department_ids)
            ? [...new Set(department_ids.filter(Boolean))]
            : (department_id ? [department_id] : undefined);

        // Prevent admin from changing their own role to non-admin
        if (id === req.user.id && role && role !== 'admin') {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cannot change your own role from admin'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const { query } = require('../config/database');
        
        // Build update query dynamically
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (username && username !== user.username) {
            updates.push(`username = $${paramIndex}`);
            values.push(username);
            paramIndex++;
        }

        if (email && email !== user.email) {
            // Check if email is already taken
            const existingUser = await User.findByEmail(email);
            if (existingUser && existingUser.id !== id) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'Email already exists'
                });
            }
            updates.push(`email = $${paramIndex}`);
            values.push(email);
            paramIndex++;
        }

        if (role && role !== user.role) {
            updates.push(`role = $${paramIndex}`);
            values.push(role);
            paramIndex++;
        }

        if (organization_id !== undefined) {
            updates.push(`organization_id = $${paramIndex}`);
            values.push(organization_id || null);
            paramIndex++;
        }

        if (updates.length === 0) {
            if (requestedDepartmentIds === undefined) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'No fields to update'
                });
            }
        }

        let updatedUser = user;

        if (updates.length > 0) {
            // Add user ID for WHERE clause
            values.push(id);
            const updateQuery = `
                UPDATE users 
                SET ${updates.join(', ')} 
                WHERE id = $${paramIndex}
                RETURNING id, username, email, role, organization_id, department_id, created_at, is_active
            `;

            const result = await query(updateQuery, values);
            updatedUser = new User(result.rows[0]);
        }

        if (requestedDepartmentIds !== undefined) {
            await updatedUser.syncAccessibleDepartments(requestedDepartmentIds, organization_id);
        } else {
            await updatedUser.getAccessibleDepartments();
        }

        // If role changed, invalidate all user sessions
        if ((role && role !== user.role) || requestedDepartmentIds !== undefined) {
            await authService.invalidateAllUserSessions(id);
        }

        // Log admin action
        await authService.logOperation(req.user.id, 'USER_UPDATE', {
            ...clientInfo,
            targetUserId: id,
            targetUsername: user.username,
            updatedFields: Object.keys(req.body)
        });

        res.status(200).json({
            success: true,
            message: 'User updated successfully',
            data: {
                user: updatedUser.toJSON()
            }
        });

    } catch (error) {
        logger.error('Update user failed:', error.message);
        
        if (error.code === '23505') { // PostgreSQL unique constraint violation
            return res.status(409).json({
                error: 'Conflict',
                message: 'Username or email already exists'
            });
        }

        res.status(500).json({
            error: 'User Update Failed',
            message: 'Failed to update user'
        });
    }
});

// POST /api/users/:id/deactivate - Deactivate user (admin only)
router.post('/:id/deactivate', authenticate, departmentHeadOrAdmin, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;
        const clientInfo = getClientInfo(req);

        // Prevent admin from deactivating themselves
        if (id === req.user.id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cannot deactivate your own account'
            });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        if (!user.is_active) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'User is already deactivated'
            });
        }

        await user.deactivate();
        
        // Invalidate all sessions for deactivated user
        await authService.invalidateAllUserSessions(id);

        // Log admin action
        await authService.logOperation(req.user.id, 'USER_DEACTIVATE', {
            ...clientInfo,
            targetUserId: id,
            targetUsername: user.username
        });

        res.status(200).json({
            success: true,
            message: 'User deactivated successfully',
            data: {
                user: user.toJSON()
            }
        });

    } catch (error) {
        logger.error('Deactivate user failed:', error.message);
        
        res.status(500).json({
            error: 'User Deactivation Failed',
            message: 'Failed to deactivate user'
        });
    }
});

// POST /api/users/:id/activate - Activate user (admin only)
router.post('/:id/activate', authenticate, departmentHeadOrAdmin, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;
        const clientInfo = getClientInfo(req);

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        if (user.is_active) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'User is already active'
            });
        }

        await user.activate();

        // Log admin action
        await authService.logOperation(req.user.id, 'USER_ACTIVATE', {
            ...clientInfo,
            targetUserId: id,
            targetUsername: user.username
        });

        res.status(200).json({
            success: true,
            message: 'User activated successfully',
            data: {
                user: user.toJSON()
            }
        });

    } catch (error) {
        logger.error('Activate user failed:', error.message);
        
        res.status(500).json({
            error: 'User Activation Failed',
            message: 'Failed to activate user'
        });
    }
});

// GET /api/users/:id/sessions - Get user sessions (admin only)
router.get('/:id/sessions', authenticate, departmentHeadOrAdmin, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        const { query } = require('../config/database');
        
        const result = await query(
            `SELECT id, expires_at, created_at, ip_address, user_agent, is_active
             FROM user_sessions 
             WHERE user_id = $1 AND is_active = true 
             ORDER BY created_at DESC`,
            [id]
        );

        res.status(200).json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        logger.error('Get user sessions failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user sessions'
        });
    }
});

// POST /api/users/:id/reset-password - Generate temporary password (admin only)
router.post('/:id/reset-password', authenticate, departmentHeadOrAdmin, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;
        const clientInfo = getClientInfo(req);

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        // Generate temporary password
        const temporaryPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
        
        // Change password
        await user.changePassword(temporaryPassword);

        // Invalidate all user sessions to force re-login
        await authService.invalidateAllUserSessions(id);

        // Log admin action
        await authService.logOperation(req.user.id, 'PASSWORD_RESET_ADMIN', {
            ...clientInfo,
            targetUserId: id,
            targetUsername: user.username
        });

        res.status(200).json({
            success: true,
            message: 'Password reset successfully',
            data: {
                temporaryPassword: temporaryPassword
            }
        });

    } catch (error) {
        logger.error('Reset password failed:', error.message);
        
        res.status(500).json({
            error: 'Password Reset Failed',
            message: 'Failed to reset password'
        });
    }
});
// GET /api/users/:id - Get specific user (admin only)
router.get('/:id', authenticate, departmentHeadOrAdmin, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;
        
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                user: user.toJSON()
            }
        });

    } catch (error) {
        logger.error('Get user failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve user'
        });
    }
});

module.exports = router;
