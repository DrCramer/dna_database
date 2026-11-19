#!/usr/bin/env node
'use strict';
// Автономный файл: копируется в старый main, не импортирует новые src-модули.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const ASSIGNED_HEADER = 'Ростовский номер';
const HEADERS = ['Объект', 'Год', 'Тип экспертизы', 'ФИО', 'Комментарий', '№ рег.',
  'Старое отделение', 'Источник записи', 'Исходный ID', 'Прежнее имя образца',
  'Старое значение привоза/служебной колонки', 'Исходный номер из файла',
  'Происхождение JSON', 'Генотип JSON', ASSIGNED_HEADER];
const MAX_BYTES = 8 * 1024 * 1024;
const SOURCE_ARCHIVE = 'source-records.jsonl';
const fail = message => Object.assign(new Error(message), { exportSafe: true });
const stableJSON = value => Array.isArray(value) ? '[' + value.map(stableJSON).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}' : JSON.stringify(value);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(args) {
  const options = { partSize: 1000 };
  const names = { '--task': 'task', '--user': 'username', '--out': 'out', '--type': 'type', '--part-size': 'partSize' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (seen.has(arg)) throw fail('Повтор аргумента: ' + arg);
    seen.add(arg);
    if (arg === '--active-only') { options.activeOnly = true; continue; }
    if (!names[arg] || !args[i + 1] || args[i + 1].startsWith('--')) throw fail('Неизвестный аргумент или отсутствует значение: ' + arg);
    options[names[arg]] = args[++i];
  }
  if (!options.task?.trim() || !options.username?.trim() || !options.out) throw fail('Обязательны --task, --user и --out. См. --help.');
  options.partSize = Number(options.partSize);
  if (!Number.isInteger(options.partSize) || options.partSize < 1 || options.partSize > 1000) throw fail('--part-size: целое число от 1 до 1000.');
  if (options.type && !['chs', 'ug', 'gr'].includes(options.type)) throw fail('--type: chs, ug или gr. Тип не угадывается по отделению.');
  return options;
}

function readKey(env = process.env) {
  const filename = path.resolve(env.ENCRYPTION_KEY_PATH || 'config/encryption.key');
  if (fs.existsSync(filename)) {
    const key = fs.readFileSync(filename);
    if (key.length !== 32) throw fail('Существующий ключ шифрования должен содержать ровно 32 байта.');
    return key;
  }
  if (/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY || '')) return Buffer.from(env.ENCRYPTION_KEY, 'hex');
  throw fail('Не найден существующий ключ шифрования. Новый ключ не создавался.');
}

function decryptRecord(record, getKey) {
  const result = { ...record };
  for (const field of ['str_data', 'sample_name', 'notes']) {
    const encrypted = record[field + '_encrypted'];
    if (!encrypted) continue;
    try {
      let algorithm, iv, data, authTag;
      if (typeof encrypted === 'string' && /^[a-f0-9]{32}:[a-f0-9]+$/i.test(encrypted)) {
        algorithm = 'aes-256-cbc';
        const parts = encrypted.split(':');
        iv = Buffer.from(parts[0], 'hex'); data = Buffer.from(parts[1], 'hex');
      } else {
        const pack = typeof encrypted === 'string' ? JSON.parse(encrypted) : encrypted;
        algorithm = pack.algorithm;
        iv = Buffer.from(pack.iv, 'base64'); data = Buffer.from(pack.data, 'base64');
        authTag = pack.authTag ? Buffer.from(pack.authTag, 'base64') : null;
      }
      if (!['aes-256-cbc', 'aes-256-gcm'].includes(algorithm)) throw Error();
      const decipher = crypto.createDecipheriv(algorithm, getKey(), iv);
      if (algorithm === 'aes-256-gcm') {
        if (!authTag) throw Error();
        decipher.setAuthTag(authTag);
      }
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      result[field] = field === 'str_data' ? JSON.parse(plain) : plain;
    } catch { throw fail('Не удалось расшифровать профиль ' + record.id + ', поле ' + field + '. Выгрузка остановлена; открытое резервное поле не использовалось.'); }
  }
  for (const key of Object.keys(result)) if (key.endsWith('_encrypted')) delete result[key];
  return result;
}

function toV2(record, context, options = {}) {
  let data = record.str_data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { throw fail('Повреждён JSON генотипа профиля ' + record.id); } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('Нет корректного генотипа у профиля ' + record.id);
  const strData = {};
  for (const [locus, value] of Object.entries(data)) {
    let alleles;
    if (Array.isArray(value)) alleles = value;
    else if (value && typeof value === 'object') {
      if (!Object.hasOwn(value, 'allele1') || Object.keys(value).some(key => !['allele1', 'allele2'].includes(key))) throw fail('Неизвестная структура локуса в профиле ' + record.id);
      alleles = [value.allele1, value.allele2].filter(v => v != null && v !== '');
    } else if (value == null || value === '') alleles = [];
    else if (typeof value === 'string' || typeof value === 'number') alleles = String(value).split(',');
    else throw fail('Неизвестная структура локуса в профиле ' + record.id);
    if (alleles.length > 100 || alleles.some(a => !['string', 'number'].includes(typeof a) || String(a) === '' || String(a).length > 500)) throw fail('Некорректные аллели у профиля ' + record.id + '; данные не усекались.');
    // Не меняем регистр, *, **, ?, F, микроварианты, смеси, одиночные и повторы.
    Object.defineProperty(strData, locus, { value: alleles.map(String), enumerable: true, configurable: true });
  }
  const type = record.expertise_type || (record.import_format === 'emergency' ? 'chs' : options.type || '');
  if (options.type && record.expertise_type && options.type !== record.expertise_type || options.type && record.import_format === 'emergency' && options.type !== 'chs') throw fail('--type противоречит сохранённому типу профиля ' + record.id);
  const assignedNumber = record.import_format === 'emergency' ? String(record.sample_name ?? '').trim() : '';
  const provenance = { table: 'dna_profiles', id: record.id, departmentId: record.department_id,
    departmentName: context.departmentName, sampleName: record.sample_name ?? '', importNumber: record.import_number ?? '',
    sourceObjectNumber: record.internal_number ?? '', assignedNumber, legacy: record,
    task: context.task, owner: { id: context.user.id, username: context.user.username } };
  let provenanceJSON = stableJSON(provenance);
  let archivedProvenance = false;
  if (provenanceJSON.length > 32767 && options.archiveRecord) {
    // Полная исходная запись уже сохранена в закрытый JSONL с контрольной суммой.
    // В XLSX оставляем происхождение и поля, нужные действующему импорту.
    const legacy = {};
    for (const key of ['id', 'user_id', 'task_id', 'department_id', 'organization_id', 'import_format',
      'profile_type', 'is_active', 'panel_id', 'upload_date', 'year']) if (Object.hasOwn(record, key)) legacy[key] = record[key];
    provenanceJSON = stableJSON({ ...provenance, legacy, sourceArchive: options.archiveRecord });
    archivedProvenance = true;
  }
  return { id: record.id, strData, type, year: record.year, assignedNumber, archivedProvenance,
    cells: [record.internal_number ?? '', record.year ?? '', type, '', record.comment ?? record.expert_comment ?? '', '',
      context.departmentName, 'dna_profiles', record.id, record.sample_name ?? '', record.import_number ?? '',
      record.internal_number ?? '', provenanceJSON, stableJSON(strData), assignedNumber] };
}

function workbook(rows, XLSX) {
  const loci = [...new Set(rows.flatMap(row => Object.keys(row.strData)))];
  // Сохраняем названия локусов; известные половые маркеры помещаем в конец.
  const sex = locus => /^(?:AMEL(?:OGENIN)?|SRY|Yindel|D[XY]S\d+|rs\d+)$/i.test(locus);
  loci.sort((a, b) => Number(sex(a)) - Number(sex(b)) || a.localeCompare(b, 'en', { numeric: true }));
  if (HEADERS.length + loci.length > 16384 || loci.some(l => HEADERS.some(h => h.toLowerCase() === l.toLowerCase()))) throw fail('Слишком много локусов или конфликт заголовков.');
  if ((rows.length + 1) * (HEADERS.length + loci.length) > 2000000) throw fail('Часть превышает лимит импорта 2 миллиона ячеек. Уменьшите --part-size.');
  const matrix = [HEADERS.concat(loci), ...rows.map(row => row.cells.concat(loci.map(l => (row.strData[l] || []).join(','))))]
    .map(row => row.map(value => String(value ?? '')));
  const sheet = XLSX.utils.aoa_to_sheet([]);
  matrix.forEach((row, r) => row.forEach((value, c) => {
    const text = String(value ?? '');
    if (text.length > 32767) throw fail(`Превышен лимит ячейки Excel: ${XLSX.utils.encode_cell({ r, c })}, колонка «${matrix[0][c]}», профиль ${r ? rows[r - 1].id : 'заголовок'}, ${text.length} символов при лимите 32767. Выгрузка остановлена без усечения; исходные данные не изменены.`);
    sheet[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: text, z: '@' };
  }));
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: matrix.length - 1, c: matrix[0].length - 1 } });
  sheet['!cols'] = matrix[0].map(() => ({ wch: 18 }));
  const book = XLSX.utils.book_new();
  book.Custprops = { DNAProfileSourceFormat: 'DNA_IMPORT_V2' };
  XLSX.utils.book_append_sheet(book, sheet, 'Импорт');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
  // Читаем свою выгрузку обратно ДО сохранения: каждую строку и все аллели.
  const check = XLSX.read(buffer, { type: 'buffer', cellText: false });
  const actual = XLSX.utils.sheet_to_json(check.Sheets['Импорт'], { header: 1, defval: '', raw: true });
  if (check.Custprops?.DNAProfileSourceFormat !== 'DNA_IMPORT_V2' || stableJSON(actual) !== stableJSON(matrix)) throw fail('Контроль обратного чтения XLSX не пройден.');
  return buffer;
}

async function selectTask(client, options) {
  const users = (await client.query('SELECT id, username, organization_id FROM users WHERE username=$1', [options.username])).rows;
  if (users.length !== 1 || !users[0].organization_id) throw fail('Не найден единственный пользователь с указанным точным логином и организацией.');
  const user = users[0];
  const tasks = (await client.query(`SELECT t.id,t.title,t.department_id,t.status,t.is_active,t.assigned_to_user,t.assigned_to_group,
      t.internal_number_start,t.internal_number_end,d.name AS department_name
    FROM tasks t JOIN departments d ON d.id=t.department_id
    WHERE d.organization_id=$1 AND (t.id::text=$2 OR t.title=$2 OR t.internal_number_start=$2)
      AND (t.assigned_to_user=$3 OR EXISTS (SELECT 1 FROM dna_profiles p WHERE p.task_id=t.id AND p.user_id=$3)
        OR EXISTS (SELECT 1 FROM expert_group_members m WHERE m.group_id=t.assigned_to_group AND m.user_id=$3))
    ORDER BY t.id LIMIT 21`, [user.organization_id, options.task, user.id])).rows;
  if (!tasks.length) throw fail('Задача сотрудника не найдена. Нужны точное название, начальный номер либо UUID, а не часть номера объекта.');
  if (tasks.length !== 1) throw fail('Найдено несколько задач. Повторите --task с UUID: ' + tasks.map(t => t.id).join(', '));
  const task = { ...tasks[0] };
  const departmentName = task.department_name; delete task.department_name;
  return { user, task, departmentName };
}

async function exportTask(client, options, dependencies = {}) {
  const XLSX = dependencies.XLSX || projectRequire('xlsx');
  const out = path.resolve(options.out);
  let created = false, transaction = false;
  let archiveFD;
  let key;
  const getKey = () => (key ||= (dependencies.getKey || readKey)());
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    const context = await selectTask(client, options);
    const filters = `p.task_id=$1 AND p.user_id=$2${options.activeOnly ? ' AND p.is_active=true' : ''}`;
    const params = [context.task.id, context.user.id];
    const counts = (await client.query(`SELECT count(*)::int total,
      count(*) FILTER (WHERE p.is_active=false)::int inactive,
      count(*) FILTER (WHERE p.organization_id IS DISTINCT FROM $3 OR p.department_id IS DISTINCT FROM $4)::int wrong_scope
      FROM dna_profiles p WHERE ${filters}`, [...params, context.user.organization_id, context.task.department_id])).rows[0];
    if (counts.wrong_scope) throw fail('У профилей задачи обнаружено несоответствие организации/отделения. Нужна проверка; записи не пропускались.');
    if (!counts.total) throw fail('У этого сотрудника нет профилей, привязанных к выбранной задаче. Профили без задачи автоматически не подбираются.');
    const other = (await client.query('SELECT count(*)::int count FROM dna_profiles WHERE task_id=$1 AND user_id IS DISTINCT FROM $2', params)).rows[0].count;
    const unbound = (await client.query('SELECT count(*)::int count FROM dna_profiles WHERE user_id=$1 AND task_id IS NULL', [context.user.id])).rows[0].count;
    fs.mkdirSync(out, { mode: 0o700 }); created = true;
    archiveFD = fs.openSync(path.join(out, SOURCE_ARCHIVE), 'wx', 0o600);
    const archiveHash = crypto.createHash('sha256');
    let archiveBytes = 0;
    const manifest = { format: 'DNA_IMPORT_V2', scriptVersion: 2, exportedAt: new Date().toISOString(),
      task: context.task, owner: context.user, profiles: counts.total, inactiveIncluded: counts.inactive,
      activeOnly: Boolean(options.activeOnly), otherOwnersNotExported: other, unboundUserProfilesNotExported: unbound,
      missingYear: 0, missingType: 0, missingAssignedNumber: 0, emptyGenotypes: 0, archivedProvenance: 0,
      files: [], genotypeSHA256: '', limitations: ['Задача и результаты поиска не восстанавливаются из XLSX.',
        'Неактивные профили присутствуют в XLSX, если не задан --active-only; при импорте их нужно явно исключить или загрузить как рабочие.',
        'Отсутствующие тип/год нужно заполнить в черновике. Профили других пользователей и без task_id не включены.',
        'Полные исходные записи сохранены в source-records.jsonl; превышающие лимит Excel архивные метаданные доступны там, а не автоматически в новой БД. Сохраняйте весь комплект.'] };
    const allHash = crypto.createHash('sha256');
    let part = 0, exported = 0, last = null;
    function savePart(rows) {
      const bytes = workbook(rows, XLSX);
      if (bytes.length > MAX_BYTES) {
        if (rows.length === 1) throw fail('Одна запись превышает безопасный размер XLSX для импорта.');
        const mid = Math.floor(rows.length / 2); savePart(rows.slice(0, mid)); savePart(rows.slice(mid)); return;
      }
      const filename = `task-DNA_IMPORT_V2-${String(++part).padStart(4, '0')}.xlsx`;
      fs.writeFileSync(path.join(out, filename), bytes, { mode: 0o600, flag: 'wx' });
      manifest.files.push({ filename, rows: rows.length, bytes: bytes.length, sha256: digest(bytes) });
    }
    let pending = [];
    while (true) {
      const rows = (await client.query(`SELECT to_jsonb(p) record FROM dna_profiles p WHERE ${filters}
        AND ($3::uuid IS NULL OR p.id>$3::uuid) ORDER BY p.id LIMIT $4`, [...params, last, Math.min(options.partSize, 100)])).rows;
      if (!rows.length) break;
      const converted = rows.map(({ record }) => {
        const decoded = decryptRecord(record, getKey);
        const source = stableJSON({ table: 'dna_profiles', id: decoded.id, record: decoded });
        const line = source + '\n';
        fs.writeFileSync(archiveFD, line, 'utf8');
        archiveHash.update(line); archiveBytes += Buffer.byteLength(line);
        return toV2(decoded, context, { ...options, archiveRecord: {
          filename: SOURCE_ARCHIVE, profileId: decoded.id, recordSHA256: digest(source), format: 'dna-task-source-v1'
        } });
      });
      for (const row of converted) {
        allHash.update(stableJSON([row.id, row.strData]) + '\n');
        if (row.year == null) manifest.missingYear++;
        if (!row.type) manifest.missingType++;
        if (row.type === 'chs' && !row.assignedNumber) manifest.missingAssignedNumber++;
        if (!Object.values(row.strData).some(a => a.length)) manifest.emptyGenotypes++;
        if (row.archivedProvenance) manifest.archivedProvenance++;
      }
      pending.push(...converted);
      while (pending.length >= options.partSize) { savePart(pending.slice(0, options.partSize)); pending = pending.slice(options.partSize); }
      exported += rows.length; last = rows[rows.length - 1].record.id;
    }
    if (pending.length) savePart(pending);
    if (exported !== counts.total) throw fail('Количество выгруженных строк не совпало с контрольным.');
    fs.fsyncSync(archiveFD); fs.closeSync(archiveFD); archiveFD = undefined;
    manifest.sourceArchive = { filename: SOURCE_ARCHIVE, records: exported, bytes: archiveBytes, sha256: archiveHash.digest('hex') };
    manifest.genotypeSHA256 = allHash.digest('hex');
    await client.query('COMMIT'); transaction = false;
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return { out, manifest };
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    if (archiveFD !== undefined) fs.closeSync(archiveFD);
    if (created) fs.rmSync(out, { recursive: true, force: true });
    throw error;
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Из корня старого проекта (main), либо /app контейнера:\nnode /путь/export-task-v2.js --task 258 --user expert --out /путь/новая-папка\nОпции: --type ug|gr|chs, --active-only, --part-size 1..1000.\nТолько чтение БД; существующая папка результата не перезаписывается.');
    return;
  }
  projectRequire('dotenv').config();
  if (!process.env.DATABASE_URL) throw fail('Не задан DATABASE_URL. Запускайте из корня проекта с .env либо внутри web-контейнера.');
  const { Client } = projectRequire('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'dna-task-v2-readonly-export',
    connectionTimeoutMillis: 10000, options: '-c default_transaction_read_only=on' });
  try {
    await client.connect();
    const { out, manifest: m } = await exportTask(client, options);
    console.log(`Готово: ${out}\nПрофилей: ${m.profiles}; XLSX: ${m.files.length}; неактивных: ${m.inactiveIncluded}.\nБез года: ${m.missingYear}; без типа: ${m.missingType}; ЧС без присвоенного номера: ${m.missingAssignedNumber}.\nБольшие архивные метаданные вынесены из XLSX: ${m.archivedProvenance}. Полные записи: ${SOURCE_ARCHIVE}; сохраняйте весь комплект.\nНе включены: другие владельцы задачи — ${m.otherOwnersNotExported}; профили сотрудника без задачи — ${m.unboundUserProfilesNotExported}.\nКонтрольные суммы и ограничения: manifest.json. Исходная БД не изменялась.`);
  } finally { await client.end(); }
}

module.exports = { HEADERS, parseArgs, decryptRecord, toV2, workbook, selectTask, exportTask, main };
if (require.main === module) main().catch(error => {
  // pg/crypto ошибки могут содержать приватные значения; в stdout только безопасная диагностика.
  console.error(error.exportSafe ? error.message : `Выгрузка не завершена (${String(error.code || 'ERROR').replace(/[^A-Z0-9_]/gi, '').slice(0, 30)}). Проверьте соединение, ключ, права и свободное место. Частичный результат удалён.`);
  process.exitCode = 1;
});
