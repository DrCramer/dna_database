const test = require('node:test'), assert = require('node:assert/strict');
const { staffSearchOptions, legacyContaminationSettings } = require('../src/utils/staffSearchOptions');
const { runStaffSearch } = require('../src/services/contamination/staffSearchWorkerExecutor');
const Analyzer = require('../src/services/contamination/staffContaminationAnalyzer');
const baseline = require('./fixtures/staff-search-baseline.json');
const json = value => JSON.parse(JSON.stringify(value));

test('Новый экран переносит прежние параметры, включая v4/классический, пустые веса и отрицательный штраф', () => {
  const defaults = staffSearchOptions();
  assert.equal(defaults.threshold, 5.5); assert.equal(defaults.minLociMatch, 8);
  assert.equal(defaults.useV4Algorithm, true); assert.equal(defaults.useV5Algorithm, true);
  assert.deepEqual(defaults.locusWeights, {});
  const saved = legacyContaminationSettings({ useV4Algorithm: true, useV5Algorithm: false, threshold: 8.5, locusWeights: {}, matchCoefficients: { fullMatch: 1.3, partialMatch: 0.25, penalty: -1.5 }, colors: { noMatch: '#112233' } });
  const before = structuredClone(saved), actual = staffSearchOptions(saved);
  assert.equal(actual.useV5Algorithm, false); assert.equal(actual.threshold, 8.5);
  assert.deepEqual(actual.locusWeights, {}); assert.equal(actual.matchCoefficients.penalty, -1.5);
  assert(!Object.hasOwn(actual, 'colors')); assert(!Object.hasOwn(actual, 'searchInMasterArray'));
  assert.deepEqual(saved, before);
  assert.equal(staffSearchOptions({ threshold: '9', minLociMatch: 1.5 }).threshold, 5.5);
  const other = staffSearchOptions(); actual.locusWeights.SE33 = 99; actual.matchCoefficients.fullMatch = 99;
  assert.deepEqual(other.locusWeights, {}); assert.equal(other.matchCoefficients.fullMatch, 1);
});

test('Прежние настройки v1.5/v4/v5 дают те же результаты в прямом анализаторе и обоих путях воркеров', async () => {
  const record = baseline.records[0];
  for (const version of ['v1.5','v4','v5']) for (const locusWeights of [{}, { SE33: 4, TH01: 0.7 }]) {
    const settings = legacyContaminationSettings({ useV4Algorithm: version === 'v4', useV5Algorithm: version === 'v5', threshold: 0.01, minLociMatch: 1, locusWeights, matchCoefficients: { fullMatch: 1.3, partialMatch: 0.25, penalty: -1.4, inclusiveDropout: 0.6, overInclusiveMix: 0.5 }, ignoredLoci: ['DYS391'] });
    const input = { ...record.input, excludedStaffIds: [], options: staffSearchOptions(settings) }, expected = [];
    const analyzer = new Analyzer(null, { quiet: true });
    for (const sample of input.referenceProfiles) expected.push({ profileId: sample.id, matches: await analyzer.detectStaffContamination(sample, input.staffProfiles, settings) });
    for (const useWorkers of [false, true]) {
      const actual = await runStaffSearch(input, { useWorkers, minParallelComparisons: 0 });
      const plain = actual.results.map(group => ({ ...group, matches: group.matches.map(({ registrationNumber, staffYear, ...match }) => match) }));
      assert.deepEqual(json(plain), json(expected));
    }
  }
});
