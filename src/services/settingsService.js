const UserSettings = require('../models/UserSettings');
const OperationHistory = require('../models/OperationHistory');
const { logger } = require('../utils/logger');

class SettingsService {
    /**
     * Get user settings with organizational context
     * @param {string} userId - User ID
     * @param {string} departmentId - Department ID for organizational context
     * @returns {Promise<Object>} User settings with organizational defaults
     */
    static async getUserSettings(userId, departmentId = null) {
        try {
            const userSettings = await UserSettings.findByUserId(userId);
            let settings = userSettings ? userSettings.settings : {};

            // Merge with default settings
            settings = this.mergeWithDefaults(settings);

            // Apply organizational context if available
            if (departmentId) {
                settings = await this.applyOrganizationalContext(settings, departmentId);
            }

            return {
                userId,
                departmentId,
                settings,
                lastUpdated: userSettings?.updatedAt || null
            };
        } catch (error) {
            logger.error('Error getting user settings with organizational context', {
                error: error.message,
                userId,
                departmentId
            });
            throw error;
        }
    }

    /**
     * Update user settings with organizational context validation
     * @param {string} userId - User ID
     * @param {string} departmentId - Department ID
     * @param {Object} newSettings - New settings to apply
     * @param {Object} userContext - User context for logging
     * @returns {Promise<Object>} Updated settings
     */
    static async updateUserSettings(userId, departmentId, newSettings, userContext = {}) {
        try {
            // Validate settings against organizational policies
            const validatedSettings = await this.validateOrganizationalSettings(newSettings, departmentId);

            // Get current settings
            const currentSettings = await UserSettings.findByUserId(userId);
            const currentSettingsData = currentSettings ? currentSettings.settings : {};

            // Merge with current settings
            const mergedSettings = this.deepMerge(currentSettingsData, validatedSettings);

            // Update settings
            const updatedSettings = await UserSettings.upsert(userId, mergedSettings);

            // Log the operation with organizational context
            await this.logSettingsOperation(userId, departmentId, {
                action: 'update_settings',
                updatedKeys: Object.keys(newSettings),
                previousSettings: currentSettingsData,
                newSettings: mergedSettings
            }, userContext);

            return {
                userId,
                departmentId,
                settings: mergedSettings,
                lastUpdated: updatedSettings.updatedAt
            };
        } catch (error) {
            logger.error('Error updating user settings with organizational context', {
                error: error.message,
                userId,
                departmentId
            });
            throw error;
        }
    }

    /**
     * Get specific setting with organizational context
     * @param {string} userId - User ID
     * @param {string} departmentId - Department ID
     * @param {string} key - Setting key
     * @param {any} defaultValue - Default value
     * @returns {Promise<any>} Setting value
     */
    static async getUserSetting(userId, departmentId, key, defaultValue = null) {
        try {
            const userSettings = await this.getUserSettings(userId, departmentId);
            return this.getNestedValue(userSettings.settings, key, defaultValue);
        } catch (error) {
            logger.error('Error getting user setting with organizational context', {
                error: error.message,
                userId,
                departmentId,
                key
            });
            return defaultValue;
        }
    }

    /**
     * Update specific setting with organizational context
     * @param {string} userId - User ID
     * @param {string} departmentId - Department ID
     * @param {string} key - Setting key
     * @param {any} value - Setting value
     * @param {Object} userContext - User context for logging
     * @returns {Promise<Object>} Updated settings
     */
    static async updateUserSetting(userId, departmentId, key, value, userContext = {}) {
        try {
            const settingUpdate = {};
            this.setNestedValue(settingUpdate, key, value);

            return await this.updateUserSettings(userId, departmentId, settingUpdate, userContext);
        } catch (error) {
            logger.error('Error updating user setting with organizational context', {
                error: error.message,
                userId,
                departmentId,
                key
            });
            throw error;
        }
    }

    /**
     * Reset user settings to organizational defaults
     * @param {string} userId - User ID
     * @param {string} departmentId - Department ID
     * @param {Object} userContext - User context for logging
     * @returns {Promise<Object>} Reset settings
     */
    static async resetUserSettings(userId, departmentId, userContext = {}) {
        try {
            const defaultSettings = await this.getOrganizationalDefaults(departmentId);
            
            const updatedSettings = await UserSettings.upsert(userId, defaultSettings);

            // Log the operation
            await this.logSettingsOperation(userId, departmentId, {
                action: 'reset_settings',
                resetToDefaults: true
            }, userContext);

            return {
                userId,
                departmentId,
                settings: defaultSettings,
                lastUpdated: updatedSettings.updatedAt
            };
        } catch (error) {
            logger.error('Error resetting user settings', {
                error: error.message,
                userId,
                departmentId
            });
            throw error;
        }
    }

    /**
     * Merge settings with defaults
     * @param {Object} userSettings - User settings
     * @returns {Object} Merged settings
     */
    static mergeWithDefaults(userSettings) {
        return this.deepMerge(UserSettings.DEFAULT_SETTINGS, userSettings);
    }

    /**
     * Apply organizational context to settings
     * @param {Object} settings - Current settings
     * @param {string} departmentId - Department ID
     * @returns {Promise<Object>} Settings with organizational context
     */
    static async applyOrganizationalContext(settings, departmentId) {
        try {
            // Get organizational defaults/overrides
            const orgDefaults = await this.getOrganizationalDefaults(departmentId);
            
            // Apply organizational constraints
            return this.deepMerge(orgDefaults, settings);
        } catch (error) {
            logger.error('Error applying organizational context to settings', {
                error: error.message,
                departmentId
            });
            return settings;
        }
    }

    /**
     * Validate settings against organizational policies
     * @param {Object} settings - Settings to validate
     * @param {string} departmentId - Department ID
     * @returns {Promise<Object>} Validated settings
     */
    static async validateOrganizationalSettings(settings, departmentId) {
        try {
            // Get organizational constraints
            const constraints = await this.getOrganizationalConstraints(departmentId);
            
            // Apply constraints to settings
            const validatedSettings = { ...settings };

            // Example constraints validation
            if (constraints.analysis?.minThreshold && validatedSettings.analysis?.defaultThreshold) {
                if (validatedSettings.analysis.defaultThreshold < constraints.analysis.minThreshold) {
                    validatedSettings.analysis.defaultThreshold = constraints.analysis.minThreshold;
                }
            }

            if (constraints.analysis?.maxThreshold && validatedSettings.analysis?.defaultThreshold) {
                if (validatedSettings.analysis.defaultThreshold > constraints.analysis.maxThreshold) {
                    validatedSettings.analysis.defaultThreshold = constraints.analysis.maxThreshold;
                }
            }

            return validatedSettings;
        } catch (error) {
            logger.error('Error validating organizational settings', {
                error: error.message,
                departmentId
            });
            return settings;
        }
    }

    /**
     * Get organizational defaults for a department
     * @param {string} departmentId - Department ID
     * @returns {Promise<Object>} Organizational default settings
     */
    static async getOrganizationalDefaults(departmentId) {
        try {
            // For now, return base defaults
            // In the future, this could query department-specific settings
            return UserSettings.DEFAULT_SETTINGS;
        } catch (error) {
            logger.error('Error getting organizational defaults', {
                error: error.message,
                departmentId
            });
            return UserSettings.DEFAULT_SETTINGS;
        }
    }

    /**
     * Get organizational constraints for a department
     * @param {string} departmentId - Department ID
     * @returns {Promise<Object>} Organizational constraints
     */
    static async getOrganizationalConstraints(departmentId) {
        try {
            // For now, return basic constraints
            // In the future, this could query department-specific constraints
            return {
                analysis: {
                    minThreshold: 50,
                    maxThreshold: 100
                },
                display: {
                    maxProfilesPerPage: 100
                }
            };
        } catch (error) {
            logger.error('Error getting organizational constraints', {
                error: error.message,
                departmentId
            });
            return {};
        }
    }

    /**
     * Log settings operation with organizational context
     * @param {string} userId - User ID
     * @param {string} departmentId - Department ID
     * @param {Object} operationDetails - Operation details
     * @param {Object} userContext - User context
     */
    static async logSettingsOperation(userId, departmentId, operationDetails, userContext) {
        try {
            await OperationHistory.logOperation({
                userId,
                departmentId,
                operationType: OperationHistory.OPERATION_TYPES.SETTINGS_UPDATE,
                operationDetails,
                affectedResources: {
                    user: userId,
                    department: departmentId,
                    settingsKeys: operationDetails.updatedKeys || []
                },
                success: true
            });
        } catch (error) {
            logger.error('Error logging settings operation', {
                error: error.message,
                userId,
                departmentId
            });
        }
    }

    /**
     * Deep merge two objects
     * @param {Object} target - Target object
     * @param {Object} source - Source object
     * @returns {Object} Merged object
     */
    static deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        
        return result;
    }

    /**
     * Get nested value from object using dot notation
     * @param {Object} obj - Object to search
     * @param {string} key - Dot notation key
     * @param {any} defaultValue - Default value
     * @returns {any} Value or default
     */
    static getNestedValue(obj, key, defaultValue = null) {
        const keys = key.split('.');
        let current = obj;
        
        for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
                current = current[k];
            } else {
                return defaultValue;
            }
        }
        
        return current;
    }

    /**
     * Set nested value in object using dot notation
     * @param {Object} obj - Object to modify
     * @param {string} key - Dot notation key
     * @param {any} value - Value to set
     */
    static setNestedValue(obj, key, value) {
        const keys = key.split('.');
        let current = obj;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!current[k] || typeof current[k] !== 'object') {
                current[k] = {};
            }
            current = current[k];
        }
        
        current[keys[keys.length - 1]] = value;
    }
}

module.exports = SettingsService;