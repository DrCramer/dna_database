const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, stable, cases } = require('./fixtures/mass-search-harness');
const fixtures = require('./fixtures/mass-search-baseline.json');

test('Массовый API: параллельный и последовательный пути сохраняют baseline и SQL-изоляцию', async () => {
  for (const scenario of cases()) {
    const expected = fixtures.records.find(record => record.name === scenario.name);
    const original = structuredClone(scenario.profiles);
    for (const useWorkers of [false, true]) {
      const { response, snapshot } = await invoke(scenario.profiles, { ...scenario.body, useWorkers });
      assert.deepEqual(stable(response), expected.result, `${scenario.name}, workers=${useWorkers}`);
      assert.equal(snapshot?.pairs?.length || 0, expected.pairCount);
      assert.equal(response.statistics.mode, useWorkers && scenario.profiles.length > 100 ? 'multi-threaded' : 'single-threaded-optimized');
      assert.deepEqual(scenario.profiles, original);
    }
  }
});

test('Параллельный поиск сохраняет порядок, дедупликацию пар и полный snapshot за пределами top-100', async () => {
  const sample = cases().find(scenario => scenario.name === 'small').profiles[0];
  const profiles = Array.from({ length: 103 }, (_, index) => ({ ...structuredClone(sample), id: `top-${index}`, sample_name: `top-${index}`, internal_number: `top-${index}` }));
  const sequential = await invoke(profiles, { minMatches: 3, useWorkers: false });
  const parallel = await invoke(profiles, { minMatches: 3, useWorkers: true });
  assert.deepEqual(stable(parallel.response), stable(sequential.response));
  assert.equal(parallel.response.results[0].matches.length, 100);
  assert.equal(parallel.snapshot.pairs.length, 103 * 102 / 2);
  const keys = parallel.snapshot.pairs.map(pair => [pair.referenceProfileId, pair.matchedProfileId].sort().join('|'));
  assert.equal(new Set(keys).size, keys.length);
});
