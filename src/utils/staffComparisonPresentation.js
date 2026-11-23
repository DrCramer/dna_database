const { alleleTokens, informativeAlleles } = require('./alleleTokens');
const { profileLoci } = require('./analysisLoci');
const { normalizeMatchColors } = require('./locusComparisonPresentation');

// Consume copies, not just a Set: one explained allele must not highlight both
// copies of a homozygote when only one copy was used by the algorithm.
function highlightedAlleles(raw, explained) {
  const remaining = [...explained];
  return alleleTokens(raw).map(value => {
    const index = informativeAlleles([value]).length ? remaining.indexOf(value) : -1;
    if (index >= 0) remaining.splice(index, 1);
    return { value, matched: index >= 0 };
  });
}
function present(status, raw, explained, colors) {
  const palette = normalizeMatchColors(colors);
  return { status, colors: palette, explainedAlleles: explained,
    backgroundColor: status === 'full' ? palette.fullMatch : status === 'partial' ? palette.partialMatch : status === 'no_match' ? palette.noMatch : null,
    alleles: highlightedAlleles(raw, explained) };
}
function getStaffLocusPresentation({ sampleData, staffData, detail, locus, ignoredLoci = [], colors }) {
  const ignored = ignoredLoci instanceof Set ? ignoredLoci : new Set(ignoredLoci);
  if (ignored.has(locus)) return present('not_compared', staffData, [], colors);
  if (!informativeAlleles(sampleData).length || !informativeAlleles(staffData).length || detail?.matchType === 'empty') return present('no_data', staffData, [], colors);
  if (!detail) return present('not_compared', staffData, [], colors);
  const explained = informativeAlleles(detail.explainedAlleles || []);
  // isFullMatch is deliberately authoritative, not equality of raw genotypes.
  // v4/v1.5 and v5 give mixtures and dropout different classifications.
  const status = !explained.length || detail.matchType === 'mismatch' ? 'no_match'
    : detail.isFullMatch === true || detail.matchType === 'fullMatch' ? 'full' : 'partial';
  return present(status, staffData, status === 'no_match' ? [] : explained, colors);
}
function getStaffSamplePresentation({ sampleData, comparisons, colors }) {
  if (!informativeAlleles(sampleData).length) return present('no_data', sampleData, [], colors);
  const contributing = comparisons.filter(p => p.status === 'full' || p.status === 'partial');
  const maximum = new Map();
  for (const item of contributing) {
    const counts = new Map();
    for (const allele of item.explainedAlleles) counts.set(allele, (counts.get(allele) || 0) + 1);
    for (const [allele, count] of counts) maximum.set(allele, Math.max(maximum.get(allele) || 0, count));
  }
  const explained = [...maximum].flatMap(([allele, count]) => Array(count).fill(allele));
  const status = contributing.some(p => p.status === 'full') ? 'full' : contributing.length ? 'partial' : 'not_compared';
  return present(status, sampleData, explained, colors);
}
function evidenceData(matches, field) {
  const data = {};
  for (const match of matches) for (const detail of match.detailedMatches || []) {
    if (!Object.hasOwn(data, detail.locus) && Array.isArray(detail[field])) data[detail.locus] = [...detail[field]];
  }
  return data;
}
// Converts only matched, already-authorized snapshots. Never reads current DB
// profiles or the editable workspace, which may have changed after the search.
function staffComparisonGroups(groups, snapshots = []) {
  const staffById = new Map(snapshots.map(p => [p.id, p]));
  return groups.filter(group => group.matches?.length).map(group => ({
    reference: group.reference || { id: group.profileId, internal_number: 'Номер объекта не сохранён', loci: evidenceData(group.matches, 'sampleAlleles'), normalizedEvidenceOnly: true },
    matches: group.matches.map(match => {
      const snapshot = staffById.get(match.staffId);
      const legacyNumber = match.registrationNumber || (/^workspace-/.test(match.staffIdentifier || '') ? '' : match.staffIdentifier) || '';
      return { id: match.staffId, internal_number: snapshot ? snapshot.internal_number || '' : legacyNumber,
        full_name: snapshot?.full_name || match.staffName || 'Сотрудник', year: snapshot?.year ?? match.staffYear,
        loci: snapshot ? profileLoci(snapshot) : evidenceData([match], 'staffAlleles'),
        staffEvidence: match, normalizedEvidenceOnly: !snapshot };
    })
  }));
}
module.exports = { highlightedAlleles, getStaffLocusPresentation, getStaffSamplePresentation, staffComparisonGroups };
