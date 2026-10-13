const { alleleTokens, isMissingAllele, isSpecialAllele } = require('./alleleTokens');

const DEFAULT_MATCH_COLORS = Object.freeze({
  fullMatch: '#90EE90',
  partialMatch: '#9d8311',
  partialMatchAllele: '#1400e8',
  noMatch: '#FFB6C1'
});

function normalizeHexColor(value, fallback) {
  const candidate = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toUpperCase() : fallback;
}

function normalizeMatchColors(colors = {}) {
  return {
    fullMatch: normalizeHexColor(colors.fullMatch, DEFAULT_MATCH_COLORS.fullMatch),
    partialMatch: normalizeHexColor(colors.partialMatch, DEFAULT_MATCH_COLORS.partialMatch),
    partialMatchAllele: normalizeHexColor(colors.partialMatchAllele, DEFAULT_MATCH_COLORS.partialMatchAllele),
    noMatch: normalizeHexColor(colors.noMatch, DEFAULT_MATCH_COLORS.noMatch)
  };
}

function rawAlleles(value) {
  return alleleTokens(value).filter(token => !isMissingAllele(token));
}

function informative(alleles) {
  return alleles.filter(allele => !isSpecialAllele(allele) && !String(allele).includes('?'));
}

function detailStatus(details, locus) {
  const detail = details && details[locus];
  return typeof detail === 'string' ? detail.toLowerCase() : String(detail?.status || '').toLowerCase();
}

/** Shared display classification for the analysis table and duplicate XLSX. */
function getLocusComparisonPresentation({
  referenceData,
  comparedData,
  matchedLoci,
  details,
  locus,
  ignoredLoci = [],
  colors
}) {
  const palette = normalizeMatchColors(colors);
  const ignored = ignoredLoci instanceof Set ? ignoredLoci : new Set(ignoredLoci || []);
  const comparisonAlleles = rawAlleles(comparedData);
  const referenceAlleles = rawAlleles(referenceData);
  const compInformative = informative(comparisonAlleles);
  const refInformative = informative(referenceAlleles);
  const matchedSet = new Set(refInformative);
  const detail = detailStatus(details, locus);
  const excluded = ignored.has(locus);
  const statusFromDetails = {
    match: 'full',
    contamination: 'partial',
    dropout: 'partial',
    partial: 'partial',
    mismatch: 'no_match',
    no_call: 'no_data'
  }[detail];

  let status;
  if (excluded) status = 'not_compared';
  else if (!refInformative.length || !compInformative.length) status = 'no_data';
  else if (statusFromDetails) status = statusFromDetails;
  else {
    const sortedReference = [...refInformative].sort();
    const sortedCompared = [...compInformative].sort();
    const isExact = sortedReference.length === sortedCompared.length &&
      sortedReference.every((allele, index) => allele === sortedCompared[index]);
    const isAlgorithmMatch = !Array.isArray(matchedLoci) || matchedLoci.includes(locus);
    if (isExact) status = isAlgorithmMatch ? 'full' : 'not_compared';
    else if (compInformative.some(allele => matchedSet.has(allele))) status = 'partial';
    else status = 'no_match';
  }

  const backgroundColor = status === 'full' ? palette.fullMatch
    : status === 'partial' ? palette.partialMatch
      : status === 'no_match' ? palette.noMatch : null;

  return {
    status,
    backgroundColor,
    colors: palette,
    alleles: comparisonAlleles.map(value => ({
      value,
      matched: !isSpecialAllele(value) && matchedSet.has(value)
    }))
  };
}

function formatLocusValue(value) {
  if (Array.isArray(value)) return value.map(item => String(item ?? '')).filter(Boolean).join(',');
  if (value && typeof value === 'object') {
    return [value.allele1, value.allele2].filter(item => item != null && String(item) !== '').map(String).join(',');
  }
  return value == null ? '' : String(value);
}

module.exports = {
  DEFAULT_MATCH_COLORS,
  normalizeHexColor,
  normalizeMatchColors,
  getLocusComparisonPresentation,
  formatLocusValue
};
