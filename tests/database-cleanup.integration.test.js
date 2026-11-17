const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Pool } = require('pg');
const { MaintenanceGate } = require('../src/services/infrastructure/databaseMaintenanceGate');
const { GenotypeCleanupService, CONFIRMATION } = require('../src/services/infrastructure/genotypeCleanupService');

const ALL = ['personal', 'master', 'staff', 'results'];
const url = process.env.CLEANUP_TEST_DATABASE_URL;
test('Genotype cleanup: isolated PostgreSQL, atomicity, authorization, backup and stale previews', { skip: !url }, async t => {
  assert.match(new URL(url).pathname, /^\/dna_cleanup_test(?:_|$)/, 'Cleanup tests MUST use an isolated database');
  const pool = new Pool({ connectionString: url, application_name: 'dna_cleanup_test', max: 5 });
  const gate = new MaintenanceGate(); gate.attach(pool);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dna-cleanup-test-'));
  t.after(async () => { await pool.end(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(Number((await pool.query('SELECT count(*) n FROM users')).rows[0].n), 0, 'Use a NEW schema-only test database');
  const org = (await pool.query("INSERT INTO organizations(name) VALUES('SYN cleanup') RETURNING id")).rows[0].id;
  const user = async role => {
    const id = randomUUID();
    await pool.query('INSERT INTO users(id,username,password_hash,role,organization_id) VALUES($1,$2,$3,$4,$5)', [id, 'SYN-' + id, 'synthetic-not-a-password', role, org]);
    return { id };
  };
  const admin = await user('admin'), analyst = await user('user_analyst'), system = await user('system_administrator');
  await pool.query('INSERT INTO workspace_configuration(id,enabled) VALUES(true,false)');
  const department = (await pool.query("INSERT INTO departments(organization_id,name) VALUES($1,'SYN department') RETURNING id", [org])).rows[0].id;
  const array = (await pool.query("INSERT INTO master_arrays(name,organization_id,department_id) VALUES('SYN master',$1,$2) RETURNING id", [org, department])).rows[0].id;
  await pool.query("INSERT INTO staff_profiles(staff_id,full_name,str_data,organization_id) VALUES('SYN staff','SYN employee',$1,$2)", [{ TH01: ['8', '8'] }, org]);
  await pool.query("INSERT INTO master_array_profiles(master_array_id,sample_name,internal_number,str_data,created_by,organization_id,year) VALUES($1,'SYN master profile','SYN master profile',$2,$3,$4,2026)", [array, { TH01: ['8', '9'] }, admin.id, org]);
  const task = (await pool.query("INSERT INTO tasks(created_by,title,target_sample,data_source,department_id,assigned_to_user) VALUES($1,'SYN task','{}','new_array',$2,$3) RETURNING id", [admin.id, department, analyst.id])).rows[0].id;
  await pool.query("INSERT INTO task_results(user_id,task_id,result_data) VALUES($1,$2,'{}')", [analyst.id, task]);
  await pool.query("INSERT INTO user_settings(user_id,settings) VALUES($1,'{\"theme\":\"dark\"}')", [analyst.id]);
  await pool.query('INSERT INTO workspace_night_policies(organization_id,start_time,end_time) VALUES($1,$2,$3)', [org, '23:30', '06:30']);
  await pool.query("INSERT INTO probability_calculations(user_id,department_id,organization_id,mode,formula_version,reference_version,snapshot_encrypted) VALUES($1,$2,$3,'IDENT','SYN','SYN','synthetic-encrypted-snapshot')", [analyst.id, department, org]);
  const workspace = (await pool.query('INSERT INTO personal_workspaces(organization_id,owner_id,analysis_parameters) VALUES($1,$2,$3) RETURNING id', [org, analyst.id, { contamination: { algorithmVersion: 'v4' } }])).rows[0].id;
  await pool.query('INSERT INTO workspace_reference_versions(organization_id) VALUES($1) ON CONFLICT DO NOTHING', [org]);
  await pool.query("INSERT INTO workspace_import_drafts(workspace_id,owner_id,organization_id,source_checksums,encrypted_payload,expires_at) VALUES($1,$2,$3,'[]','synthetic-encrypted-draft',now()+interval '1 day')", [workspace, analyst.id, org]);
  await pool.query("INSERT INTO workspace_search_jobs(organization_id,owner_id,workspace_id,window_key,origin,policy_revision,parameters) VALUES($1,$2,$3,'SYN-night','scheduled',1,'{}')", [org, analyst.id, workspace]);
  const add = async () => (await pool.query(`INSERT INTO dna_profiles(user_id,organization_id,workspace_id,internal_number,sample_name,year,expertise_type,str_data)
    VALUES($1,$2,$3,$4,$4,2026,'ug',$5) RETURNING id`, [analyst.id, org, workspace, 'SYN-' + randomUUID(), { TH01: ['8', '9'] }])).rows[0].id;
  const profile = await add();
  const service = new GenotypeCleanupService({ pool, gate, connectionString: url, directory });
  const execute = async (target = service, preview) => {
    preview ||= await target.preview(admin, ALL);
    const result = await target.start(admin, { categories: ALL, token: preview.token, confirmation: CONFIRMATION, acknowledged: true });
    await target.running; return target.status(admin, result.id);
  };
  await t.test('analysts cannot preview or execute; admins cannot cross organizations', async () => {
    await assert.rejects(service.preview(analyst, ALL), { status: 403 });
    const foreign = (await pool.query("INSERT INTO organizations(name) VALUES('SYN foreign cleanup') RETURNING id")).rows[0].id;
    await assert.rejects(service.preview(admin, ALL), { status: 403 });
    assert.ok((await service.preview(system, ALL)).token);
    await pool.query('DELETE FROM organizations WHERE id=$1', [foreign]);
  });
  await t.test('preview only, confirmation and nonce owner checks', async () => {
    const preview = await service.preview(admin, ALL);
    assert.equal(preview.rows.find(row => row.table === 'dna_profiles').count, 1);
    await assert.rejects(service.start(admin, { categories: ALL, token: preview.token, confirmation: 'wrong', acknowledged: true }), { status: 400 });
    await assert.rejects(service.start(system, { categories: ALL, token: preview.token, confirmation: CONFIRMATION, acknowledged: true }), { status: 409 });
    assert.equal((await pool.query('SELECT count(*) n FROM dna_profiles')).rows[0].n, '1');
  });
  await t.test('same row count but changed genotype invalidates preview before backup', async () => {
    const preview = await service.preview(admin, ALL);
    await pool.query('UPDATE dna_profiles SET str_data=$2 WHERE id=$1', [profile, { TH01: ['9', '10'] }]);
    const job = await execute(service, preview);
    assert.equal(job.state, 'failed'); assert.match(job.message, /Данные изменились/); assert.equal(job.backup, null); assert.equal(gate.closed, false);
  });
  await t.test('backup failure rolls back and reopens API', async () => {
    let backupAttempted = false, resumed = false;
    const broken = new GenotypeCleanupService({ pool, gate, connectionString: url, directory,
      hooks: { pause: () => pool.query("UPDATE workspace_search_jobs SET stage='SYN stopping',updated_at=now()"), resume: async () => { resumed = true; } },
      backup: async () => { backupAttempted = true; throw Error('synthetic disk failure'); } });
    const job = await execute(broken);
    assert.equal(job.state, 'failed'); assert.equal(gate.closed, false);
    assert.equal(backupAttempted, true, 'Stopping a night job must not invalidate genotype confirmation');
    assert.equal(resumed, true);
    assert.equal((await pool.query('SELECT count(*) n FROM dna_profiles')).rows[0].n, '1');
  });
  await t.test('unexpected FK dependency stops cleanup without cascading into protected data', async () => {
    await pool.query('CREATE TABLE synthetic_preserved_link(profile_id uuid REFERENCES dna_profiles(id))');
    await assert.rejects(service.preview(admin, ALL), { status: 409 });
    await pool.query('DROP TABLE synthetic_preserved_link');
    await pool.query('ALTER TABLE staff_profiles ADD COLUMN synthetic_master_id uuid REFERENCES master_array_profiles(id) ON DELETE CASCADE');
    try { await assert.rejects(service.preview(admin, ['master']), { status: 409 }); }
    finally { await pool.query('ALTER TABLE staff_profiles DROP COLUMN synthetic_master_id'); }
  });
  await t.test('a failure after deletion rolls back profiles and leaves a downloadable backup', async () => {
    await pool.query("CREATE FUNCTION synthetic_cleanup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic post-truncate failure'; END $$");
    await pool.query('CREATE TRIGGER synthetic_cleanup_failure BEFORE UPDATE ON personal_workspaces FOR EACH ROW EXECUTE FUNCTION synthetic_cleanup_failure()');
    try {
      const job = await execute();
      assert.equal(job.state, 'failed'); assert.ok(job.backup); assert.equal(gate.closed, false);
      assert.equal((await pool.query('SELECT count(*) n FROM dna_profiles')).rows[0].n, '1');
      assert.equal((await pool.query('SELECT count(*) n FROM staff_profiles')).rows[0].n, '1');
      assert.equal((await pool.query('SELECT count(*) n FROM master_array_profiles')).rows[0].n, '1');
      assert.ok((await service.backupFile(admin, job.id)).file);
    } finally {
      await pool.query('DROP TRIGGER synthetic_cleanup_failure ON personal_workspaces');
      await pool.query('DROP FUNCTION synthetic_cleanup_failure()');
    }
  });
  await t.test('verified full backup, atomic cleanup and retained accounts/settings', async () => {
    const before = (await pool.query('SELECT analysis_revision,analysis_parameters FROM personal_workspaces WHERE id=$1', [workspace])).rows[0];
    const job = await execute();
    assert.equal(job.state, 'completed', job.message);
    assert.ok(job.backup.bytes > 0); assert.match(job.backup.sha256, /^[a-f0-9]{64}$/);
    const { file } = await service.backupFile(admin, job.id);
    assert.equal((await fs.readFile(file)).subarray(0, 5).toString(), 'PGDMP');
    for (const row of job.rows) assert.equal((await pool.query(`SELECT count(*) n FROM public."${row.table}"`)).rows[0].n, '0', row.table);
    assert.equal((await pool.query('SELECT count(*) n FROM users')).rows[0].n, '3');
    assert.equal((await pool.query('SELECT count(*) n FROM tasks')).rows[0].n, '1');
    assert.equal((await pool.query('SELECT count(*) n FROM master_arrays')).rows[0].n, '1');
    assert.equal((await pool.query('SELECT count(*) n FROM probability_calculations')).rows[0].n, '1');
    assert.deepEqual((await pool.query('SELECT settings FROM user_settings WHERE user_id=$1', [analyst.id])).rows[0].settings, { theme: 'dark' });
    assert.equal((await pool.query('SELECT start_time FROM workspace_night_policies WHERE organization_id=$1', [org])).rows[0].start_time, '23:30');
    const after = (await pool.query('SELECT analysis_revision,analysis_parameters FROM personal_workspaces WHERE id=$1', [workspace])).rows[0];
    assert.deepEqual(after.analysis_parameters, before.analysis_parameters); assert.equal(BigInt(after.analysis_revision), BigInt(before.analysis_revision) + 1n);
    assert.equal(gate.closed, false);
    assert.equal((await service.status(admin)).id, job.id);
    const restarted = new GenotypeCleanupService({ pool, gate, connectionString: url, directory });
    assert.equal((await restarted.status(admin)).state, 'completed');
    // New uploads continue to work after maintenance.
    await add();
    if (process.env.CLEANUP_TEST_BACKUP_COPY) await fs.copyFile(file, process.env.CLEANUP_TEST_BACKUP_COPY);
  });
  await t.test('HTTP API checks real sessions, admin roles and confirmation before starting', async () => {
    Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: 'test', JWT_SECRET: 'synthetic-cleanup-test-secret' });
    const originalInterval = global.setInterval;
    global.setInterval = (...args) => originalInterval(...args).unref();
    const express = require('express'), app = express();
    const database = require('../src/config/database');
    const User = require('../src/models/User'), auth = require('../src/services/security/authService');
    const tokens = {};
    for (const [role, actor] of [['admin', admin], ['analyst', analyst]]) {
      const user = await User.findById(actor.id);
      tokens[role] = auth.generateToken(user);
      await auth.createSession(actor.id, tokens[role], '127.0.0.1', 'synthetic-cleanup-api');
    }
    app.use(express.json());
    app.use('/api/admin/database-maintenance', require('../src/routes/databaseMaintenance')());
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/admin/database-maintenance`;
    try {
      assert.equal((await fetch(base + '/preview')).status, 401);
      assert.equal((await fetch(base + '/preview?categories=personal,master,staff,results', { headers: { Authorization: 'Bearer ' + tokens.analyst } })).status, 403);
      const headers = { Authorization: 'Bearer ' + tokens.admin, 'Content-Type': 'application/json' };
      const preview = await fetch(base + '/preview?categories=personal,master,staff,results', { headers });
      assert.equal(preview.status, 200); assert.match(preview.headers.get('Cache-Control'), /no-store/);
      const data = await preview.json(); assert.ok(data.token);
      const listed = await fetch(base + '/users', {headers}); assert.equal(listed.status,200);
      const people = (await listed.json()).users; assert.equal(people.length,3);
      assert.ok(people.every(person => !('password_hash' in person) && !('email' in person)));
      const scopedResponse = await fetch(base + '/preview?categories=personal&personalMode=user&personalUserId='+analyst.id, {headers});
      assert.equal(scopedResponse.status,200); const scopedPreview = await scopedResponse.json(); assert.equal(scopedPreview.targetUser.id,analyst.id);
      const available=await fetch(base+'/users/'+analyst.id+'/years',{headers});assert.equal(available.status,200);
      assert.deepEqual((await available.json()).years.map(row=>row.year),[2026]);
      assert.equal((await fetch(base+'/users/not-a-uuid/years',{headers})).status,400);
      const yearResponse=await fetch(base+'/preview?categories=personal&personalMode=user&personalUserId='+analyst.id+'&year=2026',{headers});
      assert.equal(yearResponse.status,200);const yearPreview=await yearResponse.json();assert.equal(yearPreview.personalScope.year,2026);

      assert.equal((await fetch(base + '/preview?categories=personal&personalMode=user', {headers})).status,400);

      assert.equal((await fetch(base + '/preview', { headers })).status, 400);
      assert.equal((await fetch(base + '/preview?categories=personal&personalMode=user&personalUserId='+analyst.id+'&year=2026x', { headers })).status, 400);
      assert.equal((await fetch(base + '/execute', { headers, method: 'POST', body: '{}' })).status, 400);
      assert.equal((await fetch(base + '/execute', { headers, method: 'POST', body: JSON.stringify({ categories: ALL, token: data.token, confirmation: 'wrong', acknowledged: true }) })).status, 400);
      assert.equal((await fetch(base + '/execute', {headers,method:'POST',body:JSON.stringify({token:yearPreview.token,categories:['personal'],personalScope:{mode:'user',userId:analyst.id,year:2025},confirmation:CONFIRMATION,acknowledged:true})})).status,409);
      assert.equal((await fetch(base + '/not-a-uuid/backup', { headers })).status, 400);
      assert.equal((await pool.query('SELECT count(*) n FROM dna_profiles')).rows[0].n, '1');
    } finally {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      await database.pool.end(); global.setInterval = originalInterval;
    }
  });
});
