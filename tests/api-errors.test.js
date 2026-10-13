const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { getErrorStatus, serializeApiError, normalizeApiErrorResponse } = require('../src/utils/apiErrors');

test('Ошибки API: совместимость строкового и объектного error, code и requestId', () => {
  const options = { requestId: 'synthetic-request', timestamp: '2026-01-01T00:00:00.000Z' };
  const auth = normalizeApiErrorResponse(403, { error: 'Forbidden', message: 'Нет доступа', code: 'PROFILE_ACCESS_DENIED' }, options);
  assert.equal(auth.error, 'Forbidden'); assert.equal(auth.message, 'Нет доступа');
  assert.equal(auth.code, 'PROFILE_ACCESS_DENIED'); assert.equal(auth.status, 403);
  assert.equal(auth.success, false); assert.equal(auth.requestId, options.requestId);
  const validation = normalizeApiErrorResponse(400, { error: { message: 'Некорректный год' }, details: [{ field: 'year' }] }, options);
  assert.equal(validation.error.message, validation.message);
  assert.equal(validation.error.status, 400); assert.deepEqual(validation.details, [{ field: 'year' }]);
  assert.equal(getErrorStatus({ status: 'bogus' }), 500);
  assert.equal(getErrorStatus({ type: 'PERMISSION_ERROR' }), 403);
  assert.equal(getErrorStatus({ statusCode: 422 }), 422);
});

test('Ошибки API: production не выдаёт SQL, стек, ключи, пути и контекст профилей', () => {
  const secret = 'SYNTHETIC_INTERNAL_ONLY';
  const body = normalizeApiErrorResponse(500, { error: { message: secret, stack: secret }, message: secret,
    details: { query: secret, profile: secret }, cause: secret, key: secret, code: 'PROFILE_ACCESS_CHECK_ERROR' }, { requestId: 'fixture' });
  assert(!JSON.stringify(body).includes(secret));
  assert.equal(body.code, 'PROFILE_ACCESS_CHECK_ERROR'); assert.equal(body.error.status, 500);
  assert.equal(serializeApiError(new Error(secret)).status, 500);
  assert(!JSON.stringify(serializeApiError(new Error(secret))).includes(secret));
});

test('Bayesian ErrorHandler: общий публичный JSON и сохранённая внутренняя диагностика', () => {
  const filename = path.resolve(__dirname, '../src/services/bayesian/ErrorHandler.js');
  const code = require('@babel/core').transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, configFile: false, babelrc: false, presets: [[require.resolve('@babel/preset-env'), { targets: { node: '18' }, modules: 'commonjs' }]]
  }).code;
  const compiled = new Module(filename, module); compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename)); compiled._compile(code, filename);
  const { CalculationError, ValidationError, default: ErrorHandler } = compiled.exports;
  const calculation = new CalculationError('synthetic internal failure', 'fixture', { sql: 'internal-only' });
  assert(!JSON.stringify(calculation).includes('internal-only'));
  assert.equal(calculation.toJSON().code, 'CALCULATION_ERROR');
  const validation = new ValidationError('Выберите год', 'year', 'private-fixture');
  assert.equal(validation.toJSON().status, 400); assert.equal(validation.toJSON().message, 'Выберите год');
  assert(!JSON.stringify(validation).includes('private-fixture'));
  const handler = new ErrorHandler({ enableLogging: false, enableReporting: false });
  const handled = handler.handleError(calculation);
  assert.equal(handled.recovery.strategy, 'calculation_fallback');
  assert.equal(handler.errorLog[0].message, calculation.message);
  assert.equal(handler.errorLog[0].stack, calculation.stack);
  assert.equal(handler.errorStats.total, 1);
});

test('Express API: caught/thrown, текстовый rate-limit, malformed JSON, XLSX и success', async t => {
  const originalMode = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const express = require('express');
  const { apiErrorResponses, errorHandler } = require('../src/middleware/errorHandler');
  const app = express();
  app.use(require('../src/middleware/requestContext').requestContext);
  app.use('/api', apiErrorResponses);
  app.use(express.json());
  app.get('/api/denied', (_req, res) => res.status(403).json({ error: 'Forbidden', message: 'Нет доступа' }));
  app.get('/api/rate', (_req, res) => res.status(429).send('Retry later'));
  app.get('/api/send-status', (_req, res) => res.sendStatus(429));
  app.get('/api/caught', (_req, res) => res.status(500).json({ message: 'internal-only', details: 'internal-only' }));
  app.get('/api/thrown', (_req, _res, next) => next(new Error('internal-only')));
  app.post('/api/body', (req, res) => res.json(req.body));
  app.get('/api/success', (_req, res) => res.json({ success: true, data: [1] }));
  app.get('/api/xlsx', (_req, res) => res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from('PK-fixture')));
  app.get('/health', (_req, res) => res.status(503).send('raw-health-fixture'));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not Found' }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (originalMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalMode;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [route, status] of [['denied', 403], ['rate', 429], ['send-status', 429], ['caught', 500], ['thrown', 500], ['missing', 404]]) {
    const response = await fetch(`${base}/api/${route}`); assert.equal(response.status, status);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
    const body = await response.json(); assert.equal(body.status, status); assert.equal(body.success, false);
    assert.equal(body.requestId, response.headers.get('X-Request-Id'));
    assert(body.message && body.code && body.timestamp);
    assert(!JSON.stringify(body).includes('internal-only'));
  }
  const malformed = await fetch(`${base}/api/body`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).code, 'BAD_REQUEST');
  assert.deepEqual(await (await fetch(`${base}/api/success`)).json(), { success: true, data: [1] });
  const xlsx = await fetch(`${base}/api/xlsx`); assert.match(xlsx.headers.get('Content-Type'), /spreadsheet/);
  assert.equal(await xlsx.text(), 'PK-fixture');
  assert.equal(await (await fetch(`${base}/health`)).text(), 'raw-health-fixture');
});

test('Ошибка после отправки заголовков передаётся Express для закрытия потока', () => {
  const { errorHandler } = require('../src/middleware/errorHandler'); const error = new Error('synthetic stream error');
  let delegated;
  errorHandler(error, { method: 'GET', url: '/api/export' }, { headersSent: true }, err => { delegated = err; });
  assert.equal(delegated, error);
});
