const test = require('node:test'), assert = require('node:assert/strict'), XLSX = require('xlsx');
const { parseFiles } = require('../src/services/workspace/importSourceService');
const { restoreKnownImportMetadata, restoreImportAmelogenin } = require('../src/utils/workspaceImportMetadata');
const { collectWorkspaceImportIssues, getWorkspaceImportIssueContext, formatImportIssueLocation } = require('../src/utils/workspaceImportIssues');
const { createImportWorkbook, ASSIGNED_HEADER } = require('../src/utils/importWorkbook');
const { FORMAT, validateObject } = require('../src/utils/objectImportV2');
const base = { objectNumber: 'SYN-1', draftRowId: 'SYN-id', included: true, year: 2026, expertiseType: 'chs', assignedNumber: '00001', comment: '', strData: { TH01: ['7','9.3'] }, sourceIssues: [] };
function source(headers, values) {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers,...values]), 'Импорт');
  return { originalname: 'SYN.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) };
}
test('Дополнительные колонки реестра не блокируют ЧС: комментарии видны, все исходные значения переживают V2 round-trip', () => {
  const headers = ['Объект','Год','Тип экспертизы',ASSIGNED_HEADER,'TH01','№ постановления','№ рег РЦСМЭ','RT (Small)','Комментарий (подробное описание объекта)','комментарии'];
  const [row] = parseFiles([source(headers, [['SYN-1',2026,'ЧС','00001','7,9.3','SYN-order','SYN-reg','0.123','SYN подробности','SYN дополнительный']])]).rows;
  assert.deepEqual(row.sourceIssues, []); assert.deepEqual(validateObject(row, { requireAssignedNumber: true }), []);
  assert.equal(row.comment, 'SYN подробности\nSYN дополнительный');
  assert.equal(row.provenance.legacyCells['RT (Small)'], '0.123'); assert.deepEqual(row.strData, base.strData);
  const [again] = parseFiles([{ originalname: 'SYN.xlsx', buffer: createImportWorkbook({profiles:[row],loci:['TH01'],sourceFormat:FORMAT}) }]).rows;
  assert.deepEqual(again.provenance.legacyCells, row.provenance.legacyCells); assert.equal(again.comment, row.comment);
  const [bad] = parseFiles([source(['Объект','Год','Тип экспертизы',ASSIGNED_HEADER,'D21S1I'], [['SYN',2026,'chs','00001','30,31']])]).rows;
  assert(bad.sourceIssues.some(issue => issue.code === 'UNKNOWN_COLUMN' && issue.column === 'D21S1I'));
});
test('Старые черновики обновляют только известную диагностику; пользовательские комментарии и генотипы не меняются', () => {
  const msg = header => 'Неизвестный столбец «'+header+'» с данными. Сопоставьте его в конвертере.';
  const row = { ...base, comment: 'Изменено пользователем', provenance: {legacyColumns:[{header:'RT (Small)',value:'0.123'},{header:'D21S1I',value:'30,31'}]}, sourceIssues:[{code:'UNKNOWN_COLUMN',message:msg('RT (Small)')},{code:'UNKNOWN_COLUMN',message:msg('D21S1I')},{code:'ALLELE_REVIEW',locus:'TH01',message:'Нужно решение'}] };
  const original = structuredClone(row), restored = restoreKnownImportMetadata(row);
  assert.equal(restored.sourceIssues.length, 2); assert(restored.sourceIssues.some(issue => issue.message === msg('D21S1I')));
  assert.deepEqual(restored.strData, row.strData); assert.equal(restored.comment, row.comment); assert.deepEqual(restored.provenance, row.provenance);
  assert.deepEqual(row, original); assert.deepEqual(restoreKnownImportMetadata({...base,sourceIssues:[],provenance:{legacyColumns:[{header:'RT (Small)',value:'SYN'}]}}).sourceIssues,[]);
});
test('Сводка группирует 100 ошибок по уникальным объектам, объединяет все серверные записи строки и ограничивает примеры', () => {
  const rows = Array.from({length:100},(_,i)=>({...base,draftRowId:'SYN-'+i,objectNumber:'SYN-'+i,year:null,assignedNumber:''}));
  const validation = {errors:[{draftRowId:'SYN-0',issues:[{code:'YEAR',message:'Укажите год от 1900 до 2100.'}]},{draftRowId:'SYN-0',issues:[{code:'DUPLICATE_OBJECT',message:'Повтор объекта в выбранных строках.'}]}]};
  const report = collectWorkspaceImportIssues(rows, validation);
  assert.equal(report.rowCount, 100);
  assert.equal(report.groups.find(group=>group.code==='YEAR').rowIds.size,100);
  assert.equal(report.groups.find(group=>group.code==='YEAR').examples.length,3);
  assert.equal(report.byRow.get('SYN-0').filter(issue=>issue.code==='YEAR').length,1);
  assert(report.byRow.get('SYN-0').some(issue=>issue.code==='DUPLICATE_OBJECT'));
  assert.equal(report.groups.find(group=>group.code==='DUPLICATE_OBJECT').rowIds.size,1);
  assert.equal(collectWorkspaceImportIssues(rows.map(row=>({...row,included:false})),validation).rowCount,0);
  assert.equal(collectWorkspaceImportIssues([base],{errors:[{issues:[{code:'EMPTY_SELECTION',message:'Выберите строки.'}]}]}).globalIssues.length,1);
});

test('Excel сохраняет локус, исходное значение и точный адрес даже при смещённой таблице', () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(sheet, [
    ['Объект', 'Год', 'Тип экспертизы', ASSIGNED_HEADER, 'TH01', 'D21S11'],
    ['SYN-1', 2026, 'ЧС', '00001', '9.12', 'SYN_INVALID']
  ], { origin: 'C7' });
  XLSX.utils.book_append_sheet(book, sheet, 'Импорт');
  const [row] = parseFiles([{ originalname: 'SYN.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }]).rows;
  assert.deepEqual(row.sourceLocation, { sheet: 'Импорт', row: 8 });
  assert.deepEqual(row.sourceIssues.filter(issue => issue.code === 'ALLELE_REVIEW').map(({ locus, cell, rawValue }) => [locus, cell, rawValue]),
    [['TH01', 'G8', '9.12'], ['D21S11', 'H8', 'SYN_INVALID']]);
  const report = collectWorkspaceImportIssues([row]);
  assert.equal(report.groups.find(group => group.locus === 'TH01').examples[0].cell, 'G8');
});

test('Обычная загрузка распознаёт варианты заголовка полного номера объекта', () => {
  for (const header of ['Полный номер объекта', ' НОМЕР\nОБЪЕКТА ', '№Объекта', 'SampleName', 'Sample_Name', 'N_препарата', 'Номер образца']) {
    const [row] = parseFiles([source(
      [ASSIGNED_HEADER, header, 'Год', 'Тип экспертизы', 'TH01'],
      [['00001', '0043-57x', 2026, 'ЧС', '7,9.3']]
    )]).rows;
    assert.equal(row.objectNumber, '0043-57x', header);
    assert.equal(row.assignedNumber, '00001', header);
    assert.deepEqual(row.sourceIssues, [], header);
  }
  const [row] = parseFiles([source(
    ['Sample Name', 'Номер объекта', 'Год', 'Тип экспертизы', 'TH01'],
    [['SYN-EXTRACT', 'SYN-CASE-17', 2026, 'УГ', '7,9.3']]
  )]).rows;
  assert.equal(row.objectNumber, 'SYN-CASE-17');
  const [sample] = parseFiles([source(
    ['Sample', 'Sample Name', 'Год', 'Тип экспертизы', 'TH01'],
    [['SYN-EXTRACT', 'SYN-CASE-18', 2026, 'УГ', '7,9.3']]
  )]).rows;
  assert.equal(sample.objectNumber, 'SYN-CASE-18');
});

test('Обычная загрузка находит лист с профилями после обложки и сообщает о неоднозначных листах', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Сводка экспорта']]), 'Описание');
  const sheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(sheet, [
    ['Полный номер объекта', 'Год', 'Тип экспертизы', 'TH01'],
    ['SYN-1', 2026, 'УГ', '9.12']
  ], { origin: 'B4' });
  XLSX.utils.book_append_sheet(book, sheet, 'Профили');
  const parse = () => parseFiles([{ originalname: 'SYN.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }]);
  const [row] = parse().rows;
  assert.equal(row.objectNumber, 'SYN-1');
  assert.deepEqual(row.sourceLocation, { sheet: 'Профили', row: 5 });
  assert.equal(row.sourceIssues[0].cell, 'E5');
  XLSX.utils.book_append_sheet(book, sheet, 'Архив профилей');
  assert.throws(parse, { code: 'IMPORT_SHEET_AMBIGUOUS', message: /«Профили», «Архив профилей».*конвертере/ });
});

test('Ошибка не подставляет номер реестра вместо объекта и указывает строку заголовков', () => {
  const input = source([ASSIGNED_HEADER, 'Привоз', 'TH01', 'D5S818', 'D21S11'], [['00001', '3', '7,9.3', '10,12', '29,30']]);
  assert.throws(() => parseFiles([input]), {
    status: 400,
    code: 'IMPORT_OBJECT_COLUMN_REQUIRED',
    message: /Файл «SYN\.xlsx», лист «Импорт», строка 1: не найден столбец с полным номером объекта.*«Объект»/
  });
});

test('Старый черновик показывает сохранённую строку и значение без угадывания адреса', () => {
  const issue = { code: 'ALLELE_REVIEW', locus: 'TH01', message: 'Нужно решение' };
  const row = { ...base, sourceFilename: 'SYN.xlsx', sourceLocation: { sheet: 'Импорт', row: 314 },
    provenance: { alleleOrigins: [{ locus: 'TH01', raw: '9.12' }] }, sourceIssues: [issue] };
  const context = getWorkspaceImportIssueContext(row, issue);
  assert.equal(formatImportIssueLocation(context, true), 'SYN.xlsx · Импорт · строка 314');
  assert.equal(context.rawValue, '9.12');
  assert.equal(context.cell, undefined);
  const report = collectWorkspaceImportIssues([row]);
  assert.equal(formatImportIssueLocation(report.groups[0].examples[0], true), 'SYN.xlsx · Импорт · строка 314');
  const repeated = { ...row, sourceIssues: ['G314', 'H314'].map(cell => ({ ...issue, cell })) };
  const distinct = collectWorkspaceImportIssues([repeated]);
  assert.equal(distinct.byRow.get(row.draftRowId).length, 2);
  assert.equal(distinct.groups[0].rowIds.size, 1);
});

test('Черновики Excel принимают обе записи AMEL с F и сохраняют исходную ячейку', () => {
  const headers = ['Объект', 'Год', 'Тип экспертизы', ASSIGNED_HEADER, 'AMEL', 'TH01'];
  const cases = [['F,Y', 'Y'], ['FX', 'X'], ['X,F', 'X'], ['X,Y', 'X,Y'], ['XF', 'X'],
    ['XX', 'X,X'], ['XY', 'X,Y'], ['Y,F', 'Y'], ['YF', 'Y'], ['YY', 'Y,Y']];
  const rows = parseFiles([source(headers, cases.map(([raw], index) => [`SYN-${index}`, 2026, 'ЧС', '00001', raw, '7,F']))]).rows;
  assert.deepEqual(rows.map(row => row.strData.AMEL.join(',')), cases.map(([, result]) => result));
  for (const [index, row] of rows.entries()) {
    assert.deepEqual(row.sourceIssues, []);
    assert.deepEqual(validateObject(row, { requireAssignedNumber: true }), []);
    assert.deepEqual(row.strData.TH01, ['7', 'F']);
    assert.equal(row.provenance.alleleOrigins.find(entry => entry.locus === 'AMEL').raw, cases[index][0]);
  }
});

test('В старом черновике исправляется только AMEL с F, без отмены ручного ввода', () => {
  const issues = [
    { code: 'ALLELE_REVIEW', locus: 'AMEL', rawValue: 'FX' },
    { code: 'FORMULA_WITHOUT_RESULT', locus: 'AMEL' },
    { code: 'ALLELE_REVIEW', locus: 'TH01' }
  ];
  const row = { ...base, strData: { AMEL: ['FX'], TH01: ['7', 'F'] }, sourceIssues: issues };
  const restored = restoreImportAmelogenin(row);
  assert.deepEqual(restored.strData, { AMEL: ['X'], TH01: ['7', 'F'] });
  assert.deepEqual(restored.sourceIssues, issues.slice(1));
  assert.deepEqual(row.strData.AMEL, ['FX']);
  const edited = { ...row, provenance: { manualGenotypes: { AMEL: { value: ['FX'] } } } };
  assert.equal(restoreImportAmelogenin(edited), edited);
});

test('При переносе V2 запись AMEL из JSON и столбца сравнивается после нормализации', () => {
  const book = XLSX.utils.book_new();
  book.Custprops = { DNAProfileSourceFormat: FORMAT };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Объект', 'Год', 'Тип экспертизы', 'AMEL', 'TH01', 'Генотип JSON'],
    ['SYN-1', 2026, 'УГ', 'F,X', '7,F', JSON.stringify({ AMEL: ['XF'], TH01: ['7', 'F'] })],
    ['SYN-2', 2026, 'УГ', 'X', '7,F', JSON.stringify({ AMEL: ['YF'], TH01: ['7', 'F'] })],
    ['SYN-3', 2026, 'УГ', 'XY', '7,F', JSON.stringify({ AMEL: ['X', 'Y'], TH01: ['7', 'F'] })]
  ]), 'Импорт');
  const [equivalent, conflict, heterozygote] = parseFiles([{ originalname: 'SYN.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }]).rows;
  assert.deepEqual(equivalent.strData, { AMEL: ['X'], TH01: ['7', 'F'] });
  assert.deepEqual(equivalent.sourceIssues, []);
  assert(conflict.sourceIssues.some(issue => issue.code === 'GENOTYPE_CONFLICT' && issue.locus === 'AMEL'));
  assert.deepEqual(heterozygote.strData.AMEL, ['X', 'Y']);
  assert.deepEqual(heterozygote.sourceIssues, []);
});

test('Перенос V2 принимает дефисы в ячейках локусов и в структуре генотипа', () => {
  const book = XLSX.utils.book_new();
  book.Custprops = { DNAProfileSourceFormat: FORMAT };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Объект', 'Год', 'Тип экспертизы', 'AMEL', 'TH01', 'D8S1179', 'Генотип JSON'],
    ['SYN-1', 2026, 'УГ', '−', '-', '12,−', JSON.stringify({ AMEL: [], TH01: ['‑'], D8S1179: ['12', '?'] })]
  ]), 'Импорт');
  const [row] = parseFiles([{ originalname: 'SYN.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }]).rows;
  assert.deepEqual(row.strData, { AMEL: [], TH01: [], D8S1179: ['12', '?'] });
  assert.deepEqual(row.sourceIssues, []);
  assert.deepEqual(validateObject(row), []);
});
