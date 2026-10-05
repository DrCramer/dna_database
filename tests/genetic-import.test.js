const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { ExcelService } = require('../src/services/excelService');
const { FileValidationService } = require('../src/services/fileValidationService');
const { LociTypeDetector } = require('../src/utils/lociTypeDetector');
const { resolveProfileImportFormat } = require('../src/utils/profileImportFormat');
const DNAProfile = require('../src/models/DNAProfile');
const User = require('../src/models/User');
const { getProfileUploadBlockReason } = require('../src/utils/profileUploadPermissions');

test('UI учитывает оба права, статус задачи и активное отделение', () => {
  const user = { role: 'user_analyst', can_upload_with_task: true, can_upload_without_task: false };
  const task = { id: 'task', department_id: 'genetic', status: 'in_progress', is_active: true };
  assert.match(getProfileUploadBlockReason(user, null, 'genetic'), /выберите активную задачу/);
  assert.equal(getProfileUploadBlockReason(user, task, 'genetic'), '');
  assert.match(getProfileUploadBlockReason({ ...user, can_upload_with_task: false }, task, 'genetic'), /запрещена/);
  assert.equal(getProfileUploadBlockReason({ ...user, can_upload_without_task: true }, null, 'genetic'), '');
  assert.match(getProfileUploadBlockReason(user, { ...task, status: 'completed' }, 'genetic'), /В работе/);
  assert.match(getProfileUploadBlockReason(user, task, 'emergency'), /другому отделению/);
  assert.match(getProfileUploadBlockReason({ ...user, role: 'viewer' }, task, 'genetic'), /нет права/);
});

const excel = new ExcelService();
const validation = new FileValidationService();
const options = { importFormat: 'genetic' };
function workbook(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Профили');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
const parse = rows => excel.parseExcelFile(workbook(rows), 'genetic.xlsx', options);
const standard = [['Объект', 'TH01', 'D5S818', 'D21S11'], ['A-1', '7,9', '11,12', '29,30']];

test('Стандартный порядок и тот же профиль с переставленными столбцами', async () => {
  const [a] = await parse(standard);
  const [b] = await parse([['Объект', 'D21S11', 'TH01', 'D5S818'], ['A-1', '29,30', '7,9', '11,12']]);
  assert.deepEqual(a.strData, { TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30'] });
  assert.deepEqual(b.strData, a.strData);
  assert.equal(a.sampleName, 'A');
  assert.equal(a.internalNumber, 'A-1');
  assert.equal(a.year, null);
});

test('Все 31 маркер из задания и перемешанный набор независимо от позиций', async () => {
  const names = 'TH01 D5S818 D21S11 D18S51 D6S1043 D4S2366 Rs2032678 SRY AMEL D3S1358 D13S317 D7S820 D16S539 CSF1PO Penta_D DYS392 D2S441 vWA D8S1179 TPOX Penta_E Rs771783753 D19S433 D22S1045 D2S1338 FGA DYS391 D1S1656 D12S391 D10S1248 SE33'.split(' ').map(name => name.replace('_', ' '));
  const values = Object.fromEntries(names.map((name, index) => [name,
    name === 'AMEL' ? 'XY' : name.startsWith('Rs') ? 'A,T' : ['SRY', 'DYS392', 'DYS391'].includes(name) ? String(index + 1) : `${index + 7},${index + 9}`]));
  const [base] = await parse([['Объект', ...names], ['FULL-1', ...names.map(name => values[name])]]);
  assert.equal(Object.keys(base.strData).length, 31);
  for (let shift = 0; shift < names.length; shift += 5) {
    const order = [...names.slice(shift), ...names.slice(0, shift)].reverse();
    const [profile] = await parse([['Объект', ...order], ['FULL-1', ...order.map(name => values[name])]]);
    assert.deepEqual(profile.strData, base.strData);
  }
});

test('Регистр, пробелы и Penta приводятся к каноническим ключам', async () => {
  const [p] = await parse([[' Объект ', ' th01 ', 'D5s818', 'rs2032678', 'PENTAD', 'vwa', 'Penta  E'], ['110-1', '7,9', '11,12', 'A,T', '8', '15/18', '12-13']]);
  assert.deepEqual(Object.keys(p.strData), ['TH01', 'D5S818', 'Rs2032678', 'Penta D', 'vWA', 'Penta E']);
  assert.deepEqual(p.strData['Penta D'], ['8', '8']);
  assert.deepEqual(p.strData.vWA, ['15', '18']);
  assert.deepEqual(p.strData['Penta E'], ['12', '13']);
});

for (const [name, headers, message] of [
  ['Нет Объекта', ['Sample Name', 'TH01', 'D5S818', 'D21S11'], /Первый столбец/],
  ['Объект не первый', ['TH01', 'Объект', 'D5S818', 'D21S11'], /Первый столбец/],
  ['Неизвестный локус', ['Объект', 'TH01', 'D5S818', 'D21S1I'], /Неизвестный генетический локус: D21S1I/],
  ['Повторный локус', ['Объект', 'TH01', 'D5S818', 'D21S11', 'th01'], /повторяющиеся столбцы локуса TH01/],
  ['Повторный Penta', ['Объект', 'TH01', 'Penta D', 'D21S11', 'PentaD'], /повторяющиеся столбцы локуса Penta D/],
  ['Только два локуса', ['Объект', 'TH01', 'D5S818'], /Найдено: 2. Минимум: 3/],
  ['Служебный столбец', ['Объект', 'TH01', 'D5S818', 'D21S11', 'Год'], /Неизвестный генетический локус: Год/]
]) {
  test(name, async () => {
    const data = [headers, ['A-1', '7,9', '11,12', '29,30', '7,9']];
    await assert.rejects(parse(data), message);
    const checked = validation.validateFile(workbook(data), 'genetic.xlsx', options);
    assert.equal(checked.valid, false);
    assert(checked.errors.some(error => message.test(error.message)));
  });
}

test('Отсутствие A1 и безымянная колонка с данными не сдвигают mapping', async () => {
  await assert.rejects(parse([[null, 'Объект', 'TH01', 'D5S818', 'D21S11'], [null, 'A-1', '7,9', '11,12', '29,30']]), /Первый столбец/);
  await assert.rejects(parse([standard[0], [...standard[1], 'лишние данные']]), /пустой заголовок/);
});

test('Пустые строки пропускаются, ошибка Объекта сохраняет номер строки Excel', async () => {
  const rows = [standard[0], standard[1], [], [null, '7,9', '11,12', '29,30']];
  await assert.rejects(parse(rows), error => error.details.validationErrors[0].rowNumber === 4 && /Объект/.test(error.message));
  const [p] = await parse([standard[0], [], standard[1], []]);
  assert.equal(p.rowNumber, 3);
  await assert.rejects(parse([standard[0], ['110-1', '-', '', null]]), /отсутствуют данные генетического профиля/);
});

test('Нулевые значения не теряются, пустое форматирование справа игнорируется', async () => {
  const [zero] = await parse([standard[0], [0, 0, 0, 0]]);
  assert.equal(zero.sampleName, '0');
  assert.deepEqual(zero.strData.TH01, ['0', '0']);
  const book = XLSX.read(workbook(standard), { type: 'buffer' });
  book.Sheets[book.SheetNames[0]]['!ref'] = 'A1:Z10';
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const [p] = await excel.parseExcelFile(buffer, 'genetic.xlsx', options);
  assert.equal(p.sampleName, 'A');
  assert.equal(validation.validateFile(buffer, 'genetic.xlsx', options).valid, true);
});

test('Частично заполненный профиль и существующие форматы аллелей', async () => {
  const [p] = await parse([['Объект', 'TH01', 'D5S818', 'D21S11', 'DYS392', 'SRY', 'DYS391', 'AMEL', 'Rs2032678'], ['A-1', '8', '-', '', '12', '1', '10', 'XY', 'A/T']]);
  assert.deepEqual(p.strData.TH01, ['8', '8']);
  for (const name of ['DYS391', 'DYS392', 'SRY']) assert.equal(p.strData[name].length, 1);
  assert.deepEqual(p.strData.AMEL, ['X', 'Y']);
  assert.deepEqual(p.strData.D5S818, []);
  assert.deepEqual(p.strData.Rs2032678, ['A', 'T']);
  await assert.rejects(parse([['Объект', 'TH01', 'D5S818', 'Rs2032678'], ['A-1', '7,9', '11,12', 'Q']]), /Недопустим/);
  const detector = new LociTypeDetector();
  assert.equal(detector.getCanonicalLocusName('RS771783753'), 'Rs771783753');
});

test('Дубликат Объекта обнаруживается до записи, с номерами обеих строк', async () => {
  await assert.rejects(parse([standard[0], standard[1], [], ['A-2', '7,9', '11,12', '29,30'], [' a-1 ', '7,9', '11,12', '29,30']]), error => {
    assert.equal(error.code, 'INTERNAL_DUPLICATES');
    assert.equal(error.details.internalDuplicates[0].firstRow, 2);
    assert.equal(error.details.internalDuplicates[0].duplicateRow, 5);
    assert.match(error.message, /объекта/);
    return true;
  });
});

test('Смена активного отделения и bulkUpload не заменяют его основным', async t => {
  const departments = [{ id: 'emergency', organization_id: 'org', name: 'ЧС' }, { id: 'genetic', organization_id: 'org', name: 'Генетические экспертизы' }];
  t.mock.method(User, 'findById', async () => ({ department_id: 'emergency', role: 'admin', can_upload_without_task: true, getAccessibleDepartments: async () => departments }));
  t.mock.method(DNAProfile, 'checkExistingProfiles', async (userId, profiles) => profiles.map(() => ({ action: 'create' })));
  t.mock.method(DNAProfile, 'batchInsert', async profiles => profiles.map(p => new DNAProfile(p)));
  const context = { userId: 'tester', departmentId: 'genetic' };
  const result = await excel.parseExcelFileWithContext(workbook(standard), 'genetic.xlsx', context);
  assert.equal(result.profiles[0].departmentId, 'genetic');
  assert.equal(result.metadata.importFormat, 'genetic');
  const uploaded = await excel.bulkUploadWithContext(workbook(standard), 'genetic.xlsx', context, { compareMasterArray: false });
  assert.equal(uploaded.department, 'genetic');
  assert.equal(uploaded.processing.created[0].profile.year, null);
  assert.equal(uploaded.processing.created[0].profile.departmentId, 'genetic');
  await assert.rejects(excel.parseExcelFileWithContext(workbook(standard), 'genetic.xlsx', { ...context, departmentId: 'emergency' }), /Год|год/);
  await assert.rejects(excel.parseExcelFileWithContext(workbook(standard), 'genetic.xlsx', { ...context, departmentId: 'forbidden' }), /Нет доступа/);
  assert.equal(resolveProfileImportFormat(departments[0]), 'emergency');
});

test('Старый ЧС mapping, год и служебные поля сохраняются', async () => {
  const headers = ['№ присвоенный в в/ч № 522 ЦПООП Северо-Кавказского военного округа, г. Ростов-на-Дону', 'Привоз', 'Год', 'Sample Name', 'D3S1358', 'vWA', 'D16S539', 'Yindel', 'AMEL'];
  const rows = [headers, ['Я9700', 7, 2024, '110-1', '15,18', '18,18', '9,11', '2', 'XY']];
  const [profile] = await excel.parseExcelFile(workbook(rows), 'emergency.xlsx', { importFormat: 'emergency' });
  assert.equal(profile.sampleName, 'Я9700');
  assert.equal(profile.internalNumber, '110-1');
  assert.equal(profile.year, 2024);
  assert.equal(String(profile.importNumber), '7');
  assert.deepEqual(profile.strData.D3S1358, ['15', '18']);
  assert.equal(validation.validateFile(workbook(rows), 'emergency.xlsx', { importFormat: 'emergency' }).valid, true);
  rows[0][0] = rows[0][0].replace(/^№ /, '');
  rows[0][3] = 'Наименование образца';
  assert.equal(validation.validateFile(workbook(rows), 'emergency.xlsx', { importFormat: 'emergency' }).valid, true);
  assert.equal(validation.validateFile(workbook(standard), 'genetic.xlsx', { importFormat: 'emergency' }).valid, false);
  rows[1][2] = null;
  await assert.rejects(excel.parseExcelFile(workbook(rows), 'emergency.xlsx', { importFormat: 'emergency' }), /Год|год/);
});

test('Модель разрешает NULL-год только genetic-профилю с организационным scope', () => {
  assert.throws(() => DNAProfile.validateImportFields({ sampleName: 'A-1' }), /Год обязателен/);
  assert.throws(() => DNAProfile.validateImportFields({ importFormat: 'genetic', sampleName: 'A-1' }), /активное отделение/);
  assert.doesNotThrow(() => DNAProfile.validateImportFields({ importFormat: 'genetic', sampleName: 'A', internalNumber: 'A-1', departmentId: 'dept', organizationId: 'org', strData: { TH01: ['7', '9'] } }));
});

test('Конкурентный конфликт записи возвращает понятную русскую ошибку', async t => {
  t.mock.method(DNAProfile, 'checkExistingProfiles', async () => [{ action: 'create' }]);
  t.mock.method(DNAProfile, 'batchInsert', async () => {
    throw Object.assign(new Error('raw SQL error'), { code: '23505', constraint: 'idx_dna_profiles_genetic_object' });
  });
  const [profile] = await parse(standard);
  await assert.rejects(excel.processProfilesWithContext([profile], { userId: 'tester', departmentId: 'dept', organizationId: 'org' }, { compareMasterArray: false }), error => error.code === 'OBJECT_CONFLICT' && /Объект уже загружен/.test(error.message));
});

test('Реальный алгоритм сравнивает локусы по именам при разном порядке колонок', async () => {
  const { DNAAnalysisService } = require('../src/services/dnaAnalysisService');
  const [a] = await parse(standard);
  const [b] = await parse([['Объект', 'D21S11', 'D5S818', 'TH01'], ['A-2', '29,30', '11,12', '7,9']]);
  const analysis = new DNAAnalysisService({ enableBayesianAnalysis: false });
  const result = await analysis.compareProfiles({ ...a, id: 'a' }, { ...b, id: 'b' }, { enableBayesianAnalysis: false, minNumericMatches: 3 });
  assert.equal(result.numericMatchCount, 3);
  assert.equal(result.overallMatch, 100);
});

module.exports = { workbook, standard };
