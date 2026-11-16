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
module.exports = { converterFileSummary };
