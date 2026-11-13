const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { StaffContaminationExcelExportService } = require('../src/services/audit/staffContaminationExcelExportService');

function fixture() {
  return {
    id: 'SYN-search', parameters: { ignoredLoci: ['FGA'] },
    staff: [{ profileId: 'p', reference: { id: 'p', internal_number: '=SYN()', year: 2026, str_data: {
      TH01: ['12', '12', '13', '?'], D3S1358: ['11', '12', '13'], D21S11: ['30.2', '31'], FGA: ['20'], SRY: ['SRY'], DYS391: ['10', '10'], AMEL: ['*', '**', '?']
    } }, matches: [{ staffId: 's', finalScore: 13.05, detailedMatches: [
      { locus: 'TH01', matchType: 'overInclusiveMix', isFullMatch: false, explainedAlleles: ['12'] },
      { locus: 'D3S1358', isFullMatch: true, explainedAlleles: ['11', '12'] },
      { locus: 'D21S11', matchType: 'mismatch', isFullMatch: false, explainedAlleles: [] },
      { locus: 'FGA', isFullMatch: true, explainedAlleles: ['20'] }
    ] }] }, { profileId: 'no-hit', matches: [] }],
    staffProfiles: [{ id: 's', internal_number: '007-G', full_name: '=SYN employee', year: 2025, str_data: {
      TH01: ['12', '12'], D3S1358: ['11', '12'], D21S11: ['9.3', '10'], FGA: ['20'], SRY: ['SRY'], DYS391: ['10', '10'], AMEL: ['X', 'Y']
    } }, { id: 'unused', internal_number: 'unused', full_name: 'Unused', str_data: { TH01: ['99'] } }]
  };
}
async function exportBook(result, colors) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await new StaffContaminationExcelExportService().createWorkbookBuffer({ result, colors }));
  return workbook;
}
function at(sheet, row, name) { return sheet.getRow(row).getCell(sheet.getRow(1).values.indexOf(name)); }
function underlined(cell) { return (cell.value.richText || []).filter(run => run.font?.underline).map(run => run.text); }

test('XLSX staff сохраняет снимки, цвета, полные счётчики и кратность выделенных аллелей как UI', async () => {
  const result = fixture(), before = structuredClone(result);
  const colors = { fullMatch: '#112233', partialMatch: '#FFEEDD', noMatch: '#ABCDEF', partialMatchAllele: '#123456' };
  const book = await exportBook(result, colors), sheet = book.getWorksheet('Контаминации');
  assert.deepEqual(result, before);
  assert.equal(sheet.rowCount, 3);
  assert.equal(at(sheet, 2, 'Объект / сотрудник').text, '=SYN()');
  assert.equal(at(sheet, 3, 'Объект / сотрудник').text, '=SYN employee');
  assert.equal(at(sheet, 3, '№ регистрации').text, '007-G');
  assert.equal(at(sheet, 3, 'Год').value, 2025);
  assert.equal(at(sheet, 3, 'Оценка').value, 13.05);
  assert.equal(at(sheet, 3, 'Совпавшие локусы').value, 1);
  for (const row of [2, 3]) {
    assert.equal(at(sheet, row, 'TH01').fill.fgColor.argb, 'FFFFEEDD');
    assert.deepEqual(underlined(at(sheet, row, 'TH01')), ['12']);
    assert.equal(at(sheet, row, 'TH01').value.richText[0].font.color.argb, 'FF123456');
    assert.equal(at(sheet, row, 'D3S1358').fill.fgColor.argb, 'FF112233');
    assert.deepEqual(underlined(at(sheet, row, 'D3S1358')), ['11', '12']);
    assert.equal(at(sheet, row, 'DYS391').text, '10,10');
    assert.equal(at(sheet, row, 'SRY').text, 'SRY');
    for (const locus of ['FGA', 'DYS391', 'SRY', 'AMEL']) assert.notEqual(at(sheet, row, locus).fill?.pattern, 'solid');
  }
  assert.equal(at(sheet, 2, 'AMEL').text, '*,**,?');
  assert.equal(at(sheet, 2, 'D21S11').text, '30.2,31');
  assert.equal(at(sheet, 3, 'D21S11').fill.fgColor.argb, 'FFABCDEF');
  assert.equal(at(sheet, 3, 'D3S1358').font.color.argb, 'FFFFFFFF');
  assert.equal(sheet.views[0].xSplit, 3); assert.equal(sheet.views[0].ySplit, 1);
  sheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
  assert.deepEqual(book.worksheets.map(s => s.name), ['Контаминации', 'Обозначения']);
});

test('Экспорт staff включает все страницы, не объединяет разных сотрудников с одинаковыми номерами', async () => {
  const result = fixture(), template = result.staff[0];
  result.staffProfiles = Array.from({ length: 52 }, (_, i) => ({ ...result.staffProfiles[0], id: 'staff-' + i, year: 2025 + i % 2 }));
  result.staff = Array.from({ length: 6 }, (_, i) => ({
    profileId: 'p-' + i, reference: { ...template.reference, id: 'p-' + i, internal_number: 'SYN-' + i },
    matches: result.staffProfiles.map(profile => ({ ...template.matches[0], staffId: profile.id }))
  }));
  const book = await exportBook(result), sheet = book.getWorksheet('Контаминации');
  assert.equal(sheet.rowCount, 1 + 6 * 53);
  assert.equal(at(sheet, sheet.rowCount, 'Роль').text, 'Сотрудник');
  assert.equal(at(sheet, sheet.rowCount, 'Год').value, 2026);
});

test('Старый staff-результат использует свои детали и предупреждение; пустой экспорт отклоняется', async () => {
  const result = fixture();
  delete result.staffProfiles; delete result.staff[0].reference;
  Object.assign(result.staff[0].matches[0].detailedMatches[0], { sampleAlleles: ['12'], staffAlleles: ['12', '13'] });
  const book = await exportBook(result), sheet = book.getWorksheet('Контаминации');
  assert.equal(at(sheet, 2, 'TH01').text, '12');
  assert.equal(at(sheet, 3, 'TH01').text, '12,13');
  assert(book.getWorksheet('Обозначения').getColumn(1).values.includes('Старый результат'));
  await assert.rejects(exportBook({ staff: [{ matches: [] }] }), e => e.status === 400);
});

test('XLSX сотрудников использует собственные исключённые локусы сохранённого поиска', async () => {
  const result = fixture();
  result.parameters.staffOptions = { ignoredLoci: ['TH01'] };
  const sheet = (await exportBook(result)).getWorksheet('Контаминации');
  assert.notEqual(at(sheet, 3, 'TH01').fill?.pattern, 'solid');
  assert.equal(at(sheet, 3, 'FGA').fill.fgColor.argb, 'FF90EE90');
  assert.equal(at(sheet, 3, 'Совпавшие локусы').value, 2);
});

test('Сотрудник без номера выгружается с ФИО и пустым № регистрации, без технического staff_id', async () => {
  const result = fixture();
  result.staffProfiles[0].internal_number = '';
  result.staff[0].matches[0].staffIdentifier = 'workspace-technical-id';
  result.staff[0].reference.internal_number = null;
  result.staff[0].reference.full_name = 'Тестовый И. И.';
  const book = await exportBook(result), sheet = book.getWorksheet('Контаминации');
  assert.equal(at(sheet, 2, 'Объект / сотрудник').text, 'Тестовый И. И.');
  assert.equal(at(sheet, 3, '№ регистрации').text, '');
  assert.equal(at(sheet, 3, 'Объект / сотрудник').text, '=SYN employee');
  assert.equal(at(sheet, 3, 'Совпавшие локусы').value, 1);
});
