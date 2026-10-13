const test = require('node:test');
const assert = require('node:assert/strict');
const { getLocusComparisonPresentation } = require('../src/utils/locusComparisonPresentation');

test('comparison presentation distinguishes full, partial, mismatch, missing and ignored loci', () => {
  const referenceData = ['8', '8'];
  const base = { referenceData, locus: 'TH01' };
  assert.equal(getLocusComparisonPresentation({ ...base, comparedData: ['8', '8'], matchedLoci: ['TH01'] }).status, 'full');
  const partial = getLocusComparisonPresentation({ ...base, comparedData: ['8', '9'] });
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.alleles.map(allele => allele.matched), [true, false]);
  assert.equal(getLocusComparisonPresentation({ ...base, comparedData: ['10', '11'] }).status, 'no_match');
  assert.equal(getLocusComparisonPresentation({ ...base, comparedData: [] }).status, 'no_data');
  const ignored = getLocusComparisonPresentation({
    ...base,
    comparedData: ['10', '11'],
    details: { TH01: { status: 'mismatch' } },
    ignoredLoci: ['TH01']
  });
  assert.equal(ignored.status, 'not_compared');
  assert.equal(ignored.backgroundColor, null);
});

test('haploid markers and fractional alleles are kept as single unchanged allele tokens', () => {
  const haploid = getLocusComparisonPresentation({ referenceData: 'Y', comparedData: 'Y', locus: 'SRY' });
  assert.equal(haploid.status, 'full');
  assert.deepEqual(haploid.alleles.map(allele => allele.value), ['Y']);
  const microvariant = getLocusComparisonPresentation({
    referenceData: ['12.2', '13'], comparedData: ['13', '14'], locus: 'D5S818'
  });
  assert.deepEqual(microvariant.alleles.map(allele => allele.value), ['13', '14']);
  assert.equal(microvariant.status, 'partial');
});
