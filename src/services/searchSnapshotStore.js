const crypto = require('crypto');
const { profileLoci } = require('../utils/analysisLoci');

const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const MAX_SNAPSHOTS = 500;
const snapshots = new Map();

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function profileFingerprint(profile) {
  return crypto.createHash('sha256').update(stableJson(profileLoci(profile))).digest('hex');
}

function prune(now = Date.now()) {
  for (const [id, entry] of snapshots) if (entry.expiresAt <= now) snapshots.delete(id);
  while (snapshots.size >= MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value);
}

function displayProfile(profile) {
  return {
    id: profile.id || null,
    sample_name: profile.sample_name ?? profile.sampleName ?? null,
    internal_number: profile.internal_number ?? profile.internalNumber ?? null,
    import_number: profile.import_number ?? profile.importNumber ?? null,
    year: profile.year ?? null,
    profileType: profile.profile_type ?? profile.profileType ?? null,
    source: profile.source ?? null
  };
}

function createSearchSnapshot({ userId, departmentId, searchMode, algorithm, settings = {}, comparisons = [] }) {
  if (!userId || !departmentId || !Array.isArray(comparisons) || !comparisons.length) return null;
  prune();
  const profileFingerprints = {};
  const temporaryReferenceIds = new Map();
  const pairs = comparisons.map(comparison => {
    const reference = comparison.referenceProfile || comparison.reference || {};
    const matched = comparison.matchedProfile || comparison.profile || {};
    const referenceId = reference.id || comparison.referenceProfileId || null;
    const matchedId = matched.id || comparison.matchedProfileId || comparison.id || null;
    if (!matchedId || (!referenceId && !Object.keys(profileLoci(reference)).length)) return null;
    let temporaryId = null;
    if (!referenceId) {
      const key = crypto.createHash('sha256').update(stableJson({
        identity: displayProfile(reference),
        loci: profileLoci(reference)
      })).digest('hex');
      if (!temporaryReferenceIds.has(key)) temporaryReferenceIds.set(key, `temporary-${crypto.randomUUID()}`);
      temporaryId = temporaryReferenceIds.get(key);
    }

    if (referenceId && !profileFingerprints[referenceId]) profileFingerprints[referenceId] = profileFingerprint(reference);
    if (matchedId && !profileFingerprints[matchedId]) profileFingerprints[matchedId] = profileFingerprint(matched);

    const groupKey = referenceId ? `db:${referenceId}` : `temporary:${temporaryId}`;
    return {
      referenceProfileId: referenceId,
      referenceKey: groupKey,
      matchedProfileId: matchedId,
      reference: referenceId ? displayProfile(reference) : {
        ...displayProfile(reference),
        temporaryId,
        loci: profileLoci(reference)
      },
      matched: displayProfile(matched),
      matchedLoci: Array.isArray(comparison.matchedLoci) ? comparison.matchedLoci : [],
      details: comparison.details && typeof comparison.details === 'object' ? comparison.details : {},
      algorithm: comparison.algorithm || algorithm || 'standard',
      matchCount: Number.isFinite(Number(comparison.matchCount ?? comparison.matchingLoci)) ? Number(comparison.matchCount ?? comparison.matchingLoci) : null,
      totalLoci: Number.isFinite(Number(comparison.totalLoci ?? comparison.comparedLociCount)) ? Number(comparison.totalLoci ?? comparison.comparedLociCount) : null,
      matchPercentage: Number.isFinite(Number(comparison.matchPercentage)) ? Number(comparison.matchPercentage) : null,
      totalScore: Number.isFinite(Number(comparison.totalScore ?? comparison.matchScore ?? comparison.score)) ? Number(comparison.totalScore ?? comparison.matchScore ?? comparison.score) : null
    };
  }).filter(Boolean);
  if (!pairs.length) return null;

  const id = crypto.randomUUID();
  const createdAt = new Date();
  snapshots.set(id, {
    id,
    userId,
    departmentId,
    searchMode: String(searchMode || 'unknown').slice(0, 60),
    algorithm: String(algorithm || pairs[0].algorithm || 'unknown').slice(0, 60),
    settings: {
      ignoredLoci: Array.isArray(settings.ignoredLoci) ? settings.ignoredLoci.slice(0, 500) : [],
      minMatches: Number.isFinite(Number(settings.minMatches)) ? Number(settings.minMatches) : null,
      duplicateSettings: settings.duplicateSettings && typeof settings.duplicateSettings === 'object' ? settings.duplicateSettings : null,
      colors: settings.colors && typeof settings.colors === 'object' ? settings.colors : null
    },
    pairs,
    profileFingerprints,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + SNAPSHOT_TTL_MS)
  });
  const groups = [...new Map(pairs.map(pair => [pair.referenceKey, {
    key: pair.referenceKey,
    label: String(pair.reference.internal_number || pair.reference.sample_name || 'Эталон').slice(0, 160),
    referenceProfileId: pair.referenceProfileId
  }])).values()];
  const profileKeys = new Set(pairs.flatMap(pair => [
    pair.referenceProfileId ? `db:${pair.referenceProfileId}` : `temporary:${pair.reference.temporaryId}`,
    `db:${pair.matchedProfileId}`
  ]));
  const loci = new Set(comparisons.flatMap(comparison => [
    ...Object.keys(profileLoci(comparison.referenceProfile || comparison.reference || {})),
    ...Object.keys(profileLoci(comparison.matchedProfile || comparison.profile || {}))
  ]));
  return {
    id,
    groups,
    pairCount: pairs.length,
    profileCount: profileKeys.size,
    profileKeys: [...profileKeys],
    locusNames: [...loci],
    expiresAt: new Date(createdAt.getTime() + SNAPSHOT_TTL_MS).toISOString()
  };
}

function getSearchSnapshots(ids, { userId, departmentId }) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(value => typeof value === 'string'))];
  if (!uniqueIds.length || uniqueIds.length > 20) {
    const error = new Error('Не выбраны доступные результаты поиска для экспорта.');
    error.status = 400;
    throw error;
  }
  prune(Date.now());
  const entries = uniqueIds.map(id => snapshots.get(id));
  if (entries.some(entry => !entry)) {
    const error = new Error('Снимок поиска истёк или недоступен. Выполните поиск заново.');
    error.status = 410;
    throw error;
  }
  if (entries.some(entry => entry.userId !== userId || entry.departmentId !== departmentId)) {
    const error = new Error('Нет доступа к результатам поиска.');
    error.status = 403;
    throw error;
  }
  return entries;
}

module.exports = { createSearchSnapshot, getSearchSnapshots, profileFingerprint, SNAPSHOT_TTL_MS };
