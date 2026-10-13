const { query } = require('../../config/database');
const { logger } = require('../../utils/logger');
const User = require('../../models/User');
const rules = require('../../utils/accessPolicyRules');
const { getProfileUploadPermissions } = rules;
class ProfileAccessError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProfileAccessError';
        this.status = 403;
        this.code = 'PROFILE_ACCESS_DENIED';
    }
}
class ProfileUploadAccessError extends Error {
  constructor(message, code, status = 403) {
    super(message);
    this.name = 'ProfileUploadAccessError';
    this.code = code;
    this.status = status;
  }
}
// Единый серверный источник решений; транспорт и аудит остаются в middleware.
class AccessPolicyService {
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

    static async validateDataAccess(userId, dataType, dataId, activeDepartmentId, options = {}) {
        if (dataType === 'dna_profile') {
            return this.validateProfileAccess({
                userId, profileId: dataId, activeDepartmentId, ...options
            });
        }
        if (dataType === 'department') {
            const User = require("../../models/User");
            const user = await User.findById(userId);
            if (!user) return false;
            const departments = await user.getAccessibleDepartments();
            return departments.some(department => department.id === dataId &&
                (user.role === 'system_administrator' || department.organization_id === user.organization_id));
        }
        throw new Error(`Unsupported data access type: ${dataType}`);
    }

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
    static async getProfileScope({ userId, activeDepartmentId, action = 'read', includeInactive = false }) {
        const user = await User.findById(userId);
        if (!user || !activeDepartmentId) {
            throw new ProfileAccessError('Active department is required');
        }
        const departments = await user.getAccessibleDepartments();
        const department = departments.find(item => item.id === activeDepartmentId);
        if (!department || (user.role !== 'system_administrator' && department.organization_id !== user.organization_id)) {
            throw new ProfileAccessError('Selected department is not available for this user');
        }

        const departmentRoles = ['admin', 'system_administrator', 'department_head'];
        const userRoles = ['user_analyst', 'analyst', 'viewer'];
        if (!departmentRoles.includes(user.role) && !userRoles.includes(user.role)) {
            throw new ProfileAccessError('Insufficient profile permissions');
        }
        if (action !== 'read' && user.role === 'viewer') {
            throw new ProfileAccessError('Insufficient profile permissions');
        }

        const params = [department.id, department.organization_id];
        let clause = 'dp.department_id = $1 AND dp.organization_id = $2';
        if (!includeInactive) clause += ' AND dp.is_active = true';
        const departmentAccess = departmentRoles.includes(user.role);
        if (!departmentAccess) {
            params.push(user.id);
            // Сохраняем права аналитика/наблюдателя: собственные записи и
            // профили мастер-массива отделения. Запись разрешена только владельцу.
            clause += action === 'read'
                ? " AND (dp.user_id = $3 OR dp.profile_type = 'master')"
                : ' AND dp.user_id = $3';
        }
        return { clause, params, accessLevel: departmentAccess ? 'department' : 'user_and_department' };
    }

    static async validateProfileAccess(context) {
        let scope;
        try {
            scope = await this.getProfileScope(context);
        } catch (error) {
            if (error instanceof ProfileAccessError) return false;
            // Сбой БД не является отказом в доступе.
            throw error;
        }
        const params = [...scope.params, context.profileId];
        const result = await query(`SELECT 1 FROM dna_profiles dp WHERE ${scope.clause} AND dp.id = $${params.length}`, params);
        return result.rows.length > 0;
    }
    static async assertProfileUploadAllowed(user, context, options = {}) {
  const deny = (message, code, status) => { throw new ProfileUploadAccessError(message, code, status); };
  const execute = options.query || query;
  if (!rules.canUploadProfiles(user)) deny('У вас нет права загружать профили.', 'UPLOAD_FORBIDDEN');
  const permissions = getProfileUploadPermissions(user);
  if (context.uploadTarget && !['task', 'without_task'].includes(context.uploadTarget)) deny('Некорректное назначение загрузки.', 'INVALID_UPLOAD_TARGET', 400);
  if (context.taskId && context.uploadTarget === 'without_task') deny('Нельзя одновременно выбрать задачу и загрузку без задачи.', 'UPLOAD_TARGET_CONFLICT', 400);
  if (!context.taskId) {
    if (!permissions.can_upload_without_task) deny('Перед загрузкой выберите активную задачу. Загрузка без задачи для вашей учётной записи запрещена.', 'TASK_REQUIRED');
    if (context.uploadTarget !== 'without_task') deny('Выберите задачу для загрузки или явно выберите «Без задачи».', 'UPLOAD_TARGET_REQUIRED', 409);
    return;
  }
  if (!permissions.can_upload_with_task) deny('Загрузка профилей в задачу для вашей учётной записи запрещена.', 'TASK_UPLOAD_FORBIDDEN');
  if (typeof context.taskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.taskId)) deny('Некорректный идентификатор задачи.', 'INVALID_TASK_ID', 400);
  const result = await execute(`SELECT id, department_id, status, is_active FROM tasks WHERE id = $1${options.lockTask ? ' FOR SHARE' : ''}`, [context.taskId]);
  const task = result.rows[0];
  if (!task || !task.is_active) deny('Задача не найдена или недоступна.', 'TASK_NOT_FOUND', 404);
  if (task.department_id !== context.departmentId) deny('Выбранная задача относится к другому отделению.', 'TASK_DEPARTMENT_MISMATCH');
  if (!await this.canManageTask(user.id, task.id)) deny('Нет доступа к выбранной задаче.', 'TASK_ACCESS_DENIED');
  if (task.status !== 'in_progress') deny('Загрузка доступна только в задачу со статусом «В работе».', 'TASK_NOT_IN_PROGRESS', 409);
}

    static matchesRoles(user, roles) { return rules.matchesRoles(user, roles); }
    static getOperationRoles(operation) { return rules.OPERATION_ROLES[operation]; }
    static canReadHistory(user, target) { return rules.canReadHistory(user, target); }
    static canReadHistoryStats(user, target) { return rules.canReadHistoryStats(user, target); }
    static isResourceAdmin(user) { return user?.role === 'admin'; }
    static bypassesLegacyBoundary(user) { return user?.role === 'system_administrator'; }
    static canInitiateCrossDepartment(user) { return ['system_administrator', 'department_head'].includes(user?.role); }
    static organizationalContextMatches(first, second) { return first.organization_id === second.organization_id && first.department_id === second.department_id; }
    static resolveActiveDepartment(user, departments, requestedId) {
   const allowed = departments.filter(d => user.role === 'system_administrator' || d.organization_id === user.organization_id);
   if (requestedId && !allowed.some(d => d.id === requestedId)) throw new ProfileAccessError('Selected department is not available for this user');
   return requestedId || user.department_id || departments[0]?.id || null;
 }
 // Исторические middleware имеют отдельные контексты. Их права не расширяются.
    static async getLegacyOwnershipDecision(userId, userDepartmentId, resourceType, resourceId) {
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
                                        await this.isLegacyExpertGroupMember(userId, task.assigned_to_group));
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

                    default: return { unknownType: true };
                }


 return { hasAccess, resourceDepartmentId };
 }
    static async getLegacyMasterArray(masterArrayId) {
   return query('SELECT department_id, name FROM master_arrays WHERE id = $1 AND is_active = true', [masterArrayId]);
 }
    static async getLegacyTask(taskId) {
   return query('SELECT t.*, d.name as department_name FROM tasks t JOIN departments d ON t.department_id = d.id WHERE t.id = $1 AND t.is_active = true', [taskId]);
 }
    static async canReadLegacyTask(user, task) {
   return user.role === 'department_head' || task.created_by === user.id || task.assigned_to_user === user.id
     || !!task.assigned_to_group && await this.isLegacyExpertGroupMember(user.id, task.assigned_to_group);
 }
    static isOwnResource(user, ownerId) { return !!user && user.id === ownerId; }
    static shouldLogHistoryAccess(user, target) { return this.isResourceAdmin(user) && !!target && !this.isOwnResource(user, target); }
    static shouldRedactHistory(user) { return user?.role === 'viewer'; }
    static canCrossLegacyDepartmentBoundary(user, target) { return this.bypassesLegacyBoundary(user) || !target || this.isSameDepartment(target, user.department_id); }
    static isSameDepartment(first, second) { return first === second; }

    static async legacyValidateDataAccess(userId, userDepartmentId, dataType, dataId) {
        try {
            if (!dataId) return true; // No specific data to validate

            switch (dataType) {
                case 'profile':
                    return await this.legacyValidateProfileAccess(userId, userDepartmentId, dataId);

                case 'task':
                    return await this.legacyValidateTaskAccess(userId, userDepartmentId, dataId);

                case 'expert_group':
                    return await this.legacyValidateExpertGroupAccess(userId, userDepartmentId, dataId);

                case 'master_array':
                    return await this.legacyValidateMasterArrayAccess(userId, userDepartmentId, dataId);

                case 'department':
                    return await this.legacyValidateDepartmentAccess(userId, userDepartmentId, dataId);

                case 'user':
                    return await this.legacyValidateUserAccess(userId, userDepartmentId, dataId);

                default:
                    logger.warn(`Unknown data type for isolation validation: ${dataType}`);
                    return false;
            }
        } catch (error) {
            logger.error(`Error validating ${dataType} access:`, error);
            return false;
        }
    }

    static async legacyValidateProfileAccess(userId, userDepartmentId, profileId) {
        const result = await query(`
            SELECT dp.user_id, dp.profile_type, dp.master_array_id, u.department_id, ma.department_id as ma_dept_id
            FROM dna_profiles dp
            LEFT JOIN users u ON dp.user_id = u.id
            LEFT JOIN master_arrays ma ON dp.master_array_id = ma.id
            WHERE dp.id = $1 AND dp.is_active = true
        `, [profileId]);

        if (result.rows.length === 0) return false;

        const profile = result.rows[0];

        // User can access their own profiles
        if (profile.user_id === userId) return true;

        // User can access profiles in their department's master array
        if (profile.profile_type === 'master' && profile.ma_dept_id === userDepartmentId) {
            return true;
        }

        // User can access other user profiles in the same department (for analysis)
        if (profile.department_id === userDepartmentId) return true;

        return false;
    }

    static async legacyValidateTaskAccess(userId, userDepartmentId, taskId) {
        const result = await query(`
            SELECT department_id, created_by, assigned_to_user, assigned_to_group
            FROM tasks
            WHERE id = $1 AND is_active = true
        `, [taskId]);

        if (result.rows.length === 0) return false;

        const task = result.rows[0];

        // Task must be in user's department
        if (task.department_id !== userDepartmentId) return false;

        // Additional checks for task assignment
        if (task.created_by === userId) return true;
        if (task.assigned_to_user === userId) return true;

        // Check expert group membership
        if (task.assigned_to_group) {
            const groupResult = await query(`
                SELECT 1 FROM expert_group_members
                WHERE group_id = $1 AND user_id = $2
            `, [task.assigned_to_group, userId]);

            return groupResult.rows.length > 0;
        }

        return true; // Department members can view department tasks
    }

    static async legacyValidateExpertGroupAccess(userId, userDepartmentId, groupId) {
        const result = await query(`
            SELECT department_id FROM expert_groups
            WHERE id = $1 AND is_active = true
        `, [groupId]);

        if (result.rows.length === 0) return false;

        return result.rows[0].department_id === userDepartmentId;
    }

    static async legacyValidateMasterArrayAccess(userId, userDepartmentId, masterArrayId) {
        const result = await query(`
            SELECT department_id FROM master_arrays
            WHERE id = $1 AND is_active = true
        `, [masterArrayId]);

        if (result.rows.length === 0) return false;

        return result.rows[0].department_id === userDepartmentId;
    }

    static async legacyValidateDepartmentAccess(userId, userDepartmentId, departmentId) {
        return departmentId === userDepartmentId;
    }

    static async legacyValidateUserAccess(userId, userDepartmentId, targetUserId) {
        // Users can always access their own data
        if (targetUserId === userId) return true;

        const result = await query(`
            SELECT department_id FROM users
            WHERE id = $1 AND is_active = true
        `, [targetUserId]);

        if (result.rows.length === 0) return false;

        return result.rows[0].department_id === userDepartmentId;
    }

    static async legacyValidateSharedAccessToken(userId, token, targetDepartmentId) {
        try {
            // This would typically validate against a shared access tokens table
            // For now, we'll implement a basic validation
            const result = await query(`
                SELECT expires_at, granted_by, target_department_id
                FROM shared_access_tokens
                WHERE token = $1 AND user_id = $2 AND is_active = true
            `, [token, userId]);

            if (result.rows.length === 0) return false;

            const tokenData = result.rows[0];

            // Check if token is expired
            if (new Date() > new Date(tokenData.expires_at)) return false;

            // Check if token is for the correct department
            if (tokenData.target_department_id !== targetDepartmentId) return false;

            return true;
        } catch (error) {
            logger.error('Error validating shared access token:', error);
            return false;
        }
    }
    static async isLegacyExpertGroupMember(userId, groupId) {
        if (!groupId) return false;

        try {
            const result = await query(
                `SELECT 1 FROM expert_group_members
                 WHERE user_id = $1 AND group_id = $2 AND is_active = true`,
                [userId, groupId]
            );

            return result.rows.length > 0;
        } catch (error) {
            logger.error('Error checking expert group membership:', error);
            return false;
        }
    }
}
module.exports = AccessPolicyService;
Object.assign(module.exports, { AccessPolicyService, ProfileAccessError, ProfileUploadAccessError });
