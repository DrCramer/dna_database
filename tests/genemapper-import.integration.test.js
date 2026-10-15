const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const databaseUrl = process.env.GENEMAPPER_TEST_DATABASE_URL;

test('GeneMapper API: автоподготовка, ZIP, права, обычный импорт и привязка к задаче', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /^\/dna_genemapper_test(?:_|$)/);
  process.env.DATABASE_URL = databaseUrl; process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-genemapper-secret-not-for-production';
  const { query, pool } = require('../src/config/database');
  const originalInterval = global.setInterval;
  global.setInterval = (...args) => originalInterval(...args).unref();
  const auth = require('../src/services/security/authService');
  const express = require('express'); const app = express(); app.locals.pool = pool; app.use(express.json());
  app.use('/api/profiles', require('../src/routes/profiles'));
  app.use('/api/genetic-excel-converter', require('../src/routes/geneticExcelConverter'));
  global.setInterval = originalInterval;
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const org = (await query("INSERT INTO organizations (name) VALUES ('GeneMapper synthetic') RETURNING id")).rows[0].id;
  const departments = {};
  for (const name of ['Генетические экспертизы', 'ЧС', 'Недоступное']) departments[name] = (await query('INSERT INTO departments (name,organization_id) VALUES ($1,$2) RETURNING id', [name, org])).rows[0].id;
  const department = departments['Генетические экспертизы'], emergency = departments['ЧС'];
  const User = require('../src/models/User');
  const expert = await User.create({ username: 'genemapper_expert', password: 'GeneMapperFixture123', role: 'user_analyst', organization_id: org, department_id: department });
  await expert.syncAccessibleDepartments([department, emergency], org);
  const viewer = await User.create({ username: 'genemapper_viewer', password: 'GeneMapperFixture123', role: 'viewer', organization_id: org, department_id: department });
  const session = await auth.login(expert.username, 'GeneMapperFixture123', '127.0.0.1', 'genemapper-test');
  const viewerSession = await auth.login(viewer.username, 'GeneMapperFixture123', '127.0.0.1', 'genemapper-test');
  const headers = { Authorization: `Bearer ${session.accessToken}`, 'X-Active-Department-Id': department };
  const source = object => Buffer.from('Status\tSample Name\tSample Type\tPanel\tMarker\tAllele 1\tAllele 2\tAllele 3\tAllele 4\tAllele 5\t\r\n'
    + [['TH01','7','9.3'],['TPOX','8','8'],['D21S11','29','30']].map(([locus,a,b]) => `Analyzed\t${object}\tSample\tSynthetic\t${locus}\t${a}\t${b}\t\t\t\t`).join('\r\n'));
  async function convert(operation, options = {}, requestHeaders = headers, sources = [source('265-27')]) {
    const body = new FormData(); for (const input of sources) body.append('files', new Blob([input]), '10-09-2026_образцы.txt');
    body.append('options', JSON.stringify(options));
    return fetch(`${base}/genetic-excel-converter/${operation}`, { method: 'POST', headers: requestHeaders, body });
  }
  assert.equal((await convert('preview', {}, {})).status, 401);
  assert.equal((await convert('preview', {}, { ...headers, Authorization: `Bearer ${viewerSession.accessToken}` })).status, 403);
  assert.equal((await convert('preview', {}, { ...headers, 'X-Active-Department-Id': departments['Недоступное'] })).status, 403);
  assert.equal((await convert('preview', {}, headers, [Buffer.from('random text')])).status, 400);
  const response = await convert('preview'); assert.equal(response.status, 200);
  const initial = await response.json(); const id = initial.files[0].id;
  assert(initial.preparedFiles[0].base64); assert.equal(initial.preparedFiles[0].canUpload, false);
  assert.equal(Number((await query('SELECT count(*) FROM dna_profiles')).rows[0].count), 0);
  const audit = (await query("SELECT department_id,operation_details FROM operation_history WHERE operation_type='GENEMAPPER_CONVERSION' ORDER BY timestamp DESC LIMIT 1")).rows[0];
  assert.equal(audit.department_id, department);
  assert.equal(audit.operation_details.files[0].summary.readyProfiles, 1);
  assert(!JSON.stringify(audit.operation_details).includes('rawAlleles'));
  const options = { files: { [id]: { year: 2026 } } };
  const prepared = await (await convert('preview', options)).json(); assert.equal(prepared.preparedFiles[0].canUpload, true);
  const buffer = Buffer.from(prepared.preparedFiles[0].base64, 'base64');
  assert.deepEqual(XLSX.read(buffer, { type: 'buffer' }).SheetNames, ['Импорт']);
  const direct = await convert('export', { ...options, export: { fileId: id } });
  assert.equal(direct.status, 200); assert.match(decodeURIComponent(direct.headers.get('Content-Disposition')), /10-09-2026_образцы.xlsx/);
  const zipped = await convert('export', {}, headers, [source('265-27'), source('265-27')]);
  assert.equal(zipped.status, 200); assert.match(zipped.headers.get('Content-Type'), /application\/zip/);
  const zip = await JSZip.loadAsync(await zipped.arrayBuffer()); assert.equal(Object.keys(zip.files).length, 2);
  assert(Object.values(zip.files).every(file => /\.xlsx$/.test(file.name)));
  const task = async (dept, title) => (await query("INSERT INTO tasks (title,status,department_id,assigned_to_user,created_by,target_sample,data_source,is_active) VALUES ($1,'in_progress',$2,$3,$3,'{}','new_array',true) RETURNING id", [title, dept, expert.id])).rows[0].id;
  const taskId = await task(department, 'GeneMapper task');
  async function upload(endpoint, input, dept = department, uploadTarget = 'task', assignedTask = taskId) {
    const body = new FormData(); body.append('file', new Blob([input]), 'genemapper.xlsx'); body.append('uploadTarget', uploadTarget); if (assignedTask) body.append('taskId', assignedTask);
    const response = await fetch(`${base}/profiles${endpoint}`, { method: 'POST', headers: { ...headers, 'X-Active-Department-Id': dept }, body });
    return { status: response.status, body: await response.json() };
  }
  const noTask = await upload('/upload/preview', buffer, department, 'without_task', null); assert.equal(noTask.status, 403);
  assert.equal((await upload('/upload/preview', buffer)).status, 200);
  assert.equal(Number((await query('SELECT count(*) FROM dna_profiles')).rows[0].count), 0);
  const imported = await upload('/upload', buffer); assert.equal(imported.status, 200, JSON.stringify(imported.body)); assert.equal(imported.body.processing.created, 1);
  const stored = (await query('SELECT task_id,department_id,internal_number,year,str_data FROM dna_profiles')).rows[0];
  assert.equal(stored.task_id, taskId); assert.equal(stored.department_id, department); assert.equal(stored.internal_number, '265-27'); assert.equal(stored.year, 2026); assert.deepEqual(stored.str_data.TH01, ['7', '9.3']);
  const duplicate = await upload('/upload/preview', buffer); assert.equal(duplicate.status, 200); assert(duplicate.body.preview.breakdown.conflict > 0);
  const without = await (await convert('preview', {}, headers, [source('266-1')])).json();
  const withoutPrepared = await (await convert('preview', { files: { [without.files[0].id]: { year: 2026 } } }, headers, [source('266-1')])).json();
  await query('UPDATE users SET can_upload_without_task=true WHERE id=$1', [expert.id]);
  const outside = await upload('/upload', Buffer.from(withoutPrepared.preparedFiles[0].base64, 'base64'), department, 'without_task', null);
  assert.equal(outside.status, 200, JSON.stringify(outside.body));
  assert.equal((await query("SELECT task_id FROM dna_profiles WHERE internal_number='266-1'")).rows[0].task_id, null);
  await t.test('ЧС: обязательные метаданные, своя схема и обычная загрузка в задачу', async () => {
    const requestHeaders = { ...headers, 'X-Active-Department-Id': emergency }, input = [source('267-1')];
    const initial = await (await convert('preview', {}, requestHeaders, input)).json();
    assert.equal(initial.preparedFiles[0].ready, false);
    const ready = await (await convert('preview', { files: { [initial.files[0].id]: { year: 2026, shippingNumber: '12', samples: { '267-1': { assignedNumber: '5678' } } } } }, requestHeaders, input)).json();
    assert.equal(ready.preparedFiles[0].canUpload, true);
    const buffer = Buffer.from(ready.preparedFiles[0].base64, 'base64'); const chsTask = await task(emergency, 'GeneMapper ЧС');
    assert.equal((await upload('/upload/preview', buffer, emergency, 'task', chsTask)).status, 200);
    const imported = await upload('/upload', buffer, emergency, 'task', chsTask);
    assert.equal(imported.status, 200, JSON.stringify(imported.body)); assert.equal(imported.body.processing.created, 1);
    assert.equal((await query('SELECT department_id FROM dna_profiles WHERE task_id=$1', [chsTask])).rows[0].department_id, emergency);
  });
  await t.test('Суммарный лимит 50 МиБ действует и без Content-Length', async () => {
    const boundary = 'gene-limit-fixture'; const data = Buffer.alloc(9 * 1024 * 1024, 'a');
    async function* stream() {
      for (let index = 0; index < 6; index++) {
        yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="fixture-${index}.txt"\r\nContent-Type: text/plain\r\n\r\n`);
        yield data; yield Buffer.from('\r\n');
      }
      yield Buffer.from(`--${boundary}--\r\n`);
    }
    const response = await fetch(`${base}/genetic-excel-converter/preview`, { method: 'POST', headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: stream(), duplex: 'half', signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 413); assert.equal((await response.json()).code, 'FILES_TOO_LARGE');
  });
});
