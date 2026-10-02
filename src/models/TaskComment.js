const { query } = require('../config/database');
const { logger } = require('../utils/logger');

class TaskComment {
    constructor(commentData) {
        this.id = commentData.id;
        this.task_id = commentData.task_id;
        this.user_id = commentData.user_id;
        this.comment = commentData.comment;
        this.created_at = commentData.created_at;
        this.updated_at = commentData.updated_at;
        this.is_active = commentData.is_active;
        
        // Additional fields from joins
        this.username = commentData.username;
        this.user_email = commentData.user_email;
    }

    /**
     * Create a new task comment
     * @param {Object} commentData - Comment data
     * @returns {Promise<TaskComment>} Created comment
     */
    static async create(commentData) {
        try {
            const { task_id, user_id, comment } = commentData;

            if (!task_id || !user_id || !comment) {
                throw new Error('Task ID, user ID, and comment are required');
            }

            const result = await query(
                `INSERT INTO task_comments (task_id, user_id, comment)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [task_id, user_id, comment]
            );

            logger.info(`Task comment created for task ${task_id} by user ${user_id}`);
            return new TaskComment(result.rows[0]);
        } catch (error) {
            logger.error('Error creating task comment:', error);
            throw error;
        }
    }

    /**
     * Find comment by ID
     * @param {UUID} id - Comment ID
     * @returns {Promise<TaskComment|null>} Comment or null
     */
    static async findById(id) {
        try {
            const result = await query(
                `SELECT tc.*, u.username, u.email as user_email
                 FROM task_comments tc
                 JOIN users u ON tc.user_id = u.id
                 WHERE tc.id = $1 AND tc.is_active = true`,
                [id]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return new TaskComment(result.rows[0]);
        } catch (error) {
            logger.error('Error finding task comment by ID:', error);
            throw error;
        }
    }

    /**
     * Find comments by task ID
     * @param {UUID} taskId - Task ID
     * @returns {Promise<TaskComment[]>} Array of comments
     */
    static async findByTaskId(taskId) {
        try {
            const result = await query(
                `SELECT tc.*, u.username, u.email as user_email
                 FROM task_comments tc
                 JOIN users u ON tc.user_id = u.id
                 WHERE tc.task_id = $1 AND tc.is_active = true
                 ORDER BY tc.created_at ASC`,
                [taskId]
            );

            return result.rows.map(row => new TaskComment(row));
        } catch (error) {
            logger.error('Error finding task comments by task ID:', error);
            throw error;
        }
    }

    /**
     * Find comments by user ID
     * @param {UUID} userId - User ID
     * @returns {Promise<TaskComment[]>} Array of comments
     */
    static async findByUserId(userId) {
        try {
            const result = await query(
                `SELECT tc.*, u.username, u.email as user_email,
                        t.title as task_title
                 FROM task_comments tc
                 JOIN users u ON tc.user_id = u.id
                 JOIN tasks t ON tc.task_id = t.id
                 WHERE tc.user_id = $1 AND tc.is_active = true
                 ORDER BY tc.created_at DESC`,
                [userId]
            );

            return result.rows.map(row => new TaskComment(row));
        } catch (error) {
            logger.error('Error finding task comments by user ID:', error);
            throw error;
        }
    }

    /**
     * Update comment
     * @param {Object} updates - Fields to update
     * @returns {Promise<TaskComment>} Updated comment
     */
    async update(updates) {
        try {
            const allowedFields = ['comment'];
            const setClause = [];
            const values = [];
            let paramIndex = 1;

            for (const [key, value] of Object.entries(updates)) {
                if (allowedFields.includes(key)) {
                    setClause.push(`${key} = $${paramIndex}`);
                    values.push(value);
                    paramIndex++;
                }
            }

            if (setClause.length === 0) {
                return this;
            }

            setClause.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(this.id);

            const result = await query(
                `UPDATE task_comments 
                 SET ${setClause.join(', ')} 
                 WHERE id = $${paramIndex} 
                 RETURNING *`,
                values
            );

            if (result.rows.length > 0) {
                Object.assign(this, result.rows[0]);
                logger.info(`Task comment ${this.id} updated`);
            }

            return this;
        } catch (error) {
            logger.error('Error updating task comment:', error);
            throw error;
        }
    }

    /**
     * Deactivate comment (soft delete)
     * @returns {Promise<void>}
     */
    async deactivate() {
        try {
            await query(
                `UPDATE task_comments 
                 SET is_active = false, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [this.id]
            );
            
            this.is_active = false;
            logger.info(`Task comment ${this.id} deactivated`);
        } catch (error) {
            logger.error('Error deactivating task comment:', error);
            throw error;
        }
    }

    /**
     * Check if user can edit this comment
     * @param {UUID} userId - User ID
     * @returns {Promise<boolean>} Can edit permission
     */
    async canUserEdit(userId) {
        try {
            // Users can edit their own comments
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

            // System administrators can edit any comment
            if (role === 'system_administrator') {
                return true;
            }

            // Department heads can edit comments in their department
            if (role === 'department_head' && department_id === task_department_id) {
                return true;
            }

            return false;
        } catch (error) {
            logger.error('Error checking comment edit permission:', error);
            return false;
        }
    }

    /**
     * Get comment visibility for expert group members
     * @returns {Promise<Object[]>} Array of users who can see this comment
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
            logger.error('Error getting comment visibility:', error);
            return [];
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
            comment: this.comment,
            created_at: this.created_at,
            updated_at: this.updated_at,
            is_active: this.is_active,
            username: this.username,
            user_email: this.user_email
        };
    }
}

module.exports = TaskComment;