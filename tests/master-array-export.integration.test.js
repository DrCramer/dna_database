const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const XLSX = require('xlsx');

const databaseUrl = process.env.MASTER_EXPORT_TEST_DATABASE_URL;
test('Мастер-экспорт: PostgreSQL, authenticate, административный scope, фильтры и read-only XLSX', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /^\/dna_master_export_test(?:_|$)/);
  process.env.DATABASE_URL = databaseUrl; process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-master-export-fixture-jwt-not-for-production';
  const { query, pool } = require('../src/config/database');
  const User = require('../src/models/User');
  const previousInterval = global.setInterval;
  global.setInterval = (...args) => previousInterval(...args).unref();
  const auth = require('../src/services/security/authService');
  const router = require('../src/routes/masterArrays');
  global.setInterval = previousInterval;
  const express = require('express');
  const app = express(); app.use(require('../src/middleware/requestContext').requestContext); app.use(express.json()); app.use('/api/master-arrays', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const suffix = randomUUID().slice(0, 8);
  const org = (await query('INSERT INTO organizations(name) VALUES ($1) RETURNING id', [`Master export fixture ${suffix}`])).rows[0].id;
  const foreignOrg = (await query('INSERT INTO organizations(name) VALUES ($1) RETURNING id', [`Foreign export fixture ${suffix}`])).rows[0].id;
  async function department(name, organizationId = org) {
    return (await query('INSERT INTO departments(name,organization_id) VALUES ($1,$2) RETURNING id', [name, organizationId])).rows[0].id;
  }
  const genetic = await department('Генетические экспертизы'), emergency = await department('ЧС');
  const other = await department('Генетические экспертизы', foreignOrg), notAssigned = await department('ЧС', foreignOrg);
  const master = async id => (await query('SELECT id FROM master_arrays WHERE department_id=$1', [id])).rows[0].id;
  const geneticMaster = await master(genetic), emergencyMaster = await master(emergency), foreignMaster = await master(other), notAssignedMaster = await master(notAssigned);
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash('FixtureMasterExport123', 4);
  const users = {};
  for (const role of ['admin', 'system_administrator', 'department_head', 'user_analyst', 'viewer']) {
    const username = `export_${role}_${suffix}`;
    const id = (await query('INSERT INTO users(username,password_hash,role,organization_id,department_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [username, passwordHash, role, org, genetic])).rows[0].id;
    await query('INSERT INTO user_departments(user_id,department_id,is_primary) VALUES ($1,$2,true),($1,$3,false)', [id, genetic, emergency]);
    // Доступ к чужой организации admin не получает даже при ошибочной membership.
    if (['admin', 'system_administrator'].includes(role)) await query('INSERT INTO user_departments(user_id,department_id,is_primary) VALUES ($1,$2,false)', [id, other]);
    const user = await User.findById(id), token = auth.generateToken(user);
    await auth.createSession(id, token, '127.0.0.1', 'master-export-fixture');
    users[role] = { id, token, username };
  }
  const data = { TH01: ['7', '9'], D5S818: ['8', '8'], D21S11: ['29', '30'], SRY: ['SRY'], AMEL: ['X', 'Y'] };
  const ids = [];
  for (let index = 1; index <= 620; index++) ids.push((await query(`INSERT INTO master_array_profiles(master_array_id,year,sample_name,internal_number,import_number,str_data,metadata,created_by)
    VALUES ($1,$2,'258',$3,'12',$4,'{"importFormat":"genetic"}',$5) RETURNING id`, [geneticMaster, index % 2 ? 2025 : 2026, `258-${index}`, JSON.stringify(data), users.admin.id])).rows[0].id);
  await query(`INSERT INTO master_array_profiles(master_array_id,year,sample_name,internal_number,import_number,str_data,created_by)
    VALUES ($1,2026,'5678','258-1','12',$2,$3)`, [emergencyMaster, JSON.stringify(data), users.admin.id]);
  await query(`INSERT INTO master_array_profiles(master_array_id,year,sample_name,internal_number,str_data,metadata,created_by,is_active)
    VALUES ($1,2026,'258','INACTIVE',$2,'{"importFormat":"genetic"}',$3,false)`, [geneticMaster, JSON.stringify(data), users.admin.id]);

  const base = `http://127.0.0.1:${server.address().port}/api/master-arrays`;
  async function call(path, role = 'admin', body) {
    return fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${users[role].token}`, 'X-Active-Department-Id': genetic, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function preview(id = geneticMaster, body = {}) { const response = await call(`/${id}/export/preview`, 'admin', body); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
  const initialState = await query('SELECT row_to_json(p) AS value FROM master_array_profiles p ORDER BY id');
  const before = createHash('sha256').update(JSON.stringify(initialState.rows)).digest('hex');

  await t.test('Опции и экспорт закрыты для non-admin; неизвестные поля и неактивные отклоняются', async () => {
    assert.equal((await fetch(`${base}/export/options`)).status, 401);
    for (const role of ['department_head', 'user_analyst', 'viewer']) {
      assert.equal((await call('/export/options', role)).status, 403);
      for (const operation of ['preview', 'xlsx']) assert.equal((await call(`/${geneticMaster}/export/${operation}`, role, {})).status, 403);
    }
    for (const body of [{ options: { includeInactive: true } }, { organizationId: foreignOrg }, { filters: { sql: 'SELECT *' } }, { filters: { yearFrom: 2026, yearTo: 2025 } }, { filters: { yearFrom: '2025' } }]) assert.equal((await call(`/${geneticMaster}/export/preview`, 'admin', body)).status, 400);
    assert.equal((await call('/invalid/export/preview', 'admin', {})).status, 400);
    const absent = await call(`/${randomUUID()}/export/preview`, 'admin', {}); assert.equal(absent.status, 404);
    for (const operation of ['preview', 'xlsx']) assert.equal((await call(`/${foreignMaster}/export/${operation}`, 'admin', {})).status, 403);
    const arrays = (await (await call('/export/options')).json()).arrays;
    assert.deepEqual(new Set(arrays.map(array => array.id)), new Set([geneticMaster, emergencyMaster]));
    const systemArrays = (await (await call('/export/options', 'system_administrator')).json()).arrays;
    assert(systemArrays.some(array => array.id === foreignMaster));
    assert(!systemArrays.some(array => array.id === notAssignedMaster));
    assert.equal((await call(`/${notAssignedMaster}/export/preview`, 'system_administrator', {})).status, 403);
    assert.equal((await call(`/${geneticMaster}/export/preview`, 'system_administrator', {})).status, 200);
  });

  await t.test('620 профилей читаются полностью через keyset; MIME, UTF-8 имя, настоящий XLSX и обратный импорт', async () => {
    const report = await preview();
    assert.equal(report.totalMatched, 620); assert.equal(report.exportable, 620); assert.equal(report.needsReview, 0);
    assert(!JSON.stringify(report).includes('str_data')); assert(!JSON.stringify(report).includes('strData'));
    const response = await call(`/${geneticMaster}/export/xlsx`, 'admin', { options: { previewFingerprint: report.fingerprint } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get('Content-Type'), /spreadsheetml.sheet/);
    assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
    assert.match(response.headers.get('Content-Disposition'), /filename\*=UTF-8''/);
    const buffer = Buffer.from(await response.arrayBuffer());
    const audit = (await query("SELECT * FROM operation_history WHERE user_id=$1 AND operation_type='MASTER_ARRAY_EXPORT' AND operation_details->>'requestId'=$2", [users.admin.id, response.headers.get('X-Request-Id')])).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].success, true); assert.equal(audit[0].department_id, genetic);
    assert.equal(audit[0].operation_details.exportRows, 620); assert.equal(audit[0].operation_details.bytes, buffer.length);
    assert.equal(audit[0].operation_details.organizationId, org); assert.equal(audit[0].operation_details.operation, 'xlsx');
    assert(!JSON.stringify(audit).includes('str_data')); assert(!JSON.stringify(audit).includes(users.admin.token));
    const book = XLSX.read(buffer, { cellStyles: true }), sheet = book.Sheets['Импорт'];
    assert.equal(XLSX.utils.sheet_to_json(sheet).length, 620);
    assert.equal(sheet.A1.v, 'Объект'); assert.equal(sheet.B1.v, 'Год');
    const parsed = await new (require('../src/services/converters/excelService').ExcelService)().parseExcelFile(buffer, 'export.xlsx', { importFormat: 'genetic' });
    assert.equal(parsed.length, 620); assert(parsed.every(profile => profile.sampleName === '258'));
    for (const profile of parsed) assert.deepEqual(profile.strData, data);
  });

  await t.test('Фильтры и снимок предпросмотра совпадают с файлом; изменение данных требует повторной проверки', async () => {
    const filters = { yearTo: 2025, objectQuery: '258-1' };
    const report = await preview(geneticMaster, { filters });
    assert(report.totalMatched > 0 && report.totalMatched < 310);
    const response = await call(`/${geneticMaster}/export/xlsx`, 'admin', { filters, options: { previewFingerprint: report.fingerprint } });
    assert.equal(response.status, 200);
    const rows = XLSX.utils.sheet_to_json(XLSX.read(Buffer.from(await response.arrayBuffer())).Sheets['Импорт']);
    assert.equal(rows.length, report.totalMatched); assert(rows.every(row => row['Год'] === '2025' && row['Объект'].includes('258-1')));
    const empty = await preview(geneticMaster, { filters: { objectQuery: '%_literal' } }); assert.equal(empty.totalMatched, 0);
    const rejected = await call(`/${geneticMaster}/export/xlsx`, 'admin', { filters: { objectQuery: '%_literal' } });
    assert.equal(rejected.status, 409);
    const failureAudit = (await query("SELECT success,operation_details FROM operation_history WHERE user_id=$1 AND operation_type='MASTER_ARRAY_EXPORT' AND operation_details->>'requestId'=$2", [users.admin.id, rejected.headers.get('X-Request-Id')])).rows[0];
    assert.equal(failureAudit.success, false); assert.equal(failureAudit.operation_details.code, 'PREFLIGHT_FAILED');
    const full = await preview();
    await query('UPDATE master_array_profiles SET metadata=metadata || \'{"fixtureChange":true}\'::jsonb WHERE id=$1', [ids[0]]);
    assert.equal((await call(`/${geneticMaster}/export/xlsx`, 'admin', { options: { previewFingerprint: full.fingerprint } })).status, 409);
    await query("UPDATE master_array_profiles SET metadata=metadata-'fixtureChange' WHERE id=$1", [ids[0]]);
  });

  await t.test('ЧС, исторические записи и явный режим только пригодных', async () => {
    const emergencyPreview = await preview(emergencyMaster); assert.equal(emergencyPreview.exportable, 1);
    const response = await call(`/${emergencyMaster}/export/xlsx`, 'admin', {}); assert.equal(response.status, 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    const [parsed] = await new (require('../src/services/converters/excelService').ExcelService)().parseExcelFile(buffer, 'chs.xlsx', { importFormat: 'emergency' });
    assert.equal(parsed.sampleName, '5678'); assert.equal(parsed.importNumber, '12'); assert.equal(parsed.internalNumber, '258-1');
    const badId = (await query(`INSERT INTO master_array_profiles(master_array_id,year,sample_name,internal_number,str_data,metadata,created_by)
      VALUES ($1,NULL,'258','258-legacy',$2,'{"importFormat":"genetic"}',$3) RETURNING id`, [geneticMaster, JSON.stringify(data), users.admin.id])).rows[0].id;
    const report = await preview(); assert.equal(report.needsReview, 1); assert.equal(report.totalMatched, 621);
    assert.equal((await call(`/${geneticMaster}/export/xlsx`, 'admin', {})).status, 409);
    assert.equal((await call(`/${geneticMaster}/export/xlsx`, 'admin', { options: { exportValidOnly: true } })).status, 409);
    const valid = await call(`/${geneticMaster}/export/xlsx`, 'admin', { options: { exportValidOnly: true, confirmValidOnly: true, previewFingerprint: report.fingerprint } });
    assert.equal(valid.status, 200); assert.match(decodeURIComponent(valid.headers.get('Content-Disposition')), /только-пригодные/);
    assert.equal(XLSX.utils.sheet_to_json(XLSX.read(Buffer.from(await valid.arrayBuffer())).Sheets['Импорт']).length, 620);
    await query('DELETE FROM master_array_profiles WHERE id=$1', [badId]);
  });

  await t.test('Слишком большой набор отклоняется без обрезки файла', async () => {
    await query(`INSERT INTO master_array_profiles(master_array_id,year,sample_name,internal_number,str_data,metadata,created_by)
      SELECT $1,2026,'LIMIT','LIMIT-' || number,'{}'::jsonb,'{"importFormat":"genetic"}'::jsonb,$2 FROM generate_series(1,50001) AS number`, [geneticMaster, users.admin.id]);
    try {
      for (const operation of ['preview', 'xlsx']) {
        const response = await call(`/${geneticMaster}/export/${operation}`, 'admin', { filters: { objectQuery: 'LIMIT-' } });
        assert.equal(response.status, 413);
        assert.equal((await response.json()).code, 'EXPORT_TOO_LARGE');
      }
    } finally { await query("DELETE FROM master_array_profiles WHERE master_array_id=$1 AND internal_number LIKE 'LIMIT-%'", [geneticMaster]); }
  });

  await t.test('При недоступном журнале аудита файл не отправляется', async () => {
    const OperationHistory = require('../src/models/OperationHistory');
    const original = OperationHistory.logOperation;
    OperationHistory.logOperation = async () => { throw new Error('Synthetic audit outage'); };
    try {
      const response = await call(`/${geneticMaster}/export/xlsx`, 'admin', {});
      assert.equal(response.status, 500); assert.match(response.headers.get('Content-Type'), /application\/json/);
      assert.equal((await response.json()).code, 'EXPORT_ERROR');
    } finally { OperationHistory.logOperation = original; }
  });

  await t.test('Неактивные массивы/отделения/организации блокируются, исходные профили не меняются', async () => {
    for (const [table, id] of [['master_arrays', geneticMaster], ['departments', genetic], ['organizations', org]]) {
      await query(`UPDATE ${table} SET is_active=false WHERE id=$1`, [id]);
      try {
        const result = await call(`/${geneticMaster}/export/preview`, 'admin', {});
        assert([401, 403, 409].includes(result.status));
      } finally { await query(`UPDATE ${table} SET is_active=true WHERE id=$1`, [id]); }
      await query('DELETE FROM user_sessions WHERE user_id=$1', [users.admin.id]);
      await auth.createSession(users.admin.id, users.admin.token, '127.0.0.1', 'master-export-fixture');
    }
    const after = createHash('sha256').update(JSON.stringify((await query('SELECT row_to_json(p) AS value FROM master_array_profiles p ORDER BY id')).rows)).digest('hex');
    assert.equal(after, before, 'экспорт не изменяет записи, даты, генотипы и метаданные');
  });
  if (process.env.MASTER_EXPORT_BROWSER_FIXTURE_PATH) require('node:fs').writeFileSync(process.env.MASTER_EXPORT_BROWSER_FIXTURE_PATH, JSON.stringify({ username: users.admin.username, password: 'FixtureMasterExport123', geneticMaster, emergencyMaster, genetic, emergency }));
});
