const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const url=process.env.NIGHT_SEARCH_TEST_DATABASE_URL;
test('Night search: durable checkpoints, window, fencing, rights, results and global manual priority',{skip:!url},async t=>{
  assert.match(new URL(url).pathname,/^\/dna_night_search_test_/);
  Object.assign(process.env,{DATABASE_URL:url,NODE_ENV:'test',UNIFIED_WORKSPACE_ENABLED:'true',JWT_SECRET:'SYN-night-test-only'});
  const realInterval=global.setInterval;global.setInterval=(...args)=>realInterval(...args).unref();
  t.after(()=>{global.setInterval=realInterval;});
  const fs=require('fs'),{pool}=require('../src/config/database'),{NightSearchService}=require('../src/services/workspace/nightSearchService'),{WorkspaceApprovalService}=require('../src/services/workspace/workspaceApprovalService');
  await pool.query(fs.readFileSync(require('path').join(__dirname,'../database/migrations/040_night_search.sql'),'utf8'));
  const {setSearchCoordinator}=require('../src/services/profiles/searchWorkerExecutor'),{SearchCpuCoordinator}=require('../src/services/profiles/searchCpuCoordinator');
  setSearchCoordinator(new SearchCpuCoordinator(pool));
  await pool.query('UPDATE workspace_night_policies SET enabled=false'); // This database is guarded as synthetic-only.
  let clock=new Date('2026-11-09T20:00:00Z'),org;const night=new NightSearchService(pool,{clock:()=>clock}),service=night.searchService;
  t.after(async()=>{await night.stop();setSearchCoordinator(null);if(org)await pool.query('UPDATE workspace_night_policies SET enabled=false WHERE organization_id=$1',[org]);await pool.end();});
  org=(await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',['SYN-night-'+randomUUID()])).rows[0].id;
  async function actor(role,organization=org){return (await pool.query("INSERT INTO users(username,password_hash,role,organization_id) VALUES($1,'synthetic-not-a-login',$2,$3) RETURNING id,role,organization_id,is_active",['SYN-'+randomUUID(),role,organization])).rows[0];}
  const admin=await actor('admin'),user=await actor('user_analyst');
  const foreignOrg=(await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',['SYN-foreign-'+randomUUID()])).rows[0].id,foreign=await actor('admin',foreignOrg);
  const {createImportWorkbook}=require('../src/utils/importWorkbook');
  const data=Object.fromEntries(['TH01','D5S818','D3S1358','D21S11','vWA','FGA','D13S317','D7S820','D16S539','CSF1PO','TPOX','D8S1179','D18S51','D2S441','D19S433'].map(l=>[l,['12','13']]));
  const profiles=Array.from({length:5},(_,i)=>({objectNumber:'SYN-'+i,year:2026,expertiseType:'ug',strData:structuredClone(data)}));
  const d=await service.createDraft(user,[{originalname:'SYN.xlsx',buffer:createImportWorkbook({profiles,loci:Object.keys(profiles[0].strData),sourceFormat:'DNA_IMPORT_V2'})}]);
  const ids=(await service.commitDraft(user,d.id,d.revision,randomUUID())).ids;
  await service.configureSearch(user,{minMatches:12,staffOptions:{useV5Algorithm:false,useV4Algorithm:true,threshold:5.5,minLociMatch:8}});
  const sd=await service.createDraft(admin,[{originalname:'SYN-staff.xlsx',buffer:createImportWorkbook({profiles:[{objectNumber:'123-G',year:2026,expertiseType:'staff',fullName:'Synthetic staff',strData:data}],loci:Object.keys(data),sourceFormat:'DNA_IMPORT_V2'})}]);
  const staffIds=(await service.commitDraft(admin,sd.id,sd.revision,randomUUID())).ids;
  const sr=await service.fullSearch(admin,staffIds);await service.publish(admin,staffIds,sr.id);await service.remove(admin,staffIds);
  const originalGenotypes=JSON.stringify((await pool.query('SELECT id,str_data FROM dna_profiles WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows);
  let policy,job;
  await t.test('Policy permissions, validation, revision conflict and idempotent migration',async()=>{
    const p=(await night.getPolicy(admin)).policy;assert.equal(p.enabled,false);
    const save={...p,enabled:true,chunkSize:1,maxWorkers:1,expectedRevision:0};delete save.revision;
    await assert.rejects(night.savePolicy(user,save),e=>e.status===403);
    await assert.rejects(night.savePolicy(admin,{...save,endTime:save.startTime}),e=>e.status===400);
    await assert.rejects(night.savePolicy(admin,{...save,timezone:'not-a-timezone'}),e=>e.status===400);
    policy=(await night.savePolicy(admin,save)).policy;
    await assert.rejects(night.savePolicy(admin,save),e=>e.code==='POLICY_CONFLICT');
    await pool.query(fs.readFileSync(require('path').join(__dirname,'../database/migrations/040_night_search.sql'),'utf8'));
    assert.equal((await night.getPolicy(admin)).policy.enabled,true);
  });
  await t.test('Trial planning is idempotent and isolated; one active job per workspace',async()=>{
    const key=randomUUID();assert.equal((await night.trial(admin,key)).queued,1);assert.equal((await night.trial(admin,key)).queued,1);
    assert.equal((await night.preview(admin)).needed,1);
    assert.equal((await night.jobs(foreign,true)).jobs.length,0);
    await assert.rejects(night.jobs(user,true),e=>e.status===403);
    job=await night.claim();assert.equal(job.owner_id,user.id);
    await assert.rejects(night.control(foreign,job.id,'cancel'),e=>e.status===404);
    const token=job.lease_token;await night.control(admin,job.id,'resume');
    assert.equal((await pool.query('SELECT lease_token FROM workspace_search_jobs WHERE id=$1',[job.id])).rows[0].lease_token,token);
  });
  await t.test('Pause preserves encrypted completed chunks; restart/retry finishes current proofs without rewriting genotypes',async()=>{
    const processing=night.process(job);
    let count=0;
    for(let i=0;i<300;i++) {count=(await pool.query('SELECT count(*)::int n FROM workspace_search_job_chunks WHERE job_id=$1',[job.id])).rows[0].n;if(count)break;await new Promise(r=>setTimeout(r,10));}
    assert(count>0);await night.control(user,job.id,'pause');await processing;
    const paused=(await pool.query('SELECT state FROM workspace_search_jobs WHERE id=$1',[job.id])).rows[0];assert.equal(paused.state,'paused');
    const chunk=(await pool.query('SELECT encrypted_result FROM workspace_search_job_chunks WHERE job_id=$1 LIMIT 1',[job.id])).rows[0];assert(chunk);assert.doesNotMatch(chunk.encrypted_result,/"TH01"/);
    await night.control(user,job.id,'resume');job=await night.claim();assert(job);await night.process(job);
    const completed=(await pool.query('SELECT * FROM workspace_search_jobs WHERE id=$1',[job.id])).rows[0];assert.equal(completed.state,'complete');
    const result=await service.search(user,completed.result_run_id),expected=JSON.parse(JSON.stringify(await service.fullSearch(user,ids)));
    assert.deepEqual(result.internal.results,expected.internal.results);assert.deepEqual(result.master.results,expected.master.results);assert.deepEqual(result.staff,expected.staff);
    assert.equal(JSON.stringify((await pool.query('SELECT id,str_data FROM dna_profiles WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows),originalGenotypes);
    assert(result.profiles.every(p=>p.state==='CHECKED'));assert.equal((await night.preview(admin)).needed,0);
    const same=await night.jobs(admin,true);assert.equal(same.jobs[0].result_run_id,null,'admin monitor cannot disclose another owner result');
    assert((await night.jobs(user)).jobs[0].result_run_id);
    await assert.rejects(service.search(admin,completed.result_run_id),e=>e.status===404);
  });
  await t.test('Editing data during pause invalidates cached chunks instead of reusing obsolete comparisons',async()=>{
    await service.patch(user,ids[0],{strData:{...data,TH01:['8','9']}});
    await night.enqueue(org,policy,'SYN-checkpoint-change','trial');job=await night.claim();assert(job);
    const processing=night.process(job);let count=0;
    for(let i=0;i<300;i++){count=(await pool.query('SELECT count(*)::int n FROM workspace_search_job_chunks WHERE job_id=$1',[job.id])).rows[0].n;if(count)break;await new Promise(r=>setTimeout(r,10));}
    assert(count);await night.control(user,job.id,'pause');await processing;
    const old=(await pool.query('SELECT manifest FROM workspace_search_jobs WHERE id=$1',[job.id])).rows[0].manifest;
    await service.patch(user,ids[1],{strData:{...data,TH01:['10','11']}});
    await night.control(user,job.id,'resume');job=await night.claim();await night.process(job);
    const row=(await pool.query('SELECT * FROM workspace_search_jobs WHERE id=$1',[job.id])).rows[0];
    assert.equal(row.state,'complete');assert.notEqual(row.manifest,old);
    const result=await service.search(user,row.result_run_id),expected=JSON.parse(JSON.stringify(await service.fullSearch(user,ids)));
    assert.deepEqual(result.internal.results,expected.internal.results);assert.deepEqual(result.staff,expected.staff);
  });
  await t.test('Expired lease is recovered with a new token; closed window prevents scheduled work',async()=>{
    await service.patch(user,ids[0],{strData:{...data,TH01:['7','9']}});
    await night.enqueue(org,policy,'SYN-lease-recovery','scheduled');
    job=await night.claim();assert(job);
    await pool.query("UPDATE workspace_search_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
    const recovered=await night.claim();assert(recovered);assert.notEqual(recovered.lease_token,job.lease_token);
    await assert.rejects(night.guard(job),e=>e.code==='JOB_STOPPED');
    clock=new Date('2026-11-10T08:00:00Z');await night.process(recovered);
    assert.equal((await pool.query('SELECT state FROM workspace_search_jobs WHERE id=$1',[job.id])).rows[0].state,'paused_window');
    assert.equal(await night.claim(),null);
    await night.control(admin,job.id,'cancel');
  });
  await t.test('Scheduler uses administrator window, skips current data, resumes changes and never publishes',async()=>{
    const before=(await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE organization_id=$1',[org])).rows[0].n;
    clock=new Date('2026-11-09T20:00:00Z');
    await night.tick();await night.processing;
    const jobs=await night.jobs(user);assert(jobs.jobs.some(j=>j.origin==='scheduled'&&j.state==='complete'));
    const count=(await pool.query("SELECT count(*)::int n FROM workspace_search_jobs WHERE organization_id=$1 AND window_key NOT LIKE 'trial:%'",[org])).rows[0].n;
    await night.tick();await night.processing;
    assert.equal((await pool.query("SELECT count(*)::int n FROM workspace_search_jobs WHERE organization_id=$1 AND window_key NOT LIKE 'trial:%'",[org])).rows[0].n,count);
    assert.equal((await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE organization_id=$1',[org])).rows[0].n,before);
  });
  await t.test('Real authenticated API enforces organization/owner scope and validates schedule revisions',async()=>{
    const express=require('express'),User=require('../src/models/User');
    const interval=global.setInterval;global.setInterval=(...args)=>interval(...args).unref();
    const auth=require('../src/services/security/authService'),router=require('../src/routes/workspace')(service);global.setInterval=interval;
    const app=express();app.locals.pool=pool;app.locals.nightSearch=night;app.use(express.json());app.use('/api/workspace',router);
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
    const base='http://127.0.0.1:'+server.address().port+'/api/workspace',tokens={};
    for(const a of [admin,user,foreign]){const record=await User.findById(a.id),token=auth.generateToken(record);await auth.createSession(a.id,token,'127.0.0.1','synthetic-night-test');tokens[a.id]=token;}
    const request=(path,actor=user,body,method=body?'POST':'GET')=>fetch(base+path,{method,headers:{Authorization:'Bearer '+tokens[actor.id],'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal((await fetch(base+'/night-policy')).status,401);
    assert.equal((await request('/search-jobs?scope=organization')).status,403);
    assert.equal((await request('/search-jobs/'+job.id+'/progress',foreign)).status,404);
    assert.equal((await request('/search-jobs/'+job.id+'/cancel',foreign,{})).status,404);
    assert.equal((await request('/night-policy',user,{},'PUT')).status,403);
    const p=(await night.getPolicy(admin)).policy,{revision,...values}=p;
    assert.equal((await request('/night-policy',admin,{...values,expectedRevision:revision,owner_id:user.id},'PUT')).status,400);
    assert.equal((await request('/night-policy',admin,{...values,enabled:false,expectedRevision:revision},'PUT')).status,200);
    assert.equal((await request('/night-policy',admin,{...values,expectedRevision:revision},'PUT')).status,409);
    const own=await request('/search-jobs');assert.equal(own.status,200);assert((await own.json()).jobs.every(j=>j.owner_id===user.id));
    assert.equal((await request('/night-runs',admin,{idempotencyKey:'not-a-uuid'})).status,400);
  });
  await t.test('CPU coordination across processes preempts background for a manual ticket and releases leases',async()=>{
    const {SearchCpuCoordinator}=require('../src/services/profiles/searchCpuCoordinator');
    const a=new SearchCpuCoordinator(pool),b=new SearchCpuCoordinator(pool);let release,lost;
    const stopped=new Promise(r=>lost=r);
    release=await a.acquire({priority:'background',onLost:async e=>{assert.equal(e.code,'BACKGROUND_YIELD');await release();lost();}});
    const manual=b.acquire({priority:'manual',onLost:e=>{throw e;}});
    const timer=setTimeout(()=>lost('timeout'),5000);assert.notEqual(await stopped,'timeout');clearTimeout(timer);
    const unlock=await manual;await unlock();
    assert.equal((await pool.query('SELECT request_id FROM workspace_search_cpu_lease WHERE id=true')).rows[0].request_id,null);
  });
  await t.test('Large encrypted results do not get serialized for each profile when listing a workspace',async()=>{
    const bulkOrg=(await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id',['SYN-bulk-'+randomUUID()])).rows[0].id;
    const owner=await actor('user_analyst',bulkOrg);
    const draft=await service.createDraft(owner,[{originalname:'SYN-bulk.xlsx',buffer:createImportWorkbook({profiles:Array.from({length:80},(_,i)=>({objectNumber:'SYN-BULK-'+i,year:2026,expertiseType:'ug',strData:data})),loci:Object.keys(data),sourceFormat:'DNA_IMPORT_V2'})}]);
    const bulkIds=(await service.commitDraft(owner,draft.id,draft.revision,randomUUID())).ids;
    await service.configureSearch(owner,{minMatches:12});const result=await service.fullSearch(owner,bulkIds);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='3000ms'");
      const encrypted=require('../src/services/workspace/workspaceCrypto').seal({...result,padding:'SYN'.repeat(4*1024*1024)});
      await client.query("UPDATE workspace_search_runs SET origin='night',encrypted_result=$2 WHERE id=$1",[result.id,encrypted]);
      const rows=await new WorkspaceApprovalService(client).list(owner);
      assert.equal(rows.profiles.length,80);assert(rows.profiles.every(p=>p.searchState==='CHECKED'));
    }finally{await client.query('ROLLBACK');client.release();}
  });
});
