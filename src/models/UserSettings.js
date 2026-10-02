const { query } = require('../config/database');
const { logger } = require('../utils/logger');

class UserSettings {
    constructor(data) {
        this.id = data.id;
        this.userId = data.user_id || data.userId;
        this.settings = data.settings;
        this.updatedAt = data.updated_at || data.updatedAt;
        this.createdAt = data.created_at || data.createdAt;
    }

    /**
     * Get user settings
     * @param {string} userId - User ID
     * @returns {Promise<UserSettings|null>} User settings or null if not found
     */
    static async findByUserId(userId) {
        const queryText = `
            SELECT * FROM user_settings 
            WHERE user_id = $1
        `;

        try {
            const result = await query(queryText, [userId]);
            return result.rows.length > 0 ? new UserSettings(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding user settings', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Create or update user settings
     * @param {string} userId - User ID
     * @param {Object} settings - Settings object
     * @returns {Promise<UserSettings>} Created or updated settings
     */
    static async upsert(userId, settings) {
        const queryText = `
            INSERT INTO user_settings (user_id, settings)
            VALUES ($1, $2)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                settings = $2,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;

        try {
            const result = await query(queryText, [userId, JSON.stringify(settings)]);
            
            logger.info('User settings updated', {
                userId,
                settingsKeys: Object.keys(settings)
            });

            return new UserSettings(result.rows[0]);
        } catch (error) {
            logger.error('Error upserting user settings', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Update specific setting
     * @param {string} userId - User ID
     * @param {string} key - Setting key (can be nested like 'analysis.defaultThreshold')
     * @param {any} value - Setting value
     * @returns {Promise<UserSettings>} Updated settings
     */
    static async updateSetting(userId, key, value) {
        try {
            // Get current settings
            let currentSettings = await this.findByUserId(userId);
            let settings = currentSettings ? currentSettings.settings : {};

            // Handle nested keys (e.g., 'analysis.defaultThreshold')
            const keyParts = key.split('.');
            if (keyParts.length === 1) {
                // Simple key
                settings[key] = value;
            } else {
                // Nested key
                let current = settings;
                for (let i = 0; i < keyParts.length - 1; i++) {
                    if (!current[keyParts[i]]) {
                        current[keyParts[i]] = {};
                    }
                    current = current[keyParts[i]];
                }
                current[keyParts[keyParts.length - 1]] = value;
            }

            // Save updated settings
            return await this.upsert(userId, settings);
        } catch (error) {
            logger.error('Error updating user setting', {
                error: error.message,
                userId,
                key
            });
            throw error;
        }
    }

    /**
     * Get specific setting value
     * @param {string} userId - User ID
     * @param {string} key - Setting key
     * @param {any} defaultValue - Default value if setting not found
     * @returns {Promise<any>} Setting value or default
     */
    static async getSetting(userId, key, defaultValue = null) {
        try {
            const userSettings = await this.findByUserId(userId);
            
            if (!userSettings || !userSettings.settings) {
                return defaultValue;
            }

            return userSettings.settings[key] !== undefined 
                ? userSettings.settings[key] 
                : defaultValue;
        } catch (error) {
            logger.error('Error getting user setting', {
                error: error.message,
                userId,
                key
            });
            return defaultValue;
        }
    }

    /**
     * Delete user settings
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} True if deleted, false if not found
     */
    static async delete(userId) {
        const queryText = `
            DELETE FROM user_settings 
            WHERE user_id = $1
            RETURNING id
        `;

        try {
            const result = await query(queryText, [userId]);
            const deleted = result.rows.length > 0;
            
            if (deleted) {
                logger.info('User settings deleted', { userId });
            }
            
            return deleted;
        } catch (error) {
            logger.error('Error deleting user settings', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Convert to JSON
     * @returns {Object} Settings as plain object
     */
    toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            settings: this.settings,
            updatedAt: this.updatedAt,
            createdAt: this.createdAt
        };
    }
}

// Default settings structure
UserSettings.DEFAULT_SETTINGS = {
    analysis: {
        defaultThreshold: 80,
        showAllLoci: true,
        sortBy: 'match_percentage',
        sortOrder: 'desc'
    },
    display: {
        profilesPerPage: 25,
        showUploadDate: true,
        showFileSource: true,
        compactView: false
    },
    notifications: {
        emailOnCompletion: false,
        showSuccessMessages: true,
        showWarningMessages: true
    },
    export: {
        defaultFormat: 'excel',
        includeMetadata: true,
        includeAllLoci: true
    }
};

module.exports = UserSettings;