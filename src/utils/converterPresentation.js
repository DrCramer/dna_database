// Aggregate once per server preview, rather than scanning all profiles and issues
// for every file on each keystroke. These counters never modify source genotypes.
function converterFileSummary(result) {
  const summary = new Map((result?.files || []).map(file => [file.id, { count: 0, hard: 0, reason: '', prepared: null }]));
  for (const profile of result?.profiles || []) {
    for (const id of new Set(profile.sources.map(source => source.fileId))) {
      const entry = summary.get(id); if (entry) entry.count++;
    }
  }
  for (const issue of result?.issues || []) {
    const entry = summary.get(issue.fileId);
    if (entry && issue.hard) { entry.hard++; if (!entry.reason) entry.reason = issue.reason || ''; }
  }
  for (const prepared of result?.preparedFiles || []) {
    const entry = summary.get(prepared.fileId); if (entry) entry.prepared = prepared;
  }
  for (const file of result?.files || []) {
    if (file.geneMapper) summary.get(file.id).count = file.geneMapper.samples.filter(sample => sample.included && sample.exportable).length;
  }
  return summary;
}
// Confirmation is a presentation state; validation warnings and genotypes remain intact.
function converterIssueView(issues, status = 'hard', search = '') {
  const filtered = [], query = search.toLowerCase();
  let confirmedCount = 0, unconfirmedCount = 0;
  for (const issue of issues) {
    if (query && !`${issue.objectNumber || ''} ${issue.locus || ''} ${issue.sourceFile || ''}`.toLowerCase().includes(query)) continue;
    const confirmed = Boolean(issue.userDecision) && issue.hard === false;
    if (confirmed) confirmedCount++; else unconfirmedCount++;
    if (status === 'confirmed' ? confirmed : !confirmed && (status === 'all' || (status === 'hard' ? issue.hard : issue.status === status))) filtered.push(issue);
  }
  return { filtered, confirmedCount, unconfirmedCount };
}
module.exports = { converterFileSummary, converterIssueView };
