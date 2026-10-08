const { createHash } = require('node:crypto');
const { LociTypeDetector, LOCI_TYPES } = require('./lociTypeDetector');
const detector = new LociTypeDetector();
const types = ['KIT_LADDER', 'NIST_VARIANTS', 'Y_STR_REFERENCE', 'OBSERVED_REFERENCE'];
class ReferenceError extends Error {
  constructor(message, status = 400, code = 'INVALID_REFERENCE') { super(message); this.status = status; this.code = code; }
}
function text(value, name, limit, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length > limit || required && !value.trim()) throw new ReferenceError(`Некорректное поле «${name}».`);
  return value.trim() || null;
}
function parseCSV(input) {
  const rows = [], row = []; let value = '', quoted = false;
  for (let index = 0; index <= input.length; index++) {
    const ch = input[index];
    if (ch === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index++; }
      else if (!quoted && value) throw new ReferenceError('Некорректные кавычки CSV.');
      else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n' || ch === undefined)) {
      row.push(value.replace(/\r$/, '')); value = '';
      if (ch !== ',') { if (row.some(cell => cell.trim())) rows.push([...row]); row.length = 0; }
    } else if (ch !== undefined) value += ch;
  }
  if (quoted || !rows.length) throw new ReferenceError('Некорректный или пустой CSV.');
  const headers = rows.shift().map(value => value.replace(/^\uFEFF/, '').trim().toLowerCase());
  if (new Set(headers).size !== headers.length || !headers.includes('locus') || !headers.includes('allele')) throw new ReferenceError('CSV должен содержать неповторяющиеся колонки Locus и Allele.');
  if (rows.some(row => row.length !== headers.length)) throw new ReferenceError('Число колонок CSV отличается от заголовка.');
  return rows.map(row => Object.fromEntries(headers.map((key, index) => [key, row[index]])));
}
function validateReferenceImport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ReferenceError('Ожидается объект справочника.');
  if (Buffer.byteLength(JSON.stringify(data)) > 8 * 1024 * 1024) throw new ReferenceError('Справочник превышает 8 МиБ.');
  const set = {
    name: text(data.name, 'Название', 150, true), type: data.type,
    manufacturer: text(data.manufacturer, 'Производитель', 150), kitName: text(data.kitName || data.kit, 'Набор', 150, data.type === 'KIT_LADDER'),
    kitVersion: text(data.kitVersion, 'Версия набора', 150),
    sourceTitle: text(data.sourceTitle, 'Источник', 300, true), sourceUrl: text(data.sourceUrl, 'Ссылка', 2000, true),
    sourceVersion: text(data.sourceVersion, 'Версия источника', 150, true), sourceDate: text(data.sourceDate, 'Дата источника', 10),
    metadata: data.metadata || {}, previousSetId: data.previousSetId || null
  };
  if (!types.includes(set.type)) throw new ReferenceError('Неизвестный тип справочника.');
  let url; try { url = new URL(set.sourceUrl); } catch { throw new ReferenceError('Укажите полную ссылку на источник.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ReferenceError('Ссылка должна использовать HTTP/HTTPS без учётных данных.');
  if (set.sourceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(set.sourceDate) || Number.isNaN(Date.parse(set.sourceDate)) || new Date(set.sourceDate).toISOString().slice(0, 10) !== set.sourceDate)) throw new ReferenceError('Дата должна иметь формат ГГГГ-ММ-ДД.');
  if (!set.metadata || typeof set.metadata !== 'object' || Array.isArray(set.metadata) || JSON.stringify(set.metadata).length > 16000) throw new ReferenceError('Некорректные сведения об источнике.');
  if (data.confirmed !== true) throw new ReferenceError('Подтвердите сверку значений с указанным источником.');
  let values = data.values;
  if (data.format === 'csv') { if (typeof data.content !== 'string') throw new ReferenceError('CSV должен быть текстом.'); values = parseCSV(data.content); }
  else if (data.format === 'json') {
    if (typeof data.content !== 'string') throw new ReferenceError('JSON должен быть текстом.');
    let parsed; try { parsed = JSON.parse(data.content); } catch { throw new ReferenceError('Некорректный JSON.'); }
    if (!parsed || typeof parsed !== 'object') throw new ReferenceError('JSON должен содержать объект или массив записей.');
    values = Array.isArray(parsed) ? parsed : parsed.values;
    if (!values && parsed.loci) values = Object.entries(parsed.loci).flatMap(([locus, alleles]) => {
      if (!Array.isArray(alleles)) throw new ReferenceError('Для каждого локуса нужен явный массив аллелей.');
      return alleles.map(allele => ({ locus, allele }));
    });
    if (parsed.kit && parsed.kit !== set.kitName) throw new ReferenceError('Название набора JSON не совпадает с настройками.');
  } else if (!values && data.loci) values = Object.entries(data.loci).flatMap(([locus, alleles]) => {
    if (!Array.isArray(alleles)) throw new ReferenceError('Для каждого локуса нужен явный массив аллелей.');
    return alleles.map(allele => ({ locus, allele }));
  });
  if (!Array.isArray(values) || !values.length || values.length > 20000) throw new ReferenceError('Нужно от 1 до 20 000 явных записей аллелей.');
  const keys = new Set();
  set.values = values.map((row, index) => {
    if (!row || typeof row !== 'object') throw new ReferenceError(`Некорректная запись ${index + 1}.`);
    const locus = detector.getCanonicalLocusName(row.locus || row.locusName);
    if (!locus) throw new ReferenceError(`Неизвестный локус в записи ${index + 1}.`);
    const allele = text(row.allele, 'Аллель (строка)', 30, true);
    const type = detector.detectLocusType(locus);
    const valid = type === LOCI_TYPES.AMELOGENIN ? /^[XY]$/.test(allele) : type === LOCI_TYPES.SNP ? /^[ATCG]$/.test(allele) : /^\d+(?:\.\d+)?$/.test(allele);
    if (!valid) throw new ReferenceError(`Укажите одну точную аллель в записи ${index + 1}; диапазоны и специальные токены не принимаются.`);
    if (set.type === 'Y_STR_REFERENCE' && type !== LOCI_TYPES.Y_CHROMOSOME) throw new ReferenceError('Y-справочник может содержать только Y-хромосомные локусы.');
    const classification = row.classification || (set.type === 'KIT_LADDER' ? 'IN_LADDER' : set.type === 'OBSERVED_REFERENCE' ? 'OBSERVED' : 'KNOWN_VARIANT');
    if (!['IN_LADDER', 'KNOWN_VARIANT', 'OFF_LADDER', 'TRIALLELIC_VARIANT', 'OBSERVED'].includes(classification) || (set.type === 'KIT_LADDER') !== (classification === 'IN_LADDER')) throw new ReferenceError(`Классификация не соответствует типу справочника в записи ${index + 1}.`);
    for (const [field, expected] of [['kit', set.kitName], ['version', set.sourceVersion]]) if (row[field] && row[field] !== expected) throw new ReferenceError(`Поле ${field} CSV не совпадает с настройками источника.`);
    let sourceLabel = null;
    if (row.source) {
      if (/^https?:\/\//i.test(row.source.trim())) {
        if (row.source.trim() !== set.sourceUrl) throw new ReferenceError('Ссылка в колонке Source CSV не совпадает с настройками источника.');
      } else {
        sourceLabel = text(row.source, 'Происхождение записи', 300);
      }
    }
    const key = `${locus}:${allele}`;
    if (keys.has(key)) throw new ReferenceError(`Повторная запись ${key}.`);
    keys.add(key);
    const metadata = row.metadata || {};
    if (typeof metadata !== 'object' || Array.isArray(metadata) || JSON.stringify(metadata).length > 4000) throw new ReferenceError('Некорректные сведения о записи.');
    return { locus, allele, classification, metadata: sourceLabel ? { ...metadata, sourceLabel } : metadata };
  }).sort((a, b) => a.locus.localeCompare(b.locus) || a.allele.localeCompare(b.allele));
  set.metadata = { ...set.metadata, confirmed: true };
  set.contentHash = createHash('sha256').update(JSON.stringify(set)).digest('hex');
  return set;
}
module.exports = { validateReferenceImport, parseCSV, ReferenceError, REFERENCE_TYPES: types };
