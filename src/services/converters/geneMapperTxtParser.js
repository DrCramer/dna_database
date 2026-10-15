const { TextDecoder } = require('node:util');
const { LociTypeDetector } = require('../../utils/lociTypeDetector');
const { normalizeAlleleValue } = require('../../utils/alleleNormalizer');
const { isMissingAllele } = require('../../utils/alleleTokens');

const GENEMAPPER_FORMAT = 'GENEMAPPER_TXT';
const detector = new LociTypeDetector();
const headerName = value => String(value).trim().toLowerCase().replace(/\s+/g, ' ');
const required = ['sample name', 'sample type', 'marker', 'allele 1'];

function decodeText(buffer, encoding = 'auto') {
  if (!Buffer.isBuffer(buffer) || buffer.length > 10 * 1024 * 1024) throw new Error('TXT должен быть не больше 10 МиБ.');
  if (!['auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1251'].includes(encoding)) throw new Error('Неизвестная кодировка TXT.');
  let selected = encoding;
  if (selected === 'auto') selected = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le'
    : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : 'utf-8';
  let text;
  try { text = new TextDecoder(selected, { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw new Error('Некорректная кодировка TXT. Сохраните файл в UTF-8 или явно выберите исходную кодировку.'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(text)) throw new Error('TXT содержит повреждённые или недопустимые символы.');
  return { text, encoding: selected };
}

// TSV с экранированием кавычек. Не используем Excel для определения типов чисел.
function readTsv(text) {
  const rows = []; let row = [], value = '', quoted = false, closed = false, line = 1, rowLine = 1;
  const cell = () => { row.push(value); value = ''; closed = false; if (row.length > 512) throw new Error('В TXT более 512 колонок.'); };
  const finish = () => { cell(); if (row.some(item => item.trim())) rows.push({ values: row, line: rowLine }); row = []; if (rows.length > 50001) throw new Error('В TXT более 50 000 строк данных.'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else { value += char; if (char === '\n') line++; }
    } else if (char === '"' && !value && !closed) quoted = true;
    else if (char === '\t') cell();
    else if (char === '\r' || char === '\n') { if (char === '\r' && text[i + 1] === '\n') i++; finish(); line++; rowLine = line; }
    else { if (closed) throw new Error('Некорректные кавычки в TSV.'); value += char; }
    if (value.length > 10000 || line > 50002) throw new Error('Превышен лимит длины поля или числа строк TXT.');
  }
  if (quoted) throw new Error('Незакрытые кавычки в TSV.');
  if (row.length || value) finish();
  return rows;
}

function detectGeneMapperTxt(buffer, options = {}) {
  const decoded = decodeText(buffer, options.encoding);
  const rows = readTsv(decoded.text);
  const headers = (rows[0]?.values || []).map(headerName);
  if (!required.every(name => headers.filter(header => header === name).length === 1)
    || !['allele 2', 'status', 'panel'].some(name => headers.includes(name))) {
    throw new Error('Не удалось распознать структуру GeneMapper TXT.');
  }
  for (const name of [...required, 'panel', 'status', ...Array.from({ length: 5 }, (_, i) => `allele ${i + 1}`)]) {
    if (headers.filter(header => header === name).length > 1) throw new Error(`Повторяющаяся колонка GeneMapper: ${name}.`);
  }
  return { format: GENEMAPPER_FORMAT, confidence: 'HIGH', encoding: decoded.encoding, headers, rows };
}

function suggestGeneMapperYear(filename) {
  const match = String(filename).match(/(?:^|[^\d])(\d{2})[-_.](\d{2})[-_.](\d{4}|\d{2})(?=[^\d]|$)/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const day = Number(match[1]), month = Number(match[2]), date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2100 && date.getUTCDate() === day && date.getUTCMonth() === month - 1 ? year : null;
}

function classifySample(name, types) {
  const normalized = types.map(headerName);
  if (normalized.includes('allelic ladder')) return { category: 'ladder', included: false, reason: 'Аллельная лестница' };
  if (normalized.some(type => ['negative control', 'positive control'].includes(type))) return { category: 'control', included: false, reason: 'Контрольный образец' };
  if (/^(?:L[1-6]|ladder|NC|PC|PC_Rt)$/i.test(name)) return { category: 'service_name', included: false, reason: 'Служебное обозначение образца; классификацию можно подтвердить или исправить' };
  if (normalized.length !== 1 || normalized[0] !== 'sample') return { category: 'unknown_type', included: false, reason: 'Неизвестный или неоднозначный тип образца; требуется классификация' };
  return { category: 'sample', included: true, reason: '' };
}

function parseGeneMapperTxt(buffer, options = {}) {
  const detected = detectGeneMapperTxt(buffer, options);
  const { headers, rows } = detected;
  const get = (row, name) => String(row[headers.indexOf(name)] ?? '').trim();
  const samples = new Map(), markers = new Map(), issues = [];
  for (const { values, line } of rows.slice(1)) {
    if (values.length > headers.length && values.slice(headers.length).some(value => value.trim())) throw new Error(`Лишние значения за пределами шапки TXT в строке ${line}.`);
    const name = get(values, 'sample name'), marker = get(values, 'marker');
    if (!name || name.length > 100 || /[\r\n\t]/.test(name)) throw new Error(`Некорректный Sample Name в строке ${line}: нужен полный номер длиной до 100 символов.`);
    if (!marker || marker.length > 100) throw new Error(`Некорректный Marker в строке ${line}.`);
    const locus = detector.getCanonicalLocusName(marker);
    const markerKey = locus || marker.toLowerCase();
    if (!markers.has(markerKey)) markers.set(markerKey, { key: markerKey, header: locus || marker, locus });
    if (markers.size > 510) throw new Error('В TXT более 510 маркеров.');
    if (!samples.has(name)) samples.set(name, { sampleName: name, sampleTypes: new Set(), panelNames: new Set(), records: [], sourceLoci: new Set() });
    const sample = samples.get(name);
    const rawAlleles = Array.from({ length: 5 }, (_, index) => get(values, `allele ${index + 1}`)).filter(value => !isMissingAllele(value));
    const record = { sourceRow: line, originalLocus: marker, markerKey, locus, rawAlleles,
      originalAlleleFields: Array.from({ length: 5 }, (_, index) => values[headers.indexOf(`allele ${index + 1}`)] ?? ''), rawValue: rawAlleles.join(','),
      sampleType: get(values, 'sample type'), panelName: get(values, 'panel'), status: get(values, 'status'),
      metadata: Object.fromEntries(headers.map((header, i) => [header, values[i] || '']).filter(([header]) => header && !/^allele [1-5]$/.test(header))) };
    sample.records.push(record); sample.sampleTypes.add(record.sampleType); if (record.panelName) sample.panelNames.add(record.panelName);
    sample.sourceLoci.add(markerKey);
  }
  const result = [...samples.values()].map(sample => {
    const types = [...sample.sampleTypes], classification = classifySample(sample.sampleName, types);
    const populated = sample.records.filter(record => normalizeAlleleValue(record.rawValue, record.locus || record.originalLocus).alleles.length);
    const empty = !populated.length;
    return { ...sample, sampleTypes: types, panelNames: [...sample.panelNames], sourceLoci: [...sample.sourceLoci],
      classification, empty, included: classification.included && !empty,
      reason: empty && classification.included ? 'Образец без результатов генотипирования' : classification.reason };
  });
  return { sourceFormat: GENEMAPPER_FORMAT, sourceFilename: options.filename || '', encoding: detected.encoding,
    panelNames: [...new Set(result.flatMap(sample => sample.panelNames))], markers: [...markers.values()], samples: result,
    issues, rowCount: rows.length - 1, suggestedYear: suggestGeneMapperYear(options.filename), summary: { totalSamples: result.length,
      ordinarySamples: result.filter(sample => sample.classification.category === 'sample').length,
      ladders: result.filter(sample => sample.classification.category === 'ladder').length,
      controls: result.filter(sample => sample.classification.category === 'control').length,
      serviceNames: result.filter(sample => sample.classification.category === 'service_name').length,
      emptyProfiles: result.filter(sample => sample.empty && sample.classification.included).length } };
}

module.exports = { GENEMAPPER_FORMAT, decodeText, readTsv, detectGeneMapperTxt, parseGeneMapperTxt, suggestGeneMapperYear };
