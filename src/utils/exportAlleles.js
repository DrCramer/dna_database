const { isSpecialAllele, isMissingAllele } = require('./alleleTokens');
const { LociTypeDetector } = require('./lociTypeDetector');
const detector = new LociTypeDetector();

// Только формат выгрузки: исходный генотип в БД и результаты анализа не меняются.
function exportAlleles(value, locus) {
  const alleles = Array.isArray(value) ? value.map(item => String(item ?? ''))
    : value && typeof value === 'object' ? [value.allele1, value.allele2].filter(item => item != null && String(item) !== '').map(String)
    : value == null || value === '' ? [] : String(value).split(',');
  const canonical = detector.getCanonicalLocusName(locus);
  const compact = canonical === 'DYS391' || canonical === 'DXS6795' || /^RS\d+$/i.test(canonical || '');
  return compact && alleles.length === 2 && alleles[0] === alleles[1] && !isSpecialAllele(alleles[0])
    && !isMissingAllele(alleles[0]) && !alleles[0].includes('?') ? [alleles[0]] : alleles;
}

function formatExportLocusValue(value, locus) { return exportAlleles(value, locus).join(','); }
module.exports = { exportAlleles, formatExportLocusValue };
