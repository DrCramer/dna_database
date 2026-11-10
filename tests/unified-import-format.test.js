const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const {
  createImportWorkbook
} = require('../src/utils/importWorkbook');
const {
  FORMAT,
  validateObject,
  analysisHash,
  businessKey
} = require('../src/utils/objectImportV2');
const {
  parseFiles
} = require('../src/services/workspace/importSourceService');
const profile = {
  objectNumber: '258-11x',
  year: 2026,
  expertiseType: 'ug',
  fullName: '',
  comment: '=Осторожно + формула',
  strData: {
    TH01: ['7'],
    D5S818: ['11', '11'],
    D21S11: ['30', '*', '?', '32.2'],
    DYS391: ['10', '10'],
    SRY: ['SRY'],
    AMEL: ['X', 'Y']
  },
  provenance: {
    table: 'dna_profiles',
    id: 'untrusted-source-id',
    importNumber: 'legacy',
    sourceObjectNumber: '258-11x'
  }
};
test('V2 XLSX сохраняет одиночные, пары, смеси, спецтокены, staff и пустые генотипы без нормализации', () => {
  const staff = {
      ...profile,
      objectNumber: '00870-G',
      expertiseType: 'staff',
      fullName: 'Тестов Тест Тестович'
    },
    empty = {
      ...profile,
      objectNumber: 'EMPTY',
      strData: {}
    };
  const buffer = createImportWorkbook({
    profiles: [profile, staff, empty],
    loci: Object.keys(profile.strData),
    sourceFormat: FORMAT
  });
  const book = XLSX.read(buffer, {
    type: 'buffer'
  });
  assert.equal(book.SheetNames.length, 1);
  assert.equal(book.Sheets[book.SheetNames[0]].E2.t, 's');
  assert.equal(book.Sheets[book.SheetNames[0]].E2.v, profile.comment);
  assert.equal(book.Sheets[book.SheetNames[0]].E2.f, undefined);
  const result = parseFiles([{
    originalname: 'SYN.xlsx',
    buffer
  }]);
  assert.equal(result.rows.length, 3);
  for (const [i, p] of [profile, staff, empty].entries()) {
    const row = result.rows[i];
    assert.deepEqual(row.strData, p.strData);
    assert.equal(row.objectNumber, p.objectNumber);
    assert.equal(row.year, p.year);
    assert.equal(row.expertiseType, p.expertiseType);
    assert.equal(row.comment, p.comment);
    assert.equal(row.fullName, p.fullName);
    assert.equal(row.sourceIssues.length, 0);
    assert.equal(validateObject(row).length, 0);
  }
  assert.equal(result.rows[0].provenance.id, 'untrusted-source-id');
});
test('Стабильная идентичность различает тип и год; хеш не зависит от порядка ключей и комментария', () => {
  assert.notEqual(businessKey(profile), businessKey({
    ...profile,
    expertiseType: 'gr'
  }));
  assert.notEqual(businessKey(profile), businessKey({
    ...profile,
    year: 2025
  }));
  assert.equal(analysisHash(profile), analysisHash({
    ...profile,
    comment: 'иной',
    strData: Object.fromEntries(Object.entries(profile.strData).reverse())
  }));
  assert.notEqual(analysisHash(profile), analysisHash({
    ...profile,
    objectNumber: 'OTHER'
  }));
});
test('Пустой GeneMapper Sample доступен, контроли исключены; повреждённые аллели остаются ошибками', () => {
  const buffer = Buffer.from('Sample Name\tSample Type\tMarker\tAllele 1\tAllele 2\nEMPTY\tSample\tTH01\t\t\nNC\tNegative Control\tTH01\t\t\nBAD\tSample\tTH01\tnot-an-allele\t\n');
  const {
    rows
  } = parseFiles([{
    originalname: 'SYN.txt',
    buffer
  }]);
  assert.equal(rows[0].included, true);
  assert.deepEqual(rows[0].strData.TH01, []);
  assert.equal(rows[1].included, false);
  assert(rows[2].sourceIssues.length > 0);
});
test('Metadata-only таблица поддерживается; несогласованные № объекта и № рег. требуют исправления', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Объект', 'Год', 'Тип экспертизы', '№ рег.', 'ФИО'], ['870-G', 2026, 'staff', '871-G', 'SYN']]), 'Импорт');
  const row = parseFiles([{
    originalname: 'SYN.xlsx',
    buffer: XLSX.write(book, {
      type: 'buffer',
      bookType: 'xlsx'
    })
  }]).rows[0];
  assert(validateObject(row).some(x => x.code === 'REGISTRATION_CONFLICT'));
  assert.deepEqual(row.strData, {});
});
test('Неизвестный локус с данными не превращается в допустимый пустой профиль', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Объект', 'Год', 'Тип экспертизы', 'D21S1I'], ['SYN', 2026, 'ug', '30,31']]), 'Импорт');
  const row = parseFiles([{
    originalname: 'SYN.xlsx',
    buffer: XLSX.write(book, {
      type: 'buffer',
      bookType: 'xlsx'
    })
  }]).rows[0];
  assert(row.sourceIssues.some(issue => issue.code === 'UNKNOWN_COLUMN'));
});
test('Повторная выгрузка provenance не вкладывает полный предыдущий XLSX JSON в себя', () => {
  let current = profile;
  for (let index = 0; index < 4; index++) {
    const buffer = createImportWorkbook({
      profiles: [current],
      loci: Object.keys(current.strData),
      sourceFormat: FORMAT
    });
    current = parseFiles([{
      originalname: 'SYN-roundtrip.xlsx',
      buffer
    }]).rows[0];
    assert.deepEqual(current.strData, profile.strData);
    assert.equal(current.provenance.table, 'dna_profiles');
    assert(JSON.stringify(current.provenance).length < 3000);
  }
});
test('Staff XLSX columns map full names and registration aliases without an Object column', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ФИО сотрудника', 'Регистрационный номер', 'Год исследования', 'Категория', 'TH01', 'D21S11'], ['Тестов Т. Т.', '00870-G', 2026, 'Сотрудник', '7,9.3', '30,31']]), 'Сотрудники');
  const filename = 'Сотрудники_2.xlsx';
  const parsed = parseFiles([{
    originalname: Buffer.from(filename, 'utf8').toString('latin1'),
    buffer: XLSX.write(book, {
      type: 'buffer',
      bookType: 'xlsx'
    })
  }]);
  const row = parsed.rows[0];
  assert.equal(row.objectNumber, '00870-G');
  assert.equal(row.registrationNumber, '00870-G');
  assert.equal(row.fullName, 'Тестов Т. Т.');
  assert.equal(row.expertiseType, 'staff');
  assert.equal(row.sourceFilename, filename);
  assert.equal(parsed.checksums[0].filename, filename);
  assert.deepEqual(row.strData.TH01, ['7', '9.3']);
  assert.deepEqual(row.sourceIssues, []);
  assert.deepEqual(validateObject(row), []);
});
test('Name-only staff source stays unclassified and without an invented registration', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ФИО сотрудника', 'TH01'], ['Тестова Т. Т.', '7,7']]), 'Лист');
  const row = parseFiles([{
    originalname: 'SYN.xlsx',
    buffer: XLSX.write(book, {
      type: 'buffer',
      bookType: 'xlsx'
    })
  }]).rows[0];
  assert.equal(row.fullName, 'Тестова Т. Т.');
  assert.equal(row.objectNumber, '');
  assert.equal(row.expertiseType, null);
  assert.deepEqual(row.strData.TH01, ['7', '7']);
  assert.equal(row.sourceIssues.length, 0);
});
test('Conflicting staff name columns remain a visible error; names in Object are not moved silently', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Объект', 'Год', 'Тип экспертизы', 'ФИО', 'ФИО сотрудника', 'TH01'], ['Тестов Т. Т.', 2026, 'staff', 'Один О. О.', 'Другой Д. Д.', '7,7']]), 'Лист');
  const row = parseFiles([{
    originalname: 'SYN.xlsx',
    buffer: XLSX.write(book, {
      type: 'buffer',
      bookType: 'xlsx'
    })
  }]).rows[0];
  assert.equal(row.objectNumber, 'Тестов Т. Т.');
  assert(row.sourceIssues.some(issue => issue.code === 'METADATA_COLUMN_CONFLICT'));
  assert.equal(row.provenance.sourceObjectNumber, 'Тестов Т. Т.');
});
test('Controls in name-only staff tables are not enabled by changing expertise type', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ФИО сотрудника', 'TH01'], ['PC', '7,7']]), 'Лист');
  const row = parseFiles([{
    originalname: 'SYN.xlsx',
    buffer: XLSX.write(book, {
      type: 'buffer',
      bookType: 'xlsx'
    })
  }]).rows[0];
  assert.equal(row.included, false);
  assert(row.sourceIssues.some(issue => issue.code === 'CONTROL'));
});
