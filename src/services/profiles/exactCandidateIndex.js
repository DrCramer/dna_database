// An index for the standard EXACT comparison only. It is built from the scoped
// snapshot inside one search/worker and is never shared between users or runs.
function signature(data) {
  if (!data || data.exactComparable === false || !data.parts.length) return null;
  return data.partsSet.size === 1 ? JSON.stringify(['single', data.parts[0]]) : JSON.stringify(['multi', data.exactSignature]);
}

function createExactCandidateIndex(profiles, minMatches) {
  // Zero/negative thresholds admit pairs without any common locus.
  if (!Number.isFinite(minMatches) || minMatches <= 0 || profiles.length < 32) return null;
  const loci = new Map();
  for (let index = 0; index < profiles.length; index++) {
    for (const [locus, data] of Object.entries(profiles[index].processedLoci)) {
      const key = signature(data);
      if (key === null) continue;
      if (!loci.has(locus)) loci.set(locus, new Map());
      const entries = loci.get(locus);
      if (!entries.has(key)) entries.set(key, []);
      entries.get(key).push(index);
    }
  }
  const counts = new Uint32Array(profiles.length);
  return reference => {
    const postings = [];
    let visits = 0;
    for (const [locus, data] of Object.entries(reference.processedLoci)) {
      const key = signature(data);
      const list = key === null ? undefined : loci.get(locus)?.get(key);
      if (list) { postings.push(list); visits += list.length; }
    }
    if (postings.length < minMatches) return [];
    // Dense arrays (almost everybody matches) benefit from the direct loop.
    if (visits > profiles.length * Math.max(2, postings.length / 2)) return null;
    const touched = [];
    for (const list of postings) for (const index of list) {
      if (counts[index]++ === 0) touched.push(index);
    }
    const candidates = touched.filter(index => counts[index] >= minMatches);
    for (const index of touched) counts[index] = 0;
    // Keep the original snapshot order, including equal-score ties and top-100.
    return candidates.sort((a, b) => a - b).map(index => profiles[index]);
  };
}

function createSelfExclusionCounter(profiles, mode) {
  const keys = mode === 'task' ? ['id'] : mode === 'master_array' ? ['sample_name','internal_number','year'] : [];
  if (!keys.length) return () => 0;
  const root = new Map();
  for (const profile of profiles) {
    if (keys.some(key => Number.isNaN(profile[key]))) continue; // NaN !== NaN.
    let node = root;
    for (const [index, key] of keys.entries()) {
      const value = profile[key];
      if (index === keys.length - 1) node.set(value, (node.get(value) || 0) + 1);
      else {
        if (!node.has(value)) node.set(value, new Map());
        node = node.get(value);
      }
    }
  }
  return profile => {
    let node = root;
    for (const key of keys) {
      if (Number.isNaN(profile[key])) return 0;
      node = node.get(profile[key]);
      if (node === undefined) return 0;
    }
    return node;
  };
}

module.exports = { createExactCandidateIndex, createSelfExclusionCounter };
