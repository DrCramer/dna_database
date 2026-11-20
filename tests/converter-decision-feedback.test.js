const test=require('node:test'),assert=require('node:assert/strict'),X=require('xlsx');
const {GeneticExcelConverterService}=require('../src/services/converters/geneticExcelConverterService');
const {applyConverterIssueDecision}=require('../src/utils/converterIssueGroups');
const {prepareConverterBulkUndo,undoConverterBulkDecision}=require('../src/utils/converterBulkUndo');
const {converterDecisionFeedback}=require('../src/utils/converterDecisionFeedback');
const {packConverterPreview,unpackConverterPreview}=require('../src/utils/converterPreviewTransport');
function source(rows=4){const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.json_to_sheet(Array.from({length:rows},(_,i)=>({'Sample Name':'SYN-'+Math.floor(i/2),TH01:'7,9.3',TPOX:'8,8',D6S477:'**'}))),'Data');return [{originalname:'SYN-special.xlsx',buffer:X.write(b,{type:'buffer',bookType:'xlsx'})}];}
const target=result=>result.issues.filter(i=>i.locus==='D6S477'&&!i.variants);
function apply(c,files,result,options,decision,id){const members=target(result),prepared=prepareConverterBulkUndo(options,applyConverterIssueDecision(options,members,decision),members,id);return {...prepared,result:c.convert(files,prepared.options)};}

test('5049 special-token cases are applied and confirmed even when the normalized value stays the same',()=>{
  const files=source(5049),c=new GeneticExcelConverterService(),before=c.convert(files),p=apply(c,files,before,{}, {action:'manual',value:'*'},'SYN-special');
  assert.equal(target(before).length,5049);
  assert.deepEqual({...p.result.bulkDecisions['SYN-special']},{matched:5049,accepted:5049,needsReview:0,warnings:5049,specialWarnings:5049,value:'*',mixedValues:false});
  assert(target(p.result).every(i=>i.userDecision?.value==='*'&&i.rawValue==='**'&&i.normalizedValue==='*'&&i.status==='WARNING'));
  const feedback=converterDecisionFeedback(p.result,p.undo);assert.match(feedback.text,/5049/);assert.match(feedback.text,/уже был «\*»/);assert.match(feedback.text,/Предупреждения сохранены/);assert.equal(feedback.needsReview,false);
  assert.deepEqual(p.result.profiles.map(p=>p.strData),before.profiles.map(p=>p.strData));
  assert(!c.convert(files,undoConverterBulkDecision(p.options,p.undo)).bulkDecisions);
});

test('Feedback compares with the previous explicit decision and confirms real changes and unknown/missing choices',()=>{
  const files=source(),c=new GeneticExcelConverterService(),before=c.convert(files);
  const unknown=apply(c,files,before,{}, {action:'unknown'},'SYN-unknown');assert.equal(unknown.result.bulkDecisions['SYN-unknown'].value,'?');
  const star=apply(c,files,unknown.result,unknown.options,{action:'manual',value:'*'},'SYN-star');
  assert.equal(star.undo.previousValue,'?');assert(!converterDecisionFeedback(star.result,star.undo).text.includes('уже был'));
  const missing=apply(c,files,star.result,star.options,{action:'missing'},'SYN-missing');assert.equal(missing.result.bulkDecisions['SYN-missing'].value,'');assert(missing.result.profiles.every(p=>p.strData.D6S477.length===0));
});

test('Bad or partial decisions report unresolved cases and cannot be presented as a silent success',()=>{
  const files=source(),c=new GeneticExcelConverterService(),before=c.convert(files),p=apply(c,files,before,{}, {action:'manual',value:'BAD'},'SYN-bad');
  const feedback=converterDecisionFeedback(p.result,p.undo);assert.equal(feedback.needsReview,true);assert.match(feedback.text,/Требуют исправления: 4/);
  assert.throws(()=>converterDecisionFeedback({},p.undo),/не подтвердил/);
  assert.throws(()=>converterDecisionFeedback(p.result,{...p.undo,count:5}),/не подтвердил/);
  const broken={bulkDecisions:{'SYN-bad':{matched:4,accepted:0,needsReview:3,warnings:0}}};assert.throws(()=>converterDecisionFeedback(broken,p.undo),/не подтвердил/);
});

test('Server confirmations survive compact transport and safe operation names without prototype pollution',()=>{
  const files=source(),c=new GeneticExcelConverterService(),p=apply(c,files,c.convert(files),{}, {action:'manual',value:'*'},'__proto__');
  assert.equal(Object.getPrototypeOf(p.result.bulkDecisions),null);
  const restored=unpackConverterPreview(JSON.parse(JSON.stringify(packConverterPreview(p.result))));
  assert.equal(restored.bulkDecisions['__proto__'].matched,4);assert.match(converterDecisionFeedback(restored,p.undo).text,/случаев: 4/);
});
