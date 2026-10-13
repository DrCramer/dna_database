const assert = require('node:assert/strict');

// Все профили и частоты синтетические, без персональных или производственных данных.
function profile(id = 'synthetic-a', strData = {}) {
  return { id, sample_name: id, internal_number: id, str_data: structuredClone(strData) };
}

function population() {
  return {
    populationId: 'synthetic-population',
    locusFrequencies: new Map([
      ['TH01', { frequencies: new Map([['12', 0.2], ['13', 0.3], ['14', 0.5]]) }],
      ['D5S818', { frequencies: new Map([['11', 0.4], ['12', 0.6]]) }],
      ['D21S11', { frequencies: new Map([['29', 0.25], ['30', 0.75]]) }]
    ])
  };
}

function parameters(overrides = {}) {
  const values = {
    inbreedingCoefficient: 0, thetaCorrection: 0.1,
    dropOutProbability: 0, falseAlleleProbability: 0, contaminationThreshold: 0.25,
    ...overrides
  };
  return {
    getBayesianParameters: async () => ({ ...values }),
    getParameter: async name => {
      assert.equal(name, 'degradation_threshold');
      return 0.5;
    }
  };
}

function close(actual, expected, tolerance = 1e-12) {
  assert(Number.isFinite(actual), `Ожидалось конечное число, получено ${actual}`);
  assert(Math.abs(actual - expected) <= tolerance, `${actual} отличается от ${expected}`);
}

module.exports = { profile, population, parameters, close };
