const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { profileUploadError } = require('../src/utils/profileUploadError');
const { FileValidationService } = require('../src/services/converters/fileValidationService');

test('Ошибки загрузки сохраняют причины, подсказки и предупреждения после повторного catch', () => {
  const validation = { valid: false, errors: [{ type: 'filename', message: 'Название файла не должно содержать пробелы',
    details: { suggestion: 'для_импорта.xlsx' } }], warnings: [{ message: 'Неизвестный столбец' }], summary: { actualDataRows: 3000 } };
  const body = { message: 'Файл не прошел валидацию', code: 'VALIDATION_FAILED', validation };
  const before = JSON.stringify(body);
  const error = profileUploadError(profileUploadError(body));
  assert(error instanceof Error);
  assert.equal(error.message, body.message);
  assert.equal(error.code, body.code);
  assert.deepEqual(error.validation, validation);
  assert.equal(JSON.stringify(body), before);
});

test('Preview, обычная загрузка и подтверждение сохраняют номера строк и дубликаты', () => {
  for (const details of [{ validationErrors: [{ rowNumber: 37, message: 'Не заполнен год', details: { column: 'Год' } }] },
    { internalDuplicates: [{ sampleName: 'SYN-1', firstRow: 2, duplicateRow: 12 }] }]) {
    const error = profileUploadError(profileUploadError({ message: 'Ошибка данных', details }));
    const field = Object.keys(details)[0];
    assert.deepEqual(error[field], details[field]);
    assert.equal(error[field === 'validationErrors' ? 'errorCount' : 'duplicateCount'], 1);
  }
  assert.equal(profileUploadError(new Error('Нет связи')).message, 'Нет связи');
  assert.equal(profileUploadError(null, 'Повторите попытку').message, 'Повторите попытку');
});

test('ЧС: пробел в имени — причина отказа, поддерживаемый год не считается неизвестным', () => {
  const rows = [['присвоенный в в/ч № 522 ЦПООП Северо-Кавказского военного округа, г. Ростов-на-Дону',
    'привоз', 'год', 'Наименование образца', 'D3S1358', 'vWA', 'TH01'],
  ['SYN-1', 258, 2026, 'SYN-258-1', '15,18', '16,18', '7,9']];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Профили');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const service = new FileValidationService();
  const rejected = service.validateFile(buffer, 'для импорта.xlsx', { importFormat: 'emergency' });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.errors.length, 1);
  assert.equal(rejected.errors[0].code, 'INVALID_FILENAME');
  assert.equal(rejected.errors[0].details.suggestion, 'для_импорта.xlsx');
  assert.deepEqual(rejected.warnings, []);
  assert.equal(service.validateFile(buffer, 'для_импорта.xlsx', { importFormat: 'emergency' }).valid, true);
  rows[0].push('Лишний столбец'); rows[1].push('SYN');
  const other = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(other, XLSX.utils.aoa_to_sheet(rows), 'Профили');
  const warning = service.validateFile(XLSX.write(other, { type: 'buffer', bookType: 'xlsx' }), 'profiles.xlsx', { importFormat: 'emergency' });
  assert.equal(warning.valid, true, 'предупреждение не блокирует загрузку');
  assert.deepEqual(warning.warnings[0].details.unknownColumns, ['Лишний столбец']);
});
