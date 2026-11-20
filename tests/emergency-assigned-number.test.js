const test = require('node:test'), assert = require('node:assert/strict'), XLSX = require('xlsx');
const { ASSIGNED_HEADER, getAssignedNumber } = require('../src/utils/emergencyAssignedNumber');
const { parseFiles } = require('../src/services/workspace/importSourceService');
const { FORMAT, validateObject } = require('../src/utils/objectImportV2');
const { createImportWorkbook } = require('../src/utils/importWorkbook');
const legacyHeader = '№ присвоенный в в/ч № 522 ЦПООП Северо-Кавказского военного округа, г. Ростов-на-Дону';
const base = { objectNumber: 'SYN-101', year: 2026, expertiseType: 'chs', fullName: '', comment: '', strData: { TH01: ['7','9.3'] } };
function source(headers, rows, customize) {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  if (customize) customize(sheet);
  XLSX.utils.book_append_sheet(book, sheet, 'Импорт');
  return { originalname: 'SYN.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) };
}
test('ЧС: Ростовский номер читается без учёта регистра и из прежнего заголовка', () => {
  for (const header of ['Ростовский номер', 'рОстОвсКий нОмЕр', '  РОСТОВСКИЙ   НОМЕР  ', legacyHeader, legacyHeader.replace(/^№ /, ''), '  № присвоенный   в в/ч  ']) {
    const [row] = parseFiles([source([header,'Привоз','Год','Sample Name','Тип экспертизы','TH01'], [['000123/А','12',2026,'SYN-101','ЧС','7,9.3']])]).rows;
    assert.equal(row.objectNumber, 'SYN-101'); assert.equal(row.assignedNumber, '000123/А');
    assert.equal(row.provenance.assignedNumber, '000123/А');
    assert.deepEqual(row.strData, base.strData); assert.deepEqual(row.sourceIssues, []);
    assert.deepEqual(validateObject(row, { requireAssignedNumber: true }), []);
  }
  const [row] = parseFiles([source(['Объект','Год','Тип экспертизы','ростовский номер'], [['SYN',2026,'chs',123]], sheet => { sheet.D2.z = '000000'; })]).rows;
  assert.equal(row.assignedNumber, '000123');
});
test('Номер обязателен при импорте ЧС, не требуется другим типам и не угадывается из номера объекта', () => {
  assert(validateObject(base, { requireAssignedNumber: true }).some(issue => issue.code === 'ASSIGNED_NUMBER_REQUIRED'));
  assert.deepEqual(validateObject(base), []); // Старый профиль без номера остаётся доступным для работы.
  assert.deepEqual(validateObject({ ...base, expertiseType: 'ug' }, { requireAssignedNumber: true }), []);
  assert(validateObject({ ...base, assignedNumber: 'x'.repeat(256) }, { requireAssignedNumber: true }).some(issue => issue.code === 'ASSIGNED_NUMBER_INVALID'));
  assert(validateObject({ ...base, assignedNumber: '12\n34' }, { requireAssignedNumber: true }).some(issue => issue.code === 'ASSIGNED_NUMBER_INVALID'));
  assert.equal(getAssignedNumber({ sample_name: '101', expertise_type: 'chs', import_format: 'genetic' }), '');
});
test('Номер не теряется в V2 и обычном нормализованном Excel, остаётся текстом и не формулой', () => {
  const profile = { ...base, assignedNumber: '=00123', provenance: { assignedNumber: '=00123', checksum: 'SYN' } };
  const original = structuredClone(profile);
  for (const sourceFormat of [FORMAT, 'EXCEL_CONVERTER']) {
    const buffer = createImportWorkbook({ profiles: [profile], loci: ['TH01'], sourceFormat });
    const book = XLSX.read(buffer), sheet = book.Sheets['Импорт'];
    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
    const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: headers.indexOf(ASSIGNED_HEADER) })];
    assert.equal(cell.t, 's'); assert.equal(cell.v, '=00123'); assert.equal(cell.f, undefined);
    const [parsed] = parseFiles([{ originalname: 'SYN.xlsx', buffer }]).rows;
    assert.equal(parsed.assignedNumber, profile.assignedNumber); assert.deepEqual(parsed.strData, base.strData);
  }
  assert.deepEqual(profile, original);
});
test('Восстановление из прежнего provenance без миграции; конфликтующие колонки требуют исправления Excel', () => {
  assert.equal(getAssignedNumber({ provenance: { legacyColumns: [{ header: ASSIGNED_HEADER, value: '00009' }] } }), '00009');
  assert.equal(getAssignedNumber({ provenance: { legacyCells: { [legacyHeader]: '00010' } } }), '00010');
  assert.equal(getAssignedNumber({ provenance: { sampleName: '00011', legacy: { import_format: 'emergency' } } }), '00011');
  assert.equal(getAssignedNumber({ import_format: 'emergency', sample_name: '00012' }), '00012');
  assert.equal(getAssignedNumber({ assignedNumber: '', provenance: { assignedNumber: 'old' } }), '');
  const [row] = parseFiles([source(['Объект','Год','Тип экспертизы','ростовский номер',legacyHeader], [['SYN',2026,'chs','0001','0002']])]).rows;
  assert(row.sourceIssues.some(issue => issue.code === 'METADATA_COLUMN_CONFLICT'));
});
