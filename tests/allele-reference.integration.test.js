const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const XLSX = require('xlsx');
const databaseUrl = process.env.ALLELE_REFERENCE_TEST_DATABASE_URL;
test('Референсы: реальные PostgreSQL, права, версии, кэш, конвертация и импорт', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /^\/dna_reference_test(?:_|$)/);
  process.env.DATABASE_URL = databaseUrl; process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-reference-test-secret-not-used-in-production';
  const { query, pool } = require('../src/config/database');
  const originalInterval = global.setInterval; global.setInterval = (...args) => originalInterval(...args).unref();
  const express = require('express'), app = express(); app.locals.pool = pool; app.use(express.json({ limit: '10mb' }));
  app.use('/api/auth', require('../src/routes/auth'));
  app.use('/api/genotype-panels', require('../src/routes/genotypePanels'));
  app.use('/api/allele-references', require('../src/routes/alleleReferences'));
  app.use('/api/genetic-excel-converter', require('../src/routes/geneticExcelConverter'));
  app.use('/api/profiles', require('../src/routes/profiles'));
  global.setInterval = originalInterval;
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const org = (await query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [`Reference fixture ${randomUUID()}`])).rows[0].id;
  const otherOrg = (await query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [`Other fixture ${randomUUID()}`])).rows[0].id;
  const department = async organization => (await query("INSERT INTO departments(name,organization_id) VALUES('Генетические экспертизы',$1) RETURNING id", [organization])).rows[0].id;
  const dept = await department(org), foreign = await department(otherOrg);
  const emergency = (await query("INSERT INTO departments(name,organization_id) VALUES('ЧС',$1) RETURNING id", [org])).rows[0].id;
  async function user(role, organization, department) {
    const username = `ref_${randomUUID().slice(0, 8)}`, password = 'ReferenceFixture!123';
    const id = (await query(`INSERT INTO users(username,email,password_hash,role,organization_id,department_id,can_upload_without_task)
      VALUES($1,$2,$3,$4,$5,$6,true) RETURNING id`, [username, `${username}@example.invalid`, await require('bcryptjs').hash(password, 4), role, organization, department])).rows[0].id;
    await query('INSERT INTO user_departments(user_id,department_id,is_primary) VALUES($1,$2,true)', [id, department]);
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200); return { id, username, password, token: (await response.json()).data.accessToken };
  }
  const admin = await user('admin', org, dept), analyst = await user('user_analyst', org, dept), other = await user('admin', otherOrg, foreign);
  if (process.env.REFERENCE_UI_FIXTURE_PATH) fs.writeFileSync(process.env.REFERENCE_UI_FIXTURE_PATH, JSON.stringify({ admin, analyst, departmentId: dept, organizationId: org }), { mode: 0o600 });
  await query('INSERT INTO user_departments(user_id,department_id,is_primary) VALUES($1,$2,false)', [admin.id, emergency]);
  const call = async (url, method = 'GET', body, who = admin, active = dept) => {
    const response = await fetch(base + url, { method, headers: { Authorization: `Bearer ${who.token}`, 'X-Active-Department-Id': active, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const endpoint = '/api/allele-references';
  const definition = { name: 'Synthetic fixture — not a manufacturer ladder', type: 'KIT_LADDER', kitName: 'Synthetic fixture', sourceTitle: 'Integration test only', sourceUrl: 'https://example.invalid/fixture', sourceVersion: 'fixture-1', confirmed: true, format: 'csv', content: 'Kit,Locus,Allele,Classification\nSynthetic fixture,D5S818,11,IN_LADDER\nSynthetic fixture,D5S818,12,IN_LADDER' };
  let referenceId, panelId;
  const DNAProfile = require('../src/models/DNAProfile');
  const baseline = await DNAProfile.create({ userId: analyst.id, organizationId: org, departmentId: dept, importFormat: 'genetic', internalNumber: 'UNCHANGED-1', sampleName: 'UNCHANGED', strData: { TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30'] } });
  await t.test('Миграция повторяется и откатывается без изменения исторических профилей и частот', async () => {
    const profile = async () => (await query('SELECT to_jsonb(p) AS value FROM dna_profiles p WHERE id=$1', [baseline.id])).rows[0].value;
    const before = await profile();
    await query(fs.readFileSync(path.join(__dirname, '../database/rollbacks/031_allele_references.sql'), 'utf8'));
    assert.equal((await query("SELECT to_regclass('allele_reference_sets') AS table_name")).rows[0].table_name, null);
    const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/031_allele_references.sql'), 'utf8');
    await query(migration); await query(migration); assert.deepEqual(await profile(), before);
  });
  await t.test('Проверка CSV, права редактирования и область доступа', async () => {
    assert.equal((await call(`${endpoint}/validate`, 'POST', definition)).status, 200);
    assert.equal((await call(`${endpoint}/validate`, 'POST', { ...definition, confirmed: false })).status, 400);
    assert.equal((await call(endpoint, 'POST', definition, analyst)).status, 403);
    assert.equal((await call(endpoint, 'GET', null, admin, emergency)).status, 403);
    const created = await call(endpoint, 'POST', definition); assert.equal(created.status, 201, JSON.stringify(created.body)); referenceId = created.body.reference.id;
    assert.equal((await call(endpoint, 'POST', definition)).status, 409);
    assert.equal((await call(`${endpoint}/${referenceId}`, 'GET', null, other, foreign)).status, 404);
    assert.equal((await call(endpoint, 'GET', null, other, foreign)).body.references.length, 0);
    assert.equal((await call(`${endpoint}/${referenceId}`, 'PATCH', { isActive: false }, analyst)).status, 403);
    assert.equal((await call(`${endpoint}/${referenceId}`, 'PATCH', { sourceVersion: 'overwrite' })).status, 400);
    assert.deepEqual((await call(`${endpoint}/${referenceId}?locus=D5S818`, 'GET', null, analyst)).body.values.map(value => value.allele), ['11', '12']);
    const panel = await call('/api/genotype-panels', 'POST', { name: 'Synthetic panel', lociOrder: ['D5S818', 'TH01', 'D21S11'], referenceSetIds: [referenceId] });
    assert.equal(panel.status, 201); panelId = panel.body.panel.id; assert.deepEqual(panel.body.panel.referenceSetIds, [referenceId]);
    const foreignSet = await call(endpoint, 'POST', definition, other, foreign);
    const rejected = await call(`/api/genotype-panels/${panelId}`, 'PUT', { ...panel.body.panel, referenceSetIds: [foreignSet.body.reference.id] });
    assert.equal(rejected.status, 404); assert.deepEqual((await call(`/api/genotype-panels/${panelId}`)).body.panel.referenceSetIds, [referenceId]);
  });
  await t.test('PopulationManager и совместимый адаптер читают реальные записи одной схемы', async () => {
    for (const [allele, frequency] of [['11', 0.4], ['12', 0.6]]) await query(`INSERT INTO population_data(population_id,population_name,locus_name,allele,frequency,sample_size)
      VALUES('reference_fixture','Synthetic frequencies','D5S818',$1,$2,100)`, [allele, frequency]);
    const PopulationManager = require('../src/services/bayesian/PopulationManager');
    const rows = await new PopulationManager().loadObservedRecords(['D5S818'], ['reference_fixture']);
    assert.equal(rows.length, 2); assert(!rows.some(row => row.allele === '11.12'));
    const Legacy = require('../src/services/bayesian/models/PopulationFrequencies');
    const legacy = new Legacy('reference_fixture'); assert.equal((await legacy.getAlleleFrequencies('D5S818')).get('11'), 0.4);
    assert.equal((await legacy.getPopulationMetadata()).sample_size, 100);
    assert.equal((await legacy.getAvailablePopulations())[0].id, 'reference_fixture');
    assert.equal((await legacy.exportPopulationData()).frequencies.length, 2);
    assert.equal((await legacy.validatePopulationData()).isValid, true);
  });
  function workbook(value, object = 'REFERENCE-1') {
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Объект', 'D5S818', 'TH01', 'D21S11'], [object, value, '7,9', '29,30']]), 'SBT_horizont');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  }
  async function convert(operation, options = {}, value = '11.12') {
    const form = new FormData(); form.append('files', new Blob([workbook(value)]), 'fixture.xlsx'); form.append('options', JSON.stringify(options));
    return fetch(`${base}/api/genetic-excel-converter/${operation}`, { method: 'POST', headers: { Authorization: `Bearer ${analyst.token}`, 'X-Active-Department-Id': dept }, body: form });
  }
  let auditSnapshot, normalized;
  await t.test('100 файлов используют пакетную загрузку референсов и частот без SQL на каждую аллель', async () => {
    const form = new FormData();
    for (let index = 0; index < 100; index++) form.append('files', new Blob([workbook('11.12', `BATCH-${index + 1}`)]), `batch-${index + 1}.xlsx`);
    form.append('options', '{}');
    const originalQuery = pool.query; let queryCount = 0;
    pool.query = function (...args) { queryCount++; return originalQuery.apply(this, args); };
    let response;
    try { response = await fetch(`${base}/api/genetic-excel-converter/preview`, { method: 'POST', headers: { Authorization: `Bearer ${analyst.token}`, 'X-Active-Department-Id': dept }, body: form }); }
    finally { pool.query = originalQuery; }
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.files.length, 100); assert.equal(result.referenceSummary.ambiguous, 100); assert.equal(result.referenceSummary.high, 100);
    assert(queryCount < 30, `Запросов к БД: ${queryCount}`);
    assert.equal((await query("SELECT count(*)::int AS count FROM dna_profiles WHERE internal_number LIKE 'BATCH-%'")).rows[0].count, 0);
  });
  await t.test('Сильное предложение требует подтверждения, экспорт сохраняет снимок и обычный импорт', async () => {
    for (const invalidOptions of [null, [], 'invalid']) assert.equal((await convert('preview', invalidOptions)).status, 400);
    const preview = await convert('preview'); assert.equal(preview.status, 200); const dirty = await preview.json(); assert.equal(dirty.canImport, false);
    const issue = dirty.issues.find(item => item.code === 'AMBIGUOUS_DOT'); assert.equal(issue.reference.suggestedValue, '11,12'); assert.equal(issue.reference.confidence, 'HIGH');
    assert.deepEqual(dirty.profiles[0].strData.D5S818, ['11.12']); assert.equal((await convert('export')).status, 409);
    const exported = await convert('export', { cells: { [issue.id]: issue.reference.suggestedDecision } }); assert.equal(exported.status, 200); normalized = Buffer.from(await exported.arrayBuffer());
    const form = new FormData(); form.append('file', new Blob([normalized]), 'reference-normalized.xlsx'); form.append('uploadTarget', 'without_task');
    const imported = await fetch(`${base}/api/profiles/upload`, { method: 'POST', headers: { Authorization: `Bearer ${analyst.token}`, 'X-Active-Department-Id': dept }, body: form });
    assert.equal(imported.status, 200, JSON.stringify(await imported.json()));
    const row = (await query("SELECT id FROM dna_profiles WHERE internal_number='REFERENCE-1' AND user_id=$1", [analyst.id])).rows[0];
    const profile = await DNAProfile.findById(row.id); assert.deepEqual(profile.strData.D5S818, ['11', '12']); assert.equal(profile.panelId, panelId);
    const stored = (await query('SELECT notes FROM dna_profiles WHERE id=$1', [row.id])).rows[0].notes;
    auditSnapshot = typeof stored === 'string' ? JSON.parse(stored) : stored;
    const audit = auditSnapshot.conversion.audit.find(item => item.locus === 'D5S818'); assert.equal(audit.reference.candidates[1].evidence[0].referenceSetId, referenceId); assert.equal(audit.reference.decision.action, 'split_dot');
  });
  await t.test('Новая версия, diff, деактивация и кэш не переписывают историческое решение', async () => {
    const next = await call(endpoint, 'POST', { ...definition, sourceVersion: 'fixture-2', previousSetId: referenceId, content: definition.content + '\nSynthetic fixture,D5S818,11.12,IN_LADDER' }); assert.equal(next.status, 201);
    const nextId = next.body.reference.id;
    const difference = await call(`${endpoint}/${referenceId}/compare?other=${nextId}`); assert.deepEqual(difference.body.added.map(value => value.allele), ['11.12']);
    await call(`/api/genotype-panels/${panelId}`, 'PUT', { name: 'Synthetic panel', lociOrder: ['D5S818', 'TH01', 'D21S11'], referenceSetIds: [referenceId, nextId] });
    const auto = await (await convert('preview')).json(); assert.equal(auto.files[0].reference.referenceSetId, null);
    const selected = await (await convert('preview', { reference: { referenceSetId: nextId } })).json();
    assert.equal(selected.issues.find(item => item.code === 'AMBIGUOUS_DOT').reference.status, 'CONFLICTING_REFERENCE_EVIDENCE');
    await call(`${endpoint}/${referenceId}`, 'PATCH', { isActive: false });
    const disabled = await convert('preview', { reference: { referenceSetId: referenceId } }); assert.equal(disabled.status, 404);
    const refreshed = await (await convert('preview')).json(); assert.equal(refreshed.files[0].reference.referenceSetId, nextId);
    const { ExcelService } = require('../src/services/excelService'); const parsed = await new ExcelService().parseExcelFile(normalized, 'reference-normalized.xlsx', { importFormat: 'genetic' });
    assert.equal(parsed[0].metadata.conversion.audit.find(item => item.locus === 'D5S818').reference.candidates[1].evidence[0].referenceVersion, 'fixture-1');
    const stored = (await query("SELECT notes FROM dna_profiles WHERE internal_number='REFERENCE-1' AND user_id=$1", [analyst.id])).rows[0].notes;
    assert.deepEqual(typeof stored === 'string' ? JSON.parse(stored) : stored, auditSnapshot);
    await query("UPDATE population_data SET frequency=0.3,updated_at=CURRENT_TIMESTAMP WHERE population_id='reference_fixture' AND allele='11'");
    const observed = await (await convert('preview', {}, '11,12')).json();
    assert.equal(observed.profiles[0].audit.find(item => item.locus === 'D5S818').reference.candidates[0].evidence.find(item => item.sourceType === 'POPULATION_DATA' && item.allele === '11').frequency, 0.3);
  });
});
