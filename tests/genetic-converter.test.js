const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { GeneticExcelConverterService } = require('../src/services/geneticExcelConverterService');
const { normalizeAlleleValue: normalize } = require('../src/utils/alleleNormalizer');
const { ALL_LOCI, LociTypeDetector } = require('../src/utils/lociTypeDetector');
const { informativeAlleles } = require('../src/utils/alleleTokens');
const { ExcelService } = require('../src/services/excelService');
const { FileValidationService } = require('../src/services/fileValidationService');
const { GenotypePanel } = require('../src/models/GenotypePanel');
const User = require('../src/models/User');
const converter = new GeneticExcelConverterService();
const detector = new LociTypeDetector();
function file(rows, name = 'old.xlsx', sheets) {
  const book = XLSX.utils.book_new();
  for (const [sheet, values] of sheets || [['Legacy', rows]]) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(values), sheet);
  return { originalname: name, buffer: XLSX.write(book, { type: 'buffer', bookType: name.endsWith('.xls') ? 'biff8' : 'xlsx' }) };
}
const headers = ['Объект', 'TH01', 'D5S818', 'D21S11'];
const values = ['7,9', '11,12', '29,30'];
const standard = [headers, ['258-11x (2)_a', ...values]];

test('Нормализация безопасных разделителей, микроаллелей, AMEL и Y', () => {
  for (const input of ['12 ,13', '12/13', '12;13']) assert.equal(normalize(input, 'TH01').normalizedValue, '12,13');
  for (const input of ['9.3,31.2', '17.3,18']) assert.equal(normalize(input, 'TH01').normalizedValue, input);
  for (const [raw, expected] of [['XY','X,Y'], ['XX','X,X'], ['YY','Y,Y'], ['ХХ','X,X'], ['ХY','X,Y'], ['X,Y','X,Y'], ['X,X','X,X'], ['Y,Y','Y,Y'], ['X','X'], ['Y','Y']]) assert.equal(normalize(raw, 'AMEL').normalizedValue, expected);
  for (const locus of ['DYS392', 'SRY', 'Yindel']) { const n = normalize('12', locus); assert.equal(n.normalizedValue, '12'); assert.equal(n.hard, false); }
  for (const missing of ['', ' ', '-', '—', '–']) assert.deepEqual(normalize(missing, 'TH01').alleles, []);
});

test('Точки и одиночные диплоидные аллели требуют явного решения', () => {
  assert.equal(normalize('11.12', 'TH01').status, 'NEEDS_REVIEW');
  assert.equal(normalize('11.12', 'TH01', { action: 'split_dot' }).normalizedValue, '11,12');
  assert.equal(normalize('11.12', 'TH01', { action: 'keep' }).normalizedValue, '11.12,?');
  const single = normalize('12', 'TH01'); assert.equal(single.status, 'NEEDS_REVIEW'); assert.equal(single.normalizedValue, '12,?');
  assert.equal(normalize('12', 'TH01', { action: 'homozygous' }).normalizedValue, '12,12');
  assert.equal(normalize('12', 'TH01', { action: 'unknown' }).normalizedValue, '12,?');
  assert.equal(normalize('12', 'DYS392', { action: 'homozygous' }).hard, true);
});

test('Спецтокены, Off Ladder, неизвестные слова и многoаллельность', () => {
  for (const raw of ['OL','O.L.','OFF LADDER','OFFLADDER']) { const n = normalize(raw, 'TH01'); assert.equal(n.normalizedValue, '?'); assert(n.events.some(e => e.code === 'OFF_LADDER')); }
  assert.equal(normalize('OL,OL', 'TH01').normalizedValue, '?,?');
  assert.equal(normalize('OL,15', 'TH01').normalizedValue, '?,15');
  for (const raw of ['*','**','?','F']) assert.equal(normalize(raw, 'TH01').hard, false);
  assert.equal(normalize('**', 'TH01').normalizedValue, '*');
  for (const raw of ['ABC','ERROR','xxx']) { assert.equal(normalize(raw, 'TH01').status, 'ERROR'); assert.equal(normalize(raw, 'TH01', { action: 'missing' }).normalizedValue, ''); assert.equal(normalize(raw, 'TH01', { action: 'unknown' }).normalizedValue, '?'); }
  const mixture = normalize('17.3,15,16', 'TH01'); assert.equal(mixture.status, 'WARNING'); assert.deepEqual(mixture.alleles, ['17.3','15','16']);
});

for (const [name, rows, object] of [
  ['A', [[], ['№пп','Локус\nОбъект','D3S1358','vWA','D16S539','DYS392'], [1,'258-11x','12,13','14,15','9,10','12']], '258-11x'],
  ['B', [['Smpl','Sample','AMEL','TH01','D21S11'], ['258-1','258-1','XY','7,9','29,30']], '258-1'],
  ['C', [['Smpl','№п/п','Объект/Локус','TH01','D5S818','D21S11'], ['258-2',1,'258-2',...values]], '258-2'],
  ['D', [['N_препарата','AMEL','TH01','D21S11'], ['258-3','XX','7,9','29,30']], '258-3'],
  ['E', [['SampleName','Penta E','DYS392','SRY','TH01','AMEL','Penta D'], ['258-4','14,15','12','1','7,9','X,Y','11,12']], '258-4']
]) test(`Структура ${name}: заголовки, объект и произвольные локусы`, () => {
  const result = converter.convert([file(rows, `${name}.xls`)]);
  assert.equal(result.canImport, true, JSON.stringify(result.issues));
  assert.equal(result.profiles[0].objectNumber, object);
  assert.equal(result.files[0].headerRow, name === 'A' ? 2 : 1);
});

test('Выбор листа, заголовка и разных колонок объекта; неизвестный локус не угадывается', () => {
  const preferred = file(null, 'preferred.xlsx', [['SBT_HORIZONT', standard], ['Another', standard]]);
  assert.equal(converter.convert([preferred]).files[0].sheet, 'SBT_HORIZONT');
  const ambiguous = file(null, 'multi.xlsx', [['One', standard], ['Two', standard], ['Empty', []]]);
  let result = converter.convert([ambiguous]); assert.equal(result.canImport, false); assert.equal(result.files[0].sheets.length, 2);
  result = converter.convert([ambiguous], { files: { [result.files[0].id]: { sheetName: 'Two' } } }); assert.equal(result.canImport, true);
  const candidates = file([['Sample','Smpl',...headers.slice(1)], ['correct-1','other-1',...values]]);
  result = converter.convert([candidates]); assert.equal(result.files[0].objectColumn, null);
  result = converter.convert([candidates], { files: { [result.files[0].id]: { objectColumn: 0 } } }); assert.equal(result.canImport, true); assert.equal(result.profiles[0].objectNumber, 'correct-1');
  const unknown = file([['Объект','TH01','D5S818','AMEL','D21S1I'], ['A-1','7,9','11,12','XY','29,30']]);
  result = converter.convert([unknown]); assert.equal(result.canImport, false); assert(result.issues.find(i => i.code === 'UNKNOWN_LOCUS').suggestions.includes('D21S11'));
  result = converter.convert([unknown], { files: { [result.files[0].id]: { columns: { 4: { locus: 'D21S11' } } } } }); assert.equal(result.canImport, true);
  assert.equal(result.profiles[0].strData.D21S11.join(','), '29,30');
});

test('Слияние по полному номеру, заполнение специального значения и конфликт без потери источников', () => {
  const a = file([headers, ['258-1','*','11,12','29,30']], 'one.xlsx');
  const b = file([headers, [' 258-1 ','7,9','11,12','29,30'], ['258-11x',...values]], 'two.xlsx');
  const result = converter.convert([a,b]); assert.equal(result.canImport, true); assert.equal(result.profiles.length, 2);
  assert.deepEqual(result.profiles[0].strData.TH01, ['7','9']); assert.equal(result.profiles[0].sources.length, 2);
  assert(result.profiles[0].audit.find(i => i.code === 'MERGE').variants.some(v => v.rawValue === '*'));
  const conflictFile = file([headers, ['258-1','7,9','11,13','29,30']], 'conflict.xlsx');
  let conflict = converter.convert([b,conflictFile]); assert.equal(conflict.canImport, false); assert.equal(conflict.summary.conflicts, 1);
  assert.throws(() => converter.export(conflict), /разрешите/);
  const c = conflict.conflicts[0]; conflict = converter.convert([b,conflictFile], { conflicts: { [c.id]: { sourceId: c.variants[1].id } } });
  assert.equal(conflict.canImport, true); assert.deepEqual(conflict.profiles[0].strData.D5S818, ['11','13']);
});

test('Ручные решения, массовое правило, исправление объекта и исключение строки', () => {
  const old = file([headers, ['A-1','12','11,12','29,30'], ['A-2','12','11,12','29,30'], ['',...values]]);
  let result = converter.convert([old]); const issue = result.issues.find(i => i.code === 'SINGLE_DIPLOID'); const invalid = result.issues.find(i => i.code === 'INVALID_OBJECT');
  const options = { rules: [{ fileId: issue.fileId, code: issue.code, rawValue: '12', locusType: 'STR', decision: { action: 'unknown' } }], objects: { [invalid.id]: 'A-3' } };
  result = converter.convert([old], options); assert.equal(result.canImport, true); assert.equal(result.profiles.length, 3); assert.equal(result.profiles[1].strData.TH01.join(','), '12,?');
  result = converter.convert([old], { ...options, rows: { [invalid.id.replace(/:object$/, '')]: { ignore: true } } }); assert.equal(result.profiles.length, 2); assert(result.issues.some(i => i.code === 'IGNORED_ROW'));
});

test('Roundtrip dirty → converter → ExcelService: типы, каталог, качество, панель и журнал', async t => {
  const input = file([['Локус/Объект','TH01','D5S818','D21S11','AMEL','DYS392','SRY','Yindel'], [' 258-11x (2)_a ','9.3/11','OL,15','29,30,31.2','ХY','12','1','2']]);
  const panel = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Source', lociOrder: ['TH01','D5S818','D21S11','AMEL','DYS392','SRY','Yindel'] };
  const result = converter.convert([input], {}, [panel]); assert.equal(result.canImport, true); assert.equal(result.profiles[0].detectedPanelId, panel.id);
  const buffer = converter.export(result), book = XLSX.read(buffer, { type: 'buffer' });
  assert.deepEqual(book.SheetNames, ['Импорт','Проверка','_DNA_META']);
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['Импорт'], { header: 1 })[0], ['Объект',...ALL_LOCI]);
  assert.equal(new FileValidationService().validateFile(buffer, 'converted.xlsx', { importFormat: 'genetic' }).valid, true);
  const excel = new ExcelService(); const [profile] = await excel.parseExcelFile(buffer, 'converted.xlsx', { importFormat: 'genetic' });
  assert.equal(profile.internalNumber, '258-11x (2)_a');
  for (const locus of result.sourceLoci) assert.deepEqual(profile.strData[locus], result.profiles[0].strData[locus]);
  assert.equal(profile.totalLociCount, 7); assert.equal(Object.keys(profile.strData).length, 7);
  assert.equal(profile.metadata.qualityMetrics.completeness, 100); assert(profile.metadata.conversion.audit.some(i => i.code === 'AMEL'));
  t.mock.method(User, 'findById', async () => ({ role: 'user_analyst', department_id: 'dept', can_upload_without_task: true, getAccessibleDepartments: async () => [{ id: 'dept', name: 'Генетические экспертизы', organization_id: 'org' }] }));
  t.mock.method(GenotypePanel, 'resolveAssignment', async options => { assert.equal(options.detectedPanelId, panel.id); return panel; });
  const context = await excel.parseExcelFileWithContext(buffer, 'converted.xlsx', { userId: 'tester', departmentId: 'dept', uploadTarget: 'without_task' });
  assert.equal(context.profiles[0].panelId, panel.id); assert.deepEqual(context.panelWarnings, []);
  delete book.Sheets._DNA_META; book.SheetNames.pop(); const noMeta = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const [plain] = await excel.parseExcelFile(noMeta, 'plain.xlsx', { importFormat: 'genetic' }); assert.equal(plain.totalLociCount, 7); assert.deepEqual(plain.strData.AMEL, ['X','Y']);
});

test('Поддельные метаданные не скрывают локусы и не меняют scope', async () => {
  const result = converter.convert([file(standard)]), book = XLSX.read(converter.export(result), { type: 'buffer' });
  const { metadataSheet } = require('../src/utils/geneticConversionMetadata');
  book.Sheets._DNA_META = metadataSheet({ profiles: [{ objectNumber: standard[1][0], sourceLoci: ['TH01','D5S818','AMEL'], sources: [], audit: [], detectedPanelId: null }] });
  await assert.rejects(new ExcelService().parseExcelFile(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'forged.xlsx', { importFormat: 'genetic' }), /не соответствуют/);
  assert.throws(() => converter.convert([file(standard)], { rules: {} }), /массовые правила/);
  assert.throws(() => converter.convert([file(standard)], { files: [] }), /настройки/);
});

test('Перестановки всех локусов используют каталог, а не позиции или фиксированное число', () => {
  const value = locus => detector.detectLocusType(locus) === 'AMELOGENIN' ? 'XY' : detector.detectLocusType(locus) === 'Y_CHROMOSOME' || locus === 'Yindel' ? '12' : '12,13';
  const order = [...ALL_LOCI].reverse(); const result = converter.convert([file([['Объект',...order], ['FULL-1',...order.map(value)]])]);
  assert.equal(result.canImport, true, JSON.stringify(result.issues.filter(i => i.hard)));
  for (const locus of ALL_LOCI) assert.equal(result.profiles[0].strData[locus].join(','), locus === 'AMEL' ? 'X,Y' : value(locus));
});

test('Несколько тысяч объектов: независимые Map, сохранность оригинала и полный экспорт', () => {
  const original = file([headers,...Array.from({ length: 2500 }, (_, i) => [`PERF-${i}`, ...values])]); const before = Buffer.from(original.buffer);
  const result = converter.convert([original]); assert.equal(result.profiles.length, 2500); assert.equal(result.canImport, true); assert.deepEqual(original.buffer, before);
  const book = XLSX.read(converter.export(result), { type: 'buffer' }); assert.equal(XLSX.utils.decode_range(book.Sheets['Импорт']['!ref']).e.r, 2500);
});

test('Спецтокены не становятся совпадениями в DNA, Bayesian, дублях и контаминации', async () => {
  const { DNAAnalysisService } = require('../src/services/dnaAnalysisService');
  const Staff = require('../src/services/staffContaminationAnalyzer');
  const { utils, calculateDuplicateSimilarity } = require('../src/services/duplicateDetectionService');
  const { compareLocusObjects } = require('../src/services/duplicateDetectionServiceOptimized');
  const analysis = new DNAAnalysisService({ enableBayesianAnalysis: false });
  assert.deepEqual(informativeAlleles(['*','**','?','F','17?','9.3','12']), ['9.3','12']);
  assert.deepEqual(new Staff().parseAlleles(['*','**','?','F','12']), ['12']);
  for (const special of ['*','**','?','F']) {
    assert.equal(analysis.isNumericAlleleValue(special), false);
    assert.equal(analysis.convertToBayesianFormat({ strData: { TH01: [special] } }).loci.get('TH01').alleles.length, 0);
    assert.equal(utils.parseAlleles(special).size, 0);
    assert.equal(compareLocusObjects([special], [special]).status, 'no_call');
    assert.equal(calculateDuplicateSimilarity({ TH01: special }, { TH01: special }).comparedLociCount, 0);
  }
  const { compareLocusV5 } = require('../src/utils/contaminationAlgorithmV5');
  assert.equal(compareLocusV5(['*','F'], ['*','F'], 'TH01').score, 0);
  assert.equal(compareLocusObjects(['11','12'], ['12','11']).score, 1);
  assert.equal(calculateDuplicateSimilarity({ TH01: '11,12' }, { TH01: '12,11' }).totalScore, 1);
  const ordinary = await analysis.compareProfiles({ id: 'a', strData: { TH01: ['11','12'], D5S818: ['11','12'], D21S11: ['29','30'] } }, { id: 'b', strData: { TH01: ['12','11'], D5S818: ['12','11'], D21S11: ['30','29'] } }, { enableBayesianAnalysis: false });
  assert.equal(ordinary.numericMatchCount, 3);
});

test('Расширение каталога автоматически добавляет пустую колонку экспорта', () => {
  ALL_LOCI.push('FutureSyntheticLocus');
  try { const result = converter.convert([file(standard)]); const book = XLSX.read(converter.export(result), { type: 'buffer' }); const columns = XLSX.utils.sheet_to_json(book.Sheets['Импорт'], { header: 1 })[0]; assert.deepEqual(columns, ['Объект',...ALL_LOCI]); assert.equal(columns.at(-1),'FutureSyntheticLocus'); assert.equal(result.sourceLoci.length,3); }
  finally { ALL_LOCI.pop(); }
});

test('Частичный источник, разные панели объектов и ручное редактирование итоговой ячейки', async t => {
  const one = file([headers, ['P-1','7,9','','29,30']], 'one.xlsx');
  const two = file([['Объект','TH01','D5S818','AMEL'], ['P-2','7,9','11,12','XY']], 'two.xlsx');
  const panels = [{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name:'One', lociOrder:headers.slice(1)}, {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Two',lociOrder:['TH01','D5S818','AMEL']}];
  let result = converter.convert([one,two],{},panels); assert.deepEqual(result.profiles.map(p => p.detectedPanelId),panels.map(p => p.id));
  result = converter.convert([one,two], {conflicts:{'merge:p-1:TH01':{action:'manual',value:'9,10'}}},panels); assert.deepEqual(result.profiles[0].strData.TH01,['9','10']); assert(result.profiles[0].audit.some(i => i.code==='MANUAL_RESULT'));
  const excel = new ExcelService(),buffer = converter.export(result);
  const parsed = await excel.parseExcelFile(buffer,'multiple.xlsx',{importFormat:'genetic'}); assert.equal(parsed[0].totalLociCount,3); assert(Math.abs(parsed[0].metadata.qualityMetrics.completeness-200/3)<1e-8);
  t.mock.method(User,'findById',async()=>({role:'user_analyst',department_id:'dept',can_upload_without_task:true,getAccessibleDepartments:async()=>[{id:'dept',name:'Генетические экспертизы',organization_id:'org'}]}));
  t.mock.method(GenotypePanel,'resolveAssignment',async options=>panels.find(p=>p.id===options.detectedPanelId));
  const context = await excel.parseExcelFileWithContext(buffer,'multiple.xlsx',{userId:'user',departmentId:'dept',uploadTarget:'without_task'}); assert.deepEqual(context.profiles.map(p=>p.panelId),panels.map(p=>p.id));
});

test('Формула без результата и безымянная колонка требуют решения; неоднозначный заголовок не угадывается', () => {
  const old = file([headers,headers,['A-1',...values]]); let result=converter.convert([old]); assert.equal(result.files[0].headerRow,null);
  result=converter.convert([old],{files:{[result.files[0].id]:{headerRow:2}}}); assert.equal(result.canImport,true);
  const book=XLSX.read(file(standard).buffer,{type:'buffer'}); book.Sheets.Legacy.B2={t:'n',f:'1+1'};
  const formula={originalname:'formula.xlsx',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})};
  result=converter.convert([formula]); const issue=result.issues.find(i=>i.code==='FORMULA_WITHOUT_RESULT'); assert(issue?.hard);
  result=converter.convert([formula],{cells:{[issue.id]:{action:'manual',value:'7,9'}}}); assert.equal(result.canImport,true);
  result=converter.convert([file([headers,['A-1',...values,'unexpected']])]); assert(result.issues.some(i=>i.code==='UNKNOWN_LOCUS'));
});

test('Мастер-массив и bulkSearch не принимают специальные значения за совпадения', async () => {
  const names=ALL_LOCI.filter(locus=>detector.detectLocusType(locus)==='STR').slice(0,18);
  const profile={id:'ordinary',sampleName:'synthetic',strData:Object.fromEntries(names.map(locus=>[locus,['11','12']]))};
  const special={id:'special',sampleName:'synthetic-special',strData:Object.fromEntries(names.map(locus=>[locus,['*','F']]))};
  const {DNAAnalysisService}=require('../src/services/dnaAnalysisService'); const engine=new DNAAnalysisService({enableBayesianAnalysis:false});
  const matches=await engine.bulkSearch(profile,[special,{...profile,id:'copy'}],{minNumericMatches:15}); assert.equal(matches.length,1);
  const master=await new ExcelService().compareWithMasterArray(special,[{...special,id:'special-copy'}]); assert.deepEqual(master,[]);
  assert.equal((await new ExcelService().compareWithMasterArray(profile,[{...profile,id:'ordinary-copy'}])).length,1);
});

test('Неполные генотипы исключаются из настоящего LR, обычная формула сохраняется', () => {
  const LR = require('../src/services/bayesian/LRCalculator'); const lr = new LR();
  const frequencies=new Map([['11',0.2],['12',0.3],['*',0.5]]);
  assert(Math.abs(lr.calculateHardyWeinbergProbability(['11','12'],frequencies)-0.12)<1e-10);
  for(const token of ['*','**','?','F']) {
    assert.equal(lr.compareAlleles([token],[token]),false); assert.equal(lr.getAlleleFrequency(token,frequencies),null);
    assert.throws(()=>lr.calculateHardyWeinbergProbability(['11',token],frequencies),/excluded from LR/);
    assert.deepEqual(lr.extractLociData({str_data:{TH01:['11',token]}}).get('TH01').alleles,[]);
  }
  const {DNAAnalysisService}=require('../src/services/dnaAnalysisService');
  assert.deepEqual(new DNAAnalysisService().convertToBayesianFormat({strData:{TH01:['11','?']}}).loci.get('TH01').alleles,[]);
  assert.equal(normalize('1 2','DYS392').hard,true);
});


test('Без метаданных повторно импортируется и профиль с двумя заполненными локусами', async () => {
  const result=converter.convert([file([headers,['SPARSE-1','7,9','','29,30']])]);
  const book=XLSX.read(converter.export(result),{type:'buffer'}); delete book.Sheets._DNA_META; book.SheetNames=book.SheetNames.filter(name=>name!=='_DNA_META');
  const [profile]=await new ExcelService().parseExcelFile(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'no-metadata.xlsx',{importFormat:'genetic'});
  assert.equal(profile.totalLociCount,2); assert.deepEqual(profile.strData.TH01,['7','9']); assert.deepEqual(profile.strData.D21S11,['29','30']);
});
