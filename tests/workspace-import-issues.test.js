const test = require('node:test'), assert = require('node:assert/strict'), XLSX = require('xlsx');
const { parseFiles } = require('../src/services/workspace/importSourceService');
const { restoreKnownImportMetadata } = require('../src/utils/workspaceImportMetadata');
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
