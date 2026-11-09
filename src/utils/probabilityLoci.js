const { LociTypeDetector, LOCI_TYPES } = require('./lociTypeDetector');
const calculationLoci = require('./probabilityCalculationLoci.json');
const detector = new LociTypeDetector();

function isProbabilityLocus(locus, mode) {
  // Workbook-listed markers take precedence over the application's broad OTHER
  // category. Unknown STR names remain visible for validation instead of loss.
  return Boolean(calculationLoci[mode]?.includes(locus)) || detector.detectLocusType(locus) === LOCI_TYPES.STR;
}
function isProbabilityAutosomalStr(locus) {
  const type = detector.detectLocusType(locus);
  return type === LOCI_TYPES.STR || type === LOCI_TYPES.OTHER && Object.values(calculationLoci).some(loci => loci.includes(locus));
}
module.exports = { isProbabilityLocus, isProbabilityAutosomalStr, calculationLoci };
