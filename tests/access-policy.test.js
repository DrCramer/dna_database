const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAccessModules, runMiddleware } = require('./fixtures/access-policy-harness');
const { state, profiles, uploads, permissions, auth, history } = loadAccessModules();
const departments = [{ id: 'active', organization_id: 'org' }, { id: 'primary', organization_id: 'org' },
  { id: 'foreign', organization_id: 'other' }];
const user = role => ({ id: 'owner', role, department_id: 'primary', organization_id: 'org',
  getAccessibleDepartments: async () => departments });
const taskId = '11111111-1111-4111-8111-111111111111';

test('Профили: матрица ролей сохраняет active department, организацию и права записи', async () => {
  for (const role of ['admin', 'system_administrator', 'department_head', 'user_analyst', 'analyst', 'viewer']) {
    state.users.set('owner', user(role));
    const scope = await profiles.ProfileAccessService.getScope({ userId: 'owner', activeDepartmentId: 'active' });
    assert.deepEqual(scope.params.slice(0, 2), ['active', 'org']);
    assert.match(scope.clause, /dp\.is_active = true/);
    if (['admin', 'system_administrator', 'department_head'].includes(role)) {
      assert.equal(scope.accessLevel, 'department'); assert.equal(scope.params.length, 2);
    } else {
      assert.equal(scope.accessLevel, 'user_and_department');
      assert.equal(scope.params[2], 'owner'); assert.match(scope.clause, /profile_type = 'master'/);
    }
    if (role === 'viewer') {
      await assert.rejects(profiles.ProfileAccessService.getScope({ userId: 'owner', activeDepartmentId: 'active', action: 'write' }), profiles.ProfileAccessError);
    } else {
      const write = await profiles.ProfileAccessService.getScope({ userId: 'owner', activeDepartmentId: 'active', action: 'write' });
      assert(!write.clause.includes("profile_type = 'master'"));
    }
    if (role !== 'system_administrator') await assert.rejects(
      profiles.ProfileAccessService.getScope({ userId: 'owner', activeDepartmentId: 'foreign' }), profiles.ProfileAccessError);
  }
  state.users.set('owner', user('unknown'));
  await assert.rejects(profiles.ProfileAccessService.getScope({ userId: 'owner', activeDepartmentId: 'active' }), profiles.ProfileAccessError);
  state.users.set('owner', user('admin'));
  for (const activeDepartmentId of [undefined, 'unavailable']) await assert.rejects(
    profiles.ProfileAccessService.getScope({ userId: 'owner', activeDepartmentId }), profiles.ProfileAccessError);
  state.query = async () => { throw new Error('database unavailable'); };
  await assert.rejects(profiles.ProfileAccessService.validateProfileAccess({ userId: 'owner', activeDepartmentId: 'active', profileId: taskId }), /database unavailable/);
});

test('Авторизация: analyst alias, маршруты и операции сохраняют свои списки ролей', async () => {
  for (const role of ['admin', 'system_administrator', 'department_head', 'user_analyst', 'analyst', 'viewer']) {
    const req = { user: user(role), params: {} };
    const analyst = await runMiddleware(auth.adminOrAnalyst, req);
    assert.equal(analyst.next, ['admin', 'department_head', 'user_analyst', 'analyst'].includes(role));
    const upload = await runMiddleware(auth.requirePermission('profile_upload'), req);
    assert.equal(upload.next, analyst.next);
    const admin = await runMiddleware(auth.adminOnly, req);
    assert.equal(admin.next, role === 'admin');
  }
  assert.equal((await runMiddleware(auth.authorize([]), {})).status, 401);
  assert.equal((await runMiddleware(auth.requirePermission('unknown'), { user: user('admin') })).status, 500);
});

test('История: собственная история, чтение чужой истории и статистики различаются', async () => {
  for (const role of ['admin', 'system_administrator', 'department_head', 'user_analyst', 'analyst', 'viewer']) {
    assert((await runMiddleware(history.checkHistoryAccess, { user: user(role), params: { userId: 'owner' } })).next);
    const req = { user: user(role), params: { userId: 'other-user' } };
    assert.equal((await runMiddleware(history.checkHistoryAccess, req)).next, role === 'admin');
    assert.equal((await runMiddleware(history.checkStatsPermission, req)).next, ['admin', 'analyst'].includes(role));
  }
});

test('Загрузка: явный выбор без задачи, запреты и проверка привязки до импорта', async () => {
  const failure = async (account, context, code, status, options) => {
    await assert.rejects(uploads.assertProfileUploadAllowed(account, context, options), e => e.code === code && e.status === status);
  };
  for (const role of ['admin', 'system_administrator', 'department_head', 'user_analyst', 'analyst', 'viewer']) {
    const account = { ...user(role), can_upload_without_task: true };
    if (['analyst', 'viewer'].includes(role)) await failure(account, { uploadTarget: 'without_task' }, 'UPLOAD_FORBIDDEN', 403);
    else await uploads.assertProfileUploadAllowed(account, { uploadTarget: 'without_task' });
  }
  const account = user('user_analyst');
  await failure(account, {}, 'TASK_REQUIRED', 403);
  await failure({ ...account, can_upload_without_task: true }, {}, 'UPLOAD_TARGET_REQUIRED', 409);
  await failure(account, { uploadTarget: 'wrong' }, 'INVALID_UPLOAD_TARGET', 400);
  await failure(account, { uploadTarget: 'without_task', taskId }, 'UPLOAD_TARGET_CONFLICT', 400);
  await failure({ ...account, can_upload_with_task: false }, { taskId }, 'TASK_UPLOAD_FORBIDDEN', 403);
  await failure(account, { taskId: '258' }, 'INVALID_TASK_ID', 400);
  const task = { id: taskId, department_id: 'active', status: 'in_progress', is_active: true };
  const calls = [];
  const options = { lockTask: true, query: async (sql, args) => { calls.push({ sql, args }); return { rows: [task] }; } };
  state.query = async () => ({ rows: [{ ...task, assigned_to_user: 'owner', role: account.role }] });
  await uploads.assertProfileUploadAllowed(account, { taskId, departmentId: 'active' }, options);
  assert.match(calls[0].sql, /FOR SHARE/); assert.deepEqual(calls[0].args, [taskId]);
  await failure(account, { taskId, departmentId: 'primary' }, 'TASK_DEPARTMENT_MISMATCH', 403, options);
  task.status = 'completed'; await failure(account, { taskId, departmentId: 'active' }, 'TASK_NOT_IN_PROGRESS', 409, options);
  task.status = 'in_progress'; task.is_active = false;
  await failure(account, { taskId, departmentId: 'active' }, 'TASK_NOT_FOUND', 404, options);
  task.is_active = true; state.query = async () => ({ rows: [] });
  await failure(account, { taskId, departmentId: 'active' }, 'TASK_ACCESS_DENIED', 403, options);
});

test('Задачи: admin, доступ начальника по user_departments, автор и активная группа', async () => {
  for (const fixture of [
    { role: 'admin', expected: true }, { role: 'system_administrator', expected: true },
    { role: 'department_head', departmentMember: true, expected: true },
    { role: 'user_analyst', created_by: 'owner', expected: true },
    { role: 'user_analyst', assigned_to_user: 'owner', expected: true },
    { role: 'user_analyst', assigned_to_group: 'group', groupMember: true, expected: true },
    { role: 'user_analyst', assigned_to_group: 'group', groupMember: false, expected: false },
    { role: 'user_analyst', expected: false }
  ]) {
    state.query = async sql => ({ rows: /FROM tasks t/.test(sql) ? [{ ...fixture, department_id: 'active' }]
      : /user_departments/.test(sql) && fixture.departmentMember || /expert_group_members/.test(sql) && fixture.groupMember ? [{}] : [] });
    assert.equal(await permissions.canManageTask('owner', taskId), fixture.expected);
  }
});
