const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { AlleleReferenceService } = require('../src/services/alleleReferenceService');
const { validateReferenceImport } = require('../src/utils/alleleReferenceImport');
const { normalizeAlleleValue, alleleCandidates } = require('../src/utils/alleleNormalizer');
const { LociTypeDetector, LOCI_TYPES, STR_LOCI, Y_INDEL_LOCI } = require('../src/utils/lociTypeDetector');
const { GeneticExcelConverterService } = require('../src/services/geneticExcelConverterService');
const { ExcelService } = require('../src/services/excelService');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', panelId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// Только вымышленные тестовые справочники; они не являются лестницей коммерческого набора.
function set(loci, overrides = {}) {
  return { id, name: 'Synthetic fixture', type: 'KIT_LADDER', sourceVersion: 'fixture-1', sourceTitle: 'Synthetic test', sourceUrl: 'https://example.invalid/test', contentHash: 'fixture-hash',
    values: Object.entries(loci).flatMap(([locus, alleles]) => alleles.map(allele => ({ locus, allele, classification: 'IN_LADDER' }))), ...overrides };
}
function service(sets, observations = [], settings = {}) { return new AlleleReferenceService({ sets, observations, settings, panels: [{ id: panelId, referenceSetIds: sets.filter(set => set.type === 'KIT_LADDER').map(set => set.id) }] }); }
const frequencies = alleles => alleles.map((allele, index) => ({ locus: 'D5S818', allele, frequency: index ? 0.0001 : 0.5, populationId: 'test', populationName: 'Synthetic test', updatedAt: '2026-01-01' }));
const detector = new LociTypeDetector();

test('Три зарегистрированных Y-InDel регистронезависимы, гаплоидны и не интерпретируются как SNP', () => {
  const cases = [
    ['rs199815934', 'RS199815934', 'rs199815934'],
    ['Rs771783753', 'RS771783753', 'rs771783753'],
    ['rs759551978', 'RS759551978', 'rs759551978']
  ];
  for (const [canonical, upper, lower] of cases) {
    for (const alias of [canonical, upper, lower]) {
      assert.equal(detector.getCanonicalLocusName(alias), canonical);
      assert.equal(detector.detectLocusType(alias), LOCI_TYPES.Y_INDEL);
      for (const allele of ['1', '2']) {
        const result = normalizeAlleleValue(allele, alias);
        assert.deepEqual(result.alleles, [allele]);
        assert.equal(result.status, 'OK');
        assert(!result.events.some(event => event.code === 'SINGLE_DIPLOID'));
        assert(detector.validateAlleles(alias, [allele]).isValid);
        assert.deepEqual(alleleCandidates(allele, alias).map(candidate => candidate.value), [allele]);
      }
      const mixture = normalizeAlleleValue('1,2', alias);
      assert.deepEqual(mixture.alleles, ['1', '2']);
      assert(mixture.events.some(event => event.code === 'MULTI_Y_ALLELIC'));
        assert(normalizeAlleleValue('1', alias, { action: 'homozygous' }).events.some(event => event.code === 'INVALID_DECISION'));
    }
  }
  assert.equal(detector.detectLocusType('Rs2032678'), LOCI_TYPES.SNP);
  assert.equal(detector.detectLocusType('rs000000000'), LOCI_TYPES.OTHER);
  assert.deepEqual(Y_INDEL_LOCI, ['Rs771783753', 'rs199815934', 'rs759551978']);
  assert.equal(normalizeAlleleValue('1', 'YINDEL').normalizedValue, '1');
});

test('Y-InDel не получает аутосомные частоты и исключён из диплоидного LR', async () => {
  const observation = { locus: 'rs199815934', allele: '1', frequency: 0.9, populationId: 'test', populationName: 'Synthetic' };
  const reference = service([], [observation]).evaluate('1', 'RS199815934', panelId);
  assert.equal(reference.genotypeRule, 'HAPLOID_REFERENCE_ONLY');
  assert(!reference.candidates[0].evidence.some(item => item.sourceType === 'POPULATION_DATA'));

  const LRCalculator = require('../src/services/bayesian/LRCalculator');
  const calculator = new LRCalculator(null, { getBayesianParameters: async () => ({}) });
  const profiles = [
    { id: 'sample-a', str_data: { rs199815934: ['1'] } },
    { id: 'sample-b', str_data: { RS199815934: ['1'] } }
  ];
  const result = await calculator.calculateProfileLR(...profiles, { populationId: 'test', locusFrequencies: new Map([['rs199815934', { frequencies: new Map([['1', 0.9]]) }]]) });
  assert.equal(Object.keys(result.locusLRs).length, 0);
  assert.equal(result.overallLR, 1);
  assert(result.calculationMetadata.warnings.some(message => /Y-InDel.*не включается/.test(message)));
});

test('Импорт общего JSON на 1157 записей принимает новые Y-InDel в позиции 1152–1157', () => {
  const ordinary = Array.from({ length: 1151 }, (_, index) => ({ locus: STR_LOCI[index % 52], allele: String(Math.floor(index / 52) + 1) }));
  const values = [...ordinary,
    { locus: 'rs199815934', allele: '1' }, { locus: 'RS199815934', allele: '2' },
    { locus: 'rs771783753', allele: '1' }, { locus: 'RS771783753', allele: '2' },
    { locus: 'rs759551978', allele: '1' }, { locus: 'RS759551978', allele: '2' }
  ];
  const imported = validateReferenceImport({ name: 'Generic fixture', type: 'OBSERVED_REFERENCE', sourceTitle: 'Synthetic test', sourceUrl: 'https://example.invalid/combined', sourceVersion: 'fixture-1', confirmed: true, format: 'json', content: JSON.stringify({ values }) });
  assert.equal(imported.values.length, 1157);
  assert.equal(new Set(imported.values.map(value => value.locus)).size, 55);
  assert.deepEqual(imported.values.filter(value => Y_INDEL_LOCI.includes(value.locus)).map(value => [value.locus, value.allele]).sort(), [
    ['rs199815934', '1'], ['rs199815934', '2'],
    ['Rs771783753', '1'], ['Rs771783753', '2'],
    ['rs759551978', '1'], ['rs759551978', '2']
  ].sort());
  assert.equal(new Set(imported.values.map(value => `${value.locus}:${value.allele}`)).size, 1157);
  assert.throws(() => validateReferenceImport({ name: 'Duplicate aliases', type: 'OBSERVED_REFERENCE', sourceTitle: 'Synthetic test', sourceUrl: 'https://example.invalid/combined', sourceVersion: 'fixture-1', confirmed: true, format: 'json', content: JSON.stringify({ values: [{ locus: 'RS199815934', allele: '1' }, { locus: 'rs199815934', allele: '1' }] }) }), /Повторная запись.*каноническому виду/);
});

test('Предварительная проверка перечисляет локус и причину по нескольким ошибочным строкам', () => {
  const data = { name: 'Invalid fixture', type: 'OBSERVED_REFERENCE', sourceTitle: 'Synthetic test', sourceUrl: 'https://example.invalid/combined', sourceVersion: 'fixture-1', confirmed: true, format: 'json', content: JSON.stringify({ values: [{ locus: 'rs000000000', allele: '1' }, { locus: 'rs199815934', allele: '3' }] }) };
  assert.throws(() => validateReferenceImport(data), error => error.code === 'INVALID_REFERENCE_ROWS' && /локус «rs000000000» в записи 1/.test(error.message) && /аллели «3» для локуса «rs199815934» в записи 2/.test(error.message));
});

test('Синтаксические кандидаты отделены от референсов; настоящие микроаллели не разбиваются', () => {
  assert.deepEqual(alleleCandidates('11.12', 'D5S818').map(candidate => candidate.value), ['11.12', '11,12']);
  for (const value of ['9.3', '31.2', '17.3', '14.2']) {
    assert.equal(alleleCandidates(value, 'TH01').length, 1);
    assert.deepEqual(normalizeAlleleValue(value, 'TH01').alleles, [value, '?']);
  }
});
test('Точная лестница предлагает разделить 11.12 с HIGH без замены исходного', () => {
  const result = service([set({ D5S818: ['11', '12'] })], frequencies(['11', '12'])).evaluate('11.12', 'D5S818', panelId);
  assert.equal(result.suggestedValue, '11,12'); assert.equal(result.confidence, 'HIGH'); assert.equal(result.status, 'NEEDS_REVIEW');
  assert.deepEqual(result.candidates[0].alleles, ['11.12']);
  assert.equal(result.candidates[0].evidence.find(item => item.sourceType === 'POPULATION_DATA').frequency, null);
  assert.equal(result.candidates[0].evidence.find(item => item.sourceType === 'POPULATION_DATA').result, 'NOT_OBSERVED_IN_DATASET');
});
test('Обычная пара и известная микроаллель подтверждаются без подтверждения гомозиготы', () => {
  const reference = service([set({ TH01: ['9.3', '12', '13'] })]);
  assert.equal(reference.evaluate('12,13', 'TH01', panelId).status, 'VALID_KNOWN_ALLELE');
  assert.equal(reference.evaluate('9.3', 'TH01', panelId).status, 'VALID_KNOWN_ALLELE');
  assert(normalizeAlleleValue('9.3', 'TH01').events.some(event => event.code === 'SINGLE_DIPLOID'));
  assert.equal(reference.evaluate('12', 'TH01', panelId).suggestedDecision, null);
});
test('Обе интерпретации подтверждены: обязательная ручная проверка, без предложения', () => {
  const result = service([set({ D5S818: ['11', '12', '11.12'] })]).evaluate('11.12', 'D5S818', panelId);
  assert.equal(result.status, 'CONFLICTING_REFERENCE_EVIDENCE'); assert.equal(result.confidence, 'LOW'); assert.equal(result.suggestedDecision, null);
});
test('Известная off-ladder запись поддерживает вторую интерпретацию и снижает уверенность', () => {
  const known = set({ D5S818: ['11.12'] }, { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', type: 'NIST_VARIANTS' });
  const result = service([set({ D5S818: ['11', '12'] }), known]).evaluate('11.12', 'D5S818', panelId);
  assert.equal(result.status, 'CONFLICTING_REFERENCE_EVIDENCE'); assert.equal(result.suggestedValue, null);
  assert(result.candidates[0].evidence.some(item => item.result === 'KNOWN_VARIANT'));
});
test('Частоты без лестницы не выбирают наиболее частую интерпретацию', () => {
  const reference = service([], frequencies(['11', '12']));
  const result = reference.evaluate('11.12', 'D5S818');
  assert.equal(result.suggestedValue, null); assert.equal(result.confidence, 'LOW');
  assert.equal(result.candidates[1].evidence.find(item => item.allele === '12').frequency, 0.0001);
  assert.equal(reference.evaluate('12', 'D5S818').suggestedDecision, null);
});
test('Конфликт частоты с лестницей снижает уверенность; запись с нулевой частотой не доказывает наблюдение', () => {
  const result = service([set({ D5S818: ['11', '12'] })], frequencies(['11.12'])).evaluate('11.12', 'D5S818', panelId);
  assert.equal(result.confidence, 'LOW'); assert.equal(result.status, 'CONFLICTING_REFERENCE_EVIDENCE');
  const zero = service([], [{ ...frequencies(['12'])[0], frequency: 0 }]).evaluate('12', 'D5S818');
  assert.equal(zero.candidates[0].evidence[0].result, 'NOT_OBSERVED_IN_DATASET'); assert.equal(zero.candidates[0].evidence[0].frequency, 0);
});
test('Нет данных и нет покрытия: UNKNOWN; отсутствие в покрытом справочнике — предупреждение', () => {
  assert.equal(service([]).evaluate('11.12', 'D5S818').confidence, 'UNKNOWN');
  assert.equal(service([set({ TH01: ['9.3'] })]).evaluate('11.12', 'D5S818', panelId).status, 'NO_REFERENCE_DATA');
  assert.equal(service([set({ TH01: ['9.3'] })]).evaluate('14.2', 'TH01', panelId).status, 'NO_REFERENCE_EVIDENCE');
});
test('Несколько версий лестницы требуют выбора; похожее название панели ничего не назначает', () => {
  const first = set({ D5S818: ['11', '12'] }), second = set({ D5S818: ['11.12'] }, { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sourceVersion: 'fixture-2' });
  const reference = service([first, second]);
  assert.equal(reference.evaluate('11.12', 'D5S818', panelId).confidence, 'UNKNOWN');
  assert.equal(reference.evaluate('11.12', 'D5S818', panelId, id).suggestedValue, '11,12');
  assert.equal(reference.evaluate('11.12', 'D5S818', null).confidence, 'UNKNOWN');
  assert.throws(() => reference.evaluate('11.12', 'D5S818', panelId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'), /недоступна/);
});
test('OL, смесь и Y-STR сохраняют исходные правила; аутосомные частоты для Y не оцениваются', () => {
  const reference = service([set({ D5S818: ['15', '28', '29', '30'], DYS392: ['12'] })], [{ ...frequencies(['12'])[0], locus: 'DYS392' }]);
  const ol = reference.evaluate('OL,15', 'D5S818', panelId); assert.equal(ol.suggestedValue, null); assert(!ol.candidates[0].evidence.some(item => item.allele === 'OL'));
  assert(normalizeAlleleValue('28,29,30', 'D5S818').events.some(event => event.code === 'MULTI_ALLELIC'));
  const y = reference.evaluate('12', 'DYS392', panelId); assert.equal(y.genotypeRule, 'HAPLOTYPE_REFERENCE_ONLY'); assert(!y.candidates[0].evidence.some(item => item.sourceType === 'POPULATION_DATA'));
  assert.deepEqual(normalizeAlleleValue('12', 'DYS392').alleles, ['12']);
});
test('Снимки доказательств не изменяются при создании другой версии', () => {
  const before = service([set({ D5S818: ['11', '12'] })]).evaluate('11.12', 'D5S818', panelId);
  const snapshot = JSON.stringify(before);
  service([set({ D5S818: ['11.12'] }, { sourceVersion: 'fixture-2' })]).evaluate('11.12', 'D5S818', panelId);
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(before.candidates[1].evidence[0].referenceVersion, 'fixture-1');
});
test('Подтверждение проходит через существующие решения; аудит источников переживает экспорт/импорт', async () => {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Объект', 'D5S818', 'TH01', 'D21S11'], ['REF-1', '11.12', '7,9', '29,30']]), 'SBT_horizont');
  const file = { originalname: 'fixture.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) };
  const converter = new GeneticExcelConverterService(), reference = service([set({ D5S818: ['11', '12'] })]);
  const panels = [{ id: panelId, name: 'Synthetic panel', lociOrder: ['D5S818', 'TH01', 'D21S11'], referenceSetIds: [id] }];
  const preview = converter.convert([file], {}, panels, reference);
  assert.equal(preview.canImport, false); assert.deepEqual(preview.profiles[0].strData.D5S818, ['11.12']);
  const issue = preview.issues.find(issue => issue.code === 'AMBIGUOUS_DOT');
  assert.equal(issue.reference.suggestedValue, '11,12');
  const ready = converter.convert([file], { cells: { [issue.id]: issue.reference.suggestedDecision } }, panels, reference);
  assert.equal(ready.canImport, true); assert.deepEqual(ready.profiles[0].strData.D5S818, ['11', '12']);
  const parsed = await new ExcelService().parseExcelFile(converter.export(ready), 'normalized.xlsx', { importFormat: 'genetic' });
  const audit = parsed[0].metadata.conversion.audit.find(item => item.locus === 'D5S818');
  assert.equal(audit.rawValue, '11.12'); assert.equal(audit.reference.confidence, 'HIGH'); assert.equal(audit.reference.decision.action, 'split_dot'); assert.equal(audit.reference.candidates[1].evidence[0].referenceSetId, id);
});
test('CSV/JSON: строки микроаллелей, точные перечни, provenance, дубликаты и нечисловые токены', () => {
  const definition = { name: 'Synthetic', type: 'KIT_LADDER', kitName: 'Fixture', sourceTitle: 'Test', sourceUrl: 'https://example.invalid/fixture', sourceVersion: '1', confirmed: true, format: 'csv', content: 'Kit,Locus,Allele,Classification\nFixture,TH01,9.3,IN_LADDER\nFixture,D5S818,11,IN_LADDER' };
  assert.equal(validateReferenceImport(definition).values.find(value => value.locus === 'TH01').allele, '9.3');
  const json = { ...definition, format: 'json', content: JSON.stringify({ loci: { TH01: ['9.3'] } }) };
  assert.equal(validateReferenceImport(json).values[0].allele, '9.3');
  for (const patch of [{ confirmed: false }, { sourceUrl: 'javascript:alert(1)' }, { sourceDate: '2026-99-88' }, { content: 'null', format: 'json' }, { content: JSON.stringify({ loci: { TH01: [9.3] } }), format: 'json' }, { content: 'Locus,Allele\nTH01,9.3\nTH01,9.3' }, { content: 'Locus,Allele\nTH01,3-9' }, { content: 'Locus,Allele\nTH01,OL' }]) assert.throws(() => validateReferenceImport({ ...definition, ...patch }));
});
test('Проверенный шаблон PowerPlex Fusion: пропуски лестницы, микроаллели и явное подтверждение', () => {
  const template = require('../src/data/allele-references/promega-fusion-tmd039-2020.json');
  assert.throws(() => validateReferenceImport(template), /Подтвердите/);
  const parsed = validateReferenceImport({ ...template, confirmed: true });
  assert.equal(new Set(parsed.values.map(value => value.locus)).size, 24);
  for (const allele of ['11', '13']) assert(!template.loci.D2S1338.includes(allele));
  for (const allele of ['5.2', '6.2']) assert(template.loci.D19S433.includes(allele));
  assert(!template.loci.D19S433.includes('7'));
  assert(template.loci.TH01.includes('9.3')); assert(template.loci.D21S11.includes('31.2')); assert(!template.loci.FGA.includes('31'));
  const reference = service([{ ...template, id, values: parsed.values }]);
  assert.equal(reference.evaluate('11.12', 'D5S818', panelId).suggestedValue, '11,12');
});
