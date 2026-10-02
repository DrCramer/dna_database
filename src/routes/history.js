const express = require('express');
const { authenticate, adminOnly } = require('../middleware/auth');
const { 
    checkHistoryAccess, 
    validateTargetUser, 
    logAdminHistoryAccess, 
    filterSensitiveData,
    checkStatsPermission 
} = require('../middleware/historyPermissions');
const OperationHistory = require('../models/OperationHistory');
const { logger } = require('../utils/logger');
const router = express.Router();

/**
 * Get operation history for the current user
 * GET /api/history
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            limit = 50,
            offset = 0,
            operationType,
            startDate,
            endDate
        } = req.query;

        // Parse dates if provided
        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        if (operationType) {
            options.operationType = operationType;
        }

        if (startDate) {
            options.startDate = new Date(startDate);
        }

        if (endDate) {
            options.endDate = new Date(endDate);
        }

        // Get operation history
        const operations = await OperationHistory.findByUserId(userId, options);
        const totalCount = await OperationHistory.countByUserId(userId, options);

        res.json({
            operations: operations.map(op => op.toJSON()),
            pagination: {
                total: totalCount,
                limit: options.limit,
                offset: options.offset,
                hasMore: (options.offset + operations.length) < totalCount
            }
        });

    } catch (error) {
        logger.error('Error fetching user operation history', {
            error: error.message,
            userId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch operation history'
        });
    }
});

/**
 * Get operation statistics for the current user
 * GET /api/history/stats
 */
router.get('/stats', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { startDate, endDate } = req.query;

        const options = {};
        if (startDate) {
            options.startDate = new Date(startDate);
        }
        if (endDate) {
            options.endDate = new Date(endDate);
        }

        const stats = await OperationHistory.getStatsByUserId(userId, options);

        res.json({
            statistics: stats,
            period: {
                startDate: options.startDate,
                endDate: options.endDate
            }
        });

    } catch (error) {
        logger.error('Error fetching user operation statistics', {
            error: error.message,
            userId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch operation statistics'
        });
    }
});

/**
 * Get all operation history (admin only)
 * GET /api/history/admin/all
 */
router.get('/admin/all', authenticate, adminOnly, async (req, res) => {
    try {
        const {
            limit = 100,
            offset = 0,
            operationType,
            userId,
            startDate,
            endDate
        } = req.query;

        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        if (operationType) {
            options.operationType = operationType;
        }

        if (userId) {
            options.userId = userId;
        }

        if (startDate) {
            options.startDate = new Date(startDate);
        }

        if (endDate) {
            options.endDate = new Date(endDate);
        }

        const operations = await OperationHistory.findAll(options);

        res.json({
            operations: operations.map(op => ({
                ...op.toJSON ? op.toJSON() : op,
                username: op.username,
                email: op.email
            })),
            pagination: {
                limit: options.limit,
                offset: options.offset,
                count: operations.length
            }
        });

    } catch (error) {
        logger.error('Error fetching all operation history', {
            error: error.message,
            userId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch operation history'
        });
    }
});

/**
 * Get operation history for a specific user (admin only)
 * GET /api/history/admin/user/:userId
 */
router.get('/admin/user/:userId', authenticate, adminOnly, validateTargetUser, logAdminHistoryAccess, filterSensitiveData, async (req, res) => {
    try {
        const { userId } = req.params;
        const {
            limit = 50,
            offset = 0,
            operationType,
            startDate,
            endDate
        } = req.query;

        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        if (operationType) {
            options.operationType = operationType;
        }

        if (startDate) {
            options.startDate = new Date(startDate);
        }

        if (endDate) {
            options.endDate = new Date(endDate);
        }

        const operations = await OperationHistory.findByUserId(userId, options);
        const totalCount = await OperationHistory.countByUserId(userId, options);

        res.json({
            operations: operations.map(op => op.toJSON()),
            pagination: {
                total: totalCount,
                limit: options.limit,
                offset: options.offset,
                hasMore: (options.offset + operations.length) < totalCount
            }
        });

    } catch (error) {
        logger.error('Error fetching user operation history (admin)', {
            error: error.message,
            targetUserId: req.params.userId,
            adminUserId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch user operation history'
        });
    }
});

/**
 * Get operation statistics for a specific user (admin only)
 * GET /api/history/admin/user/:userId/stats
 */
router.get('/admin/user/:userId/stats', authenticate, adminOnly, validateTargetUser, checkStatsPermission, logAdminHistoryAccess, async (req, res) => {
    try {
        const { userId } = req.params;
        const { startDate, endDate } = req.query;

        const options = {};
        if (startDate) {
            options.startDate = new Date(startDate);
        }
        if (endDate) {
            options.endDate = new Date(endDate);
        }

        const stats = await OperationHistory.getStatsByUserId(userId, options);

        res.json({
            statistics: stats,
            userId,
            period: {
                startDate: options.startDate,
                endDate: options.endDate
            }
        });

    } catch (error) {
        logger.error('Error fetching user operation statistics (admin)', {
            error: error.message,
            targetUserId: req.params.userId,
            adminUserId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch user operation statistics'
        });
    }
});

/**
 * Get available operation types
 * GET /api/history/operation-types
 */
router.get('/operation-types', authenticate, (req, res) => {
    res.json({
        operationTypes: Object.values(OperationHistory.OPERATION_TYPES),
        descriptions: {
            [OperationHistory.OPERATION_TYPES.LOGIN]: 'User login',
            [OperationHistory.OPERATION_TYPES.LOGOUT]: 'User logout',
            [OperationHistory.OPERATION_TYPES.PROFILE_UPLOAD]: 'DNA profile upload',
            [OperationHistory.OPERATION_TYPES.PROFILE_DELETE]: 'DNA profile deletion',
            [OperationHistory.OPERATION_TYPES.PROFILE_UPDATE]: 'DNA profile update',
            [OperationHistory.OPERATION_TYPES.DNA_ANALYSIS]: 'DNA profile analysis',
            [OperationHistory.OPERATION_TYPES.BULK_SEARCH]: 'Bulk DNA search',
            [OperationHistory.OPERATION_TYPES.EXPORT_RESULTS]: 'Results export',
            [OperationHistory.OPERATION_TYPES.USER_MANAGEMENT]: 'User management',
            [OperationHistory.OPERATION_TYPES.SETTINGS_UPDATE]: 'Settings update',
            [OperationHistory.OPERATION_TYPES.MASTER_ARRAY_UPDATE]: 'Master array update',
            [OperationHistory.OPERATION_TYPES.TASK_MANAGEMENT]: 'Task management',
            [OperationHistory.OPERATION_TYPES.DEPARTMENT_MANAGEMENT]: 'Department management',
            [OperationHistory.OPERATION_TYPES.ORGANIZATION_MANAGEMENT]: 'Organization management'
        }
    });
});

/**
 * Get operation history for current user's department (Department Head only)
 * GET /api/history/department
 */
router.get('/department', authenticate, async (req, res) => {
    try {
        // Check if user is department head
        if (req.user.role !== 'department_head') {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Only department heads can view department history'
            });
        }

        if (!req.user.departmentId && !req.user.department_id) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'User not assigned to a department'
            });
        }

        const departmentId = req.user.departmentId || req.user.department_id;
        const {
            limit = 100,
            offset = 0,
            operationType,
            userId,
            startDate,
            endDate
        } = req.query;

        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        if (operationType) options.operationType = operationType;
        if (userId) options.userId = userId;
        if (startDate) options.startDate = new Date(startDate);
        if (endDate) options.endDate = new Date(endDate);

        const operations = await OperationHistory.findByDepartmentId(departmentId, options);

        res.json({
            operations,
            departmentId,
            pagination: {
                limit: options.limit,
                offset: options.offset,
                count: operations.length,
                hasMore: operations.length === options.limit
            }
        });

    } catch (error) {
        logger.error('Error fetching department operation history', {
            error: error.message,
            userId: req.user?.id,
            departmentId: req.user?.departmentId || req.user?.department_id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch department operation history'
        });
    }
});

/**
 * Get department audit trail (Department Head only)
 * GET /api/history/department/audit
 */
router.get('/department/audit', authenticate, async (req, res) => {
    try {
        // Check if user is department head
        if (req.user.role !== 'department_head') {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Only department heads can view department audit trail'
            });
        }

        if (!req.user.departmentId && !req.user.department_id) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'User not assigned to a department'
            });
        }

        const departmentId = req.user.departmentId || req.user.department_id;
        const {
            startDate,
            endDate,
            operationTypes,
            includeUserDetails = true,
            limit = 1000,
            offset = 0
        } = req.query;

        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset),
            includeUserDetails: includeUserDetails === 'true'
        };

        if (startDate || endDate) {
            options.dateRange = {};
            if (startDate) options.dateRange.startDate = new Date(startDate);
            if (endDate) options.dateRange.endDate = new Date(endDate);
        }

        if (operationTypes) {
            options.operationTypes = Array.isArray(operationTypes) 
                ? operationTypes 
                : operationTypes.split(',');
        }

        const auditTrail = await OperationHistory.getDepartmentAuditTrail(departmentId, options);

        res.json({
            auditTrail,
            departmentId,
            pagination: {
                limit: options.limit,
                offset: options.offset,
                count: auditTrail.length,
                hasMore: auditTrail.length === options.limit
            }
        });

    } catch (error) {
        logger.error('Error fetching department audit trail', {
            error: error.message,
            userId: req.user?.id,
            departmentId: req.user?.departmentId || req.user?.department_id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch department audit trail'
        });
    }
});

/**
 * Get operation history for any user (with permission checking)
 * GET /api/history/user/:userId
 */
router.get('/user/:userId', authenticate, validateTargetUser, checkHistoryAccess, logAdminHistoryAccess, filterSensitiveData, async (req, res) => {
    try {
        const { userId } = req.params;
        const {
            limit = 50,
            offset = 0,
            operationType,
            startDate,
            endDate
        } = req.query;

        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        if (operationType) {
            options.operationType = operationType;
        }

        if (startDate) {
            options.startDate = new Date(startDate);
        }

        if (endDate) {
            options.endDate = new Date(endDate);
        }

        const operations = await OperationHistory.findByUserId(userId, options);
        const totalCount = await OperationHistory.countByUserId(userId, options);

        res.json({
            operations: operations.map(op => op.toJSON()),
            targetUser: {
                id: req.targetUser.id,
                username: req.targetUser.username,
                email: req.targetUser.email,
                role: req.targetUser.role
            },
            pagination: {
                total: totalCount,
                limit: options.limit,
                offset: options.offset,
                hasMore: (options.offset + operations.length) < totalCount
            }
        });

    } catch (error) {
        logger.error('Error fetching user operation history with permissions', {
            error: error.message,
            targetUserId: req.params.userId,
            requestingUserId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch operation history'
        });
    }
});

/**
 * Get operation statistics for any user (with permission checking)
 * GET /api/history/user/:userId/stats
 */
router.get('/user/:userId/stats', authenticate, validateTargetUser, checkStatsPermission, logAdminHistoryAccess, async (req, res) => {
    try {
        const { userId } = req.params;
        const { startDate, endDate } = req.query;

        const options = {};
        if (startDate) {
            options.startDate = new Date(startDate);
        }
        if (endDate) {
            options.endDate = new Date(endDate);
        }

        const stats = await OperationHistory.getStatsByUserId(userId, options);

        res.json({
            statistics: stats,
            targetUser: {
                id: req.targetUser.id,
                username: req.targetUser.username,
                role: req.targetUser.role
            },
            period: {
                startDate: options.startDate,
                endDate: options.endDate
            }
        });

    } catch (error) {
        logger.error('Error fetching user operation statistics with permissions', {
            error: error.message,
            targetUserId: req.params.userId,
            requestingUserId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch operation statistics'
        });
    }
});

module.exports = router;