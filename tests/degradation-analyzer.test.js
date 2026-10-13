const test = require('node:test');
const assert = require('node:assert/strict');
const DegradationAnalyzer = require('../src/services/bayesian/DegradationAnalyzer');
const { profile, parameters, close } = require('./fixtures/math-profiles');
const analyzer = () => new DegradationAnalyzer(parameters());
const objects = () => profile('synthetic-degradation', {
  TH01: { alleles: ['12', '12'] }, D5S818: { alleles: ['11', '12'] }, D21S11: { alleles: ['29', '30'] }
});

test('Подсчёт гомозигот, гетерозигот, пропусков и исключение половых маркеров', () => {
  const p = objects();
  Object.assign(p.str_data, { D3S1358: { alleles: ['12'] }, D18S51: null, AMEL: { alleles: ['X', 'X'] }, DYS391: { alleles: ['12'] }, SRY: { alleles: ['SRY'] }, rs199815934: { alleles: ['1'] } });
  assert.deepEqual(analyzer().countSTRLoci(p), { totalSTR: 3, homozygousSTR: 1, heterozygousSTR: 2, missingSTR: 2 });
  close(analyzer().calculateSTRHomozygosityRatio(p), 1 / 3);
});

test('Формы объектов allele1/allele2, alleles и strData дают одинаковый результат', () => {
  const a = analyzer(), p = objects();
  const expected = { totalSTR: 3, homozygousSTR: 1, heterozygousSTR: 2, missingSTR: 0 };
  assert.deepEqual(a.countSTRLoci({ id: p.id, strData: p.str_data }), expected);
  assert.deepEqual(a.countSTRLoci({ id: p.id, loci: p.str_data }), expected);
  assert.deepEqual(a.countSTRLoci(profile('pairs', { TH01: { allele1: '12', allele2: '12' }, D5S818: { allele1: '11', allele2: '12' }, D21S11: { allele1: '29', allele2: '30' } })), expected);
});

test('Индекс, качество, параметры и сохранность профиля', async () => {
  const p = objects(), before = structuredClone(p), result = await analyzer().calculateDegradationIndex(p);
  close(result.degradationIndex, 1 / 3);
  close(result.qualityScore, 2 / 3);
  assert.equal(result.isDegraded, false);
  assert.equal(result.strLociAnalyzed, 3);
  assert.equal(result.homozygousLoci, 1);
  assert.equal(result.heterozygousLoci, 2);
  assert.equal(result.recommendation, 'GOOD');
  assert.equal(result.analysisMetadata.method, 'STR_homozygosity_ratio');
  assert(result.analysisMetadata.timestamp instanceof Date);
  assert.deepEqual(p, before);
});

test('Все гомозиготы и все гетерозиготы: границы индекса и качества', async () => {
  for (const [second, index, quality, degraded] of [['12', 1, 'LOW', true], ['13', 0, 'HIGH', false]]) {
    const p = profile('boundary', Object.fromEntries(['TH01', 'D5S818', 'D21S11'].map(name => [name, { alleles: ['12', second] }])));
    const result = await analyzer().assessQuality(p);
    assert.equal(result.degradationIndex, index);
    assert.equal(result.qualityScore, 1 - index);
    assert.equal(result.overallQuality, quality);
    assert.equal(result.isDegraded, degraded);
    assert(result.recommendations.length > 0);
  }
});

test('Минимум 3 STR; отсутствие генотипов и идентификатора отклоняется', async () => {
  const a = analyzer();
  await assert.rejects(() => a.calculateDegradationIndex(profile('short', { TH01: { alleles: ['12', '12'] } })), /Insufficient STR data/);
  assert.throws(() => a.calculateSTRHomozygosityRatio(profile('empty')), /No STR loci/);
  assert.equal(a.validateProfile(null).isValid, false);
  assert.equal(a.validateProfile({ str_data: {} }).isValid, false);
  assert.equal(a.validateProfile({ sample_name: 'synthetic', str_data: {} }).isValid, true);
});

test('Интервал ограничивается диапазоном 0–1; пороги используют строгое превышение', async () => {
  const a = analyzer(), interval = a.calculateConfidenceInterval(0.5, 100);
  close(interval[0], 0.402);
  close(interval[1], 0.598);
  assert.deepEqual(a.calculateConfidenceInterval(0, 3), [0, 0]);
  assert.deepEqual(a.calculateConfidenceInterval(1, 3), [1, 1]);
  assert.deepEqual(a.calculateConfidenceInterval(0.5, 0), [0.5, 0.5]);
  assert.equal(await a.isDegradationFlagged(0.5), false);
  assert.equal(await a.isDegradationFlagged(0.500001), true);
  for (const [index, label] of [[0.3, 'EXCELLENT'], [0.300001, 'GOOD'], [0.5, 'GOOD'], [0.500001, 'FAIR'], [0.7, 'FAIR'], [0.700001, 'POOR']]) assert.equal(a.generateQualityRecommendation(index, 1 - index, false), label);
});

test('Ошибка параметров не маскируется успешной оценкой', async () => {
  const a = new DegradationAnalyzer({ getParameter: async () => { throw new Error('synthetic parameter failure'); } });
  await assert.rejects(() => a.calculateDegradationIndex(objects()), /synthetic parameter failure/);
});

test('MATH-02: массивы STR из БД должны учитываться как объектные генотипы', { todo: 'countSTRLoci не читает элементы массива; поведение ядра пока сохранено' }, async () => {
  const result = await analyzer().calculateDegradationIndex(profile('array', { TH01: ['12', '12'], D5S818: ['11', '12'], D21S11: ['29', '30'] }));
  close(result.degradationIndex, 1 / 3);
  assert.equal(result.strLociAnalyzed, 3);
});

test('MATH-03: Map локусов должен учитываться при анализе деградации', { todo: 'Object.entries(Map) теряет локусы; исправление после согласования' }, async () => {
  const p = objects();
  const result = await analyzer().calculateDegradationIndex({ id: p.id, loci: new Map(Object.entries(p.str_data)) });
  close(result.degradationIndex, 1 / 3);
});
