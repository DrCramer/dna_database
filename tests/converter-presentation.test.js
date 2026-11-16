const test=require('node:test'),assert=require('node:assert/strict');
const {preparedImportMatches}=require('../src/utils/preparedImportScope');
const {converterFileSummary}=require('../src/utils/converterPresentation');
test('Prepared files can transfer only to the account and organization that produced them',()=>{
  const user={id:'SYN-A',organization_id:'SYN-ORG'},prepared={file:{name:'SYN.xlsx'},ownerId:'SYN-A',organizationId:'SYN-ORG'};
  assert(preparedImportMatches(prepared,user));
  assert(!preparedImportMatches(prepared,{...user,id:'SYN-B'}));
  assert(!preparedImportMatches(prepared,{...user,organization_id:'SYN-OTHER'}));
  assert(!preparedImportMatches({file:prepared.file},user));
  assert(!preparedImportMatches(prepared,null));
  assert(preparedImportMatches({...prepared,organizationId:undefined},user),'Owner-scoped legacy in-memory transfers stay compatible');
});
test('Converter file totals count merged sources once, preserve exceptions, and do not alter genotypes',()=>{
  const data={files:[{id:'A'},{id:'B'},{id:'TXT',geneMapper:{samples:[{included:true,exportable:true},{included:false,exportable:true},{included:true,exportable:false}]}}],profiles:[{sources:[{fileId:'A'},{fileId:'A'},{fileId:'B'}],strData:{D21S11:['30','*','?']}},{sources:[{fileId:'B'}]}],issues:[{fileId:'A',hard:true,reason:'SYN'},{fileId:'A',hard:false},{fileId:'TXT',hard:true,reason:'SYN-2'}],preparedFiles:[{fileId:'TXT',ready:false}]};
  const before=JSON.stringify(data),s=converterFileSummary(data);
  assert.equal(s.get('A').count,1);assert.equal(s.get('B').count,2);assert.equal(s.get('TXT').count,1);
  assert.equal(s.get('A').hard,1);assert.equal(s.get('A').reason,'SYN');assert.equal(s.get('TXT').prepared.ready,false);
  assert.equal(JSON.stringify(data),before);assert.equal(converterFileSummary(null).size,0);
});

test('Confirmed warnings leave every working filter, while failed decisions and unreviewed auto-fixes remain',()=>{
  const {converterIssueView}=require('../src/utils/converterPresentation');
  const issues=[{id:'confirmed',locus:'TH01',objectNumber:'SYN-A',sourceFile:'SYN.xlsx',status:'WARNING',hard:false,userDecision:{action:'manual',value:'*'}},
    {id:'failed',locus:'TH01',objectNumber:'SYN-B',status:'ERROR',hard:true,userDecision:{action:'manual',value:'BAD'}},
    {id:'qc',locus:'TH01',status:'NEEDS_REVIEW',hard:true,ngs:{qc:{status:'NEEDS_REVIEW'}},userDecision:{action:'keep'}},
    {id:'auto',locus:'TH01',status:'AUTO_FIXED',hard:false,userDecision:null},
    {id:'warning',locus:'TH01',status:'WARNING',hard:false}];
  const before=JSON.stringify(issues);
  assert.deepEqual(converterIssueView(issues,'all').filtered.map(i=>i.id),['failed','qc','auto','warning']);
  assert.deepEqual(converterIssueView(issues,'WARNING').filtered.map(i=>i.id),['warning']);
  assert.deepEqual(converterIssueView(issues,'AUTO_FIXED').filtered.map(i=>i.id),['auto']);
  assert.deepEqual(converterIssueView(issues,'hard').filtered.map(i=>i.id),['failed','qc']);
  assert.deepEqual(converterIssueView(issues,'confirmed').filtered,[issues[0]]);
  assert.equal(converterIssueView(issues,'confirmed','syn.xlsx').confirmedCount,1);
  assert.equal(converterIssueView(issues,'confirmed','syn-b').confirmedCount,0);
  assert.equal(JSON.stringify(issues),before);
});

test('Special-token confirmations disappear and undo restores their original visibility without altering genotypes',()=>{
  const X=require('xlsx'),{GeneticExcelConverterService}=require('../src/services/converters/geneticExcelConverterService');
  const {applyConverterIssueDecision}=require('../src/utils/converterIssueGroups'),{prepareConverterBulkUndo,undoConverterBulkDecision}=require('../src/utils/converterBulkUndo');
  const {converterIssueView}=require('../src/utils/converterPresentation');
  const book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.json_to_sheet(Array.from({length:4},(_,i)=>({'Sample Name':'SYN-'+i,TH01:'7,9.3',TPOX:'8,8',D6S477:'**'}))),'Data');
  const files=[{originalname:'SYN.xlsx',buffer:X.write(book,{type:'buffer',bookType:'xlsx'})}],c=new GeneticExcelConverterService(),before=c.convert(files),members=before.issues.filter(i=>i.locus==='D6S477');
  const p=prepareConverterBulkUndo({},applyConverterIssueDecision({},members,{action:'manual',value:'*'}),members,'SYN-confirm');
  const after=c.convert(files,p.options);assert.equal(converterIssueView(after.issues,'WARNING').filtered.length,0);assert.equal(converterIssueView(after.issues,'all').filtered.length,0);
  assert.equal(converterIssueView(after.issues,'confirmed').filtered.length,4);assert(converterIssueView(after.issues,'confirmed').filtered.every(i=>i.status==='WARNING'));
  assert.deepEqual(after.profiles.map(p=>p.strData),before.profiles.map(p=>p.strData));
  const undone=c.convert(files,undoConverterBulkDecision(p.options,p.undo));assert.equal(converterIssueView(undone.issues,'WARNING').filtered.length,4);assert.equal(converterIssueView(undone.issues,'confirmed').filtered.length,0);
});
