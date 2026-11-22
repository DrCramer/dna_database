const test=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const {prepareLocusData,isExactLocusMatch}=require('../src/utils/exactLocusComparison');
const duplicates=require('../src/services/profiles/duplicateDetectionService');
const {getLocusComparisonPresentation}=require('../src/utils/locusComparisonPresentation');
const {runProfileSearch}=require('../src/services/profiles/searchWorkerExecutor');
const {DuplicateExcelExportService}=require('../src/services/audit/duplicateExcelExportService');
const loci=['TH01','D3S1358','D5S818','D21S11','vWA','FGA','D13S317','D7S820','D16S539','CSF1PO','TPOX','D8S1179','D18S51','D2S441','D19S433'];
const known=Object.fromEntries(loci.map(locus=>[locus,['12','12']]));
const profile=(id,str_data)=>({id,internal_number:id,sample_name:'SYN',year:2026,str_data});
const thresholds={minLoci:1,minScore:1,minPercentage:80};
test('Спецтокены и известная аллель с неизвестной второй не становятся подтверждённой парой',()=>{
 for(const token of ['*','**','***','?','OL','O.L.','Off Ladder','F','12?','12*']){
  for(const raw of [[token],['12',token],{allele1:'12',allele2:token},'12,'+token]){
   const prepared=prepareLocusData(raw);assert.equal(prepared.exactComparable,false);
   assert.equal(isExactLocusMatch(prepared,prepareLocusData(['12','12'])),false);
   const result=duplicates.calculateDuplicateSimilarity({TH01:raw},{TH01:['12','12']});
   assert.equal(result.totalScore,0);assert.equal(result.comparedLociCount,0);assert.equal(result.details.TH01.status,'no_call');
   assert.equal(duplicates.isDuplicate(result,{minLoci:0,minScore:0,minPercentage:0}),false);
   const shown=getLocusComparisonPresentation({referenceData:raw,comparedData:['12','12'],locus:'TH01',details:{TH01:{status:'match'}}});
   assert.equal(shown.status,'no_data');assert.equal(shown.backgroundColor,null);assert(shown.alleles.every(allele=>!allele.matched));
  }
  const fast=duplicates.calculateDuplicateSimilarityOptimized({TH01:['12',token]},{TH01:['12','12']},{thresholds});
  assert.equal(fast.totalScore,0);assert.equal(fast.comparedLociCount,0);assert.equal(duplicates.isDuplicateOptimized(fast,thresholds),false);
 }
 assert.equal(isExactLocusMatch(prepareLocusData(['12']),prepareLocusData(['12','12'])),true);
 assert.equal(getLocusComparisonPresentation({referenceData:['12'],comparedData:['12','12'],locus:'TH01'}).status,'full');
});
test('Ни прямой, ни кэшированный v5 не набирает минимум на пустых локусах',()=>{
 const a={...Object.fromEntries(loci.map(locus=>[locus,['*']])),D6S1043:['12','12']},b={...known,D6S1043:['12','12']};
 const before=structuredClone([a,b]),settings={thresholds:{minLoci:15,minScore:1,minPercentage:80}};
 for(const result of [duplicates.calculateDuplicateSimilarity(a,b,settings),duplicates.calculateDuplicateSimilarityOptimized(a,b,settings),duplicates.createDuplicateSimilarityComparator(settings)(a,b)]){
  assert(result.comparedLociCount<=1);assert.equal(duplicates.isDuplicate(result,settings.thresholds),false);
 }
 const control={...known,D6S1043:['12','*']},compare={...known,D6S1043:['12','13']};
 const valid=duplicates.createDuplicateSimilarityComparator({thresholds:{minLoci:15,minScore:15,minPercentage:80}})(control,compare);
 assert.equal(valid.comparedLociCount,15);assert.equal(valid.totalScore,15);assert.equal(valid.details.D6S1043.status,'no_call');
 assert.deepEqual([a,b],before);
});
test('Задачи, мастер-массив и отдел: одинаковый допуск с индексом и без, в одном и нескольких потоках',async()=>{
 const uncertain=Object.fromEntries(loci.map(locus=>[locus,['12','*']]));
 const refs=[profile('SYN-empty',Object.fromEntries(loci.map(locus=>[locus,['*']]))),profile('SYN-partial',uncertain),profile('SYN-full',known)];
 const candidates=[profile('SYN-control',known),...Array.from({length:39},(_,i)=>profile('SYN-unknown-'+i,uncertain))];
 for(const comparisonAlgorithm of ['standard','duplicate_v5'])for(const searchMode of ['task','workspace_master','department_tasks']){
  let expected;
  for(const useWorkers of [false,true])for(const useCandidateIndex of [false,true]){
   const input={referenceProfiles:refs,compareProfiles:candidates,minMatches:15,searchMode,comparisonAlgorithm,useCandidateIndex,duplicateSettings:{minLoci:15,minScore:15,minPercentage:80}};
   const before=structuredClone(input),result=await runProfileSearch(input,{useWorkers,minParallelComparisons:0});
   assert.equal(result.results.length,1);assert.equal(result.results[0].reference.id,'SYN-full');
   assert.deepEqual(result.results[0].matches.map(match=>match.id),['SYN-control']);
   if(!expected)expected=result.results;else assert.deepEqual(result.results,expected);
   assert.deepEqual(input,before);
  }
 }
});
test('Bayesian legacy: пустые и неопределённые пары не совпадают и не повышают вероятность',async()=>{
 const Finder=require('../src/services/bayesian/DuplicateFinder'),finder=new Finder({calculateProfileLR:async()=>({overallLR:1})},{getParameter:async()=>0.95});
 const population={locusFrequencies:new Map()};
 finder.getPopulationData=async()=>population;
 for(const raw of [['*'],['**'],['?'],['OL'],['12','*'],['12','?'],[]]){
  const a=profile('SYN-a',{TH01:raw}),b=profile('SYN-b',{TH01:raw}),before=structuredClone([a,b]);
  assert.equal(finder.compareAlleles(raw,raw),false);assert.equal(finder.hasPartialMatch(raw,raw),false);
  assert.equal(finder.countMatchingLoci(a,b).matchingLoci,0);
  assert.equal(await finder.calculateMatchProbability(a,b,population),0);
  assert.deepEqual(await finder.searchDuplicates(a,[b],0),[]);
  assert.deepEqual([a,b],before);
 }
 assert.equal(finder.compareAlleles(['12','13'],['13','12']),true);
});
test('XLSX сохраняет исходные звёздочки на листе профилей и скрывает неопределённый локус из сравнений',async()=>{
 const a=profile('00000000-0000-4000-8000-000000000001',{...known,TH01:['12','*'],D6S1043:['12','12']}),b=profile('00000000-0000-4000-8000-000000000002',{...known,D6S1043:['12','12']});
 const original=structuredClone([a,b]),buffer=await new DuplicateExcelExportService().createWorkbookBuffer({comparisons:[{reference:a,matched:b,algorithm:'duplicate_v5',details:{TH01:{status:'match'}}}],metadata:{importFormat:'genetic'}});
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);const sheet=book.getWorksheet('Сравнения'),headers=sheet.getRow(1).values,count=headers.indexOf('Совпавшие локусы');
 assert.equal(Number(sheet.getRow(3).getCell(count).value),15);
 assert(!headers.includes('TH01'));
 const profiles=book.getWorksheet('Профили'),locus=profiles.getRow(1).values.indexOf('TH01');
 assert.equal(profiles.getRow(2).getCell(locus).value,'12,*');
 assert.deepEqual([a,b],original);
});
