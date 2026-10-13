const assert = require('node:assert/strict');
const Module = require('node:module');
const { getSearchSnapshots } = require('../../src/services/searchSnapshotStore');
const scopeCalls = [];
const replacements = {
  '../../src/middleware/auth': { authenticate: (_req, _res, next) => next() },
  '../../src/models/DNAProfile': {},
  '../../src/services/profileAccessService': {
    ProfileAccessService: {
      getScope: async context => {
        scopeCalls.push(context);
        return { clause: 'dp.department_id = $1 AND dp.organization_id = $2', params: ['unit-department', 'unit-organization'] };
      }
    }
  }
};
const saved = new Map();
let router;
try {
  for (const [name, exports] of Object.entries(replacements)) {
    const id = require.resolve(name); saved.set(id, require.cache[id]);
    const stub = new Module(id); stub.filename = id; stub.loaded = true; stub.exports = exports;
    require.cache[id] = stub;
  }
  router = require('../../src/routes/genotypeAnalysisRoutes');
} finally {
  for (const [id, original] of saved) {
    if (original) require.cache[id] = original;
    else delete require.cache[id];
  }
}
const handler = router.stack.find(layer => layer.route?.path === '/mass-search').route.stack.at(-1).handle;

async function invoke(profiles, body = {}) {
  const queries = [], request = {
    body, user: { id: 'unit-user', department_id: 'unit-primary-department' },
    activeDepartmentId: 'unit-department',
    app: { locals: { pool: { query: async (...args) => { queries.push(args); return { rows: structuredClone(profiles) }; } } } }
  };
  let response;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { response = value; } };
  await handler(request, res);
  assert.equal(res.statusCode, 200, JSON.stringify(response));
  assert.deepEqual(scopeCalls.at(-1), { userId: 'unit-user', activeDepartmentId: 'unit-department' });
  assert.match(queries[0][0], /dp\.department_id = \$\d+ AND dp\.organization_id = \$\d+/);
  assert.deepEqual(queries[0][1].slice(-2), ['unit-department', 'unit-organization']);
  if (body.profileIds?.length) {
    assert.deepEqual(queries[0][1][0], body.profileIds);
    assert.match(queries[0][0], /id = ANY\(\$1\)/);
    assert.match(queries[0][0], /dp\.department_id = \$2 AND dp\.organization_id = \$3/);
  }
  const snapshot = response.exportSnapshot?.id
    ? getSearchSnapshots([response.exportSnapshot.id], { userId: 'unit-user', departmentId: 'unit-department' })[0]
    : null;
  return { response, snapshot, queries };
}

function stable(response) {
  return {
    success: response.success, results: response.results, totalAnalyzed: response.totalAnalyzed,
    resultsWithMatches: response.resultsWithMatches,
    comparisons: response.statistics.comparisons, earlyExits: response.statistics.earlyExits
  };
}

function cases() {
  const profile = (id, data, extras = {}) => ({ id, sample_name: id, internal_number: id, import_number: '258', import_format: 'genetic', year: 2026, str_data: data, ...extras });
  const data = { TH01: ['12', '13'], D5S818: ['11', '12'], D21S11: ['29', '30'] };
  const small = [profile('a', data), profile('b', { ...data, TH01: ['13', '12'] }), profile('c', { TH01: ['12', '12'], D5S818: ['11'], D21S11: [] }), profile('d', { TH01: ['?', '*'] })];
  const sameNames = [profile('year-a', data, { sample_name: '258-1', year: 2025 }), profile('year-b', data, { sample_name: '258-1', year: 2026 })];
  return [
    { name: 'empty', profiles: [], body: { minMatches: 3 } },
    { name: 'small', profiles: small, body: { minMatches: 3 } },
    { name: 'partial', profiles: small, body: { minMatches: 1 } },
    { name: 'ignored', profiles: small, body: { minMatches: 3, ignoredLoci: ['TH01'] } },
    { name: 'selected', profiles: small.slice(0, 2), body: { minMatches: 3, profileIds: ['a', 'b'] } },
    { name: 'genetic-same-name', profiles: sameNames, body: { minMatches: 3 } },
    { name: 'emergency-same-name', profiles: sameNames.map(p => ({ ...p, import_format: 'emergency' })), body: { minMatches: 3 } },
    { name: 'large', profiles: Array.from({ length: 104 }, (_, index) => profile(`large-${index}`, index < 2 ? data : { TH01: [String(100 + index), String(200 + index)], D5S818: [String(300 + index), String(400 + index)], D21S11: [String(500 + index), String(600 + index)] })), body: { minMatches: 3 } }
  ];
}
module.exports = { invoke, stable, cases };
