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
module.exports = { COMMENT_HEADERS, isRegistryMetadataHeader, restoreKnownImportMetadata };
