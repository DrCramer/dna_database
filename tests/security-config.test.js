const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const securityModule = path.resolve(__dirname, '../src/config/security.js');

function runSecurity(directory, keyPath, code = '') {
  return spawnSync(process.execPath, ['-e', `const { securityConfig: security } = require(${JSON.stringify(securityModule)}); ${code}; process.exit(0);`], {
    cwd: directory, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, NODE_ENV: 'production', ENCRYPTION_KEY: '', ENCRYPTION_KEY_PATH: keyPath }
  });
}

test('Production: отсутствующий ключ не заменяется временным', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-key-missing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, 'encryption.key');
  const result = runSecurity(directory, keyPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Persistent encryption key is missing/);
  assert.equal(fs.existsSync(keyPath), false);
});

test('Production: повреждённый ключ сохраняется без перезаписи', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-key-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, 'encryption.key');
  const original = Buffer.from('invalid key fixture');
  fs.writeFileSync(keyPath, original);
  const result = runSecurity(directory, keyPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly 32 bytes/);
  assert.deepEqual(fs.readFileSync(keyPath), original);
});

test('Production: сохранённый ключ расшифровывает данные после нового процесса', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-key-persistent-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, 'encryption.key');
  const original = Buffer.alloc(32, 17);
  fs.writeFileSync(keyPath, original);
  const encrypted = runSecurity(directory, keyPath, 'require("fs").writeFileSync("cipher.txt", security.encryptData("synthetic persistence fixture"));');
  assert.equal(encrypted.status, 0, encrypted.stderr);
  const decrypted = runSecurity(directory, keyPath, 'if(security.decryptData(require("fs").readFileSync("cipher.txt", "utf8")) !== "synthetic persistence fixture") process.exit(2);');
  assert.equal(decrypted.status, 0, decrypted.stderr);
  assert.deepEqual(fs.readFileSync(keyPath), original);
});
