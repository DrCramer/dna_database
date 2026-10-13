const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/duplicateDetectionService');
const fixtures = require('./fixtures/duplicate-baseline.json');

test('Канонический сервис сохраняет эталоны обоих путей поиска дубликатов', () => {
  for (const fixture of fixtures.cases) {
    const before = structuredClone([fixture.a, fixture.b, fixture.options]);
    const plain = service.calculateDuplicateSimilarity(fixture.a, fixture.b, fixture.options);
    const fast = service.calculateDuplicateSimilarityOptimized(fixture.a, fixture.b, fixture.options);
    // Фикстуры сохраняют JSON-контракт ответа API: undefined не сериализуется.
    assert.deepEqual(JSON.parse(JSON.stringify(plain)), fixture.plain, `${fixture.name}: общий путь`);
    assert.deepEqual(JSON.parse(JSON.stringify(fast)), fixture.fast, `${fixture.name}: путь с ранним выходом`);
    assert.deepEqual(service.compareLocusObjects(fixture.a.TH01, fixture.b.TH01), fixture.object, `${fixture.name}: объектный локус`);
    for (const decision of fixture.decisions) {
      assert.equal(service.isDuplicate(plain, decision.threshold), decision.plain, fixture.name);
      assert.equal(service.isDuplicateOptimized(fast, decision.threshold), decision.fast, fixture.name);
    }
    assert.deepEqual([fixture.a, fixture.b, fixture.options], before);
  }
});

test('Общий путь сохраняет undefined и поля no_call до сериализации', () => {
  const result = service.calculateDuplicateSimilarity({}, { TH01: ['12', '13'] });
  assert.deepEqual(result.details.TH01, { status: 'no_call', score: 0, valA: undefined, valB: ['12', '13'] });
});
