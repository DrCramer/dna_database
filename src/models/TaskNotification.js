const { query } = require('../config/database');
const { logger } = require('../utils/logger');

class TaskNotification {
    constructor(notificationData) {
        this.id = notificationData.id;
        this.task_id = notificationData.task_id;
        this.user_id = notificationData.user_id;
        this.type = notificationData.type;
        this.message = notificationData.message;
        this.is_read = notificationData.is_read;
        this.created_at = notificationData.created_at;

        // Дополнительные поля из JOIN
        this.task_title = notificationData.task_title;
        this.username = notificationData.username;
    }

    /**
     * Создать новое уведомление
     * @param {Object} notificationData - Данные уведомления
     * @returns {Promise<TaskNotification>} Созданное уведомление
     */
    static async create(notificationData) {
        try {
            const { task_id, user_id, type, message } = notificationData;

            if (!task_id || !user_id || !type || !message) {
                throw new Error('Все поля обязательны: task_id, user_id, type, message');
            }

            // Проверить валидность типа
            const validTypes = ['new_task', 'status_changed', 'task_cancelled', 'task_approved', 'task_assigned'];
            if (!validTypes.includes(type)) {
                throw new Error(`Неверный тип уведомления. Допустимые: ${validTypes.join(', ')}`);
            }

            const result = await query(
                `INSERT INTO task_notifications (task_id, user_id, type, message)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [task_id, user_id, type, message]
            );

            logger.info(`Создано уведомление типа ${type} для пользователя ${user_id} по задаче ${task_id}`);
            return new TaskNotification(result.rows[0]);
        } catch (error) {
            logger.error('Ошибка создания уведомления:', error);
            throw error;
        }
    }

    /**
     * Найти уведомление по ID
     * @param {UUID} id - ID уведомления
     * @returns {Promise<TaskNotification|null>} Уведомление или null
     */
    static async findById(id) {
        try {
            const result = await query(
                `SELECT tn.*, t.title as task_title, u.username
                 FROM task_notifications tn
                 JOIN tasks t ON tn.task_id = t.id
                 JOIN users u ON tn.user_id = u.id
                 WHERE tn.id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return new TaskNotification(result.rows[0]);
        } catch (error) {
            logger.error('Ошибка поиска уведомления по ID:', error);
            throw error;
        }
    }

    /**
     * Найти уведомления пользователя
     * @param {UUID} userId - ID пользователя
     * @param {Object} options - Опции фильтрации
     * @returns {Promise<TaskNotification[]>} Массив уведомлений
     */
    static async findByUser(userId, options = {}) {
        try {
            const { is_read = null, type = null, limit = 50, offset = 0 } = options;

            let whereConditions = ['tn.user_id = $1'];
            let params = [userId];
            let paramIndex = 2;

            if (is_read !== null) {
                whereConditions.push(`tn.is_read = $${paramIndex}`);
                params.push(is_read);
                paramIndex++;
            }

            if (type) {
                whereConditions.push(`tn.type = $${paramIndex}`);
                params.push(type);
                paramIndex++;
            }

            const result = await query(
                `SELECT tn.*, t.title as task_title, u.username
                 FROM task_notifications tn
                 JOIN tasks t ON tn.task_id = t.id
                 JOIN users u ON tn.user_id = u.id
                 WHERE ${whereConditions.join(' AND ')}
                 ORDER BY tn.created_at DESC
                 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
                [...params, limit, offset]
            );

            return result.rows.map(row => new TaskNotification(row));
        } catch (error) {
            logger.error('Ошибка поиска уведомлений пользователя:', error);
            throw error;
        }
    }

    /**
     * Найти уведомления по задаче
     * @param {UUID} taskId - ID задачи
     * @returns {Promise<TaskNotification[]>} Массив уведомлений
     */
    static async findByTask(taskId) {
        try {
            const result = await query(
                `SELECT tn.*, t.title as task_title, u.username
                 FROM task_notifications tn
                 JOIN tasks t ON tn.task_id = t.id
                 JOIN users u ON tn.user_id = u.id
                 WHERE tn.task_id = $1
                 ORDER BY tn.created_at DESC`,
                [taskId]
            );

            return result.rows.map(row => new TaskNotification(row));
        } catch (error) {
            logger.error('Ошибка поиска уведомлений по задаче:', error);
            throw error;
        }
    }

    /**
     * Получить количество непрочитанных уведомлений
     * @param {UUID} userId - ID пользователя
     * @returns {Promise<number>} Количество непрочитанных
     */
    static async getUnreadCount(userId) {
        try {
            const result = await query(
                `SELECT COUNT(*) as count
                 FROM task_notifications
                 WHERE user_id = $1 AND is_read = false`,
                [userId]
            );

            return parseInt(result.rows[0].count);
        } catch (error) {
            logger.error('Ошибка подсчета непрочитанных уведомлений:', error);
            throw error;
        }
    }

    /**
     * Отметить уведомление как прочитанное
     * @param {UUID} id - ID уведомления
     * @returns {Promise<boolean>} Успешность операции
     */
    static async markAsRead(id) {
        try {
            const result = await query(
                `UPDATE task_notifications
                 SET is_read = true
                 WHERE id = $1
                 RETURNING *`,
                [id]
            );

            if (result.rows.length > 0) {
                logger.info(`Уведомление ${id} отмечено как прочитанное`);
                return true;
            }

            return false;
        } catch (error) {
            logger.error('Ошибка отметки уведомления как прочитанного:', error);
            throw error;
        }
    }

    /**
     * Отметить все уведомления пользователя как прочитанные
     * @param {UUID} userId - ID пользователя
     * @returns {Promise<number>} Количество обновленных уведомлений
     */
    static async markAllAsRead(userId) {
        try {
            const result = await query(
                `UPDATE task_notifications
                 SET is_read = true
                 WHERE user_id = $1 AND is_read = false
                 RETURNING id`,
                [userId]
            );

            const count = result.rows.length;
            logger.info(`Отмечено ${count} уведомлений как прочитанные для пользователя ${userId}`);
            return count;
        } catch (error) {
            logger.error('Ошибка массовой отметки уведомлений:', error);
            throw error;
        }
    }

    /**
     * Удалить старые прочитанные уведомления
     * @param {number} daysOld - Возраст в днях
     * @returns {Promise<number>} Количество удаленных уведомлений
     */
    static async deleteOldRead(daysOld = 30) {
        try {
            const result = await query(
                `DELETE FROM task_notifications
                 WHERE is_read = true 
                 AND created_at < NOW() - INTERVAL '${daysOld} days'
                 RETURNING id`,
                []
            );

            const count = result.rows.length;
            logger.info(`Удалено ${count} старых прочитанных уведомлений (старше ${daysOld} дней)`);
            return count;
        } catch (error) {
            logger.error('Ошибка удаления старых уведомлений:', error);
            throw error;
        }
    }

    /**
     * Создать уведомления для нескольких пользователей
     * @param {UUID} taskId - ID задачи
     * @param {UUID[]} userIds - Массив ID пользователей
     * @param {string} type - Тип уведомления
     * @param {string} message - Текст уведомления
     * @returns {Promise<number>} Количество созданных уведомлений
     */
    static async createBulk(taskId, userIds, type, message) {
        try {
            if (!userIds || userIds.length === 0) {
                return 0;
            }

            // Создать VALUES для bulk insert
            const values = userIds.map((userId, index) => {
                const offset = index * 4;
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
            }).join(', ');

            // Создать массив параметров
            const params = [];
            userIds.forEach(userId => {
                params.push(taskId, userId, type, message);
            });

            const result = await query(
                `INSERT INTO task_notifications (task_id, user_id, type, message)
                 VALUES ${values}
                 RETURNING *`,
                params
            );

            const count = result.rows.length;
            logger.info(`Создано ${count} уведомлений типа ${type} для задачи ${taskId}`);

            // Отправить SSE события для подключенных клиентов
            TaskNotification.sendSSENotifications(result.rows);

            return count;
        } catch (error) {
            logger.error('Ошибка массового создания уведомлений:', error);
            throw error;
        }
    }

    /**
     * Получить статистику уведомлений пользователя
     * @param {UUID} userId - ID пользователя
     * @returns {Promise<Object>} Статистика
     */
    static async getUserStats(userId) {
        try {
            const result = await query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN is_read = false THEN 1 END) as unread,
                    COUNT(CASE WHEN type = 'new_task' THEN 1 END) as new_tasks,
                    COUNT(CASE WHEN type = 'status_changed' THEN 1 END) as status_changes,
                    COUNT(CASE WHEN type = 'task_cancelled' THEN 1 END) as cancelled,
                    COUNT(CASE WHEN type = 'task_approved' THEN 1 END) as approved
                 FROM task_notifications
                 WHERE user_id = $1`,
                [userId]
            );

            return {
                total: parseInt(result.rows[0].total),
                unread: parseInt(result.rows[0].unread),
                by_type: {
                    new_tasks: parseInt(result.rows[0].new_tasks),
                    status_changes: parseInt(result.rows[0].status_changes),
                    cancelled: parseInt(result.rows[0].cancelled),
                    approved: parseInt(result.rows[0].approved)
                }
            };
        } catch (error) {
            logger.error('Ошибка получения статистики уведомлений:', error);
            throw error;
        }
    }

    /**
     * Отправить SSE события для новых уведомлений
     * @param {Array} notifications - Массив созданных уведомлений
     */
    static sendSSENotifications(notifications) {
        logger.info(`[SSE] sendSSENotifications вызван с ${notifications ? notifications.length : 0} уведомлениями`);

        try {
            logger.info(`[SSE] Попытка отправки SSE событий для ${notifications.length} уведомлений`);

            // Получить app instance через global
            const app = global.app;
            logger.info(`[SSE] global.app определен: ${!!app}`);

            if (!app) {
                logger.warn('[SSE] global.app не определен, SSE события не отправлены');
                return;
            }

            logger.info(`[SSE] app.locals.sseClients определен: ${!!app.locals.sseClients}`);

            if (!app.locals.sseClients) {
                logger.warn('[SSE] app.locals.sseClients не определен, SSE события не отправлены');
                return;
            }

            logger.info(`[SSE] Активных SSE клиентов: ${app.locals.sseClients.size}`);

            notifications.forEach(notification => {
                const client = app.locals.sseClients.get(notification.user_id);
                if (client) {
                    const event = {
                        type: 'new_notification',
                        notification: {
                            id: notification.id,
                            task_id: notification.task_id,
                            type: notification.type,
                            message: notification.message,
                            created_at: notification.created_at
                        }
                    };

                    try {
                        client.write(`data: ${JSON.stringify(event)}\n\n`);

                        // Принудительно отправить данные
                        if (client.flush) {
                            client.flush();
                        }

                        logger.info(`SSE событие отправлено пользователю ${notification.user_id}`);
                    } catch (err) {
                        logger.error(`Ошибка отправки SSE события пользователю ${notification.user_id}:`, err);
                        // Удалить неактивное соединение
                        app.locals.sseClients.delete(notification.user_id);
                    }
                } else {
                    logger.info(`SSE клиент не найден для пользователя ${notification.user_id}`);
                }
            });
        } catch (error) {
            logger.error('Ошибка отправки SSE уведомлений:', error);
            // Не бросаем ошибку, чтобы не прерывать создание уведомлений
        }
    }

    /**
     * Преобразовать в JSON
     * @returns {Object} JSON представление
     */
    toJSON() {
        return {
            id: this.id,
            task_id: this.task_id,
            user_id: this.user_id,
            type: this.type,
            message: this.message,
            is_read: this.is_read,
            created_at: this.created_at,
            task_title: this.task_title,
            username: this.username
        };
    }
}

module.exports = TaskNotification;
