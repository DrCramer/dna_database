const { extractExpertiseNumber, geneticObjectKey } = require('./profileImportFormat');

const key = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const COMMENT_HEADERS = Object.freeze(['комментарий', 'комментарии', 'комментарий (подробное описание объекта)']);
const REGISTRY_HEADERS = new Set(['№ постановления', '№ рег рцсмэ', 'rt (small)']);
const isRegistryMetadataHeader = header => REGISTRY_HEADERS.has(key(header)) || COMMENT_HEADERS.includes(key(header));
function restoreKnownImportMetadata(row) {
  const columns = row.provenance?.legacyColumns;
  if (!Array.isArray(columns)) return row;
  const known = new Set(columns.filter(column => column && isRegistryMetadataHeader(column.header)).map(column => key(column.header)));
  if (!known.size) return row;
  // Старые черновики сохраняют исходные колонки. Меняется только диагностика;
  // пользовательские правки комментария и исходные значения не перезаписываются.
  const sourceIssues = (row.sourceIssues || []).filter(issue => {
    if (issue.code !== 'UNKNOWN_COLUMN') return true;
    const header = issue.column || /^Неизвестный столбец «(.*)» с данными\./.exec(issue.message || '')?.[1];
    return !known.has(key(header));
  });
  return sourceIssues.length === (row.sourceIssues || []).length ? row : { ...row, sourceIssues };
}
function groupRowsWithoutYearByExpertise(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.included || row.provenance?.classification?.included === false ||
        (row.year != null && row.year !== '') || row.expertiseType === 'chs' || row.expertiseType === 'staff') continue;
    const number = extractExpertiseNumber(row.objectNumber);
    if (!number) continue;
    const caseKey = geneticObjectKey(number);
    if (!groups.has(caseKey)) groups.set(caseKey, { number, rows: [] });
    groups.get(caseKey).rows.push(row);
  }
  return groups;
}

module.exports = { COMMENT_HEADERS, isRegistryMetadataHeader, restoreKnownImportMetadata, groupRowsWithoutYearByExpertise };
