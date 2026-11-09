const { alleleTokens, isMissingAllele } = require('./alleleTokens');

// Presence only: uncertain calls and mixtures still require quality review.
function hasAllProbabilityGenotypes(genotypes) {
  return genotypes.length > 0 && genotypes.every(value => alleleTokens(value).some(token => !isMissingAllele(token)));
}

module.exports = { hasAllProbabilityGenotypes };
