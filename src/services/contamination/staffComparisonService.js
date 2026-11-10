const StaffContaminationAnalyzer = require('./staffContaminationAnalyzer');
const { getAnalysisLoci } = require('../../utils/analysisLoci');

// Pure, scoped snapshot calculation. Workers never select profiles from the DB.
async function compareStaffProfiles({ referenceProfiles, staffProfiles, options = {}, excludedStaffIds = [], staffRange }, { signal } = {}) {
  const analyzer = new StaffContaminationAnalyzer(null, { cacheAlleles: true, quiet: true });
  const exclusions = new Map(excludedStaffIds);
  const staffById = new Map(staffProfiles.map(profile => [profile.id, profile]));
  const candidates = staffRange ? staffProfiles.slice(...staffRange) : staffProfiles;
  const results = [];
  let comparisons = 0;
  for (const profile of referenceProfiles) {
    if (signal?.aborted) throw signal.reason;
    const excluded = new Set(exclusions.get(profile.id) || []);
    const selected = candidates.filter(staff => !excluded.has(staff.id));
    // Splitting the staff array must not change the set/order of analysed loci.
    const context = staffRange ? { allLoci: getAnalysisLoci([profile, ...staffProfiles.filter(staff => !excluded.has(staff.id))]) } : {};
    const matches = await analyzer.detectStaffContamination(profile, selected, options, context);
    comparisons += selected.length;
    results.push({ profileId: profile.id, matches: matches.map(match => ({
      ...match,
      registrationNumber: staffById.get(match.staffId)?.registration_number || null,
      staffYear: staffById.get(match.staffId)?.year || null
    })) });
    if (signal) await new Promise(resolve => setImmediate(resolve));
  }
  return { results, comparisons };
}

module.exports = { compareStaffProfiles };
