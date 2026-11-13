const StaffContaminationAnalyzer = require('./staffContaminationAnalyzer');
const { getAnalysisLoci, profileLoci } = require('../../utils/analysisLoci');

// Pure, scoped snapshot calculation. Workers never select profiles from the DB.
async function compareStaffProfiles({ referenceProfiles, staffProfiles, options = {}, excludedStaffIds = [], staffRange }, { signal, onProgress } = {}) {
  const analyzer = new StaffContaminationAnalyzer(null, { cacheAlleles: true, quiet: true, optimizeComparisons: true });
  const exclusions = new Map(excludedStaffIds);
  const staffById = new Map(staffProfiles.map(profile => [profile.id, profile]));
  const candidates = staffRange ? staffProfiles.slice(...staffRange) : staffProfiles;
  const schemas = new Map();
  const results = [];
  let comparisons = 0;
  let completed = 0;
  for (const profile of referenceProfiles) {
    onProgress?.({ status: 'running', completed: completed++, total: referenceProfiles.length, unit: 'objects' });
    if (signal?.aborted) throw signal.reason;
    const excluded = new Set(exclusions.get(profile.id) || []);
    const selected = candidates.filter(staff => !excluded.has(staff.id));
    // Splitting the staff array must not change the set/order of analysed loci.
    // Locus order depends on keys, panel order and exclusions, not allele values.
    // Keep a bounded, run-local cache, using the FULL staff snapshot for ranges.
    const panel = profile.panel?.lociOrder || profile.panel?.loci_order || profile.metadata?.panelLociOrder;
    const schema = JSON.stringify([Object.keys(profileLoci(profile)), Array.isArray(panel) ? panel : null, [...excluded]]);
    let allLoci = schemas.get(schema);
    if (!allLoci) {
      allLoci = getAnalysisLoci([profile, ...staffProfiles.filter(staff => !excluded.has(staff.id))]);
      if (schemas.size < 256) schemas.set(schema, allLoci);
    }
    const context = { allLoci };
    const matches = await analyzer.detectStaffContamination(profile, selected, options, context);
    comparisons += selected.length;
    results.push({ profileId: profile.id, matches: matches.map(match => ({
      ...match,
      registrationNumber: staffById.get(match.staffId)?.registration_number || null,
      staffYear: staffById.get(match.staffId)?.year || null
    })) });
    if (signal) await new Promise(resolve => setImmediate(resolve));
  }
  onProgress?.({ status: 'running', completed, total: referenceProfiles.length, unit: 'objects' });
  return { results, comparisons };
}

module.exports = { compareStaffProfiles };
