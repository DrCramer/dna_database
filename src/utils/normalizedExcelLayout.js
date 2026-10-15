const { LociTypeDetector, LOCI_TYPES } = require('./lociTypeDetector');
const { extractExpertiseNumber } = require('./profileImportFormat');

const detector = new LociTypeDetector();
const sexTypes = new Set([LOCI_TYPES.Y_CHROMOSOME, LOCI_TYPES.X_CHROMOSOME, LOCI_TYPES.AMELOGENIN, LOCI_TYPES.Y_INDEL]);

function isSexLocus(locus) {
  return detector.getCanonicalLocusName(locus) === 'Yindel' || sexTypes.has(detector.detectLocusType(locus));
}

function orderNormalizedLoci(loci) {
  return [...loci.filter(locus => !isSexLocus(locus)), ...loci.filter(isSexLocus)];
}

function normalizedExcelFilename(profiles = []) {
  const names = [...new Set(profiles.map(profile => {
    const expertise = extractExpertiseNumber(profile.objectNumber).replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '') || 'Экспертиза';
    const year = profile.year == null || profile.year === '' ? 'без-года' : String(profile.year);
    return `${expertise}-${year}`;
  }))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  if (!names.length) return 'DNA-normalized.xlsx';
  const suffix = names.length > 3 ? `_и-еще-${names.length - 3}` : '';
  return `${names.slice(0, 3).join('_').slice(0, 160 - suffix.length)}${suffix}.xlsx`;
}

function geneMapperExportFilename(sourceFilename) {
  const base = String(sourceFilename || 'GeneMapper').split(/[\\/]/).pop().replace(/\.txt$/i, '')
    .replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 180) || 'GeneMapper';
  return `${base}.xlsx`;
}

module.exports = { isSexLocus, orderNormalizedLoci, normalizedExcelFilename, geneMapperExportFilename };
