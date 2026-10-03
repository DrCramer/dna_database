const { query } = require('../config/database');
const PermissionService = require('./permissionService');
const { getProfileUploadPermissions } = require('../utils/profileUploadPermissions');

class ProfileUploadAccessError extends Error {
  constructor(message, code, status = 403) {
    super(message);
    this.name = 'ProfileUploadAccessError';
    this.code = code;
    this.status = status;
  }
}

async function assertProfileUploadAllowed(user, context) {
  const deny = (message, code, status) => { throw new ProfileUploadAccessError(message, code, status); };
  if (!['admin', 'system_administrator', 'department_head', 'user_analyst'].includes(user.role)) deny('У вас нет права загружать профили.', 'UPLOAD_FORBIDDEN');
  const permissions = getProfileUploadPermissions(user);
  if (!context.taskId) {
    if (!permissions.can_upload_without_task) deny('Перед загрузкой выберите активную задачу. Загрузка без задачи для вашей учётной записи запрещена.', 'TASK_REQUIRED');
    return;
  }
  if (!permissions.can_upload_with_task) deny('Загрузка профилей в задачу для вашей учётной записи запрещена.', 'TASK_UPLOAD_FORBIDDEN');
  if (typeof context.taskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.taskId)) deny('Некорректный идентификатор задачи.', 'INVALID_TASK_ID', 400);
  const result = await query('SELECT id, department_id, status, is_active FROM tasks WHERE id = $1', [context.taskId]);
  const task = result.rows[0];
  if (!task || !task.is_active) deny('Задача не найдена или недоступна.', 'TASK_NOT_FOUND', 404);
  if (task.department_id !== context.departmentId) deny('Выбранная задача относится к другому отделению.', 'TASK_DEPARTMENT_MISMATCH');
  if (!await PermissionService.canManageTask(user.id, task.id)) deny('Нет доступа к выбранной задаче.', 'TASK_ACCESS_DENIED');
  if (task.status !== 'in_progress') deny('Загрузка доступна только в задачу со статусом «В работе».', 'TASK_NOT_IN_PROGRESS', 409);
}

module.exports = { assertProfileUploadAllowed, ProfileUploadAccessError };
