const { resolveProfileImportFormat } = require('./profileImportFormat');

function getTaskNumberLabel(department) {
  return resolveProfileImportFormat(department) === 'genetic' ? '№ Экспертизы' : 'Номер привоза';
}

function getTaskNumberRangeLabel(department) {
  return resolveProfileImportFormat(department) === 'genetic' ? 'Диапазон № Экспертиз' : 'Диапазон номеров привозов';
}

module.exports = { getTaskNumberLabel, getTaskNumberRangeLabel };
