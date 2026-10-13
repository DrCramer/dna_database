const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const databaseUrl = process.env.NGS_TEST_DATABASE_URL;

test('NGS: авторизация → конвертер → preview → активная задача → PostgreSQL и аудит', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /^\/dna_ngs_test(?:_|$)/);
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-ngs-test-secret-not-for-production';
  const { query, pool } = require('../src/config/database');
  const originalInterval = global.setInterval;
  global.setInterval = (...args) => originalInterval(...args).unref();
  const authService = require("../src/services/security/authService");
  const profilesRouter = require('../src/routes/profiles');
  const converterRouter = require('../src/routes/geneticExcelConverter');
  global.setInterval = originalInterval;
  const express = require('express');
  const app = express(); app.locals.pool = pool; app.use(express.json());
  app.use('/api/profiles', profilesRouter); app.use('/api/genetic-excel-converter', converterRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const nonce = require('node:crypto').randomUUID().slice(0, 8);
  const organization = (await query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`NGS integration ${nonce}`])).rows[0].id;
  const department = (await query("INSERT INTO departments (name, organization_id) VALUES ('Генетические экспертизы',$1) RETURNING id", [organization])).rows[0].id;
  const emergency = (await query("INSERT INTO departments (name, organization_id) VALUES ('ЧС',$1) RETURNING id", [organization])).rows[0].id;
  const username = `ngs_tester_${nonce}`;
  const password = 'IsolatedNgs!123';
  const userId = (await query("INSERT INTO users (username,email,password_hash,role,organization_id,department_id) VALUES ($1,$2,$3,'user_analyst',$4,$5) RETURNING id", [username, `${username}@example.invalid`, await require('bcryptjs').hash(password, 4), organization, department])).rows[0].id;
  await query('INSERT INTO user_departments (user_id,department_id,is_primary) VALUES ($1,$2,true),($1,$3,false)', [userId, department, emergency]);
  const taskId = (await query("INSERT INTO tasks (title,status,department_id,assigned_to_user,created_by,target_sample,data_source,is_active) VALUES ('NGS test','in_progress',$1,$2,$2,'{}','new_array',true) RETURNING id", [department, userId])).rows[0].id;
  const { LociTypeDetector } = require('../src/utils/lociTypeDetector');
  const detector = new LociTypeDetector();
  const markers = require('./fixtures/ngs-astr-marker-names').map(name => detector.getCanonicalLocusName(name));
  assert.equal(markers.length, 111);
  assert(markers.every(Boolean));
  const panelId = (await query("INSERT INTO genotype_panels (organization_id,department_id,name,loci_order,created_by,updated_by) VALUES ($1,$2,'NGS synthetic',$3,$4,$4) RETURNING id", [organization, department, JSON.stringify([...markers].reverse()), userId])).rows[0].id;
  const { accessToken } = await authService.login(username, password, '127.0.0.1', 'ngs-integration');
  const headers = { Authorization: `Bearer ${accessToken}`, 'X-Active-Department-Id': department };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['#Type','Locus','Genotype','QC Flag','Total Depth of Coverage'], ...markers.map(locus => ['ASTR',locus,'7.2,13.2','Pass',100])]), 'Result');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['#Type','Locus','Allele','QC Flag','Coverage','Structure'], ...markers.flatMap(locus => [['ASTR',locus,'7.2','Pass',50,'ATCT'],['ASTR',locus,'13.2','Pass',50,'ATCTATCT']])]), 'Detail');
  const original = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const convert = (operation, options = {}, requestHeaders = headers, input = original) => {
    const body = new FormData(); body.append('files', new Blob([input]), 'r2.251-3_20260714.ASTR+.xlsx'); body.append('options', JSON.stringify(options));
    return fetch(`${base}/genetic-excel-converter/${operation}`, { method: 'POST', headers: requestHeaders, body });
  };
  assert.equal((await convert('preview', {}, { ...headers, Authorization: 'Bearer invalid' })).status, 401);
  assert.equal((await convert('preview', {}, { ...headers, 'X-Active-Department-Id': emergency })).status, 403);
  assert.equal((await convert('export', { canImport: true })).status, 409);
  const preview = await convert('preview'); assert.equal(preview.status, 200);
  const draft = await preview.json(); assert.equal(draft.canImport, false);
  const options = { files: { [draft.files[0].id]: { objectNumber: `NGS-${nonce}`, objectConfirmed: true, year: 2026, panelId } }, export: { hideEmptyLoci: true } };
  const exported = await convert('export', options); assert.equal(exported.status, 200, await (exported.status !== 200 ? exported.text() : Promise.resolve('')));
  assert.equal(decodeURIComponent(exported.headers.get('Content-Disposition').split("filename*=UTF-8''")[1]), 'NGS-2026.xlsx');
  const normalized = Buffer.from(await exported.arrayBuffer());
  const exportedBook = XLSX.read(normalized, { type: 'buffer', cellStyles: true });
  assert.deepEqual(exportedBook.SheetNames, ['Импорт']);
  const exportedSheet = exportedBook.Sheets['Импорт'];
  const exportedHeaders = XLSX.utils.sheet_to_json(exportedSheet, { header: 1 })[0];
  assert(exportedSheet['!cols'][exportedHeaders.indexOf('DYS391')].hidden);
  assert(!exportedSheet['!cols'][exportedHeaders.indexOf('TH01')].hidden);
  const upload = async (endpoint, input = normalized) => {
    const body = new FormData(); body.append('file', new Blob([input]), 'ngs-normalized.xlsx'); body.append('taskId', taskId); body.append('uploadTarget', 'task'); body.append('panelId', panelId);
    const response = await fetch(`${base}/profiles${endpoint}`, { method: 'POST', headers, body });
    return { status: response.status, body: await response.json() };
  };
  const ready = await upload('/upload/preview'); assert.equal(ready.status, 200, JSON.stringify(ready.body));
  const imported = await upload('/upload'); assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.processing.created, 1, JSON.stringify(imported.body));
  const stored = (await query('SELECT * FROM dna_profiles WHERE task_id=$1', [taskId])).rows;
  assert.equal(stored.length, 1); assert.equal(stored[0].panel_id, panelId); assert.equal(stored[0].year, 2026);
  assert.equal(stored[0].internal_number, `NGS-${nonce}`);
  for (const locus of markers) assert.deepEqual(stored[0].str_data[locus], ['7.2', '13.2']);
  const notes = JSON.parse(stored[0].notes);
  assert.equal(notes.conversion, undefined);
  assert.equal(notes.ngs, undefined);

  const DNAProfile = require('../src/models/DNAProfile');
  const identity = { importFormat: 'genetic', internalNumber: `NGS-${nonce}`, year: 2026, departmentId: department, organizationId: organization };
  assert.equal((await DNAProfile.findBySampleName('NGS', userId, null, identity)).length, 1);
  assert.equal((await DNAProfile.findBySampleName('NGS', userId, stored[0].id, identity)).length, 0);
  assert.equal((await DNAProfile.findBySampleName('NGS', userId, null, { ...identity, year: 2025 })).length, 0);

  await t.test('Реальный ASTR+ → технические решения → XLSX → отдельная тестовая БД', { skip: !process.env.NGS_REAL_SAMPLE_PATH }, async () => {
    // Только проверка транспорта данных: эти решения не являются экспертной интерпретацией.
    const input = require('node:fs').readFileSync(process.env.NGS_REAL_SAMPLE_PATH);
    const response = await convert('preview', {}, headers, input);
    assert.equal(response.status, 200);
    const initial = await response.json();
    const ngs = initial.files[0].ngs;
    assert.equal(ngs.resultCount, 113); assert.equal(ngs.detailCount, 233);
    assert.equal(ngs.records.length, 112); assert.deepEqual(ngs.locusReport.unknown, []);
    assert.equal(initial.canImport, false);
    const settings = { files: { [initial.files[0].id]: { objectNumber: `NGS-real-test-${nonce}`, objectConfirmed: true, year: 2026, panelId } } };
    assert.equal((await convert('export', settings, headers, input)).status, 409);
    settings.cells = Object.fromEntries(ngs.records.map(record => [record.cell.id, {
      action: 'keep',
      reason: 'Технический тест сохранения данных; не экспертное заключение',
      timestamp: '2026-10-13T08:00:00.000Z'
    }]));
    const selected = await convert('preview', settings, headers, input);
    const ready = await selected.json();
    assert.equal(ready.canUpload, true, JSON.stringify(ready.issues.filter(issue => issue.hard)));
    const exportResponse = await convert('export', settings, headers, input);
    assert.equal(exportResponse.status, 200);
    const output = Buffer.from(await exportResponse.arrayBuffer());
    const outputRow = XLSX.utils.sheet_to_json(XLSX.read(output, { type: 'buffer' }).Sheets['Импорт'])[0];
    for (const record of ngs.records) {
      const alleles = ready.profiles[0].strData[record.locus];
      assert.equal(outputRow[record.locus] || '', alleles.join(','));
      if (/^\d+(?:\.\d+)?$/.test(record.rawGenotype)) {
        assert.equal(outputRow[record.locus], record.rawGenotype);
      }
    }
    assert.equal((await upload('/upload/preview', output)).status, 200);
    const uploaded = await upload('/upload', output);
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.processing.created, 1);
    const saved = (await query('SELECT * FROM dna_profiles WHERE task_id=$1 AND internal_number=$2', [taskId, `NGS-real-test-${nonce}`])).rows[0];
    assert.equal(saved.panel_id, panelId); assert.equal(saved.year, 2026);
    const metadata = JSON.parse(saved.notes);
    assert.equal(metadata.conversion, undefined);
    for (const record of ngs.records) {
      const alleles = ready.profiles[0].strData[record.locus];
      const type = detector.detectLocusType(record.locus);
      // Штатный импорт трактует одиночный числовой диплоидный STR как гомозиготу.
      const singleDiploid = alleles.length === 1 && /^\d+(?:\.\d+)?$/.test(alleles[0])
        && !['Y_CHROMOSOME', 'Y_INDEL', 'AMELOGENIN'].includes(type) && record.locus !== 'Yindel';
      assert.deepEqual(saved.str_data[record.locus] || [], singleDiploid ? [alleles[0], alleles[0]] : alleles);
    }
    assert.deepEqual(saved.str_data.D19S433 || [], []);
    assert.equal(saved.str_data.D18S51.length, 5);
    assert.equal(metadata.ngs, undefined);
  });
});
