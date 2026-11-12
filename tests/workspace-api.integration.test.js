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
  await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../database/migrations/039_optional_staff_registration.sql'), 'utf8'));
  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  app.use(require('../src/middleware/requestContext').requestContext);
  app.use('/api/users', require('../src/routes/users'));
  app.use('/api/auth', require('../src/routes/auth'));
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
  await t.test('Live search: authenticated stage stream, committed result, own scope and unchanged JSON API', async () => {
    const path='/api/workspace/full-search/stream', body={ids:[profile]};
    assert.equal((await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,401);
    assert.equal((await call(path,'viewer',body)).status,403);
    assert.equal((await call(path,'user_analyst',{ids:['invalid']})).status,400);
    const response=await call(path,'user_analyst',body);
    assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
    assert.match(response.headers.get('cache-control'),/no-transform/);
    const frames=(await response.text()).trim().split('\n').map(s=>JSON.parse(s));
    assert.deepEqual([...new Set(frames.filter(f=>f.type==='progress').map(f=>f.progress.stage))],['preparing','internal','master','staff','saving','complete']);
    const result=frames.at(-1);assert.equal(result.type,'result');
    assert.equal((await call('/api/workspace/searches/'+result.result.id,'user_analyst')).status,200);
    assert.equal((await call('/api/workspace/searches/'+result.result.id,'foreign')).status,404);
    const denied=(await (await call(path,'foreign',body)).text()).trim().split('\n').map(s=>JSON.parse(s));
    assert.equal(denied.at(-1).type,'error');assert(denied.at(-1).status>=400);
    assert(!denied.some(f=>f.type==='result'));
    const legacy=await call('/api/workspace/full-search','user_analyst',body);
    assert.equal(legacy.status,200);assert((await legacy.json()).internal);
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
  await t.test('Спецтокены Y-InDel проходят XLSX-черновик, валидацию и запись без замены обычными аллелями', async () => {
    const XLSX = require('xlsx'), book = XLSX.utils.book_new();
    const names = ['Rs771783753', 'rs199815934', 'rs759551978'];
    const values = ['*', '**', '?', 'F', '1,*'];
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['Объект', 'Год', 'Тип экспертизы', ...Object.keys(data), ...names],
      ...values.map((value, i) => [`SYN-YINDEL-${i}`, 2026, 'ug', ...Object.values(data).map(a => a.join(',')), value, value, value])
    ]), 'Профили');
    const f = new FormData();
    f.append('files', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), 'SYN-YINDEL.xlsx');
    const response = await call('/api/workspace/import-drafts', 'user_analyst', f);
    assert.equal(response.status, 200, await response.clone().text());
    const d = await response.json();
    assert.equal(d.rows.length, values.length);
    for (const row of d.rows) assert.equal(row.sourceIssues.length, 0);
    const checked = await call('/api/workspace/import-drafts/' + d.id + '/validate', 'user_analyst', { revision: d.revision });
    assert.equal(checked.status, 200);
    assert.equal((await checked.json()).valid, true);
    const committed = await call('/api/workspace/import-drafts/' + d.id + '/commit', 'user_analyst', {
      revision: d.revision, idempotencyKey: randomUUID()
    });
    assert.equal(committed.status, 200, await committed.clone().text());
    const result = await committed.json();
    assert.equal(result.ids.length, values.length);
    for (const id of result.ids) {
      const saved = await pool.query('SELECT internal_number,str_data FROM dna_profiles WHERE id=$1', [id]);
      const source = d.rows.find(row => row.objectNumber === saved.rows[0].internal_number);
      for (const locus of names) assert.deepEqual(saved.rows[0].str_data[locus], source.strData[locus]);
    }
  });
  await t.test('Русский multipart filename и перенос ФИО сохраняются после reload без изменения генотипа', async () => {
    const XLSX = require('xlsx'), book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
      ['Объект','Год','Тип экспертизы',...Object.keys(data)],
      ['Тестов Т. Т.',2026,'Сотрудник',...Object.values(data).map(alleles=>alleles.join(','))]
    ]),'Сотрудники');
    const raw = XLSX.write(book,{type:'buffer',bookType:'xlsx'});
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
    assert.equal(validation.valid, true, 'Registration is optional after the name transfer');
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
  await t.test('Экспорт staff XLSX: авторизация, сохранённый снимок, палитра, пустые и незавершённые поиски', async () => {
    const { WorkspaceApprovalService } = require('../src/services/workspace/workspaceApprovalService');
    const service = new WorkspaceApprovalService(pool), actor = await User.findById(users.user_analyst.id), admin = await User.findById(users.admin.id);
    const staffFile = { originalname: 'SYN-staff.xlsx', buffer: createImportWorkbook({
      profiles: [{ objectNumber: '00991-G', fullName: 'Тестовый С. С.', year: 2025, expertiseType: 'staff', strData: data }],
      loci: Object.keys(data), sourceFormat: 'DNA_IMPORT_V2'
    }) };
    const d = await service.createDraft(admin, [staffFile]), loaded = await service.commitDraft(admin, d.id, d.revision, randomUUID());
    const staffRun = await service.fullSearch(admin, loaded.ids); await service.publish(admin, loaded.ids, staffRun.id);
    const run = await service.fullSearch(actor, [profile]);
    const endpoint = '/api/workspace/searches/' + run.id + '/staff-contaminations-xlsx';
    assert.equal((await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    for (const who of ['admin', 'department_head', 'foreign', 'viewer']) assert.equal((await call(endpoint, who, {})).status, 404);
    assert.equal((await call('/api/workspace/searches/not-a-uuid/staff-contaminations-xlsx', 'user_analyst', {})).status, 400);
    for (const body of [{ staffProfiles: [] }, { colors: { fullMatch: 'red' } }, { colors: { unknown: '#112233' } }]) assert.equal((await call(endpoint, 'user_analyst', body)).status, 400);
    await service.patch(actor, profile, { strData: { ...data, TH01: ['7', '9'] } });
    const exported = await call(endpoint, 'user_analyst', { colors: { fullMatch: '#112233', partialMatchAllele: '#ABCDEF' } });
    assert.equal(exported.status, 200, await exported.clone().text());
    assert.match(exported.headers.get('content-type'), /spreadsheetml/);
    assert.match(exported.headers.get('content-disposition'), /filename\*=UTF-8''/);
    assert.equal(exported.headers.get('cache-control'), 'private, no-store');
    const ExcelJS = require('exceljs'), book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await exported.arrayBuffer()));
    const sheet = book.getWorksheet('Контаминации'), column = sheet.getRow(1).values.indexOf('TH01');
    assert.equal(sheet.rowCount, 3); assert.equal(sheet.getCell(2, column).text, '12,13');
    assert.equal(sheet.getCell(3, column).fill.fgColor.argb, 'FF112233');
    assert.equal(sheet.getCell(3, column).value.richText[0].font.color.argb, 'FFABCDEF');
    await service.patch(actor, profile, { strData: data });
    const empty = await service.fullSearch(actor, [profile], { staffOptions: { threshold: 100 } });
    assert.equal((await call('/api/workspace/searches/' + empty.id + '/staff-contaminations-xlsx', 'user_analyst', {})).status, 400);
    await pool.query("UPDATE workspace_search_runs SET state='running' WHERE id=$1", [empty.id]);
    assert.equal((await call('/api/workspace/searches/' + empty.id + '/staff-contaminations-xlsx', 'user_analyst', {})).status, 409);
    await pool.query("UPDATE workspace_search_runs SET state='complete' WHERE id=$1", [empty.id]);
    await service.configureSearch(actor, { staffOptions: {} });
  });
  await t.test('Прежние настройки staff сохраняются, доходят до поиска и совпадают с прямым main-анализом', async () => {
    const { WorkspaceApprovalService } = require('../src/services/workspace/workspaceApprovalService');
    const { staffSearchOptions } = require('../src/utils/staffSearchOptions');
    const service = new WorkspaceApprovalService(pool), actor = await User.findById(users.user_analyst.id);
    for (const staffOptions of [{ locusWeights: { SE33: '2' } }, { matchCoefficients: { penalty: -101 } }, { matchCoefficients: { invalid: 1 } }, { useV5Algorithm: 'false' }]) {
      assert.equal((await call('/api/workspace/search-settings', 'user_analyst', { parameters: { staffOptions } }, 'PATCH')).status, 400);
    }
    const staffOptions = staffSearchOptions({ useV4Algorithm: true, useV5Algorithm: false, threshold: 0.5, locusWeights: {}, matchCoefficients: { fullMatch: 1.3, partialMatch: 0.3, penalty: -1.5 }, ignoredLoci: ['TH01'] });
    const saved = await call('/api/workspace/search-settings', 'user_analyst', { parameters: { minMatches: 14, ignoredLoci: ['FGA'], staffOptions } }, 'PATCH');
    assert.equal(saved.status, 200); assert.deepEqual((await saved.json()).parameters.staffOptions, staffOptions);
    const response = await call('/api/workspace/full-search', 'user_analyst', { ids: [profile], parameters: {} });
    assert.equal(response.status, 200); const run = await response.json();
    assert.deepEqual(run.parameters.staffOptions, staffOptions);
    const current = await service.list(actor); assert.deepEqual(current.workspace.analysis_parameters.staffOptions, staffOptions);
    assert.equal(current.profiles.find(p => p.id === profile).searchState, 'CHECKED');
    const source = (await pool.query('SELECT * FROM dna_profiles WHERE id=$1', [profile])).rows[0];
    const staff = (await pool.query('SELECT * FROM staff_profiles WHERE organization_id=$1 AND is_active=true ORDER BY full_name,id', [org])).rows;
    const analyzer = new (require('../src/services/contamination/staffContaminationAnalyzer'))(null, { quiet: true });
    const expected = await analyzer.detectStaffContamination(source, staff, staffOptions);
    const actual = run.staff[0].matches.map(({ registrationNumber, staffYear, ...match }) => match);
    assert.deepEqual(actual, expected); assert(actual.length > 0);
    assert(actual[0].detailedMatches.every(detail => detail.matchCoeff === 1.3));
    assert(actual[0].detailedMatches.some(detail => detail.locus === 'FGA'));
    assert(!actual[0].detailedMatches.some(detail => detail.locus === 'TH01'));
    await service.configureSearch(actor, { staffOptions: { ...staffOptions, threshold: 100 } });
    assert.equal((await service.list(actor)).profiles.find(p => p.id === profile).searchState, 'STALE');
    const stored = await service.search(actor, run.id); assert.deepEqual(stored.parameters.staffOptions, staffOptions);
    // The legacy task route falls back to threshold 5.5 when zero was saved.
    const zero = await service.fullSearch(actor, [profile], { staffOptions: { threshold: 0, useV5Algorithm: false, useV4Algorithm: true } });
    assert(zero.staff.every(group => group.matches.every(match => match.finalScore >= 5.5)));
    await service.configureSearch(actor, { minMatches: 15, ignoredLoci: [], staffOptions: {} });
  });
  await t.test('Персональное право через admin API, заявка аналитика, чужое решение и немедленный отзыв', async()=>{
    const created=await call('/api/auth/register-with-department','admin',{
      username:'SYN_Reviewer_'+randomUUID().slice(0,8),display_name:'Тестовый У. У.',password:'Synthetic_2026!',
      role:'user_analyst',organization_id:org,department_ids:[],can_approve_master:false
    });
    assert.equal(created.status,201);
    const newUser=(await created.json()).data.user;
    assert.equal(newUser.can_approve_master,false);
    assert.equal((await call('/api/workspace/approvals','admin')).status,403);
    assert.equal((await call('/api/users/'+newUser.id,'department_head',{can_approve_master:true},'PUT')).status,403);
    assert.equal((await call('/api/users/'+newUser.id,'foreign',{can_approve_master:true},'PUT')).status,403);
    assert.equal((await call('/api/users/'+newUser.id,'admin',{can_approve_master:'true'},'PUT')).status,400);
    const granted=await call('/api/users/'+newUser.id,'admin',{can_approve_master:true},'PUT');
    assert.equal(granted.status,200);
    assert.equal((await granted.json()).data.user.can_approve_master,true);
    const real=await User.findById(newUser.id),token=auth.generateToken(real);
    await auth.createSession(newUser.id,token,'127.0.0.1','SYN approval API');users.reviewer={...real,token};
    const f=new FormData();f.append('files',new Blob([createImportWorkbook({profiles:[1,2,3].map(n=>({objectNumber:'SYN-APP-API-'+n,year:2026,expertiseType:'ug',comment:'SYN',strData:data})),loci:Object.keys(data),sourceFormat:'DNA_IMPORT_V2'})]),'SYN.xlsx');
    const draft=await (await call('/api/workspace/import-drafts','user_analyst',f)).json();
    const imported=await call('/api/workspace/import-drafts/'+draft.id+'/commit','user_analyst',{revision:draft.revision,idempotencyKey:randomUUID()});
    assert.equal(imported.status,200);const loaded=await imported.json();
    const search=await call('/api/workspace/full-search','user_analyst',{ids:loaded.ids,parameters:{}});
    assert.equal(search.status,200);const run=await search.json();
    assert.equal((await call('/api/workspace/publish','admin',{ids:loaded.ids,searchRunId:run.id})).status,403);
    const ids=loaded.ids.slice(0,2), preview=await call('/api/workspace/approval-preview','user_analyst',{ids});
    assert.equal(preview.status,200);assert.equal((await preview.json()).count,2);
    const submitted=await call('/api/workspace/approvals','user_analyst',{ids,searchRunId:run.id,idempotencyKey:randomUUID()});
    assert.equal(submitted.status,200);const request=await submitted.json();
    assert.equal((await call('/api/workspace/approvals/'+request.id,'foreign')).status,404);
    assert.equal((await call('/api/workspace/approvals/'+request.id,'department_head')).status,403);
    const list=await call('/api/workspace/approvals','reviewer');assert.equal(list.status,200);
    assert((await list.json()).requests.some(r=>r.id===request.id&&r.profile_count===2));
    const details=await (await call('/api/workspace/approvals/'+request.id,'reviewer')).json();
    assert.equal(details.profiles.length,2);assert(details.analysisCompletedAt);assert.equal(details.requiresSearch,false);
    assert.equal((await call('/api/users/'+newUser.id,'admin',{can_approve_master:false},'PUT')).status,200);
    assert.equal((await call('/api/workspace/approvals/'+request.id+'/decision','reviewer',{decision:'approve',reviewToken:details.reviewToken})).status,403);
    await call('/api/users/'+newUser.id,'admin',{can_approve_master:true},'PUT');
    assert.equal((await call('/api/workspace/approvals/'+request.id+'/decision','reviewer',{decision:'approve',reviewToken:details.reviewToken})).status,200);
    const stored=(await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE source_workspace_profile_id=ANY($1::uuid[])',[loaded.ids])).rows[0].n;
    assert.equal(stored,2);
    const own=await (await call('/api/workspace','user_analyst')).json();assert.equal(own.profiles.filter(p=>ids.includes(p.id)&&p.state==='PUBLISHED').length,2);
    const me=await call('/api/users/me/profile','user_analyst',{can_approve_master:true},'PUT');
    assert([200,400].includes(me.status));assert.equal((await User.findById(users.user_analyst.id)).can_approve_master,false);
  });

});
