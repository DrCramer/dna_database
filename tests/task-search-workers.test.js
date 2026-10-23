const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/task-search-baseline.json');
const { runProfileSearch, workerLimit } = require('../src/services/profiles/searchWorkerExecutor');
const { syntheticProfiles } = require('../scripts/benchmark-task-search');
const json = value => JSON.parse(JSON.stringify(value));

test('Предобработка duplicate_v5 сохраняет скор, ранние выходы и детали на разных типах аллелей и весах', () => {
  const { createDuplicateSimilarityComparator, calculateDuplicateSimilarityOptimized, isDuplicateOptimized } = require('../src/services/profiles/duplicateDetectionService');
  const profiles = syntheticProfiles(25).map(profile => profile.str_data);
  profiles.push({ TH01: ['?', 'F'], FGA: [], DYS391: ['10'] }, { TH01: ['7'], FGA: ['20', '22', '23'] }, { TH01: '7,9', FGA: ['20', '22'] });
  for (const thresholds of [{ minScore: 1, minPercentage: 10, minLoci: 1 }, { minScore: 15, minPercentage: 80, minLoci: 15 }]) {
    const options = { ignoredLoci: ['AMEL'], locusWeights: { TH01: 2.3, FGA: 0.5, DYS391: 0 }, thresholds };
    const compare = createDuplicateSimilarityComparator(options);
    for (const a of profiles) for (const b of profiles) {
      const expected = calculateDuplicateSimilarityOptimized(a, b, options);
      const actual = compare(a, b);
      assert.deepEqual({ ...actual, details: null }, { ...expected, details: null });
      if (!expected.earlyExit && isDuplicateOptimized(expected, thresholds)) assert.deepEqual(actual.details, expected.details);
    }
  }
});

test('Поиск задач: эталонные критерии, порядок, детали и экспорт одинаковы с workers и без них', async () => {
  for (const { input, expected } of fixtures) {
    const original = structuredClone(input);
    for (const useWorkers of [false, true]) {
      const result = await runProfileSearch(input, { useWorkers, minParallelComparisons: 0 });
      assert.deepEqual(json({ results: result.results, comparisons: result.comparisons }), expected,
        `${input.searchMode}, ${input.comparisonAlgorithm}, v5=${input.useV5Algorithm}, workers=${useWorkers}`);
      assert.equal(result.workerCount, useWorkers ? Math.min(workerLimit(), input.referenceProfiles.length) : 0);
    }
    assert.deepEqual(input, original, 'исходные генотипы не меняются');
  }
});

test('Поиск задач: top-100 не ограничивает экспорт, рабочие потоки сохраняют все совпадения', async () => {
  const profiles = syntheticProfiles(103);
  profiles.forEach(profile => { profile.str_data = structuredClone(profiles[0].str_data); });
  const input = { referenceProfiles: profiles, compareProfiles: profiles, searchMode: 'task' };
  const single = await runProfileSearch(input, { useWorkers: false });
  const parallel = await runProfileSearch(input);
  assert.deepEqual(parallel.results, single.results);
  assert.equal(parallel.results[0].matches.length, 100);
  assert.equal(parallel.results[0].exportMatches.length, 102);
  assert.equal(parallel.comparisons, 103 * 102);
  assert.equal(parallel.mode, 'multi-threaded');
});

test('Ошибка worker и отмена ожидающего запроса освобождают очередь поиска', async () => {
  const options = { minParallelComparisons: 0 };
  await assert.rejects(runProfileSearch({ referenceProfiles: [null], compareProfiles: [null] }, options));
  const profiles = syntheticProfiles(5);
  const input = { referenceProfiles: profiles, compareProfiles: profiles, searchMode: 'task' };
  const running = runProfileSearch(input, options);
  const controller = new AbortController();
  const waiting = runProfileSearch(input, { ...options, signal: controller.signal });
  controller.abort(new Error('fixture cancellation'));
  await assert.rejects(waiting, /fixture cancellation/);
  await running;
  const activeController = new AbortController();
  const active = runProfileSearch(input, { ...options, signal: activeController.signal });
  await new Promise(resolve => setTimeout(resolve, 5));
  activeController.abort(new Error('active cancellation'));
  await assert.rejects(active, /active cancellation/);
  const result = await runProfileSearch(input, options);
  assert.equal(result.comparisons, 20);
  const { EventEmitter } = require('node:events');
  const { runProfileSearchForRequest } = require('../src/services/profiles/searchWorkerExecutor');
  const req = Object.assign(new EventEmitter(), { aborted: true, body: {} });
  const res = Object.assign(new EventEmitter(), { destroyed: true });
  await assert.rejects(runProfileSearchForRequest(req, res, input), /Клиент отменил поиск/);
  assert.equal(res.listenerCount('close'), 0);
});

test('Параллельный расчёт оставляет основной event loop доступным и соблюдает CPU лимит', async () => {
  const profiles = syntheticProfiles(300);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    const result = await runProfileSearch({ referenceProfiles: profiles, compareProfiles: profiles, comparisonAlgorithm: 'duplicate_v5' });
    assert(ticks > 0, 'основной поток продолжает обрабатывать события');
    assert(result.workerCount > 0 && result.workerCount <= workerLimit());
    assert.equal(result.comparisons, 300 * 299);
  } finally { clearInterval(timer); }
});
