// Retain only the inverse of the last bulk edit, never a workbook or preview.
function prepareConverterBulkUndo(before, after, members, operationId) {
  const ruleCount = (after.rules?.length || 0) - (before.rules?.length || 0);
  if (members.length < 2 || ruleCount < 1 || typeof operationId !== 'string' || !operationId || before.rules?.some(rule => rule.bulkOperation === operationId)) throw new Error('Не удалось сохранить отмену массового решения.');
  const removedCells = [];
  for (const id of new Set(members.map(issue => issue.id))) {
    if (Object.hasOwn(before.cells || {}, id) && !Object.hasOwn(after.cells || {}, id)) removedCells.push([id, before.cells[id]]);
  }
  const rules = after.rules.map((rule, index) => index < ruleCount ? { ...rule, bulkOperation: operationId } : rule);
  return {
    options: { ...after, rules },
    undo: { operationId, ruleCount, removedCells, hadRules: Object.hasOwn(before, 'rules'), hadCells: Object.hasOwn(before, 'cells'),
      count: new Set(members.map(issue => issue.id)).size, locus: members[0].locus, previousValue: members[0].normalizedValue }
  };
}
function undoConverterBulkDecision(options, undo) {
  if (!undo || (options.rules || []).filter(rule => rule.bulkOperation === undo.operationId).length !== undo.ruleCount) throw new Error('Массовое решение уже отменено или больше не доступно для отмены.');
  const next = { ...options, rules: options.rules.filter(rule => rule.bulkOperation !== undo.operationId) };
  if (!next.rules.length && !undo.hadRules) delete next.rules;
  if (undo.removedCells.length) {
    next.cells = { ...options.cells };
    for (const [id, decision] of undo.removedCells) {
      // A newer individual edit wins, even when it targets the same cell.
      if (!Object.hasOwn(next.cells, id)) next.cells[id] = decision;
    }
  }
  if (next.cells && !Object.keys(next.cells).length && !undo.hadCells) delete next.cells;
  return next;
}
module.exports = { prepareConverterBulkUndo, undoConverterBulkDecision };
