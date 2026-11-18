const { createHmac } = require('node:crypto');
const { alleleTokens } = require('../../utils/alleleTokens');
const { profileLoci } = require('../../utils/analysisLoci');
const { unseal } = require('./workspaceCrypto');

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const LOOKUP_BATCH_SIZE = 4000;
const historyKey = () => require('../../config/security').securityConfig.encryptionKey;

function collectDuplicatePairs(result, { includeMatches = true, key = historyKey() } = {}) {
  const keys = new Map();
  let complete = true;
  const digest = (kind, value) => createHmac('sha256', key)
    .update('workspace-duplicates:v1:' + kind + ':')
    .update(JSON.stringify(value)).digest('hex');

  for (const stage of ['internal', 'master']) {
    const groups = result[stage]?.results;
    if (!Array.isArray(groups)) { complete = false; continue; }
    // All appearances of a profile within one side of a stage use the same snapshot.
    const fingerprints = new Map();
    const fingerprint = (profile, side) => {
      if (typeof profile?.id !== 'string' || !profile.id) return null;
      const cacheKey = JSON.stringify([side, profile.id, profile.year ?? null]);
      if (fingerprints.has(cacheKey)) return fingerprints.get(cacheKey);
      const genotype = Object.entries(profileLoci(profile))
        .map(([locus, alleles]) => [locus, alleleTokens(alleles).sort()])
        .filter(([, alleles]) => alleles.length)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const value = genotype.length ? digest('profile', [profile.id, profile.year ?? null, genotype]) : null;
      fingerprints.set(cacheKey, value);
      return value;
    };
    for (const group of groups) {
      const reference = fingerprint(group.reference, 'reference');
      const matches = group.exportMatches || group.matches;
      if (!Array.isArray(matches)) { complete = false; continue; }
      const trackedMatches = new WeakSet();
      const track = match => {
        if (!match || typeof match !== 'object') { complete = false; return; }
        if (trackedMatches.has(match)) return;
        trackedMatches.add(match);
        const matched = fingerprint(match, 'candidate');
        if (!reference || !matched) { complete = false; return; }
        const pair = [reference, matched];
        if (stage === 'internal') pair.sort();
        const key = digest(stage, pair);
        if (!keys.has(key)) keys.set(key, []);
        if (includeMatches) keys.get(key).push(match);
      };
      matches.forEach(track);
      if (includeMatches && matches !== group.matches && Array.isArray(group.matches)) group.matches.forEach(track);
    }
  }
  return { keys, complete };
}

const earlierRuns = `workspace_id=$1 AND owner_id=$2 AND organization_id=$3 AND algorithm_version=$4
  AND state='complete' AND encrypted_result IS NOT NULL
  AND (completed_at,id)<($5::timestamptz,$6::uuid)`;

async function annotateDuplicateHistory(client, pairs, { scope, completedAt, runId }) {
  if (!pairs.keys.size) return;
  const params = [...scope, completedAt, runId];
  const { rows: [coverage] } = await client.query(`SELECT min(completed_at) AS gap_at
    FROM public.workspace_search_runs WHERE ${earlierRuns} AND duplicate_history_complete IS DISTINCT FROM true`, params);
  const gap = coverage.gap_at?.getTime();
  const keys = [...pairs.keys.keys()];
  for (let i = 0; i < keys.length; i += LOOKUP_BATCH_SIZE) {
    const batch = keys.slice(i, i + LOOKUP_BATCH_SIZE);
    const { rows } = await client.query(`WITH candidates AS MATERIALIZED (
      SELECT completed_at, duplicate_pair_keys FROM public.workspace_search_runs
      WHERE ${earlierRuns} AND duplicate_pair_keys && $7::text[]
    )
    SELECT observed.pair_key, min(candidates.completed_at) AS first_at
    FROM candidates CROSS JOIN LATERAL unnest(candidates.duplicate_pair_keys) observed(pair_key)
    JOIN unnest($7::text[]) wanted(pair_key) ON wanted.pair_key=observed.pair_key
    GROUP BY observed.pair_key`, [...params, batch]);
    const detections = new Map(rows.map(row => [row.pair_key, row.first_at]));
    for (const key of batch) {
      const first = detections.get(key);
      const history = first ? { status: 'known', firstFoundAt: gap == null || gap >= first.getTime() ? first.toISOString() : null }
        : gap == null ? { status: 'new', firstFoundAt: new Date(completedAt).toISOString() }
          : { status: 'unknown', firstFoundAt: null };
      for (const match of pairs.keys.get(key)) match.duplicateHistory = history;
    }
  }
}

// The original encrypted result stays untouched. Index one saved search at a time.
async function indexSavedDuplicateHistory(client, algorithmVersion, { canContinue = () => true } = {}) {
  let indexed = 0, incomplete = 0;
  while (canContinue()) {
    const { rows: [run] } = await client.query(`SELECT id,
        CASE WHEN octet_length(encrypted_result)<=$2 THEN encrypted_result END AS payload
      FROM public.workspace_search_runs
      WHERE state='complete' AND encrypted_result IS NOT NULL AND algorithm_version=$1 AND duplicate_pair_keys IS NULL
      ORDER BY completed_at,id LIMIT 1`, [algorithmVersion, MAX_ARCHIVE_BYTES]);
    if (!run) return { indexed, incomplete, paused: false };
    let history = { keys: new Map(), complete: false };
    if (run.payload) {
      try { history = collectDuplicatePairs(unseal(run.payload), { includeMatches: false }); }
      catch { /* Incomplete older history must never produce a false «new». */ }
    }
    const { rowCount } = await client.query(`UPDATE public.workspace_search_runs
      SET duplicate_pair_keys=$1,duplicate_history_complete=$2
      WHERE id=$3 AND state='complete' AND encrypted_result IS NOT NULL AND duplicate_pair_keys IS NULL`,
    [[...history.keys.keys()], history.complete, run.id]);
    indexed += rowCount;
    if (!history.complete) incomplete += rowCount;
  }
  return { indexed, incomplete, paused: true };
}

module.exports = { collectDuplicatePairs, annotateDuplicateHistory, indexSavedDuplicateHistory };
