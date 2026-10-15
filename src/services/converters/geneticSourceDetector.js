const XLSX = require('xlsx');
const { LociTypeDetector } = require("../../utils/lociTypeDetector");
const { normalizeObjectName } = require("../../utils/profileImportFormat");
const detector = new LociTypeDetector();
const { detectGeneMapperTxt, GENEMAPPER_FORMAT } = require('./geneMapperTxtParser');
const normalizeHeader = value => String(value ?? '').trim().toLocaleLowerCase('ru').replace(/[\s_]+/g, ' ');

function objectPriority(header) {
  const name = normalizeHeader(header);
  if (name.includes('объект')) return 5;
  if (name.includes('образца')) return 4;
  if (/^(?:n|№|номер) препарата$/.test(name)) return 3;
  if (name === 'sample' || name === 'sample name' || name === 'samplename') return 2;
  if (name === 'smpl') return 1;
  return 0;
}

function isServiceColumn(header) {
  const name = normalizeHeader(header);
  return /^(?:№\s*п\s*[/.]?\s*п|количество (?:локусов нпв|исследованных локусов)|smpl)$/.test(name);
}

function headerCandidates(rows) {
  return rows.slice(0, 30).map((row, index) => {
    const loci = [...new Set(row.map(value => detector.getCanonicalLocusName(value)).filter(Boolean))];
    return { row: index + 1, lociCount: loci.length, hasObject: row.some(value => objectPriority(value) > 0) };
  }).filter(row => row.lociCount >= 3).sort((a, b) => b.lociCount - a.lociCount || Number(b.hasObject) - Number(a.hasObject) || a.row - b.row);
}

function objectCandidates(headers, rows) {
  return headers.map((header, index) => ({ index, header: String(header ?? ''), priority: objectPriority(header),
    examples: rows.map(row => normalizeObjectName(row[index])).filter(Boolean).slice(0, 4) }))
    .filter(column => column.priority > 0).sort((a, b) => b.priority - a.priority || a.index - b.index);
}

function chooseObjectColumn(candidates, rows) {
  if (!candidates.length) return null;
  const first = candidates[0];
  // Одинаковые Sample/Smpl безопасно эквивалентны. Разные значения требуют решения.
  if (candidates.some(candidate => rows.some(row => normalizeObjectName(row[candidate.index]) !== normalizeObjectName(row[first.index])))) return null;
  return first.index;
}

function meaningfulSheets(workbook) {
  return workbook.SheetNames.filter(name => Object.entries(workbook.Sheets[name]).some(([key, cell]) => !key.startsWith('!') && (cell.f || normalizeObjectName(cell.v))));
}

function readRows(sheet) {
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
  if (range.e.r >= 20000 || range.e.c >= 512) throw new Error('Лист превышает лимит 20 000 строк или 512 колонок. Разделите исходный файл.');
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, range: { s: { r: 0, c: 0 }, e: range.e } });
}

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length];
}

function suggestLoci(header) {
  const name = normalizeHeader(header).replace(/\s/g, '').toUpperCase();
  return detector.getAllSupportedLoci().map(locus => ({ locus, distance: editDistance(name, locus.replace(/\s/g, '').toUpperCase()) }))
    .filter(item => item.distance <= 2).sort((a, b) => a.distance - b.distance || a.locus.localeCompare(b.locus)).slice(0, 3).map(item => item.locus);
}

function panelCandidates(sourceLoci, panels) {
  const source = new Set(sourceLoci);
  return panels.map(panel => {
    const expected = new Set(panel.lociOrder);
    const matches = sourceLoci.filter(locus => expected.has(locus)).length;
    return { id: panel.id, name: panel.name, matches, expected: expected.size, missing: [...expected].filter(locus => !source.has(locus)), extra: sourceLoci.filter(locus => !expected.has(locus)), score: matches / Math.max(source.size, expected.size), exact: matches === source.size && matches === expected.size };
  }).filter(panel => panel.matches).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

const NGS_FORMAT = 'NGS_ASTR_RESULT_DETAIL';
const resultHeaders = ['#type', 'locus', 'genotype', 'qc flag', 'total depth of coverage'];
const detailHeaders = ['locus', 'allele', 'qc flag', 'coverage'];

function ngsHeader(sheet, required, selectedRow) {
  const rows = readRows(sheet);
  const candidates = rows.slice(0, 30).map((row, index) => {
    const names = row.map(normalizeHeader);
    return { row: index + 1, columns: Object.fromEntries(names.map((name, column) => [name, column])),
      valid: required.every(name => names.filter(value => value === name).length === 1),
      score: required.filter(name => names.includes(name)).length };
  }).filter(candidate => selectedRow == null || candidate.row === selectedRow).sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best && best.score >= 2 ? { ...best, ambiguous: candidates[1]?.score === best.score } : null;
}

function detectSourceFormat(workbook, settings = {}) {
  if (Buffer.isBuffer(workbook)) {
    const { rows, headers, ...detection } = detectGeneMapperTxt(workbook, settings);
    return detection;
  }
  const results = workbook.SheetNames.filter(name => name.trim().toLowerCase() === 'result');
  const details = workbook.SheetNames.filter(name => name.trim().toLowerCase() === 'detail');
  const resultSheet = results.includes(settings.sheetName) ? settings.sheetName : results[0];
  const detailSheet = details.includes(settings.detailSheetName) ? settings.detailSheetName : details[0];
  const resultHeader = resultSheet && ngsHeader(workbook.Sheets[resultSheet], resultHeaders, settings.resultHeaderRow);
  const detailHeader = detailSheet && ngsHeader(workbook.Sheets[detailSheet], detailHeaders, settings.detailHeaderRow);
  const candidate = (resultHeader && ['locus', 'genotype'].every(name => name in resultHeader.columns))
    || (detailHeader && ['locus', 'allele', 'coverage'].every(name => name in detailHeader.columns)) || settings.format === NGS_FORMAT;
  if (!candidate || settings.format === 'legacy') return { format: 'LEGACY_TABLE' };
  const ambiguous = (results.length > 1 && !results.includes(settings.sheetName)) || (details.length > 1 && !details.includes(settings.detailSheetName)) || resultHeader?.ambiguous || detailHeader?.ambiguous;
  return { format: NGS_FORMAT, confidence: ambiguous ? 'LOW' : resultHeader?.valid && detailHeader?.valid ? 'HIGH' : 'LIMITED',
    ambiguous, resultSheet, detailSheet, resultHeader, detailHeader };
}

module.exports = { objectPriority, isServiceColumn, headerCandidates, objectCandidates, chooseObjectColumn, meaningfulSheets, readRows, suggestLoci, panelCandidates, detectSourceFormat, NGS_FORMAT, GENEMAPPER_FORMAT };
