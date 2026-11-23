const { objectMetadataIssues } = require('./objectTypes');
const rowId = row => row.draftRowId || row.id;
function getWorkspaceImportIssueContext(row, issue) {
  const location = row.sourceLocation || row.provenance?.location;
  const origins = row.provenance?.alleleOrigins;
  const candidates = issue.locus && (issue.rawValue == null || !location?.row) && Array.isArray(origins)
    ? origins.filter(entry => entry?.locus === issue.locus) : [];
  const origin = candidates.length === 1 ? candidates[0] : undefined;
  const raw = issue.rawValue ?? (issue.code === 'ALLELE_REVIEW' ? origin?.raw : undefined);
  return {
    filename: row.sourceFilename || row.provenance?.sourceFilename,
    sheet: location?.sheet,
    row: location?.row ?? origin?.sourceRow,
    cell: issue.cell,
    rawValue: Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : ''
  };
}

function formatImportIssueLocation(context, includeFile = false) {
  const position = context.cell || (context.row ? 'строка ' + context.row : '');
  if (!position && !includeFile) return '';
  return [includeFile && context.filename, context.sheet, position].filter(Boolean).join(' · ');
}

function collectWorkspaceImportIssues(rows, validation) {
  const server = new Map(), globalIssues = [];
  for (const entry of validation?.errors || []) {
    if (!entry.draftRowId) { globalIssues.push(...(entry.issues || [])); continue; }
    server.set(entry.draftRowId, [...(server.get(entry.draftRowId) || []), ...(entry.issues || [])]);
  }
  const byRow = new Map(), groups = new Map();
  let rowCount = 0;
  for (const row of rows) {
    const id = rowId(row), seen = new Set();
    const issues = [...(row.sourceIssues || []), ...objectMetadataIssues(row, { requireAssignedNumber: true }), ...(server.get(id) || [])].filter(issue => {
      const key = JSON.stringify([issue.code, issue.locus, issue.column, issue.cell, issue.message]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    byRow.set(id, issues);
    if (!row.included || !issues.length) continue;
    rowCount++;
    for (const issue of issues) {
      const message = issue.code === 'DUPLICATE_OBJECT' ? 'Повтор типа, года и полного номера среди выбранных строк.' : issue.message;
      const key = JSON.stringify([issue.code, issue.locus, issue.column, message]);
      if (!groups.has(key)) groups.set(key, { key, message, code: issue.code, locus: issue.locus, column: issue.column, rowIds: new Set(), examples: [] });
      const group = groups.get(key);
      if (group.rowIds.has(id)) continue;
      group.rowIds.add(id);
      if (group.examples.length < 3) {
        const { filename, sheet, row: sourceRow, cell } = getWorkspaceImportIssueContext(row, issue);
        group.examples.push({ id, objectNumber: row.objectNumber || row.fullName || 'Без номера', filename, sheet, row: sourceRow, cell });
      }
    }
  }
  return { byRow, rowCount, globalIssues, groups: [...groups.values()].sort((a, b) => b.rowIds.size - a.rowIds.size) };
}
module.exports = { collectWorkspaceImportIssues, getWorkspaceImportIssueContext, formatImportIssueLocation };
