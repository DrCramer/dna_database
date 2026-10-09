const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractExpertiseNumber } = require('../src/utils/profileImportFormat');
const { getAnalysisLoci, compareProfileNumbers } = require('../src/utils/analysisLoci');
const { GenotypePanel } = require('../src/models/GenotypePanel');

test('Экспертиза извлекается централизованно, полный номер не сокращается', () => {
  for (const number of ['258-1', '258-2', '258-11x', ' 258-41 ', '258']) assert.equal(extractExpertiseNumber(number), '258');
  assert.equal(extractExpertiseNumber('A-B-C'), 'A');
  assert.equal(extractExpertiseNumber(258), '258');
});

test('Естественный порядок: сначала экспертиза, затем полный объект', () => {
  const profiles = ['259-1', '258-11x', '258-10', '258-2', '257-9', '258-9', '258-1'].map(internalNumber => ({ internalNumber, sampleName: extractExpertiseNumber(internalNumber) }));
  assert.deepEqual(profiles.sort(compareProfileNumbers).map(profile => profile.internalNumber), ['257-9', '258-1', '258-2', '258-9', '258-10', '258-11x', '259-1']);
});

test('Порядок нескольких панелей и все реальные дополнительные ключи', () => {
  const profiles = [
    { panel: { lociOrder: ['FGA', 'TH01', 'AMEL'] }, str_data: { TH01: [], AMEL: [], FGA: [], D6S1043: [], CustomMarker: [] } },
    { panel: { lociOrder: ['SRY', 'TH01', 'DYS392'] }, loci: { SRY: [], DYS392: [], 'Penta D': [], Rs2032678: [] } }
  ];
  const loci = getAnalysisLoci(profiles);
  assert.deepEqual(loci.slice(0, 5), ['FGA', 'TH01', 'AMEL', 'SRY', 'DYS392']);
  for (const name of ['D6S1043', 'CustomMarker', 'Penta D', 'Rs2032678']) assert(loci.includes(name));
  assert.equal(loci.length, new Set(loci).size);
});

test('Без панели: каталог упорядочивает имеющиеся ключи, неизвестный ключ сохраняется', () => {
  const keys = ['D6S1043', 'D4S2366', 'Rs2032678', 'SRY', 'Penta D', 'DYS392', 'Penta E', 'Rs771783753', 'CustomMarker'];
  const result = getAnalysisLoci([{ strData: JSON.stringify(Object.fromEntries(keys.map(name => [name, []]))) }]);
  assert.equal(result.length, keys.length);
  keys.forEach(name => assert(result.includes(name)));
  assert.equal(result.at(-1), 'CustomMarker');
});

test('Панель canonicalize: регистр и Penta, запрет опечаток, дублей и пустых локусов', () => {
  assert.deepEqual(GenotypePanel.validate({ name: ' TEST-PANEL ', lociOrder: [' th01 ', 'PentaD', 'sry'] }).lociOrder, ['TH01', 'Penta D', 'SRY']);
  for (const lociOrder of [[], [''], ['TH01', 'th01'], ['SRYY']]) assert.throws(() => GenotypePanel.validate({ name: 'TEST', lociOrder }));
  assert.throws(() => GenotypePanel.validate({ name: 'TEST', lociOrder: ['Typo'] }), /пока не поддерживается/);
});

test('Y-InDel доступны в каталоге и панели, старое имя Rs771783753 остаётся каноническим', () => {
  const expectedCatalogOrder = ['Rs771783753', 'rs199815934', 'rs759551978'];
  const catalog = GenotypePanel.catalog();
  for (const name of expectedCatalogOrder) assert(catalog.some(item => item.name === name && item.type === 'Y_INDEL'));
  const panel = GenotypePanel.validate({ name: 'SureID PanGlobal Plus', lociOrder: ['RS199815934', 'rs771783753', 'RS759551978'] });
  assert.deepEqual(panel.lociOrder, ['rs199815934', 'Rs771783753', 'rs759551978']);
  assert.throws(() => GenotypePanel.validate({ name: 'Duplicate aliases', lociOrder: ['rs199815934', 'RS199815934'] }), /не должны повторяться/);
  const actual = getAnalysisLoci([{ strData: { 'rs199815934': ['1'], Rs771783753: ['2'], 'rs759551978': ['1'] } }]);
  assert.deepEqual(actual, expectedCatalogOrder);
});

test('Состав и порядок панели дают предупреждения без потери mapping', () => {
  const warnings = GenotypePanel.compareLoci({ lociOrder: ['FGA', 'TH01', 'AMEL', 'SRY'] }, ['TH01', 'AMEL', 'FGA', 'SE33']);
  assert.equal(warnings.length, 3);
  assert(warnings.some(value => /SRY/.test(value)));
  assert(warnings.some(value => /SE33/.test(value)));
  assert(warnings.some(value => /Порядок/.test(value)));
});

test('Контаминация включает AMEL, Yindel и DYS391; явные исключения сохраняются', async () => {
  const Analyzer = require('../src/services/staffContaminationAnalyzer');
  const analyzer = new Analyzer();
  const str_data = { AMEL: ['X', 'Y'], Yindel: ['1'], DYS391: ['10'], D6S1043: ['8', '10', '12'] };
  const sample = { id: 'synthetic', str_data };
  const staff = [{ id: 'synthetic-staff', full_name: 'Синтетический сотрудник', str_data }];
  const options = { threshold: 0, useV5Algorithm: false, useV4Algorithm: true };
  const result = await analyzer.detectStaffContamination(sample, staff, options);
  assert.deepEqual(new Set(result[0].detailedMatches.map(match => match.locus)), new Set(Object.keys(str_data)));
  const ignored = await analyzer.detectStaffContamination(sample, staff, { ...options, ignoredLoci: ['AMEL'] });
  assert(!ignored[0].detailedMatches.some(match => match.locus === 'AMEL'));
});
