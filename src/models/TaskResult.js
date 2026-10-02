const { query } = require('../config/database');
const { logger } = require('../utils/logger');

class TaskResult {
    constructor(resultData) {
        this.id = resultData.id;
        this.task_id = resultData.task_id;
        this.user_id = resultData.user_id;
        this.result_data = resultData.result_data;
        this.analysis_metadata = resultData.analysis_metadata;
        this.created_at = resultData.created_at;
        this.updated_at = resultData.updated_at;
        this.is_active = resultData.is_active;
        
        // Additional fields from joins
        this.username = resultData.username;
        this.user_email = resultData.user_email;
    }

    /**
     * Create a new task result
     * @param {Object} resultData - Result data
     * @returns {Promise<TaskResult>} Created result
     */
    static async create(resultData) {
        try {
            const { 
                task_id, 
                user_id, 
                result_data, 
                analysis_metadata = {} 
            } = resultData;

            if (!task_id || !user_id || !result_data) {
                throw new Error('Task ID, user ID, and result data are required');
            }

            const result = await query(
                `INSERT INTO task_results (task_id, user_id, result_data, analysis_metadata)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [
                    task_id, 
                    user_id, 
                    JSON.stringify(result_data), 
                    JSON.stringify(analysis_metadata)
                ]
            );

            logger.info(`Task result created for task ${task_id} by user ${user_id}`);
            return new TaskResult(result.rows[0]);
        } catch (error) {
            logger.error('Error creating task result:', error);
            throw error;
        }
    }

    /**
     * Find result by ID
     * @param {UUID} id - Result ID
     * @returns {Promise<TaskResult|null>} Result or null
     */
    static async findById(id) {
        try {
            const result = await query(
                `SELECT tr.*, u.username, u.email as user_email
                 FROM task_results tr
                 JOIN users u ON tr.user_id = u.id
                 WHERE tr.id = $1 AND tr.is_active = true`,
                [id]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return new TaskResult(result.rows[0]);
        } catch (error) {
            logger.error('Error finding task result by ID:', error);
            throw error;
        }
    }

    /**
     * Find results by task ID
     * @param {UUID} taskId - Task ID
     * @returns {Promise<TaskResult[]>} Array of results
     */
    static async findByTaskId(taskId) {
        try {
            const result = await query(
                `SELECT tr.*, u.username, u.email as user_email
                 FROM task_results tr
                 JOIN users u ON tr.user_id = u.id
                 WHERE tr.task_id = $1 AND tr.is_active = true
                 ORDER BY tr.created_at DESC`,
                [taskId]
            );

            return result.rows.map(row => new TaskResult(row));
        } catch (error) {
            logger.error('Error finding task results by task ID:', error);
            throw error;
        }
    }

    /**
     * Find results by user ID
     * @param {UUID} userId - User ID
     * @returns {Promise<TaskResult[]>} Array of results
     */
    static async findByUserId(userId) {
        try {
            const result = await query(
                `SELECT tr.*, u.username, u.email as user_email,
                        t.title as task_title
                 FROM task_results tr
                 JOIN users u ON tr.user_id = u.id
                 JOIN tasks t ON tr.task_id = t.id
                 WHERE tr.user_id = $1 AND tr.is_active = true
                 ORDER BY tr.created_at DESC`,
                [userId]
            );

            return result.rows.map(row => new TaskResult(row));
        } catch (error) {
            logger.error('Error finding task results by user ID:', error);
            throw error;
        }
    }

    /**
     * Update result
     * @param {Object} updates - Fields to update
     * @returns {Promise<TaskResult>} Updated result
     */
    async update(updates) {
        try {
            const allowedFields = ['result_data', 'analysis_metadata'];
            const setClause = [];
            const values = [];
            let paramIndex = 1;

            for (const [key, value] of Object.entries(updates)) {
                if (allowedFields.includes(key)) {
                    setClause.push(`${key} = $${paramIndex}`);
                    values.push(JSON.stringify(value));
                    paramIndex++;
                }
            }

            if (setClause.length === 0) {
                return this;
            }

            setClause.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(this.id);

            const result = await query(
                `UPDATE task_results 
                 SET ${setClause.join(', ')} 
                 WHERE id = $${paramIndex} 
                 RETURNING *`,
                values
            );

            if (result.rows.length > 0) {
                Object.assign(this, result.rows[0]);
                logger.info(`Task result ${this.id} updated`);
            }

            return this;
        } catch (error) {
            logger.error('Error updating task result:', error);
            throw error;
        }
    }

    /**
     * Deactivate result (soft delete)
     * @returns {Promise<void>}
     */
    async deactivate() {
        try {
            await query(
                `UPDATE task_results 
                 SET is_active = false, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [this.id]
            );
            
            this.is_active = false;
            logger.info(`Task result ${this.id} deactivated`);
        } catch (error) {
            logger.error('Error deactivating task result:', error);
            throw error;
        }
    }

    /**
     * Check if user can edit this result
     * @param {UUID} userId - User ID
     * @returns {Promise<boolean>} Can edit permission
     */
    async canUserEdit(userId) {
        try {
            // Users can edit their own results
            if (this.user_id === userId) {
                return true;
            }

            // Check if user is department head or system admin
            const result = await query(
                `SELECT u.role, u.department_id,
                        t.department_id as task_department_id
                 FROM users u
                 CROSS JOIN tasks t
                 WHERE u.id = $1 AND t.id = $2`,
                [userId, this.task_id]
            );

            if (result.rows.length === 0) {
                return false;
            }

            const { role, department_id, task_department_id } = result.rows[0];

            // System administrators can edit any result
            if (role === 'system_administrator') {
                return true;
            }

            // Department heads can edit results in their department
            if (role === 'department_head' && department_id === task_department_id) {
                return true;
            }

            return false;
        } catch (error) {
            logger.error('Error checking result edit permission:', error);
            return false;
        }
    }

    /**
     * Get result visibility for expert group members
     * @returns {Promise<Object[]>} Array of users who can see this result
     */
    async getVisibleToUsers() {
        try {
            const result = await query(
                `SELECT DISTINCT u.id, u.username, u.email
                 FROM users u
                 WHERE u.id IN (
                     -- Task assignee (if user)
                     SELECT t.assigned_to_user 
                     FROM tasks t 
                     WHERE t.id = $1 AND t.assigned_to_user IS NOT NULL
                     
                     UNION
                     
                     -- Expert group members (if task assigned to group)
                     SELECT egm.user_id
                     FROM tasks t
                     JOIN expert_group_members egm ON t.assigned_to_group = egm.group_id
                     WHERE t.id = $1 AND t.assigned_to_group IS NOT NULL AND egm.is_active = true
                     
                     UNION
                     
                     -- Task creator
                     SELECT t.created_by
                     FROM tasks t
                     WHERE t.id = $1
                     
                     UNION
                     
                     -- Department heads and system administrators in same department
                     SELECT u2.id
                     FROM users u2
                     JOIN tasks t ON u2.department_id = t.department_id
                     WHERE t.id = $1 AND u2.role IN ('department_head', 'system_administrator')
                 )
                 AND u.is_active = true`,
                [this.task_id]
            );

            return result.rows;
        } catch (error) {
            logger.error('Error getting result visibility:', error);
            return [];
        }
    }

    /**
     * Get analysis summary from result data
     * @returns {Object} Analysis summary
     */
    getAnalysisSummary() {
        try {
            const data = typeof this.result_data === 'string' 
                ? JSON.parse(this.result_data) 
                : this.result_data;

            return {
                total_matches: data.matches ? data.matches.length : 0,
                high_confidence_matches: data.matches ? 
                    data.matches.filter(match => match.lr_value > 1000).length : 0,
                analysis_type: data.analysis_type || 'unknown',
                search_parameters: data.search_parameters || {},
                processing_time: data.processing_time || null,
                quality_metrics: data.quality_metrics || {}
            };
        } catch (error) {
            logger.error('Error getting analysis summary:', error);
            return {
                total_matches: 0,
                high_confidence_matches: 0,
                analysis_type: 'unknown',
                search_parameters: {},
                processing_time: null,
                quality_metrics: {}
            };
        }
    }

    /**
     * Export result data for sharing
     * @param {string} format - Export format ('json', 'summary')
     * @returns {Object} Exported data
     */
    exportData(format = 'json') {
        try {
            const baseData = {
                id: this.id,
                task_id: this.task_id,
                created_by: this.username,
                created_at: this.created_at,
                analysis_metadata: typeof this.analysis_metadata === 'string' 
                    ? JSON.parse(this.analysis_metadata) 
                    : this.analysis_metadata
            };

            if (format === 'summary') {
                return {
                    ...baseData,
                    summary: this.getAnalysisSummary()
                };
            }

            return {
                ...baseData,
                result_data: typeof this.result_data === 'string' 
                    ? JSON.parse(this.result_data) 
                    : this.result_data
            };
        } catch (error) {
            logger.error('Error exporting result data:', error);
            return {
                id: this.id,
                error: 'Failed to export result data'
            };
        }
    }

    /**
     * Convert to JSON
     * @returns {Object} JSON representation
     */
    toJSON() {
        return {
            id: this.id,
            task_id: this.task_id,
            user_id: this.user_id,
            result_data: typeof this.result_data === 'string' 
                ? JSON.parse(this.result_data) 
                : this.result_data,
            analysis_metadata: typeof this.analysis_metadata === 'string' 
                ? JSON.parse(this.analysis_metadata) 
                : this.analysis_metadata,
            created_at: this.created_at,
            updated_at: this.updated_at,
            is_active: this.is_active,
            username: this.username,
            user_email: this.user_email
        };
    }
}

module.exports = TaskResult;