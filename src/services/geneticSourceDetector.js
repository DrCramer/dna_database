const XLSX = require('xlsx');
const { LociTypeDetector } = require('../utils/lociTypeDetector');
const { normalizeObjectName } = require('../utils/profileImportFormat');
const detector = new LociTypeDetector();
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

module.exports = { objectPriority, isServiceColumn, headerCandidates, objectCandidates, chooseObjectColumn, meaningfulSheets, readRows, suggestLoci, panelCandidates };
