const { ALL_LOCI } = require('./lociTypeDetector');

function profileLoci(profile = {}) {
  let data = profile.loci || profile.strData || profile.str_data || {};
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return {}; }
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

// Панели задают порядок, реальные ключи дополняют его без потерь.
function getAnalysisLoci(profiles = []) {
  const ordered = new Set();
  const actual = new Set(profiles.flatMap(profile => Object.keys(profileLoci(profile))));
  for (const profile of profiles) {
    const panelOrder = profile.panel?.lociOrder || profile.panel?.loci_order || profile.metadata?.panelLociOrder;
    if (Array.isArray(panelOrder)) panelOrder.forEach(locus => ordered.add(locus));
  }
  ALL_LOCI.forEach(locus => { if (actual.has(locus)) ordered.add(locus); });
  actual.forEach(locus => ordered.add(locus));
  return [...ordered];
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
function compareProfileNumbers(a, b) {
  const expertiseA = a.sample_name ?? a.sampleName ?? '';
  const expertiseB = b.sample_name ?? b.sampleName ?? '';
  const objectA = a.internal_number ?? a.internalNumber ?? '';
  const objectB = b.internal_number ?? b.internalNumber ?? '';
  return collator.compare(String(expertiseA), String(expertiseB)) || collator.compare(String(objectA), String(objectB));
}

module.exports = { profileLoci, getAnalysisLoci, compareProfileNumbers };
