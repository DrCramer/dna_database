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
  global.setInterval = originalInterval;
  const express = require('express');
  const bcrypt = require('bcryptjs');
  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  app.use('/api/genotype-analysis', genotypeRouter);
  app.use('/api/profiles', profilesRouter);
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
  await query('INSERT INTO user_departments (user_id, department_id, is_primary) VALUES ($1, $2, true), ($1, $3, false)', [userId, emergency, genetic]);
  const { accessToken } = await authService.login(username, 'ImportFixture!123', '127.0.0.1', 'integration-test');
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
});
