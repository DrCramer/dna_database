const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadCryptoServices } = require('./fixtures/crypto-harness');
const { fixtures } = require('./fixtures/encryption-baseline.json');
const services = loadCryptoServices();
test.after(() => services.close());

test('Шифрование: чтение значений обоих прежних форматов CBC и JSON GCM', () => {
  for (const fixture of fixtures) {
    assert.equal(services.security.decryptData(fixture.legacy), fixture.plaintext);
    assert.equal(services.database.decryptData(fixture.cbc), fixture.plaintext);
    assert.equal(services.database.decryptData(fixture.gcm), fixture.plaintext);
  }
});

test('Шифрование: новые записи читаются независимым AES-декодером старого формата', () => {
  for (const plaintext of ['12,12; ?; SRY', 'русский текст π🙂'.repeat(19)]) {
    const [iv, ciphertext] = services.security.encryptData(plaintext).split(':');
    assert.equal(iv.length, 32);
    const decoder = crypto.createDecipheriv('aes-256-cbc', services.key, Buffer.from(iv, 'hex'));
    assert.equal(Buffer.concat([decoder.update(Buffer.from(ciphertext, 'hex')), decoder.final()]).toString('utf8'), plaintext);
    for (const algorithm of ['aes-256-cbc', 'aes-256-gcm']) {
      const packet = JSON.parse(services.database.encryptData(plaintext, algorithm));
      assert.deepEqual(Object.keys(packet), ['algorithm', 'iv', 'data', 'authTag', 'version', 'timestamp']);
      assert.equal(packet.version, 1); assert.equal(packet.algorithm, algorithm);
      const native = crypto.createDecipheriv(algorithm, services.key, Buffer.from(packet.iv, 'base64'));
      if (algorithm.endsWith('gcm')) native.setAuthTag(Buffer.from(packet.authTag, 'base64'));
      else assert.equal(packet.authTag, null);
      assert.equal(Buffer.concat([native.update(Buffer.from(packet.data, 'base64')), native.final()]).toString('utf8'), plaintext);
    }
  }
});

test('Шифрование: свежий IV, пустые значения, неподдерживаемый алгоритм и подмена GCM', () => {
  assert.notEqual(services.security.encryptData('same'), services.security.encryptData('same'));
  for (const empty of ['', '  ', null, undefined]) {
    assert.equal(services.security.encryptData(empty), null);
    assert.equal(services.database.encryptData(empty), null);
  }
  assert.throws(() => services.database.encryptData('data', 'unsupported'), /Database encryption failed/);
  const packet = JSON.parse(services.database.encryptData('tamper-fixture', 'aes-256-gcm'));
  const bytes = Buffer.from(packet.data, 'base64'); bytes[0] ^= 1; packet.data = bytes.toString('base64');
  assert.throws(() => services.database.decryptData(JSON.stringify(packet)), /Database decryption failed/);
  assert.throws(() => services.security.decryptData('broken'), /Data decryption failed/);
  assert.throws(() => services.database.decryptData('{'), /Database decryption failed/);
});

test('Шифрование: пользовательский адаптер сохраняет поля и Unicode после round-trip', () => {
  const user = { id: 'synthetic-user', email: 'fixture@example.invalid', personal_info: { name: 'Тест 🙂' } };
  const original = process.env.ENCRYPT_USER_EMAIL;
  try {
    for (const mode of ['true', 'false']) {
      process.env.ENCRYPT_USER_EMAIL = mode;
      const encrypted = services.encryption.encryptUserData(user);
      assert.equal(encrypted.email, mode === 'true' ? undefined : user.email);
      assert.equal(encrypted.personal_info, undefined);
      assert.equal(user.email, 'fixture@example.invalid');
      assert.deepEqual(services.encryption.decryptUserData(encrypted), user);
    }
  } finally {
    if (original === undefined) delete process.env.ENCRYPT_USER_EMAIL; else process.env.ENCRYPT_USER_EMAIL = original;
  }
});
