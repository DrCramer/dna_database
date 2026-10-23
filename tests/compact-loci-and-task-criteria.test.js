const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { formatExportLocusValue } = require('../src/utils/exportAlleles');
const { createImportWorkbook, MASTER_EXPORT_FORMAT } = require('../src/utils/importWorkbook');
const { prepareMasterExport } = require('../src/services/converters/masterArrayExcelExportService');
const { ExcelService } = require('../src/services/converters/excelService');
const { DuplicateExcelExportService } = require('../src/services/audit/duplicateExcelExportService');
const { runProfileSearch } = require('../src/services/profiles/searchWorkerExecutor');

const compact = ['DYS391', 'Rs771783753', 'rs199815934', 'rs759551978', 'Rs2032678', 'DXS6795'];
test('Экспорт: DYS391, зарегистрированные RS и DXS6795 выводят повтор одной известной аллели один раз', () => {
  for (const locus of compact) {
    assert.equal(formatExportLocusValue(['10','10'], locus), '10');
    assert.equal(formatExportLocusValue(['10'], locus), '10');
    assert.equal(formatExportLocusValue(['10','11'], locus), '10,11');
    assert.equal(formatExportLocusValue(['?','?'], locus), '?,?');
    assert.equal(formatExportLocusValue(['10','?'], locus), '10,?');
    assert.equal(formatExportLocusValue(['10','10','11'], locus), '10,10,11');
  }
  assert.equal(formatExportLocusValue(['10','10'], 'TH01'), '10,10');
  assert.equal(formatExportLocusValue(['10','10'], 'DYS576'), '10,10');
  assert.equal(formatExportLocusValue(['10 11'], 'DYS391'), '10 11', 'выгрузка не исправляет исходный генотип');
});

test('Настоящий импортный XLSX: компактная запись, текстовый тип, штатный импорт и неизменность источника', async () => {
  const strData = { TH01:['8','8'], DYS391:['10','10'], Rs771783753:['1','1'], DXS6795:['12','12'], Rs2032678:['A','G'] };
  const source = [{ id:'one',year:2026,internal_number:'258-1',sample_name:'258',str_data:strData }];
  const before=structuredClone(source);
  const prepared=prepareMasterExport(source,'genetic'); assert.equal(prepared.summary.exportable,1);
  const buffer=createImportWorkbook({ profiles:prepared.profiles,loci:prepared.loci,sourceFormat:MASTER_EXPORT_FORMAT });
  const sheet=XLSX.read(buffer,{cellStyles:true}).Sheets['Импорт'];
  const headers=XLSX.utils.sheet_to_json(sheet,{header:1})[0];
  for(const [locus,value] of Object.entries({ TH01:'8,8',DYS391:'10',Rs771783753:'1',DXS6795:'12',Rs2032678:'A,G' })) {
    const cell=sheet[XLSX.utils.encode_cell({r:1,c:headers.indexOf(locus)})];
    assert.equal(cell.v,value); assert.equal(cell.t,'s'); assert.equal(cell.z,'@');
  }
  const [parsed]=await new ExcelService().parseExcelFile(buffer,'compact.xlsx',{importFormat:'genetic'});
  assert.deepEqual(parsed.strData,{ TH01:['8','8'],DYS391:['10'],Rs771783753:['1'],DXS6795:['12'],Rs2032678:['A','G'] });
  assert.deepEqual(source,before);
  const invalid=prepareMasterExport([{...source[0],str_data:{...strData,DYS391:['10 11']}}],'genetic');
  assert.equal(invalid.summary.exportable,0);
});

test('Экспорт дубликатов: одиночное значение на листах Профили и Сравнения, включая цветной текст', async () => {
  const reference={id:'a',internal_number:'258-1',year:2026,loci:{TH01:['8','8'],DYS391:['10','10'],Rs771783753:['1','1'],DXS6795:['12','12']}};
  const matched={id:'b',internal_number:'258-2',year:2026,loci:{TH01:['8','8'],DYS391:['10','11'],Rs771783753:['1'],DXS6795:['12','13']}};
  const buffer=await new DuplicateExcelExportService().createWorkbookBuffer({ comparisons:[{reference,matched}],metadata:{importFormat:'genetic'} });
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  for(const name of ['Профили','Сравнения']) {
    const sheet=book.getWorksheet(name), headers=sheet.getRow(1).values;
    const text=(row,locus)=>{const v=sheet.getRow(row).getCell(headers.indexOf(locus)).value;return v?.richText?v.richText.map(run=>run.text).join(''):v;};
    assert.equal(text(2,'DYS391'),'10'); assert.equal(text(2,'Rs771783753'),'1'); assert.equal(text(2,'DXS6795'),'12');
    assert.equal(text(3,'DYS391'),'10,11'); assert.equal(text(3,'DXS6795'),'12,13'); assert.equal(text(3,'TH01'),'8,8');
  }
});

const profile=(id,str_data)=>({id,internal_number:id,str_data});
async function modes(input, verify) {
  for(const searchMode of ['task','department_tasks']) for(const useWorkers of [false,true]) {
    const before=structuredClone(input);
    const result=await runProfileSearch({...input,searchMode},{useWorkers,minParallelComparisons:0});
    verify(result,searchMode); assert.deepEqual(input,before);
  }
}
test('Точное сравнение задач: 10 равно 10,10; гетерозигота, смесь, неизвестная аллель и другой маркер не совпадают', async () => {
  for(const locus of ['TH01',...compact]) {
    const referenceProfiles=[profile('ref',{[locus]:['10']})];
    const compareProfiles=[profile('pair',{[locus]:['10','10']}),profile('het',{[locus]:['10','11']}),profile('mix',{[locus]:['10','11','12']}),profile('unknown',{[locus]:['10','?']}),profile('other',{[locus]:['11']})];
    await modes({referenceProfiles,compareProfiles,minMatches:1}, result=>assert.deepEqual(result.results[0].matches.map(m=>m.id),['pair']));
    await modes({referenceProfiles:[compareProfiles[0]],compareProfiles:referenceProfiles,minMatches:1},result=>assert.deepEqual(result.results[0].matches.map(m=>m.id),['ref']));
  }
});

test('v5: одинаковые пороги внутри и между задачами, minMatches не заменяет minLoci, нулевые пороги не сбрасываются', async () => {
  const referenceProfiles=[profile('ref',{TH01:['10','11'],FGA:['20','21']})];
  const compareProfiles=[profile('other',{TH01:['10','11'],FGA:['20','21']})];
  await modes({referenceProfiles,compareProfiles,minMatches:15,comparisonAlgorithm:'duplicate_v5',duplicateSettings:{minScore:2,minPercentage:100,minLoci:2}},result=>assert.equal(result.results.length,1));
  await modes({referenceProfiles,compareProfiles,comparisonAlgorithm:'duplicate_v5',duplicateSettings:{minScore:0,minPercentage:0,minLoci:2}},result=>assert.equal(result.results.length,1));
  for(const duplicateSettings of [{minScore:3,minPercentage:100,minLoci:2},{minScore:2,minPercentage:100,minLoci:3}]) {
    await modes({referenceProfiles,compareProfiles,minMatches:1,comparisonAlgorithm:'duplicate_v5',duplicateSettings},result=>assert.equal(result.results.length,0));
  }
});

test('v5: сравненные локусы и совпавшие локусы имеют разный счётчик при наличии несовпадения', async () => {
  await modes({referenceProfiles:[profile('ref',{TH01:['10'],FGA:['20']})],compareProfiles:[profile('other',{TH01:['10','10'],FGA:['21']})],minMatches:1,
    comparisonAlgorithm:'duplicate_v5',duplicateSettings:{minScore:0,minPercentage:0,minLoci:2}},(result,mode)=>{
      const match=result.results[0].matches[0];
      assert.equal(mode==='task'?match.matchCount:match.matchingLoci,1);
      assert.equal(mode==='task'?match.comparedLociCount:match.totalLoci,2);
    });
});

test('Контаминация: минимум совпадений обязателен в обоих режимах, высокая оценка не обходит порог', async () => {
  for(const useV5Algorithm of [false,true]) {
    const input={referenceProfiles:[profile('ref',{TH01:['10','11']})],compareProfiles:[profile('other',{TH01:['10','11']})],comparisonAlgorithm:'contamination',useV5Algorithm};
    await modes({...input,minMatches:2},result=>assert.equal(result.results.length,0));
    await modes({...input,minMatches:1},result=>assert.equal(result.results.length,1));
  }
});
