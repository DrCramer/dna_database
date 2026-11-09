const { isProbabilityLocus } = require('./probabilityLoci');

// Files and sample IDs come from the authenticated, signed TXT preview API.
// A file's content digest, rather than its name, identifies repeated uploads.
function mergeTxtFiles(existing, incoming) {
  return [...new Map([...existing, ...incoming].map(file => [file.fileId, file])).values()];
}
function sampleLocusCount(sample, mode) {
  return Object.entries(sample.loci || {}).filter(([locus, alleles]) =>
    isProbabilityLocus(locus, mode) && Array.isArray(alleles) && alleles.some(a => String(a).trim())).length;
}
function sampleRows(files, query = '', includeExcluded = false) {
  const search = query.trim().toLocaleLowerCase('ru');
  const nameCounts = new Map();
  return files.flatMap(file => {
    const number = (nameCounts.get(file.filename) || 0) + 1;
    nameCounts.set(file.filename, number);
    const fileLabel = file.filename + (number > 1 ? ` (${number})` : '');
    return file.samples.filter(sample => (includeExcluded || sample.selectable)
      && (!search || [sample.displayName, file.filename, sample.year].join(' ').toLocaleLowerCase('ru').includes(search)))
      .map(sample => ({ sample, fileId: file.fileId, fileLabel }));
  });
}
function assignedRoles(profiles, roles, sourceId) {
  return roles.filter(role => profiles[role]?.sourceType === 'txt' && profiles[role].sourceId === sourceId);
}
function withoutTxtFile(files, profiles, fileId) {
  const removed = new Set((files.find(file => file.fileId === fileId)?.samples || []).map(sample => sample.sourceId));
  return {
    files: files.filter(file => file.fileId !== fileId),
    profiles: Object.fromEntries(Object.entries(profiles).map(([role, profile]) =>
      [role, profile?.sourceType === 'txt' && removed.has(profile.sourceId) ? null : profile]))
  };
}
module.exports = { mergeTxtFiles, sampleRows, sampleLocusCount, assignedRoles, withoutTxtFile };
