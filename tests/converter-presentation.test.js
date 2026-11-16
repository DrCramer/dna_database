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
