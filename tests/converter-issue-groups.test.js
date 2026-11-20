const test=require('node:test'),assert=require('node:assert/strict'),X=require('xlsx');
const {GeneticExcelConverterService}=require('../src/services/converters/geneticExcelConverterService');
const {groupConverterIssues,applyConverterIssueDecision}=require('../src/utils/converterIssueGroups');
const {createConverterRuleMatcher,rowRanges}=require('../src/utils/converterRuleScope');
function source(prefix,rows=4,duplicate=false){const b=X.utils.book_new(),headers=['Объект','TH01','TPOX','D21S11',...(duplicate?['TH01']:[])];X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([headers,...Array.from({length:rows},(_,i)=>[`${prefix}-${i+1}`,'11.12','11.12','30,*',...(duplicate?['11.12']:[])])]),'Data.1');return {originalname:prefix+'.xlsx',buffer:X.write(b,{type:'buffer',bookType:'xlsx'})};}
function th01(result){return result.issues.filter(i=>i.locus==='TH01'&&i.hard&&i.code==='AMBIGUOUS_DOT');}

test('Identical cases across files group by exact locus/value/diagnostics without modifying source evidence',()=>{
  const converter=new GeneticExcelConverterService(),files=[source('SYN-A'),source('SYN-B')],result=converter.convert(files),before=JSON.stringify(result);
  const groups=groupConverterIssues(result.issues.filter(i=>i.hard));
  assert.equal(groups.length,2);assert.equal(groups.find(g=>g.issue.locus==='TH01').members.length,8);
  assert.equal(groups[0].files.size,2);assert(groups.every(g=>g.canBatch));assert.equal(JSON.stringify(result),before);
  const item=th01(result)[0];
  assert.equal(groupConverterIssues([item,{...item,id:'different',rawValue:'12.13'},{...item,id:'other-reason',reason:'Other QC'}]).length,3);
});

test('A group decision affects only selected rows and locus, across files; individual overrides stay independent',()=>{
  const converter=new GeneticExcelConverterService(),files=[source('SYN-A'),source('SYN-B')],initial=converter.convert(files);
  const members=th01(initial).filter(i=>['SYN-A-1','SYN-A-3','SYN-B-2'].includes(i.objectNumber));
  const originalOptions={cells:{[members[0].id]:{action:'keep'},[th01(initial).find(i=>i.objectNumber==='SYN-A-4').id]:{action:'keep'}}};
  const before=JSON.stringify(originalOptions);
  const options=applyConverterIssueDecision(originalOptions,members,{action:'split_dot'});
  assert.equal(JSON.stringify(originalOptions),before);assert.equal(options.rules.length,2);assert(!options.cells[members[0].id]);
  const result=converter.convert(files,options),selected=new Set(members.map(i=>i.objectNumber));
  for(const profile of result.profiles){
    assert.deepEqual(profile.strData.TH01,selected.has(profile.objectNumber)?['11','12']:['11.12']);
    assert.deepEqual(profile.strData.TPOX,['11.12']);assert.deepEqual(profile.strData.D21S11,['30','*']);
  }
  const later=applyConverterIssueDecision(options,[members[0]],{action:'keep'});
  assert.deepEqual(converter.convert(files,later).profiles.find(p=>p.objectNumber===members[0].objectNumber).strData.TH01,['11.12']);
});

test('Scoped rules preserve exact columns and rows; validation rejects malformed and overlapping ranges',()=>{
  const converter=new GeneticExcelConverterService(),files=[source('SYN-columns',4,true)],initial=converter.convert(files);
  const selected=th01(initial).filter(i=>i.column===1&&i.sourceRow<=3);
  const options=applyConverterIssueDecision({},selected,{action:'split_dot'}),result=converter.convert(files,options);
  for(const profile of result.profiles)for(const cell of profile.audit.filter(i=>i.locus==='TH01'&&i.column!=null)){
    assert.equal(cell.normalizedValue,cell.column===1&&cell.sourceRow<=3?'11,12':'11.12');
  }
  const valid=options.rules[0];
  for(const rowRanges of [[],[[3,2]],[[2,3],[3,4]],[[0,1]],[[2,2.5]],'all']){
    assert.throws(()=>converter.convert(files,{rules:[{...valid,rowRanges}]}),/массовые правила/);
  }
  const match=createConverterRuleMatcher([valid]);
  const cell={fileId:valid.fileId,code:valid.originalCode,rawValue:valid.rawValue,locusType:valid.locusType,locus:valid.locus,sheetName:valid.sheetName,column:1,row:2};
  assert.equal(match(cell),valid);assert.equal(match({...cell,sheetName:'Other'}),undefined);assert.equal(match({...cell,row:4}),undefined);assert.equal(match({...cell,column:4}),undefined);
});

test('NGS QC, source structure and conflicting studies cannot receive a bulk cell decision',()=>{
  const item={id:'A:Data:2:1',fileId:'A',sourceSheet:'Data',locus:'TH01',rawValue:'11.12',normalizedValue:'11.12',status:'NEEDS_REVIEW',hard:true,code:'AMBIGUOUS_DOT'};
  for(const patch of [{ngs:{qc:{status:'NEEDS_REVIEW'}}},{locus:''},{variants:[]},{code:'FORMULA_WITHOUT_RESULT'}]){
    const cases=[{...item,...patch},{...item,...patch,id:'A:Data:3:1'}];assert(!groupConverterIssues(cases)[0].canBatch);
    assert.throws(()=>applyConverterIssueDecision({},cases,{action:'keep'}),/по отдельности/);
  }
  assert.throws(()=>applyConverterIssueDecision({},[item,{...item,locus:'TPOX',id:'A:Data:3:2'}],{action:'keep'}),/по отдельности/);
});

test('Ten thousand repeated cases produce a bounded rule instead of thousands of per-cell decisions',()=>{
  const cases=Array.from({length:10000},(_,i)=>({id:`A:Data:${i+2}:1`,fileId:'A',sourceSheet:'Data',sourceFile:'SYN.xlsx',sourceRow:i+2,objectNumber:`SYN-${i}`,locus:'TH01',rawValue:'11.12',normalizedValue:'11.12',code:'AMBIGUOUS_DOT',status:'NEEDS_REVIEW',hard:true}));
  const group=groupConverterIssues(cases)[0];assert.equal(group.members.length,10000);
  const options=applyConverterIssueDecision({},group.members,{action:'split_dot'});assert.equal(options.rules.length,1);assert.deepEqual(options.rules[0].rowRanges,[[2,10001]]);assert(JSON.stringify(options).length<500);
  assert.deepEqual(rowRanges([8,2,3,5,8,7]),[[2,3],[5,5],[7,8]]);
});

test('Legacy broad rules retain their priority and new group rules can supersede them precisely',()=>{
  const converter=new GeneticExcelConverterService(),files=[source('SYN-old')],initial=converter.convert(files),members=th01(initial).slice(0,2),first=members[0];
  const old={rules:[{fileId:first.fileId,locusType:'STR',rawValue:'11.12',code:'AMBIGUOUS_DOT',decision:{action:'keep'}}]};
  const options=applyConverterIssueDecision(old,members,{action:'split_dot'}),result=converter.convert(files,options);
  assert.deepEqual(result.profiles[0].strData.TH01,['11','12']);assert.deepEqual(result.profiles[2].strData.TH01,['11.12']);
  assert.deepEqual(result.profiles[0].strData.TPOX,['11.12']);
});

test('An invalid bulk decision can be corrected for the same group without stale rule precedence',()=>{
  const converter=new GeneticExcelConverterService(),files=[source('SYN-retry')],initial=converter.convert(files);
  const wrong=applyConverterIssueDecision({},th01(initial),{action:'manual',value:'ABC'}),failed=converter.convert(files,wrong);
  const members=failed.issues.filter(i=>i.locus==='TH01'&&i.hard&&i.code==='UNKNOWN_ALLELE');assert.equal(members.length,4);
  const next=applyConverterIssueDecision(wrong,members,{action:'split_dot'}),result=converter.convert(files,next);
  assert(result.profiles.every(p=>p.strData.TH01.join(',')==='11,12'));assert(!result.issues.some(i=>i.locus==='TH01'&&i.hard));
});

test('GeneMapper groups target internal workbook coordinates while showing original TXT rows',()=>{
  const text=['Sample Name\tMarker\tAllele 1\tAllele 2',...Array.from({length:3},(_,i)=>[`SYN-${i}\tTH01\t11.12\t`,`SYN-${i}\tTPOX\t8\t8`,`SYN-${i}\tD21S11\t30\t31`]).flat()].join('\n');
  const files=[{originalname:'SYN.txt',buffer:Buffer.from(text)}],converter=new GeneticExcelConverterService(),initial=converter.convert(files);
  const members=th01(initial).slice(1);assert.equal(members.length,2);assert.equal(members[0].sourceRow,5);
  const options=applyConverterIssueDecision({},members,{action:'split_dot'});assert.deepEqual(options.rules[0].rowRanges,[[3,4]]);
  const result=converter.convert(files,options);assert.deepEqual(result.profiles[0].strData.TH01,['11.12']);assert.deepEqual(result.profiles[1].strData.TH01,['11','12']);assert.deepEqual(result.profiles[2].strData.TH01,['11','12']);
});

test('Formula evidence stays individual after manual correction; scoped rules fail closed on old converters',()=>{
  const file=source('SYN-formulas',2),book=X.read(file.buffer,{type:'buffer'});
  for(const cell of ['B2','B3'])book.Sheets['Data.1'][cell]={t:'n',f:'1+1'};
  file.buffer=X.write(book,{type:'buffer',bookType:'xlsx'});
  const converter=new GeneticExcelConverterService(),initial=converter.convert([file]);
  const formulaIssues=initial.issues.filter(i=>i.code==='FORMULA_WITHOUT_RESULT');assert.equal(formulaIssues.length,2);
  const options={cells:Object.fromEntries(formulaIssues.map(i=>[i.id,{action:'manual',value:'11,12'}]))};
  const corrected=converter.convert([file],options).issues.filter(i=>i.ruleCode==='FORMULA_WITHOUT_RESULT');
  assert.equal(corrected.length,2);assert(!groupConverterIssues(corrected)[0].canBatch);
  const other=converter.convert([source('SYN-version')]);
  const scoped=applyConverterIssueDecision({},th01(other),{action:'split_dot'}).rules[0];
  assert.equal(scoped.code,'SCOPED_CELL_V1');
  assert.notEqual(scoped.code,scoped.originalCode,'Old converters must never treat a scoped rule as a broad legacy rule');
  assert.throws(()=>converter.convert([file],{rules:[{...scoped,rowRanges:undefined}]}),/массовые правила/);
});
