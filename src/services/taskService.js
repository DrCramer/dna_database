const Task = require('../models/Task');
const User = require('../models/User');
const ExpertGroup = require('../models/ExpertGroup');
const TaskNotification = require('../models/TaskNotification');
const { logger } = require('../utils/logger');
const { query } = require('../config/database');
const { notificationService } = require('./notificationService');
const { getTaskNumberLabel } = require('../utils/taskLabels');

class TaskService {
    async getTaskNumberDescription(task) {
        if (!task.internal_number_start) return '';
        const result = await query('SELECT name FROM departments WHERE id = $1', [task.department_id]);
        return ` (${getTaskNumberLabel(result.rows[0])}: ${task.internal_number_start}${task.internal_number_end ? '-' + task.internal_number_end : ''})`;
    }

    /**
     * Создать новую задачу
     * @param {Object} taskData - Данные для создания задачи
     * @returns {Promise<Task>} Созданная задача
     */
    async createTask(taskData) {
        try {
            // Валидация internal_number если указан
            if (taskData.internal_number_start) {
                await this.validateInternalNumbers(
                    taskData.internal_number_start,
                    taskData.internal_number_end
                );
            }

            await this.validateTaskAssignment(taskData);

            const task = await Task.create(taskData);

            // Создать уведомления для исполнителей
            await this.createTaskNotifications(task);

            logger.info(`Создана задача: ${task.title} пользователем ${taskData.created_by}`);
            return task;
        } catch (error) {
            logger.error('Ошибка создания задачи:', error);
            throw error;
        }
    }

    async getAccessibleDepartmentIds(user) {
        if (!user) {
            return [];
        }

        const accessibleDepartments = await user.getAccessibleDepartments();
        return accessibleDepartments.map((department) => department.id);
    }

    async userHasDepartmentAccess(user, departmentId) {
        if (!user || !departmentId) {
            return false;
        }

        if (user.role === 'system_administrator') {
            return true;
        }

        const accessibleDepartmentIds = await this.getAccessibleDepartmentIds(user);
        return accessibleDepartmentIds.includes(departmentId);
    }

    async validateTaskAssignment(taskData) {
        const {
            department_id,
            created_by,
            assigned_to_user = null,
            assigned_to_group = null
        } = taskData;

        if (!department_id) {
            throw new Error('Не выбран активный отдел для задачи');
        }

        const creator = await User.findById(created_by);
        if (!creator) {
            throw new Error('Создатель задачи не найден');
        }

        const creatorHasDepartmentAccess = await this.userHasDepartmentAccess(creator, department_id);
        if (!creatorHasDepartmentAccess) {
            throw new Error('У пользователя нет доступа к выбранному отделу');
        }

        if (assigned_to_user) {
            const assignee = await User.findById(assigned_to_user);
            if (!assignee) {
                throw new Error('Назначенный пользователь не найден');
            }

            const assigneeHasDepartmentAccess = await this.userHasDepartmentAccess(assignee, department_id);
            if (!assigneeHasDepartmentAccess) {
                throw new Error('Нельзя назначить задачу пользователю из другого отдела');
            }
        }

        if (assigned_to_group) {
            const group = await ExpertGroup.findById(assigned_to_group);
            if (!group) {
                throw new Error('Назначенная экспертная группа не найдена');
            }

            if (group.department_id !== department_id) {
                throw new Error('Нельзя назначить задачу экспертной группе из другого отдела');
            }
        }
    }

    /**
     * Валидация номеров привоза
     * @param {string} startNumber - Начальный номер
     * @param {string} endNumber - Конечный номер (опционально)
     */
    async validateInternalNumbers(startNumber, endNumber = null) {
        try {
            // Номер привоза - это просто справочная информация для аналитика
            // Никакой валидации не требуется

            logger.info(`Валидация номеров привоза пройдена: ${startNumber}${endNumber ? '-' + endNumber : ''}`);
        } catch (error) {
            logger.error('Ошибка валидации номеров:', error);
            throw error;
        }
    }

    /**
     * Создать уведомления для задачи
     * @param {Task} task - Объект задачи
     */
    async createTaskNotifications(task) {
        try {
            const assigneeIds = [];

            // Добавить назначенного пользователя (только если это не создатель задачи)
            if (task.assigned_to_user && task.assigned_to_user !== task.created_by) {
                assigneeIds.push(task.assigned_to_user);
            }

            // Добавить членов экспертной группы (исключая создателя задачи)
            if (task.assigned_to_group) {
                const group = await ExpertGroup.findById(task.assigned_to_group);
                if (group) {
                    const members = await group.getMembers();
                    members.forEach(member => {
                        // Не добавлять создателя задачи и избегать дубликатов
                        if (member.id !== task.created_by && !assigneeIds.includes(member.id)) {
                            assigneeIds.push(member.id);
                        }
                    });
                }
            }

            // Создать уведомления только для исполнителей (не для создателя)
            if (assigneeIds.length > 0) {
                const message = `Вам назначена новая задача: "${task.title}"${await this.getTaskNumberDescription(task)}`;

                await TaskNotification.createBulk(
                    task.id,
                    assigneeIds,
                    'new_task',
                    message
                );

                logger.info(`Созданы уведомления для ${assigneeIds.length} пользователей по задаче ${task.id}`);
            }
        } catch (error) {
            logger.error('Ошибка создания уведомлений:', error);
            // Не бросаем ошибку, чтобы не прерывать создание задачи
        }
    }

    /**
     * Assign task to user or expert group
     * @param {UUID} taskId - Task ID
     * @param {string} assigneeType - 'user' or 'group'
     * @param {UUID} assigneeId - User or group ID
     * @param {UUID} assignerId - ID of user making assignment
     * @returns {Promise<Task>} Updated task
     */
    async assignTask(taskId, assigneeType, assigneeId, assignerId) {
        try {
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Task not found');
            }

            // Validate assigner permissions
            const assigner = await User.findById(assignerId);
            if (!assigner || !['department_head', 'system_administrator', 'admin'].includes(assigner.role)) {
                throw new Error('Only Department Heads and System Administrators can assign tasks');
            }

            // Validate department access
            const assignerHasDepartmentAccess = await this.userHasDepartmentAccess(assigner, task.department_id);
            if (!assignerHasDepartmentAccess) {
                throw new Error('Cannot assign tasks from different departments');
            }

            const updates = {};
            if (assigneeType === 'user') {
                const assignee = await User.findById(assigneeId);
                const assigneeHasDepartmentAccess = assignee
                    ? await this.userHasDepartmentAccess(assignee, task.department_id)
                    : false;

                if (!assignee || !assigneeHasDepartmentAccess) {
                    throw new Error('Assigned user not found or not in same department');
                }
                updates.assigned_to_user = assigneeId;
                updates.assigned_to_group = null;
            } else if (assigneeType === 'group') {
                const group = await ExpertGroup.findById(assigneeId);
                if (!group || group.department_id !== task.department_id) {
                    throw new Error('Assigned expert group not found or not in same department');
                }
                updates.assigned_to_user = null;
                updates.assigned_to_group = assigneeId;
            } else {
                throw new Error('Invalid assignee type. Must be "user" or "group"');
            }

            const updatedTask = await task.update(updates);

            // Send notification about reassignment
            await this.notifyTaskReassignment(updatedTask, assignerId);

            logger.info(`Task ${taskId} reassigned to ${assigneeType} ${assigneeId} by user ${assignerId}`);
            return updatedTask;
        } catch (error) {
            logger.error('Error assigning task:', error);
            throw error;
        }
    }

    /**
     * Обновить статус задачи
     * @param {UUID} taskId - ID задачи
     * @param {string} status - Новый статус
     * @param {UUID} userId - ID пользователя обновляющего статус
     * @returns {Promise<Task>} Обновленная задача
     */
    async updateTaskStatus(taskId, status, userId) {
        try {
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Задача не найдена');
            }

            const oldStatus = task.status;
            const success = await task.updateStatus(status, userId);
            if (!success) {
                throw new Error('Не удалось обновить статус - неверный переход или недостаточно прав');
            }

            // Создать уведомление об изменении статуса
            await this.createStatusChangeNotification(task, oldStatus, status, userId);

            logger.info(`Статус задачи ${taskId} изменен на ${status} пользователем ${userId}`);
            return await Task.findById(taskId); // Вернуть обновленную задачу
        } catch (error) {
            logger.error('Ошибка обновления статуса задачи:', error);
            throw error;
        }
    }

    /**
     * Создать уведомление об изменении статуса
     * @param {Task} task - Объект задачи
     * @param {string} oldStatus - Старый статус
     * @param {string} newStatus - Новый статус
     * @param {UUID} userId - ID пользователя изменившего статус
     */
    async createStatusChangeNotification(task, oldStatus, newStatus, userId) {
        try {
            const statusNames = {
                'pending': 'Ожидает',
                'assigned': 'Назначена',
                'in_progress': 'В работе',
                'completed': 'Завершена',
                'approved': 'Подтверждена',
                'cancelled': 'Отменена'
            };

            // Специальная обработка для перехода в статус "completed"
            if (newStatus === 'completed') {
                logger.info('Задача завершена, отправка уведомлений руководителям и админам');
                
                const notifyUserIds = [];

                // Уведомить руководителей отдела и админов
                const departmentLeaders = await query(
                    `SELECT id FROM users 
                     WHERE department_id = $1 
                     AND role IN ('department_head', 'admin') 
                     AND is_active = true
                     AND id != $2`,
                    [task.department_id, userId]
                );

                departmentLeaders.rows.forEach(user => {
                    if (!notifyUserIds.includes(user.id)) {
                        notifyUserIds.push(user.id);
                    }
                });

                // Уведомить создателя задачи если это не тот кто завершил
                if (task.created_by !== userId && !notifyUserIds.includes(task.created_by)) {
                    notifyUserIds.push(task.created_by);
                }

                if (notifyUserIds.length > 0) {
                    const message = `Задача "${task.title}" завершена и готова к подтверждению${await this.getTaskNumberDescription(task)}`;

                    await TaskNotification.createBulk(
                        task.id,
                        notifyUserIds,
                        'status_changed',
                        message
                    );

                    logger.info(`Созданы уведомления о завершении задачи для ${notifyUserIds.length} руководителей и админов`);
                }
                return;
            }

            // Не создавать уведомления для обычных переходов в workflow
            const normalTransitions = [
                'pending->in_progress',
                'assigned->in_progress',
                'completed->approved' // Для approved есть отдельное уведомление через createApprovalNotification
            ];

            const transition = `${oldStatus}->${newStatus}`;
            if (normalTransitions.includes(transition)) {
                logger.info(`Пропуск уведомления для обычного перехода: ${transition}`);
                return;
            }

            // Получить список пользователей для уведомления
            const notifyUserIds = [];

            // Уведомить создателя задачи (только для важных изменений)
            if (task.created_by !== userId) {
                notifyUserIds.push(task.created_by);
            }

            // Уведомить исполнителя если это не он изменил статус
            if (task.assigned_to_user && task.assigned_to_user !== userId) {
                notifyUserIds.push(task.assigned_to_user);
            }

            // Уведомить членов группы
            if (task.assigned_to_group) {
                const group = await ExpertGroup.findById(task.assigned_to_group);
                if (group) {
                    const members = await group.getMembers();
                    members.forEach(member => {
                        if (member.id !== userId && !notifyUserIds.includes(member.id)) {
                            notifyUserIds.push(member.id);
                        }
                    });
                }
            }

            if (notifyUserIds.length > 0) {
                const message = `Статус задачи "${task.title}" изменен: ${statusNames[oldStatus] || oldStatus} → ${statusNames[newStatus] || newStatus}`;

                await TaskNotification.createBulk(
                    task.id,
                    notifyUserIds,
                    'status_changed',
                    message
                );

                logger.info(`Созданы уведомления об изменении статуса для ${notifyUserIds.length} пользователей`);
            }
        } catch (error) {
            logger.error('Ошибка создания уведомления об изменении статуса:', error);
            // Не бросаем ошибку
        }
    }

    /**
     * Add comment to task
     * @param {UUID} taskId - Task ID
     * @param {UUID} userId - User ID
     * @param {string} comment - Comment text
     * @returns {Promise<Object>} Created comment
     */
    async addTaskComment(taskId, userId, comment) {
        try {
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Task not found');
            }

            // Validate user can comment on task
            const canComment = await this.canUserAccessTask(userId, taskId);
            if (!canComment) {
                throw new Error('User cannot comment on this task');
            }

            const taskComment = await task.addComment(userId, comment);

            // Notify relevant users about new comment
            await this.notifyNewComment(task, userId, comment);

            logger.info(`Comment added to task ${taskId} by user ${userId}`);
            return taskComment;
        } catch (error) {
            logger.error('Error adding task comment:', error);
            throw error;
        }
    }

    /**
     * Get tasks by user with pagination and filters
     * @param {UUID} userId - User ID
     * @param {Object} options - Query options (page, limit, status, priority)
     * @returns {Promise<Object>} User's tasks with pagination
     */
    async getTasksByUser(userId, options = {}) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const { page = 1, limit = 10, status, priority, departmentId = null } = options;
            const offset = (page - 1) * limit;

            // Get user's expert groups
            const userGroups = await user.getExpertGroups();
            const groupIds = userGroups.map(group => group.id);

            // Build query conditions
            let whereConditions = ['t.is_active = true'];
            let params = [];
            let paramIndex = 1;

            // Add assignment conditions
            whereConditions.push(`(t.assigned_to_user = $${paramIndex}`);
            params.push(userId);
            paramIndex++;

            if (groupIds.length > 0) {
                whereConditions[whereConditions.length - 1] += ` OR t.assigned_to_group = ANY($${paramIndex}))`;
                params.push(groupIds);
                paramIndex++;
            } else {
                whereConditions[whereConditions.length - 1] += ')';
            }

            // Add filters
            if (status) {
                whereConditions.push(`t.status = $${paramIndex}`);
                params.push(status);
                paramIndex++;
            }

            if (priority) {
                whereConditions.push(`t.priority = $${paramIndex}`);
                params.push(priority);
                paramIndex++;
            }

            if (departmentId) {
                whereConditions.push(`t.department_id = $${paramIndex}`);
                params.push(departmentId);
                paramIndex++;
            }

            // Count total
            const countQuery = `
                SELECT COUNT(*) as total
                FROM tasks t
                WHERE ${whereConditions.join(' AND ')}
            `;
            const countResult = await query(countQuery, params);
            const total = parseInt(countResult.rows[0].total);

            // Get tasks with pagination
            const tasksQuery = `
                SELECT t.*
                FROM tasks t
                WHERE ${whereConditions.join(' AND ')}
                ORDER BY t.created_at DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;
            params.push(limit, offset);

            const tasksResult = await query(tasksQuery, params);
            const tasks = tasksResult.rows.map(row => new Task(row));

            return {
                tasks,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            };
        } catch (error) {
            logger.error('Error getting tasks by user:', error);
            throw error;
        }
    }

    /**
     * Get tasks by department with pagination and filters
     * @param {UUID} departmentId - Department ID (null for all departments)
     * @param {Object} options - Query options (page, limit, status, priority)
     * @returns {Promise<Object>} Department's tasks with pagination
     */
    async getTasksByDepartment(departmentId, options = {}) {
        try {
            const { page = 1, limit = 10, status, priority } = options;
            const offset = (page - 1) * limit;

            // Build query conditions
            let whereConditions = ['t.is_active = true'];
            let params = [];
            let paramIndex = 1;

            if (departmentId) {
                whereConditions.push(`t.department_id = $${paramIndex}`);
                params.push(departmentId);
                paramIndex++;
            }

            // Add filters
            if (status) {
                whereConditions.push(`t.status = $${paramIndex}`);
                params.push(status);
                paramIndex++;
            }

            if (priority) {
                whereConditions.push(`t.priority = $${paramIndex}`);
                params.push(priority);
                paramIndex++;
            }

            // Count total
            const countQuery = `
                SELECT COUNT(*) as total
                FROM tasks t
                WHERE ${whereConditions.join(' AND ')}
            `;
            const countResult = await query(countQuery, params);
            const total = parseInt(countResult.rows[0].total);

            // Get tasks with pagination and user/group names
            const tasksQuery = `
                SELECT 
                    t.*,
                    u.username as assigned_user_name,
                    eg.name as assigned_group_name
                FROM tasks t
                LEFT JOIN users u ON t.assigned_to_user = u.id
                LEFT JOIN expert_groups eg ON t.assigned_to_group = eg.id
                WHERE ${whereConditions.join(' AND ')}
                ORDER BY t.created_at DESC
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;
            params.push(limit, offset);

            const tasksResult = await query(tasksQuery, params);
            const tasks = tasksResult.rows.map(row => {
                const task = new Task(row);
                // Добавляем имена в объект задачи
                task.assigned_user_name = row.assigned_user_name;
                task.assigned_group_name = row.assigned_group_name;
                return task;
            });

            return {
                tasks,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            };
        } catch (error) {
            logger.error('Error getting tasks by department:', error);
            throw error;
        }
    }

    /**
     * Подтвердить задачу
     * @param {UUID} taskId - ID задачи
     * @param {UUID} approverId - ID пользователя подтверждающего задачу
     * @returns {Promise<Object>} Результат подтверждения с информацией о добавлении в мастер массив
     */
    async approveTask(taskId, approverId) {
        try {
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Задача не найдена');
            }

            const approver = await User.findById(approverId);
            if (!approver || !['department_head', 'system_administrator', 'admin'].includes(approver.role)) {
                throw new Error('Только руководители отделов и администраторы могут подтверждать задачи');
            }

            // Валидация доступа к отделу
            const approverHasDepartmentAccess = await this.userHasDepartmentAccess(approver, task.department_id);
            if (!approverHasDepartmentAccess) {
                throw new Error('Нельзя подтверждать задачи из других отделов');
            }

            if (task.status !== 'completed') {
                throw new Error('Можно подтверждать только завершенные задачи');
            }

            const success = await task.updateStatus('approved', approverId);
            if (!success) {
                throw new Error('Не удалось подтвердить задачу');
            }

            // Добавить профили в мастер массив
            let masterArrayResult = null;
            try {
                masterArrayResult = await this.addToMasterArray(taskId, approverId);
            } catch (error) {
                logger.error('Ошибка добавления в мастер массив:', error);
                // Не бросаем ошибку, чтобы задача осталась подтвержденной
                masterArrayResult = {
                    success: [],
                    errors: [{
                        error: error.message
                    }],
                    total: 0
                };
            }

            // Создать уведомление о подтверждении
            await this.createApprovalNotification(task, approverId);

            logger.info(`Задача ${taskId} подтверждена пользователем ${approverId}`);

            return {
                task: await Task.findById(taskId),
                masterArrayResult
            };
        } catch (error) {
            logger.error('Ошибка подтверждения задачи:', error);
            throw error;
        }
    }

    /**
     * Создать уведомление о подтверждении задачи
     * @param {Task} task - Объект задачи
     * @param {UUID} approverId - ID пользователя подтвердившего задачу
     */
    async createApprovalNotification(task, approverId) {
        try {
            const notifyUserIds = [];

            // Уведомить создателя
            if (task.created_by !== approverId) {
                notifyUserIds.push(task.created_by);
            }

            // Уведомить исполнителя
            if (task.assigned_to_user && task.assigned_to_user !== approverId) {
                notifyUserIds.push(task.assigned_to_user);
            }

            // Уведомить членов группы
            if (task.assigned_to_group) {
                const group = await ExpertGroup.findById(task.assigned_to_group);
                if (group) {
                    const members = await group.getMembers();
                    members.forEach(member => {
                        if (member.id !== approverId && !notifyUserIds.includes(member.id)) {
                            notifyUserIds.push(member.id);
                        }
                    });
                }
            }

            if (notifyUserIds.length > 0) {
                const message = `Задача "${task.title}" подтверждена и отправлена в мастер массив`;

                await TaskNotification.createBulk(
                    task.id,
                    notifyUserIds,
                    'task_approved',
                    message
                );

                logger.info(`Созданы уведомления о подтверждении для ${notifyUserIds.length} пользователей`);
            }
        } catch (error) {
            logger.error('Ошибка создания уведомления о подтверждении:', error);
            // Не бросаем ошибку
        }
    }

    /**
     * Get task history and audit trail
     * @param {UUID} taskId - Task ID
     * @param {UUID} requesterId - ID of user requesting history
     * @returns {Promise<Object>} Task history
     */
    async getTaskHistory(taskId, requesterId) {
        try {
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Task not found');
            }

            // Validate user can access task
            const canAccess = await this.canUserAccessTask(requesterId, taskId);
            if (!canAccess) {
                throw new Error('User cannot access this task');
            }

            const [comments, results] = await Promise.all([
                task.getComments(),
                task.getResults()
            ]);

            return {
                task: task.toJSON(),
                comments,
                results,
                audit_trail: await this.getTaskAuditTrail(taskId)
            };
        } catch (error) {
            logger.error('Error getting task history:', error);
            throw error;
        }
    }

    /**
     * Check if user can access task
     * @param {UUID} userId - User ID
     * @param {UUID} taskId - Task ID
     * @returns {Promise<boolean>} Access permission
     */
    async canUserAccessTask(userId, taskId) {
        try {
            const user = await User.findById(userId);
            const task = await Task.findById(taskId);

            if (!user || !task) {
                return false;
            }

            // System administrators and admins can access all tasks
            if (user.role === 'system_administrator') {
                return true;
            }

            const hasDepartmentAccess = await this.userHasDepartmentAccess(user, task.department_id);

            if ((user.role === 'department_head' || user.role === 'admin') && hasDepartmentAccess) {
                return true;
            }

            // Users can access tasks assigned to them
            if (task.assigned_to_user === userId) {
                return true;
            }

            // Users can access tasks assigned to their expert groups
            if (task.assigned_to_group) {
                const userGroups = await user.getExpertGroups();
                const groupIds = userGroups.map(group => group.id);
                if (groupIds.includes(task.assigned_to_group)) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error('Error checking task access:', error);
            return false;
        }
    }

    /**
     * Get task audit trail
     * @param {UUID} taskId - Task ID
     * @returns {Promise<Array>} Audit trail entries
     */
    async getTaskAuditTrail(taskId) {
        try {
            const result = await query(
                `SELECT 
                    al.id,
                    al.user_id,
                    u.username,
                    al.action,
                    al.resource_type,
                    al.resource_id,
                    al.details,
                    al.timestamp
                FROM audit_log al
                JOIN users u ON al.user_id = u.id
                WHERE al.resource_type = 'task' AND al.resource_id = $1
                ORDER BY al.timestamp DESC`,
                [taskId]
            );

            return result.rows;
        } catch (error) {
            logger.error('Error getting task audit trail:', error);
            return [];
        }
    }

    /**
     * Send notification about task assignment
     * @param {Task} task - Task object
     */
    async notifyTaskAssignment(task) {
        try {
            const assigneeIds = await this.getTaskAssigneeIds(task);

            if (assigneeIds.length > 0) {
                const message = `You have been assigned a new task: "${task.title}"`;

                await TaskNotification.createBulk(
                    task.id,
                    assigneeIds,
                    'task_assigned',
                    message
                );

                logger.info(`Task assignment notifications sent for task: ${task.title}`);
            }
        } catch (error) {
            logger.error('Error sending task assignment notification:', error);
        }
    }

    /**
     * Send notification about task reassignment
     * @param {Task} task - Task object
     * @param {UUID} assignerId - ID of user who reassigned
     */
    async notifyTaskReassignment(task, assignerId) {
        try {
            const assigneeIds = await this.getTaskAssigneeIds(task);

            if (assigneeIds.length > 0) {
                const message = `You have been assigned a task: "${task.title}"`;

                await TaskNotification.createBulk(
                    task.id,
                    assigneeIds,
                    'task_assigned',
                    message
                );

                logger.info(`Task reassignment notifications sent for task: ${task.title}`);
            }
        } catch (error) {
            logger.error('Error sending task reassignment notification:', error);
        }
    }

    /**
     * Send notification about status change
     * @param {Task} task - Task object
     * @param {string} newStatus - New status
     * @param {UUID} userId - ID of user who changed status
     */
    async notifyStatusChange(task, newStatus, userId) {
        try {
            const notifyUserIds = await this.getTaskNotificationRecipients(task);
            await notificationService.notifyTaskStatusChange(
                task,
                task.status, // old status (before update)
                newStatus,
                userId,
                notifyUserIds
            );

            logger.info(`Task status change notifications sent for task: ${task.title}`);
        } catch (error) {
            logger.error('Error sending status change notification:', error);
        }
    }

    /**
     * Send notification about new comment
     * @param {Task} task - Task object
     * @param {UUID} userId - ID of user who commented
     * @param {string} comment - Comment text
     */
    async notifyNewComment(task, userId, comment) {
        try {
            const notifyUserIds = await this.getTaskNotificationRecipients(task);
            const commentObj = { user_id: userId, comment, username: 'User' }; // Simplified for notification

            await notificationService.notifyTaskComment(task, commentObj, notifyUserIds);

            logger.info(`Task comment notifications sent for task: ${task.title}`);
        } catch (error) {
            logger.error('Error sending new comment notification:', error);
        }
    }

    /**
     * Send notification about task approval
     * @param {Task} task - Task object
     * @param {UUID} approverId - ID of user who approved
     */
    async notifyTaskApproval(task, approverId) {
        try {
            const notifyUserIds = await this.getTaskNotificationRecipients(task);
            await notificationService.notifyTaskStatusChange(
                task,
                'completed',
                'approved',
                approverId,
                notifyUserIds
            );

            logger.info(`Task approval notifications sent for task: ${task.title}`);
        } catch (error) {
            logger.error('Error sending task approval notification:', error);
        }
    }

    /**
     * Get user IDs who should be notified about task changes
     * @param {Task} task - Task object
     * @returns {Promise<Array>} Array of user IDs
     */
    async getTaskNotificationRecipients(task) {
        try {
            const recipients = new Set();

            // Add task creator
            recipients.add(task.created_by);

            // Add assigned user
            if (task.assigned_to_user) {
                recipients.add(task.assigned_to_user);
            }

            // Add expert group members
            if (task.assigned_to_group) {
                const group = await ExpertGroup.findById(task.assigned_to_group);
                if (group) {
                    const members = await group.getMembers();
                    members.forEach(member => recipients.add(member.id));
                }
            }

            // Add department heads and system administrators in the same department
            const departmentUsers = await query(
                `SELECT id FROM users 
                 WHERE department_id = $1 
                 AND role IN ('department_head', 'system_administrator', 'admin') 
                 AND is_active = true`,
                [task.department_id]
            );

            departmentUsers.rows.forEach(user => recipients.add(user.id));

            return Array.from(recipients);
        } catch (error) {
            logger.error('Error getting task notification recipients:', error);
            return [];
        }
    }

    /**
     * Get user IDs of task assignees
     * @param {Task} task - Task object
     * @returns {Promise<Array>} Array of user IDs
     */
    async getTaskAssigneeIds(task) {
        try {
            const assigneeIds = [];

            // Add assigned user
            if (task.assigned_to_user) {
                assigneeIds.push(task.assigned_to_user);
            }

            // Add expert group members
            if (task.assigned_to_group) {
                const group = await ExpertGroup.findById(task.assigned_to_group);
                if (group) {
                    const members = await group.getMembers();
                    members.forEach(member => assigneeIds.push(member.id));
                }
            }

            return assigneeIds;
        } catch (error) {
            logger.error('Error getting task assignee IDs:', error);
            return [];
        }
    }

    /**
     * Get tasks by expert group
     * @param {UUID} groupId - Expert group ID
     * @returns {Promise<Task[]>} Group's tasks
     */
    async getTasksByGroup(groupId) {
        try {
            const group = await ExpertGroup.findById(groupId);
            if (!group) {
                throw new Error('Expert group not found');
            }

            return await Task.findByAssignee(null, groupId);
        } catch (error) {
            logger.error('Error getting tasks by group:', error);
            throw error;
        }
    }

    /**
     * Get system-wide task statistics (for system administrators)
     * @returns {Promise<Object>} System task statistics
     */
    async getSystemTaskStats() {
        try {
            const result = await query(`
                SELECT 
                    COUNT(*) as total_tasks,
                    COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned_tasks,
                    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tasks,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
                    COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_tasks,
                    COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_tasks,
                    COUNT(CASE WHEN deadline < CURRENT_TIMESTAMP AND status NOT IN ('completed', 'approved') THEN 1 END) as overdue_tasks
                FROM tasks 
                WHERE is_active = true
            `);

            return result.rows[0];
        } catch (error) {
            logger.error('Error getting system task stats:', error);
            throw error;
        }
    }

    /**
     * Get department task statistics
     * @param {UUID} departmentId - Department ID
     * @returns {Promise<Object>} Department task statistics
     */
    async getDepartmentTaskStats(departmentId) {
        try {
            const result = await query(`
                SELECT 
                    COUNT(*) as total_tasks,
                    COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned_tasks,
                    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tasks,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
                    COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_tasks,
                    COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_tasks,
                    COUNT(CASE WHEN deadline < CURRENT_TIMESTAMP AND status NOT IN ('completed', 'approved') THEN 1 END) as overdue_tasks
                FROM tasks 
                WHERE department_id = $1 AND is_active = true
            `, [departmentId]);

            return result.rows[0];
        } catch (error) {
            logger.error('Error getting department task stats:', error);
            throw error;
        }
    }

    /**
     * Get user task statistics
     * @param {UUID} userId - User ID
     * @returns {Promise<Object>} User task statistics
     */
    async getUserTaskStats(userId, departmentId = null) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Get user's expert groups
            const userGroups = await user.getExpertGroups();
            const groupIds = userGroups.map(group => group.id);

            let whereCondition = 'assigned_to_user = $1';
            let params = [userId];

            if (groupIds.length > 0) {
                whereCondition += ' OR assigned_to_group = ANY($2)';
                params.push(groupIds);
            }

            const whereConditions = [`(${whereCondition})`, 'is_active = true'];
            let paramIndex = params.length + 1;

            if (departmentId) {
                whereConditions.push(`department_id = $${paramIndex}`);
                params.push(departmentId);
                paramIndex++;
            }

            const result = await query(`
                SELECT 
                    COUNT(*) as total_tasks,
                    COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned_tasks,
                    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tasks,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
                    COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_tasks,
                    COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_tasks,
                    COUNT(CASE WHEN deadline < CURRENT_TIMESTAMP AND status NOT IN ('completed', 'approved') THEN 1 END) as overdue_tasks
                FROM tasks 
                WHERE ${whereConditions.join(' AND ')}
            `, params);

            return result.rows[0];
        } catch (error) {
            logger.error('Error getting user task stats:', error);
            throw error;
        }
    }

    /**
     * Добавить профили задачи в мастер массив
     * @param {UUID} taskId - ID задачи
     * @param {UUID} approverId - ID пользователя подтверждающего задачу
     * @returns {Promise<Object>} Результат добавления
     */
    async addToMasterArray(taskId, approverId) {
        try {
            // 1. Получить задачу
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Задача не найдена');
            }

            // 2. Получить отдел и его мастер массив
            const departmentResult = await query(
                `SELECT d.id, d.name, d.master_array_id, ma.name as master_array_name
                 FROM departments d
                 LEFT JOIN master_arrays ma ON d.master_array_id = ma.id
                 WHERE d.id = $1`,
                [task.department_id]
            );

            if (departmentResult.rows.length === 0) {
                throw new Error('Отдел не найден');
            }

            const department = departmentResult.rows[0];

            if (!department.master_array_id) {
                throw new Error(`У отдела "${department.name}" нет мастер массива`);
            }

            // 3. Получить профили, привязанные к задаче
            const DNAProfile = require('../models/DNAProfile');
            const profiles = await DNAProfile.findByTaskId(taskId);

            if (profiles.length === 0) {
                throw new Error('К задаче не привязано ни одного профиля');
            }

            // 4. Добавить профили в мастер массив
            const MasterArray = require('../models/MasterArray');
            const masterArray = await MasterArray.findById(department.master_array_id);

            if (!masterArray) {
                throw new Error('Мастер массив не найден');
            }

            const results = {
                success: [],
                errors: [],
                total: profiles.length
            };

            // Подготовить данные для batch insert
            const profilesData = profiles.map(profile => ({
                sample_name: profile.sampleName,
                str_data: profile.strData,
                year: profile.year,
                internal_number: profile.internalNumber,
                import_number: profile.importFormat === 'genetic' ? profile.importNumber : task.internal_number_start,
                metadata: {
                    importFormat: profile.importFormat,
                    ...(profile.panel ? { panelId: profile.panel.id, panelName: profile.panel.name, panelLociOrder: profile.panel.lociOrder } : {}),
                    source: 'task',
                    task_id: taskId,
                    internal_number: profile.internalNumber,
                    original_profile_id: profile.id,
                    added_at: new Date().toISOString()
                },
                created_by: approverId
            }));

            // Использовать batch insert для быстрого добавления
            const batchResults = await masterArray.addProfilesBatch(profilesData);

            results.success = batchResults.success;
            results.errors = batchResults.errors;

            // 5. Логирование
            logger.info(`Задача ${taskId} подтверждена. Добавлено ${results.success.length} профилей в мастер массив. Ошибок: ${results.errors.length}`);

            return results;
        } catch (error) {
            logger.error('Ошибка добавления в мастер массив:', error);
            throw error;
        }
    }
}

module.exports = new TaskService();
