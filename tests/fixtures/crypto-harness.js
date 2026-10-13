const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function loadCryptoServices() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-crypto-fixture-'));
  const key = Buffer.alloc(32, 17); // Синтетический ключ; не используется приложением.
  const keyPath = path.join(directory, 'encryption.key');
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  const oldKeyPath = process.env.ENCRYPTION_KEY_PATH, oldMode = process.env.NODE_ENV;
  process.env.ENCRYPTION_KEY_PATH = keyPath;
  process.env.NODE_ENV = 'production';
  const saved = new Map();
  const intervals = [], originalInterval = global.setInterval;
  const silent = new Proxy({}, { get: () => () => {} });
  const replacements = {
    '../../src/config/database': { query: async () => ({ rows: [] }), transaction: async fn => fn({ query: async () => ({ rows: [] }) }) },
    '../../src/utils/logger': { logger: silent }
  };
  try {
    for (const [name, exports] of Object.entries(replacements)) {
      const id = require.resolve(name); saved.set(id, require.cache[id]);
      const module = new Module(id); module.filename = id; module.loaded = true; module.exports = exports;
      require.cache[id] = module;
    }
    global.setInterval = (...args) => { const timer = originalInterval(...args).unref(); intervals.push(timer); return timer; };
    return {
      key,
      security: require('../../src/config/security').securityConfig,
      database: require('../../src/services/security/databaseEncryptionService'),
      encryption: require('../../src/services/security/encryptionService'),
      close() { intervals.forEach(clearInterval); fs.rmSync(directory, { recursive: true, force: true }); }
    };
  } finally {
    global.setInterval = originalInterval;
    for (const [id, old] of saved) { if (old) require.cache[id] = old; else delete require.cache[id]; }
    if (oldKeyPath === undefined) delete process.env.ENCRYPTION_KEY_PATH; else process.env.ENCRYPTION_KEY_PATH = oldKeyPath;
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
  }
}
module.exports = { loadCryptoServices };
