const { resolveProfileImportFormat } = require('./profileImportFormat');

function getTaskNumberLabel(department) {
  return resolveProfileImportFormat(department) === 'genetic' ? 'Номер экспертизы' : 'Номер привоза';
}

function getTaskNumberRangeLabel(department) {
  return resolveProfileImportFormat(department) === 'genetic' ? 'Диапазон номеров экспертиз' : 'Диапазон номеров привозов';
}

module.exports = { getTaskNumberLabel, getTaskNumberRangeLabel };
