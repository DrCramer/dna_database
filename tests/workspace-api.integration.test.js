const test = require('node:test'),
  assert = require('node:assert/strict'),
  {
    randomUUID
  } = require('node:crypto');
const url = process.env.WORKSPACE_TEST_DATABASE_URL;
test('Workspace API: реальные сессии, роли, чужие UUID, legacy gate, Probability и безопасное чтение', {
  skip: !url
}, async t => {
  assert.match(new URL(url).pathname, /^\/dna_workspace_test(?:_|$)/);
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.UNIFIED_WORKSPACE_ENABLED = 'true';
  process.env.JWT_SECRET = 'isolated-workspace-api-synthetic-key';
  const interval = global.setInterval;
  global.setInterval = (...args) => interval(...args).unref();
  const {
      pool
    } = require('../src/config/database'),
    User = require('../src/models/User'),
    auth = require('../src/services/security/authService'),
    express = require('express'),
    {
      createImportWorkbook
    } = require('../src/utils/importWorkbook');
  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  app.use(require('../src/middleware/requestContext').requestContext);
  app.use('/api/workspace', require('../src/routes/workspace')());
  app.use('/api/profiles', require('../src/routes/workspaceLegacyBridge'));
  app.use('/api/probability', require('../src/routes/probability')());
  app.use('/api/migration-export', require('../src/routes/legacyMigrationExport')());
  app.use('/api/staff-profiles', require('../src/routes/staffProfiles'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const org = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', ['SYN-api-' + randomUUID()])).rows[0].id,
    foreignOrg = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', ['SYN-foreign-' + randomUUID()])).rows[0].id;
  const users = {};
  for (const role of ['admin', 'department_head', 'user_analyst', 'viewer', 'foreign']) {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,username,password_hash,role,organization_id,can_upload_with_task,can_upload_without_task) VALUES($1,$2,'synthetic',$3,$4,true,false)", [id, 'SYN-' + id, role === 'foreign' ? 'admin' : role, role === 'foreign' ? foreignOrg : org]);
    const user = await User.findById(id),
      token = auth.generateToken(user);
    await auth.createSession(id, token, '127.0.0.1', 'workspace-synthetic-api');
    users[role] = {
      ...user,
      token
    };
  }
  async function call(path, who = 'admin', body, method = body ? 'POST' : 'GET') {
    const multipart = body instanceof FormData;
    return fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${users[who].token}`,
        ...(!multipart ? {
          'Content-Type': 'application/json'
        } : {})
      },
      ...(body ? {
        body: multipart ? body : JSON.stringify(body)
      } : {})
    });
  }
  const data = Object.fromEntries(['TH01', 'D5S818', 'D3S1358', 'D21S11', 'vWA', 'FGA', 'D13S317', 'D7S820', 'D16S539', 'CSF1PO', 'TPOX', 'D8S1179', 'D18S51', 'D2S441', 'D19S433'].map(l => [l, ['12', '13']]));
  const buffer = createImportWorkbook({
    profiles: [{
      objectNumber: 'SYN-1',
      year: 2026,
      expertiseType: 'ug',
      comment: 'SYN',
      strData: data
    }],
    loci: Object.keys(data),
    sourceFormat: 'DNA_IMPORT_V2'
  });
  function form() {
    const f = new FormData();
    f.append('files', new Blob([buffer]), 'SYN.xlsx');
    return f;
  }
  let profile, draft;
  await t.test('Вход без отдела, старое право загрузки в задачу достаточно; viewer не загружает', async () => {
    assert.equal((await fetch(base + '/api/workspace')).status, 401);
    assert.equal((await call('/api/workspace/config')).status, 200);
    assert.equal((await call('/api/workspace/import-drafts', 'viewer', form())).status, 403);
    const r = await call('/api/workspace/import-drafts', 'user_analyst', form());
    assert.equal(r.status, 200, await r.clone().text());
    draft = await r.json();
    const commit = await call('/api/workspace/import-drafts/' + draft.id + '/commit', 'user_analyst', {
      revision: 1,
      idempotencyKey: randomUUID()
    });
    assert.equal(commit.status, 200, await commit.clone().text());
    profile = (await commit.json()).ids[0];
  });
  await t.test('Подмена владельца, организации, workspace/draft UUID и checked не разрешает запись', async () => {
    assert.equal((await call('/api/workspace/import-drafts/' + draft.id, 'foreign')).status, 404);
    assert.equal((await call('/api/workspace/profiles/' + profile, 'admin', {
      comment: 'SYN'
    }, 'PATCH')).status, 403);
    assert.equal((await call('/api/workspace/profiles/' + profile, 'user_analyst', {
      organization_id: foreignOrg
    }, 'PATCH')).status, 400);
    assert.equal((await call('/api/workspace/publish', 'user_analyst', {
      ids: [profile],
      searchRunId: randomUUID(),
      checked: true
    })).status, 400);
    assert.equal((await call('/api/workspace/publish', 'user_analyst', {
      ids: [profile],
      searchRunId: randomUUID()
    })).status, 403);
  });
  await t.test('Legacy upload и staff API не обходят pipeline; чужие личные профили не раскрываются', async () => {
    assert.equal((await call('/api/profiles/upload', 'admin', {})).status, 409);
    assert.equal((await call('/api/staff-profiles/upload', 'admin', {})).status, 409);
    const own = await (await call('/api/profiles/search?q=SYN', 'user_analyst')).json(),
      other = await (await call('/api/profiles/search?q=SYN', 'admin')).json();
    assert.equal(own.profiles.length, 1);
    assert.equal(own.profiles[0].objectNumber, 'SYN-1');
    assert.equal(other.profiles.length, 0);
    assert.equal((await call('/api/profiles/' + profile, 'foreign')).status, 404);
    assert.equal((await call('/api/migration-export/options', 'department_head')).status, 403);
  });
  await t.test('IDENT/TRIO и источники Probability работают без отдела; сохранённый расчёт не виден другому', async () => {
    assert.equal((await call('/api/probability/configuration', 'user_analyst')).status, 200);
    const body = {
      mode: 'IDENT',
      participants: [{
        role: 'object',
        sourceType: 'manual',
        displayName: 'SYN',
        manualOverrides: {
          D1S1656: '13,14'
        }
      }]
    };
    const saved = await call('/api/probability/calculations', 'user_analyst', body);
    assert.equal(saved.status, 201, await saved.clone().text());
    const value = await saved.json();
    assert.equal((await call('/api/probability/calculations/' + value.id, 'admin')).status, 404);
    assert.equal((await call('/api/probability/calculations/' + value.id, 'user_analyst')).status, 200);
  });
  await t.test('Недопустимые файлы отклоняются целиком, без тихого исключения части', async () => {
    const f = form();
    f.append('files', new Blob(['SYN']), 'unsupported.csv');
    assert.equal((await call('/api/workspace/import-drafts', 'admin', f)).status, 400);
  });
  await t.test('Русский multipart filename и перенос ФИО сохраняются после reload без изменения генотипа', async () => {
    const raw = createImportWorkbook({
      profiles: [{
        objectNumber: 'Тестов Т. Т.',
        year: 2026,
        expertiseType: 'staff',
        strData: data
      }],
      loci: Object.keys(data),
      sourceFormat: 'DNA_IMPORT_V2'
    });
    const f = new FormData();
    f.append('files', new Blob([raw]), 'Сотрудники_2.xlsx');
    const created = await call('/api/workspace/import-drafts', 'admin', f);
    assert.equal(created.status, 200);
    const d = await created.json();
    assert.equal(d.rows[0].sourceFilename, 'Сотрудники_2.xlsx');
    const {
      transferStaffName
    } = require('../src/utils/staffImportMapping');
    const moved = transferStaffName(d.rows[0]);
    const saved = await call('/api/workspace/import-drafts/' + d.id + '/rows', 'admin', {
      revision: d.revision,
      rows: [{
        draftRowId: moved.draftRowId,
        objectNumber: moved.objectNumber,
        registrationNumber: moved.registrationNumber,
        fullName: moved.fullName
      }]
    }, 'PATCH');
    assert.equal(saved.status, 200);
    const current = await saved.json();
    const reloaded = await (await call('/api/workspace/import-drafts/' + d.id)).json();
    assert.equal(reloaded.rows[0].fullName, 'Тестов Т. Т.');
    assert.equal(reloaded.rows[0].objectNumber, '');
    assert.deepEqual(reloaded.rows[0].strData, data);
    assert.equal(reloaded.rows[0].provenance.staffNameTransfer.sourceObjectNumber, 'Тестов Т. Т.');
    const validation = await (await call('/api/workspace/import-drafts/' + d.id + '/validate', 'admin', {
      revision: current.revision
    })).json();
    assert.equal(validation.valid, false);
    assert(validation.errors[0].issues.some(issue => issue.code === 'REGISTRATION'));
    const invalid = await call('/api/workspace/import-drafts/' + d.id + '/commit', 'admin', {
      revision: current.revision,
      idempotencyKey: d.id
    });
    assert.equal(invalid.status, 400);
    const repaired = await call('/api/workspace/import-drafts/' + d.id + '/rows', 'admin', {
      revision: current.revision,
      rows: [{
        draftRowId: moved.draftRowId,
        objectNumber: '00870-G',
        registrationNumber: '00870-G'
      }]
    }, 'PATCH');
    const ready = await repaired.json();
    const commit = await call('/api/workspace/import-drafts/' + d.id + '/commit', 'admin', {
      revision: ready.revision,
      idempotencyKey: d.id
    });
    assert.equal(commit.status, 200);
  });
});
