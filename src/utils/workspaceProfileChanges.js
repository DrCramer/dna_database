// Search/readiness flags are server state, not editable profile data. In
// particular, marking every row STALE must never cause thousands of PATCHes.
const WORKSPACE_PROFILE_FIELDS = Object.freeze(['objectNumber', 'year', 'expertiseType', 'fullName', 'registrationNumber', 'comment', 'strData']);

function profileChanges(row, original = {}) {
  return Object.fromEntries(WORKSPACE_PROFILE_FIELDS.filter(key => {
    const value = row[key], previous = original[key];
    return value !== undefined && value !== previous && JSON.stringify(value) !== JSON.stringify(previous);
  }).map(key => [key, row[key]]));
}

function changedWorkingProfiles(rows, originals = []) {
  const byId = originals instanceof Map ? originals : new Map(originals.map(row => [row.id, row]));
  return rows.flatMap(row => {
    const patch = profileChanges(row, byId.get(row.id));
    return Object.keys(patch).length ? [{ id: row.id, patch }] : [];
  });
}
module.exports = { WORKSPACE_PROFILE_FIELDS, profileChanges, changedWorkingProfiles };
