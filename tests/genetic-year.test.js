const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGeneticHeaders, geneticProfileKey } = require('../src/utils/profileImportFormat');

test('Genetic import requires a year column, without treating it as a locus', () => {
  const validation = validateGeneticHeaders(['Объект', 'Год', 'TH01', 'D5S818', 'D21S11']);
  assert.equal(validation.valid, true);
  assert.equal(validation.yearIndex, 1);
  assert.deepEqual(validation.columns.map(column => column.index), [2, 3, 4]);
  assert.equal(validateGeneticHeaders(['Объект', 'TH01', 'D5S818', 'D21S11']).valid, false);
  assert.equal(validateGeneticHeaders(['Объект', 'TH01', 'D5S818', 'D21S11']).errors[0].code, 'MISSING_YEAR_COLUMN');
});

test('Genetic profile duplicate identity includes year and normalizes object names', () => {
  assert.equal(geneticProfileKey(2025, ' EXP-1 '), geneticProfileKey(2025, 'exp-1'));
  assert.notEqual(geneticProfileKey(2025, 'EXP-1'), geneticProfileKey(2026, 'EXP-1'));
});
