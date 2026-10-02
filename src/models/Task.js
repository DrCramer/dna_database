const { query, transaction } = require('../config/database');
const { logger } = require('../utils/logger');
const TaskComment = require('./TaskComment');
const TaskResult = require('./TaskResult');

class Task {
    constructor(taskData) {
        this.id = taskData.id;
        this.department_id = taskData.department_id;
        this.created_by = taskData.created_by;
        this.assigned_to_user = taskData.assigned_to_user;
        this.assigned_to_group = taskData.assigned_to_group;
        this.title = taskData.title;
        this.description = taskData.description;
        this.target_sample = taskData.target_sample;
        this.data_source = taskData.data_source;
        this.data_source_id = taskData.data_source_id;
        this.status = taskData.status;
        this.priority = taskData.priority;
        this.deadline = taskData.deadline;
        this.created_at = taskData.created_at;
        this.updated_at = taskData.updated_at;
        this.started_at = taskData.started_at;
        this.completed_at = taskData.completed_at;
        this.approved_at = taskData.approved_at;
        this.approved_by = taskData.approved_by;
        this.is_active = taskData.is_active;
        // Новые поля для номеров привоза
        this.internal_number_start = taskData.internal_number_start;
        this.internal_number_end = taskData.internal_number_end;
        // Новые поля для отмены задачи
        this.cancelled_at = taskData.cancelled_at;
        this.cancelled_by = taskData.cancelled_by;
        this.cancel_reason = taskData.cancel_reason;
    }

    // Create a new task
    static async create(taskData) {
        try {
            const {
                department_id,
                created_by,
                assigned_to_user = null,
                assigned_to_group = null,
                title,
                description,
                target_sample,
                data_source,
                data_source_id = null,
                priority = 'medium',
                deadline = null,
                internal_number_start = null,
                internal_number_end = null
            } = taskData;

            // Validate that either user or group is assigned
            if (!assigned_to_user && !assigned_to_group) {
                throw new Error('Задача должна быть назначена пользователю или экспертной группе');
            }

            const result = await query(
                `INSERT INTO tasks (
                    department_id, created_by, assigned_to_user, assigned_to_group,
                    title, description, target_sample, data_source, data_source_id,
                    priority, deadline, internal_number_start, internal_number_end
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING *`,
                [
                    department_id, created_by, assigned_to_user, assigned_to_group,
                    title, description, JSON.stringify(target_sample), data_source, data_source_id,
                    priority, deadline, internal_number_start, internal_number_end
                ]
            );

            logger.info(`Создана задача: ${title} для отдела: ${department_id}`);
            return new Task(result.rows[0]);
        } catch (error) {
            logger.error('Ошибка создания задачи:', error);
            throw error;
        }
    }

    // Find task by ID
    static async findById(id) {
        try {
            const result = await query(
                'SELECT * FROM tasks WHERE id = $1 AND is_active = true',
                [id]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return new Task(result.rows[0]);
        } catch (error) {
            logger.error('Error finding task by ID:', error);
            throw error;
        }
    }

    // Find tasks by assignee (user or group)
    static async findByAssignee(userId = null, groupId = null) {
        try {
            let query_text = 'SELECT * FROM tasks WHERE is_active = true AND (';
            let params = [];
            let paramIndex = 1;

            if (userId) {
                query_text += `assigned_to_user = $${paramIndex}`;
                params.push(userId);
                paramIndex++;
            }

            if (groupId) {
                if (userId) query_text += ' OR ';
                query_text += `assigned_to_group = $${paramIndex}`;
                params.push(groupId);
            }

            query_text += ') ORDER BY created_at DESC';

            const result = await query(query_text, params);
            return result.rows.map(row => new Task(row));
        } catch (error) {
            logger.error('Error finding tasks by assignee:', error);
            throw error;
        }
    }

    // Find tasks by department
    static async findByDepartment(departmentId) {
        try {
            const result = await query(
                'SELECT * FROM tasks WHERE department_id = $1 AND is_active = true ORDER BY created_at DESC',
                [departmentId]
            );

            return result.rows.map(row => new Task(row));
        } catch (error) {
            logger.error('Error finding tasks by department:', error);
            throw error;
        }
    }

    // Count active tasks by user (assigned + in_progress)
    static async countActiveByUser(userId, departmentId = null) {
        try {
            const params = [userId];
            let queryText = `
                SELECT COUNT(DISTINCT t.id) as count
                FROM tasks t
                LEFT JOIN expert_group_members egm
                  ON egm.group_id = t.assigned_to_group
                 AND egm.user_id = $1
                 AND egm.is_active = true
                WHERE (t.assigned_to_user = $1 OR egm.user_id IS NOT NULL)
                  AND t.status IN ('assigned', 'in_progress')
                  AND t.is_active = true
            `;

            if (departmentId) {
                queryText += ' AND t.department_id = $2';
                params.push(departmentId);
            }

            const result = await query(queryText, params);

            return { count: parseInt(result.rows[0].count, 10) };
        } catch (error) {
            logger.error('Error counting active tasks by user:', error);
            throw error;
        }
    }

    // Update task status
    async updateStatus(status, userId) {
        try {
            const result = await query(
                'SELECT update_task_status($1, $2, $3)',
                [this.id, status, userId]
            );

            if (result.rows[0].update_task_status) {
                // Refresh task data
                const updatedTask = await Task.findById(this.id);
                if (updatedTask) {
                    Object.assign(this, updatedTask);
                }
                logger.info(`Task ${this.id} status updated to: ${status}`);
                return true;
            }

            return false;
        } catch (error) {
            logger.error('Error updating task status:', error);
            throw error;
        }
    }

    // Add comment to task
    async addComment(userId, comment) {
        try {
            return await TaskComment.create({
                task_id: this.id,
                user_id: userId,
                comment: comment
            });
        } catch (error) {
            logger.error('Error adding task comment:', error);
            throw error;
        }
    }

    // Get task comments
    async getComments() {
        try {
            return await TaskComment.findByTaskId(this.id);
        } catch (error) {
            logger.error('Error getting task comments:', error);
            throw error;
        }
    }

    // Get task results
    async getResults() {
        try {
            return await TaskResult.findByTaskId(this.id);
        } catch (error) {
            logger.error('Error getting task results:', error);
            throw error;
        }
    }

    // Add result to task
    async addResult(userId, resultData, analysisMetadata = {}) {
        try {
            return await TaskResult.create({
                task_id: this.id,
                user_id: userId,
                result_data: resultData,
                analysis_metadata: analysisMetadata
            });
        } catch (error) {
            logger.error('Error adding task result:', error);
            throw error;
        }
    }

    // Update task
    async update(updates) {
        try {
            const allowedFields = ['title', 'description', 'target_sample', 'data_source', 'data_source_id', 'priority', 'deadline', 'assigned_to_user', 'assigned_to_group', 'internal_number_start', 'internal_number_end'];
            const setClause = [];
            const values = [];
            let paramIndex = 1;

            for (const [key, value] of Object.entries(updates)) {
                if (allowedFields.includes(key)) {
                    setClause.push(`${key} = $${paramIndex}`);
                    values.push(key === 'target_sample' ? JSON.stringify(value) : value);
                    paramIndex++;
                }
            }

            if (setClause.length === 0) {
                return this;
            }

            setClause.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(this.id);

            const result = await query(
                `UPDATE tasks SET ${setClause.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
                values
            );

            if (result.rows.length > 0) {
                Object.assign(this, result.rows[0]);
                logger.info(`Task ${this.id} updated`);
            }

            return this;
        } catch (error) {
            logger.error('Error updating task:', error);
            throw error;
        }
    }

    // Deactivate task
    async deactivate() {
        try {
            await query(
                'UPDATE tasks SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                [this.id]
            );
            this.is_active = false;
            logger.info(`Task ${this.id} deactivated`);
        } catch (error) {
            logger.error('Error deactivating task:', error);
            throw error;
        }
    }

    // Cancel task
    async cancel(userId, reason) {
        try {
            if (!reason || reason.trim().length === 0) {
                throw new Error('Причина отмены обязательна');
            }

            const result = await query(
                `UPDATE tasks 
                 SET status = 'cancelled',
                     cancelled_at = CURRENT_TIMESTAMP,
                     cancelled_by = $1,
                     cancel_reason = $2,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3
                 RETURNING *`,
                [userId, reason, this.id]
            );

            if (result.rows.length > 0) {
                Object.assign(this, result.rows[0]);
                logger.info(`Задача ${this.id} отменена пользователем ${userId}`);
            }

            return this;
        } catch (error) {
            logger.error('Ошибка отмены задачи:', error);
            throw error;
        }
    }

    // Convert to JSON
    toJSON() {
        return {
            id: this.id,
            department_id: this.department_id,
            created_by: this.created_by,
            assigned_to_user: this.assigned_to_user,
            assigned_to_group: this.assigned_to_group,
            title: this.title,
            description: this.description,
            target_sample: this.target_sample,
            data_source: this.data_source,
            data_source_id: this.data_source_id,
            status: this.status,
            priority: this.priority,
            deadline: this.deadline,
            created_at: this.created_at,
            updated_at: this.updated_at,
            started_at: this.started_at,
            completed_at: this.completed_at,
            approved_at: this.approved_at,
            approved_by: this.approved_by,
            is_active: this.is_active,
            internal_number_start: this.internal_number_start,
            internal_number_end: this.internal_number_end,
            cancelled_at: this.cancelled_at,
            cancelled_by: this.cancelled_by,
            cancel_reason: this.cancel_reason
        };
    }
}

module.exports = Task;
