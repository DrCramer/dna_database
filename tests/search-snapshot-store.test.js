const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearchSnapshot, getSearchSnapshots, profileFingerprint } = require("../src/services/profiles/searchSnapshotStore");

test('search snapshots are bound to their owner and active department and fingerprint source genotypes', () => {
  const reference = { id: 'ref-1', internal_number: '258-1', loci: { TH01: ['7', '9'] } };
  const matched = { id: 'match-1', internal_number: '258-2', loci: { TH01: ['9', '7'] } };
  const snapshot = createSearchSnapshot({
    userId: 'user-a',
    departmentId: 'department-a',
    searchMode: 'task',
    algorithm: 'duplicate_v5',
    settings: { ignoredLoci: ['D21S11'], minMatches: 12 },
    comparisons: [{ referenceProfile: reference, matchedProfile: matched, matchedLoci: ['TH01'], matchCount: 1 }]
  });

  assert.ok(snapshot?.id);
  assert.equal(snapshot.pairCount, 1);
  assert.equal(snapshot.profileCount, 2);
  assert.throws(() => getSearchSnapshots([snapshot.id], { userId: 'user-b', departmentId: 'department-a' }), { status: 403 });
  assert.throws(() => getSearchSnapshots([snapshot.id], { userId: 'user-a', departmentId: 'department-b' }), { status: 403 });
  assert.equal(getSearchSnapshots([snapshot.id], { userId: 'user-a', departmentId: 'department-a' })[0].settings.ignoredLoci[0], 'D21S11');
  assert.notEqual(profileFingerprint(matched), profileFingerprint({ ...matched, loci: { TH01: ['8', '9'] } }));
});

test('one temporary reference remains a single group across all matches in its search', () => {
  const reference = { sample_name: 'Эталон', internal_number: 'Ввод вручную', loci: { TH01: ['7', '9'] } };
  const snapshot = createSearchSnapshot({
    userId: 'user-c',
    departmentId: 'department-c',
    searchMode: 'single',
    comparisons: [
      { referenceProfile: reference, matchedProfile: { id: 'match-a', loci: { TH01: ['7', '9'] } } },
      { referenceProfile: reference, matchedProfile: { id: 'match-b', loci: { TH01: ['9', '7'] } } }
    ]
  });
  const stored = getSearchSnapshots([snapshot.id], { userId: 'user-c', departmentId: 'department-c' })[0];
  assert.equal(snapshot.profileCount, 3);
  assert.equal(snapshot.groups.length, 1);
  assert.equal(stored.pairs[0].referenceKey, stored.pairs[1].referenceKey);
});
