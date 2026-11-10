const test = require('node:test');
const assert = require('node:assert/strict');
const {
  randomUUID
} = require('node:crypto');
const XLSX = require('xlsx');
const url = process.env.WORKSPACE_TEST_DATABASE_URL;
test('Единый workspace: импорт, ревизии, поиск, gate, публикация и изоляция PostgreSQL', {
  skip: !url
}, async t => {
  assert.match(new URL(url).pathname, /^\/dna_workspace_test(?:_|$)/);
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.UNIFIED_WORKSPACE_ENABLED = 'true';
  const originalInterval = global.setInterval;
  global.setInterval = (...args) => originalInterval(...args).unref();
  const {
    pool
  } = require('../src/config/database');
  const {
    WorkspaceSearchService
  } = require('../src/services/workspace/workspaceSearchService');
  const service = new WorkspaceSearchService(pool);
  t.after(() => pool.end());
  const org = (await pool.query("INSERT INTO organizations(name) VALUES($1) RETURNING id", ['SYN-workspace-' + randomUUID()])).rows[0].id;
  const foreignOrg = (await pool.query("INSERT INTO organizations(name) VALUES($1) RETURNING id", ['SYN-foreign-' + randomUUID()])).rows[0].id;
  async function user(role, organization = org) {
    const id = randomUUID();
    await pool.query('INSERT INTO users(id,username,password_hash,role,organization_id) VALUES($1,$2,$3,$4,$5)', [id, 'SYN-' + id, 'synthetic-not-a-password', role, organization]);
    return {
      id,
      role,
      organization_id: organization,
      is_active: true,
      can_upload_with_task: true,
      can_upload_without_task: false
    };
  }
  const admin = await user('admin'),
    analyst = await user('user_analyst'),
    other = await user('user_analyst'),
    foreign = await user('admin', foreignOrg);
  const {
    ALL_LOCI
  } = require('../src/utils/lociTypeDetector');
  const data = Object.fromEntries(['TH01', 'D5S818', 'D3S1358', 'D21S11', 'vWA', 'FGA', 'D13S317', 'D7S820', 'D16S539', 'CSF1PO', 'TPOX', 'D8S1179', 'D18S51', 'D2S441', 'D19S433'].map(l => [l, ['12', '13']]));
  const {
    createImportWorkbook
  } = require('../src/utils/importWorkbook');
  const {
    FORMAT
  } = require('../src/utils/objectImportV2');
  function file(profiles) {
    return {
      originalname: 'SYN импорт.xlsx',
      buffer: createImportWorkbook({
        profiles,
        loci: Object.keys(data),
        sourceFormat: FORMAT
      })
    };
  }
  const profile = (objectNumber, type = 'ug', strData = data) => ({
    objectNumber,
    year: 2026,
    expertiseType: type,
    fullName: type === 'staff' ? 'Тестов Тест Тестович' : '',
    comment: 'SYN',
    strData
  });
  async function load(who, profiles) {
    const draft = await service.createDraft(who, [file(profiles)]);
    const valid = await service.validateDraft(who, draft.id, 1);
    assert.equal(valid.valid, true, JSON.stringify(valid));
    return service.commitDraft(who, draft.id, 1, randomUUID());
  }
  let ids, run;
  await t.test('Один постоянный контейнер при конкурентном входе; владелец не зависит от отдела', async () => {
    const list = await Promise.all(Array.from({
      length: 8
    }, () => service.workspace(analyst)));
    assert.equal(new Set(list.map(w => w.id)).size, 1);
    assert.equal((await service.workspace({
      ...analyst,
      department_id: randomUUID()
    })).id, list[0].id);
  });
  await t.test('Выбор строк, индивидуальные годы и типы; снятая ошибочная строка не записывается', async () => {
    const draft = await service.createDraft(analyst, [file([profile('258-1'), profile('258-1', 'gr'), profile('258-2', 'ug', {}), {
      ...profile('BAD'),
      year: null
    }])]);
    const bad = draft.rows[3];
    const changed = await service.patchDraft(analyst, draft.id, 1, [{
      draftRowId: bad.draftRowId,
      included: false
    }, {
      draftRowId: draft.rows[1].draftRowId,
      year: 2025
    }]);
    assert.equal(changed.revision, 2);
    assert.equal((await service.validateDraft(analyst, draft.id, 2)).valid, true);
    // Клиент использует UUID черновика без зависимости от Web Crypto в HTTP-браузере.
    const key = draft.id,
      result = await service.commitDraft(analyst, draft.id, 2, key);
    ids = result.ids;
    assert.equal(ids.length, 3);
    assert.deepEqual((await service.commitDraft(analyst, draft.id, 2, key)).ids, ids);
    await assert.rejects(service.commitDraft(other, draft.id, 2, key), /недоступен/);
    const list = await service.list(analyst);
    assert.equal(list.profiles.length, 3);
    assert.equal(list.profiles.find(p => p.objectNumber === '258-2').state, 'NO_GENOTYPE');
  });
  await t.test('Чужой профиль и чужой поиск не редактируются; конфликт всего пакета откатывается', async () => {
    await assert.rejects(service.patch(other, ids[0], {
      comment: 'SYN'
    }), /недоступен/);
    await assert.rejects(service.patch(foreign, ids[0], {
      comment: 'SYN'
    }), /недоступен/);
    await assert.rejects(load(analyst, [profile('NEW'), profile('258-1')]));
    assert.equal((await service.list(analyst)).profiles.length, 3);
  });
  await t.test('Пустые профили проходят round-trip без фиктивных аллелей', async () => {
    const buffer = await service.exportProfiles(analyst, [ids[2]]);
    const draft = await service.createDraft(other, [{
      originalname: 'SYN.xlsx',
      buffer
    }]);
    assert.equal(Object.values(draft.rows[0].strData).some(a => a.length), false);
    assert.equal((await service.validateDraft(other, draft.id, 1)).valid, true);
  });
  await t.test('Полный поиск выполняет три этапа; пустой объект не становится проверенным', async () => {
    run = await service.fullSearch(analyst, ids, {});
    assert.equal(run.profiles.filter(p => p.state === 'CHECKED').length, 2);
    assert.equal(run.profiles.find(p => p.profileId === ids[2]).state, 'NO_GENOTYPE');
    assert.equal((await service.list(analyst)).profiles.find(p => p.id === ids[0]).state, 'CHECKED');
    await assert.rejects(service.search(other, run.id), /недоступен/);
  });
  await t.test('Комментарий не инвалидирует поиск; генотип и изменение набора инвалидируют', async () => {
    await service.patch(analyst, ids[0], {
      comment: 'новый комментарий'
    });
    assert.equal((await service.list(analyst)).profiles.find(p => p.id === ids[0]).state, 'CHECKED');
    await service.patch(analyst, ids[0], {
      strData: {
        ...data,
        TH01: ['7', '9']
      }
    });
    assert.equal((await service.list(analyst)).profiles.find(p => p.id === ids[0]).state, 'STALE');
  });
  await t.test('Администратор тоже не публикует без поиска; пакетная публикация атомарна, идемпотентна', async () => {
    const a = await load(admin, [profile('PUB-1'), profile('PUB-1', 'gr')]);
    await assert.rejects(service.publish(admin, a.ids, randomUUID()), /полный поиск/);
    const result = await service.fullSearch(admin, a.ids, {});
    const p = await service.publish(admin, a.ids, result.id);
    assert.equal(p.published.length, 2);
    assert.equal((await service.publish(admin, a.ids, result.id)).replayed, true);
    await service.remove(admin, [a.ids[0]]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE organization_id=$1', [org])).rows[0].n, 2);
  });
  await t.test('Staff-публикация административная; источник реально участвует в контаминации', async () => {
    const x = await load(admin, [profile('00870-G', 'staff')]);
    const search = await service.fullSearch(admin, x.ids, {});
    const result = await service.publish(admin, x.ids, search.id);
    const staff = (await pool.query('SELECT * FROM staff_profiles WHERE id=$1', [result.published[0].publishedId])).rows[0];
    assert.equal(staff.registration_number, '00870-G');
    assert.equal(staff.organization_id, org);
    const next = await service.fullSearch(analyst, [ids[0]], {});
    assert.equal(next.referenceCounts.staff, 1);
    await assert.rejects(service.publish(analyst, [ids[0]], next.id), /права публикации/);
  });
  await t.test('После включения режима SQL gate закрывает legacy-публикацию', async () => {
    await pool.query('UPDATE workspace_configuration SET enabled=true WHERE id=true');
    const master = (await pool.query('SELECT id FROM master_arrays WHERE organization_id=$1 AND organization_default=true', [org])).rows[0].id;
    await assert.rejects(pool.query("INSERT INTO master_array_profiles(master_array_id,year,sample_name,internal_number,str_data,created_by,organization_id) VALUES($1,2026,'SYN','BYPASS','{}',$2,$3)", [master, admin.id, org]), e => e.code === '42501');
    await assert.rejects(pool.query("INSERT INTO staff_profiles(staff_id,full_name,str_data,created_by,organization_id) VALUES($1,'SYN','{}',$2,$3)", ['SYN-' + randomUUID(), admin.id, org]), e => e.code === '42501');
  });
  await t.test('Параллельная публикация не создаёт вторую запись; смена эталонов делает допуск устаревшим', async () => {
    const source = await load(admin, [profile('CONCURRENT')]),
      checked = await service.fullSearch(admin, source.ids, {});
    const results = await Promise.all([service.publish(admin, source.ids, checked.id), service.publish(admin, source.ids, checked.id)]);
    assert.equal(results[0].published[0].publishedId, results[1].published[0].published_id || results[1].published[0].publishedId);
    const another = await load(admin, [profile('STALE-REFERENCE')]);
    const run = await service.fullSearch(admin, another.ids, {});
    await pool.query('UPDATE master_array_profiles SET comment=$1 WHERE id=$2', ['SYN-comment', results[0].published[0].publishedId]);
    assert.equal((await service.list(admin)).profiles.find(p => p.id === another.ids[0]).state, 'CHECKED');
    await pool.query('UPDATE master_array_profiles SET is_active=false WHERE id=$1', [results[0].published[0].publishedId]);
    await assert.rejects(service.publish(admin, another.ids, run.id), /актуальный полный поиск/);
  });
  await t.test('Ошибка staff-этапа и отмена не создают готовность; неполный профиль остаётся непроверяемым', async () => {
    const source = await load(admin, [profile('FAILED-SEARCH')]);
    const Analyzer = require('../src/services/contamination/staffContaminationAnalyzer'),
      original = Analyzer.prototype.detectStaffContamination;
    Analyzer.prototype.detectStaffContamination = async () => {
      throw Error('SYN staff source failure');
    };
    try {
      await assert.rejects(service.fullSearch(admin, source.ids, {}), /SYN staff source failure/);
    } finally {
      Analyzer.prototype.detectStaffContamination = original;
    }
    const latest = (await pool.query('SELECT * FROM workspace_search_runs WHERE workspace_id=$1 ORDER BY started_at DESC LIMIT 1', [(await service.workspace(admin)).id])).rows[0];
    assert.equal(latest.state, 'failed');
    await assert.rejects(service.publish(admin, source.ids, latest.id), /актуальный полный поиск/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(service.fullSearch(admin, source.ids, {}, controller.signal), /отменён/);
    const partial = await load(admin, [profile('PARTIAL', 'ug', {
      TH01: ['7']
    })]);
    const result = await service.fullSearch(admin, partial.ids, {});
    assert.equal(result.profiles[0].state, 'INSUFFICIENT_DATA');
  });
  await t.test('Другая личная копия не создаёт второй мастер-объект; явное обновление сохраняет UUID и историю', async () => {
    const first = await load(admin, [profile('SHARED-IDENTITY')]);
    const checked = await service.fullSearch(admin, first.ids, {});
    const published = await service.publish(admin, first.ids, checked.id),
      publishedId = published.published[0].publishedId;
    const manager = await user('department_head'),
      copy = await load(manager, [profile('SHARED-IDENTITY')]),
      run = await service.fullSearch(manager, copy.ids, {});
    await assert.rejects(service.publish(manager, copy.ids, run.id), /уже есть объект/);
    const conflicts = await service.publicationPreview(manager, copy.ids);
    assert.equal(conflicts.conflicts[0].publishedId, publishedId);
    await service.publish(manager, copy.ids, run.id, {
      [copy.ids[0]]: publishedId
    });
    assert.equal((await service.list(admin)).profiles.find(p => p.id === first.ids[0]).state, 'STALE');
    const fresh = await service.fullSearch(admin, first.ids, {});
    await service.publish(admin, first.ids, fresh.id, {
      [first.ids[0]]: publishedId
    });
    assert.equal((await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE organization_id=$1 AND internal_number=$2', [org, 'SHARED-IDENTITY'])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM workspace_publications WHERE workspace_profile_id=$1', [first.ids[0]])).rows[0].n, 2);
  });
  await t.test('Изменение параметров сравнения инвалидирует готовность на сервере',async()=>{
    const source=await load(admin,[profile('SETTINGS-REVISION')]);const run=await service.fullSearch(admin,source.ids,{});
    await service.configureSearch(admin,{minMatches:14});
    assert.equal((await service.list(admin)).profiles.find(p=>p.id===source.ids[0]).state,'STALE');
    await assert.rejects(service.publish(admin,source.ids,run.id),/актуальный полный поиск/);
  });

  await t.test('Отключение общего массива инвалидирует доказательство поиска',async()=>{
    const source=await load(admin,[profile('ARRAY-REVISION')]);const run=await service.fullSearch(admin,source.ids,{});
    await pool.query('UPDATE master_arrays SET is_active=false WHERE organization_id=$1 AND organization_default=true',[org]);
    assert.equal((await service.list(admin)).profiles.find(p=>p.id===source.ids[0]).state,'STALE');
    await assert.rejects(service.publish(admin,source.ids,run.id),/актуальный полный поиск/);
    await pool.query('UPDATE master_arrays SET is_active=true WHERE organization_id=$1 AND organization_default=true',[org]);
  });

  await t.test('Мониторинг сохранности не считает отсутствие справочного отдела ошибкой',async()=>{
    const result=await require('../src/services/infrastructure/dataPersistenceService').verifyDataConsistency();
    assert.notEqual(result.status,'failed',result.error);
    assert(!result.checks.some(check=>['users_without_departments','departments_without_master_arrays','workspace_owner_mismatch'].includes(check.type)));
  });

});
