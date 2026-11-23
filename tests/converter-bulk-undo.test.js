const test=require('node:test'),assert=require('node:assert/strict'),X=require('xlsx');
const {GeneticExcelConverterService}=require('../src/services/converters/geneticExcelConverterService');
const {applyConverterIssueDecision}=require('../src/utils/converterIssueGroups');
const {prepareConverterBulkUndo,undoConverterBulkDecision}=require('../src/utils/converterBulkUndo');
function fixture(){const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.json_to_sheet(Array.from({length:4},(_,i)=>({'Sample Name':`SYN-${i}`,TH01:'11.12',TPOX:'8,8',D21S11:'30,*'}))),'Data');return [{originalname:'SYN.xlsx',buffer:X.write(b,{type:'buffer',bookType:'xlsx'})}];}
const cases=result=>result.issues.filter(i=>i.locus==='TH01'&&i.code==='AMBIGUOUS_DOT');
function bulk(options,members,decision,id){return prepareConverterBulkUndo(options,applyConverterIssueDecision(options,members,decision),members,id);}

test('Undo restores the exact previous options, cell overrides, genotype and audit without source reload',()=>{
  const files=fixture(),c=new GeneticExcelConverterService(),initial=c.convert(files),members=cases(initial);
  const before={cells:{[members[0].id]:{action:'keep'}},files:{[initial.files[0].id]:{year:2026}},export:{hideEmptyLoci:true}};
  const snapshot=JSON.stringify(before),expected=c.convert(files,before),prepared=bulk(before,members,{action:'split_dot'},'SYN-1');
  assert(c.convert(files,prepared.options).profiles.every(p=>p.strData.TH01.join(',')==='11,12'));
  const restored=undoConverterBulkDecision(prepared.options,prepared.undo);
  assert.deepEqual(restored,before);assert.deepEqual(c.convert(files,restored),expected);assert.equal(JSON.stringify(before),snapshot);
  assert.equal(prepared.undo.count,4);assert.equal(prepared.undo.locus,'TH01');assert.equal(prepared.undo.removedCells.length,1);
});

test('Later individual edits in the same and other loci, year, object settings and export settings survive undo',()=>{
  const files=fixture(),c=new GeneticExcelConverterService(),initial=c.convert(files),members=cases(initial);
  const before={cells:{[members[0].id]:{action:'keep'},[members[1].id]:{action:'unknown'}}};
  const p=bulk(before,members,{action:'split_dot'},'SYN-2');
  let later=applyConverterIssueDecision(p.options,[members[0]],{action:'manual',value:'13,14'});
  later={...later,files:{[initial.files[0].id]:{year:2027}},export:{hideEmptyLoci:false},objects:{'SYN-unrelated': 'SYN-renamed'}};
  const restored=undoConverterBulkDecision(later,p.undo),result=c.convert(files,restored);
  assert.deepEqual(result.profiles[0].strData.TH01,['13','14']);assert.deepEqual(restored.cells[members[1].id],before.cells[members[1].id]);
  assert.deepEqual(restored.files,later.files);assert.deepEqual(restored.objects,later.objects);assert.deepEqual(restored.export,later.export);
  assert(result.profiles.every(profile=>profile.year===2027));assert.deepEqual(result.profiles[3].strData.D21S11,['30','*']);
});

test('Undo removes only the latest bulk operation, preserves earlier bulk rules and survives JSON round trips',()=>{
  const c=new GeneticExcelConverterService(),files=fixture(),members=cases(c.convert(files));
  const a=bulk({},members,{action:'split_dot'},'SYN-first');
  const resolved=c.convert(files,a.options).issues.filter(i=>i.locus==='TH01');
  const b=bulk(a.options,resolved,{action:'keep'},'SYN-second');
  assert(c.convert(files,b.options).profiles.every(p=>p.strData.TH01.join(',')==='11.12'));
  const restored=undoConverterBulkDecision(JSON.parse(JSON.stringify(b.options)),JSON.parse(JSON.stringify(b.undo)));
  assert.deepEqual(restored,a.options);assert(c.convert(files,restored).profiles.every(p=>p.strData.TH01.join(',')==='11,12'));
  assert.throws(()=>undoConverterBulkDecision(restored,b.undo),/уже отменено/);
});

test('New individual absence decisions override previous cell choices when undoing',()=>{
  const c=new GeneticExcelConverterService(),files=fixture(),members=cases(c.convert(files));
  const before={cells:{[members[0].id]:{action:'keep'}}},p=bulk(before,members,{action:'split_dot'},'SYN-missing');
  const edited=applyConverterIssueDecision(p.options,[members[0]],{action:'missing'}),restored=undoConverterBulkDecision(edited,p.undo);
  assert.deepEqual(restored.cells[members[0].id],{action:'missing'});assert.deepEqual(c.convert(files,restored).profiles[0].strData.TH01,[]);
});

test('Large bulk edits retain a small inverse; undo refuses missing or partial operations without mutating options',()=>{
  const members=Array.from({length:10000},(_,i)=>({id:`A:Data:${i+2}:1`,fileId:'A',sourceSheet:'Data',sourceFile:'SYN.xlsx',objectNumber:`SYN-${i}`,locus:'TH01',rawValue:'11.12',normalizedValue:'11.12',code:'AMBIGUOUS_DOT',status:'NEEDS_REVIEW',hard:true}));
  const p=bulk({},members,{action:'split_dot'},'SYN-large');assert(JSON.stringify(p.undo).length<300);assert.deepEqual(undoConverterBulkDecision(p.options,p.undo),{});
  const snapshot=JSON.stringify(p.options);assert.throws(()=>undoConverterBulkDecision(p.options,{...p.undo,ruleCount:2}),/не доступно/);assert.equal(JSON.stringify(p.options),snapshot);
  assert.throws(()=>bulk(p.options,members,{action:'keep'},'SYN-large'),/сохранить отмену/);
});
