const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectDuplicatePairs } = require('../src/services/workspace/workspaceDuplicateHistory');

const key = Buffer.alloc(32, 26);
const one = { id: 'test-one', year: 2025, str_data: { TH01: ['7', '9.3'], D5S818: ['12', '13'], TPOX: [] } };
const two = { id: 'test-two', year: 2025, loci: { TH01: ['7', '9.3'], D5S818: ['12', '13'] } };

const groups = (reference, match) => [{ reference, matches: [{ ...match }], exportMatches: [match] }];
const snapshot = (reference, match, stage = 'internal') => ({
  internal: { results: stage === 'internal' ? groups(reference, match) : [] },
  master: { results: stage === 'master' ? groups(reference, match) : [] }
});
const fingerprints = result => [...collectDuplicatePairs(result, { key }).keys.keys()];

test('Идентичная пара учитывается один раз, независимо от порядка аллелей, локусов и объектов', () => {
  const reversed = { ...one, str_data: { D5S818: ['13', '12'], TH01: ['9.3', '7'] } };
  const forward = snapshot(one, two);
  const result = collectDuplicatePairs(forward, { key });
  assert.equal(result.complete, true);
  assert.equal(result.keys.size, 1);
  assert.equal([...result.keys.values()][0].length, 2, 'Пометки должны появляться и в matches, и в exportMatches');
  assert.deepEqual(fingerprints(snapshot(two, reversed)), fingerprints(forward));
});

test('История различает раздел поиска, новый год, разные UUID и изменённый генотип', () => {
  const original = fingerprints(snapshot(one, two));
  assert.notDeepEqual(fingerprints(snapshot(one, two, 'master')), original);
  assert.notDeepEqual(fingerprints(snapshot(one, { ...two, year: 2026 })), original);
  assert.notDeepEqual(fingerprints(snapshot(one, { ...two, id: 'other' })), original);
  assert.notDeepEqual(fingerprints(snapshot(one, { ...two, loci: { TH01: ['7', '9.3'], D5S818: ['12', '12'] } })), original);
  const missing = collectDuplicatePairs(snapshot(one, { id: two.id, year: two.year }), { key });
  assert.equal(missing.complete, false);
  assert.equal(missing.keys.size, 0);
});
