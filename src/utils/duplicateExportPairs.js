// Идентифицируем профили по записи БД, а не по отображаемому номеру:
// одинаковые номера у разных записей и за разные годы остаются разными профилями.
function profileKey(profile) {
  return profile?.id ? `db:${profile.id}` : profile?.temporaryId ? `temporary:${profile.temporaryId}` : null;
}

function duplicatePairKey(pair) {
  const reference = pair.referenceKey || profileKey(pair.reference);
  const matched = pair.matchedProfileId ? `db:${pair.matchedProfileId}` : profileKey(pair.matched);
  if (!reference || !matched || reference === matched) return null;
  return JSON.stringify([reference, matched].sort());
}

function uniqueDuplicatePairs(pairs) {
  const seen = new Set();
  return pairs.filter(pair => {
    const key = duplicatePairKey(pair);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { profileKey, duplicatePairKey, uniqueDuplicatePairs };
