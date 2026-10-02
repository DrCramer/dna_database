const express = require('express');
const Task = require('../models/Task');
const TaskComment = require('../models/TaskComment');
const TaskResult = require('../models/TaskResult');
const TaskService = require('../services/taskService');
const { authenticate, departmentHeadOrAdmin, requireTaskAccess } = require('../middleware/auth');
const { 
    validateUUID,
    validatePagination,
    validateCreateTask,
    validateUpdateTaskStatus,
    validateAddTaskComment,
    validateAddTaskResult
} = require('../middleware/validation');
const { logger } = require('../utils/logger');
const authService = require('../services/authService');
const websocketService = require('../services/websocketService');

const router = express.Router();

function getActiveDepartmentId(req) {
    return req.activeDepartmentId || req.user.department_id || null;
}

// Helper function to translate task status to Russian
function translateStatus(status) {
    const statusMap = {
        'pending': 'Ожидает',
        'assigned': 'Назначена',
        'in_progress': 'В работе',
        'completed': 'Завершена',
        'approved': 'Подтверждена',
        'cancelled': 'Отменена'
    };
    return statusMap[status] || status;
}

// Helper function to get user full name
async function getUserFullName(userId) {
    const { query } = require('../config/database');
    try {
        logger.debug(`Получение имени пользователя для ID: ${userId}`);
        const result = await query(
            'SELECT username FROM users WHERE id = $1',
            [userId]
        );
        const userName = result.rows[0]?.username || 'Неизвестный пользователь';
        logger.debug(`Имя пользователя ${userId}: ${userName}`);
        return userName;
    } catch (error) {
        logger.error('Ошибка получения имени пользователя:', error);
        return 'Неизвестный пользователь';
    }
}

// Helper function to send WebSocket notification
async function sendTaskNotificationWS(userIds, eventType, data) {
    if (!Array.isArray(userIds)) {
        userIds = [userIds];
    }
    
    userIds.forEach(userId => {
        const sent = websocketService.sendToUser(userId, eventType, data);
        if (sent) {
            logger.debug(`WebSocket: Отправлено уведомление "${eventType}" пользователю ${userId}`);
        }
    });
}

// Helper function to get all users who should receive task notifications
// (assignee, creator, department head, admins)
async function getTaskNotificationRecipients(task) {
    const { query } = require('../config/database');
    const recipients = new Set();
    
    logger.debug(`Получение получателей уведомлений для задачи ${task.id}`);
    
    // 1. Исполнитель задачи
    if (task.assigned_to_user) {
        recipients.add(task.assigned_to_user);
        logger.debug(`Добавлен исполнитель: ${task.assigned_to_user}`);
    }
    
    // 2. Создатель задачи (руководитель)
    if (task.created_by) {
        recipients.add(task.created_by);
        logger.debug(`Добавлен создатель: ${task.created_by}`);
    }
    
    // 3. Руководитель отдела (если не создатель)
    if (task.department_id) {
        const deptHeadResult = await query(
            'SELECT id FROM users WHERE department_id = $1 AND role = $2 AND is_active = true',
            [task.department_id, 'department_head']
        );
        deptHeadResult.rows.forEach(row => {
            recipients.add(row.id);
            logger.debug(`Добавлен руководитель отдела: ${row.id}`);
        });
    }
    
    // 4. Администраторы системы
    const adminsResult = await query(
        'SELECT id FROM users WHERE role IN ($1, $2) AND is_active = true',
        ['admin', 'system_administrator']
    );
    adminsResult.rows.forEach(row => {
        recipients.add(row.id);
        logger.debug(`Добавлен администратор: ${row.id}`);
    });
    
    const recipientArray = Array.from(recipients);
    logger.info(`Всего получателей уведомлений для задачи ${task.id}: ${recipientArray.length}`);
    
    return recipientArray;
}

// Helper function to get client info
function getClientInfo(req) {
    return {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || 'Unknown'
    };
}

// ============================================================================
// TASK CRUD ROUTES
// ============================================================================

// GET /api/tasks - Get tasks (filtered by user access)
router.get('/', authenticate, validatePagination, async (req, res) => {
    try {
        const { page = 1, limit = 10, status, priority, assigned_to_me } = req.query;
        const activeDepartmentId = getActiveDepartmentId(req);

        let result;

        if (assigned_to_me === 'true') {
            // Get tasks assigned to current user or their expert groups
            result = await TaskService.getTasksByUser(req.user.id, {
                page: parseInt(page),
                limit: parseInt(limit),
                status,
                priority,
                departmentId: activeDepartmentId
            });
        } else if (req.user.role === 'department_head' || req.user.role === 'system_administrator' || req.user.role === 'admin') {
            result = await TaskService.getTasksByDepartment(
                activeDepartmentId || null,
                {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    status,
                    priority
                }
            );
        } else {
            // Regular users can only see their assigned tasks
            result = await TaskService.getTasksByUser(req.user.id, {
                page: parseInt(page),
                limit: parseInt(limit),
                status,
                priority,
                departmentId: activeDepartmentId
            });
        }

        res.status(200).json({
            success: true,
            data: {
                tasks: result.tasks.map(task => {
                    const taskJson = task.toJSON();
                    // Сохранить дополнительные поля если они есть
                    if (task.assigned_user_name) taskJson.assigned_user_name = task.assigned_user_name;
                    if (task.assigned_group_name) taskJson.assigned_group_name = task.assigned_group_name;
                    return taskJson;
                }),
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                    pages: result.pages
                }
            }
        });

    } catch (error) {
        logger.error('Get tasks failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve tasks'
        });
    }
});

// ============================================================================
// ACTIVE TASKS ENDPOINT - Получить активные задачи пользователя
// ============================================================================

// GET /api/tasks/my-active - Получить задачи со статусом "in_progress" для текущего пользователя
// ВАЖНО: Этот route должен быть ПЕРЕД /:id чтобы Express не путал "my-active" с ID
router.get('/my-active', authenticate, async (req, res) => {
    try {
        const activeDepartmentId = getActiveDepartmentId(req);

        logger.info('GET /api/tasks/my-active called', {
            userId: req.user.id,
            role: req.user.role,
            organizationId: req.user.organization_id,
            departmentId: activeDepartmentId
        });
        
        let tasksWithProfileCount = [];
        
        // Для админов и руководителей отделов - показываем все активные задачи организации/отдела
        if (req.user.role === 'admin' || req.user.role === 'department_head' || req.user.role === 'system_administrator') {
            const { query } = require('../config/database');
            
            let queryText = `
                SELECT t.*
                FROM tasks t
                WHERE t.status = 'in_progress' 
                  AND t.is_active = true
            `;
            
            const params = [];
            
            if (activeDepartmentId) {
                params.push(activeDepartmentId);
                queryText += ` AND t.department_id = $1`;
            } else if (req.user.role === 'department_head' && req.user.department_id) {
                params.push(req.user.department_id);
                queryText += ` AND t.department_id = $1`;
            } else if (req.user.organization_id) {
                params.push(req.user.organization_id);
                queryText += `
                  AND EXISTS (
                    SELECT 1
                    FROM departments d
                    WHERE d.id = t.department_id
                      AND d.organization_id = $1
                  )
                `;
            }

            queryText += ` ORDER BY t.created_at DESC`;
            
            logger.info('Executing query for admin/department_head', {
                queryText,
                params
            });
            
            const result = await query(queryText, params);
            
            logger.info('Query result', {
                rowCount: result.rows.length
            });
            
            const tasks = result.rows.map(row => new Task(row));
            
            // Для каждой задачи получить количество загруженных профилей
            const DNAProfile = require('../models/DNAProfile');
            tasksWithProfileCount = await Promise.all(
                tasks.map(async (task) => {
                    const profileCount = await DNAProfile.countByTaskId(task.id);
                    
                    return {
                        ...task.toJSON(),
                        profile_count: profileCount
                    };
                })
            );
        } else {
            // Для аналитиков - получить задачи пользователя со статусом "in_progress"
            const result = await TaskService.getTasksByUser(req.user.id, {
                page: 1,
                limit: 100, // Достаточно для списка активных задач
                status: 'in_progress',
                departmentId: activeDepartmentId
            });

            // Для каждой задачи получить количество загруженных профилей
            const DNAProfile = require('../models/DNAProfile');
            tasksWithProfileCount = await Promise.all(
                result.tasks.map(async (task) => {
                    const profileCount = await DNAProfile.countByTaskId(task.id);
                    
                    return {
                        ...task.toJSON(),
                        profile_count: profileCount
                    };
                })
            );
        }

        logger.info('Returning tasks', {
            count: tasksWithProfileCount.length
        });

        res.status(200).json({
            success: true,
            data: tasksWithProfileCount
        });

    } catch (error) {
        logger.error('Ошибка получения активных задач:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Не удалось получить активные задачи'
        });
    }
});

/**
 * GET /api/tasks/active-count
 * Получить количество активных задач пользователя (assigned + in_progress)
 */
router.get('/active-count', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const activeDepartmentId = getActiveDepartmentId(req);
        
        const result = await Task.countActiveByUser(userId, activeDepartmentId);
        
        res.json({
            success: true,
            count: result.count
        });
    } catch (error) {
        logger.error('Ошибка подсчета активных задач:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to count active tasks'
        });
    }
});

// GET /api/tasks/:id - Get specific task
router.get('/:id', authenticate, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        // Get additional task details
        const [comments, results] = await Promise.all([
            task.getComments(),
            task.getResults()
        ]);

        res.status(200).json({
            success: true,
            data: {
                task: task.toJSON(),
                comments,
                results
            }
        });

    } catch (error) {
        logger.error('Get task failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve task'
        });
    }
});

// GET /api/tasks/:id/profiles - Get profiles attached to task
router.get('/:id/profiles', authenticate, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const { query } = require('../config/database');
        const { formatDateRu } = require('../utils/dateFormatter');
        
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        // Get all profiles (including deactivated) for the task
        const result = await query(
            'SELECT * FROM dna_profiles WHERE task_id = $1 ORDER BY upload_date DESC',
            [id]
        );

        const profiles = result.rows.map(row => ({
            id: row.id,
            sampleName: row.sample_name,
            internalNumber: row.internal_number,
            importNumber: row.import_number,
            year: row.year,
            strData: row.str_data,
            loci: row.str_data, // Для совместимости
            uploadDate: row.upload_date,
            fileSource: row.file_source,
            notes: row.notes,
            is_active: row.is_active,
            deactivated_by: row.deactivated_by,
            deactivated_at: formatDateRu(row.deactivated_at), // Форматированная дата
            deactivation_reason: row.deactivation_reason,
            expert_comment: row.expert_comment,
            comment_updated_at: formatDateRu(row.comment_updated_at), // Форматированная дата
            comment_updated_by: row.comment_updated_by
        }));

        res.status(200).json({
            success: true,
            data: {
                profiles,
                count: profiles.length
            }
        });

    } catch (error) {
        logger.error('Get task profiles failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve task profiles'
        });
    }
});

// POST /api/tasks - Create new task (department head or admin only)
router.post('/', authenticate, departmentHeadOrAdmin, validateCreateTask, async (req, res) => {
    try {
        console.log('📝 Received req.body:', JSON.stringify(req.body, null, 2));
        const activeDepartmentId = getActiveDepartmentId(req);

        if (!activeDepartmentId) {
            return res.status(400).json({
                error: 'Task Creation Failed',
                message: 'Не удалось определить активный отдел для новой задачи'
            });
        }

        const taskData = {
            ...req.body,
            department_id: activeDepartmentId,
            created_by: req.user.id
        };
        
        console.log('📝 Task data to create:', JSON.stringify(taskData, null, 2));
        
        const clientInfo = getClientInfo(req);

        const task = await TaskService.createTask(taskData);
        
        console.log('📝 Created task:', JSON.stringify(task.toJSON(), null, 2));

        // Отправить WebSocket уведомление всем заинтересованным лицам
        const recipients = await getTaskNotificationRecipients(task);
        if (recipients.length > 0) {
            const creatorName = await getUserFullName(req.user.id);
            await sendTaskNotificationWS(recipients, 'task:created', {
                taskId: task.id,
                taskTitle: task.title,
                priority: task.priority,
                internalNumberStart: task.internal_number_start,
                internalNumberEnd: task.internal_number_end,
                message: `Новая задача создана: "${task.title}"`,
                userName: creatorName,
                timestamp: new Date().toISOString()
            });
        }

        // Log action
        await authService.logOperation(req.user.id, 'TASK_CREATE', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title,
            assignedTo: task.assigned_to_user || task.assigned_to_group
        });

        res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: {
                task: task.toJSON()
            }
        });

    } catch (error) {
        logger.error('Create task failed:', error.message);
        
        res.status(400).json({
            error: 'Task Creation Failed',
            message: error.message || 'Failed to create task'
        });
    }
});

// PUT /api/tasks/:id - Update task (department head or admin only)
router.put('/:id', authenticate, departmentHeadOrAdmin, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const clientInfo = getClientInfo(req);

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        await task.update(updates);

        // Log action
        await authService.logOperation(req.user.id, 'TASK_UPDATE', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title,
            updates
        });

        res.status(200).json({
            success: true,
            message: 'Task updated successfully',
            data: {
                task: task.toJSON()
            }
        });

    } catch (error) {
        logger.error('Update task failed:', error.message);
        
        res.status(400).json({
            error: 'Task Update Failed',
            message: error.message || 'Failed to update task'
        });
    }
});

// DELETE /api/tasks/:id - Deactivate task (department head or admin only)
router.delete('/:id', authenticate, departmentHeadOrAdmin, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const clientInfo = getClientInfo(req);

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        await task.deactivate();

        // Log action
        await authService.logOperation(req.user.id, 'TASK_DEACTIVATE', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title
        });

        res.status(200).json({
            success: true,
            message: 'Task deactivated successfully'
        });

    } catch (error) {
        logger.error('Deactivate task failed:', error.message);
        
        res.status(500).json({
            error: 'Task Deactivation Failed',
            message: 'Failed to deactivate task'
        });
    }
});

// ============================================================================
// TASK STATUS MANAGEMENT ROUTES
// ============================================================================

// PUT /api/tasks/:id/status - Update task status
router.put('/:id/status', authenticate, validateUUID, validateUpdateTaskStatus, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const clientInfo = getClientInfo(req);

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        await TaskService.updateTaskStatus(id, status, req.user.id);

        // Отправить WebSocket уведомление всем заинтересованным лицам
        const updatedTask = await Task.findById(id);
        const recipients = await getTaskNotificationRecipients(updatedTask);
        if (recipients.length > 0) {
            const userName = await getUserFullName(req.user.id);
            const oldStatusRu = translateStatus(task.status);
            const newStatusRu = translateStatus(status);
            await sendTaskNotificationWS(recipients, 'task:status_changed', {
                taskId: updatedTask.id,
                taskTitle: updatedTask.title,
                oldStatus: oldStatusRu,
                newStatus: newStatusRu,
                message: `Статус задачи "${updatedTask.title}" изменен: ${oldStatusRu} → ${newStatusRu}`,
                userName: userName,
                timestamp: new Date().toISOString()
            });
        }

        // Log action
        await authService.logOperation(req.user.id, 'TASK_STATUS_UPDATE', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title,
            oldStatus: task.status,
            newStatus: status
        });

        res.status(200).json({
            success: true,
            message: 'Task status updated successfully',
            data: {
                task: (await Task.findById(id)).toJSON()
            }
        });

    } catch (error) {
        logger.error('Update task status failed:', error.message);
        
        res.status(400).json({
            error: 'Status Update Failed',
            message: error.message || 'Failed to update task status'
        });
    }
});

// POST /api/tasks/:id/assign - Assign task to user or group (department head or admin only)
router.post('/:id/assign', authenticate, departmentHeadOrAdmin, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const { assigned_to_user, assigned_to_group } = req.body;
        const clientInfo = getClientInfo(req);

        if (!assigned_to_user && !assigned_to_group) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Either assigned_to_user or assigned_to_group must be provided'
            });
        }

        if (assigned_to_user && assigned_to_group) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cannot assign to both user and group simultaneously'
            });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        const assigneeType = assigned_to_user ? 'user' : 'group';
        const assigneeId = assigned_to_user || assigned_to_group;

        // Pass assignerId (current user) to the service
        await TaskService.assignTask(id, assigneeType, assigneeId, req.user.id);

        // Отправить WebSocket уведомление всем заинтересованным лицам
        const updatedTask = await Task.findById(id);
        const recipients = await getTaskNotificationRecipients(updatedTask);
        if (recipients.length > 0) {
            const assignerName = await getUserFullName(req.user.id);
            await sendTaskNotificationWS(recipients, 'task:assigned', {
                taskId: updatedTask.id,
                taskTitle: updatedTask.title,
                priority: updatedTask.priority,
                message: `Задача "${updatedTask.title}" назначена`,
                userName: assignerName,
                timestamp: new Date().toISOString()
            });
        }

        // Log action
        await authService.logOperation(req.user.id, 'TASK_ASSIGN', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title,
            assigneeType,
            assigneeId
        });

        res.status(200).json({
            success: true,
            message: 'Task assigned successfully',
            data: {
                task: (await Task.findById(id)).toJSON()
            }
        });

    } catch (error) {
        logger.error('Assign task failed:', error.message);
        
        res.status(400).json({
            error: 'Task Assignment Failed',
            message: error.message || 'Failed to assign task'
        });
    }
});

// POST /api/tasks/:id/approve - Approve completed task (department head or admin only)
router.post('/:id/approve', authenticate, departmentHeadOrAdmin, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const clientInfo = getClientInfo(req);

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        if (task.status !== 'completed') {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Only completed tasks can be approved'
            });
        }

        const result = await TaskService.approveTask(id, req.user.id);

        // Отправить WebSocket уведомление всем заинтересованным лицам
        const updatedTask = await Task.findById(id);
        const recipients = await getTaskNotificationRecipients(updatedTask);
        if (recipients.length > 0) {
            const approverName = await getUserFullName(req.user.id);
            await sendTaskNotificationWS(recipients, 'task:approved', {
                taskId: updatedTask.id,
                taskTitle: updatedTask.title,
                message: `Задача "${updatedTask.title}" подтверждена`,
                userName: approverName,
                masterArrayAdded: result.masterArrayResult?.success?.length || 0,
                timestamp: new Date().toISOString()
            });
        }

        // Log action
        await authService.logOperation(req.user.id, 'TASK_APPROVE', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title,
            masterArrayResult: result.masterArrayResult
        });

        // Подготовить сообщение о результате
        let message = 'Задача подтверждена успешно';
        if (result.masterArrayResult) {
            const { success, errors, total } = result.masterArrayResult;
            if (success.length > 0) {
                message += `. Добавлено ${success.length} профилей в мастер массив`;
            }
            if (errors.length > 0) {
                message += `. Ошибок: ${errors.length}`;
            }
        }

        res.status(200).json({
            success: true,
            message,
            data: {
                task: result.task.toJSON(),
                masterArrayResult: result.masterArrayResult
            }
        });

    } catch (error) {
        logger.error('Approve task failed:', error.message);
        
        res.status(400).json({
            error: 'Task Approval Failed',
            message: error.message || 'Failed to approve task'
        });
    }
});

// ============================================================================
// TASK COMMENTS ROUTES
// ============================================================================

// GET /api/tasks/:id/comments - Get task comments
router.get('/:id/comments', authenticate, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        const comments = await task.getComments();

        res.status(200).json({
            success: true,
            data: {
                comments
            }
        });

    } catch (error) {
        logger.error('Get task comments failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve task comments'
        });
    }
});

// POST /api/tasks/:id/comments - Add comment to task
router.post('/:id/comments', authenticate, validateUUID, validateAddTaskComment, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = req.body;
        const clientInfo = getClientInfo(req);

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        const taskComment = await task.addComment(req.user.id, comment);

        // Log action
        await authService.logOperation(req.user.id, 'TASK_COMMENT_ADD', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title,
            commentId: taskComment.id
        });

        res.status(201).json({
            success: true,
            message: 'Comment added successfully',
            data: {
                comment: taskComment.toJSON()
            }
        });

    } catch (error) {
        logger.error('Add task comment failed:', error.message);
        
        res.status(400).json({
            error: 'Comment Creation Failed',
            message: error.message || 'Failed to add comment'
        });
    }
});

// ============================================================================
// TASK RESULTS ROUTES
// ============================================================================

// GET /api/tasks/:id/results - Get task results
router.get('/:id/results', authenticate, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        const results = await task.getResults();

        res.status(200).json({
            success: true,
            data: {
                results
            }
        });

    } catch (error) {
        logger.error('Get task results failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve task results'
        });
    }
});

// POST /api/tasks/:id/results - Add result to task
router.post('/:id/results', authenticate, validateUUID, validateAddTaskResult, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const { result_data, analysis_metadata } = req.body;
        const clientInfo = getClientInfo(req);

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Task not found'
            });
        }

        const taskResult = await TaskResult.create({
            task_id: id,
            user_id: req.user.id,
            result_data,
            analysis_metadata
        });

        // Log action
        await authService.logOperation(req.user.id, 'TASK_RESULT_ADD', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title,
            resultId: taskResult.id
        });

        res.status(201).json({
            success: true,
            message: 'Result added successfully',
            data: {
                result: taskResult.toJSON()
            }
        });

    } catch (error) {
        logger.error('Add task result failed:', error.message);
        
        res.status(400).json({
            error: 'Result Creation Failed',
            message: error.message || 'Failed to add result'
        });
    }
});

// ============================================================================
// TASK STATISTICS ROUTES
// ============================================================================

// GET /api/tasks/stats/dashboard - Get task statistics for dashboard
router.get('/stats/dashboard', authenticate, async (req, res) => {
    try {
        const activeDepartmentId = getActiveDepartmentId(req);
        let stats;

        if ((req.user.role === 'system_administrator' || req.user.role === 'admin') && !activeDepartmentId) {
            stats = await TaskService.getSystemTaskStats();
        } else if (
            activeDepartmentId
            && (
                req.user.role === 'department_head'
                || req.user.role === 'admin'
                || req.user.role === 'system_administrator'
            )
        ) {
            stats = await TaskService.getDepartmentTaskStats(activeDepartmentId);
        } else {
            stats = await TaskService.getUserTaskStats(req.user.id, activeDepartmentId);
        }

        res.status(200).json({
            success: true,
            data: {
                stats
            }
        });

    } catch (error) {
        logger.error('Get task stats failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve task statistics'
        });
    }
});

// ============================================================================
// TASK NOTIFICATIONS ROUTES
// ============================================================================

const TaskNotification = require('../models/TaskNotification');

// GET /api/tasks/notifications - Получить уведомления пользователя
router.get('/notifications', authenticate, async (req, res) => {
    try {
        const { is_read, type, limit = 50, offset = 0 } = req.query;

        const options = {
            is_read: is_read === 'true' ? true : is_read === 'false' ? false : null,
            type,
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        const notifications = await TaskNotification.findByUser(req.user.id, options);

        res.status(200).json({
            success: true,
            data: {
                notifications: notifications.map(n => n.toJSON())
            }
        });

    } catch (error) {
        logger.error('Ошибка получения уведомлений:', error.message);
        
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: 'Не удалось получить уведомления'
        });
    }
});

// PUT /api/tasks/notifications/:id/read - Отметить уведомление как прочитанное
router.put('/notifications/:id/read', authenticate, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;

        // Проверить что уведомление принадлежит пользователю
        const notification = await TaskNotification.findById(id);
        if (!notification) {
            return res.status(404).json({
                error: 'Не найдено',
                message: 'Уведомление не найдено'
            });
        }

        if (notification.user_id !== req.user.id) {
            return res.status(403).json({
                error: 'Доступ запрещен',
                message: 'Вы не можете отметить чужое уведомление'
            });
        }

        const success = await TaskNotification.markAsRead(id);
        const newCount = await TaskNotification.getUnreadCount(req.user.id);

        res.status(200).json({
            success: true,
            message: 'Уведомление отмечено как прочитанное',
            data: {
                unread_count: newCount
            }
        });

    } catch (error) {
        logger.error('Ошибка отметки уведомления:', error.message);
        
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: 'Не удалось отметить уведомление'
        });
    }
});

// PUT /api/tasks/notifications/read-all - Отметить все уведомления как прочитанные
router.put('/notifications/read-all', authenticate, async (req, res) => {
    try {
        const count = await TaskNotification.markAllAsRead(req.user.id);

        res.status(200).json({
            success: true,
            message: `Отмечено ${count} уведомлений как прочитанные`,
            data: {
                marked_count: count,
                unread_count: 0
            }
        });

    } catch (error) {
        logger.error('Ошибка отметки всех уведомлений:', error.message);
        
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: 'Не удалось отметить уведомления'
        });
    }
});

// GET /api/tasks/notifications/count - Получить количество непрочитанных уведомлений
router.get('/notifications/count', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const count = await TaskNotification.getUnreadCount(userId);
        
        res.json({
            success: true,
            data: { count }
        });
    } catch (error) {
        logger.error('Ошибка получения счетчика уведомлений:', error);
        res.status(500).json({
            success: false,
            error: 'Не удалось получить счетчик уведомлений'
        });
    }
});

// POST /api/tasks/:id/cancel - Отменить задачу (только department_head или admin)
router.post('/:id/cancel', authenticate, departmentHeadOrAdmin, validateUUID, requireTaskAccess(), async (req, res) => {
    try {
        const { id } = req.params;
        const { cancel_reason } = req.body;
        const clientInfo = getClientInfo(req);

        if (!cancel_reason || cancel_reason.trim().length === 0) {
            return res.status(400).json({
                error: 'Неверный запрос',
                message: 'Причина отмены обязательна'
            });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({
                error: 'Не найдено',
                message: 'Задача не найдена'
            });
        }

        // Проверить что задача не завершена и не отменена
        if (task.status === 'completed' || task.status === 'approved') {
            return res.status(400).json({
                error: 'Неверный запрос',
                message: 'Нельзя отменить завершенную или подтвержденную задачу'
            });
        }

        if (task.status === 'cancelled') {
            return res.status(400).json({
                error: 'Неверный запрос',
                message: 'Задача уже отменена'
            });
        }

        // Отменить задачу
        await task.cancel(req.user.id, cancel_reason);

        // Отправить уведомление всем заинтересованным лицам
        const recipients = await getTaskNotificationRecipients(task);
        
        if (recipients.length > 0) {
            const cancellerName = await getUserFullName(req.user.id);
            await TaskNotification.createBulk(
                task.id,
                recipients,
                'task_cancelled',
                `Задача "${task.title}" отменена. Причина: ${cancel_reason}`
            );
            
            // Отправить WebSocket уведомление
            await sendTaskNotificationWS(recipients, 'task:cancelled', {
                taskId: task.id,
                taskTitle: task.title,
                cancelReason: cancel_reason,
                message: `Задача "${task.title}" отменена. Причина: ${cancel_reason}`,
                userName: cancellerName,
                timestamp: new Date().toISOString()
            });
        }

        // Логирование
        await authService.logOperation(req.user.id, 'TASK_CANCEL', {
            ...clientInfo,
            taskId: task.id,
            taskTitle: task.title,
            cancelReason: cancel_reason
        });

        res.status(200).json({
            success: true,
            message: 'Задача отменена',
            data: {
                task: task.toJSON()
            }
        });

    } catch (error) {
        logger.error('Ошибка отмены задачи:', error.message);
        
        res.status(400).json({
            error: 'Ошибка отмены задачи',
            message: error.message || 'Не удалось отменить задачу'
        });
    }
});

module.exports = router;
