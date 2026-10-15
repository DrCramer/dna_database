const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const databaseUrl = process.env.USER_IDENTITY_TEST_DATABASE_URL;

test('Пользователи: миграция старой БД, Фамилия И.О. и необязательная почта через API', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /^\/dna_user_identity_test(?:_|$)/);
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-user-identity-secret-not-used-in-production';
  const { query, pool } = require('../src/config/database');
  const User = require('../src/models/User');
  const password = 'IdentityFixture!123';
  const passwordHash = await require('bcryptjs').hash(password, 4);
  const organization = (await query("INSERT INTO organizations (name) VALUES ('Identity fixture') RETURNING id")).rows[0].id;
  const department = (await query("INSERT INTO departments (name, organization_id) VALUES ('Генетические экспертизы', $1) RETURNING id", [organization])).rows[0].id;
  // Имитируем прежнюю схему с обязательной почтой и существующим пользователем.
  await query('ALTER TABLE users DROP COLUMN display_name; ALTER TABLE users ALTER COLUMN email SET NOT NULL');
  const admin = (await query(`INSERT INTO users (username,email,password_hash,role,organization_id,department_id)
    VALUES ('identity_admin','admin@example.com',$1,'admin',$2,$3) RETURNING id`, [passwordHash, organization, department])).rows[0];
  await query('INSERT INTO user_departments (user_id,department_id,is_primary) VALUES ($1,$2,true)', [admin.id, department]);
  const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/033_user_display_names.sql'), 'utf8');
  await t.test('Миграция повторяема и сохраняет существующие учётные данные', async () => {
    await query(migration); await query(migration);
    const stored = (await query('SELECT username,email,display_name,password_hash FROM users WHERE id=$1', [admin.id])).rows[0];
    assert.deepEqual(stored, { username: 'identity_admin', email: 'admin@example.com', display_name: null, password_hash: passwordHash });
  });
  const originalInterval = global.setInterval;
  global.setInterval = (...args) => originalInterval(...args).unref();
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth'));
  app.use('/api/users', require('../src/routes/users'));
  global.setInterval = originalInterval;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  async function request(route, method = 'GET', body, token) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const login = await request('/auth/login', 'POST', { username: 'identity_admin', password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const token = login.body.data.accessToken;
  const payload = { username: 'identity_expert', display_name: ' Иванов И.И. ', password, role: 'user_analyst', organization_id: organization, department_ids: [department] };
  let expert;
  await t.test('Два пользователя создаются без почты, имя возвращается при входе и в /me', async () => {
    const created = await request('/auth/register-with-department', 'POST', payload, token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    expert = created.body.data.user;
    assert.equal(expert.email, null); assert.equal(expert.display_name, 'Иванов И.И.');
    const second = await request('/auth/register-with-department', 'POST', { ...payload, username: 'identity_second', email: '' }, token);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.data.user.email, null);
    const auth = await request('/auth/login', 'POST', { username: payload.username, password });
    assert.equal(auth.status, 200); assert.equal(auth.body.data.user.display_name, 'Иванов И.И.');
    const me = await request('/auth/me', 'GET', undefined, auth.body.data.accessToken);
    assert.equal(me.status, 200); assert.equal(me.body.data.user.display_name, 'Иванов И.И.');
    const denied = await request(`/users/${expert.id}`, 'PUT', { display_name: 'Другое имя' }, auth.body.data.accessToken);
    assert.equal(denied.status, 403);
  });
  await t.test('Редактирование имени и очистка почты сохраняются, поиск учитывает имя', async () => {
    const edited = await request(`/users/${expert.id}`, 'PUT', { display_name: 'Петров П.П.', email: 'expert@example.com' }, token);
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.data.user.display_name, 'Петров П.П.');
    const clear = await request(`/users/${expert.id}`, 'PUT', { email: '' }, token);
    assert.equal(clear.status, 200, JSON.stringify(clear.body));
    const stored = await User.findById(expert.id);
    assert.equal(stored.email, null); assert.equal(stored.display_name, 'Петров П.П.');
    const found = await request('/users?search=' + encodeURIComponent('Петров'), 'GET', undefined, token);
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.deepEqual(found.body.data.users.map(user => user.id), [expert.id]);
  });
  await t.test('Неверная почта отклоняется; уникальность указанной почты сохраняется', async () => {
    assert.equal((await request('/auth/register-with-department', 'POST', { ...payload, username: 'identity_bad', email: 'bad' }, token)).status, 400);
    assert.equal((await request(`/users/${expert.id}`, 'PUT', { email: 'bad' }, token)).status, 400);
    assert.equal((await request('/auth/register-with-department', 'POST', { ...payload, username: 'identity_duplicate', email: 'admin@example.com' }, token)).status, 409);
  });
  await t.test('Обычная регистрация API также допускает отсутствие почты', async () => {
    const response = await request('/auth/register', 'POST', { username: 'identity_viewer', display_name: 'Сидоров С.С.', password, confirmPassword: password, role: 'viewer' }, token);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.user.email, null);
    assert.equal(response.body.data.user.display_name, 'Сидоров С.С.');
  });
  await t.test('Имя текущего пользователя обновляется без смены логина и пароля', async () => {
    const response = await request(`/users/${admin.id}`, 'PUT', { display_name: 'Администраторов А.А.' }, token);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const me = await request('/auth/me', 'GET', undefined, token);
    assert.equal(me.body.data.user.display_name, 'Администраторов А.А.');
    assert.equal(me.body.data.user.username, 'identity_admin');
  });
});
