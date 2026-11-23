const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MaintenanceGate } = require('../src/services/infrastructure/databaseMaintenanceGate');

function fixture() {
  const gate = new MaintenanceGate(), pool = new EventEmitter();
  const queries = [];
  const client = { query(sql, callback) {
    queries.push(sql);
    const result = Promise.resolve({ rows: [{ ok: true }] });
    if (callback) { result.then(value => callback(null, value)); return; }
    return result;
  } };
  gate.attach(pool); pool.emit('connect', client);
  return { gate, client, queries };
}

test('Maintenance gate: promises, callbacks, rollback and privileged maintenance', async () => {
  const { gate, client, queries } = fixture();
  await client.query('SELECT 1');
  await new Promise((resolve, reject) => client.query('SELECT 2', error => error ? reject(error) : resolve()));
  assert.equal(gate.queries, 0);
  gate.close();
  await assert.rejects(client.query('INSERT'), { code: 'DATABASE_MAINTENANCE' });
  await new Promise(resolve => client.query('INSERT callback', error => { assert.equal(error.status, 503); resolve(); }));
  await client.query('ROLLBACK');
  await gate.allow(() => client.query('MAINTENANCE'));
  assert.deepEqual(queries, ['SELECT 1', 'SELECT 2', 'ROLLBACK', 'MAINTENANCE']);
  await gate.drain(50);
  gate.open(); await client.query('SELECT 3');
});

test('Disconnected or late HTTP handlers cannot restore old genotypes after cleanup', async () => {
  const { gate, client } = fixture();
  let late;
  const response = new EventEmitter();
  gate.middleware({ path: '/profiles/upload' }, response, () => {
    late = () => client.query('INSERT stale genotype');
    // Capture asynchronous context like a parsing callback from an old upload.
    late = require('node:async_hooks').AsyncLocalStorage.bind(late);
  });
  assert.equal(gate.requests, 1);
  gate.close(); response.emit('close');
  await gate.drain(50); gate.open();
  await assert.rejects(late(), { code: 'DATABASE_MAINTENANCE' });
  await gate.normal(() => client.query('INSERT new upload'));
  assert.equal(gate.requests, 0);
});

test('Maintenance gate returns 503 to normal API requests and drains in-flight SQL', async () => {
  const { gate } = fixture();
  gate.close();
  let status, body;
  const res = { status(code) { status = code; return this; }, set() { return this; }, json(value) { body = value; } };
  gate.middleware({ path: '/workspace/profiles' }, res, () => assert.fail('Must not run'));
  assert.equal(status, 503); assert.equal(body.code, 'DATABASE_MAINTENANCE');
  gate.queries = 1;
  await assert.rejects(gate.drain(1), { status: 409 });
  gate.queries = 0; await gate.drain(50);
});
