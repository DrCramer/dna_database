function profileSources(profile) {
  return profile.sources.map(source => JSON.stringify(source.geneMapper
    ? [source.fileId, 'sample', source.geneMapper.sampleName]
    : [source.fileId, source.sheet, source.row]));
}

function legacyConverterResult(result) {
  const fileIds = new Set(result.files.filter(file => !file.geneMapper).map(file => file.id));
  const profiles = result.profiles.filter(profile => profile.sources.every(source => fileIds.has(source.fileId)));
  const profileKeys = new Set(profiles.map(profile => profile.key));
  const canImport = profiles.length > 0 && !result.issues.some(issue =>
    issue.hard && (fileIds.has(issue.fileId) || profileKeys.has(issue.profileKey)));
  return { ...result, profiles, canImport, canUpload: canImport && profiles.every(profile => profile.year != null) };
}

function selectConverterProfiles(result, excludedIndices) {
  if (!excludedIndices.length) return result;

  const excluded = new Set(excludedIndices);
  const profiles = result.profiles.filter((_, index) => !excluded.has(index));
  const keys = new Set(profiles.map(profile => profile.key));
  const originalKeys = new Set(result.profiles.map(profile => profile.key));
  const originalFileIds = new Set(result.profiles.flatMap(profile => profile.sources.map(source => source.fileId)));
  const fileIds = new Set();
  const exportableCounts = new Map(), missingYears = new Set();
  const samples = new Map();
  for (const profile of profiles) {
    const exportableFiles = new Set();
    for (const source of profile.sources) {
      fileIds.add(source.fileId);
      if (!source.geneMapper) continue;
      if (!samples.has(source.fileId)) samples.set(source.fileId, new Set());
      samples.get(source.fileId).add(source.geneMapper.sampleName);
      if (profile.exportable) exportableFiles.add(source.fileId);
    }
    for (const fileId of exportableFiles) {
      exportableCounts.set(fileId, (exportableCounts.get(fileId) || 0) + 1);
      if (profile.year == null) missingYears.add(fileId);
    }
  }
  const issues = result.issues.filter(issue => {
    if (originalKeys.has(issue.profileKey)) return keys.has(issue.profileKey);
    if (!issue.fileId) return true;
    if (originalFileIds.has(issue.fileId) && !fileIds.has(issue.fileId)) return false;
    return !issue.geneMapperSampleName || samples.get(issue.fileId)?.has(issue.geneMapperSampleName);
  });
  const filesById = new Map(result.files.map(file => [file.id, file]));
  const preparedFiles = (result.preparedFiles || []).map(file => {
    const count = exportableCounts.get(file.fileId) || 0;
    const sourceFile = filesById.get(file.fileId);
    return { ...file, profiles: count, ready: count > 0, excluded: sourceFile.geneMapper.samples.length - count,
      canUpload: count > 0 && !missingYears.has(file.fileId) && sourceFile.yearConfirmed === true };
  });
  const canImport = profiles.length > 0 && !issues.some(issue => issue.hard);
  return { ...result, profiles, issues, preparedFiles, canImport,
    canUpload: canImport && profiles.every(profile => profile.year != null) };
}

module.exports = { profileSources, selectConverterProfiles, legacyConverterResult };
