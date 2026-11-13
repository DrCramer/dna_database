// The main analysis screen overlays saved genotypeAnalysisSettings on these
// defaults. Request options exclude colors and other presentation-only flags.
const COEFFICIENTS = Object.freeze({ fullMatch: 1, partialMatch: 0.4, penalty: -1, inclusiveDropout: 0.85, overInclusiveMix: 0.7 });
const NUMBERS = Object.freeze({ threshold: [5.5, 0, 100], minLociMatch: [8, 1, 500], criticalAlleleCount: [3, 1, 100], weightCriticalLocus: [2, 0, 100], stutterThreshold: [0.15, 0, 1] });
function staffSearchOptions(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [key, [fallback, min, max]] of Object.entries(NUMBERS)) {
    const n = input[key];
    result[key] = typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max && (!['minLociMatch', 'criticalAlleleCount'].includes(key) || Number.isInteger(n)) ? n : fallback;
  }
  result.useV4Algorithm = typeof input.useV4Algorithm === 'boolean' ? input.useV4Algorithm : true;
  result.useV5Algorithm = typeof input.useV5Algorithm === 'boolean' ? input.useV5Algorithm : true;
  // Empty maps mean unit weights in main v4, not weighted server defaults.
  result.locusWeights = Object.fromEntries(Object.entries(input.locusWeights || {}).filter(([key, n]) => key.length <= 100 && !['__proto__','constructor','prototype'].includes(key) && typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100).slice(0, 510));
  result.matchCoefficients = { ...COEFFICIENTS };
  for (const key of Object.keys(COEFFICIENTS)) {
    const n = input.matchCoefficients?.[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= (key === 'penalty' ? -100 : 0) && n <= 100) result.matchCoefficients[key] = n;
  }
  result.ignoredLoci = Array.isArray(input.ignoredLoci) ? [...new Set(input.ignoredLoci.filter(locus => typeof locus === 'string' && locus.length > 0 && locus.length <= 100))].slice(0, 510) : [];
  return result;
}
function legacyContaminationSettings(value = {}) {
  return { ...staffSearchOptions(), searchInMasterArray: false, autoCommentDuplicates: true,
    colors: { fullMatch: '#90EE90', partialMatch: '#9d8311', partialMatchAllele: '#1400e8', noMatch: '#FFB6C1' }, ...value };
}
module.exports = { staffSearchOptions, legacyContaminationSettings };
