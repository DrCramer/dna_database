const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const { syntheticProfiles } = require('../scripts/benchmark-task-search');

test('API задач, мастер-массива и отдела сохраняет результаты и экспорт при включении workers', async t => {
  const profiles = syntheticProfiles(102);
  const saved = new Map();
  const replacements = {
    '../src/middleware/auth': { authenticate(req, _res, next) {
      req.user = { id: 'fixture-user', department_id: 'fixture-dept', organization_id: 'fixture-org' };
      req.activeDepartmentId = 'fixture-dept'; next();
    } },
    '../src/utils/logger': { logger: { info() {}, error() {}, warn() {} } },
    '../src/services/security/profileAccessService': { ProfileAccessService: { getScope: async () => ({ params: ['fixture-dept', 'fixture-org'] }) } },
    '../src/services/security/AccessPolicyService': { canManageTask: async () => true },
    '../src/models/DNAProfile': { findByTaskId: async taskId => {
      assert.equal(taskId, '11111111-1111-4111-8111-111111111111');
      return profiles.map(p => ({ id: p.id, sampleName: p.sample_name, internalNumber: p.internal_number, year: p.year, strData: p.str_data }));
    } },
    '../src/models/MasterArray': { getHotCandidatesWithPairs: async (_profile, scope) => {
      assert.equal(scope.organizationId, 'fixture-org');
      return profiles.map(p => ({ ...p, loci: p.str_data }));
    } },
    '../src/services/contamination/contaminationLogger': { logSearchResults: async () => {} }
  };
  for (const [name, exports] of Object.entries(replacements)) {
    const id = require.resolve(name); saved.set(id, require.cache[id]);
    const stub = new Module(id); stub.filename = id; stub.loaded = true; stub.exports = exports;
    require.cache[id] = stub;
  }
  t.after(() => { for (const [id, original] of saved) { if (original) require.cache[id] = original; else delete require.cache[id]; } });
  const app = express();
  app.use(express.json());
  app.locals.pool = { query: async (sql, params) => {
    if (sql.includes('SELECT t.id, t.department_id')) { assert.deepEqual(params, ['11111111-1111-4111-8111-111111111111']); return { rows: [{ id: '11111111-1111-4111-8111-111111111111', department_id: 'fixture-dept', organization_id: 'fixture-org' }] }; }
    if (sql.includes('SELECT DISTINCT t.id')) {
      assert.deepEqual(params, ['fixture-dept', '11111111-1111-4111-8111-111111111111', 'fixture-org']);
      return { rows: [{ id: 'other-task' }] };
    }
    if (sql.includes('ANY($1)')) assert.deepEqual(params, [['other-task'], 'fixture-dept', 'fixture-org']);
    else assert.deepEqual(params, ['11111111-1111-4111-8111-111111111111', 'fixture-dept', 'fixture-org']);
    return { rows: structuredClone(profiles) };
  } };
  app.use('/analysis', require('../src/routes/genotypeAnalysisRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/analysis`;
  for (const searchMode of ['task', 'master_array', 'department_tasks']) {
    const responses = [];
    for (const useWorkers of [false, true]) {
      const response = await fetch(`${base}/${searchMode === 'department_tasks' ? 'department-tasks-search' : 'task-search'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: '11111111-1111-4111-8111-111111111111', searchMode, useWorkers, comparisonAlgorithm: 'duplicate_v5' })
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      const stats = body.statistics || body.stats;
      assert.equal(stats.mode, useWorkers ? 'multi-threaded' : 'single-threaded-optimized');
      responses.push(body);
    }
    assert.deepEqual(responses[0].results, responses[1].results);
    assert.deepEqual(responses[0].exportSnapshot.pairKeys, responses[1].exportSnapshot.pairKeys);
  }
});
