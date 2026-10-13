const test = require('node:test');
const assert = require('node:assert/strict');
const { multisetIntersection, equalAlleleArrays, isAlleleSubset, setIntersection } = require('../src/utils/alleleComparison');
const Analyzer = require("../src/services/contamination/staffContaminationAnalyzer");
const Service = require("../src/services/contamination/staffContaminationService");
const fixtures = require('./fixtures/staff-comparison-baseline.json');

test('Общие операции сохраняют кратность, порядок и независимость исходных массивов', () => {
  const first = ['29', '29', '32.2'], second = ['32.2', '29'];
  const before = structuredClone([first, second]);
  assert.deepEqual(multisetIntersection(first, second), ['29', '32.2']);
  assert.deepEqual(multisetIntersection(second, first), ['32.2', '29']);
  assert.deepEqual([first, second], before);
  assert.equal(equalAlleleArrays(['12'], ['12', '12']), false);
  assert.equal(equalAlleleArrays(['13', '12'], ['12', '13']), true);
  assert.equal(isAlleleSubset([], ['12']), true);
  assert.deepEqual([...setIntersection(new Set(['12', '13']), new Set(['13']))], ['13']);
});

test('Объединение операций сохраняет все эталоны сервисов контаминации сотрудников', () => {
  const analyzer = new Analyzer(), service = new Service(null, null);
  for (const fixture of fixtures.records) {
    const { sample, staff } = fixture, before = structuredClone([sample, staff]);
    const identity = { id: 'synthetic', full_name: 'Synthetic' };
    assert.deepEqual(analyzer.intersect(sample, staff), fixture.intersection, fixture.name);
    assert.deepEqual(service.compareAlleles(sample, staff), fixture.comparison, fixture.name);
    assert.deepEqual(JSON.parse(JSON.stringify(analyzer.analyzeV40({ TH01: sample }, { TH01: staff }, identity, ['TH01']))), fixture.v4, fixture.name);
    assert.deepEqual(JSON.parse(JSON.stringify(analyzer.analyzeV50({ TH01: sample }, { TH01: staff }, identity, ['TH01']))), fixture.v5, fixture.name);
    assert.deepEqual([sample, staff], before);
  }
});
