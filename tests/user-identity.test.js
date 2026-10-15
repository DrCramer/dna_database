const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUserIdentity } = require('../src/utils/userIdentity');
const { getUserDisplayName } = require('../src/utils/userDisplayName');

test('Имя отделено от логина, пустая почта нормализуется, пропущенные поля сохраняются', () => {
  assert.deepEqual(normalizeUserIdentity({ display_name: ' Иванов И.И. ', email: '  ', username: 'expert' }), {
    display_name: 'Иванов И.И.', email: null, username: 'expert'
  });
  assert.deepEqual(normalizeUserIdentity({ email: null }), { email: null });
  assert.deepEqual(normalizeUserIdentity({ username: 'expert' }), { username: 'expert' });
  assert.equal(getUserDisplayName({ display_name: ' Иванов И.И. ', username: 'expert' }), 'Иванов И.И.');
  assert.equal(getUserDisplayName({ display_name: null, username: 'expert' }), 'expert');
});

test('Неверная непустая почта, управляющие символы и слишком длинное имя отклоняются', () => {
  for (const data of [{ email: 'invalid' }, { display_name: 'А'.repeat(151) }, { display_name: 'Иванов\u0000' }]) {
    assert.throws(() => normalizeUserIdentity(data), error => error.status === 400 && error.code === 'INVALID_USER_IDENTITY');
  }
});
