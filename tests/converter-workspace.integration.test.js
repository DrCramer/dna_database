const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),X=require('xlsx');
const url=process.env.WORKSPACE_TEST_DATABASE_URL;
test('Real converter API: workspace scope, references, sheet selection and compact preview',{skip:!url},async t=>{
  assert.match(new URL(url).pathname,/^\/dna_workspace_test(?:_|$)/);
  Object.assign(process.env,{DATABASE_URL:url,NODE_ENV:'test',UNIFIED_WORKSPACE_ENABLED:'true',JWT_SECRET:'SYN-converter-workspace-only'});
  const interval=global.setInterval;global.setInterval=(...a)=>interval(...a).unref();
  const {pool}=require('../src/config/database'),User=require('../src/models/User'),auth=require('../src/services/security/authService'),express=require('express');
  const app=express();app.locals.pool=pool;app.use(express.json());app.use(require('../src/middleware/requestContext').requestContext);app.use(require('../src/middleware/errorHandler').apiErrorResponses);app.use('/converter',require('../src/routes/geneticExcelConverter'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{global.setInterval=interval;server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();});
  const org=(await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',['SYN-converter-'+randomUUID()])).rows[0].id;
  const user=(await pool.query("INSERT INTO users(username,password_hash,role,organization_id) VALUES($1,'SYN-no-login','user_analyst',$2) RETURNING id",['SYN-'+randomUUID(),org])).rows[0];
  const actor=await User.findById(user.id),token=auth.generateToken(actor);await auth.createSession(actor.id,token,'127.0.0.1','SYN-converter');
  await require('../src/models/AlleleReferenceSet').AlleleReferenceSet.create({name:'SYN reference',type:'OBSERVED_REFERENCE',sourceTitle:'Synthetic only',sourceUrl:'https://example.invalid/test',sourceVersion:'1',confirmed:true,format:'json',content:JSON.stringify({values:[{locus:'TH01',allele:'7'},{locus:'TH01',allele:'9.3'}]})},{organizationId:org,departmentId:null},actor.id);
  const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.json_to_sheet(Array.from({length:300},(_,i)=>({'Sample Name':'SYN-'+i,TH01:'7,9.3',TPOX:'8,8',D21S11:'30,31'}))),'SYN data');X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['SYN notes']]),'SYN notes');const bytes=X.write(b,{type:'buffer',bookType:'xlsx'}),base='http://127.0.0.1:'+server.address().port;
  async function request(options={},headers={Authorization:'Bearer '+token}){const body=new FormData();body.append('files',new Blob([bytes]),'SYN.xlsx');body.append('options',JSON.stringify(options));const r=await fetch(base+'/converter/preview',{method:'POST',headers,body});return {status:r.status,body:await r.json()};}
  assert.equal((await request({},{})).status,401);
  const first=await request();assert.equal(first.status,200);assert.equal(first.body.profiles.length,0);
  const options={files:{[first.body.files[0].id]:{sheetName:'SYN data',year:2026}}};
  const full=await request(options),compact=await request({...options,previewFormat:'compact-v1'});
  assert.equal(full.status,200);assert.equal(compact.status,200);assert.equal(full.body.profiles.length,300);assert.equal(compact.body.previewFormat,'compact-v1');
  assert.deepEqual(require('../src/utils/converterPreviewTransport').unpackConverterPreview(compact.body),full.body);
  assert.equal((await pool.query('SELECT count(*)::int n FROM dna_profiles WHERE organization_id=$1',[org])).rows[0].n,0);
  const service=require('../src/services/profiles/alleleReferenceService').AlleleReferenceService,load=service.load,logger=require('../src/utils/logger').logger,log=logger.error;let diagnostic;
  try{service.load=async()=>{throw Error('SYN-PRIVATE-FILE-CONTENTS');};logger.error=(message,meta)=>{diagnostic=meta;};const failed=await request(options);assert.equal(failed.status,500);assert.equal(diagnostic.stage,'references');assert.equal(diagnostic.errorType,'Error');assert(!JSON.stringify(diagnostic).includes('SYN-PRIVATE'));assert(!JSON.stringify(failed.body).includes('SYN-PRIVATE'));}
  finally{service.load=load;logger.error=log;}
});
