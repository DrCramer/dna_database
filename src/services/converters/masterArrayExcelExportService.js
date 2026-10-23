const { createHash } = require('node:crypto');
const { pool } = require('../../config/database');
const AccessPolicyService = require('../security/AccessPolicyService');
const { LociTypeDetector, ALL_LOCI } = require('../../utils/lociTypeDetector');
const { resolveProfileImportFormat, normalizeObjectName, geneticProfileKey } = require('../../utils/profileImportFormat');
const { orderNormalizedLoci } = require('../../utils/normalizedExcelLayout');
const { createImportWorkbook, MASTER_EXPORT_FORMAT } = require('../../utils/importWorkbook');
const { ExcelService } = require('./excelService');
const { exportAlleles } = require('../../utils/exportAlleles');

const MAX_ROWS = 50000, MAX_CELLS = 2000000, MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const detector = new LociTypeDetector();
const excel = new ExcelService();
class MasterExportError extends Error {
  constructor(message, status = 400, code = 'MASTER_EXPORT_INVALID') { super(message); this.status = status; this.code = code; }
}
function requireExportAdmin(user) {
  if (!AccessPolicyService.matchesRoles(user, ['admin', 'system_administrator'])) throw new MasterExportError('Экспорт мастер-массива доступен только администраторам.', 403);
}

function decodeMasterRow(row, key) {
  const value = { ...row };
  for (const field of ['str_data', 'sample_name', 'metadata']) {
    if (!row[`${field}_encrypted`]) continue;
    const { decryptBytes } = require('../security/cryptoPrimitives');
    const item = JSON.parse(row[`${field}_encrypted`]);
    const plaintext = decryptBytes({ algorithm: item.algorithm, iv: Buffer.from(item.iv, 'base64'), data: Buffer.from(item.data, 'base64'),
      authTag: item.authTag ? Buffer.from(item.authTag, 'base64') : undefined }, key || require('../../config/security').securityConfig.encryptionKey).toString('utf8');
    value[field] = field === 'sample_name' ? plaintext : JSON.parse(plaintext);
  }
  return value;
}

function prepareMasterExport(rows, importFormat, options = {}) {
  const entries = rows.map(raw => {
    const problems = [];
    const add = (code, message) => problems.push({ code, message });
    let row;
    try { row = decodeMasterRow(raw); } catch { row = raw; add('ENCRYPTED_DATA', 'Не удалось прочитать зашифрованные поля.'); }
    const objectNumber = typeof row.internal_number === 'string' ? row.internal_number : '';
    if (!objectNumber || objectNumber !== normalizeObjectName(objectNumber) || objectNumber.length > 100 || /[\u0000-\u001f\u007f]/.test(objectNumber)) add('OBJECT', 'Не заполнен или некорректен полный номер объекта.');
    if (!Number.isInteger(row.year) || row.year < 1900 || row.year > 2100) add('YEAR', 'Необходим год от 1900 до 2100; отсутствующий год не подставляется.');
    const profile = { objectNumber, year: row.year, strData: {}, emergency: { assignedNumber: row.sample_name, shippingNumber: row.import_number } };
    if (importFormat === 'emergency') {
      for (const [field, label, max] of [['sample_name', 'присвоенный номер в/ч', 255], ['internal_number', 'Sample Name', 100], ['import_number', 'привоз', 100]]) {
        const value = row[field];
        if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) add('EMERGENCY_METADATA', `Не заполнено или некорректно поле «${label}».`);
        else if (field !== 'import_number' && value.toUpperCase().replace(excel.latinConverter.latinRegex, character => excel.latinConverter.replacementMap[character]) !== value) add('EMERGENCY_NORMALIZATION', `Штатный импорт изменит поле «${label}»; требуется проверка.`);
      }
      if (Number.isNaN(Number(row.import_number))) add('SHIPPING_NUMBER', 'Поле «Привоз» не проходит числовую проверку штатной загрузки.');
      if (/^GEN_/.test(row.sample_name || '')) add('GENERATED_ASSIGNED_NUMBER', 'Присвоенный номер был сгенерирован импортом; требуется подтверждение исходных сведений вне экспорта.');
    }
    let data = row.str_data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch { data = null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) add('STR_DATA', 'Генотип не является корректным объектом локусов.');
    else for (const [name, value] of Object.entries(data)) {
      const locus = detector.getCanonicalLocusName(name);
      if (!locus) { add('UNKNOWN_LOCUS', `Неизвестный локус: ${String(name).slice(0, 80)}.`); continue; }
      if (Object.hasOwn(profile.strData, locus)) { add('LOCUS_ALIAS_CONFLICT', `Несколько исходных столбцов соответствуют локусу ${locus}.`); continue; }
      const alleles = value == null || value === '' ? [] : Array.isArray(value) ? value : typeof value === 'string' || typeof value === 'number' ? String(value).split(',') : null;
      if (!alleles || alleles.length > 100 || alleles.some(a => !['number', 'string'].includes(typeof a) || !String(a) || String(a).length > 500)) { add('ALLELES', `Некорректная структура аллелей ${locus}.`); continue; }
      const tokens = alleles.map(String);
      try {
        const exported = exportAlleles(tokens, locus);
        const parsed = excel.parseAlleleValue(exported.join(','), locus, detector.detectLocusType(locus), 0, 'master-export.xlsx', { genetic: importFormat === 'genetic', preserveAlleleCount: true });
        if (JSON.stringify(parsed) !== JSON.stringify(exported)) add('ALLELE_ROUND_TRIP', `Штатный импорт изменит аллели ${locus}; требуется проверка.`);
      } catch { add('ALLELE_VALIDATION', `Аллели ${locus} не проходят штатную проверку импорта.`); }
      profile.strData[locus] = tokens;
    }
    if (!Object.values(profile.strData).some(values => values.length)) add('EMPTY_PROFILE', 'В профиле нет генетических данных.');
    let metadata = row.metadata || {};
    try { if (typeof metadata === 'string') metadata = JSON.parse(metadata); } catch { metadata = {}; }
    return { id: row.id, profile, problems, panelOrder: Array.isArray(metadata?.panelLociOrder) ? metadata.panelLociOrder : [] };
  });
  const identities = new Map();
  for (const entry of entries) {
    const key = importFormat === 'genetic' ? geneticProfileKey(entry.profile.year, entry.profile.objectNumber) : `${entry.profile.year}:${entry.profile.objectNumber}`;
    if (!identities.has(key)) identities.set(key, []);
    identities.get(key).push(entry);
  }
  for (const group of identities.values()) if (group.length > 1) group.forEach(entry => entry.problems.push({ code: 'DUPLICATE_OBJECT_YEAR', message: 'Повтор полного номера и года у нескольких активных записей. Ни одна из конфликтующих записей не выбирается автоматически.' }));
  const candidates = entries.filter(entry => !entry.problems.length);
  const actual = new Set(candidates.flatMap(entry => Object.keys(entry.profile.strData)));
  const ordered = new Set();
  candidates.forEach(entry => entry.panelOrder.forEach(name => { const locus = detector.getCanonicalLocusName(name); if (actual.has(locus)) ordered.add(locus); }));
  ALL_LOCI.forEach(locus => { if (options.includeCatalogLoci || actual.has(locus)) ordered.add(locus); });
  actual.forEach(locus => ordered.add(locus));
  const loci = orderNormalizedLoci([...ordered]);
  if (loci.length < 3) candidates.forEach(entry => entry.problems.push({ code: 'LOCUS_COLUMNS', message: 'Для штатного импорта нужны минимум 3 колонки локусов. Можно включить общий каталог.' }));
  const valid = entries.filter(entry => !entry.problems.length);
  const reasons = entries.filter(entry => entry.problems.length).map(entry => ({ id: entry.id, objectNumber: entry.profile.objectNumber, year: entry.profile.year, problems: entry.problems }));
  const exportRows = options.exportValidOnly ? valid.length : rows.length;
  if (exportRows + 1 > 1048576 || (exportRows + 1) * (loci.length + (importFormat === 'emergency' ? 4 : 2)) > MAX_CELLS) throw new MasterExportError('Файл превышает допустимый размер XLSX. Уточните фильтры.', 413, 'EXPORT_TOO_LARGE');
  return {
    profiles: valid.map(entry => entry.profile), loci,
    summary: { totalMatched: rows.length, exportable: valid.length, needsReview: reasons.length, reasons, lociCount: loci.length, totalExportRows: exportRows,
      canExport: valid.length > 0 && (!reasons.length || options.exportValidOnly === true),
      examples: entries.slice(0, 10).map(entry => ({ id: entry.id, objectNumber: entry.profile.objectNumber, year: entry.profile.year, ready: !entry.problems.length })) }
  };
}

class MasterArrayExcelExportService {
  constructor(databasePool = pool) { this.pool = databasePool; }

  async departments(user) {
    requireExportAdmin(user);
    return (await user.getAccessibleDepartments()).filter(dept => user.role === 'system_administrator' || dept.organization_id === user.organization_id);
  }

  async list(user) {
    const departments = await this.departments(user);
    if (!departments.length) return [];
    const result = await this.pool.query(`SELECT ma.id, ma.name, d.id AS department_id, d.name AS department_name,
      o.id AS organization_id, o.name AS organization_name,
      (SELECT count(*)::int FROM master_array_profiles p WHERE p.master_array_id=ma.id AND p.is_active=true) AS active_profiles
      FROM master_arrays ma JOIN departments d ON d.id=ma.department_id JOIN organizations o ON o.id=d.organization_id
      WHERE ma.is_active=true AND d.is_active=true AND o.is_active=true AND d.id=ANY($1::uuid[])
        AND ($2::uuid IS NULL OR o.id=$2) ORDER BY o.name,d.name,ma.name,ma.id`,
    [departments.map(dept => dept.id), user.role === 'system_administrator' ? null : user.organization_id]);
    return result.rows.filter(row => resolveProfileImportFormat({ name: row.department_name })).map(row => ({ ...row, importFormat: resolveProfileImportFormat({ name: row.department_name }) }));
  }

  async inspect(user, masterArrayId, { filters = {}, options = {} } = {}, download = false) {
    const departments = await this.departments(user);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const arrayResult = await client.query(`SELECT ma.id,ma.name,ma.department_id,ma.is_active,
        d.name AS department_name,d.organization_id,d.is_active AS department_active,o.is_active AS organization_active
        FROM master_arrays ma JOIN departments d ON d.id=ma.department_id JOIN organizations o ON o.id=d.organization_id WHERE ma.id=$1`, [masterArrayId]);
      const array = arrayResult.rows[0];
      if (!array) throw new MasterExportError('Мастер-массив не найден.', 404);
      if (!departments.some(dept => dept.id === array.department_id && dept.organization_id === array.organization_id)) throw new MasterExportError('Мастер-массив недоступен.', 403);
      if (!array.is_active || !array.department_active || !array.organization_active) throw new MasterExportError('Мастер-массив, отделение или организация неактивны.', 409);
      const importFormat = resolveProfileImportFormat({ name: array.department_name });
      if (!importFormat) throw new MasterExportError('Для этого отделения нет импорт-совместимого формата.', 400);
      const params = [array.id, array.department_id, array.organization_id];
      let where = 'p.master_array_id=$1 AND ma.department_id=$2 AND d.organization_id=$3 AND p.is_active=true AND ma.is_active=true AND d.is_active=true AND o.is_active=true';
      for (const [field, operator] of [['yearFrom', '>='], ['yearTo', '<=']]) if (filters[field] != null) { params.push(filters[field]); where += ` AND p.year${operator}$${params.length}`; }
      if (filters.objectQuery) {
        params.push(`%${filters.objectQuery.replace(/[\\%_]/g, '\\$&')}%`);
        where += ` AND (p.internal_number ILIKE $${params.length} ESCAPE '\\' OR p.sample_name ILIKE $${params.length} ESCAPE '\\')`;
      }
      const joins = 'FROM master_array_profiles p JOIN master_arrays ma ON ma.id=p.master_array_id JOIN departments d ON d.id=ma.department_id JOIN organizations o ON o.id=d.organization_id';
      const count = (await client.query(`SELECT count(*)::int AS total, COALESCE(sum(pg_column_size(p)),0)::bigint AS bytes ${joins} WHERE ${where}`, params)).rows[0];
      if (count.total > MAX_ROWS || Number(count.bytes) > MAX_SOURCE_BYTES) throw new MasterExportError('Выборка слишком велика для одного XLSX (до 50 000 строк и 50 МиБ исходных данных). Уточните фильтры.', 413, 'EXPORT_TOO_LARGE');
      const rows = [];
      let cursor = null;
      while (true) {
        const pageParams = [...params, cursor];
        const result = await client.query(`SELECT p.* ${joins} WHERE ${where} AND ($${pageParams.length}::uuid IS NULL OR p.id>$${pageParams.length}::uuid) ORDER BY p.id LIMIT 500`, pageParams);
        rows.push(...result.rows);
        if (result.rows.length < 500) break;
        cursor = result.rows.at(-1).id;
      }
      const result = prepareMasterExport(rows, importFormat, options);
      const hash = createHash('sha256').update(JSON.stringify({ masterArrayId, filters, hideEmptyLoci: options.hideEmptyLoci, includeCatalogLoci: options.includeCatalogLoci }));
      rows.forEach(row => hash.update(JSON.stringify(row)));
      const fingerprint = hash.digest('hex');
      const preview = { ...result.summary, fingerprint, importFormat, masterArray: { id: array.id, name: array.name, departmentName: array.department_name,
        departmentId: array.department_id, organizationId: array.organization_id } };
      if (download) {
        if (options.previewFingerprint && options.previewFingerprint !== fingerprint) throw new MasterExportError('Данные или настройки изменились после предпросмотра. Выполните проверку заново.', 409, 'PREVIEW_CHANGED');
        if (!result.summary.canExport) throw new MasterExportError(rows.length ? 'Есть непригодные записи. Проверьте отчёт или явно выберите выгрузку только пригодных.' : 'По выбранным фильтрам нет активных профилей.', 409, 'PREFLIGHT_FAILED');
        if (options.exportValidOnly && (!options.confirmValidOnly || !options.previewFingerprint)) throw new MasterExportError('Подтвердите исключение проблемных записей после предпросмотра.', 409);
      }
      await client.query('COMMIT');
      if (!download) return preview;
      const buffer = createImportWorkbook({ profiles: result.profiles, loci: result.loci, importFormat, sourceFormat: MASTER_EXPORT_FORMAT, hideEmptyLoci: options.hideEmptyLoci });
      if (buffer.length > 10 * 1024 * 1024) throw new MasterExportError('Размер файла превышает лимит штатного импорта 10 МиБ. Уточните фильтры.', 413, 'EXPORT_TOO_LARGE');
      const name = array.department_name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 90);
      return { preview, buffer, filename: `Мастер-массив_${name}_${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}${options.exportValidOnly ? '_только-пригодные' : ''}.xlsx` };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
}

module.exports = { MasterArrayExcelExportService, MasterExportError, prepareMasterExport, requireExportAdmin, decodeMasterRow };
