const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.WORKSPACE_TEST_DATABASE_URL;
test('Workspace list: 3000 profiles with search history retain proof freshness, night fallback and isolation', { skip: !url }, async t => {
  assert.match(new URL(url).pathname, /^\/dna_workspace_test(?:_|$)/);
  Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: 'test', DB_STATEMENT_TIMEOUT: '10000' });
  const interval = global.setInterval; global.setInterval = (...args) => interval(...args).unref();
  const { pool } = require('../src/config/database');
  const { WorkspaceService } = require('../src/services/workspace/workspaceService');
  const { ALGORITHM_VERSION } = require('../src/services/workspace/workspaceSearchService');
  t.after(async () => { global.setInterval = interval; await pool.end(); });
  await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../database/migrations/040_night_search.sql'), 'utf8'));
  const service = new WorkspaceService(pool);
  const org = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', ['SYN-list-' + randomUUID()])).rows[0].id;
  const user = (await pool.query("INSERT INTO users(username,password_hash,role,organization_id) VALUES($1,'synthetic-not-a-password','user_analyst',$2) RETURNING id,organization_id,role,is_active", ['SYN-list-' + randomUUID(), org])).rows[0];
  const w = await service.workspace(user);
  const provenance = { sourceFilename: 'SYN.xlsx', assignedNumber: '', alleleOrigins: Array.from({ length: 28 }, (_, i) => ({ column: i + 5, input: '7,9.3', locus: 'SYN' + i })) };
  await pool.query(`INSERT INTO dna_profiles(id,user_id,organization_id,workspace_id,year,internal_number,sample_name,str_data,import_format,expertise_type,provenance,file_source)
    SELECT gen_random_uuid(),$1,$2,$3,2026,'SYN-'||n,'SYN', '{"TH01":["7","9.3"],"D21S11":["30","*","?"]}'::jsonb,'genetic','ug',$4::jsonb,'SYN.xlsx' FROM generate_series(1,3000) n`, [user.id, org, w.id, provenance]);
  await pool.query(`UPDATE dna_profiles SET expertise_type='chs', provenance=$2 WHERE workspace_id=$1 AND internal_number='SYN-1'`,
    [w.id, { sourceFilename: 'SYN-legacy.xlsx', legacyColumns: [{ header: 'Ростовский номер', value: 'R-1' }] }]);
  const workspace = await service.workspace(user), refs = (await pool.query('SELECT * FROM workspace_reference_versions WHERE organization_id=$1', [org])).rows[0];
  const ids = (await pool.query('SELECT id,analysis_revision FROM dna_profiles WHERE workspace_id=$1 ORDER BY id', [w.id])).rows;
  async function run(state, origin, ago, selected = ids) {
    const row = (await pool.query(`INSERT INTO workspace_search_runs(workspace_id,owner_id,organization_id,algorithm_version,state,origin,parameters,workspace_revision,master_revision,staff_revision,started_at,completed_at)
      VALUES($1,$2,$3,$4,$5,$6,'{}',$7,$8,$9,now()-($10*interval '1 second'),now()) RETURNING id`, [w.id, user.id, org, ALGORITHM_VERSION, state, origin, workspace.analysis_revision, refs.master_revision, refs.staff_revision, ago])).rows[0];
    await pool.query(`INSERT INTO workspace_search_profiles(search_run_id,profile_id,analysis_revision,analysis_hash,state,stages)
      SELECT $1,p.id,p.analysis_revision,repeat('a',64),'CHECKED','{"internal":true,"master":true,"staff":true}'::jsonb FROM dna_profiles p WHERE p.id=ANY($2::uuid[])`, [row.id, selected.map(p => p.id)]);
    return row.id;
  }
  for (let i = 0; i < 12; i++) await run('complete', 'manual', 100 + i);
  const complete = await run('complete', 'night', 10);
  await run('failed', 'night', 2); // failed night attempts must not replace complete proofs
  const failed = await run('failed', 'manual', 1, [ids[0]]);
  await pool.query('UPDATE workspace_search_profiles SET analysis_revision=analysis_revision-1 WHERE search_run_id=$1 AND profile_id=$2', [complete, ids[1].id]);
  async function measure(options) {
    const start = performance.now();
    const data = await service.list(user, options);
    const bytes = Buffer.byteLength(JSON.stringify(data));
    return { data, bytes, ms: Math.round(performance.now() - start) };
  }
  const legacy = await measure();
  const first = await measure({ table: true, firstPage: true });
  const table = await measure({ table: true });
  const { data } = legacy;
  assert.equal(data.profiles.length, 3000);
  assert.equal(data.profiles.find(p => p.id === ids[0].id).searchRunId, failed);
  assert.equal(data.profiles.find(p => p.id === ids[0].id).searchState, 'STALE');
  assert.equal(data.profiles.find(p => p.id === ids[1].id).searchState, 'STALE');
  assert(data.profiles.filter(p => ![ids[0].id, ids[1].id].includes(p.id)).every(p => p.searchRunId === complete && p.searchState === 'CHECKED'));
  assert.deepEqual(data.profiles[0].strData.D21S11, ['30', '*', '?']);
  assert.equal(first.data.hasMore, true);
  assert.equal(first.data.profiles.length, 50);
  assert.deepEqual(first.data.profiles, table.data.profiles.slice(0, 50));
  assert.deepEqual(table.data.profiles, data.profiles.map(({ provenance, ...row }) => ({ ...row, sourceFilename: provenance.sourceFilename })));
  assert.equal(table.data.profiles.find(row => row.objectNumber === 'SYN-1').assignedNumber, 'R-1');
  assert(table.bytes < legacy.bytes / 2);
  await assert.rejects(service.list({ ...user, is_active: false }), e => e.status === 403);
  await assert.rejects(service.list({ ...user, is_active: false }, { table: true, firstPage: true }), e => e.status === 403);
  const other = (await pool.query("INSERT INTO users(username,password_hash,role,organization_id) VALUES($1,'synthetic','user_analyst',$2) RETURNING id,organization_id,role,is_active", ['SYN-other-' + randomUUID(), org])).rows[0];
  assert.equal((await service.list(other)).profiles.length, 0);
  const empty = await service.list(other, { table: true, firstPage: true });
  assert.deepEqual(empty.profiles, []);
  assert.equal(empty.hasMore, false);
  t.diagnostic(`Synthetic 3000 profiles, 14 full searches. Previous response: ${legacy.ms} ms, ${legacy.bytes} bytes. First page: ${first.ms} ms, ${first.bytes} bytes. Compact full table: ${table.ms} ms, ${table.bytes} bytes.`);
});
