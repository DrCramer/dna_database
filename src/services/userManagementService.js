const { query, transaction } = require('../config/database');
const User = require('../models/User');
const PermissionService = require('./permissionService');
const { logger } = require('../utils/logger');

class UserManagementService {
    // Create user with organizational context and hierarchy validation
    static async createUserWithHierarchy(creatorId, userData) {
        try {
            const creator = await User.findById(creatorId);
            if (!creator) {
                throw new Error('Creator not found');
            }

            const { username, email, password, role, organization_id, department_id } = userData;

            // Validate role assignment based on creator's role
            const canCreateRole = await this.validateRoleCreation(creator.role, role);
            if (!canCreateRole) {
                throw new Error(`Users with role ${creator.role} cannot create users with role ${role}`);
            }

            // Validate organizational context
            if (role === 'user_analyst' || role === 'department_head') {
                if (!department_id) {
                    throw new Error('Department assignment is required for this role');
                }

                // Validate department access for creator
                if (creator.role === 'department_head' && creator.department_id !== department_id) {
                    throw new Error('Department heads can only create users in their own department');
                }

                // Verify department exists and is active
                const deptResult = await query(
                    'SELECT id, organization_id FROM departments WHERE id = $1 AND is_active = true',
                    [department_id]
                );

                if (deptResult.rows.length === 0) {
                    throw new Error('Invalid or inactive department');
                }

                const actualOrgId = organization_id || deptResult.rows[0].organization_id;

                // Create user with organizational context
                const user = await User.create({
                    username,
                    email,
                    password,
                    role,
                    organization_id: actualOrgId,
                    department_id
                });

                logger.info(`User created by ${creator.username}: ${username} with role ${role} in department ${department_id}`);
                return user;
            } else {
                // Create user without organizational context (viewer, system_administrator)
                const user = await User.create({
                    username,
                    email,
                    password,
                    role
                });

                logger.info(`User created by ${creator.username}: ${username} with role ${role}`);
                return user;
            }
        } catch (error) {
            logger.error('Error creating user with hierarchy:', error);
            throw error;
        }
    }

    // Validate if a user can create another user with specific role
    static async validateRoleCreation(creatorRole, targetRole) {
        const roleHierarchy = {
            'system_administrator': ['system_administrator', 'department_head', 'user_analyst', 'viewer'],
            'department_head': ['user_analyst', 'viewer'],
            'user_analyst': [],
            'viewer': [],
            // Legacy compatibility
            'admin': ['system_administrator', 'department_head', 'user_analyst', 'viewer']
        };

        const allowedRoles = roleHierarchy[creatorRole] || [];
        return allowedRoles.includes(targetRole);
    }

    // Get users accessible to a specific user based on hierarchy
    static async getAccessibleUsers(userId, filters = {}) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            let query_text = `
                SELECT u.id, u.username, u.email, u.role, u.created_at, u.last_login, 
                       u.is_active, u.organization_id, u.department_id,
                       o.name as organization_name, d.name as department_name
                FROM users u
                LEFT JOIN organizations o ON u.organization_id = o.id
                LEFT JOIN departments d ON u.department_id = d.id
                WHERE u.is_active = true
            `;
            let params = [];
            let paramCount = 0;

            // Apply hierarchy-based filtering
            if (user.role === 'system_administrator' || user.role === 'admin') {
                // System administrators can see all users
            } else if (user.role === 'department_head') {
                // Department heads can see users in their department
                query_text += ` AND (u.department_id = $${++paramCount} OR u.id = $${++paramCount})`;
                params.push(user.department_id, userId);
            } else {
                // User analysts and viewers can only see themselves
                query_text += ` AND u.id = $${++paramCount}`;
                params.push(userId);
            }

            // Apply additional filters
            if (filters.role) {
                query_text += ` AND u.role = $${++paramCount}`;
                params.push(filters.role);
            }

            if (filters.department_id) {
                query_text += ` AND u.department_id = $${++paramCount}`;
                params.push(filters.department_id);
            }

            if (filters.search) {
                query_text += ` AND (u.username ILIKE $${++paramCount} OR u.email ILIKE $${++paramCount})`;
                const searchPattern = `%${filters.search}%`;
                params.push(searchPattern, searchPattern);
            }

            query_text += ' ORDER BY u.created_at DESC';

            // Apply pagination
            if (filters.limit) {
                query_text += ` LIMIT $${++paramCount}`;
                params.push(filters.limit);
            }

            if (filters.offset) {
                query_text += ` OFFSET $${++paramCount}`;
                params.push(filters.offset);
            }

            const result = await query(query_text, params);
            return result.rows;
        } catch (error) {
            logger.error('Error getting accessible users:', error);
            throw error;
        }
    }

    // Update user role with hierarchy validation
    static async updateUserRole(updaterId, targetUserId, newRole) {
        try {
            const updater = await User.findById(updaterId);
            const targetUser = await User.findById(targetUserId);

            if (!updater || !targetUser) {
                throw new Error('User not found');
            }

            // Validate role update permission
            const canUpdateRole = await this.validateRoleUpdate(updater, targetUser, newRole);
            if (!canUpdateRole) {
                throw new Error('Insufficient permissions to update user role');
            }

            // Update role
            await targetUser.updateRole(newRole);

            logger.info(`User role updated by ${updater.username}: ${targetUser.username} role changed to ${newRole}`);
            return targetUser;
        } catch (error) {
            logger.error('Error updating user role:', error);
            throw error;
        }
    }

    // Validate role update permissions
    static async validateRoleUpdate(updater, targetUser, newRole) {
        // System administrators can update any role
        if (updater.role === 'system_administrator' || updater.role === 'admin') {
            return true;
        }

        // Department heads can update roles within their department
        if (updater.role === 'department_head') {
            // Can only update users in same department
            if (updater.department_id !== targetUser.department_id) {
                return false;
            }

            // Can only assign user_analyst or viewer roles
            return ['user_analyst', 'viewer'].includes(newRole);
        }

        // User analysts and viewers cannot update roles
        return false;
    }

    // Assign user to department with validation
    static async assignUserToDepartment(assignerId, userId, departmentId) {
        try {
            const assigner = await User.findById(assignerId);
            const user = await User.findById(userId);

            if (!assigner || !user) {
                throw new Error('User not found');
            }

            // Validate assignment permission
            const canAssign = await this.validateDepartmentAssignment(assigner, departmentId);
            if (!canAssign) {
                throw new Error('Insufficient permissions to assign user to department');
            }

            // Verify department exists
            const deptResult = await query(
                'SELECT id, organization_id FROM departments WHERE id = $1 AND is_active = true',
                [departmentId]
            );

            if (deptResult.rows.length === 0) {
                throw new Error('Invalid or inactive department');
            }

            // Assign user to department and organization
            await user.assignToDepartment(departmentId);
            await user.assignToOrganization(deptResult.rows[0].organization_id);

            logger.info(`User assigned to department by ${assigner.username}: ${user.username} assigned to department ${departmentId}`);
            return user;
        } catch (error) {
            logger.error('Error assigning user to department:', error);
            throw error;
        }
    }

    // Validate department assignment permissions
    static async validateDepartmentAssignment(assigner, departmentId) {
        // System administrators can assign to any department
        if (assigner.role === 'system_administrator' || assigner.role === 'admin') {
            return true;
        }

        // Department heads can only assign to their own department
        if (assigner.role === 'department_head') {
            return assigner.department_id === departmentId;
        }

        return false;
    }

    // Get user management permissions for a user
    static async getUserManagementPermissions(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const permissions = {
                canCreateUsers: false,
                canUpdateRoles: false,
                canAssignDepartments: false,
                canDeactivateUsers: false,
                canViewAllUsers: false,
                allowedRolesToCreate: [],
                allowedRolesToAssign: []
            };

            switch (user.role) {
                case 'system_administrator':
                case 'admin':
                    permissions.canCreateUsers = true;
                    permissions.canUpdateRoles = true;
                    permissions.canAssignDepartments = true;
                    permissions.canDeactivateUsers = true;
                    permissions.canViewAllUsers = true;
                    permissions.allowedRolesToCreate = ['system_administrator', 'department_head', 'user_analyst', 'viewer'];
                    permissions.allowedRolesToAssign = ['system_administrator', 'department_head', 'user_analyst', 'viewer'];
                    break;

                case 'department_head':
                    permissions.canCreateUsers = true;
                    permissions.canUpdateRoles = true;
                    permissions.canAssignDepartments = false; // Only to their own department
                    permissions.canDeactivateUsers = true; // Only in their department
                    permissions.canViewAllUsers = false; // Only their department
                    permissions.allowedRolesToCreate = ['user_analyst', 'viewer'];
                    permissions.allowedRolesToAssign = ['user_analyst', 'viewer'];
                    break;

                case 'user_analyst':
                case 'viewer':
                default:
                    // No user management permissions
                    break;
            }

            return permissions;
        } catch (error) {
            logger.error('Error getting user management permissions:', error);
            throw error;
        }
    }

    // Deactivate user with hierarchy validation
    static async deactivateUser(deactivatorId, targetUserId) {
        try {
            const deactivator = await User.findById(deactivatorId);
            const targetUser = await User.findById(targetUserId);

            if (!deactivator || !targetUser) {
                throw new Error('User not found');
            }

            // Validate deactivation permission
            const canDeactivate = await this.validateUserDeactivation(deactivator, targetUser);
            if (!canDeactivate) {
                throw new Error('Insufficient permissions to deactivate user');
            }

            // Deactivate user
            await targetUser.deactivate();

            logger.info(`User deactivated by ${deactivator.username}: ${targetUser.username}`);
            return targetUser;
        } catch (error) {
            logger.error('Error deactivating user:', error);
            throw error;
        }
    }

    // Validate user deactivation permissions
    static async validateUserDeactivation(deactivator, targetUser) {
        // System administrators can deactivate any user
        if (deactivator.role === 'system_administrator' || deactivator.role === 'admin') {
            return true;
        }

        // Department heads can deactivate users in their department
        if (deactivator.role === 'department_head') {
            return deactivator.department_id === targetUser.department_id;
        }

        return false;
    }
}

module.exports = UserManagementService;