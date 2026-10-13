const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { profile, population } = require('./fixtures/math-profiles');

// Подменяем зависимости ДО загрузки Engine: настоящий пул запускает таймер
// при require(), поэтому одной подмены методов экземпляра недостаточно.
let databaseQuery;
const forbidden = async () => { throw new Error('Unexpected database access in unit test'); };
const replacements = {
  '../src/config/database': { query: (...args) => databaseQuery(...args), transaction: forbidden },
  '../src/services/cacheService': class UnitCache {},
  '../src/services/connectionPoolService': { initialize: forbidden }
};
const saved = new Map();
let BayesianEngine;
try {
  for (const [name, exports] of Object.entries(replacements)) {
    const id = require.resolve(name);
    saved.set(id, require.cache[id]);
    const stub = new Module(id);
    stub.filename = id; stub.loaded = true; stub.exports = exports;
    require.cache[id] = stub;
  }
  BayesianEngine = require('../src/services/bayesian/BayesianEngine');
} finally {
  for (const [id, original] of saved) {
    if (original) require.cache[id] = original;
    else delete require.cache[id];
  }
}
test.beforeEach(() => { databaseQuery = forbidden; });

function harness(t) {
  const engine = new BayesianEngine();
  const mock = implementation => t.mock.fn(implementation || (async () => null));
  engine.cacheService = {
    isConnected: true, initialize: mock(async () => true),
    getLRResult: mock(), cacheLRResult: mock(),
    getContaminationResult: mock(), cacheContaminationResult: mock(),
    getDegradationResult: mock(), cacheDegradationResult: mock(),
    getDuplicateResults: mock(), cacheDuplicateResults: mock(),
    generateSearchSpaceHash: mock(space => space.map(p => p.id).sort().join('|'))
  };
  const pop = population(), params = { duplicateProbabilityThreshold: 0.9 };
  engine.connectionPool = { initialize: mock(async () => true) };
  engine.populationManager = { loadPopulationData: mock(async () => pop), setBayesianEngine: mock(() => undefined) };
  engine.systemParameters = { initializeDefaults: mock(async () => undefined) };
  const lr = { overallLR: 0.12 }, contamination = { isContaminated: false, contaminationProbability: 0.075858 }, degradation = { degradationIndex: 0.5, qualityScore: 0.5 }, duplicates = [{ id: 'match' }];
  engine.lrCalculator = { calculateProfileLR: mock(async () => lr) };
  engine.contaminationDetector = { analyzeProfile: mock(async () => contamination) };
  engine.degradationAnalyzer = { calculateDegradationIndex: mock(async () => degradation) };
  engine.duplicateFinder = { searchDuplicates: mock(async () => duplicates) };
  engine.getCachedResult = mock();
  engine.getSystemParameters = mock(async () => params);
  engine.storeAnalysisResult = mock(async () => 1);
  return { engine, pop, params, lr, contamination, degradation, duplicates, mock };
}
const a = () => profile('synthetic-a', { TH01: ['12', '13'] });
const b = () => profile('synthetic-b', { TH01: ['13', '12'] });

test('Engine: все обязательные зависимости проверяются до инициализации', async t => {
  for (const name of ['lrCalculator', 'contaminationDetector', 'degradationAnalyzer', 'duplicateFinder', 'populationManager', 'systemParameters']) {
    const { engine } = harness(t);
    engine[name] = null;
    await assert.rejects(() => engine.initialize(), /service is required/);
    assert.equal(engine.cacheService.initialize.mock.callCount(), 0);
    assert.equal(engine.connectionPool.initialize.mock.callCount(), 0);
  }
});

test('Engine: порядок инициализации и связь PopulationManager с Engine', async t => {
  const { engine, mock } = harness(t), order = [];
  engine.systemParameters.initializeDefaults = mock(async () => { order.push('parameters'); });
  engine.cacheService.initialize = mock(async () => { order.push('cache'); });
  engine.connectionPool.initialize = mock(async () => { order.push('pool'); });
  assert.equal(await engine.initialize(), true);
  assert.deepEqual(order, ['parameters', 'cache', 'pool']);
  assert.deepEqual(engine.populationManager.setBayesianEngine.mock.calls[0].arguments, [engine]);
});

test('Engine: ошибочные профили, сравнение с собой и отсутствующая популяция отклоняются', async t => {
  const { engine } = harness(t);
  for (const p of [null, {}, { id: 'no-data' }, { str_data: {} }]) assert.throws(() => engine.validateProfile(p));
  assert.doesNotThrow(() => engine.validateProfile({ id: 'map', loci: new Map() }));
  await assert.rejects(() => engine.calculateLR(a(), a(), 'population'), /Cannot compare profile with itself/);
  await assert.rejects(() => engine.calculateLR(a(), b(), ''), /Population ID is required/);
  await assert.rejects(() => engine.detectContamination(a(), ''), /Population ID is required/);
  await assert.rejects(() => engine.findDuplicates(a(), {}, 'population'), /Search space must be an array/);
  assert.equal(engine.populationManager.loadPopulationData.mock.callCount(), 0);
});

const operations = [
  { name: 'LR', get: 'getLRResult', put: 'cacheLRResult', service: 'lrCalculator', method: 'calculateProfileLR', result: 'lr', invoke: (e, p) => e.calculateLR(p, b(), 'population') },
  { name: 'контаминация', get: 'getContaminationResult', put: 'cacheContaminationResult', service: 'contaminationDetector', method: 'analyzeProfile', result: 'contamination', invoke: (e, p) => e.detectContamination(p, 'population') },
  { name: 'деградация', get: 'getDegradationResult', put: 'cacheDegradationResult', service: 'degradationAnalyzer', method: 'calculateDegradationIndex', result: 'degradation', invoke: (e, p) => e.assessDegradation(p) },
  { name: 'дубликаты', get: 'getDuplicateResults', put: 'cacheDuplicateResults', service: 'duplicateFinder', method: 'searchDuplicates', result: 'duplicates', invoke: (e, p) => e.findDuplicates(p, [b()], 'population') }
];
for (const operation of operations) {
  test(`Engine ${operation.name}: Redis cache hit обходит расчёт и БД`, async t => {
    const h = harness(t), e = h.engine, cached = { source: 'unit-cache' };
    e.cacheService[operation.get] = h.mock(async () => cached);
    assert.equal(await operation.invoke(e, a()), cached);
    assert.equal(e.getCachedResult.mock.callCount(), 0);
    assert.equal(e.populationManager.loadPopulationData.mock.callCount(), 0);
    assert.equal(e[operation.service][operation.method].mock.callCount(), 0);
  });
  test(`Engine ${operation.name}: кэш БД возвращает результат и заполняет Redis`, async t => {
    const h = harness(t), e = h.engine, cached = { source: 'database-cache' };
    e.getCachedResult = h.mock(async () => ({ resultData: cached }));
    assert.equal(await operation.invoke(e, a()), cached);
    assert.equal(e.cacheService[operation.put].mock.callCount(), 1);
    assert.equal(e.cacheService[operation.put].mock.calls[0].arguments.at(-1), cached);
    assert.equal(e[operation.service][operation.method].mock.callCount(), 0);
  });
  test(`Engine ${operation.name}: промах кэша делегирует расчёт без изменения результата`, async t => {
    const h = harness(t), e = h.engine, p = a(), before = structuredClone(p);
    assert.equal(await operation.invoke(e, p), h[operation.result]);
    assert.equal(e[operation.service][operation.method].mock.callCount(), 1);
    assert.equal(e[operation.service][operation.method].mock.calls[0].arguments[0], p);
    assert.equal(e.storeAnalysisResult.mock.callCount(), 1);
    assert.equal(e.cacheService[operation.put].mock.callCount(), 1);
    assert.deepEqual(p, before);
    if (operation.result === 'lr') assert.deepEqual(e.lrCalculator.calculateProfileLR.mock.calls[0].arguments, [p, b(), h.pop]);
    if (operation.result === 'contamination') assert.deepEqual(e.contaminationDetector.analyzeProfile.mock.calls[0].arguments, [p, h.pop]);
    if (operation.result === 'duplicates') assert.deepEqual(e.duplicateFinder.searchDuplicates.mock.calls[0].arguments, [p, [b()], 0.9]);
  });
  test(`Engine ${operation.name}: ошибка расчёта сохраняет причину и не кэшируется`, async t => {
    const h = harness(t), e = h.engine;
    e[operation.service][operation.method] = h.mock(async () => { throw new Error('synthetic calculation failure'); });
    await assert.rejects(() => operation.invoke(e, a()), /synthetic calculation failure/);
    assert.equal(e.cacheService[operation.put].mock.callCount(), 0);
    assert.equal(e.storeAnalysisResult.mock.callCount(), 0);
  });
}

test('Engine: метрики качества получают результаты контаминации и деградации', async t => {
  const { engine, mock } = harness(t);
  engine.qualityMetrics = { storeMetrics: mock() };
  const p = a(); p.sampleId = 'synthetic-sample';
  await engine.detectContamination(p, 'population');
  await engine.assessDegradation(p);
  const calls = engine.qualityMetrics.storeMetrics.mock.calls.map(call => call.arguments);
  assert.deepEqual(calls[0], ['synthetic-sample', p.id, { contaminationProbability: 0.075858, analysisType: 'contamination', populationUsed: 'population' }]);
  assert.deepEqual(calls[1], ['synthetic-sample', p.id, { degradationIndex: 0.5, qualityScore: 0.5, analysisType: 'degradation' }]);
});

test('Engine: настоящий SQL-метод кэша использует параметры, срок действия и JSON', async () => {
  const engine = new BayesianEngine(), calls = [], result = { overallLR: 0.12 };
  databaseQuery = async (...args) => { calls.push(args); return { rows: [{ result_data: result, parameters_used: {}, created_at: 'synthetic-date' }] }; };
  const cached = await engine.getCachedResult('LR', 'a', 'b', 'population');
  assert.equal(cached.resultData, result);
  assert.deepEqual(calls[0][1], ['LR', 'a', 'b', 'population']);
  assert.match(calls[0][0], /expires_at > NOW\(\)/);
  databaseQuery = async (...args) => { calls.push(args); return { rows: [{ id: 123 }] }; };
  const start = Date.now();
  assert.equal(await engine.storeAnalysisResult('LR', 'a', 'b', result, 'population', { theta: 0.1 }), 123);
  const args = calls[1][1];
  assert.equal(args[3], JSON.stringify(result));
  assert.equal(args[5], '{"theta":0.1}');
  assert(args[6].getTime() >= start + 24 * 3600 * 1000);
});

test('Engine: ошибки кэширования БД не превращаются в успех расчёта; параметры имеют fallback', async () => {
  const engine = new BayesianEngine();
  databaseQuery = async () => { throw new Error('synthetic database unavailable'); };
  assert.equal(await engine.getCachedResult('LR', 'a', 'b', 'population'), null);
  assert.equal(await engine.storeAnalysisResult('LR', 'a', 'b', {}, 'population', {}), null);
  assert.deepEqual(await engine.getSystemParameters(), { duplicateProbabilityThreshold: 0.95, contaminationThreshold: 0.05, degradationThreshold: 0.3 });
});

test('MATH-06: хэш БД должен различать наборы с разными профилями после первых пяти', { todo: 'generateSearchSpaceHashForDB использует только первые 5 ID; отдельное исправление ключей кэша' }, () => {
  const engine = new BayesianEngine(), shared = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
  assert.notEqual(engine.generateSearchSpaceHashForDB([...shared, { id: 'f' }]), engine.generateSearchSpaceHashForDB([...shared, { id: 'g' }]));
});
