const test = require('node:test'), assert = require('node:assert/strict');
const { changedWorkingProfiles, profileChanges } = require('../src/utils/workspaceProfileChanges');

test('Смена настроек и состояния поиска у 5700 профилей не создаёт ни одного сохранения', () => {
  const original = Array.from({ length: 5700 }, (_, i) => ({ id: 'SYN-' + i, objectNumber: String(i), year: 2026, expertiseType: 'ug', fullName: '', registrationNumber: null, comment: '', strData: { TH01: ['7','9.3'], D21S11: ['30','*','?'] }, state: 'CHECKED', searchState: 'CHECKED' }));
  const rows = structuredClone(original).map(row => ({ ...row, state: 'STALE', searchState: 'STALE', searchRunId: 'new-run', approvalState: 'pending', provenance: { updated: true } }));
  assert.deepEqual(changedWorkingProfiles(rows, original), []);
  assert.equal(original[0].state, 'CHECKED');
});

test('Отправляются только изменённые поля; одиночные аллели, пары и спецзначения сохраняются как введены', () => {
  const original = { id: 'SYN', objectNumber: '001-G', registrationNumber: '001-G', year: 2026, expertiseType: 'staff', fullName: 'Тестовый А. А.', comment: 'before', strData: { TH01: ['7'], D21S11: ['30','*','?'] } };
  const row = { ...original, comment: 'after', state: 'STALE' };
  assert.deepEqual(changedWorkingProfiles([row], [original]), [{ id: 'SYN', patch: { comment: 'after' } }]);
  assert.deepEqual(profileChanges({ ...original, objectNumber: '', registrationNumber: null }, original), { objectNumber: '', registrationNumber: null });
  const data = { TH01: ['7','7'], D21S11: ['30','*','?'], SRY: ['SRY'] };
  assert.deepEqual(profileChanges({ ...original, strData: data }, original), { strData: data });
  assert.deepEqual(original.strData.TH01, ['7']);
  assert.deepEqual(profileChanges({ ...original, comment: undefined }, original), {});
});
