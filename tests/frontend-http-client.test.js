const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const clientModule = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname,
  '../frontend/src/services/httpClient.js')).toString('base64')}`);
const storage = values => () => ({ getItem: key => values[key] || null });

test('HTTP client: актуальные токен и отделение, локальные пути без двойного /api', async () => {
  const { createHttpClient } = await clientModule;
  const session = { token: 'fixture-token', user: JSON.stringify({ active_department_id: 'genetic' }) };
  const calls = [];
  const api = createHttpClient({ storage: storage(session), fetchImpl: async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.deepEqual((await api.get('/profiles')).data, { success: true });
  assert.equal(calls[0][0], '/api/profiles');
  assert.equal(calls[0][1].headers.get('Authorization'), 'Bearer fixture-token');
  assert.equal(calls[0][1].headers.get('X-Active-Department-Id'), 'genetic');
  session.user = JSON.stringify({ active_department_id: 'other' });
  await api.post('/api/export/excel', { ids: [1] });
  assert.equal(calls[1][0], '/api/export/excel');
  assert.equal(calls[1][1].headers.get('X-Active-Department-Id'), 'other');
  assert.equal(calls[1][1].body, '{"ids":[1]}');
  await assert.rejects(api.get('https://external.example/api'), /локальный путь/);
  await assert.rejects(api.get('//external.example/api'), /локальный путь/);
  assert.equal(calls.length, 2);
});

test('HTTP client: FormData boundary, отмена, XLSX и ответ без тела', async () => {
  const { createHttpClient } = await clientModule;
  const controller = new AbortController();
  let init;
  const api = createHttpClient({ storage: storage({}), fetchImpl: async (url, options) => {
    init = options;
    if (url.endsWith('/empty')) return new Response(null, { status: 204 });
    return new Response('xlsx-fixture', { headers: { 'Content-Disposition': 'attachment; filename=test.xlsx' } });
  } });
  const form = new FormData(); form.append('task_id', 'fixture-task');
  const result = await api.post('/profiles/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' }, signal: controller.signal, responseType: 'blob'
  });
  assert.equal(init.body, form);
  assert.equal(init.headers.has('Content-Type'), false);
  assert.equal(init.signal, controller.signal);
  assert.equal(await result.data.text(), 'xlsx-fixture');
  assert.equal(result.headers['content-disposition'], 'attachment; filename=test.xlsx');
  assert.equal((await api.delete('/empty')).data, null);
});

test('HTTP client: JSON ошибок и сетевые ошибки сохраняют контракт errorService', async () => {
  const { createHttpClient } = await clientModule;
  const api = createHttpClient({ storage: storage({ user: 'broken' }), fetchImpl: async () => new Response(
    JSON.stringify({ message: 'Нет доступа', code: 'FORBIDDEN' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  ) });
  await assert.rejects(api.get('/profiles'), error => error.message === 'Нет доступа'
    && error.response.status === 403 && error.response.data.code === 'FORBIDDEN');
  const network = createHttpClient({ storage: storage({}), fetchImpl: async () => { throw new TypeError('offline'); } });
  await assert.rejects(network.get('/profiles'), error => error.request.url === '/api/profiles' && !error.response);
});
