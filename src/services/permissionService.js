const { query } = require('../config/database');
const { logger } = require('../utils/logger');

class PermissionService {
    // Role definitions with their permissions
    static ROLES = {
        system_administrator: {
            name: 'System Administrator',
            permissions: [
                'user:create', 'user:read', 'user:update', 'user:delete',
                'organization:create', 'organization:read', 'organization:update', 'organization:delete',
                'department:create', 'department:read', 'department:update', 'department:delete',
                'master_array:create', 'master_array:read', 'master_array:update', 'master_array:delete',
                'expert_group:create', 'expert_group:read', 'expert_group:update', 'expert_group:delete',
                'task:create', 'task:read', 'task:update', 'task:delete', 'task:approve',
                'profile:create', 'profile:read', 'profile:update', 'profile:delete',
                'analysis:run', 'analysis:read', 'analysis:export',
                'audit:read', 'audit:export',
                'system:backup', 'system:restore', 'system:settings'
            ],
            scope: 'global'
        },
        department_head: {
            name: 'Department Head',
            permissions: [
                'user:read', 'user:update',
                'department:read', 'department:update',
                'master_array:create', 'master_array:read', 'master_array:update', 'master_array:delete',
                'expert_group:create', 'expert_group:read', 'expert_group:update', 'expert_group:delete',
                'task:create', 'task:read', 'task:update', 'task:delete', 'task:approve',
                'profile:create', 'profile:read', 'profile:update', 'profile:delete',
                'analysis:run', 'analysis:read', 'analysis:export',
                'audit:read'
            ],
            scope: 'department'
        },
        user_analyst: {
            name: 'User Analyst',
            permissions: [
                'profile:create', 'profile:read', 'profile:update',
                'master_array:read',
                'task:read', 'task:update',
                'analysis:run', 'analysis:read', 'analysis:export'
            ],
            scope: 'user'
        },
        viewer: {
            name: 'Viewer',
            permissions: [
                'profile:read',
                'master_array:read',
                'task:read',
                'analysis:read'
            ],
            scope: 'user'
        }
    };

    // Resource types and their access patterns
    static RESOURCES = {
        user: { table: 'users', department_field: 'department_id' },
        organization: { table: 'organizations', department_field: null },
        department: { table: 'departments', department_field: 'id' },
        master_array: { table: 'master_arrays', department_field: 'department_id' },
        expert_group: { table: 'expert_groups', department_field: 'department_id' },
        task: { table: 'tasks', department_field: 'department_id' },
        profile: { table: 'dna_profiles', department_field: 'user_id' },
        analysis: { table: null, department_field: null },
        audit: { table: 'audit_logs', department_field: 'department_id' },
        system: { table: null, department_field: null }
    };

    // Check if user has specific permission
    static async checkUserPermission(userId, action, resourceType, resourceId = null) {
        try {
            // Get user details
            const userResult = await query(
                'SELECT id, role, department_id, organization_id FROM users WHERE id = $1 AND is_active = true',
                [userId]
            );

            if (userResult.rows.length === 0) {
                return false;
            }

            const user = userResult.rows[0];
            const userRole = this.ROLES[user.role];

            if (!userRole) {
                logger.warn(`Unknown role: ${user.role} for user: ${userId}`);
                return false;
            }

            // Check if user has the required permission
            const permission = `${resourceType}:${action}`;
            if (!userRole.permissions.includes(permission)) {
                return false;
            }

            // If no specific resource, permission is granted
            if (!resourceId) {
                return true;
            }

            // Check scope-based access
            return await this.validateResourceAccess(user, userRole.scope, resourceType, resourceId);
        } catch (error) {
            logger.error('Error checking user permission:', error);
            return false;
        }
    }

    // Validate access to specific resource based on scope
    static async validateResourceAccess(user, scope, resourceType, resourceId) {
        try {
            // System administrators have global access
            if (scope === 'global') {
                return true;
            }

            const resource = this.RESOURCES[resourceType];
            if (!resource || !resource.table) {
                // For resources without tables (like analysis), check department context
                return scope === 'department' || scope === 'user';
            }

            // For department scope, check if resource belongs to user's department
            if (scope === 'department') {
                if (resourceType === 'department') {
                    // Department heads can access their own department
                    return resourceId === user.department_id;
                }

                if (resource.department_field) {
                    const result = await query(
                        `SELECT ${resource.department_field} FROM ${resource.table} WHERE id = $1`,
                        [resourceId]
                    );

                    if (result.rows.length === 0) {
                        return false;
                    }

                    const resourceDepartmentId = result.rows[0][resource.department_field];
                    
                    // For user resources, check if user belongs to same department
                    if (resourceType === 'profile') {
                        const userDeptResult = await query(
                            'SELECT department_id FROM users WHERE id = $1',
                            [resourceDepartmentId]
                        );
                        return userDeptResult.rows.length > 0 && 
                               userDeptResult.rows[0].department_id === user.department_id;
                    }

                    return resourceDepartmentId === user.department_id;
                }
            }

            // For user scope, check if resource belongs to the user
            if (scope === 'user') {
                if (resourceType === 'profile') {
                    const result = await query(
                        'SELECT user_id FROM dna_profiles WHERE id = $1',
                        [resourceId]
                    );
                    return result.rows.length > 0 && result.rows[0].user_id === user.id;
                }

                if (resourceType === 'master_array') {
                    // User analysts can read their department's master array
                    const result = await query(
                        'SELECT department_id FROM master_arrays WHERE id = $1',
                        [resourceId]
                    );
                    return result.rows.length > 0 && result.rows[0].department_id === user.department_id;
                }

                if (resourceType === 'task') {
                    const result = await query(
                        `SELECT assigned_to_user, assigned_to_group FROM tasks WHERE id = $1`,
                        [resourceId]
                    );

                    if (result.rows.length === 0) {
                        return false;
                    }

                    const task = result.rows[0];
                    
                    // Check if directly assigned to user
                    if (task.assigned_to_user === user.id) {
                        return true;
                    }

                    // Check if assigned to user's expert group
                    if (task.assigned_to_group) {
                        const groupResult = await query(
                            `SELECT 1 FROM expert_group_members 
                             WHERE group_id = $1 AND user_id = $2 AND is_active = true`,
                            [task.assigned_to_group, user.id]
                        );
                        return groupResult.rows.length > 0;
                    }
                }
            }

            return false;
        } catch (error) {
            logger.error('Error validating resource access:', error);
            return false;
        }
    }

    // Get all resources user can access for a given type
    static async getUserAccessibleResources(userId, resourceType) {
        try {
            const userResult = await query(
                'SELECT role, department_id, organization_id FROM users WHERE id = $1 AND is_active = true',
                [userId]
            );

            if (userResult.rows.length === 0) {
                return [];
            }

            const user = userResult.rows[0];
            const userRole = this.ROLES[user.role];

            if (!userRole) {
                return [];
            }

            const resource = this.RESOURCES[resourceType];
            if (!resource || !resource.table) {
                return [];
            }

            let query_text = `SELECT * FROM ${resource.table} WHERE is_active = true`;
            let params = [];

            // Apply scope-based filtering
            if (userRole.scope === 'department' && resource.department_field) {
                if (resourceType === 'department') {
                    query_text += ' AND id = $1';
                    params.push(user.department_id);
                } else if (resourceType === 'profile') {
                    // For profiles, get all profiles from users in the same department
                    query_text += ` AND user_id IN (
                        SELECT id FROM users WHERE department_id = $1 AND is_active = true
                    )`;
                    params.push(user.department_id);
                } else {
                    query_text += ` AND ${resource.department_field} = $1`;
                    params.push(user.department_id);
                }
            } else if (userRole.scope === 'user') {
                if (resourceType === 'profile') {
                    query_text += ' AND user_id = $1';
                    params.push(userId);
                } else if (resourceType === 'task') {
                    query_text += ` AND (assigned_to_user = $1 OR assigned_to_group IN (
                        SELECT group_id FROM expert_group_members 
                        WHERE user_id = $1 AND is_active = true
                    ))`;
                    params.push(userId);
                }
            }

            const result = await query(query_text, params);
            return result.rows;
        } catch (error) {
            logger.error('Error getting user accessible resources:', error);
            return [];
        }
    }

    // Validate data access for department isolation
    static async validateDataAccess(userId, dataType, dataId) {
        try {
            // Use the database function for validation
            const result = await query(
                'SELECT validate_department_isolation($1, $2)',
                [userId, dataId]
            );

            return result.rows[0].validate_department_isolation;
        } catch (error) {
            logger.error('Error validating data access:', error);
            return false;
        }
    }

    // Get effective permissions for a user
    static async getEffectivePermissions(userId) {
        try {
            const userResult = await query(
                'SELECT role, department_id, organization_id FROM users WHERE id = $1 AND is_active = true',
                [userId]
            );

            if (userResult.rows.length === 0) {
                return { permissions: [], scope: null, role: null };
            }

            const user = userResult.rows[0];
            const userRole = this.ROLES[user.role];

            if (!userRole) {
                return { permissions: [], scope: null, role: user.role };
            }

            return {
                permissions: userRole.permissions,
                scope: userRole.scope,
                role: user.role,
                department_id: user.department_id,
                organization_id: user.organization_id
            };
        } catch (error) {
            logger.error('Error getting effective permissions:', error);
            return { permissions: [], scope: null, role: null };
        }
    }

    // Check if user can access master array
    static async canAccessMasterArray(userId, masterArrayId) {
        try {
            const result = await query(
                `SELECT ma.department_id, u.department_id as user_department_id, u.role
                 FROM master_arrays ma, users u
                 WHERE ma.id = $1 AND u.id = $2 AND ma.is_active = true AND u.is_active = true`,
                [masterArrayId, userId]
            );

            if (result.rows.length === 0) {
                return false;
            }

            const { department_id, user_department_id, role } = result.rows[0];

            // System administrators can access any master array
            if (role === 'system_administrator') {
                return true;
            }

            // Users can only access their department's master array
            return department_id === user_department_id;
        } catch (error) {
            logger.error('Error checking master array access:', error);
            return false;
        }
    }

    // Check if user can manage task
    static async canManageTask(userId, taskId) {
        try {
            const result = await query(
                `SELECT t.department_id, t.created_by, t.assigned_to_user, t.assigned_to_group,
                        u.role
                 FROM tasks t, users u
                 WHERE t.id = $1 AND u.id = $2 AND t.is_active = true AND u.is_active = true`,
                [taskId, userId]
            );

            if (result.rows.length === 0) {
                return false;
            }

            const task = result.rows[0];

            // System administrators and admins can manage any task
            if (task.role === 'system_administrator' || task.role === 'admin') {
                return true;
            }

            // Department heads can manage tasks in their department
            if (task.role === 'department_head') {
                const departmentAccessResult = await query(
                    `SELECT 1
                     FROM user_departments
                     WHERE user_id = $1 AND department_id = $2`,
                    [userId, task.department_id]
                );

                if (departmentAccessResult.rows.length > 0) {
                    return true;
                }
            }

            // Task creators can manage their tasks
            if (task.created_by === userId) {
                return true;
            }

            // Assigned users can manage their tasks
            if (task.assigned_to_user === userId) {
                return true;
            }

            // Expert group members can manage group tasks
            if (task.assigned_to_group) {
                const groupResult = await query(
                    `SELECT 1 FROM expert_group_members 
                     WHERE group_id = $1 AND user_id = $2 AND is_active = true`,
                    [task.assigned_to_group, userId]
                );
                return groupResult.rows.length > 0;
            }

            return false;
        } catch (error) {
            logger.error('Error checking task management access:', error);
            return false;
        }
    }

    // Middleware function for route protection
    static requirePermission(action, resourceType) {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                if (!userId) {
                    return res.status(401).json({ error: 'Authentication required' });
                }

                const resourceId = req.params.id || req.body.id || null;
                const hasPermission = await this.checkUserPermission(userId, action, resourceType, resourceId);

                if (!hasPermission) {
                    logger.warn(`Permission denied: User ${userId} attempted ${action} on ${resourceType}:${resourceId}`);
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }

                next();
            } catch (error) {
                logger.error('Error in permission middleware:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }

    // Middleware for department isolation
    static requireDepartmentAccess() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const departmentId = req.params.departmentId || req.body.department_id;

                if (!userId || !departmentId) {
                    return res.status(400).json({ error: 'User ID and department ID required' });
                }

                const hasAccess = await this.validateDataAccess(userId, 'department', departmentId);

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
}

module.exports = PermissionService;
