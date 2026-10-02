const express = require('express');
const router = express.Router();
const OperationHistory = require('../models/OperationHistory');
const { authenticateToken } = require('../middleware/auth');
const { checkPermission } = require('../middleware/accessControl');
const { validateRequest } = require('../middleware/validation');
const { logOperation } = require('../middleware/operationLogger');
const { logger } = require('../utils/logger');

/**
 * Get operation history for current user
 * GET /api/operation-history/my-history
 */
router.get('/my-history', 
    authenticateToken,
    logOperation(OperationHistory.OPERATION_TYPES.SYSTEM_NOTIFICATION, (req, res, data) => ({
        operationDetails: { action: 'view_own_history', recordsReturned: data?.history?.length || 0 },
        affectedResources: { user: req.user.id }
    })),
    async (req, res) => {
        try {
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

            if (operationType) options.operationType = operationType;
            if (startDate) options.startDate = new Date(startDate);
            if (endDate) options.endDate = new Date(endDate);

            const history = await OperationHistory.findByUserId(req.user.id, options);
            const total = await OperationHistory.countByUserId(req.user.id, options);

            res.json({
                success: true,
                history,
                pagination: {
                    total,
                    limit: options.limit,
                    offset: options.offset,
                    hasMore: (options.offset + options.limit) < total
                }
            });
        } catch (error) {
            logger.error('Error retrieving user operation history', {
                error: error.message,
                userId: req.user.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve operation history'
            });
        }
    }
);

/**
 * Get operation history for department (Department Head only)
 * GET /api/operation-history/department
 */
router.get('/department',
    authenticateToken,
    checkPermission('view_department_history'),
    logOperation(OperationHistory.OPERATION_TYPES.SYSTEM_NOTIFICATION, (req, res, data) => ({
        operationDetails: { 
            action: 'view_department_history', 
            departmentId: req.user.departmentId,
            recordsReturned: data?.history?.length || 0 
        },
        affectedResources: { department: req.user.departmentId }
    })),
    async (req, res) => {
        try {
            const { 
                limit = 100, 
                offset = 0, 
                operationType, 
                userId,
                startDate, 
                endDate 
            } = req.query;

            if (!req.user.departmentId) {
                return res.status(400).json({
                    success: false,
                    error: 'User not assigned to a department'
                });
            }

            const options = {
                limit: parseInt(limit),
                offset: parseInt(offset)
            };

            if (operationType) options.operationType = operationType;
            if (userId) options.userId = userId;
            if (startDate) options.startDate = new Date(startDate);
            if (endDate) options.endDate = new Date(endDate);

            const history = await OperationHistory.findByDepartmentId(req.user.departmentId, options);

            res.json({
                success: true,
                history,
                departmentId: req.user.departmentId,
                pagination: {
                    limit: options.limit,
                    offset: options.offset,
                    hasMore: history.length === options.limit
                }
            });
        } catch (error) {
            logger.error('Error retrieving department operation history', {
                error: error.message,
                userId: req.user.id,
                departmentId: req.user.departmentId
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve department operation history'
            });
        }
    }
);

/**
 * Get system-wide operation history (System Administrator only)
 * GET /api/operation-history/system
 */
router.get('/system',
    authenticateToken,
    checkPermission('view_system_history'),
    logOperation(OperationHistory.OPERATION_TYPES.SYSTEM_NOTIFICATION, (req, res, data) => ({
        operationDetails: { 
            action: 'view_system_history', 
            recordsReturned: data?.history?.length || 0 
        },
        affectedResources: { system: 'all' }
    })),
    async (req, res) => {
        try {
            const { 
                limit = 100, 
                offset = 0, 
                operationType, 
                userId,
                departmentId,
                startDate, 
                endDate 
            } = req.query;

            const options = {
                limit: parseInt(limit),
                offset: parseInt(offset)
            };

            if (operationType) options.operationType = operationType;
            if (userId) options.userId = userId;
            if (departmentId) options.departmentId = departmentId;
            if (startDate) options.startDate = new Date(startDate);
            if (endDate) options.endDate = new Date(endDate);

            const history = await OperationHistory.findAll(options);

            res.json({
                success: true,
                history,
                pagination: {
                    limit: options.limit,
                    offset: options.offset,
                    hasMore: history.length === options.limit
                }
            });
        } catch (error) {
            logger.error('Error retrieving system operation history', {
                error: error.message,
                userId: req.user.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve system operation history'
            });
        }
    }
);

/**
 * Get operation statistics for current user
 * GET /api/operation-history/my-stats
 */
router.get('/my-stats',
    authenticateToken,
    logOperation(OperationHistory.OPERATION_TYPES.SYSTEM_NOTIFICATION, (req, res, data) => ({
        operationDetails: { action: 'view_own_stats' },
        affectedResources: { user: req.user.id }
    })),
    async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            
            const options = {};
            if (startDate) options.startDate = new Date(startDate);
            if (endDate) options.endDate = new Date(endDate);

            const stats = await OperationHistory.getStatsByUserId(req.user.id, options);

            res.json({
                success: true,
                stats,
                userId: req.user.id
            });
        } catch (error) {
            logger.error('Error retrieving user operation statistics', {
                error: error.message,
                userId: req.user.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve operation statistics'
            });
        }
    }
);

/**
 * Get audit trail for compliance (System Administrator only)
 * GET /api/operation-history/audit-trail
 */
router.get('/audit-trail',
    authenticateToken,
    checkPermission('view_audit_trail'),
    logOperation(OperationHistory.OPERATION_TYPES.SYSTEM_NOTIFICATION, (req, res, data) => ({
        operationDetails: { 
            action: 'view_audit_trail',
            recordsReturned: data?.auditTrail?.length || 0
        },
        affectedResources: { system: 'audit' }
    })),
    async (req, res) => {
        try {
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

            const auditTrail = await OperationHistory.getAuditTrail(options);

            res.json({
                success: true,
                auditTrail,
                pagination: {
                    limit: options.limit,
                    offset: options.offset,
                    hasMore: auditTrail.length === options.limit
                }
            });
        } catch (error) {
            logger.error('Error retrieving audit trail', {
                error: error.message,
                userId: req.user.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve audit trail'
            });
        }
    }
);

/**
 * Get department audit trail (Department Head only)
 * GET /api/operation-history/department-audit
 */
router.get('/department-audit',
    authenticateToken,
    checkPermission('view_department_audit'),
    logOperation(OperationHistory.OPERATION_TYPES.SYSTEM_NOTIFICATION, (req, res, data) => ({
        operationDetails: { 
            action: 'view_department_audit',
            departmentId: req.user.departmentId,
            recordsReturned: data?.auditTrail?.length || 0
        },
        affectedResources: { department: req.user.departmentId }
    })),
    async (req, res) => {
        try {
            if (!req.user.departmentId) {
                return res.status(400).json({
                    success: false,
                    error: 'User not assigned to a department'
                });
            }

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

            const auditTrail = await OperationHistory.getDepartmentAuditTrail(req.user.departmentId, options);

            res.json({
                success: true,
                auditTrail,
                departmentId: req.user.departmentId,
                pagination: {
                    limit: options.limit,
                    offset: options.offset,
                    hasMore: auditTrail.length === options.limit
                }
            });
        } catch (error) {
            logger.error('Error retrieving department audit trail', {
                error: error.message,
                userId: req.user.id,
                departmentId: req.user.departmentId
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve department audit trail'
            });
        }
    }
);

module.exports = router;