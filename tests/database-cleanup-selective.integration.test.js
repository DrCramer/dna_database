const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { MaintenanceGate } = require('../src/services/infrastructure/databaseMaintenanceGate');
const { GenotypeCleanupService, CONFIRMATION } = require('../src/services/infrastructure/genotypeCleanupService');
const plan = require('../src/services/infrastructure/genotypeCleanupPlan');

const url = process.env.CLEANUP_SELECTIVE_TEST_DATABASE_URL;
test('Selective cleanup: all 15 category combinations, published copies, approvals, legacy data and settings', { skip: !url }, async t => {
  assert.match(new URL(url).pathname, /^\/dna_cleanup_test_selective(?:_|$)/);
  const pool = new Pool({ connectionString: url, application_name: 'dna_cleanup_test', max: 5 });
  const gate = new MaintenanceGate(); gate.attach(pool);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dna-selective-cleanup-'));
  t.after(async () => { await pool.end(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal((await pool.query('SELECT count(*) n FROM users')).rows[0].n, '0', 'Use a NEW schema-only test DB');
  const org = (await pool.query("INSERT INTO organizations(name) VALUES('SYN selective cleanup') RETURNING id")).rows[0].id;
  const createUser = async role => {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,username,password_hash,role,organization_id,can_approve_master) VALUES($1,$2,'synthetic',$3,$4,true)", [id, 'SYN-' + id, role, org]);
    return { id };
  };
  const admin = await createUser('admin'), analyst = await createUser('user_analyst');
  const department = (await pool.query("INSERT INTO departments(organization_id,name) VALUES($1,'SYN') RETURNING id", [org])).rows[0].id;
  const array = (await pool.query("INSERT INTO master_arrays(organization_id,department_id,name) VALUES($1,$2,'SYN') RETURNING id", [org, department])).rows[0].id;
  const workspace = (await pool.query("INSERT INTO personal_workspaces(organization_id,owner_id,analysis_parameters) VALUES($1,$2,'{\"staffOptions\":{\"algorithmVersion\":\"v4\"}}') RETURNING id", [org, analyst.id])).rows[0].id;
  await pool.query('INSERT INTO workspace_reference_versions(organization_id) VALUES($1) ON CONFLICT DO NOTHING', [org]);
  await pool.query('INSERT INTO workspace_configuration(id,enabled) VALUES(true,false)');
  await pool.query("INSERT INTO user_settings(user_id,settings) VALUES($1,'{\"theme\":\"dark\"}')", [analyst.id]);
  await pool.query('INSERT INTO workspace_night_policies(organization_id) VALUES($1)', [org]);
  await pool.query("INSERT INTO probability_calculations(user_id,department_id,organization_id,mode,formula_version,reference_version,snapshot_encrypted) VALUES($1,$2,$3,'IDENT','SYN','SYN','SYN encrypted probability')", [analyst.id, department, org]);
  const service = new GenotypeCleanupService({ pool, gate, connectionString: url, directory });
  const count = async table => Number((await pool.query(`SELECT count(*) n FROM public."${table}"`)).rows[0].n);
  const snapshot = async table => (await pool.query(`SELECT to_jsonb(t)-'source_workspace_profile_id' data FROM public."${table}" t ORDER BY id`)).rows.map(r => r.data);
  async function seed() {
    const list = await plan.tables(pool);
    await pool.query(`TRUNCATE TABLE ${list.map(plan.quote).join(',')}`);
    await pool.query('UPDATE workspace_configuration SET enabled=false WHERE id=true');
    const source = async (name, type = 'ug', legacy = null, year = 2026) => (await pool.query(`INSERT INTO dna_profiles(user_id,organization_id,workspace_id,sample_name,internal_number,year,expertise_type,profile_type,str_data)
      VALUES($1,$2,$3,$4,$4,$8,$5,$6,$7) RETURNING *`, [analyst.id, org, legacy ? null : workspace, name, legacy ? null : type, legacy || 'user', { TH01: ['8', '9'], DYS391: ['10'] },year])).rows[0];
    const masterSource = await source('SYN master source'), staffSource = await source('SYN staff source', 'staff'), pendingSource = await source('SYN pending');
    await source('SYN legacy master', 'ug', 'master'); await source('SYN legacy staff', 'staff', 'staff');
    async function run(profile) {
      const w = (await pool.query('SELECT analysis_revision FROM personal_workspaces WHERE id=$1', [workspace])).rows[0];
      const refs = (await pool.query('SELECT * FROM workspace_reference_versions WHERE organization_id=$1', [org])).rows[0];
      const id = (await pool.query(`INSERT INTO workspace_search_runs(workspace_id,owner_id,organization_id,algorithm_version,state,parameters,workspace_revision,master_revision,staff_revision,completed_at,encrypted_result)
        VALUES($1,$2,$3,'SYN','complete','{}',$4,$5,$6,now(),'SYN encrypted search') RETURNING id`, [workspace, analyst.id, org, w.analysis_revision, refs.master_revision, refs.staff_revision])).rows[0].id;
      await pool.query("INSERT INTO workspace_search_profiles(search_run_id,profile_id,analysis_revision,analysis_hash,state,stages) VALUES($1,$2,$3,'SYN','CHECKED','{\"internal\":true,\"master\":true,\"staff\":true}')", [id, profile.id, profile.analysis_revision]);
      return id;
    }
    const masterRun = await run(masterSource), target = randomUUID(), publication = randomUUID();
    const approval = (await pool.query(`INSERT INTO workspace_master_approvals(organization_id,workspace_id,author_id,search_run_id,submission_key,submission_hash,state,decided_at,decided_by)
      VALUES($1,$2,$3,$4,$5,'SYN','approved',now(),$6) RETURNING id`, [org, workspace, analyst.id, masterRun, randomUUID(), admin.id])).rows[0].id;
    await pool.query("INSERT INTO workspace_master_approval_items(approval_id,search_run_id,profile_id,analysis_revision,analysis_hash,target_id,replace_existing) VALUES($1,$2,$3,$4,'SYN',$5,false)", [approval, masterRun, masterSource.id, masterSource.analysis_revision, target]);
    await pool.query("INSERT INTO workspace_publications(id,workspace_profile_id,analysis_revision,organization_id,search_run_id,destination,published_id,created_by,master_approval_id) VALUES($1,$2,$3,$4,$5,'master',$6,$7,$8)", [publication, masterSource.id, masterSource.analysis_revision, org, masterRun, target, admin.id, approval]);
    await pool.query('UPDATE workspace_master_approval_items SET publication_id=$2 WHERE approval_id=$1', [approval, publication]);
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.workspace_publication_id',$1,true)", [publication]);
      await c.query(`INSERT INTO master_array_profiles(id,master_array_id,organization_id,source_workspace_profile_id,year,internal_number,sample_name,str_data,created_by,expertise_type)
        VALUES($1,$2,$3,$4,2026,$5,$5,$6,$7,'ug')`, [target, array, org, masterSource.id, masterSource.internal_number, masterSource.str_data, admin.id]);
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
    const staffRun = await run(staffSource), staffPublication = randomUUID(), staffTarget = randomUUID();
    await pool.query("INSERT INTO workspace_publications(id,workspace_profile_id,analysis_revision,organization_id,search_run_id,destination,published_id,created_by) VALUES($1,$2,$3,$4,$5,'staff',$6,$7)", [staffPublication, staffSource.id, staffSource.analysis_revision, org, staffRun, staffTarget, analyst.id]);
    const sc = await pool.connect();
    try {
      await sc.query('BEGIN'); await sc.query("SELECT set_config('app.workspace_publication_id',$1,true)", [staffPublication]);
      await sc.query(`INSERT INTO staff_profiles(id,staff_id,full_name,organization_id,source_workspace_profile_id,year,registration_number,str_data,created_by)
        VALUES($1,'SYN staff','SYN employee',$2,$3,2026,$4,$5,$6)`, [staffTarget, org, staffSource.id, staffSource.internal_number, staffSource.str_data, analyst.id]);
      await sc.query('COMMIT');
    } catch (error) { await sc.query('ROLLBACK'); throw error; } finally { sc.release(); }
    const pendingRun = await run(pendingSource);
    const pending = (await pool.query("INSERT INTO workspace_master_approvals(organization_id,workspace_id,author_id,search_run_id,submission_key,submission_hash) VALUES($1,$2,$3,$4,$5,'SYN') RETURNING id", [org, workspace, analyst.id, pendingRun, randomUUID()])).rows[0].id;
    await pool.query("INSERT INTO workspace_master_approval_items(approval_id,search_run_id,profile_id,analysis_revision,analysis_hash,target_id,replace_existing) VALUES($1,$2,$3,$4,'SYN',$5,false)", [pending, pendingRun, pendingSource.id, pendingSource.analysis_revision, randomUUID()]);
    await pool.query('INSERT INTO workspace_master_approval_pending(profile_id,approval_id) VALUES($1,$2)', [pendingSource.id, pending]);
    await pool.query("INSERT INTO workspace_import_drafts(workspace_id,owner_id,organization_id,source_checksums,encrypted_payload,expires_at) VALUES($1,$2,$3,'[]','SYN draft',now()+interval '1 day')", [workspace, analyst.id, org]);
    await pool.query("INSERT INTO workspace_search_jobs(organization_id,owner_id,workspace_id,window_key,origin,policy_revision,parameters) VALUES($1,$2,$3,'SYN','scheduled',1,'{}')", [org, analyst.id, workspace]);
    await pool.query('UPDATE workspace_configuration SET enabled=true WHERE id=true');
    return {source,run,masterSource,staffSource,pendingSource,masterRun,staffRun,pendingRun};
  }
  const keys = Object.keys(plan.CATEGORIES);
  for (let mask = 1; mask < 16; mask++) await t.test(keys.filter((_, i) => mask & (1 << i)).join('+'), async () => {
    await seed();
    const selected = keys.filter((_, i) => mask & (1 << i)), has = key => selected.includes(key);
    const masterBefore = await snapshot('master_array_profiles'), staffBefore = await snapshot('staff_profiles');
    const preview = await service.preview(admin, selected);
    const countsBefore = new Map(await Promise.all([...new Set(preview.rows.map(row => row.table))].map(async table => [table, await count(table)])));
    await assert.rejects(service.start(admin, { token: preview.token, categories: has('results') ? ['personal'] : ['results'], confirmation: CONFIRMATION, acknowledged: true }), { status: 409 });
    await service.start(admin, { token: preview.token, categories: selected, confirmation: CONFIRMATION, acknowledged: true }); await service.running;
    const job = await service.status(admin); assert.equal(job.state, 'completed', job.message);
    assert.deepEqual(job.categories, selected); assert.ok(job.backup?.bytes);
    for (const row of preview.rows.filter(row => row.action === 'delete')) assert.equal(countsBefore.get(row.table) - await count(row.table), row.count, 'Preview count: '+row.table);
    assert.equal(await count('dna_profiles'), (has('personal') ? 0 : 3) + (has('master') ? 0 : 1) + (has('staff') ? 0 : 1));
    assert.deepEqual(await snapshot('master_array_profiles'), has('master') ? [] : masterBefore);
    assert.deepEqual(await snapshot('staff_profiles'), has('staff') ? [] : staffBefore);
    for (const [category, table] of [['master', 'master_array_profiles'], ['staff', 'staff_profiles']]) if (!has(category)) {
      const source = (await pool.query(`SELECT source_workspace_profile_id FROM public."${table}"`)).rows[0].source_workspace_profile_id;
      assert.equal(source === null, has('personal'));
    }
    assert.equal(await count('workspace_publications'), (has('personal') || has('master') ? 0 : 1) + (has('personal') || has('staff') ? 0 : 1));
    assert.equal(await count('workspace_master_approvals'), has('personal') ? 0 : 1);
    assert.equal(await count('workspace_master_approval_pending'), 0);
    assert.equal(await count('workspace_search_jobs'), 0);
    assert.equal((await pool.query("SELECT count(*) n FROM workspace_search_runs WHERE encrypted_result IS NOT NULL OR state<>'cancelled'")).rows[0].n, '0');
    assert.equal(await count('workspace_import_drafts'), has('personal') ? 0 : 1);
    assert.equal(await count('probability_calculations'), 1); assert.equal(await count('users'), 2); assert.equal(await count('master_arrays'), 1);
    assert.equal((await pool.query('SELECT enabled FROM workspace_configuration WHERE id=true')).rows[0].enabled, true);
    assert.deepEqual((await pool.query('SELECT settings FROM user_settings')).rows[0].settings, { theme: 'dark' });
    assert.equal(gate.closed, false);
  });
  await t.test('failure after detaching published copies restores source links and workspace mode', async () => {
    await seed();
    const masterBefore = (await pool.query('SELECT to_jsonb(t) data FROM master_array_profiles t')).rows;
    const staffBefore = (await pool.query('SELECT to_jsonb(t) data FROM staff_profiles t')).rows;
    await pool.query("CREATE FUNCTION synthetic_unlink_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYN rollback after unlink'; END $$");
    await pool.query('CREATE TRIGGER synthetic_unlink_failure BEFORE UPDATE ON personal_workspaces FOR EACH ROW EXECUTE FUNCTION synthetic_unlink_failure()');
    try {
      const preview = await service.preview(admin, ['personal']);
      await service.start(admin, { token: preview.token, categories: ['personal'], confirmation: CONFIRMATION, acknowledged: true }); await service.running;
      const job = await service.status(admin); assert.equal(job.state, 'failed'); assert.ok(job.backup?.bytes);
      assert.equal(await count('dna_profiles'), 5);
      assert.deepEqual((await pool.query('SELECT to_jsonb(t) data FROM master_array_profiles t')).rows, masterBefore);
      assert.deepEqual((await pool.query('SELECT to_jsonb(t) data FROM staff_profiles t')).rows, staffBefore);
      assert.equal((await pool.query('SELECT enabled FROM workspace_configuration WHERE id=true')).rows[0].enabled, true);
      assert.equal(gate.closed, false);
    } finally {
      await pool.query('DROP TRIGGER synthetic_unlink_failure ON personal_workspaces');
      await pool.query('DROP FUNCTION synthetic_unlink_failure()');
    }
  });
  await t.test('one employee: unrelated profiles, results, pending approvals and reference revisions remain unchanged', async () => {
    await seed();
    const other = await createUser('user_analyst');
    const otherWorkspace = (await pool.query("INSERT INTO personal_workspaces(organization_id,owner_id,analysis_parameters) VALUES($1,$2,'{}') RETURNING id", [org, other.id])).rows[0].id;
    const addOther = async name => (await pool.query("INSERT INTO dna_profiles(user_id,organization_id,workspace_id,sample_name,internal_number,year,expertise_type,str_data) VALUES($1,$2,$3,$4,$4,2026,'ug',$5) RETURNING id", [other.id,org,otherWorkspace,name,{TH01:['12','13']}])).rows[0].id;
    const first = await addOther('SYN other first'), second = await addOther('SYN other second');
    const otherRun = (await pool.query(`INSERT INTO workspace_search_runs(workspace_id,owner_id,organization_id,algorithm_version,state,parameters,workspace_revision,master_revision,staff_revision,completed_at,encrypted_result)
      SELECT w.id,w.owner_id,w.organization_id,'SYN','complete','{}',w.analysis_revision,v.master_revision,v.staff_revision,now(),'SYN other encrypted search'
      FROM personal_workspaces w JOIN workspace_reference_versions v ON v.organization_id=w.organization_id WHERE w.id=$1 RETURNING id`, [otherWorkspace])).rows[0].id;
    await pool.query("INSERT INTO workspace_search_profiles(search_run_id,profile_id,analysis_revision,analysis_hash,state,stages) VALUES($1,$2,1,'SYN-other','CHECKED','{\"internal\":true,\"master\":true,\"staff\":true}')", [otherRun, first]);
    const otherApproval = (await pool.query("INSERT INTO workspace_master_approvals(organization_id,workspace_id,author_id,search_run_id,submission_key,submission_hash) VALUES($1,$2,$3,$4,$5,'SYN other') RETURNING id", [org,otherWorkspace,other.id,otherRun,randomUUID()])).rows[0].id;
    await pool.query("INSERT INTO workspace_master_approval_items(approval_id,search_run_id,profile_id,analysis_revision,analysis_hash,target_id,replace_existing) VALUES($1,$2,$3,1,'SYN-other',$4,false)", [otherApproval,otherRun,first,randomUUID()]);
    await pool.query('INSERT INTO workspace_master_approval_pending(profile_id,approval_id) VALUES($1,$2)', [first,otherApproval]);
    await pool.query("INSERT INTO workspace_import_drafts(workspace_id,owner_id,organization_id,source_checksums,encrypted_payload,expires_at) VALUES($1,$2,$3,'[]','SYN other draft',now()+interval '1 day')", [otherWorkspace,other.id,org]);
    const otherJob = (await pool.query("INSERT INTO workspace_search_jobs(organization_id,owner_id,workspace_id,window_key,origin,policy_revision,parameters) VALUES($1,$2,$3,'SYN-other','scheduled',1,'{}') RETURNING id", [org,other.id,otherWorkspace])).rows[0].id;
    await pool.query("INSERT INTO workspace_search_job_events(job_id,state,reason) VALUES($1,'queued','SYN')", [otherJob]);
    await pool.query("INSERT INTO workspace_search_job_chunks(job_id,organization_id,owner_id,manifest,stage,chunk_index,encrypted_result) VALUES($1,$2,$3,'SYN','master',0,'SYN-other')", [otherJob,org,other.id]);
    const ownProfiles = (await pool.query('SELECT id FROM dna_profiles WHERE workspace_id=$1 ORDER BY id', [workspace])).rows.map(row => row.id);
    const match = async (a,b,who) => (await pool.query("INSERT INTO match_results(profile_id_1,profile_id_2,overall_match_percentage,locus_matches,analyzed_by) VALUES($1,$2,100,'{}',$3) RETURNING id", [a,b,who])).rows[0].id;
    const retainedMatch = await match(first,second,other.id);
    await match(ownProfiles[0],ownProfiles[1],analyst.id); await match(ownProfiles[0],first,other.id);
    const task = (await pool.query("INSERT INTO tasks(created_by,title,target_sample,data_source,department_id,assigned_to_user) VALUES($1,'SYN scoped task','{}','new_array',$2,$3) RETURNING id", [admin.id,department,analyst.id])).rows[0].id;
    await pool.query("INSERT INTO task_results(user_id,task_id,result_data) VALUES($1,$2,'{}'),($3,$2,'{}')", [analyst.id,task,other.id]);
    await pool.query("INSERT INTO duplicate_group_comments(group_identifier,comment,created_by) VALUES('SYN-own','SYN',$1),('SYN-other','SYN',$2)", [analyst.id,other.id]);
    const scope = {mode:'user',userId:analyst.id};
    assert.ok((await service.users(admin)).some(user => user.id === other.id));
    await assert.rejects(service.preview(admin,['personal'],{mode:'user',userId:randomUUID()}), {status:403});
    const preview = await service.preview(admin,['personal'],scope);
    assert.equal(preview.targetUser.id,analyst.id);
    assert.equal(preview.rows.find(row => row.table === 'dna_profiles' && row.action === 'delete').count,3);
    assert.equal(preview.rows.find(row => row.table === 'match_results').count,2);
    await assert.rejects(service.start(admin,{token:preview.token,categories:['personal'],personalScope:{mode:'user',userId:other.id},confirmation:CONFIRMATION,acknowledged:true}), {status:409});
    await assert.rejects(service.start(admin,{token:preview.token,categories:['personal'],confirmation:CONFIRMATION,acknowledged:true}), {status:409});
    // Other employees can import between preview and execution without invalidating this user's scope.
    await addOther('SYN other new upload');
    await pool.query('UPDATE workspace_search_runs SET workspace_revision=(SELECT analysis_revision FROM personal_workspaces WHERE id=$2) WHERE id=$1', [otherRun,otherWorkspace]);
    const retainedTables = {
      dna_profiles:'user_id=$1', personal_workspaces:'owner_id=$1', workspace_import_drafts:'owner_id=$1',
      workspace_search_runs:'owner_id=$1', workspace_search_profiles:`search_run_id IN (SELECT id FROM workspace_search_runs WHERE owner_id=$1)`,
      workspace_master_approvals:'author_id=$1', workspace_master_approval_items:'approval_id IN (SELECT id FROM workspace_master_approvals WHERE author_id=$1)',
      workspace_master_approval_pending:'approval_id IN (SELECT id FROM workspace_master_approvals WHERE author_id=$1)',
      workspace_search_jobs:'owner_id=$1', workspace_search_job_events:'job_id IN (SELECT id FROM workspace_search_jobs WHERE owner_id=$1)',
      workspace_search_job_chunks:'owner_id=$1', task_results:'user_id=$1', duplicate_group_comments:'created_by=$1'
    };
    const retained = async () => Object.fromEntries(await Promise.all(Object.entries(retainedTables).map(async ([table,where]) => [table,(await pool.query(`SELECT to_jsonb(t) data FROM public."${table}" t WHERE ${where} ORDER BY to_jsonb(t)::text`,[other.id])).rows])));
    const before = await retained(), refs = (await pool.query('SELECT * FROM workspace_reference_versions')).rows;
    const master = await snapshot('master_array_profiles'), staff = await snapshot('staff_profiles');
    await service.start(admin,{token:preview.token,categories:['personal'],personalScope:scope,confirmation:CONFIRMATION,acknowledged:true}); await service.running;
    const job = await service.status(admin); assert.equal(job.state,'completed',job.message); assert.equal(job.targetUser.id,analyst.id);
    assert.deepEqual(await retained(),before); assert.deepEqual((await pool.query('SELECT * FROM workspace_reference_versions')).rows,refs);
    assert.deepEqual(await snapshot('master_array_profiles'),master); assert.deepEqual(await snapshot('staff_profiles'),staff);
    assert.equal((await pool.query("SELECT count(*) n FROM dna_profiles WHERE user_id=$1 AND COALESCE(profile_type,'user')='user'", [analyst.id])).rows[0].n,'0');
    assert.equal((await pool.query('SELECT count(*) n FROM match_results')).rows[0].n,'1');
    assert.equal((await pool.query('SELECT id FROM match_results')).rows[0].id,retainedMatch);
    assert.equal((await pool.query('SELECT enabled FROM workspace_configuration WHERE id=true')).rows[0].enabled,true);
    assert.equal(gate.closed,false);
  });

  await t.test('one employee and year: preserve other years, undated profiles and independent results; reset mixed batches', async () => {
    const fixture=await seed(), old=await fixture.source('SYN 2025 profile','ug',null,2025), oldStaff=await fixture.source('SYN 2025 staff','staff',null,2025), future=await fixture.source('SYN 2027','ug',null,2027);
    const c=await pool.connect();
    try {await c.query('BEGIN');await c.query('UPDATE workspace_configuration SET enabled=false WHERE id=true');
      await c.query("INSERT INTO dna_profiles(user_id,organization_id,sample_name,internal_number,str_data,import_format,department_id) VALUES($1,$2,'SYN undated','SYN undated','{}','genetic',$3)",[analyst.id,org,department]);
      await c.query('UPDATE workspace_configuration SET enabled=true WHERE id=true');await c.query('COMMIT');
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
    const other=await createUser('user_analyst'), otherWorkspace=(await pool.query("INSERT INTO personal_workspaces(organization_id,owner_id) VALUES($1,$2) RETURNING id",[org,other.id])).rows[0].id;
    const otherProfiles=[];for(const number of [1,2])otherProfiles.push((await pool.query("INSERT INTO dna_profiles(user_id,organization_id,workspace_id,sample_name,internal_number,year,expertise_type,str_data) VALUES($1,$2,$3,$4,$4,2026,'ug','{}') RETURNING id",[other.id,org,otherWorkspace,'SYN other-year-owner '+number])).rows[0].id);
    const oldStaffRun=await fixture.run(oldStaff), oldPublication=randomUUID(), oldPublishedId=randomUUID();
    await pool.query("INSERT INTO workspace_publications(id,workspace_profile_id,analysis_revision,organization_id,search_run_id,destination,published_id,created_by) VALUES($1,$2,$3,$4,$5,'staff',$6,$7)",[oldPublication,oldStaff.id,oldStaff.analysis_revision,org,oldStaffRun,oldPublishedId,analyst.id]);
    const sc=await pool.connect();try{await sc.query('BEGIN');await sc.query("SELECT set_config('app.workspace_publication_id',$1,true)",[oldPublication]);
      await sc.query("INSERT INTO staff_profiles(id,staff_id,full_name,organization_id,source_workspace_profile_id,year,registration_number,str_data,created_by) VALUES($1,'SYN old staff','SYN employee 2025',$2,$3,2025,$4,$5,$6)",[oldPublishedId,org,oldStaff.id,oldStaff.internal_number,oldStaff.str_data,analyst.id]);await sc.query('COMMIT');
    }catch(error){await sc.query('ROLLBACK');throw error;}finally{sc.release();}
    const oldRun=await fixture.run(old), mixedRun=await fixture.run(future);
    for(const profile of [fixture.pendingSource,old])await pool.query("INSERT INTO workspace_search_profiles(search_run_id,profile_id,analysis_revision,analysis_hash,state,stages) VALUES($1,$2,$3,'SYN','CHECKED','{}')",[mixedRun,profile.id,profile.analysis_revision]);
    async function approval(run,profile){const id=(await pool.query("INSERT INTO workspace_master_approvals(organization_id,workspace_id,author_id,search_run_id,submission_key,submission_hash) VALUES($1,$2,$3,$4,$5,'SYN year') RETURNING id",[org,workspace,analyst.id,run,randomUUID()])).rows[0].id;
      await pool.query("INSERT INTO workspace_master_approval_items(approval_id,search_run_id,profile_id,analysis_revision,analysis_hash,target_id,replace_existing) VALUES($1,$2,$3,$4,'SYN',$5,false)",[id,run,profile.id,profile.analysis_revision,randomUUID()]);
      await pool.query('INSERT INTO workspace_master_approval_pending(profile_id,approval_id) VALUES($1,$2)',[profile.id,id]);return id;}
    const oldApproval=await approval(oldRun,old), mixedApproval=await approval(mixedRun,future);
    const oldJob=(await pool.query("INSERT INTO workspace_search_jobs(organization_id,owner_id,workspace_id,window_key,origin,policy_revision,parameters,state,search_run_id,result_run_id) VALUES($1,$2,$3,'SYN-year2025','scheduled',1,'{}','complete',$4,$4) RETURNING id",[org,analyst.id,workspace,oldRun])).rows[0].id;
    await pool.query("INSERT INTO workspace_search_jobs(organization_id,owner_id,workspace_id,window_key,origin,policy_revision,parameters,state,search_run_id) VALUES($1,$2,$3,'SYN-year2026','scheduled',1,'{}','complete',$4)",[org,analyst.id,workspace,fixture.masterRun]);
    const match=async(a,b)=>(await pool.query("INSERT INTO match_results(profile_id_1,profile_id_2,overall_match_percentage,locus_matches,analyzed_by) VALUES($1,$2,100,'{}',$3) RETURNING id",[a,b,analyst.id])).rows[0].id;
    const keptMatch=await match(old.id,oldStaff.id), keptForeign=await match(...otherProfiles);
    await match(fixture.masterSource.id,fixture.staffSource.id);await match(fixture.masterSource.id,old.id);
    const task=(await pool.query("INSERT INTO tasks(created_by,title,target_sample,data_source,department_id,assigned_to_user) VALUES($1,'SYN year','{}','new_array',$2,$3) RETURNING id",[admin.id,department,analyst.id])).rows[0].id;
    const taskResult=(await pool.query("INSERT INTO task_results(user_id,task_id,result_data) VALUES($1,$2,'{}') RETURNING id",[analyst.id,task])).rows[0].id;
    await pool.query("INSERT INTO duplicate_group_comments(group_identifier,comment,created_by) VALUES('SYN no year','SYN',$1)",[analyst.id]);
    const choices=await service.years(admin,analyst.id);assert.deepEqual(choices.years.map(row=>row.year),[2027,2026,2025]);assert.equal(choices.undatedCount,1);
    const scope={mode:'user',userId:analyst.id,year:2026}, preview=await service.preview(admin,['personal'],scope);
    assert.equal(preview.rows.find(row=>row.table==='dna_profiles').count,3);assert.equal(preview.rows.find(row=>row.table==='match_results').count,2);assert.match(preview.scope,/2026/);
    assert.ok(preview.rows.every(row=>!['workspace_import_drafts','task_results','duplicate_group_comments'].includes(row.table)));
    for(const nextScope of [{mode:'user',userId:analyst.id,year:2025},{mode:'user',userId:analyst.id}])await assert.rejects(service.start(admin,{token:preview.token,categories:['personal'],personalScope:nextScope,confirmation:CONFIRMATION,acknowledged:true}),{status:409});
    await fixture.source('SYN another 2025','ug',null,2025);
    const retained=async()=>({profiles:(await pool.query(`SELECT to_jsonb(p) data FROM dna_profiles p WHERE NOT (user_id=$1 AND year=2026 AND COALESCE(profile_type,'user')='user') OR year IS NULL ORDER BY id`,[analyst.id])).rows,
      runs:(await pool.query('SELECT to_jsonb(r) data FROM workspace_search_runs r WHERE id=$1',[oldRun])).rows,approvals:(await pool.query('SELECT to_jsonb(a) data FROM workspace_master_approvals a WHERE id=$1',[oldApproval])).rows,
      jobs:(await pool.query('SELECT to_jsonb(j) data FROM workspace_search_jobs j WHERE id=$1',[oldJob])).rows,drafts:(await pool.query('SELECT * FROM workspace_import_drafts')).rows,taskResults:(await pool.query('SELECT * FROM task_results WHERE id=$1',[taskResult])).rows,comments:(await pool.query("SELECT * FROM duplicate_group_comments WHERE group_identifier='SYN no year'")).rows});
    const before=await retained(), refs=(await pool.query('SELECT * FROM workspace_reference_versions')).rows, master=await snapshot('master_array_profiles'), staff=await snapshot('staff_profiles');
    await service.start(admin,{token:preview.token,categories:['personal'],personalScope:scope,confirmation:CONFIRMATION,acknowledged:true});await service.running;const job=await service.status(admin);assert.equal(job.state,'completed',job.message);assert.equal(job.personalScope.year,2026);
    assert.deepEqual(await retained(),before);assert.deepEqual((await pool.query('SELECT * FROM workspace_reference_versions')).rows,refs);assert.deepEqual(await snapshot('master_array_profiles'),master);assert.deepEqual(await snapshot('staff_profiles'),staff);
    assert.equal((await pool.query('SELECT source_workspace_profile_id FROM staff_profiles WHERE id=$1',[oldPublishedId])).rows[0].source_workspace_profile_id,oldStaff.id);
    assert.equal((await pool.query('SELECT count(*) n FROM workspace_master_approvals WHERE id=$1',[mixedApproval])).rows[0].n,'0');
    assert.equal((await pool.query('SELECT count(*) n FROM workspace_search_runs WHERE id=$1',[mixedRun])).rows[0].n,'0');
    assert.deepEqual((await pool.query('SELECT id FROM match_results ORDER BY id')).rows.map(row=>row.id),[keptMatch,keptForeign].sort());
    assert.equal((await pool.query("SELECT count(*) n FROM dna_profiles WHERE user_id=$1 AND year=2026 AND COALESCE(profile_type,'user')='user'",[analyst.id])).rows[0].n,'0');
    assert.deepEqual((await service.years(admin,analyst.id)).years.map(row=>row.year),[2027,2025]);
    const emptyScope={mode:'user',userId:analyst.id,year:2024},empty=await service.preview(admin,['personal'],emptyScope);assert.ok(empty.rows.every(row=>row.count===0));
    await assert.rejects(service.start(admin,{token:empty.token,categories:['personal'],personalScope:emptyScope,confirmation:CONFIRMATION,acknowledged:true}),{status:409});assert.equal(gate.closed,false);
  });

});
