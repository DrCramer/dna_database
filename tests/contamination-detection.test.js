const test = require('node:test');
const assert = require('node:assert/strict');
const ContaminationDetector = require('../src/services/bayesian/ContaminationDetector');
const { compareLocusV5, calculateContaminationScoreV5 } = require('../src/utils/contaminationAlgorithm');
const { profile, population, parameters, close } = require('./fixtures/math-profiles');
const detector = () => new ContaminationDetector(null, parameters());

test('V5: полное совпадение, выпадение, дополнительная аллель, частичная смесь и несовпадение', () => {
  const cases = [
    [['12', '13'], ['13', '12'], 'fullMatch', 1, 0.9, ['12', '13']],
    [['12'], ['12', '13'], 'inclusiveDropout', 0.85, 0.765, ['12']],
    [['12', '13', '14'], ['12', '13'], 'overInclusiveMix', 0.7, 0.63, ['12', '13']],
    [['12', '14'], ['12', '13'], 'partialMix', 0.4, 0.36, ['12']],
    [['14', '15'], ['12', '13'], 'mismatch', -1, -0.9, []]
  ];
  for (const [sample, staff, matchType, coefficient, score, explained] of cases) {
    const before = structuredClone([sample, staff]);
    const result = compareLocusV5(sample, staff, 'TH01');
    assert.equal(result.matchType, matchType);
    close(result.matchCoeff, coefficient);
    close(result.score, score);
    assert.deepEqual(result.explainedAlleles, explained);
    assert.deepEqual([sample, staff], before);
  }
});

test('V5: исходная гомозигота не теряет повторную аллель, неизвестные токены не совпадают', () => {
  assert.deepEqual(compareLocusV5(['12', '12'], ['12', '12'], 'TH01').explainedAlleles, ['12', '12']);
  const mixture = compareLocusV5(['12', '12', '13'], ['12', '12'], 'TH01');
  assert.deepEqual(mixture.explainedAlleles, ['12', '12']);
  for (const values of [[], ['?', '*', 'F'], ['12?']]) {
    const result = compareLocusV5(values, values, 'TH01');
    assert.equal(result.matchType, 'empty');
    assert.equal(result.score, 0);
  }
});

test('V5: штраф короткого, длинного и обычного локуса', () => {
  close(compareLocusV5(['12'], ['13'], 'D10S1248').score, -3.6);
  close(compareLocusV5(['12'], ['13'], 'FGA').score, -0.65);
  close(compareLocusV5(['12'], ['13'], 'D3S1358').score, -1);
});

test('Baseline V5: бонус микроаллели, исключение TH01 9.3 и правило трёх критических локусов', () => {
  // В V5 редкость определяется эвристикой, не популяционной частотой.
  const rare = compareLocusV5(['28.2', '29'], ['29', '28.2'], 'SE33');
  assert.equal(rare.rarityBonus, 1.5);
  close(rare.score, 3.75);
  assert.equal(compareLocusV5(['9', '9.3'], ['9', '9.3'], 'TH01').rarityBonus, 1);
  const p = { SE33: ['12', '13'], D12S391: ['12', '13'], D1S1656: ['12', '13'] };
  const result = calculateContaminationScoreV5(p, p);
  assert.equal(result.rareCriticalMatches, 3);
  assert.equal(result.rareRuleTriggered, true);
  assert.equal(result.level, 'STRONG_CRITICAL');
  assert.equal(result.score, 6.5);
});

test('V5: точные пороги уровней и округление итогового балла', () => {
  for (const [count, level] of [[0, 'CLEAN'], [4, 'CLEAN'], [5, 'WARNING'], [7, 'WARNING'], [8, 'CRITICAL'], [12, 'CRITICAL'], [13, 'STRONG_CRITICAL']]) {
    const p = Object.fromEntries(Array.from({ length: count }, (_, index) => [`Synthetic-${index}`, ['12', '13']]));
    const result = calculateContaminationScoreV5(p, p);
    assert.equal(result.score, count);
    assert.equal(result.matchedLoci, count);
    assert.equal(result.level, level);
  }
  assert.equal(calculateContaminationScoreV5({ TH01: ['12'] }, { TH01: ['12', '13'] }).score, 0.77);
});

test('V5: пропуски и исключённые локусы не влияют на сумму и входные данные', () => {
  const sample = { TH01: ['12', '13'], FGA: ['12', '13'], D5S818: [] };
  const staff = { TH01: ['13', '12'], FGA: ['14', '15'], D21S11: ['29', '30'] };
  const before = structuredClone([sample, staff]);
  const result = calculateContaminationScoreV5(sample, staff, new Set(['FGA']));
  assert.equal(result.score, 0.9);
  assert.deepEqual(result.matchedLociNames, ['TH01']);
  assert.equal(result.locusDetails.length, 1);
  assert.deepEqual([sample, staff], before);
  assert.equal(calculateContaminationScoreV5({ FGA: ['12'] }, { FGA: ['13'] }).score, 0);
});

test('Байесовский детектор: STR и гаплоидный Y-InDel, AMEL не считается STR-смесью', () => {
  const d = detector();
  const p = profile('mixture', { TH01: ['12', '13', '14'], DYS391: ['12'], AMEL: ['X', 'X', 'Y'], rs199815934: ['1', '2'] });
  const result = d.detectSTRMultiAlleles(p);
  assert.deepEqual(result.map(item => [item.locusName, item.alleleCount, item.severity]), [['TH01', 3, 'HIGH'], ['rs199815934', 2, 'MEDIUM']]);
  const mapProfile = { id: 'map-mixture', loci: new Map([['TH01', { locusType: 'STR', alleles: ['12', '13', '14'] }]]) };
  assert.equal(d.detectSTRMultiAlleles(mapProfile)[0].alleleCount, 3);
});

test('Популяционные аномалии: порог 0.001, отсутствующая частота и исключение Y-InDel', () => {
  const d = detector();
  const anomalies = d.checkAlleleFrequencyAnomalies('TH01', ['12', '13', '14', '99', null, ''], new Map([['12', 0.2], ['13', 0.001], ['14', 0.0009]]), 'STR');
  assert.deepEqual(anomalies.map(item => [item.allele, item.severity]), [['14', 'MEDIUM'], ['99', 'HIGH']]);
  const pop = population();
  pop.locusFrequencies.set('rs199815934', { frequencies: new Map([['1', 0.0001]]) });
  assert.deepEqual(d.analyzeAlleleFrequencyAnomalies(profile('y', { rs199815934: ['1'] }), pop), []);
});

test('SNP: редкая гетерозигота отмечается, обычная и гомозигота не отмечаются', () => {
  const d = detector(), p = { id: 'snp', loci: new Map([['SyntheticSNP', { locusType: 'SNP', alleles: ['A', 'T'] }]]) };
  const pop = { locusFrequencies: new Map([['SyntheticSNP', { frequencies: new Map([['A', 0.01], ['T', 0.99]]) }]]) };
  close(d.detectSNPHeterozygosityExcess(p, pop)[0].expectedHeterozygosity, 0.0198);
  pop.locusFrequencies.get('SyntheticSNP').frequencies = new Map([['A', 0.5], ['T', 0.5]]);
  assert.deepEqual(d.detectSNPHeterozygosityExcess(p, pop), []);
  p.loci.get('SyntheticSNP').alleles = ['A', 'A'];
  assert.deepEqual(d.detectSNPHeterozygosityExcess(p, pop), []);
});

test('Baseline: оценка без признаков ненулевая; один и два STR-сигнала усиливают её', () => {
  // Сигмоида текущей модели даёт 0.075858 при нулевом входе; не утверждаем, что это клиническая вероятность.
  const d = detector();
  close(d.calculateContaminationScore([], [], []), 0.07585818002124355);
  close(d.calculateContaminationScore([{ alleleCount: 3 }], [], []), 0.2141650169574414);
  close(d.calculateContaminationScore([{ alleleCount: 3 }, { alleleCount: 3 }], [], []), 0.47502081252106);
  const saturated = d.calculateContaminationScore(Array.from({ length: 30 }, () => ({ alleleCount: 5 })), Array(30).fill({}), Array(30).fill({}));
  close(saturated, 0.9241418199787566);
});

test('Полный анализ: параметры порога, причина, метаданные и неизменность генотипа', async () => {
  const d = detector(), pop = population();
  pop.locusFrequencies.get('D21S11').frequencies = new Map([['29', 0.25], ['30', 0.7], ['31', 0.05]]);
  const p = profile('mixture', { TH01: ['12', '13', '14'], D21S11: ['29', '30', '31'] }), before = structuredClone(p);
  const result = await d.analyzeProfile(p, pop);
  assert.equal(result.isContaminated, true);
  close(result.contaminationProbability, 0.47502081252106);
  assert.deepEqual(result.detectionMethod, ['STR_MULTI_ALLELE']);
  assert.equal(result.analysisMetadata.thresholdUsed, 0.25);
  assert.equal(result.analysisMetadata.flaggedLociCount, 2);
  assert.equal(result.confidence, 1);
  assert.deepEqual(p, before);
  const clean = await d.analyzeProfile(profile('clean', { TH01: ['12', '13'] }), population());
  assert.equal(clean.isContaminated, false);
  assert.deepEqual(clean.flaggedLoci, []);
  assert.equal(d.validateProfile(null).isValid, false);
  assert.equal(d.validateProfile({ str_data: {} }).isValid, false);
});

test('MATH-04: специальные токены не должны создавать STR-многоаллельность', { todo: 'ContaminationDetector считает ? и * аллелями смеси; не менять ядро до согласования' }, () => {
  assert.deepEqual(detector().detectSTRMultiAlleles(profile('unknown', { TH01: ['12', '?', '*'] })), []);
});
