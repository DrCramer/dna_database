const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const databaseUrl = process.env.PROFILE_ACCESS_TEST_DATABASE_URL;
test('Legacy API: единый доступ к профилям в active department', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /^\/dna_profile_access_test(?:_|$)/);
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-profile-access-secret-not-used-in-production';
  const { query, pool } = require('../src/config/database');
  const { logger } = require('../src/utils/logger');
  const User = require('../src/models/User');
  const DNAProfile = require('../src/models/DNAProfile');
  const PermissionService = require('../src/services/permissionService');
  const { ProfileAccessService } = require('../src/services/profileAccessService');
  const originalInterval = global.setInterval;
  global.setInterval = (...args) => originalInterval(...args).unref();
  const express = require('express');
  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  app.use(require('../src/middleware/requestContext').requestContext);
  app.use('/api/profiles', require('../src/routes/profiles'));
  app.use('/api/users', require('../src/routes/users'));
  app.use('/api/auth', require('../src/routes/auth'));
  global.setInterval = originalInterval;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  });
  const fixture = randomUUID().slice(0, 8);
  const organization = (await query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`Access fixture ${fixture}`])).rows[0].id;
  const otherOrganization = (await query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`Foreign fixture ${fixture}`])).rows[0].id;
  async function department(name, org = organization) {
    return (await query('INSERT INTO departments (name, organization_id) VALUES ($1, $2) RETURNING id', [name, org])).rows[0].id;
  }
  const emergency = await department('ЧС');
  const genetic = await department('Генетические экспертизы');
  const forbidden = await department('Недоступное отделение');
  const foreign = await department('Чужая организация', otherOrganization);
  const password = 'AccessFixture!123';
  const passwordHash = await require('bcryptjs').hash(password, 4);
  async function user(role, primary, allowed = [primary]) {
    const username = `access_${role}_${randomUUID().slice(0, 8)}`;
    const id = (await query(`INSERT INTO users (username, email, password_hash, role, organization_id, department_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [username, `${username}@example.invalid`, passwordHash, role, organization, primary])).rows[0].id;
    for (const dept of allowed) await query('INSERT INTO user_departments (user_id, department_id, is_primary) VALUES ($1, $2, $3)', [id, dept, dept === primary]);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(login.status, 200);
    return { id, ...(await login.json()).data };
  }
  const multi = await user('user_analyst', emergency, [emergency, genetic]);
  const primary = await user('user_analyst', genetic);
  const admin = await user('admin', emergency, [emergency, genetic]);
  const head = await user('department_head', emergency, [emergency, genetic]);
  const system = await user('system_administrator', emergency, [emergency, genetic]);
  const viewer = await user('viewer', emergency, [emergency, genetic]);
  const legacy = await user('analyst', emergency, [emergency, genetic]);
  const strData = { TH01: ['7', '9'], D5S818: ['11', '12'], SRY: ['Y'] };
  async function profile(owner, dept, name, options = {}) {
    return DNAProfile.create({
      userId: owner.id, departmentId: dept, organizationId: options.organizationId || organization,
      importFormat: dept === genetic ? 'genetic' : 'emergency', year: dept === genetic ? null : 2024,
      sampleName: name, internalNumber: `${name}-1`, strData, ...options
    });
  }
  const ownGenetic = await profile(multi, genetic, '256');
  const ownEmergency = await profile(multi, emergency, '256');
  const colleague = await profile(primary, genetic, '256');
  const foreignProfile = await profile(multi, foreign, '256', { organizationId: otherOrganization, year: 2025 });
  const viewerProfile = await profile(viewer, genetic, '256');
  const legacyProfile = await profile(legacy, genetic, '256');
  const masterArray = (await query('INSERT INTO master_arrays (name, department_id) VALUES ($1, $2) RETURNING id', [`Master ${fixture}`, genetic])).rows[0].id;
  const masterProfile = await profile(primary, genetic, '256-master', { profileType: 'master', masterArrayId: masterArray });
  const inactive = await profile(multi, genetic, '256-inactive');
  await query('UPDATE dna_profiles SET is_active = false WHERE id = $1', [inactive.id]);
  async function request(path, session = multi, dept = genetic, method = 'GET', body) {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Active-Department-Id': dept, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json(), requestId: response.headers.get('x-request-id') };
  }
  async function assertSearchOpens(session, dept, expectedIds) {
    const search = await request('/profiles/search?q=256', session, dept);
    assert.equal(search.status, 200, JSON.stringify(search.body));
    assert.deepEqual(search.body.profiles.map(p => p.id).sort(), expectedIds.sort());
    for (const result of search.body.profiles) {
      const opened = await request(`/profiles/${result.id}`, session, dept);
      assert.equal(opened.status, 200, JSON.stringify(opened.body));
      assert.equal(opened.body.id, result.id);
      assert.equal(opened.body.departmentId, dept);
      assert.deepEqual(opened.body.strData, strData);
    }
  }

  await t.test('primary == active: поиск и GET 200, свои записи и мастер-массив', async () => {
    await assertSearchOpens(primary, genetic, [colleague.id, masterProfile.id]);
  });
  await t.test('primary != active: профиль загрузки в Генетические экспертизы открывается', async () => {
    await assertSearchOpens(multi, genetic, [ownGenetic.id, masterProfile.id]);
    const context = await request('/users/context');
    assert.equal(context.status, 200);
    assert.equal(context.body.data.user.active_department_id, genetic);
    assert.equal(context.body.data.department.id, genetic);
    const opened = await request(`/profiles/${ownGenetic.id}`);
    assert.equal(opened.body.sampleName, '256');
    assert.equal(opened.body.internalNumber, '256-1');
  });
  await t.test('профиль ЧС исключён из поиска и UUID запрещён в Генетических экспертизах', async () => {
    assert.equal((await request(`/profiles/${ownEmergency.id}`)).status, 403);
    await assertSearchOpens(multi, emergency, [ownEmergency.id]);
    assert.equal((await request(`/profiles/${ownGenetic.id}`, multi, emergency)).status, 403);
  });
  await t.test('чужой владелец того же отделения доступен только руководителю/администратору', async () => {
    assert.equal((await request(`/profiles/${colleague.id}`)).status, 403);
    const expected = [ownGenetic.id, colleague.id, viewerProfile.id, legacyProfile.id, masterProfile.id];
    for (const session of [admin, head, system]) await assertSearchOpens(session, genetic, [...expected]);
    assert.equal((await request(`/profiles/${ownEmergency.id}`, admin)).status, 403);
  });
  await t.test('viewer и legacy analyst сохраняют scope чтения', async () => {
    await assertSearchOpens(viewer, genetic, [viewerProfile.id, masterProfile.id]);
    await assertSearchOpens(legacy, genetic, [legacyProfile.id, masterProfile.id]);
  });
  await t.test('UUID недоступного отделения/организации отвергается всеми legacy endpoints', async () => {
    for (const dept of [forbidden, foreign, randomUUID(), 'not-a-uuid']) {
      for (const path of ['/profiles/search?q=256', `/profiles/${ownGenetic.id}`, '/profiles/accessible', '/users/context']) {
        const denied = await request(path, multi, dept);
        assert.equal(denied.status, 403);
        assert.equal(denied.body.requestId, denied.requestId);
      }
    }
    assert.equal((await request(`/profiles/${foreignProfile.id}`)).status, 403);
  });
  await t.test('даже ошибочная связь с отделением чужой организации не расширяет права', async () => {
    await query('INSERT INTO user_departments (user_id, department_id) VALUES ($1, $2)', [multi.id, foreign]);
    try {
      assert.equal((await request('/profiles/search?q=256', multi, foreign)).status, 403);
      assert.equal(await PermissionService.validateDataAccess(multi.id, 'department', foreign), false);
    } finally { await query('DELETE FROM user_departments WHERE user_id = $1 AND department_id = $2', [multi.id, foreign]); }
  });
  await t.test('/accessible использует тот же scope, тип и корректную пагинацию', async () => {
    for (const session of [multi, admin, head, viewer]) {
      const search = await request('/profiles/search?q=256', session);
      const accessible = await request('/profiles/accessible?limit=100', session);
      assert.equal(accessible.status, 200);
      assert.deepEqual(accessible.body.profiles.map(p => p.id).sort(), search.body.profiles.map(p => p.id).sort());
      assert.equal(accessible.body.pagination.total, search.body.total);
      assert(accessible.body.profiles.every(p => p.departmentId === genetic));
    }
    const page = await request('/profiles/accessible?profile_type=master&limit=1');
    assert.deepEqual(page.body.profiles.map(p => p.id), [masterProfile.id]);
    assert.equal(page.body.pagination.total, 1);
    assert.equal((await request('/profiles/accessible?limit=1&offset=1')).body.profiles.length, 1);
  });
  await t.test('отсутствующий профиль и деактивированные записи не попадают в выдачу', async () => {
    assert.equal((await request(`/profiles/${randomUUID()}`)).status, 404);
    assert.equal((await request(`/profiles/${inactive.id}`)).status, 404);
  });
  await t.test('без header сохраняется primary; refresh сохраняет доступ к другому active', async () => {
    const original = await fetch(`${base}/api/profiles/search?q=256`, { headers: { Authorization: `Bearer ${multi.accessToken}` } });
    assert.equal(original.status, 200);
    assert.deepEqual((await original.json()).profiles.map(p => p.id), [ownEmergency.id]);
    const refresh = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: multi.refreshToken }) });
    assert.equal(refresh.status, 200);
    const refreshed = { ...multi, ...(await refresh.json()).data };
    await assertSearchOpens(refreshed, genetic, [ownGenetic.id, masterProfile.id]);
    Object.assign(multi, refreshed);
  });
  await t.test('запись и комментарии не переносят ownership и не обходят active department', async () => {
    for (const path of [`/profiles/${ownEmergency.id}`, `/profiles/${ownEmergency.id}/comment`, `/profiles/${ownEmergency.id}/toggle-active`]) {
      assert.equal((await request(path, admin, genetic, 'PUT', { sampleName: '256', notes: 'fixture', comment: 'fixture' })).status, 403);
    }
    assert.equal((await request(`/profiles/${ownEmergency.id}`, admin, genetic, 'DELETE')).status, 403);
    assert.equal((await request(`/profiles/${ownEmergency.id}/comment`, admin)).status, 403);
    assert.equal((await request(`/profiles/${colleague.id}`, multi, genetic, 'PUT', { notes: 'fixture' })).status, 403);
    const updated = await request(`/profiles/${ownGenetic.id}`, multi, genetic, 'PUT', { notes: 'fixture', departmentId: emergency });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.departmentId, genetic);
    assert.equal(updated.body.data.sampleName, '256');
    assert.deepEqual(updated.body.data.strData, strData);
  });
  await t.test('create/batch/bulk не создают профили без явного отделения и организации', async () => {
    const data = { userId: multi.id, year: 2024, sampleName: '256-no-scope', strData };
    await assert.rejects(DNAProfile.create(data), /активное отделение/);
    await assert.rejects(DNAProfile.batchInsert([data], multi.id, 'fixture'), /активное отделение/);
    const invalidBulk = await DNAProfile.bulkCreate([data], multi.id, 'fixture');
    assert.equal(invalidBulk.created.length, 0);
    assert.match(invalidBulk.errors[0].error, /активное отделение/);
    const count = (await query('SELECT COUNT(*) FROM dna_profiles')).rows[0].count;
    const created = await DNAProfile.bulkCreate([{ ...data, strData: { ...strData, TH01: ['8', '10'] }, departmentId: emergency, organizationId: organization }], multi.id, 'fixture');
    assert.equal(created.created.length, 1, JSON.stringify(created.errors));
    assert.equal(created.created[0].departmentId, emergency);
    assert.equal(Number((await query('SELECT COUNT(*) FROM dna_profiles')).rows[0].count), Number(count) + 1);
    const info = await ownGenetic.getDepartmentInfo();
    assert.equal(info.department_id, genetic);
  });
  await t.test('DB error в проверке UUID: 500 с requestId и реальной причиной, без генотипа', async t => {
    const originalQuery = pool.query.bind(pool);
    const logs = [];
    t.mock.method(logger, 'error', (event, metadata) => logs.push({ event, metadata }));
    t.mock.method(pool, 'query', (...args) => {
      if (String(args[0]).startsWith('SELECT 1 FROM dna_profiles dp')) {
        return Promise.reject(Object.assign(new Error('simulated permission database failure'), { code: '42P01' }));
      }
      return originalQuery(...args);
    });
    const failed = await request(`/profiles/${ownGenetic.id}`);
    assert.equal(failed.status, 500);
    assert.equal(failed.body.code, 'PROFILE_ACCESS_CHECK_ERROR');
    assert.equal(failed.body.requestId, failed.requestId);
    assert.match(failed.requestId, /^[\da-f-]{36}$/);
    assert(logs.some(log => log.event === 'PROFILE_ACCESS_CHECK_ERROR' && log.metadata.error === 'simulated permission database failure' && log.metadata.requestId === failed.requestId));
    assert(!JSON.stringify(logs).includes('TH01'));
    await assert.rejects(PermissionService.validateDataAccess(multi.id, 'dna_profile', ownGenetic.id, genetic), /simulated permission database failure/);
  });
  await t.test('сбой permission scope у search/accessible: 500, не 403', async t => {
    t.mock.method(ProfileAccessService, 'getScope', async () => { throw Object.assign(new Error('permission scope DB failure'), { code: '08006' }); });
    for (const path of ['/profiles/search?q=256', '/profiles/accessible']) {
      const failed = await request(path);
      assert.equal(failed.status, 500);
      assert.equal(failed.body.requestId, failed.requestId);
    }
  });
  await t.test('сбой БД получения accessible departments в authenticate: 500', async t => {
    t.mock.method(User.prototype, 'getAccessibleDepartments', async () => { throw new Error('department permission DB failure'); });
    const failed = await request(`/profiles/${ownGenetic.id}`);
    assert.equal(failed.status, 500);
    assert.equal(failed.body.requestId, failed.requestId);
  });
  await t.test('отказ логируется с пользователем, UUID, active department и requestId', async t => {
    const logs = [];
    t.mock.method(logger, 'warn', (event, metadata) => logs.push({ event, metadata }));
    const denied = await request(`/profiles/${ownEmergency.id}`);
    assert.equal(denied.status, 403);
    assert(logs.some(log => log.event === 'PROFILE_ACCESS_DENIED' && log.metadata.userId === multi.id && log.metadata.profileId === ownEmergency.id && log.metadata.activeDepartmentId === genetic && log.metadata.requestId === denied.requestId));
  });
});
