const UPLOAD_PERMISSION_FIELDS = ['can_upload_with_task', 'can_upload_without_task'];

function getProfileUploadPermissions(user) {
  return {
    can_upload_with_task: user?.can_upload_with_task !== false,
    can_upload_without_task: user?.can_upload_without_task === true
  };
}

function validateUploadPermissionFields(data) {
  return UPLOAD_PERMISSION_FIELDS.every(field => data[field] === undefined || typeof data[field] === 'boolean');
}

function getProfileUploadBlockReason(user, task, departmentId) {
  if (!['admin', 'system_administrator', 'department_head', 'user_analyst'].includes(user?.role)) return 'У вас нет права загружать профили.';
  const permissions = getProfileUploadPermissions(user);
  if (!task?.id) return permissions.can_upload_without_task ? '' : 'Перед загрузкой выберите активную задачу. Загрузка без задачи для вашей учётной записи запрещена.';
  if (!permissions.can_upload_with_task) return 'Загрузка профилей в задачу для вашей учётной записи запрещена.';
  if (task.department_id !== departmentId) return 'Выбранная задача относится к другому отделению. Выберите активную задачу текущего отделения.';
  if (task.status !== 'in_progress' || task.is_active === false) return 'Загрузка доступна только в задачу со статусом «В работе». Выберите активную задачу.';
  return '';
}

module.exports = { UPLOAD_PERMISSION_FIELDS, getProfileUploadPermissions, validateUploadPermissionFields, getProfileUploadBlockReason };
