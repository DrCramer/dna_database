const test = require('node:test');
const assert = require('node:assert/strict');
const { runStaffSearch } = require('../src/services/contamination/staffSearchWorkerExecutor');
const { runProfileSearch, workerLimit } = require('../src/services/profiles/searchWorkerExecutor');
const { syntheticProfiles } = require('../scripts/benchmark-task-search');
const baseline = require('./fixtures/staff-search-baseline.json');
const json = value => JSON.parse(JSON.stringify(value));

test('Staff workers: frozen v1.5/v4/v5 results, special alleles, panels, sex filtering and self exclusions stay identical', async () => {
  for (const { input, expected } of baseline.records) {
    const before = structuredClone(input);
    for (const useWorkers of [false, true]) {
      const result = await runStaffSearch(input, { useWorkers, minParallelComparisons: 0 });
      assert.deepEqual(json(result.results), expected);
      assert.equal(result.comparisons, 11);
      assert.equal(result.workerCount, useWorkers ? Math.min(workerLimit(), input.referenceProfiles.length) : 0);
    }
    assert.deepEqual(input, before, 'original profiles/alleles are immutable');
  }
});

test('One sample against staff uses candidate partitions with full-array locus order and stable tie sorting', async () => {
  for (const record of baseline.records) {
    const input = { ...record.input, referenceProfiles: [record.input.referenceProfiles[0]] };
    const single = await runStaffSearch(input, { useWorkers: false });
    const parallel = await runStaffSearch(input, { minParallelComparisons: 0 });
    assert.deepEqual(json(parallel.results), json(single.results));
    assert.equal(parallel.comparisons, single.comparisons);
    assert.equal(parallel.workerCount, Math.min(workerLimit(), input.staffProfiles.length));
  }
});

test('Staff worker failure, queued and active cancellation release the shared profile/staff CPU queue', async () => {
  const input = baseline.records[0].input;
  await assert.rejects(runStaffSearch({ ...input, excludedStaffIds: [['sample-0', 9]] }, { minParallelComparisons: 0 }), /iterable/);
  const profiles = syntheticProfiles(300);
  const running = runProfileSearch({ referenceProfiles: profiles, compareProfiles: profiles }, { minParallelComparisons: 0 });
  const waitingController = new AbortController();
  const waiting = runStaffSearch(input, { minParallelComparisons: 0, signal: waitingController.signal });
  waitingController.abort(new Error('SYN queued staff cancellation'));
  await assert.rejects(waiting, /SYN queued/);
  await running;
  const controller = new AbortController();
  const active = runStaffSearch({ referenceProfiles: profiles, staffProfiles: profiles.slice(0, 100) }, { signal: controller.signal });
  const rejectActive = assert.rejects(active, /SYN active staff cancellation/);
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort(new Error('SYN active staff cancellation'));
  await rejectActive;
  assert.equal((await runStaffSearch(input, { minParallelComparisons: 0 })).results.length, 4);
});

test('Staff workers keep the HTTP event loop responsive and honour the configured CPU limit', async () => {
  const profiles = syntheticProfiles(130);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    const result = await runStaffSearch({ referenceProfiles: profiles, staffProfiles: profiles.slice(0, 30) });
    assert.equal(result.mode, 'multi-threaded');
    assert(result.workerCount > 0 && result.workerCount <= workerLimit());
    assert.equal(result.comparisons, 3900);
    assert(ticks > 1);
  } finally { clearInterval(timer); }
});
