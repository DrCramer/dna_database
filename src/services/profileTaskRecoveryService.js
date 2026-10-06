const { transaction } = require('../config/database');
const PermissionService = require('./permissionService');

// Восстановление выполняется только серверной CLI; preview ничего не изменяет.
async function attachOrphanProfiles({ task: taskSelector, username, file, uploadedAt, apply = false, saveUndo }) {
  if (!taskSelector || !username) throw new Error('Укажите --task и --user.');
  return transaction(async client => {
    const user = (await client.query('SELECT * FROM users WHERE username = $1 AND is_active = true FOR SHARE', [username])).rows[0];
    if (!user) throw new Error('Активный пользователь не найден.');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskSelector);
    const candidates = (await client.query(`
      SELECT t.*, d.organization_id FROM tasks t JOIN departments d ON d.id = t.department_id
      WHERE ${isUuid ? 't.id = $1::uuid' : 't.title = $1'} AND t.is_active = true
        AND t.status = 'in_progress' AND d.is_active = true
      FOR UPDATE OF t`, [taskSelector])).rows;
    const accessible = [];
    for (const task of candidates) {
      const membership = await client.query('SELECT 1 FROM user_departments WHERE user_id = $1 AND department_id = $2', [user.id, task.department_id]);
      if (task.organization_id === user.organization_id && membership.rowCount && await PermissionService.canManageTask(user.id, task.id)) accessible.push(task);
    }
    if (accessible.length !== 1) throw new Error(accessible.length ? 'Найдено несколько доступных задач. Укажите UUID задачи.' : 'Доступная задача «В работе» для этого пользователя не найдена.');
    const task = accessible[0];
    const params = [user.id, task.department_id, task.organization_id];
    let filter = '';
    if (file) { params.push(file); filter += ` AND p.file_source = $${params.length}`; }
    if (uploadedAt) { params.push(uploadedAt); filter += ` AND p.upload_date = $${params.length}::timestamp`; }
    const profiles = (await client.query(`
      SELECT p.id, p.file_source, p.upload_date::text AS uploaded_at,
        md5((to_jsonb(p) - 'task_id')::text) AS fingerprint
      FROM dna_profiles p WHERE p.user_id = $1 AND p.department_id = $2 AND p.organization_id = $3
        AND p.profile_type = 'user' AND p.is_active = true AND p.task_id IS NULL ${filter}
      ORDER BY p.upload_date, p.id FOR UPDATE OF p`, params)).rows;
    const batches = new Map();
    for (const p of profiles) {
      const key = JSON.stringify([p.file_source, p.uploaded_at]);
      if (!batches.has(key)) batches.set(key, { file: p.file_source, uploadedAt: p.uploaded_at, count: 0 });
      batches.get(key).count++;
    }
    const bound = (await client.query("SELECT count(*)::int AS count FROM dna_profiles WHERE task_id = $1 AND user_id = $2 AND profile_type = 'user' AND is_active = true", [task.id, user.id])).rows[0].count;
    const report = { mode: apply ? 'apply' : 'preview', taskId: task.id, taskTitle: task.title, username, alreadyBound: bound, orphanCount: profiles.length, batches: [...batches.values()], attached: 0 };
    if (!apply || !profiles.length) return report;
    if (batches.size !== 1) throw new Error('Найдено несколько загрузок. Уточните --file и при необходимости --uploaded-at из preview.');
    if (typeof saveUndo !== 'function') throw new Error('Не настроено сохранение файла отмены.');
    const ids = profiles.map(p => p.id);
    const undoFile = await saveUndo({ createdAt: new Date().toISOString(), taskId: task.id, userId: user.id, departmentId: task.department_id, organizationId: task.organization_id, profiles: profiles.map(p => ({ id: p.id, previousTaskId: null, fingerprint: p.fingerprint })) });
    const updated = (await client.query(`UPDATE dna_profiles p SET task_id = $1 WHERE p.id = ANY($2::uuid[]) AND p.task_id IS NULL
      RETURNING p.id, md5((to_jsonb(p) - 'task_id')::text) AS fingerprint`, [task.id, ids])).rows;
    const fingerprints = new Map(profiles.map(p => [p.id, p.fingerprint]));
    if (updated.length !== ids.length || updated.some(p => fingerprints.get(p.id) !== p.fingerprint)) throw new Error('Проверка сохранности профилей не пройдена; изменения отменены.');
    await client.query(`INSERT INTO operation_history (user_id, department_id, operation_type, operation_details, affected_resources, user_agent)
      VALUES ($1, $2, 'PROFILE_TASK_BINDING_REPAIR', $3, $4, 'server-cli')`, [user.id, task.department_id, JSON.stringify({ actor: 'server-cli', taskId: task.id, username, count: ids.length, batches: report.batches, undoFile }), JSON.stringify({ profileIds: ids, taskId: task.id })]);
    return { ...report, attached: updated.length, undoFile };
  });
}

module.exports = { attachOrphanProfiles };
