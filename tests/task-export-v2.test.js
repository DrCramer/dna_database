const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes, randomUUID, createCipheriv, createHash } = require('node:crypto');
const XLSX = require('xlsx');
const { HEADERS, parseArgs, decryptRecord, toV2, workbook, exportTask } = require('../scripts/export-task-v2');
const { FIELDS } = require('../src/utils/objectImportV2');
const { parseFiles } = require('../src/services/workspace/importSourceService');

const context = { user: { id: randomUUID(), username: 'SYN-expert', organization_id: randomUUID() },
  task: { id: randomUUID(), title: '258', department_id: randomUUID(), status: 'in_progress' }, departmentName: 'SYN-отдел' };
const fixture = (extra = {}) => ({ id: randomUUID(), user_id: context.user.id, task_id: context.task.id,
  department_id: context.task.department_id, organization_id: context.user.organization_id,
  internal_number: '00258-01', year: 2026, import_format: 'genetic', sample_name: 'SYN исходный объект',
  import_number: '000258', expert_comment: 'SYN комментарий', notes: 'SYN исходное примечание', is_active: true,
  str_data: { TH01: ['9.3'], D21S11: ['30', '30'], D5S818: ['12', 'F'], D6S477: ['**'], TPOX: ['?'],
    DYS391: ['10', '10'], rs771783753: ['1'], SRY: ['SRY'], AMEL: ['X', 'Y'] }, ...extra });
function encrypt(value, key, algorithm) {
  const iv = randomBytes(algorithm.endsWith('gcm') ? 12 : 16), c = createCipheriv(algorithm, key, iv);
  return JSON.stringify({ algorithm, iv: iv.toString('base64'), data: Buffer.concat([c.update(value), c.final()]).toString('base64'),
    authTag: algorithm.endsWith('gcm') ? c.getAuthTag().toString('base64') : null });
}
const options = out => ({ task: '258', username: context.user.username, out, partSize: 2, type: 'ug' });
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-task-export-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('Автономный CLI: строгие аргументы; заголовки соответствуют актуальному V2', t => {
  assert.deepEqual(HEADERS, Object.values(FIELDS));
  assert.equal(parseArgs(['--task', '258', '--user', 'expert', '--out', '/tmp/new']).partSize, 1000);
  for (const args of [[], ['--task'], ['--task', '258', '--user', 'e', '--out', 'x', '--part-size', '1001'],
    ['--task', '258', '--user', 'e', '--out', 'x', '--type', 'staff'], ['--out', 'a', '--out', 'b']]) assert.throws(() => parseArgs(args));
  const filename = path.join(temp(t), 'standalone.js'); fs.copyFileSync(path.join(__dirname, '../scripts/export-task-v2.js'), filename);
  const child = spawnSync(process.execPath, [filename, '--help'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(child.status, 0); assert.match(child.stdout, /--task 258/);
});

test('CBC/GCM: зашифрованные поля главные; неправильный ключ не подменяет генотип открытым', () => {
  const key = randomBytes(32), p = fixture(), original = structuredClone(p);
  for (const algorithm of ['aes-256-cbc', 'aes-256-gcm']) {
    const record = { ...p, str_data: { TH01: ['999'] }, str_data_encrypted: encrypt(JSON.stringify(p.str_data), key, algorithm),
      sample_name: '[encrypted]', sample_name_encrypted: encrypt(p.sample_name, key, algorithm), notes_encrypted: encrypt(p.notes, key, algorithm) };
    const decoded = decryptRecord(record, () => key);
    assert.deepEqual(decoded.str_data, p.str_data); assert.equal(decoded.sample_name, p.sample_name); assert.equal(decoded.notes, p.notes);
    assert(!Object.keys(decoded).some(k => k.endsWith('_encrypted')));
    assert.throws(() => decryptRecord(record, () => randomBytes(32)), /Не удалось расшифровать/);
  }
  const iv = randomBytes(16), c = createCipheriv('aes-256-cbc', key, iv);
  const legacy = iv.toString('hex') + ':' + Buffer.concat([c.update(JSON.stringify(p.str_data)), c.final()]).toString('hex');
  assert.deepEqual(decryptRecord({ ...p, str_data_encrypted: legacy }, () => key).str_data, p.str_data);
  assert.deepEqual(p, original);
});

test('XLSX → реальный импорт: все специальные аллели, одиночные/повторы, ЧС, происхождение и строковые ячейки', () => {
  const p = fixture({ import_format: 'emergency', sample_name: '000057', expert_comment: '=SYN(1)', is_active: false });
  const bytes = workbook([toV2(p, context)], XLSX);
  const book = XLSX.read(bytes, { type: 'buffer' }); assert.deepEqual(book.SheetNames, ['Импорт']);
  const { rows } = parseFiles([{ originalname: 'SYN.xlsx', buffer: bytes }]);
  assert.equal(rows.length, 1); const r = rows[0];
  assert.deepEqual(r.strData, p.str_data); assert.deepEqual(r.sourceIssues, []);
  assert.equal(r.objectNumber, p.internal_number); assert.equal(r.year, 2026); assert.equal(r.expertiseType, 'chs');
  assert.equal(r.assignedNumber, '000057'); assert.equal(r.comment, '=SYN(1)');
  assert.equal(r.provenance.legacy.is_active, false); assert.equal(r.provenance.legacy.notes, p.notes);
  for (const [address, cell] of Object.entries(book.Sheets['Импорт'])) if (!address.startsWith('!')) { assert.equal(cell.t, 's'); assert(!cell.f); }
});

test('Потенциальная потеря данных: остановка вместо усечения; неизвестные год/тип не выдумываются', () => {
  const r = toV2(fixture({ year: null }), context); assert.equal(r.type, ''); assert.equal(r.year, null);
  assert.throws(() => toV2(fixture({ import_format: 'emergency' }), context, { type: 'ug' }), /противоречит/);
  for (const str_data of [null, 'bad-json', { TH01: [null] }, { TH01: { allele1: '7', extra: '8' } }]) assert.throws(() => toV2(fixture({ str_data }), context));
  assert.throws(() => workbook([toV2(fixture({ notes: 'x'.repeat(33000) }), context)], XLSX), /лимит ячейки/);
  const object = toV2(fixture({ str_data: { TH01: { allele1: '9.3', allele2: '9.3' }, TPOX: '8' } }), context);
  assert.deepEqual(object.strData, { TH01: ['9.3', '9.3'], TPOX: ['8'] });
});

function fakeClient(records, overrides = {}) {
  const queries = [];
  return { queries, async query(sql, values) {
    queries.push({ sql, values });
    if (sql.includes('FROM users WHERE')) return { rows: [context.user] };
    if (sql.includes('FROM tasks t JOIN')) return { rows: overrides.tasks || [{ ...context.task, department_name: context.departmentName }] };
    if (sql.includes('wrong_scope')) return { rows: [{ total: overrides.total ?? records.length, inactive: 0, wrong_scope: overrides.scope || 0 }] };
    if (sql.includes('count(*)::int count')) return { rows: [{ count: 3 }] };
    if (sql.includes('to_jsonb(p) record')) return { rows: records.filter(r => !values[2] || r.id > values[2]).slice(0, values[3]).map(record => ({ record })) };
    assert.match(sql, /^(?:BEGIN|SET LOCAL|COMMIT|ROLLBACK)/); return { rows: [] };
  } };
}

test('Полная read-only выборка task+owner: части, реестр/хеш, права файлов, сохранённые генотипы', async t => {
  const records = Array.from({ length: 5 }, () => fixture()).sort((a, b) => a.id.localeCompare(b.id)), db = fakeClient(records);
  const out = path.join(temp(t), 'export');
  const { manifest: m } = await exportTask(db, options(out));
  assert.equal(m.profiles, 5); assert.equal(m.files.length, 3); assert.equal(m.otherOwnersNotExported, 3);
  assert.equal(m.genotypeSHA256.length, 64); assert.equal(fs.statSync(out).mode & 0o777, 0o700);
  const actual = [];
  for (const part of m.files) {
    const filename = path.join(out, part.filename), buffer = fs.readFileSync(filename);
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.equal(createHash('sha256').update(buffer).digest('hex'), part.sha256);
    actual.push(...parseFiles([{ originalname: part.filename, buffer }]).rows);
  }
  assert.equal(actual.length, 5); assert(actual.every(r => r.expertiseType === 'ug'));
  assert.deepEqual(actual.map(r => r.strData), records.map(r => r.str_data));
  assert.match(db.queries[0].sql, /REPEATABLE READ READ ONLY/);
  assert(db.queries.filter(q => q.sql.includes('to_jsonb(p) record')).every(q => /p.task_id=\$1 AND p.user_id=\$2/.test(q.sql)));
  assert(!db.queries.some(q => /^(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(q.sql)));
  assert.equal(db.queries.at(-1).sql, 'COMMIT');
});

test('Большие примечания: полный архив JSONL, компактное происхождение V2 без усечения и без изменения генотипов', async t => {
  const p = fixture({ notes: 'СИНТЕТИЧЕСКОЕ ПРИМЕЧАНИЕ 🧬 '.repeat(5000), is_active: false });
  const original = structuredClone(p), out = path.join(temp(t), 'export');
  const { manifest: m } = await exportTask(fakeClient([p]), options(out));
  assert.equal(m.scriptVersion, 2); assert.equal(m.archivedProvenance, 1);
  const bytes = fs.readFileSync(path.join(out, m.sourceArchive.filename));
  assert.equal(m.sourceArchive.bytes, bytes.length);
  assert.equal(m.sourceArchive.sha256, createHash('sha256').update(bytes).digest('hex'));
  const line = bytes.toString('utf8').trimEnd(), source = JSON.parse(line);
  assert.deepEqual(source.record, original); assert.equal(source.record.notes, original.notes);
  assert.equal(fs.statSync(path.join(out, m.sourceArchive.filename)).mode & 0o777, 0o600);
  const [row] = parseFiles([{ originalname: 'SYN.xlsx', buffer: fs.readFileSync(path.join(out, m.files[0].filename)) }]).rows;
  assert.deepEqual(row.strData, original.str_data); assert.deepEqual(row.sourceIssues, []);
  assert.equal(row.provenance.legacy.is_active, false); assert.equal(row.provenance.legacy.import_format, 'genetic');
  assert.equal(row.provenance.sourceArchive.profileId, p.id);
  assert.equal(row.provenance.sourceArchive.recordSHA256, createHash('sha256').update(line).digest('hex'));
  assert.equal(row.provenance.sourceArchive.filename, m.sourceArchive.filename);
  assert.deepEqual(p, original);
});

test('Слишком длинное бизнес-поле: ошибка указывает колонку и UUID без вывода значений', async t => {
  const p = fixture({ expert_comment: 'SYN-PRIVATE'.repeat(4000) }), out = path.join(temp(t), 'export');
  await assert.rejects(exportTask(fakeClient([p]), options(out)), error => {
    assert.match(error.message, /колонка «Комментарий»/); assert(error.message.includes(p.id));
    assert(!error.message.includes('SYN-PRIVATE')); return true;
  });
  assert(!fs.existsSync(out));
});

test('Неоднозначность/чужая область/повреждение/расхождение счётчика: rollback, удаление частичного результата, существующие файлы целы', async t => {
  const base = temp(t), p = fixture();
  for (const overrides of [{ tasks: [context.task, context.task] }, { scope: 1 }, { total: 2 }]) {
    const out = path.join(base, randomUUID()), db = fakeClient([p], overrides);
    await assert.rejects(exportTask(db, options(out))); assert(!fs.existsSync(out)); assert.equal(db.queries.at(-1).sql, 'ROLLBACK');
  }
  const out = path.join(base, 'broken');
  await assert.rejects(exportTask(fakeClient([p, fixture({ str_data: null })]), { ...options(out), partSize: 1 })); assert(!fs.existsSync(out));
  fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'keep'), 'SYN');
  await assert.rejects(exportTask(fakeClient([p]), options(out))); assert.equal(fs.readFileSync(path.join(out, 'keep'), 'utf8'), 'SYN');
});

test('PostgreSQL на legacy-схеме: автономный CLI из /tmp, шифрование, несколько владельцев и реальные части V2', {
  skip: !process.env.TASK_EXPORT_TEST_DATABASE_URL
}, async t => {
  const url = process.env.TASK_EXPORT_TEST_DATABASE_URL;
  assert.match(new URL(url).pathname, /^\/dna_task_export_test_[a-z0-9_]+$/);
  const { Client } = require('pg'), db = new Client({ connectionString: url });
  await db.connect(); t.after(() => db.end());
  // Только отдельная БД с явно разрешённым именем; production не используется.
  await db.query(`CREATE TABLE organizations(id uuid PRIMARY KEY);
    CREATE TABLE departments(id uuid PRIMARY KEY,organization_id uuid,name text);
    CREATE TABLE users(id uuid PRIMARY KEY,username text,organization_id uuid);
    CREATE TABLE tasks(id uuid PRIMARY KEY,department_id uuid,title text,status text,is_active bool,assigned_to_user uuid,assigned_to_group uuid,internal_number_start text,internal_number_end text);
    CREATE TABLE expert_group_members(group_id uuid,user_id uuid);
    CREATE TABLE dna_profiles(id uuid PRIMARY KEY,user_id uuid,task_id uuid,organization_id uuid,department_id uuid,internal_number text,year int,import_format text,sample_name text,str_data jsonb,str_data_encrypted text,is_active bool,notes_encrypted text);`);
  const other = randomUUID(), key = randomBytes(32), base = temp(t), keyPath = path.join(base, 'key'); fs.writeFileSync(keyPath, key, { mode: 0o600 });
  await db.query('INSERT INTO organizations VALUES($1)', [context.user.organization_id]);
  await db.query('INSERT INTO departments VALUES($1,$2,$3)', [context.task.department_id, context.user.organization_id, context.departmentName]);
  await db.query('INSERT INTO users VALUES($1,$2,$3),($4,$5,$3)', [context.user.id, context.user.username, context.user.organization_id, other, 'SYN-other']);
  await db.query("INSERT INTO tasks VALUES($1,$2,'тестовая задача','in_progress',true,$3,null,'258',null)", [context.task.id, context.task.department_id, context.user.id]);
  const p = fixture();
  const largeNotes = 'СИНТЕТИЧЕСКИЕ ДАННЫЕ 🧬 '.repeat(3000);
  await db.query(`INSERT INTO dna_profiles SELECT gen_random_uuid(),$1,$2,$3,$4,'SYN-'||n,2026,'genetic','SYN',null,$5,(n>2),CASE WHEN n<=2 THEN $6 ELSE null END FROM generate_series(1,4371)n`,
    [context.user.id, context.task.id, context.user.organization_id, context.task.department_id, encrypt(JSON.stringify(p.str_data), key, 'aes-256-gcm'), encrypt(largeNotes, key, 'aes-256-cbc')]);
  await db.query("INSERT INTO dna_profiles VALUES($1,$2,$3,$4,$5,'SYN-other',2026,'genetic','SYN','{}',null,true,null)", [randomUUID(), other, context.task.id, context.user.organization_id, context.task.department_id]);
  const before = (await db.query('SELECT md5(string_agg(to_jsonb(p)::text,\'\' ORDER BY id)) hash FROM dna_profiles p')).rows[0].hash;
  const script = path.join(base, 'standalone.js'); fs.copyFileSync(path.join(__dirname, '../scripts/export-task-v2.js'), script);
  const out = path.join(base, 'result');
  const child = spawnSync(process.execPath, [script, '--task', 'тестовая задача', '--user', context.user.username, '--out', out, '--type', 'ug'],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, DATABASE_URL: url, ENCRYPTION_KEY_PATH: keyPath }, encoding: 'utf8', timeout: 60000 });
  assert.equal(child.status, 0, child.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json')));
  assert.equal(manifest.profiles, 4371); assert.equal(manifest.inactiveIncluded, 2); assert.equal(manifest.otherOwnersNotExported, 1); assert.equal(manifest.files.length, 5);
  assert.equal(manifest.archivedProvenance, 2);
  let actualCount = 0;
  for (const file of manifest.files) {
    const { rows } = parseFiles([{ originalname: file.filename, buffer: fs.readFileSync(path.join(out, file.filename)) }]);
    for (const row of rows) assert.deepEqual(row.strData, p.str_data);
    assert(rows.every(r => r.provenance.owner.id === context.user.id));
    actualCount += rows.length;
  }
  assert.equal(actualCount, 4371);
  const archive = fs.readFileSync(path.join(out, manifest.sourceArchive.filename));
  assert.equal(createHash('sha256').update(archive).digest('hex'), manifest.sourceArchive.sha256);
  const sources = archive.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  assert.equal(sources.length, 4371); assert.equal(sources.filter(s => s.record.notes === largeNotes).length, 2);
  assert.equal((await db.query('SELECT md5(string_agg(to_jsonb(p)::text,\'\' ORDER BY id)) hash FROM dna_profiles p')).rows[0].hash, before);
});
