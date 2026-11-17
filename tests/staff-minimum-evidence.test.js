const test=require('node:test'),assert=require('node:assert/strict');
const Analyzer=require('../src/services/contamination/staffContaminationAnalyzer');
const {runStaffSearch}=require('../src/services/contamination/staffSearchWorkerExecutor');
const {getAnalysisLoci}=require('../src/utils/analysisLoci');
const baseline=require('./fixtures/staff-search-baseline.json');
const loci=['TH01','D3S1358','D5S818','D21S11','vWA','FGA','D13S317','D7S820'];
const data=Object.fromEntries(loci.map(locus=>[locus,['12','13']]));
const staff={id:'SYN-staff',staff_id:'SYN-control',full_name:'SYN',str_data:{...data,rs199815934:['1']}};
const versions=[{useV4Algorithm:false,useV5Algorithm:false},{useV4Algorithm:true,useV5Algorithm:false},{useV4Algorithm:false,useV5Algorithm:true}];

test('Звёздочки не совпадают; один RS-маркер при остальных пустых STR не достигает минимума ни в одной версии',async()=>{
 for(const version of versions) for(const token of ['*','**','?','OL','F','—']) {
  const sample={id:'SYN-sample',str_data:{...Object.fromEntries(loci.map(locus=>[locus,[token]])),rs199815934:['1']}};
  const before=structuredClone(sample);
  const analyzer=new Analyzer(null,{quiet:true,cacheAlleles:true,optimizeComparisons:true});
  assert.deepEqual(await analyzer.detectStaffContamination(sample,[staff],{...version,threshold:0,minLociMatch:8}),[]);
  assert.deepEqual(await analyzer.detectStaffContamination({...sample,str_data:Object.fromEntries(loci.map(locus=>[locus,[token]]))},[staff],{...version,threshold:0,minLociMatch:1}),[]);
  assert.deepEqual(sample,before);
 }
});
test('Минимум считает разные совпавшие локусы, а не аллели, заполненные маркеры или положительные штрафы',async()=>{
 for(const version of versions) {
  const analyzer=new Analyzer(null,{quiet:true});
  assert.equal((await analyzer.detectStaffContamination({id:'SYN',str_data:data},[staff],{...version,threshold:0,minLociMatch:8})).length,1);
  assert.deepEqual(await analyzer.detectStaffContamination({id:'SYN',str_data:data},[staff],{...version,threshold:0,minLociMatch:9}),[]);
  assert.deepEqual(await analyzer.detectStaffContamination({id:'SYN',str_data:data},[staff],{...version,threshold:0,minLociMatch:8,ignoredLoci:['TH01']}),[]);
  assert.deepEqual(await analyzer.detectStaffContamination({id:'SYN',str_data:{TH01:['12','13']}},[staff],{...version,threshold:0,minLociMatch:2}),[]);
  const aliases={TH01:['12','13'],th01:['12','13']};
  assert.deepEqual(await analyzer.detectStaffContamination({id:'SYN',str_data:aliases},[{...staff,str_data:aliases}],{...version,threshold:0,minLociMatch:2}),[]);
 }
 const analyzer=new Analyzer(null,{quiet:true});
 const mismatched={...data,...Object.fromEntries(loci.slice(1).map(locus=>[locus,['40','41']]))};
 assert.deepEqual(await analyzer.detectStaffContamination({id:'SYN',str_data:data},[{...staff,str_data:mismatched}],{useV5Algorithm:false,useV4Algorithm:true,threshold:0,minLociMatch:8,matchCoefficients:{fullMatch:1,partialMatch:0.4,penalty:10}}),[]);
});
test('Один и тот же минимум действует в прямом, кэшированном и параллельном поиске; неизвестные части не объясняются',async()=>{
 const input={referenceProfiles:[{id:'SYN-sparse',str_data:{TH01:['12','*'],rs199815934:['1']}},{id:'SYN-real',str_data:data}],staffProfiles:[staff],options:{useV4Algorithm:true,useV5Algorithm:false,threshold:5.5,minLociMatch:8}};
 const before=structuredClone(input);
 for(const useWorkers of [false,true]){
  const result=await runStaffSearch(input,{useWorkers,minParallelComparisons:0});
  assert.equal(result.results.find(group=>group.profileId==='SYN-sparse').matches.length,0);
  const matches=result.results.find(group=>group.profileId==='SYN-real').matches;
  assert.equal(matches.length,1);assert.equal(matches[0].matchingLoci.length,8);
  assert(matches[0].detailedMatches.every(detail=>detail.explainedAlleles.every(allele=>allele!=='*')));
 }
 assert.deepEqual(input,before);
});
test('Исторические формулы и оценки v1.5/v4/v5 не меняются: изменён только допуск результата по минимуму',()=>{
 const json=value=>JSON.parse(JSON.stringify(value)),analyzer=new Analyzer(null,{quiet:true});
 let checked=0;
 for(const {input,expected} of baseline.records) for(const group of expected){
  const sample=input.referenceProfiles.find(p=>p.id===group.profileId),excluded=new Set(new Map(input.excludedStaffIds||[]).get(sample.id)||[]);
  const all=getAnalysisLoci([sample,...input.staffProfiles.filter(s=>!excluded.has(s.id))]).filter(locus=>locus!=='gender'&&!(input.options.ignoredLoci||[]).includes(locus));
  const opts={...analyzer.defaultOptions,...input.options};
  for(const match of group.matches){
   const employee=input.staffProfiles.find(p=>p.id===match.staffId);
   const actual=opts.useV5Algorithm?analyzer.analyzeV50(sample.str_data,employee.str_data,employee,all,{locusWeights:opts.locusWeights,matchCoefficients:opts.matchCoefficients}):opts.useV4Algorithm?analyzer.analyzeV40(sample.str_data,employee.str_data,employee,all,{locusWeights:opts.locusWeights,matchCoefficients:opts.matchCoefficients}):analyzer.analyzeV15(sample.str_data,employee.str_data,employee,all,opts);
   const {registrationNumber,staffYear,...original}=match;
   assert.deepEqual(json(actual),original);checked++;
  }
 }
 assert(checked>20);
});
