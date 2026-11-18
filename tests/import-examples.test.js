const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { getImportExamplesArchive } = require('../src/services/workspace/importExamples');
const { parseFiles } = require('../src/services/workspace/importSourceService');
const { validateObject } = require('../src/utils/objectImportV2');
const { GeneticExcelConverterService } = require('../src/services/converters/geneticExcelConverterService');

test('Generated import examples have Russian names and work with the normal import and converter', async () => {
  const [archive, sameArchive] = await Promise.all([getImportExamplesArchive(), getImportExamplesArchive()]);
  assert.equal(sameArchive, archive);
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  const chs = '01_пример_ЧС.xlsx';
  const ug = '02_пример_УГ.xlsx';
  const gr = '03_пример_ГР.xlsx';
  const staff = '04_пример_сотрудники.xlsx';
  const gm = '05_пример_выгрузка_из_GeneMapper.txt';
  const astr = '06_пример_ASTR.xlsx';
  const names = [chs, ug, gr, staff, gm, astr];
  assert.deepEqual(Object.keys(zip.files).sort(), [...names, 'README.txt'].sort());

  const files = await Promise.all(names.map(async name => ({
    originalname: Buffer.from(name, 'utf8').toString('latin1'),
    buffer: await zip.file(name).async('nodebuffer')
  })));
  const { rows } = parseFiles(files);
  const from = name => rows.filter(row => row.sourceFilename === name);
  assert.deepEqual(names.map(name => from(name).length), [1, 3, 1, 2, 2, 1]);
  assert.equal(from(chs)[0].assignedNumber, 'DEMO-VCH-001');
  assert.equal(from(gr)[0].expertiseType, 'gr');
  const [first, same, different] = from(ug);
  assert.deepEqual(first.strData, same.strData);
  assert.notDeepEqual(first.strData, different.strData);

  const employees = from(staff);
  assert.deepEqual(employees.map(row => row.objectNumber), ['00001-G', '']);
  assert(employees.every(row => row.fullName && row.registrationNumber === null));
  assert.deepEqual(employees.map(row => row.comment), [
    'Учебный эталон с регистрационным номером.',
    'Учебный эталон без регистрационного номера.'
  ]);
  const astrNumber = '990001-1';
  const year = 2026;
  for (const row of rows) {
    assert.equal(Object.keys(row.strData).length, 16);
    assert.deepEqual(row.sourceIssues, []);
    assert.deepEqual(validateObject({
      ...row,
      year: row.year ?? year,
      expertiseType: row.expertiseType ?? 'ug',
      objectNumber: row.sourceFilename === astr ? astrNumber : row.objectNumber
    }, { requireAssignedNumber: true }), []);
  }

  const converter = new GeneticExcelConverterService();
  for (const name of [gm, astr]) {
    const file = files[names.indexOf(name)];
    const input = [{ originalname: name, buffer: file.buffer }];
    const preview = converter.convert(input);
    const settings = name === astr ? { year, objectNumber: astrNumber, objectConfirmed: true } : { year };
    const ready = converter.convert(input, { files: { [preview.files[0].id]: settings } });
    assert.equal(name === astr ? ready.canUpload : ready.preparedFiles[0].canUpload, true, name);
  }
});
