const test = require('node:test');
const assert = require('node:assert/strict');
const LRCalculator = require('../src/services/bayesian/LRCalculator');
const { profile, population, parameters, close } = require('./fixtures/math-profiles');
const calculator = () => new LRCalculator(null, parameters());

test('HWE: независимо рассчитанные вероятности гомозиготы, гетерозиготы и поправки F', () => {
  const lr = calculator(), frequencies = population().locusFrequencies.get('TH01').frequencies;
  close(lr.calculateHardyWeinbergProbability(['12', '12'], frequencies), 0.04);
  close(lr.calculateHardyWeinbergProbability(['12', '13'], frequencies), 0.12);
  close(lr.calculateHardyWeinbergProbability(['13', '12'], frequencies), 0.12);
  close(lr.calculateHardyWeinbergProbability(['12'], frequencies), 0.04);
  close(lr.calculateHardyWeinbergProbability(['12', '12'], frequencies, 0.1), 0.056);
  close(lr.calculateHardyWeinbergProbability(['12', '13'], frequencies, 0.1), 0.108);
});

test('Расширенная HWE: theta и F проверяются по числовым эталонам', () => {
  const lr = calculator(), frequencies = population().locusFrequencies.get('TH01').frequencies;
  close(lr.calculateEnhancedHardyWeinbergProbability(['12', '12'], frequencies, 0, 0.1), 0.0784);
  close(lr.calculateEnhancedHardyWeinbergProbability(['12', '13'], frequencies, 0, 0.1), 0.2072);
  close(lr.calculateEnhancedHardyWeinbergProbability(['12', '12'], frequencies, 0.1, 0.1), 0.09856);
  close(lr.calculateEnhancedHardyWeinbergProbability(['12', '13'], frequencies, 0.1, 0.1), 0.18648);
});

test('Редкая и неизвестная STR-аллели: минимальная частота и нижняя граница', () => {
  const lr = calculator(), frequencies = new Map([['12', 0.2], ['99', 0.000001]]);
  close(lr.calculateHardyWeinbergProbability(['99', '99'], frequencies), 1e-12);
  close(lr.getMinimumFrequency(frequencies), 0.0001);
  close(lr.calculateHardyWeinbergProbability(['98', '98'], frequencies), 1e-8);
  close(lr.calculateHardyWeinbergProbability(['12', '98'], frequencies), 0.00004);
  close(lr.calculateLocusLR({ locusName: 'TH01', locusType: 'STR', alleles: ['99', '99'] }, { frequencies }, {}), 1e-10);
  close(lr.getMinimumFrequency(new Map([['12', 0]])), 0.001);
});

test('Микроаллели сохраняют точную частоту при наличии её в справочнике', () => {
  const lr = calculator(), frequencies = new Map([['9.3', 0.2], ['9', 0.5], ['12', 0.3]]);
  close(lr.calculateHardyWeinbergProbability(['9.3', '12'], frequencies), 0.12);
  close(lr.getAlleleFrequency('9.3', frequencies), 0.2);
});

test('Baseline: calculateLocusLR возвращает вероятность, поправки dropout/drop-in уменьшают её', () => {
  // Фиксируем нынешнюю семантику; это не подтверждение корректности названия LR.
  const lr = calculator(), frequencies = population().locusFrequencies.get('TH01').frequencies;
  const locus = { locusName: 'TH01', locusType: 'STR', alleles: ['12', '13'] };
  close(lr.calculateLocusLR(locus, { frequencies }, {}), 0.12);
  close(lr.calculateLocusLR(locus, { frequencies }, { dropOutProbability: 0.2, falseAlleleProbability: 0.1 }), 0.0864);
  close(lr.applyEnhancedCorrections(0.12, locus, { dropOutProbability: 0.2, falseAlleleProbability: 0.1 }, {}), 0.0864);
  close(lr.applyEnhancedCorrections(0.12, { locusType: 'SNP' }, {}, {}), 0.126);
});

test('Неполные генотипы и специальные токены не являются полным совпадением для LR', () => {
  const lr = calculator(), frequencies = population().locusFrequencies.get('TH01').frequencies;
  for (const token of ['?', '*', '**', 'F', '12?']) {
    assert.equal(lr.compareAlleles(['12', token], ['12', token]), false);
    assert.equal(lr.getAlleleFrequency(token, frequencies), null);
    assert.throws(() => lr.calculateHardyWeinbergProbability(['12', token], frequencies), /Incomplete genotype/);
    assert.deepEqual(lr.extractLociData(profile('partial', { TH01: ['12', token] })).get('TH01').alleles, []);
  }
  assert.equal(lr.compareAlleles([], []), false);
  assert.equal(lr.compareAlleles(['12'], ['12', '12']), false);
  assert.equal(lr.compareAlleles(['13', '12'], ['12', '13']), true);
});

test('Ошибочные локусы, пустые частоты и смеси отклоняются', () => {
  const lr = calculator(), frequencies = population().locusFrequencies.get('TH01').frequencies;
  assert.throws(() => lr.calculateHardyWeinbergProbability([], frequencies), /Alleles array/);
  assert.throws(() => lr.calculateHardyWeinbergProbability(['12'], new Map()), /frequencies/);
  assert.throws(() => lr.calculateHardyWeinbergProbability(['12', '13', '14'], frequencies), /more than 2/);
  assert.throws(() => lr.calculateLocusLR({ locusName: 'TH01', alleles: ['12'] }, { frequencies }, {}), /Invalid locus data/);
  assert.throws(() => lr.calculateLocusLR({ locusName: 'TH01', locusType: 'STR', alleles: ['12'] }, null, {}), /Missing allele frequencies/);
});

test('SNP, Y и AMEL имеют отдельные числовые эталоны, Y-InDel исключён из диплоидной модели', () => {
  const lr = calculator(), snp = new Map([['A', 0.2], ['T', 0.8]]);
  close(lr.calculateSNPProbability(['A', 'A'], snp), 0.04);
  close(lr.calculateSNPProbability(['A', 'T'], snp), 0.32);
  close(lr.calculateEnhancedSNPProbability(['A', 'T'], snp, 0.1), 0.4592);
  close(lr.calculateYChromosomeProbability('12', new Map([['12', 0.2]])), 0.2);
  close(lr.calculateAmelogeninProbability(['X', 'Y'], new Map([['X', 0.5], ['Y', 0.5]])), 0.5);
  assert.throws(() => lr.calculateSNPProbability(['C'], snp), /Frequency not found/);
  assert.throws(() => lr.calculateYChromosomeProbability('99', new Map([['12', 0.2]])), /Frequency not found/);
  assert.throws(() => lr.calculateLocusLR({ locusName: 'DYS391', locusType: 'Y_CHROMOSOME', alleles: ['12', '13'] }, { frequencies: snp }, {}), /exactly one/);
  assert.throws(() => lr.calculateLocusLR({ locusName: 'rs199815934', locusType: 'Y_INDEL', alleles: ['1'] }, { frequencies: snp }, {}), /Y-InDel/);
});

test('Профиль: произведение эталонных локусов, перестановка аллелей и сохранность входных данных', async () => {
  const lr = calculator(), a = profile('a', { TH01: ['12', '13'], D5S818: ['11', '11'] });
  const b = profile('b', { TH01: ['13', '12'], D5S818: ['11', '11'] });
  const before = structuredClone([a, b]), pop = population(), beforePop = structuredClone(pop);
  const result = await lr.calculateProfileLR(a, b, pop);
  close(result.locusLRs.TH01.lr, 0.2072);
  close(result.locusLRs.D5S818.lr, 0.2116);
  close(result.overallLR, 0.04384352);
  close(result.logLR, Math.log10(0.04384352));
  assert.equal(result.calculationMetadata.commonLoci, 2);
  assert.deepEqual(result.calculationMetadata.errors, []);
  assert.equal(result.populationUsed, pop.populationId);
  assert.deepEqual([a, b], before);
  assert.deepEqual(pop, beforePop);
});

test('Несовпадение даёт исключение, остальные локусы продолжают рассчитываться', async () => {
  const result = await calculator().calculateProfileLR(
    profile('a', { TH01: ['12', '13'], D5S818: ['11', '11'] }),
    profile('b', { TH01: ['12', '14'], D5S818: ['11', '11'] }), population());
  assert.equal(result.overallLR, 0);
  assert.equal(result.logLR, -Infinity);
  assert.equal(result.locusLRs.TH01.reason, 'allele_mismatch');
  close(result.locusLRs.D5S818.lr, 0.2116);
  assert.deepEqual(result.confidenceInterval, [0, 0]);
});

test('Пустое пересечение, отсутствующие частоты и Y-InDel дают диагностируемый результат', async () => {
  const lr = calculator();
  const empty = await lr.calculateProfileLR(profile('a', { TH01: ['12', '13'] }), profile('b', { D5S818: ['11', '11'] }), population());
  assert.equal(empty.overallLR, 1);
  assert.equal(empty.analysisDetails.analyzedLoci, 0);
  assert(empty.locusLRs instanceof Map);
  const noFrequency = await lr.calculateProfileLR(profile('a', { D18S51: ['12', '13'] }), profile('b', { D18S51: ['12', '13'] }), population());
  assert.equal(noFrequency.overallLR, 1);
  assert.deepEqual(noFrequency.locusLRs, {});
  assert.match(noFrequency.calculationMetadata.warnings[0], /Missing population data/);
  const y = await lr.calculateProfileLR(profile('a', { rs199815934: ['1'] }), profile('b', { rs199815934: ['1'] }), population());
  assert.equal(y.overallLR, 1);
  assert.match(y.calculationMetadata.warnings[0], /Y-InDel/);
});

test('Интервалы, вероятность совпадения и границы категорий', () => {
  const lr = calculator();
  const interval = lr.calculateConfidenceInterval(100, 4);
  close(interval[0], 10.471285480508996);
  close(interval[1], 954.9925860214359);
  assert.deepEqual(lr.calculateConfidenceInterval(0, 4), [0, 0]);
  for (const [input, expected] of [[0, 0], [1, 50], [99, 99], [-1, 0], [Infinity, 0], [NaN, 0], ['1', 0]]) close(lr.calculateMatchProbability(input), expected);
  for (const [value, label] of [[0, 'EXCLUSION'], [0.999, 'EXCLUSION'], [1, 'WEAK'], [10, 'MODERATE'], [100, 'STRONG'], [10000, 'VERY_STRONG'], [1000000, 'EXTREMELY_STRONG']]) assert.equal(lr.determineLRSignificance(value), label);
  close(lr.applyBrennerCorrection(100, 1, 4), 12.5);
  assert.equal(lr.applyBrennerCorrection(100, 4, 4), 100);
  assert.equal(lr.applyBrennerCorrection(100, 0, 4), 100);
});

test('MATH-01: отчёт должен принимать собственный результат calculateProfileLR', { todo: 'locusLRs экспортируется как Object, отчёт ожидает Map; исправление требует отдельного согласования' }, async () => {
  const lr = calculator();
  const result = await lr.calculateProfileLR(profile('a', { TH01: ['12', '13'] }), profile('b', { TH01: ['12', '13'] }), population());
  const report = lr.generateLRReport(result);
  assert.equal(report.locusDetails.length, 1);
  close(report.summary.overallLR, 0.2072);
});
