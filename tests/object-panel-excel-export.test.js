const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { panels, allLociPanel } = require('../src/data/objectExportPanels.json');
const { createObjectPanelWorkbook } = require('../src/services/converters/objectPanelExcelExport');

async function openSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 1);
  return workbook.worksheets[0];
}

test('Один лист на объект, блок на панель и исходный порядок локусов', async () => {
  const object = {
    internal_number: '0001-3', sample_name: 'Другой номер',
    str_data: { TH01: ['6', '9.3'], 'Penta_E': ['10', '12', '14'], TPOX: ['08'], D3S1358: '12,*', vWA: { a1: 15, a2: '16?' } }
  };
  const at = new Date('2026-10-28T22:00:00Z');
  const single = await createObjectPanelWorkbook(object, 'A29+', at);
  assert.equal(single.filename, '0001-3_A29.xlsx');
  const multiple = await createObjectPanelWorkbook(object, ['A29+', 'GlobalFiler'], at);
  assert.equal(multiple.filename, '0001-3_29-10-26.xlsx');
  const sheet = await openSheet(multiple.buffer);
  assert.equal(sheet.name, object.internal_number);
  assert.equal(sheet.getCell('A1').value, 'A29+');
  assert.equal(sheet.getCell('B2').value, 'Genotype');
  assert.equal(sheet.getCell('B2').fill.fgColor.argb, 'FF4361EE');
  const exported = Object.fromEntries(panels['A29+'].map((locus, index) => {
    assert.equal(sheet.getCell(index + 3, 1).value, locus);
    return [locus, sheet.getCell(index + 3, 2).value];
  }));
  assert.equal(exported.THO1, '6,9.3');
  assert.equal(exported['Penta E'], '10,12,14');
  assert.equal(exported.TPOX, '08');
  assert.equal(exported.vWA, '15,16?');
  assert.equal(exported.D3S1358, '12,*');
  assert.equal(exported.D21S11, '-');
  assert.equal(sheet.getCell(3 + panels['A29+'].length, 1).value, null);
  assert.equal(sheet.getCell(4 + panels['A29+'].length, 1).value, 'GlobalFiler');
});

test('Все локусы сохраняют исходные значения и записывают строки как текст', async () => {
  const { filename, buffer } = await createObjectPanelWorkbook({
    internal_number: '001/2', str_data: { DYS385: ['13', '15'], DYS391: ['10'], CD_TEST: '=1+2' }
  }, allLociPanel);
  const sheet = await openSheet(buffer);
  assert.equal(filename, '001_2_Все локусы объекта.xlsx');
  assert.equal(sheet.name, '001_2');
  assert.equal(sheet.getCell('B3').value, '13,15');
  assert.equal(sheet.getCell('B4').value, '10');
  assert.equal(sheet.getCell('B5').value, '=1+2');
  assert.equal(sheet.getCell('B5').type, ExcelJS.ValueType.String);
});

test('Неизвестные панели и неоднозначное сопоставление локуса возвращают ошибки', async () => {
  const object = { str_data: { TH01: ['6'], THO1: ['7'] } };
  for (const invalid of [undefined, [], ['__proto__'], ['A29+', 'A29+'], { name: 'A29+' }]) {
    await assert.rejects(createObjectPanelWorkbook(object, invalid), { status: 400 });
  }
  await assert.rejects(createObjectPanelWorkbook(object, 'A29+'), { status: 409 });
  assert(await createObjectPanelWorkbook(object, allLociPanel));
  await assert.rejects(createObjectPanelWorkbook({ str_data: { TH01: '1'.repeat(32768) } }, 'A29+'), { status: 422 });
});
