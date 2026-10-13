const AccessPolicyService = require('../services/security/AccessPolicyService');
const { logger } = require('../utils/logger');
module.exports = {
requirePermission(action, resourceType) {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                if (!userId) {
                    return res.status(401).json({ error: 'Authentication required' });
                }

                const resourceId = req.params.id || req.body.id || null;
                const hasPermission = await AccessPolicyService.checkUserPermission(userId, action, resourceType, resourceId);

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
    },
requireDepartmentAccess() {
        return async (req, res, next) => {
            try {
                const userId = req.user?.id;
                const departmentId = req.params.departmentId || req.body.department_id;

                if (!userId || !departmentId) {
                    return res.status(400).json({ error: 'User ID and department ID required' });
                }

                const hasAccess = await AccessPolicyService.validateDataAccess(userId, 'department', departmentId);

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
};
