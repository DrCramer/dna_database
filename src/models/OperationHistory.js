const { query } = require('../config/database');
const { logger } = require('../utils/logger');

class OperationHistory {
    constructor(data) {
        this.id = data.id;
        this.userId = data.user_id || data.userId;
        this.departmentId = data.department_id || data.departmentId;
        this.operationType = data.operation_type || data.operationType;
        
        // Parse operation_details if it's a JSON string from database
        let operationDetails = data.operation_details || data.operationDetails;
        if (typeof operationDetails === 'string') {
            try {
                operationDetails = JSON.parse(operationDetails);
            } catch (error) {
                // If parsing fails, keep as string or default to empty object
                operationDetails = {};
            }
        }
        this.operationDetails = operationDetails || {};
        
        // Parse affected_resources if it's a JSON string from database
        let affectedResources = data.affected_resources || data.affectedResources;
        if (typeof affectedResources === 'string') {
            try {
                affectedResources = JSON.parse(affectedResources);
            } catch (error) {
                // If parsing fails, keep as string or default to empty object
                affectedResources = {};
            }
        }
        this.affectedResources = affectedResources || {};
        
        this.timestamp = data.timestamp;
        this.ipAddress = data.ip_address || data.ipAddress;
        this.userAgent = data.user_agent || data.userAgent;
        this.success = data.success;
    }

    /**
     * Log an operation to the history table
     * @param {Object} operationData - Operation data to log
     * @param {string} operationData.userId - User ID performing the operation
     * @param {string} operationData.departmentId - Department ID for organizational context
     * @param {string} operationData.operationType - Type of operation (e.g., 'profile_upload', 'dna_analysis', 'profile_delete')
     * @param {Object} operationData.operationDetails - Details about the operation
     * @param {Object} operationData.affectedResources - Resources affected by the operation
     * @param {string} operationData.ipAddress - IP address of the user
     * @param {string} operationData.userAgent - User agent string
     * @param {boolean} operationData.success - Whether the operation was successful
     * @returns {Promise<OperationHistory>} Created operation history record
     */
    static async logOperation(operationData) {
        const {
            userId,
            departmentId = null,
            operationType,
            operationDetails = {},
            affectedResources = {},
            ipAddress = null,
            userAgent = null,
            success = true
        } = operationData;

        const queryText = `
            INSERT INTO operation_history (user_id, department_id, operation_type, operation_details, affected_resources, ip_address, user_agent, success)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

        try {
            const result = await query(queryText, [
                userId,
                departmentId,
                operationType,
                JSON.stringify(operationDetails),
                JSON.stringify(affectedResources),
                ipAddress,
                userAgent,
                success
            ]);

            logger.info('Operation logged', {
                operationId: result.rows[0].id,
                userId,
                departmentId,
                operationType,
                success
            });

            return new OperationHistory(result.rows[0]);
        } catch (error) {
            logger.error('Error logging operation', {
                error: error.message,
                userId,
                departmentId,
                operationType
            });
            throw error;
        }
    }

    /**
     * Get operation history for a specific user
     * @param {string} userId - User ID
     * @param {Object} options - Query options
     * @param {number} options.limit - Limit results (default: 50)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @param {string} options.operationType - Filter by operation type
     * @param {Date} options.startDate - Filter operations after this date
     * @param {Date} options.endDate - Filter operations before this date
     * @returns {Promise<Array<OperationHistory>>} Array of operation history records
     */
    static async findByUserId(userId, options = {}) {
        const {
            limit = 50,
            offset = 0,
            operationType = null,
            startDate = null,
            endDate = null
        } = options;

        let queryText = `
            SELECT * FROM operation_history 
            WHERE user_id = $1
        `;
        const params = [userId];
        let paramIndex = 2;

        // Add filters
        if (operationType) {
            queryText += ` AND operation_type = $${paramIndex}`;
            params.push(operationType);
            paramIndex++;
        }

        if (startDate) {
            queryText += ` AND timestamp >= $${paramIndex}`;
            params.push(startDate);
            paramIndex++;
        }

        if (endDate) {
            queryText += ` AND timestamp <= $${paramIndex}`;
            params.push(endDate);
            paramIndex++;
        }

        queryText += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        try {
            const result = await query(queryText, params);
            return result.rows.map(row => new OperationHistory(row));
        } catch (error) {
            logger.error('Error finding operation history by user ID', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Get operation history for a specific department
     * @param {string} departmentId - Department ID
     * @param {Object} options - Query options
     * @param {number} options.limit - Limit results (default: 100)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @param {string} options.operationType - Filter by operation type
     * @param {string} options.userId - Filter by user ID
     * @param {Date} options.startDate - Filter operations after this date
     * @param {Date} options.endDate - Filter operations before this date
     * @returns {Promise<Array<OperationHistory>>} Array of operation history records
     */
    static async findByDepartmentId(departmentId, options = {}) {
        const {
            limit = 100,
            offset = 0,
            operationType = null,
            userId = null,
            startDate = null,
            endDate = null
        } = options;

        let queryText = `
            SELECT oh.*, u.username, u.email, u.role 
            FROM operation_history oh
            JOIN users u ON oh.user_id = u.id
            WHERE oh.department_id = $1
        `;
        const params = [departmentId];
        let paramIndex = 2;

        // Add filters
        if (userId) {
            queryText += ` AND oh.user_id = $${paramIndex}`;
            params.push(userId);
            paramIndex++;
        }

        if (operationType) {
            queryText += ` AND oh.operation_type = $${paramIndex}`;
            params.push(operationType);
            paramIndex++;
        }

        if (startDate) {
            queryText += ` AND oh.timestamp >= $${paramIndex}`;
            params.push(startDate);
            paramIndex++;
        }

        if (endDate) {
            queryText += ` AND oh.timestamp <= $${paramIndex}`;
            params.push(endDate);
            paramIndex++;
        }

        queryText += ` ORDER BY oh.timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        try {
            const result = await query(queryText, params);
            return result.rows.map(row => ({
                ...new OperationHistory(row),
                username: row.username,
                email: row.email,
                role: row.role
            }));
        } catch (error) {
            logger.error('Error finding operation history by department ID', {
                error: error.message,
                departmentId
            });
            throw error;
        }
    }

    /**
     * Get all operation history (admin only)
     * @param {Object} options - Query options
     * @param {number} options.limit - Limit results (default: 100)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @param {string} options.operationType - Filter by operation type
     * @param {string} options.userId - Filter by user ID
     * @param {Date} options.startDate - Filter operations after this date
     * @param {Date} options.endDate - Filter operations before this date
     * @returns {Promise<Array<OperationHistory>>} Array of operation history records
     */
    static async findAll(options = {}) {
        const {
            limit = 100,
            offset = 0,
            operationType = null,
            userId = null,
            startDate = null,
            endDate = null
        } = options;

        let queryText = `
            SELECT oh.*, u.username, u.email 
            FROM operation_history oh
            JOIN users u ON oh.user_id = u.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        // Add filters
        if (userId) {
            queryText += ` AND oh.user_id = $${paramIndex}`;
            params.push(userId);
            paramIndex++;
        }

        if (operationType) {
            queryText += ` AND oh.operation_type = $${paramIndex}`;
            params.push(operationType);
            paramIndex++;
        }

        if (startDate) {
            queryText += ` AND oh.timestamp >= $${paramIndex}`;
            params.push(startDate);
            paramIndex++;
        }

        if (endDate) {
            queryText += ` AND oh.timestamp <= $${paramIndex}`;
            params.push(endDate);
            paramIndex++;
        }

        queryText += ` ORDER BY oh.timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        try {
            const result = await query(queryText, params);
            return result.rows.map(row => ({
                ...new OperationHistory(row),
                username: row.username,
                email: row.email
            }));
        } catch (error) {
            logger.error('Error finding all operation history', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Count operation history records for a user
     * @param {string} userId - User ID
     * @param {Object} options - Filter options
     * @returns {Promise<number>} Count of records
     */
    static async countByUserId(userId, options = {}) {
        const {
            operationType = null,
            startDate = null,
            endDate = null
        } = options;

        let queryText = `
            SELECT COUNT(*) as count FROM operation_history 
            WHERE user_id = $1
        `;
        const params = [userId];
        let paramIndex = 2;

        // Add filters
        if (operationType) {
            queryText += ` AND operation_type = $${paramIndex}`;
            params.push(operationType);
            paramIndex++;
        }

        if (startDate) {
            queryText += ` AND timestamp >= $${paramIndex}`;
            params.push(startDate);
            paramIndex++;
        }

        if (endDate) {
            queryText += ` AND timestamp <= $${paramIndex}`;
            params.push(endDate);
            paramIndex++;
        }

        try {
            const result = await query(queryText, params);
            return parseInt(result.rows[0].count);
        } catch (error) {
            logger.error('Error counting operation history by user ID', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Get operation statistics for a user
     * @param {string} userId - User ID
     * @param {Object} options - Filter options
     * @returns {Promise<Object>} Operation statistics
     */
    static async getStatsByUserId(userId, options = {}) {
        const {
            startDate = null,
            endDate = null
        } = options;

        let queryText = `
            SELECT 
                operation_type,
                COUNT(*) as count,
                COUNT(CASE WHEN success = true THEN 1 END) as successful,
                COUNT(CASE WHEN success = false THEN 1 END) as failed
            FROM operation_history 
            WHERE user_id = $1
        `;
        const params = [userId];
        let paramIndex = 2;

        if (startDate) {
            queryText += ` AND timestamp >= $${paramIndex}`;
            params.push(startDate);
            paramIndex++;
        }

        if (endDate) {
            queryText += ` AND timestamp <= $${paramIndex}`;
            params.push(endDate);
            paramIndex++;
        }

        queryText += ` GROUP BY operation_type ORDER BY count DESC`;

        try {
            const result = await query(queryText, params);
            return result.rows.map(row => ({
                operationType: row.operation_type,
                total: parseInt(row.count),
                successful: parseInt(row.successful),
                failed: parseInt(row.failed)
            }));
        } catch (error) {
            logger.error('Error getting operation statistics by user ID', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Convert to JSON
     * @returns {Object} Operation history as plain object
     */
    toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            departmentId: this.departmentId,
            operationType: this.operationType,
            operationDetails: this.operationDetails,
            affectedResources: this.affectedResources,
            timestamp: this.timestamp,
            ipAddress: this.ipAddress,
            userAgent: this.userAgent,
            success: this.success
        };
    }

    /**
     * Get audit trail for system administrators
     * @param {Object} options - Query options
     * @returns {Promise<Array>} Audit trail records
     */
    static async getAuditTrail(options = {}) {
        const {
            dateRange = null,
            operationTypes = [],
            includeUserDetails = true,
            limit = 1000,
            offset = 0
        } = options;

        let queryText = `
            SELECT oh.*, u.username, u.email, u.role, u.department_id
            FROM operation_history oh
            JOIN users u ON oh.user_id = u.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        // Add date range filter
        if (dateRange && dateRange.startDate) {
            queryText += ` AND oh.timestamp >= $${paramIndex}`;
            params.push(dateRange.startDate);
            paramIndex++;
        }

        if (dateRange && dateRange.endDate) {
            queryText += ` AND oh.timestamp <= $${paramIndex}`;
            params.push(dateRange.endDate);
            paramIndex++;
        }

        // Add operation types filter
        if (operationTypes && operationTypes.length > 0) {
            queryText += ` AND oh.operation_type = ANY($${paramIndex})`;
            params.push(operationTypes);
            paramIndex++;
        }

        queryText += ` ORDER BY oh.timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        try {
            const result = await query(queryText, params);
            return result.rows.map(row => ({
                id: row.id,
                user_id: row.user_id,
                operation_type: row.operation_type,
                operation_details: typeof row.operation_details === 'string' 
                    ? JSON.parse(row.operation_details) 
                    : row.operation_details,
                created_at: row.timestamp,
                ip_address: row.ip_address,
                user_agent: row.user_agent,
                success: row.success,
                ...(includeUserDetails && {
                    username: row.username,
                    email: row.email,
                    role: row.role,
                    department_id: row.department_id
                })
            }));
        } catch (error) {
            logger.error('Error getting audit trail', {
                error: error.message,
                options
            });
            throw error;
        }
    }

    /**
     * Get department-scoped audit trail for department heads
     * @param {string} departmentId - Department ID
     * @param {Object} options - Query options
     * @returns {Promise<Array>} Department audit trail records
     */
    static async getDepartmentAuditTrail(departmentId, options = {}) {
        const {
            dateRange = null,
            operationTypes = [],
            includeUserDetails = true,
            limit = 1000,
            offset = 0
        } = options;

        let queryText = `
            SELECT oh.*, u.username, u.email, u.role, u.department_id
            FROM operation_history oh
            JOIN users u ON oh.user_id = u.id
            WHERE u.department_id = $1
        `;
        const params = [departmentId];
        let paramIndex = 2;

        // Add date range filter
        if (dateRange && dateRange.startDate) {
            queryText += ` AND oh.timestamp >= $${paramIndex}`;
            params.push(dateRange.startDate);
            paramIndex++;
        }

        if (dateRange && dateRange.endDate) {
            queryText += ` AND oh.timestamp <= $${paramIndex}`;
            params.push(dateRange.endDate);
            paramIndex++;
        }

        // Add operation types filter
        if (operationTypes && operationTypes.length > 0) {
            queryText += ` AND oh.operation_type = ANY($${paramIndex})`;
            params.push(operationTypes);
            paramIndex++;
        }

        queryText += ` ORDER BY oh.timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        try {
            const result = await query(queryText, params);
            return result.rows.map(row => ({
                id: row.id,
                user_id: row.user_id,
                operation_type: row.operation_type,
                operation_details: typeof row.operation_details === 'string' 
                    ? JSON.parse(row.operation_details) 
                    : row.operation_details,
                created_at: row.timestamp,
                ip_address: row.ip_address,
                user_agent: row.user_agent,
                success: row.success,
                ...(includeUserDetails && {
                    username: row.username,
                    email: row.email,
                    role: row.role,
                    department_id: row.department_id
                })
            }));
        } catch (error) {
            logger.error('Error getting department audit trail', {
                error: error.message,
                departmentId,
                options
            });
            throw error;
        }
    }
}

// Operation type constants
OperationHistory.OPERATION_TYPES = {
    LOGIN: 'login',
    LOGOUT: 'logout',
    PROFILE_UPLOAD: 'profile_upload',
    PROFILE_DELETE: 'profile_delete',
    PROFILE_UPDATE: 'profile_update',
    DNA_ANALYSIS: 'dna_analysis',
    BULK_SEARCH: 'bulk_search',
    EXPORT_RESULTS: 'export_results',
    USER_MANAGEMENT: 'user_management',
    SETTINGS_UPDATE: 'settings_update',
    SYSTEM_NOTIFICATION: 'system_notification',
    MASTER_ARRAY_UPDATE: 'master_array_update',
    TASK_MANAGEMENT: 'task_management',
    DEPARTMENT_MANAGEMENT: 'department_management',
    ORGANIZATION_MANAGEMENT: 'organization_management'
};

module.exports = OperationHistory;