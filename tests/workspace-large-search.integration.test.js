const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { syntheticProfiles } = require('../scripts/benchmark-task-search');

const url = process.env.WORKSPACE_TEST_DATABASE_URL;

test('Полный поиск обрабатывает 13 000 выбранных профилей в пределах личного массива', { skip: !url }, async t => {
  assert.match(new URL(url).pathname, /^\/dna_workspace_test(?:_|$)/);
  Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: 'test', UNIFIED_WORKSPACE_ENABLED: 'true', JWT_SECRET: 'synthetic-large-workspace-search' });
  const interval = global.setInterval;
  global.setInterval = (...args) => interval(...args).unref();
  const { pool } = require('../src/config/database');
  const User = require('../src/models/User');
  const auth = require('../src/services/security/authService');
  const { WorkspaceApprovalService } = require('../src/services/workspace/workspaceApprovalService');
  const { MAX_SEARCH_PROFILES } = require('../src/services/workspace/workspaceSearchService');
  const { readSearchStream } = require('../src/utils/searchProgressProtocol');
  const express = require('express');
  const service = new WorkspaceApprovalService(pool);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/workspace', require('../src/routes/workspace')(service));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    global.setInterval = interval;
    await pool.end();
  });
  await new Promise(resolve => server.once('listening', resolve));
  await pool.query('INSERT INTO workspace_configuration(id,enabled) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET enabled=true');
  const { rows: [{ id: org }] } = await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', ['SYN-' + randomUUID()]);
  async function createWorkspace() {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,username,password_hash,role,organization_id) VALUES($1,$2,'synthetic','user_analyst',$3)", [id, 'SYN-' + id, org]);
    const actor = await User.findById(id);
    return { actor, workspace: await service.workspace(actor) };
  }
  const own = await createWorkspace();
  const other = await createWorkspace();
  const token = auth.generateToken(own.actor);
  await auth.createSession(own.actor.id, token, '127.0.0.1', 'synthetic-large-workspace-search');
  const profiles = syntheticProfiles(13000).map(({ internal_number, str_data }) => ({ id: randomUUID(), internal_number, str_data }));
  const foreign = { ...profiles[0], id: randomUUID() };
  async function insertProfiles({ actor, workspace }, rows) {
    for (let offset = 0; offset < rows.length; offset += 1000) {
      await pool.query(`INSERT INTO dna_profiles(id,user_id,organization_id,workspace_id,year,internal_number,sample_name,str_data,import_format,expertise_type)
        SELECT p.id,$1,$2,$3,2026,p.internal_number,'SYN',p.str_data,'genetic','ug'
        FROM jsonb_to_recordset($4::jsonb) AS p(id uuid,internal_number text,str_data jsonb)`, [actor.id, org, workspace.id, JSON.stringify(rows.slice(offset, offset + 1000))]);
    }
  }
  await insertProfiles(own, profiles);
  await insertProfiles(other, [foreign]);
  const call = (path, ids) => fetch(`http://127.0.0.1:${server.address().port}/api/workspace${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids })
  });
  const ids = profiles.map(profile => profile.id);
  const before = performance.now();
  const stages = new Set();
  const search = await call('/full-search/stream', ids);
  assert.equal(search.status, 200);
  const result = await readSearchStream(search, progress => stages.add(progress.stage));
  t.diagnostic(`Потоковый поиск 13 000 синтетических объектов: ${Math.round(performance.now() - before)} мс`);
  assert.deepEqual([...stages], ['preparing', 'internal', 'master', 'staff', 'saving', 'complete']);
  assert.equal(result.referenceCounts.workspace, profiles.length);
  assert.equal(result.profiles.length, profiles.length);
  assert(result.profiles.every(proof => proof.state === 'CHECKED'));
  assert(result.internal.results.some(group => group.reference.id === ids[99] && group.matches.some(match => match.id === ids[100])));
  assert(!result.internal.results.some(group => group.matches.some(match => match.id === foreign.id)));
  const { rows: [{ count }] } = await pool.query("SELECT count(*)::int AS count FROM workspace_search_profiles WHERE search_run_id=$1 AND state='CHECKED'", [result.id]);
  assert.equal(count, profiles.length);

  const foreignSearch = await call('/full-search', [...ids.slice(0, -1), foreign.id]);
  assert.equal(foreignSearch.status, 403);
  const legacy = await call('/full-search', [ids[0].toUpperCase()]);
  assert.equal(legacy.status, 200);
  assert.deepEqual((await legacy.json()).profiles.map(proof => proof.profileId), [ids[0]]);
  const extraIds = Array.from({ length: MAX_SEARCH_PROFILES - ids.length + 1 }, () => randomUUID());
  const oversized = await call('/full-search/stream', [...ids, ...extraIds]);
  assert.equal(oversized.status, 400);
  const error = await oversized.json();
  assert.equal(error.code, 'SEARCH_SELECTION_LIMIT');
  assert.match(error.message, new RegExp(String(MAX_SEARCH_PROFILES)));
  assert.equal((await call('/profiles/export', ids)).status, 400);
});
