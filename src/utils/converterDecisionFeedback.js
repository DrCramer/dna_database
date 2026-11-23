function converterDecisionFeedback(result, undo) {
  const stats = result.bulkDecisions?.[undo.operationId];
  if (!stats || !['matched', 'accepted', 'needsReview', 'warnings', 'specialWarnings'].every(key => Number.isSafeInteger(stats[key]) && stats[key] >= 0 && stats[key] <= stats.matched) || stats.matched !== undo.count || stats.accepted + stats.needsReview !== stats.matched) {
    throw new Error('Сервер не подтвердил применение массового решения ко всем выбранным случаям. Повторите проверку; если сообщение сохраняется, обновите сервер и страницу.');
  }
  let text = `Решение применено: ${undo.locus}, случаев: ${stats.matched}.`;
  if (!stats.mixedValues && stats.value === undo.previousValue) text += ` Результат уже был «${stats.value || 'пусто'}»; решение подтверждено.`;
  if (stats.needsReview) text += ` Требуют исправления: ${stats.needsReview}.`;
  if (stats.warnings) text += ` Предупреждения сохранены: ${stats.warnings}.`;
  if (stats.specialWarnings) text += ' Подтверждение не превращает специальные значения в числовые аллели.';
  return { text, needsReview: stats.needsReview > 0 };
}
module.exports = { converterDecisionFeedback };
