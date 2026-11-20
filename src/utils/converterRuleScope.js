// Rules target original cell coordinates, not displayed GeneMapper TXT row numbers.
function converterCellCoordinates(issue) {
  if (!issue.fileId || !issue.sourceSheet || typeof issue.id !== 'string') return null;
  const prefix = `${issue.fileId}:${issue.sourceSheet}:`;
  if (!issue.id.startsWith(prefix)) return null;
  const match = /^(\d+):(\d+)$/.exec(issue.id.slice(prefix.length));
  if (!match) return null;
  const row = Number(match[1]), column = Number(match[2]);
  return Number.isSafeInteger(row) && row > 0 && Number.isSafeInteger(column) ? { row, column } : null;
}
function rowRanges(rows) {
  const ranges = [];
  for (const row of [...new Set(rows)].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] + 1 === row) last[1] = row;
    else ranges.push([row, row]);
  }
  return ranges;
}
function inRanges(row, ranges) {
  let left = 0, right = ranges.length - 1;
  while (left <= right) {
    const mid = (left + right) >>> 1, [from, to] = ranges[mid];
    if (row < from) right = mid - 1;
    else if (row > to) left = mid + 1;
    else return true;
  }
  return false;
}
const key = value => JSON.stringify([value.fileId, value.code, value.rawValue, value.locusType]);
function createConverterRuleMatcher(rules = []) {
  const index = new Map();
  for (const rule of rules) {
    const scoped = rule.code === 'SCOPED_CELL_V1';
    if (scoped && (typeof rule.originalCode !== 'string' || rule.originalCode === 'SCOPED_CELL_V1' || rule.rowRanges == null)) throw new TypeError('Invalid scoped rule');
    if (rule.locus != null && typeof rule.locus !== 'string' || rule.sheetName != null && typeof rule.sheetName !== 'string' || rule.column != null && (!Number.isSafeInteger(rule.column) || rule.column < 0)) throw new TypeError('Invalid rule scope');
    if (rule.rowRanges != null) {
      if (!Array.isArray(rule.rowRanges) || !rule.rowRanges.length || rule.rowRanges.length > 20001 || typeof rule.fileId !== 'string' || typeof rule.locus !== 'string' || typeof rule.sheetName !== 'string' || !Number.isSafeInteger(rule.column)) throw new TypeError('Invalid row ranges');
      let previous = 0;
      for (const range of rule.rowRanges) {
        if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger) || range[0] <= previous || range[1] < range[0]) throw new TypeError('Invalid row ranges');
        previous = range[1];
      }
    }
    const id = key(scoped ? { ...rule, code: rule.originalCode } : rule);
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(rule);
  }
  return cell => index.get(key(cell))?.find(rule =>
    (rule.locus == null || rule.locus === cell.locus) &&
    (rule.sheetName == null || rule.sheetName === cell.sheetName) &&
    (rule.column == null || rule.column === cell.column) &&
    (rule.rowRanges == null || inRanges(cell.row, rule.rowRanges)));
}
module.exports = { converterCellCoordinates, rowRanges, createConverterRuleMatcher };
