const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

// Интеграционные тесты работают только в отдельной тестовой БД.
const databaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
test('Реальные PostgreSQL, authenticate, preview и upload', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /^\/dna_import_test(?:_|$)/);
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-import-test-secret-which-is-not-used-in-production';
  const { query, pool } = require('../src/config/database');
  const DNAProfile = require('../src/models/DNAProfile');
  const originalInterval = global.setInterval;
  global.setInterval = (...args) => originalInterval(...args).unref();
  const authService = require('../src/services/authService');
  const profilesRouter = require('../src/routes/profiles');
  const genotypeRouter = require('../src/routes/genotypeAnalysisRoutes');
  const usersRouter = require('../src/routes/users');
  const tasksRouter = require('../src/routes/tasks');
  const authRouter = require('../src/routes/auth');
  global.setInterval = originalInterval;
  const express = require('express');
  const bcrypt = require('bcryptjs');
  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  app.use('/api/genotype-analysis', genotypeRouter);
  app.use('/api/profiles', profilesRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/auth', authRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/profiles`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });

  const fixtureId = require('node:crypto').randomUUID().slice(0, 8);
  const username = `import_tester_${fixtureId}`;
  const organization = (await query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`Тест импорта ${fixtureId}`])).rows[0].id;
  const otherOrganization = (await query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`Другой scope ${fixtureId}`])).rows[0].id;
  const emergency = (await query("INSERT INTO departments (name, organization_id) VALUES ('ЧС', $1) RETURNING id", [organization])).rows[0].id;
  const genetic = (await query("INSERT INTO departments (name, organization_id) VALUES ('Генетические экспертизы', $1) RETURNING id", [organization])).rows[0].id;
  const otherDepartment = (await query("INSERT INTO departments (name, organization_id) VALUES ('Генетические экспертизы', $1) RETURNING id", [otherOrganization])).rows[0].id;
  const userId = (await query("INSERT INTO users (username, email, password_hash, role, organization_id, department_id) VALUES ($4, $5, $1, 'user_analyst', $2, $3) RETURNING id", [await bcrypt.hash('ImportFixture!123', 4), organization, emergency, username, `${username}@example.invalid`])).rows[0].id;
  // Для прежних тестов parser явно разрешаем загрузку без задачи.
  await query('UPDATE users SET can_upload_without_task = true WHERE id = $1', [userId]);
  await query('INSERT INTO user_departments (user_id, department_id, is_primary) VALUES ($1, $2, true), ($1, $3, false)', [userId, emergency, genetic]);
  const { accessToken } = await authService.login(username, 'ImportFixture!123', '127.0.0.1', 'integration-test');
  const adminName = `task_admin_${fixtureId}`;
  const adminId = (await query("INSERT INTO users (username, email, password_hash, role, organization_id, department_id) VALUES ($1, $2, $3, 'admin', $4, $5) RETURNING id", [adminName, `${adminName}@example.invalid`, await bcrypt.hash('TaskFixture!123', 4), organization, emergency])).rows[0].id;
  await query('INSERT INTO user_departments (user_id, department_id, is_primary) VALUES ($1, $2, true), ($1, $3, false)', [adminId, emergency, genetic]);
  const { accessToken: adminToken } = await authService.login(adminName, 'TaskFixture!123', '127.0.0.1', 'task-integration-test');
  const columns = ['Объект', 'TH01', 'D5S818', 'D21S11'];
  const values = ['7,9', '11,12', '29,30'];

  function buffer(rows) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Профили');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  }
  async function upload(endpoint, department, rows, fields = {}) {
    const form = new FormData();
    form.append('file', new Blob([buffer(rows)]), 'fixture.xlsx');
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'X-Active-Department-Id': department }, body: form });
    const body = await response.json();
    return { status: response.status, body };
  }

  await t.test('Миграция повторяется безопасно и снимает NOT NULL с year', async () => {
    const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/027_genetic_profile_import.sql'), 'utf8');
    await query(migration);
    await query(migration);
    const column = await query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'dna_profiles' AND column_name = 'year'");
    assert.equal(column.rows[0].is_nullable, 'YES');
  });

  await t.test('Preview и upload используют активное, а не основное отделение', async () => {
    const preview = await upload('/upload/preview', genetic, [columns, ['A-1', ...values]]);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.preview.profiles[0].sampleName, 'A-1');
    assert.equal(preview.body.preview.profiles[0].year, null);
    assert.equal(preview.body.preview.profiles[0].action, 'create');
    const saved = await upload('/upload', genetic, [['Объект', 'D21S11', 'TH01', 'D5S818'], ['A-1', '29,30', '7,9', '11,12']]);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.processing.created, 1);
    const profile = (await query("SELECT * FROM dna_profiles WHERE sample_name = 'A-1' AND user_id = $1", [userId])).rows[0];
    assert.equal(profile.department_id, genetic);
    assert.equal(profile.organization_id, organization);
    assert.equal(profile.internal_number, 'A-1');
    assert.equal(profile.year, null);
    assert.deepEqual(profile.str_data, { TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30'] });
    assert.equal(JSON.parse(profile.notes).importFormat, 'genetic');
    assert.equal(JSON.parse(profile.notes).rowNumber, 2);
  });

  await t.test('Дедупликация объекта, scope и защита индекса при конкурентной записи', async () => {
    const conflict = await upload('/upload/preview', genetic, [columns, [' a-1 ', ...values]]);
    assert.equal(conflict.body.preview.profiles[0].action, 'conflict');
    const repeated = await upload('/upload', genetic, [columns, ['a-1', ...values]], { performDeduplication: 'false', allowDuplicates: 'true' });
    assert.equal(repeated.body.processing.created, 0);
    assert.equal(repeated.body.processing.duplicates, 1);
    const profile = { importFormat: 'genetic', departmentId: otherDepartment, organizationId: otherOrganization, userId, sampleName: 'A-1', internalNumber: 'A-1', strData: { TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30'] } };
    await DNAProfile.create(profile);
    const checks = await DNAProfile.checkExistingProfiles(userId, [{ ...profile, sampleName: 'A-2' }], { departmentId: genetic, organizationId: organization });
    assert.equal(checks[0].action, 'create');
    await assert.rejects(DNAProfile.create(profile), error => error.code === '23505');
    const sameGenotype = await upload('/upload', genetic, [columns, ['A-2', ...values]]);
    assert.equal(sameGenotype.body.processing.created, 1);
  });

  await t.test('Preview отличает деактивированный профиль от конфликта и допускает замену', async () => {
    await query("UPDATE dna_profiles SET is_active = false WHERE sample_name = 'A-2' AND department_id = $1", [genetic]);
    const preview = await upload('/upload/preview', genetic, [columns, ['A-2', ...values]]);
    assert.equal(preview.body.preview.profiles[0].action, 'replace');
    const saved = await upload('/upload', genetic, [columns, ['A-2', ...values]], { replaceDeactivated: 'true' });
    assert.equal(saved.body.processing.created, 1);
  });

  await t.test('В ЧС новый файл отклоняется; старый импорт с годом сохраняется', async () => {
    assert.equal((await upload('/upload/preview', emergency, [columns, ['A-1', ...values]])).status, 400);
    assert.equal((await upload('/upload', emergency, [columns, ['A-1', ...values]])).status, 400);
    const headers = ['№ присвоенный в в/ч № 522 ЦПООП Северо-Кавказского военного округа, г. Ростов-на-Дону', 'Привоз', 'Год', 'Sample Name', 'D3S1358', 'vWA', 'D16S539'];
    const rows = [headers, ['Я9700', 7, 2024, '110-1', '15,18', '18,18', '9,11']];
    const preview = await upload('/upload/preview', emergency, rows);
    const saved = await upload('/upload', emergency, rows);
    assert.equal(preview.status, 200);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const profile = (await query("SELECT * FROM dna_profiles WHERE sample_name = 'Я9700' AND user_id = $1", [userId])).rows[0];
    assert.equal(profile.year, 2024);
    assert.equal(profile.internal_number, '110-1');
    assert.equal(profile.import_number, '7');
    assert.equal(profile.department_id, emergency);
    await assert.rejects(query("INSERT INTO dna_profiles (sample_name, str_data, import_format) VALUES ('INVALID', '{}', 'emergency')"), error => error.code === '23514');
  });

  await t.test('authenticate запрещает отделение без доступа', async () => {
    assert.equal((await upload('/upload/preview', otherDepartment, [columns, ['A-3', ...values]])).status, 403);
    assert.equal((await upload('/upload', otherDepartment, [columns, ['A-3', ...values]])).status, 403);
  });

  await t.test('Ошибки структуры и строк не обходятся skipValidation', async () => {
    const invalid = await upload('/upload', genetic, [['Объект', 'TH01', 'D5S818', 'D21S1I'], ['A-3', ...values]], { skipValidation: 'true' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.message, /Неизвестный генетический локус/);
    const duplicate = await upload('/upload', genetic, [columns, ['A-3', ...values], [' A-3 ', ...values]]);
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.code, 'INTERNAL_DUPLICATES');
    const empty = await upload('/upload/preview', genetic, [columns, [], [null, ...values]]);
    assert.equal(empty.body.details.validationErrors[0].rowNumber, 3);
  });

  await t.test('API списка показывает профиль в отделении загрузки', async () => {
    const response = await fetch(baseUrl, { headers: { Authorization: `Bearer ${accessToken}`, 'X-Active-Department-Id': genetic } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert(body.profiles.some(p => p.sampleName === 'A-1' && p.year === null));
    assert(body.profiles.every(p => p.departmentId === genetic));
    const analysisResponse = await fetch(baseUrl.replace('/api/profiles', '/api/genotype-analysis/profiles'), { headers: { Authorization: `Bearer ${accessToken}`, 'X-Active-Department-Id': genetic } });
    const analysisBody = await analysisResponse.json();
    assert.equal(analysisResponse.status, 200, JSON.stringify(analysisBody));
    assert(analysisBody.profiles.some(p => p.sample_name === 'A-1'));
    assert(!analysisBody.profiles.some(p => p.sample_name === 'Я9700'));
  });

  await t.test('Admin получает массив исполнителей активного отделения с фильтром роли', async () => {
    const endpoint = baseUrl.replace('/api/profiles', '/api/users/department?role=user_analyst');
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${adminToken}`, 'X-Active-Department-Id': genetic } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert(Array.isArray(body.data), 'Исполнители возвращаются напрямую в data');
    assert(body.data.some(user => user.id === userId), 'Аналитик доступен через дополнительное отделение');
    assert(body.data.every(user => user.role === 'user_analyst' && user.is_active));
    assert(!body.data.some(user => user.id === adminId));
    const denied = await fetch(endpoint, { headers: { Authorization: `Bearer ${adminToken}`, 'X-Active-Department-Id': otherDepartment } });
    assert.equal(denied.status, 403);
  });

  await t.test('Admin создаёт задачи с четырьмя приоритетами и правильным номером в уведомлении', async () => {
    const endpoint = baseUrl.replace('/api/profiles', '/api/tasks');
    async function create(priority, department) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'X-Active-Department-Id': department, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Приоритет ${priority}`, description: 'Синтетическая проверка создания задачи', priority,
          assigned_to_user: userId, internal_number_start: 'Э-2026/7', internal_number_end: null, target_sample: {}, data_source: 'new_array' })
      });
      const body = await response.json();
      return { response, body };
    }
    for (const priority of ['low', 'medium', 'high', 'urgent']) {
      const { response, body } = await create(priority, genetic);
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.equal(body.data.task.priority, priority);
      assert.equal(body.data.task.department_id, genetic);
      assert.equal(body.data.task.assigned_to_user, userId);
      assert.equal(body.data.task.internal_number_start, 'Э-2026/7');
      const notification = (await query("SELECT message FROM task_notifications WHERE task_id = $1 AND user_id = $2 AND type = 'new_task'", [body.data.task.id, userId])).rows[0];
      assert(notification, 'Уведомление исполнителю создано');
      assert.match(notification.message, /Номер экспертизы: Э-2026\/7/);
      assert(!notification.message.includes('Номер привоза'));
    }
    const emergencyTask = await create('medium', emergency);
    assert.equal(emergencyTask.response.status, 201, JSON.stringify(emergencyTask.body));
    const notification = (await query('SELECT message FROM task_notifications WHERE task_id = $1 AND user_id = $2', [emergencyTask.body.data.task.id, userId])).rows[0];
    assert.match(notification.message, /Номер привоза: Э-2026\/7/);
    assert.equal((await create('unsupported', genetic)).response.status, 400);
  });

  await t.test('Перенос задачи в мастер-массив сохраняет NULL-год и активное отделение', async () => {
    const masterId = (await query("INSERT INTO master_arrays (name, department_id) VALUES ('Genetic fixture', $1) RETURNING id", [genetic])).rows[0].id;
    const emergencyMasterId = (await query("INSERT INTO master_arrays (name, department_id) VALUES ('Emergency fixture', $1) RETURNING id", [emergency])).rows[0].id;
    await query('UPDATE departments SET master_array_id = $1 WHERE id = $2', [masterId, genetic]);
    await query('UPDATE departments SET master_array_id = $1 WHERE id = $2', [emergencyMasterId, emergency]);
    const taskId = (await query("INSERT INTO tasks (title, department_id, created_by, assigned_to_user, target_sample, data_source, status) VALUES ('Тест переноса', $1, $2, $2, '{}', 'new_array', 'completed') RETURNING id", [genetic, userId])).rows[0].id;
    await query("UPDATE dna_profiles SET task_id = $1 WHERE user_id = $2 AND department_id = $3 AND sample_name = 'A-1'", [taskId, userId, genetic]);
    const taskService = require('../src/services/taskService');
    const transferred = await taskService.addToMasterArray(taskId, userId);
    assert.equal(transferred.errors.length, 0, JSON.stringify(transferred));
    assert.equal(transferred.success.length, 1);
    const stored = (await query('SELECT * FROM master_array_profiles WHERE master_array_id = $1', [masterId])).rows[0];
    assert.equal(stored.year, null);
    assert.equal(stored.sample_name, 'A-1');
    assert.equal(stored.metadata.importFormat, 'genetic');
    const MasterArray = require('../src/models/MasterArray');
    const master = await MasterArray.findById(masterId);
    const sample = { sample_name: 'M-2', internal_number: 'M-2', str_data: { TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30'] }, metadata: { importFormat: 'genetic' }, created_by: userId };
    assert.equal((await master.addProfile(sample)).year, null);
    const repeated = await master.addProfilesBatch([{ ...sample, sample_name: 'm-2' }]);
    assert.equal(repeated.success.length, 0);
    assert.equal(repeated.errors.length, 1);
    const emergencyMaster = await MasterArray.findById(emergencyMasterId);
    await assert.rejects(emergencyMaster.addProfile({ ...sample, metadata: {} }), /Year|Год/);
    const accessible = await DNAProfile.getAccessibleProfiles(userId, { departmentId: genetic });
    assert.equal(accessible.departmentInfo.department_id, genetic);
    assert.equal(accessible.masterArrayProfiles.length, 2);
  });
  await t.test('Права загрузки: API запрещает обход, администратор управляет обоими режимами', async t => {
    const restrictedName = `restricted_${fixtureId}`;
    const restrictedId = (await query("INSERT INTO users (username, email, password_hash, role, organization_id, department_id) VALUES ($1, $2, $3, 'user_analyst', $4, $5) RETURNING id", [restrictedName, `${restrictedName}@example.invalid`, await bcrypt.hash('RestrictedFixture!123', 4), organization, emergency])).rows[0].id;
    await query('INSERT INTO user_departments (user_id, department_id, is_primary) VALUES ($1, $2, true), ($1, $3, false)', [restrictedId, emergency, genetic]);
    const { accessToken: restrictedToken } = await authService.login(restrictedName, 'RestrictedFixture!123', '127.0.0.1', 'upload-policy-test');
    const apiUrl = baseUrl.replace('/api/profiles', '/api');
    const headers = token => ({ Authorization: `Bearer ${token}`, 'X-Active-Department-Id': genetic, 'Content-Type': 'application/json' });
    async function requestUpload(endpoint, taskId, name = 'PERMISSION-PROFILE', extra = {}) {
      const form = new FormData();
      form.append('file', new Blob([buffer([columns, [name, ...values]])]), 'permissions.xlsx');
      if (taskId !== undefined) form.append('taskId', taskId);
      Object.entries(extra).forEach(([key, value]) => form.append(key, value));
      const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${restrictedToken}`, 'X-Active-Department-Id': genetic }, body: form });
      return { status: response.status, body: await response.json() };
    }
    async function task(status = 'in_progress', department = genetic, assignee = restrictedId) {
      return (await query("INSERT INTO tasks (title, department_id, created_by, assigned_to_user, target_sample, data_source, status) VALUES ('Политика загрузки', $1, $2, $3, '{}', 'new_array', $4) RETURNING id", [department, adminId, assignee, status])).rows[0].id;
    }
    const taskId = await task();
    async function setPermissions(withTask, withoutTask) {
      const response = await fetch(`${apiUrl}/users/${restrictedId}`, { method: 'PUT', headers: headers(adminToken), body: JSON.stringify({ can_upload_with_task: withTask, can_upload_without_task: withoutTask }) });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.data.user.can_upload_with_task, withTask);
      assert.equal(body.data.user.can_upload_without_task, withoutTask);
    }

    await t.test('Default и миграция: без задачи запрещено, повторный запуск сохраняет настройки', async () => {
      const initial = (await query('SELECT can_upload_with_task, can_upload_without_task FROM users WHERE id = $1', [restrictedId])).rows[0];
      assert.deepEqual(initial, { can_upload_with_task: true, can_upload_without_task: false });
      const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/028_profile_upload_permissions.sql'), 'utf8');
      await query(migration); await query(migration);
      assert.equal((await query('SELECT can_upload_without_task FROM users WHERE id = $1', [userId])).rows[0].can_upload_without_task, true);
      for (const endpoint of ['/upload/preview', '/upload', '/bulk-upload-with-comparison']) {
        const denied = await requestUpload(endpoint, undefined, 'DENIED', { skipValidation: 'true', validationOnly: 'true', can_upload_without_task: 'true' });
        assert.equal(denied.status, 403, JSON.stringify(denied.body));
        assert.equal(denied.body.code, 'TASK_REQUIRED');
      }
      assert.equal(Number((await query('SELECT count(*) FROM dna_profiles WHERE user_id = $1', [restrictedId])).rows[0].count), 0);
    });

    await t.test('Задача: запись привязана, проверяются статус, отделение, доступ и UUID', async () => {
      const accepted = await requestUpload('/upload', taskId);
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      assert.equal((await query('SELECT task_id FROM dna_profiles WHERE user_id = $1', [restrictedId])).rows[0].task_id, taskId);
      assert.equal((await requestUpload('/upload/preview', 'not-a-uuid')).status, 400);
      assert.equal((await requestUpload('/upload/preview', require('node:crypto').randomUUID())).status, 404);
      assert.equal((await requestUpload('/upload/preview', await task('in_progress', emergency))).body.code, 'TASK_DEPARTMENT_MISMATCH');
      assert.equal((await requestUpload('/upload/preview', await task('in_progress', genetic, userId))).body.code, 'TASK_ACCESS_DENIED');
      for (const status of ['assigned', 'completed', 'approved', 'cancelled']) {
        const denied = await requestUpload('/upload/preview', await task(status));
        assert.equal(denied.status, 409, JSON.stringify(denied.body));
        assert.equal(denied.body.code, 'TASK_NOT_IN_PROGRESS');
      }
      const inactive = await task(); await query('UPDATE tasks SET is_active = false WHERE id = $1', [inactive]);
      assert.equal((await requestUpload('/upload/preview', inactive)).status, 404);
      const group = (await query("INSERT INTO expert_groups (name, department_id, created_by) VALUES ('Upload group', $1, $2) RETURNING id", [genetic, adminId])).rows[0].id;
      await query('INSERT INTO expert_group_members (group_id, user_id, added_by) VALUES ($1, $2, $3)', [group, restrictedId, adminId]);
      const groupTask = await task(); await query('UPDATE tasks SET assigned_to_user = NULL, assigned_to_group = $1 WHERE id = $2', [group, groupTask]);
      assert.equal((await requestUpload('/upload/preview', groupTask)).status, 200);
      await query('UPDATE expert_group_members SET is_active = false WHERE group_id = $1', [group]);
      assert.equal((await requestUpload('/upload/preview', groupTask)).body.code, 'TASK_ACCESS_DENIED');
    });

    await t.test('Четыре сочетания прав и отзыв доступа проверяются с тем же JWT', async () => {
      for (const [withTask, withoutTask] of [[true, false], [false, false], [false, true], [true, true]]) {
        await setPermissions(withTask, withoutTask);
        assert.equal((await requestUpload('/upload/preview', taskId)).status, withTask ? 200 : 403);
        assert.equal((await requestUpload('/upload/preview')).status, withoutTask ? 200 : 403);
      }
      await setPermissions(false, true);
      const free = await requestUpload('/upload', undefined, 'EXPLICITLY-ALLOWED');
      assert.equal(free.status, 200, JSON.stringify(free.body));
      assert.equal((await query("SELECT task_id FROM dna_profiles WHERE user_id = $1 AND sample_name = 'EXPLICITLY-ALLOWED'", [restrictedId])).rows[0].task_id, null);
      await setPermissions(false, false);
      for (const endpoint of ['/upload/preview', '/upload', '/bulk-upload-with-comparison']) {
        assert.equal((await requestUpload(endpoint, taskId, 'NO-BYPASS', { can_upload_with_task: 'true' })).status, 403);
      }
      const me = await fetch(`${apiUrl}/auth/me`, { headers: headers(restrictedToken) });
      const body = await me.json();
      assert.equal(me.status, 200, JSON.stringify(body));
      assert.equal(body.data.user.can_upload_with_task, false);
      assert.equal(body.data.user.can_upload_without_task, false);
    });

    await t.test('Настройка прав доступна только admin; строки вместо boolean отклоняются', async () => {
      const forbidden = await fetch(`${apiUrl}/users/${restrictedId}`, { method: 'PUT', headers: headers(restrictedToken), body: JSON.stringify({ can_upload_without_task: true }) });
      assert.equal(forbidden.status, 403);
      const headName = `head_${fixtureId}`;
      const headId = (await query("INSERT INTO users (username,email,password_hash,role,organization_id,department_id) VALUES ($1,$2,$3,'department_head',$4,$5) RETURNING id", [headName, `${headName}@example.invalid`, await bcrypt.hash('HeadFixture!123', 4), organization, genetic])).rows[0].id;
      await query('INSERT INTO user_departments (user_id,department_id,is_primary) VALUES ($1,$2,true)', [headId, genetic]);
      const { accessToken: headToken } = await authService.login(headName, 'HeadFixture!123', '127.0.0.1', 'permissions-head-test');
      const headDenied = await fetch(`${apiUrl}/users/${restrictedId}`, { method: 'PUT', headers: headers(headToken), body: JSON.stringify({ can_upload_without_task: true }) });
      assert.equal(headDenied.status, 403);
      const promoted = await fetch(`${apiUrl}/users/${headId}`, { method: 'PUT', headers: headers(headToken), body: JSON.stringify({ role: 'admin' }) });
      assert.equal(promoted.status, 403);
      const createAdmin = await fetch(`${apiUrl}/users`, { method: 'POST', headers: headers(headToken), body: JSON.stringify({ username: 'forbidden_admin', email: 'forbidden@example.invalid', password: 'ForbiddenAdmin!123', role: 'admin' }) });
      assert.equal(createAdmin.status, 403);
      const invalid = await fetch(`${apiUrl}/users/${restrictedId}`, { method: 'PUT', headers: headers(adminToken), body: JSON.stringify({ can_upload_without_task: 'false' }) });
      assert.equal(invalid.status, 400);
      assert.equal((await query('SELECT can_upload_without_task FROM users WHERE id=$1', [restrictedId])).rows[0].can_upload_without_task, false);
      const list = await fetch(`${apiUrl}/users?page=1&limit=100`, { headers: headers(adminToken) });
      const listedUser = (await list.json()).data.users.find(user => user.id === restrictedId);
      assert.equal(listedUser.can_upload_without_task, false);
      assert.equal(listedUser.can_upload_with_task, false);
      const history = (await query("SELECT operation_details FROM operation_history WHERE operation_type = 'USER_UPDATE' AND operation_details->>'targetUserId' = $1 ORDER BY timestamp DESC LIMIT 1", [restrictedId])).rows[0];
      assert.deepEqual(history.operation_details.uploadPermissions.after, { can_upload_with_task: false, can_upload_without_task: false });
    });

    await t.test('Создание пользователя сохраняет выбранные права загрузки', async () => {
      const response = await fetch(`${apiUrl}/auth/register-with-department`, { method: 'POST', headers: headers(adminToken), body: JSON.stringify({ username: `created_${fixtureId}`, email: `created_${fixtureId}@example.invalid`, password: 'CreatedFixture!123', role: 'user_analyst', organization_id: organization, department_ids: [genetic], can_upload_with_task: false, can_upload_without_task: true }) });
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.equal(body.data.user.can_upload_with_task, false);
      assert.equal(body.data.user.can_upload_without_task, true);
      assert.deepEqual((await query('SELECT can_upload_with_task,can_upload_without_task FROM users WHERE id=$1', [body.data.user.id])).rows[0], { can_upload_with_task: false, can_upload_without_task: true });
    });
  });

});
