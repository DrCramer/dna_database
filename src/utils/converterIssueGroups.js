const { LociTypeDetector } = require('./lociTypeDetector');
const { normalizeAlleleValue } = require('./alleleNormalizer');
const { converterCellCoordinates, rowRanges } = require('./converterRuleScope');
const detector = new LociTypeDetector();
const conflict = issue => ['REPEATED_RESULT', 'MANUAL_RESULT'].includes(issue.code);
function canBatchIssue(issue) {
  return Boolean(issue.locus && !issue.ngs && !issue.variants && issue.code !== 'FORMULA_WITHOUT_RESULT' && issue.ruleCode !== 'FORMULA_WITHOUT_RESULT' && converterCellCoordinates(issue));
}
function groupConverterIssues(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const kind = issue.ngs ? 'ngs' : conflict(issue) ? 'conflict' : issue.geneMapper ? 'genemapper' : 'cell';
    const signature = JSON.stringify([kind, issue.locus || '', issue.code, issue.ruleCode, issue.status, Boolean(issue.hard), issue.rawValue || '', issue.normalizedValue || '', issue.reason || '',
      issue.events?.map(event => [event.code, event.status, event.hard, event.reason]), issue.userDecision,
      issue.variants?.map(variant => [variant.sourceFile, variant.sourceSheet, variant.rawValue, variant.normalizedValue, variant.status, variant.hard])]);
    let group = groups.get(signature);
    if (!group) { group = { key: signature, issue, members: [], files: new Map(), objects: new Set(), ids: new Set(), canBatch: true }; groups.set(signature, group); }
    if (group.ids.has(issue.id)) continue;
    group.ids.add(issue.id);
    group.members.push(issue);
    if (issue.sourceFile) group.files.set(issue.fileId || issue.sourceFile, issue.sourceFile);
    else for (const variant of issue.variants || []) if (variant.sourceFile) group.files.set(variant.fileId || variant.sourceFile, variant.sourceFile);
    if (!group.files.size) group.files.set('', 'Источник не указан');
    if (issue.objectNumber) group.objects.add(issue.objectNumber);
    group.canBatch = group.canBatch && canBatchIssue(issue);
  }
  return [...groups.values()];
}
function applyConverterIssueDecision(options, members, decision) {
  if (!members.length) return options;
  const next = { ...options }, first = members[0];
  if (members.length > 1) {
    // Validate the snapshot too: callers cannot accidentally combine unlike loci or QC.
    const groups = groupConverterIssues(members);
    if (groups.length !== 1 || !groups[0].canBatch || !['split_dot', 'keep', 'homozygous', 'unknown', 'missing', 'manual'].includes(decision.action)) throw new Error('Эти случаи необходимо исправить по отдельности.');
    const scopes = new Map();
    for (const issue of members) {
      const { row, column } = converterCellCoordinates(issue);
      const id = JSON.stringify([issue.fileId, issue.sourceSheet, column]);
      if (!scopes.has(id)) scopes.set(id, { issue, column, rows: [] });
      scopes.get(id).rows.push(row);
    }
    const original = normalizeAlleleValue(first.rawValue, first.locus);
    const originalCode = first.ruleCode || original.events.find(event => event.hard)?.code || original.events[0]?.code || 'OK';
    const rules = [...scopes.values()].map(({ issue, column, rows }) => ({ fileId: issue.fileId, sheetName: issue.sourceSheet, column,
      locus: issue.locus, locusType: detector.detectLocusType(issue.locus), rawValue: issue.rawValue, code: 'SCOPED_CELL_V1', originalCode, rowRanges: rowRanges(rows), decision }));
    next.rules = [...rules, ...(options.rules || [])];
    if (next.rules.length > 1000) throw new Error('Достигнут лимит массовых решений. Обработайте файлы меньшими пакетами.');
    if (options.cells) {
      next.cells = { ...options.cells };
      for (const issue of members) delete next.cells[issue.id];
    }
  } else if (decision.action === 'object') next.objects = { ...options.objects, [first.id]: decision.value };
  else if (decision.action === 'ignore_row') next.rows = { ...options.rows, [first.id.replace(/:object$/, '')]: { ignore: true } };
  else if (conflict(first)) next.conflicts = { ...options.conflicts, [first.id]: decision };
  else next.cells = { ...options.cells, [first.id]: decision };
  return next;
}
module.exports = { groupConverterIssues, applyConverterIssueDecision };
