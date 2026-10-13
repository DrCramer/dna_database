// Совместимый API для существующих routes. Все решения принимает AccessPolicyService.
const AccessPolicyService = require('./AccessPolicyService');
class PermissionService extends AccessPolicyService {
 static requirePermission(...args) { return require('../../middleware/permissionChecks').requirePermission(...args); }
 static requireDepartmentAccess(...args) { return require('../../middleware/permissionChecks').requireDepartmentAccess(...args); }
}
module.exports = PermissionService;
