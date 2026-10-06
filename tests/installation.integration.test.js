const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const databaseUrl = process.env.INSTALL_TEST_DATABASE_URL;
test('Новая схема: параметры анализа, мастер-массивы и проверка rollback', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /test/i, 'Используйте отдельную тестовую БД');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  const { query, transaction, pool } = require('../src/config/database');
  const { logger } = require('../src/utils/logger');
  const SystemParameters = require('../src/services/bayesian/SystemParameters');
  const persistence = require('../src/services/dataPersistenceService');
  t.after(() => pool.end());

  await t.test('Пустая canonical schema принимает два параллельных bootstrap параметров', async () => {
    const first = new SystemParameters(), second = new SystemParameters();
    await Promise.all([first.initializeDefaults(), second.initializeDefaults()]);
    const rows = (await query('SELECT parameter_name, parameter_type FROM system_parameters')).rows;
    assert.equal(rows.length, 6);
    assert(rows.every(row => ['probability', 'threshold', 'coefficient'].includes(row.parameter_type)));
    await first.setParameter('drop_out_probability', 0.02);
    await second.initializeDefaults();
    first.invalidateCache();
    assert.equal(await first.getParameter('drop_out_probability'), 0.02);
  });

  await t.test('Новое отделение сразу получает связанный мастер-массив', async () => {
    const org = (await query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`Install fixture ${randomUUID()}`])).rows[0].id;
    const dept = (await query("INSERT INTO departments (organization_id, name) VALUES ($1, 'Fixture department') RETURNING id", [org])).rows[0].id;
    const rows = (await query('SELECT ma.id FROM departments d JOIN master_arrays ma ON ma.id=d.master_array_id AND ma.department_id=d.id WHERE d.id=$1', [dept])).rows;
    assert.equal(rows.length, 1);
  });

  await t.test('Проверка rollback не пишет ложную ошибку; реальные ошибки не скрываются', async () => {
    const errors = [], original = logger.error;
    logger.error = (...args) => errors.push(args);
    try {
      assert.equal((await persistence.verifyTransactionIntegrity()).status, 'success');
      assert.equal(errors.length, 0);
      await assert.rejects(transaction(client => client.query('SELECT 1 / 0')));
      assert.equal(errors.length, 1);
    } finally { logger.error = original; }
  });
});
