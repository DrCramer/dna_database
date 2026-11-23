const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),X=require('xlsx');
const url=process.env.WORKSPACE_TEST_DATABASE_URL;
test('Real converter API: workspace scope, no occurrence checks, sheet selection and compact previews',{skip:!url},async t=>{
  assert.match(new URL(url).pathname,/^\/dna_workspace_test(?:_|$)/);
  Object.assign(process.env,{DATABASE_URL:url,NODE_ENV:'test',UNIFIED_WORKSPACE_ENABLED:'true',JWT_SECRET:'SYN-converter-workspace-only'});
  const interval=global.setInterval;global.setInterval=(...a)=>interval(...a).unref();
  const {pool}=require('../src/config/database'),User=require('../src/models/User'),auth=require('../src/services/security/authService'),express=require('express');
  const app=express();app.locals.pool=pool;app.use(express.json());app.use(require('../src/middleware/requestContext').requestContext);app.use(require('../src/middleware/errorHandler').apiErrorResponses);app.use('/converter',require('../src/routes/geneticExcelConverter'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{global.setInterval=interval;server.closeAllConnections();await new Promise(r=>server.close(r));await require('../src/services/converters/converterWorkerExecutor').converterWorker.close();await pool.end();});
  const org=(await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',['SYN-converter-'+randomUUID()])).rows[0].id;
  const user=(await pool.query("INSERT INTO users(username,password_hash,role,organization_id) VALUES($1,'SYN-no-login','user_analyst',$2) RETURNING id",['SYN-'+randomUUID(),org])).rows[0];
  const actor=await User.findById(user.id),token=auth.generateToken(actor);await auth.createSession(actor.id,token,'127.0.0.1','SYN-converter');
  await require('../src/models/AlleleReferenceSet').AlleleReferenceSet.create({name:'SYN reference',type:'OBSERVED_REFERENCE',sourceTitle:'Synthetic only',sourceUrl:'https://example.invalid/test',sourceVersion:'1',confirmed:true,format:'json',content:JSON.stringify({values:[{locus:'TH01',allele:'7'},{locus:'TH01',allele:'9.3'}]})},{organizationId:org,departmentId:null},actor.id);
  const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.json_to_sheet(Array.from({length:300},(_,i)=>({'Sample Name':'SYN-'+i,TH01:i<10?'11.12':'7,9.3',TPOX:'8,8',D21S11:'30,31'}))),'SYN data');X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['SYN notes']]),'SYN notes');const bytes=X.write(b,{type:'buffer',bookType:'xlsx'}),base='http://127.0.0.1:'+server.address().port;
  const headers = { Authorization:'Bearer '+token };
  async function request(options={}, authHeaders=headers, operation='preview', includeFiles=true) {
    const body = new FormData();
    if (includeFiles) body.append('files',new Blob([bytes]),'SYN.xlsx');
    body.append('options',JSON.stringify(options));
    const response = await fetch(base+'/converter/'+operation,{method:'POST',headers:authHeaders,body});
    return {
      status:response.status, uploadId:response.headers.get('X-Converter-Upload-Id'),
      body:operation==='export' && response.ok ? Buffer.from(await response.arrayBuffer()) : await response.json()
    };
  }
  assert.equal((await request({},{})).status,401);
  const first=await request({rememberFiles:true});assert.equal(first.status,200);assert.equal(first.body.profiles.length,0);
  assert.match(first.uploadId,/^[0-9a-f-]{36}$/);
  const options={files:{[first.body.files[0].id]:{sheetName:'SYN data',year:2026}}};
  const full=await request(options),compact=await request({...options,previewFormat:'compact-v1'});
  assert.equal(full.status,200);assert.equal(compact.status,200);assert.equal(full.body.profiles.length,300);assert.equal(compact.body.previewFormat,'compact-v1');
  assert.deepEqual(require('../src/utils/converterPreviewTransport').unpackConverterPreview(compact.body),full.body);
  const reuse = await request({...options,uploadId:first.uploadId},headers,'preview',false);
  assert.equal(reuse.status,200);
  assert.deepEqual(reuse.body,full.body);
  const sparse = await request({...options,uploadId:first.uploadId,previewFormat:'compact-v3'},headers,'preview',false);
  assert.equal(sparse.status,200);
  assert.equal(sparse.body.previewFormat,'compact-v3');
  assert.deepEqual(require('../src/utils/converterPreviewTransport').unpackConverterPreview(sparse.body),full.body);
  assert.equal((await request({uploadId:first.uploadId},headers)).status,400);
  const expired = await request({uploadId:randomUUID()},headers,'preview',false);
  assert.equal(expired.status,409);
  assert.equal(expired.body.code,'CONVERTER_UPLOAD_EXPIRED');
  const otherUser=(await pool.query("INSERT INTO users(username,password_hash,role,organization_id) VALUES($1,'SYN-no-login','user_analyst',$2) RETURNING id",['SYN-'+randomUUID(),org])).rows[0];
  const otherActor=await User.findById(otherUser.id),otherToken=auth.generateToken(otherActor);
  await auth.createSession(otherActor.id,otherToken,'127.0.0.1','SYN-other');
  const foreign = await request({uploadId:first.uploadId},{Authorization:'Bearer '+otherToken},'preview',false);
  assert.equal(foreign.status,409);
  assert.equal(foreign.body.code,expired.body.code);
  assert.equal(foreign.body.message,expired.body.message);
  const allErrors = full.body.issues.filter(issue => issue.hard);
  const exportOptions = require('../src/utils/converterIssueGroups').applyConverterIssueDecision(options,allErrors,{action:'split_dot'});
  const cachedExport = await request({...exportOptions,uploadId:first.uploadId},headers,'export',false);
  assert.equal(cachedExport.status,200);
  const exportedBook = X.read(cachedExport.body,{type:'buffer'});
  assert.equal(X.utils.sheet_to_json(exportedBook.Sheets['Импорт']).length,300);
  const selected=full.body.issues.filter(i=>i.hard&&i.locus==='TH01').slice(0,3);
  const single = await request({
    ...options, uploadId:first.uploadId, objectPreviewKey:selected[0].profileKey,
    cells:{[selected[0].id]:{action:'split_dot'}}
  },headers,'preview-object',false);
  assert.equal(single.status,200);
  assert.equal(single.body.objectPreview.profile.key,selected[0].profileKey);
  assert.deepEqual(single.body.objectPreview.profile.strData.TH01,['11','12']);
  const merged=require('../src/utils/converterObjectPreview').applyConverterObjectPreview(full.body,single.body.objectPreview);
  assert.equal(merged.profiles.length,300);
  assert.equal(merged.summary.unresolved,9);
  assert.equal(merged.legacyCanImport,false);
  const grouped=require('../src/utils/converterIssueGroups').applyConverterIssueDecision(options,selected,{action:'split_dot'});
  const {prepareConverterBulkUndo,undoConverterBulkDecision}=require('../src/utils/converterBulkUndo');
  const tracked=prepareConverterBulkUndo(options,grouped,selected,'SYN-api-undo'),groupedOptions=tracked.options;
  const fixed=await request({
    ...groupedOptions, uploadId:first.uploadId, objectPreviewKeys:selected.map(issue=>issue.profileKey)
  },headers,'preview-objects',false);
  assert.equal(fixed.status,200);
  const patch=require('../src/utils/converterPreviewTransport').unpackConverterPreview(fixed.body.objectsPreview);
  assert.equal(patch.profiles.length,3);
  const decoded=require('../src/utils/converterObjectPreview').applyConverterObjectsPreview(full.body,patch);
  assert.deepEqual(decoded.profiles[0].strData.TH01,['11','12']);assert.deepEqual(decoded.profiles[3].strData.TH01,['11.12']);
  assert.equal(patch.bulkDecisions['SYN-api-undo'].matched,3);assert.equal(patch.bulkDecisions['SYN-api-undo'].accepted,3);
  assert.equal(require('../src/utils/converterDecisionFeedback').converterDecisionFeedback(patch,tracked.undo).needsReview,false);
  const undone=await request({...undoConverterBulkDecision(groupedOptions,tracked.undo),previewFormat:'compact-v2'});assert.equal(undone.status,200);
  assert.deepEqual(require('../src/utils/converterPreviewTransport').unpackConverterPreview(undone.body),full.body);
  assert.equal((await pool.query('SELECT count(*)::int n FROM dna_profiles WHERE organization_id=$1',[org])).rows[0].n,0);
  const service=require('../src/services/profiles/alleleReferenceService').AlleleReferenceService,load=service.load;
  try{
    service.load=async()=>{throw Error('Occurrence service must not be used by converter');};
    const fast=await request({...options,previewFormat:'compact-v2',lazyFiles:true,reference:{enabled:true}});
    assert.equal(fast.status,200);assert.equal(fast.body.previewFormat,'compact-v2');
    assert.deepEqual(require('../src/utils/converterPreviewTransport').unpackConverterPreview(fast.body),full.body);
    assert(!full.body.profiles.some(p=>p.audit.some(cell=>cell.reference)));
  }finally{service.load=load;}
});
