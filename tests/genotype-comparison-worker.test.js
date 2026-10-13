const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { profile } = require('./fixtures/math-profiles');

async function run(t, profiles, overrides = {}) {
  const worker = new Worker(path.resolve(__dirname, '../src/workers/genotypeComparisonWorker.js'), {
    workerData: { referenceProfiles: profiles, allProfiles: profiles, minMatches: 1, ignoredLoci: [], startIndex: 0, endIndex: profiles.length, ...overrides }
  });
  t.after(() => worker.terminate());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Worker timeout')); }, 5000);
    const finish = callback => value => { clearTimeout(timeout); callback(value); };
    worker.once('message', finish(resolve));
    worker.once('error', finish(reject));
    worker.once('exit', code => { clearTimeout(timeout); if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
  });
}

test('Worker: гетерозиготы сравниваются без учёта порядка, входные данные сохраняются', async t => {
  const profiles = [profile('a', { TH01: ['12', '13'], D5S818: ['11', '12'] }), profile('b', { TH01: ['13', '12'], D5S818: ['12', '11'] })];
  profiles[1].import_number = 258;
  const before = structuredClone(profiles), result = await run(t, profiles, { minMatches: 2 });
  assert.equal(result.comparisons, 2);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0].matches[0].matchedLoci, ['TH01', 'D5S818']);
  assert.equal(result.results[0].matches[0].matchCount, 2);
  assert.equal(result.results[0].matches[0].privoz, '258');
  assert.deepEqual(profiles, before);
});

test('Worker: гомозигота требует совпадающую гомозиготную пару', async t => {
  const result = await run(t, [profile('a', { TH01: ['12', '12'] }), profile('b', { TH01: ['12', '13'] }), profile('c', { TH01: ['12', '12'] })]);
  assert.deepEqual(result.results.find(group => group.reference.id === 'a').matches.map(match => match.id), ['c']);
  assert(!result.results.some(group => group.reference.id === 'b'));
});

test('Worker: частичная аллель включается в смесь, направление сравнения имеет значение', async t => {
  const result = await run(t, [profile('partial', { TH01: ['12'] }), profile('mixture', { TH01: ['12', '13', '14'] })]);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].reference.id, 'partial');
  assert.equal(result.results[0].matches[0].id, 'mixture');
});

test('Worker: диапазон и минимальное число совпадений; исключённые локусы не учитываются', async t => {
  const data = { TH01: ['12', '13'], D5S818: ['11', '12'], D21S11: ['29', '30'] };
  const profiles = [profile('a', data), profile('b', data), profile('c', data)];
  const ranged = await run(t, profiles, { startIndex: 1, endIndex: 2, minMatches: 3 });
  assert.equal(ranged.comparisons, 2);
  assert.deepEqual(ranged.results.map(group => group.reference.id), ['b']);
  assert.deepEqual(ranged.results[0].matches.map(match => match.id), ['a', 'c']);
  const ignored = await run(t, profiles, { ignoredLoci: ['TH01'], minMatches: 3 });
  assert.deepEqual(ignored.results, []);
  const limited = await run(t, profiles, { ignoredLoci: ['TH01'], minMatches: 2 });
  assert.deepEqual(limited.results[0].matches[0].matchedLoci, ['D5S818', 'D21S11']);
});

test('Worker: отсутствие данных и одиночные спецтокены не создают совпадений', async t => {
  for (const alleles of [[], ['?'], ['*'], ['F']]) {
    const result = await run(t, [profile('a', { TH01: alleles }), profile('b', { TH01: alleles })]);
    assert.deepEqual(result.results, []);
  }
  const empty = await run(t, []);
  assert.deepEqual(empty, { results: [], comparisons: 0 });
});

test('Worker: объекты allele1/allele2 и строки с микроаллелями проходят преобразование', async t => {
  const result = await run(t, [profile('a', { TH01: { allele1: '9.3', allele2: '12' } }), profile('b', { TH01: '12,9.3' })]);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].matches[0].matchCount, 1);
});

test('MATH-05: пара с неизвестной второй аллелью не является полным совпадением', { todo: 'Worker фильтрует целую строку, пропуская ? внутри пары; исправление отдельно' }, async t => {
  const result = await run(t, [profile('a', { TH01: ['12', '?'] }), profile('b', { TH01: ['12', '?'] })]);
  assert.deepEqual(result.results, []);
});
