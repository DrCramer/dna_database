const express = require('express');
const { authenticate } = require('../middleware/auth');
const { logOperation } = require('../middleware/operationLogger');
const SettingsService = require('../services/settingsService');
const OperationHistory = require('../models/OperationHistory');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * Get user settings with organizational context
 * GET /api/settings
 */
router.get('/', 
    authenticate,
    logOperation(OperationHistory.OPERATION_TYPES.SETTINGS_UPDATE, (req, res, data) => ({
        operationDetails: { action: 'get_settings' },
        affectedResources: { user: req.user.id, department: req.user.departmentId || req.user.department_id }
    })),
    async (req, res) => {
        try {
            const userId = req.user.id;
            const departmentId = req.user.departmentId || req.user.department_id;

            const userSettings = await SettingsService.getUserSettings(userId, departmentId);

            res.json({
                success: true,
                data: userSettings
            });
        } catch (error) {
            logger.error('Error getting user settings', {
                error: error.message,
                userId: req.user?.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve settings'
            });
        }
    }
);

/**
 * Update user settings with organizational context
 * PUT /api/settings
 */
router.put('/', 
    authenticate,
    logOperation(OperationHistory.OPERATION_TYPES.SETTINGS_UPDATE, (req, res, data) => ({
        operationDetails: { 
            action: 'update_settings',
            updatedKeys: Object.keys(req.body || {})
        },
        affectedResources: { user: req.user.id, department: req.user.departmentId || req.user.department_id }
    })),
    async (req, res) => {
        try {
            const userId = req.user.id;
            const departmentId = req.user.departmentId || req.user.department_id;
            const newSettings = req.body;

            if (!newSettings || Object.keys(newSettings).length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No settings provided'
                });
            }

            const userContext = {
                userId,
                username: req.user.username,
                role: req.user.role,
                departmentId
            };

            const updatedSettings = await SettingsService.updateUserSettings(
                userId, 
                departmentId, 
                newSettings, 
                userContext
            );

            res.json({
                success: true,
                message: 'Settings updated successfully',
                data: updatedSettings
            });
        } catch (error) {
            logger.error('Error updating user settings', {
                error: error.message,
                userId: req.user?.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to update settings'
            });
        }
    }
);

/**
 * Get specific setting with organizational context
 * GET /api/settings/:key
 */
router.get('/:key', 
    authenticate,
    logOperation(OperationHistory.OPERATION_TYPES.SETTINGS_UPDATE, (req, res, data) => ({
        operationDetails: { action: 'get_setting', key: req.params.key },
        affectedResources: { user: req.user.id, department: req.user.departmentId || req.user.department_id }
    })),
    async (req, res) => {
        try {
            const userId = req.user.id;
            const departmentId = req.user.departmentId || req.user.department_id;
            const { key } = req.params;
            const { defaultValue } = req.query;

            const value = await SettingsService.getUserSetting(userId, departmentId, key, defaultValue);

            res.json({
                success: true,
                data: {
                    key,
                    value,
                    userId,
                    departmentId
                }
            });
        } catch (error) {
            logger.error('Error getting user setting', {
                error: error.message,
                userId: req.user?.id,
                key: req.params.key
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve setting'
            });
        }
    }
);

/**
 * Update specific setting with organizational context
 * PUT /api/settings/:key
 */
router.put('/:key', 
    authenticate,
    logOperation(OperationHistory.OPERATION_TYPES.SETTINGS_UPDATE, (req, res, data) => ({
        operationDetails: { 
            action: 'update_setting', 
            key: req.params.key,
            value: req.body.value
        },
        affectedResources: { user: req.user.id, department: req.user.departmentId || req.user.department_id }
    })),
    async (req, res) => {
        try {
            const userId = req.user.id;
            const departmentId = req.user.departmentId || req.user.department_id;
            const { key } = req.params;
            const { value } = req.body;

            if (value === undefined) {
                return res.status(400).json({
                    success: false,
                    error: 'Setting value is required'
                });
            }

            const userContext = {
                userId,
                username: req.user.username,
                role: req.user.role,
                departmentId
            };

            const updatedSettings = await SettingsService.updateUserSetting(
                userId, 
                departmentId, 
                key, 
                value, 
                userContext
            );

            res.json({
                success: true,
                message: 'Setting updated successfully',
                data: updatedSettings
            });
        } catch (error) {
            logger.error('Error updating user setting', {
                error: error.message,
                userId: req.user?.id,
                key: req.params.key
            });
            res.status(500).json({
                success: false,
                error: 'Failed to update setting'
            });
        }
    }
);

/**
 * Reset user settings to organizational defaults
 * POST /api/settings/reset
 */
router.post('/reset', 
    authenticate,
    logOperation(OperationHistory.OPERATION_TYPES.SETTINGS_UPDATE, (req, res, data) => ({
        operationDetails: { action: 'reset_settings' },
        affectedResources: { user: req.user.id, department: req.user.departmentId || req.user.department_id }
    })),
    async (req, res) => {
        try {
            const userId = req.user.id;
            const departmentId = req.user.departmentId || req.user.department_id;

            const userContext = {
                userId,
                username: req.user.username,
                role: req.user.role,
                departmentId
            };

            const resetSettings = await SettingsService.resetUserSettings(userId, departmentId, userContext);

            res.json({
                success: true,
                message: 'Settings reset to organizational defaults',
                data: resetSettings
            });
        } catch (error) {
            logger.error('Error resetting user settings', {
                error: error.message,
                userId: req.user?.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to reset settings'
            });
        }
    }
);

/**
 * Get organizational defaults for current department
 * GET /api/settings/organizational/defaults
 */
router.get('/organizational/defaults', 
    authenticate,
    logOperation(OperationHistory.OPERATION_TYPES.SETTINGS_UPDATE, (req, res, data) => ({
        operationDetails: { action: 'get_organizational_defaults' },
        affectedResources: { department: req.user.departmentId || req.user.department_id }
    })),
    async (req, res) => {
        try {
            const departmentId = req.user.departmentId || req.user.department_id;

            if (!departmentId) {
                return res.status(400).json({
                    success: false,
                    error: 'User not assigned to a department'
                });
            }

            const defaults = await SettingsService.getOrganizationalDefaults(departmentId);

            res.json({
                success: true,
                data: {
                    departmentId,
                    defaults
                }
            });
        } catch (error) {
            logger.error('Error getting organizational defaults', {
                error: error.message,
                userId: req.user?.id,
                departmentId: req.user?.departmentId || req.user?.department_id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve organizational defaults'
            });
        }
    }
);

module.exports = router;