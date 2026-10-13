const Module = require('node:module');

function loadAccessModules() {
  const state = { users: new Map(), query: async () => ({ rows: [] }) };
  const silent = new Proxy({}, { get: () => () => {} });
  const replacements = {
    '../../src/config/database': { query: (...args) => state.query(...args) },
    '../../src/utils/logger': { logger: silent },
    '../../src/models/User': { findById: async id => state.users.get(id) },
    '../../src/services/security/authService': {},
    '../../src/services/audit/auditService': silent
  };
  const saved = new Map();
  try {
    for (const [name, exports] of Object.entries(replacements)) {
      const id = require.resolve(name); saved.set(id, require.cache[id]);
      const module = new Module(id); module.filename = id; module.loaded = true; module.exports = exports;
      require.cache[id] = module;
    }
    return {
      state,
      permissions: require('../../src/services/security/permissionService'),
      profiles: require('../../src/services/security/profileAccessService'),
      uploads: require('../../src/services/security/profileUploadPolicy'),
      auth: require('../../src/middleware/auth'),
      history: require('../../src/middleware/historyPermissions')
    };
  } finally {
    for (const [id, old] of saved) { if (old) require.cache[id] = old; else delete require.cache[id]; }
  }
}

async function runMiddleware(middleware, req) {
  let next = false;
  const result = { status: 200, body: null };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await middleware(req, res, () => { next = true; });
  return { ...result, next };
}
module.exports = { loadAccessModules, runMiddleware };
