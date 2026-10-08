const XLSX = require('xlsx');
const { LociTypeDetector } = require('./lociTypeDetector');
const { geneticObjectKey } = require('./profileImportFormat');
const detector = new LociTypeDetector();
const SHEET = '_DNA_META';
const FORMAT = 'dna-genetic-converter';

function metadataSheet(payload) {
  const json = JSON.stringify({ format: FORMAT, version: 1, ...payload });
  if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new Error('Журнал конвертации превышает 16 МиБ. Разделите загрузку на несколько частей.');
  const rows = [['format', FORMAT], ['format_version', 1]];
  for (let offset = 0; offset < json.length; offset += 30000) rows.push([`payload_${offset / 30000}`, json.slice(offset, offset + 30000)]);
  return XLSX.utils.aoa_to_sheet(rows);
}

// Метаданные не влияют на доступ, права или задачу. Состав локусов сверяется с данными.
function readConversionMetadata(workbook, profiles, columns) {
  if (!workbook.Sheets[SHEET]) return null;
  const sheet = workbook.Sheets[SHEET];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (range.e.r > 2000 || range.e.c > 2) throw new Error('Некорректный размер метаданных конвертации.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rows[0]?.[0] !== 'format' || rows[0]?.[1] !== FORMAT || rows[1]?.[1] !== 1) throw new Error('Неизвестный формат метаданных конвертации.');
  const parts = rows.slice(2);
  if (parts.some((row, index) => row[0] !== `payload_${index}` || typeof row[1] !== 'string')) throw new Error('Некорректная структура метаданных конвертации.');
  const json = parts.map(row => row[1]).join('');
  if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new Error('Слишком большой журнал конвертации.');
  const payload = JSON.parse(json);
  if (payload.format !== FORMAT || payload.version !== 1 || !Array.isArray(payload.profiles) || payload.profiles.length !== profiles.length) throw new Error('Метаданные не соответствуют импортируемым профилям.');
  const available = new Set(columns);
  const entries = new Map();
  for (const entry of payload.profiles) {
    if (typeof entry.objectNumber !== 'string' || !Array.isArray(entry.sourceLoci) || entry.sourceLoci.length < 3 || entry.sourceLoci.length > available.size) throw new Error('Некорректный состав локусов источника.');
    const loci = entry.sourceLoci.map(name => detector.getCanonicalLocusName(name));
    if (loci.some(name => !name || !available.has(name)) || new Set(loci).size !== loci.length) throw new Error('Неизвестные или повторяющиеся локусы в метаданных.');
    const key = geneticObjectKey(entry.objectNumber);
    if (entries.has(key)) throw new Error('Повторный объект в метаданных конвертации.');
    if (entry.detectedPanelId != null && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(entry.detectedPanelId)) throw new Error('Некорректная панель в метаданных конвертации.');
    if (!Array.isArray(entry.audit) || entry.audit.length > 20000 || !Array.isArray(entry.sources) || entry.sources.length > 20000) throw new Error('Некорректный журнал конвертации.');
    if (JSON.stringify(entry).length > 1024 * 1024) throw new Error('Журнал одного объекта слишком большой.');
    const statuses = new Set(['OK', 'AUTO_FIXED', 'WARNING', 'NEEDS_REVIEW', 'CONFLICT', 'ERROR']);
    for (const source of entry.sources) if (!source || typeof source.file !== 'string' || source.file.length > 255 || typeof source.sheet !== 'string' || source.sheet.length > 31 || !Number.isInteger(source.row) || source.row < 1 || source.row > 20000) throw new Error('Некорректный источник в журнале конвертации.');
    for (const audit of entry.audit) {
      if (!audit || !statuses.has(audit.status) || typeof audit.code !== 'string' || audit.code.length > 100 || typeof audit.reason !== 'string' || audit.reason.length > 4000 || (audit.locus && !detector.getCanonicalLocusName(audit.locus))) throw new Error('Некорректная запись журнала конвертации.');
      for (const field of ['rawValue', 'normalizedValue', 'objectNumber', 'sourceFile', 'sourceSheet']) if (audit[field] != null && (typeof audit[field] !== 'string' || audit[field].length > 32000)) throw new Error('Некорректное значение журнала конвертации.');
      if (audit.variants != null && (!Array.isArray(audit.variants) || audit.variants.length > 20000)) throw new Error('Некорректные варианты исследования.');
    }
    entries.set(key, { objectNumber: entry.objectNumber, detectedPanelId: entry.detectedPanelId || null, sourceLoci: loci, sources: entry.sources, audit: entry.audit });
  }
  for (const profile of profiles) {
    const entry = entries.get(geneticObjectKey(profile.internalNumber));
    if (!entry || Object.entries(profile.strData).some(([locus, alleles]) => alleles.length && !entry.sourceLoci.includes(locus))) throw new Error('Исследованные локусы не соответствуют данным объекта.');
  }
  return entries;
}

module.exports = { metadataSheet, readConversionMetadata, CONVERSION_META_SHEET: SHEET };
