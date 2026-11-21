function replaceObjectEntries(entries, profiles, replacement) {
  const pending = new Map();
  for (const entry of replacement) {
    if (!pending.has(entry.profileKey)) pending.set(entry.profileKey, []);
    pending.get(entry.profileKey).push(entry);
  }
  const next = [];
  for (const entry of entries) {
    if (!profiles.has(entry.profileKey)) {
      next.push(entry);
      continue;
    }
    for (const updated of pending.get(entry.profileKey) || []) next.push(updated);
    pending.delete(entry.profileKey);
  }
  for (const remaining of pending.values()) {
    for (const entry of remaining) next.push(entry);
  }
  return next;
}

function applyConverterObjectsPreview(result, patch) {
  const replacements = new Map(patch.profiles.map(profile => [profile.key, profile]));
  const counts = { unchanged: result.summary.unchanged, autoFixed: result.summary.autoFixed, emptyExcelProfiles: result.summary.emptyExcelProfiles };
  let matched = 0;
  const profiles = result.profiles.map(previous => {
    const updated = replacements.get(previous.key);
    if (!updated) return previous;
    if (!previous.conversionCounts || !updated.conversionCounts) throw new Error('Профиль изменился. Повторите полную проверку файлов.');
    matched++;
    counts.unchanged += updated.conversionCounts.unchanged - previous.conversionCounts.unchanged;
    counts.autoFixed += updated.conversionCounts.autoFixed - previous.conversionCounts.autoFixed;
    if (patch.countEmptyProfiles) counts.emptyExcelProfiles += Number(!updated.populatedLoci.length) - Number(!previous.populatedLoci.length);
    return updated;
  });
  if (!matched || matched !== patch.profiles.length) throw new Error('Список объектов изменился. Повторите полную проверку файлов.');

  const issues = replaceObjectEntries(result.issues, replacements, patch.issues);
  const conflicts = replaceObjectEntries(result.conflicts, replacements, patch.conflicts);
  const canImport = !issues.some(issue => issue.hard);
  const canUpload = canImport && profiles.every(item => item.year != null);
  const summary = {
    ...result.summary,
    ...counts,
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

function applyConverterObjectPreview(result, { profile, ...patch }) {
  return applyConverterObjectsPreview(result, { ...patch, profiles: [profile] });
}

module.exports = { applyConverterObjectPreview, applyConverterObjectsPreview };
