const { LociTypeDetector } = require('./lociTypeDetector');

const IMPORT_FORMATS = { GENETIC: 'genetic', EMERGENCY: 'emergency' };
const detector = new LociTypeDetector();

// Формат определяет отделение, а не состав столбцов или UUID.
function resolveProfileImportFormat(department) {
  const name = String(department?.name || '').trim().toLocaleLowerCase('ru');
  if (name === 'генетические экспертизы') return IMPORT_FORMATS.GENETIC;
  if (name === 'чс') return IMPORT_FORMATS.EMERGENCY;
  return null; // Для остальных отделений сохраняется legacy-проверка.
}

function normalizeObjectName(value) {
  return value == null ? '' : String(value).trim().replace(/\s+/g, ' ');
}

function geneticObjectKey(value) {
  return normalizeObjectName(value).toLowerCase();
}

// Пустые форматированные колонки справа не являются частью шапки.
// Колонка с данными, но без заголовка, при этом остаётся ошибкой.
function getGeneticHeaders(data) {
  let width = 0;
  for (const row of data) row.forEach((value, index) => {
    if (normalizeObjectName(value)) width = Math.max(width, index + 1);
  });
  return Array.from({ length: width }, (_, index) => data[0]?.[index]);
}

// Общая карта заголовков для валидации, preview и реальной загрузки.
function validateGeneticHeaders(headers, minRequiredLoci = 3) {
  const errors = [];
  const columns = [];
  const seen = new Set();
  const add = (code, message, details = {}) => errors.push({ type: 'column', code, message, details });
  if (String(headers[0] || '').trim().toLowerCase() !== 'объект') {
    add('MISSING_OBJECT_COLUMN', 'Первый столбец файла должен называться «Объект».');
  }
  for (let index = 1; index < headers.length; index++) {
    const name = headers[index];
    const locus = detector.getCanonicalLocusName(name);
    if (!locus) {
      add('UNKNOWN_LOCUS', `Неизвестный генетический локус: ${normalizeObjectName(name) || `(пустой заголовок, столбец ${index + 1})`}.`, { column: index + 1, header: name ?? null });
    } else if (seen.has(locus)) {
      add('DUPLICATE_LOCUS', `Обнаружены повторяющиеся столбцы локуса ${locus}.`, { locus });
    } else {
      seen.add(locus);
      columns.push({ index, locus });
    }
  }
  if (seen.size < minRequiredLoci) {
    add('MISSING_STR_COLUMNS', `В файле не найдено достаточного количества генетических локусов. Найдено: ${seen.size}. Минимум: ${minRequiredLoci}.`);
  }
  return { valid: errors.length === 0, errors, columns, recognizedMarkers: seen.size };
}

module.exports = { IMPORT_FORMATS, resolveProfileImportFormat, normalizeObjectName, geneticObjectKey, getGeneticHeaders, validateGeneticHeaders };
