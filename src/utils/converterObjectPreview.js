function replaceObjectEntries(entries, key, replacement) {
  const index = entries.findIndex(entry => entry.profileKey === key);
  if (index < 0) return replacement.length ? [...entries, ...replacement] : entries;
  return [
    ...entries.slice(0, index),
    ...replacement,
    ...entries.slice(index).filter(entry => entry.profileKey !== key)
  ];
}

function applyConverterObjectPreview(result, patch) {
  const { profile } = patch;
  const index = result.profiles.findIndex(previous => previous.key === profile.key);
  const previous = result.profiles[index];
  if (!previous?.conversionCounts || !profile.conversionCounts) throw new Error('Профиль изменился. Повторите полную проверку файлов.');

  const profiles = result.profiles.slice();
  profiles[index] = profile;
  const issues = replaceObjectEntries(result.issues, profile.key, patch.issues);
  const conflicts = replaceObjectEntries(result.conflicts, profile.key, patch.conflicts);
  const canImport = !issues.some(issue => issue.hard);
  const canUpload = canImport && profiles.every(item => item.year != null);
  const summary = {
    ...result.summary,
    unchanged: result.summary.unchanged - previous.conversionCounts.unchanged + profile.conversionCounts.unchanged,
    autoFixed: result.summary.autoFixed - previous.conversionCounts.autoFixed + profile.conversionCounts.autoFixed,
    emptyExcelProfiles: result.summary.emptyExcelProfiles +
      (patch.countEmptyProfiles ? Number(!profile.populatedLoci.length) - Number(!previous.populatedLoci.length) : 0),
    warnings: issues.filter(issue => issue.status === 'WARNING').length,
    unresolved: issues.filter(issue => issue.hard && issue.status !== 'CONFLICT').length,
    conflicts: conflicts.filter(issue => issue.hard).length
  };
  // Bulk-decision feedback belongs to the preview immediately after that decision.
  const next = { ...result, profiles, issues, conflicts, summary, canImport, canUpload };
  delete next.bulkDecisions;
  if (Object.hasOwn(result, 'legacyCanImport')) next.legacyCanImport = canImport;
  if (Object.hasOwn(result, 'legacyCanUpload')) next.legacyCanUpload = canUpload;
  return next;
}

module.exports = { applyConverterObjectPreview };
