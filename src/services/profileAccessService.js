const { query } = require('../config/database');
const User = require('../models/User');

class ProfileAccessError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProfileAccessError';
        this.status = 403;
        this.code = 'PROFILE_ACCESS_DENIED';
    }
}

class ProfileAccessService {
    // Поиск, список и чтение UUID используют одно SQL-условие доступа.
    // Отделение обязательно передаётся явно; primary не заменяет active.
    static async getScope({ userId, activeDepartmentId, action = 'read', includeInactive = false }) {
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
            scope = await this.getScope(context);
        } catch (error) {
            if (error instanceof ProfileAccessError) return false;
            // Сбой БД не является отказом в доступе.
            throw error;
        }
        const params = [...scope.params, context.profileId];
        const result = await query(`SELECT 1 FROM dna_profiles dp WHERE ${scope.clause} AND dp.id = $${params.length}`, params);
        return result.rows.length > 0;
    }
}

module.exports = { ProfileAccessService, ProfileAccessError };
