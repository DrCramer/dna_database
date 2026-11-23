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
  const { WorkspaceMasterRollbackService } = require('../src/services/workspace/workspaceMasterRollbackService');
  await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../database/migrations/039_optional_staff_registration.sql'), 'utf8'));
  await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../database/migrations/042_master_approval_without_genotype.sql'), 'utf8'));
  await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../database/migrations/043_master_approval_partial_genotypes.sql'), 'utf8'));
  await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../database/migrations/044_master_approval_rollback.sql'), 'utf8'));
  await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../database/migrations/045_master_rollback_batch_revision.sql'), 'utf8'));
  const service = new WorkspaceMasterRollbackService(pool);
  await pool.query('INSERT INTO workspace_configuration(id,enabled) VALUES(true,false) ON CONFLICT(id) DO UPDATE SET enabled=false');
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
        loci: [...new Set(profiles.flatMap(p => Object.keys(p.strData || {})))],
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
  const reviewer=await user('user_analyst');
  await pool.query('UPDATE users SET can_approve_master=true WHERE id=$1',[reviewer.id]);
  async function publishReady(actor,ids,runId,targets={}) {
    const profiles=await service.ownProfiles(pool,actor,await service.workspace(actor),ids);
    if(profiles.every(p=>p.expertise_type==='staff')) return service.publish(actor,ids,runId,targets);
    const request=await service.submitApproval(actor,ids,runId,targets,runId);
    const detail=await service.approvalDetail(reviewer,request.id);
    const outcome=await service.decideApproval(reviewer,request.id,'approve',detail.reviewToken);
    const published=(await pool.query('SELECT profile_id AS "profileId",target_id AS "publishedId" FROM workspace_master_approval_items WHERE approval_id=$1 ORDER BY profile_id',[request.id])).rows;
    return {published,replayed:outcome.replayed};
  }
  let ids, run;
  await t.test('Поиск сохраняет типы одноимённых объектов в личном массиве, мастер-массиве и контаминациях', async () => {
    const { rows: [{ id: typeOrg }] } = await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', ['SYN-types-' + randomUUID()]);
    const actor = await user('user_analyst', typeOrg);
    const otherOwner = await user('user_analyst', typeOrg);
    const { ids: [referenceId, matchId] } = await load(actor, [profile('SYN-TYPE', 'gr'), profile('SYN-TYPE', 'ug')]);
    const { rows: [{ id: arrayId }] } = await pool.query("INSERT INTO master_arrays(name,organization_id) VALUES('SYN array',$1) RETURNING id", [typeOrg]);
    const { rows: [{ id: masterId }] } = await pool.query(`INSERT INTO master_array_profiles(master_array_id,organization_id,year,sample_name,internal_number,str_data,created_by,expertise_type)
      VALUES($1,$2,2026,'SYN-REG','SYN-TYPE',$3,$4,'chs') RETURNING id`, [arrayId, typeOrg, JSON.stringify(data), actor.id]);
    await pool.query("INSERT INTO staff_profiles(staff_id,full_name,str_data,created_by,organization_id) VALUES($1,'Тестов Тест',$2,$3,$4)", ['SYN-' + randomUUID(), JSON.stringify(data), actor.id, typeOrg]);
    const search = await service.fullSearch(actor, [referenceId]);
    function checkTypes(result, types) {
      const { internal: { results: [personal] }, master: { results: [master] }, staff: [staff] } = result;
      assert.equal(personal.reference.expertise_type, types.workspace);
      assert.equal(master.reference.expertise_type, types.workspace);
      assert.equal(staff.reference.expertise_type, types.workspace);
      for (const list of [personal.matches, personal.exportMatches]) {
        assert.equal(list.find(match => match.id === matchId).expertise_type, types.candidate);
      }
      for (const list of [master.matches, master.exportMatches]) {
        assert.equal(list.find(match => match.id === masterId).expertise_type, types.master);
      }
    }
    const initialTypes = { workspace: 'gr', candidate: 'ug', master: 'chs' };
    checkTypes(search, initialTypes);
    checkTypes(await service.search(actor, search.id), initialTypes);
    await assert.rejects(service.search(otherOwner, search.id), e => e.status === 404);

    const { seal, unseal } = require('../src/services/workspace/workspaceCrypto');
    const { rows: [{ encrypted_result: snapshot }] } = await pool.query('SELECT encrypted_result FROM workspace_search_runs WHERE id=$1', [search.id]);
    const olderResult = JSON.parse(JSON.stringify(unseal(snapshot), (key, value) => key === 'expertise_type' ? undefined : value));
    await pool.query('UPDATE workspace_search_runs SET encrypted_result=$2 WHERE id=$1', [search.id, seal(olderResult)]);
    checkTypes(await service.search(actor, search.id), initialTypes);
    await service.patch(actor, matchId, { objectNumber: 'SYN-TYPE-2' });
    await pool.query("UPDATE master_array_profiles SET expertise_type='ug' WHERE id=$1", [masterId]);
    checkTypes(await service.search(actor, search.id), {});
    await pool.query('UPDATE workspace_search_runs SET encrypted_result=$2 WHERE id=$1', [search.id, snapshot]);
    checkTypes(await service.search(actor, search.id), initialTypes);
  });
  await t.test('История дубликатов учитывает старый поиск, первую дату, владельца и очистку истории', async () => {
    const actor = await user('user_analyst');
    const pair = await load(actor, [profile('SYN-HISTORY-1'), profile('SYN-HISTORY-2')]);
    const first = await service.fullSearch(actor, [pair.ids[0]]);
    const firstMatch = first.internal.results[0].exportMatches[0];
    assert.equal(firstMatch.duplicateHistory.status, 'new');
    const firstAt = firstMatch.duplicateHistory.firstFoundAt;
    // Сохраняем исходный снимок, имитируя результат до добавления индекса 041.
    await pool.query('UPDATE workspace_search_runs SET duplicate_pair_keys=NULL,duplicate_history_complete=NULL WHERE id=$1', [first.id]);
    // Обратное направление той же пары, а старый результат пока не проиндексирован.
    const second = await service.fullSearch(actor, [pair.ids[1]]);
    assert.deepEqual(second.internal.results[0].matches[0].duplicateHistory, { status: 'unknown', firstFoundAt: null });
    const { indexSavedDuplicateHistory } = require('../src/services/workspace/workspaceDuplicateHistory');
    const { ALGORITHM_VERSION } = require('../src/services/workspace/workspaceSearchService');
    const indexed = await indexSavedDuplicateHistory(pool, ALGORITHM_VERSION);
    assert(indexed.indexed >= 1);
    assert.equal(indexed.incomplete, 0);
    const repeated = await service.search(actor, second.id, { duplicateHistory: true });
    assert.deepEqual(repeated.internal.results[0].matches[0].duplicateHistory, { status: 'known', firstFoundAt: firstAt });
    assert.deepEqual(repeated.internal.results[0].exportMatches[0].duplicateHistory, { status: 'known', firstFoundAt: firstAt });
    assert.equal((await service.search(actor, first.id, { duplicateHistory: true })).internal.results[0].matches[0].duplicateHistory.status, 'new');
    await assert.rejects(service.search(other, second.id, { duplicateHistory: true }), /недоступен/);
    await pool.query("UPDATE workspace_search_runs SET state='cancelled',encrypted_result=NULL WHERE id=$1", [first.id]);
    const cleared = (await pool.query('SELECT duplicate_pair_keys,duplicate_history_complete FROM workspace_search_runs WHERE id=$1', [first.id])).rows[0];
    assert.deepEqual(cleared, { duplicate_pair_keys: null, duplicate_history_complete: null });
    assert.equal((await service.search(actor, second.id, { duplicateHistory: true })).internal.results[0].matches[0].duplicateHistory.status, 'new');
  });
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
    await assert.rejects(publishReady(admin, a.ids, randomUUID()), /поиск/);
    const result = await service.fullSearch(admin, a.ids, {});
    const p = await publishReady(admin, a.ids, result.id);
    assert.equal(p.published.length, 2);
    assert.equal((await publishReady(admin, a.ids, result.id)).replayed, true);
    await service.remove(admin, [a.ids[0]]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE organization_id=$1', [org])).rows[0].n, 2);
  });
  await t.test('Staff-публикация административная; источник реально участвует в контаминации', async () => {
    const x = await load(admin, [profile('00870-G', 'staff')]);
    const search = await service.fullSearch(admin, x.ids, {});
    const result = await publishReady(admin, x.ids, search.id);
    const staff = (await pool.query('SELECT * FROM staff_profiles WHERE id=$1', [result.published[0].publishedId])).rows[0];
    assert.equal(staff.registration_number, '00870-G');
    assert.equal(staff.organization_id, org);
    const next = await service.fullSearch(analyst, [ids[0]], {});
    assert.equal(next.referenceCounts.staff, 1);
    await assert.rejects(service.publish(analyst, [ids[0]], next.id), /права публикации/);
  });
  await t.test('Сотрудники без номера: несколько записей, публикация, самоисключение, экспорт и изменение номера', async () => {
    const x = await load(admin, [profile('', 'staff'), profile('', 'staff')]);
    assert.equal(x.ids.length, 2);
    const stored = (await pool.query('SELECT internal_number,registration_number FROM dna_profiles WHERE id=ANY($1::uuid[])', [x.ids])).rows;
    assert(stored.every(row => row.internal_number === null && row.registration_number === null));
    const checked = await service.fullSearch(admin, x.ids);
    const result = await service.publish(admin, x.ids, checked.id);
    assert.equal(result.published.length, 2);
    assert.notEqual(result.published[0].publishedId, result.published[1].publishedId);
    const staffIds = result.published.map(item => item.publishedId);
    assert((await pool.query('SELECT registration_number FROM staff_profiles WHERE id=ANY($1::uuid[])', [staffIds])).rows.every(row => row.registration_number === null));
    const self = await service.fullSearch(admin, x.ids);
    for (const item of result.published) {
      assert(!self.staff.find(group => group.profileId === item.profileId).matches.some(match => match.staffId === item.publishedId));
      assert.equal(self.staffProfiles.find(p => p.id === staffIds.find(id => id !== item.publishedId)).internal_number, '');
    }
    const exported = await service.exportProfiles(admin, x.ids);
    const parsed = require('../src/services/workspace/importSourceService').parseFiles([{ originalname: 'SYN.xlsx', buffer: exported }]).rows;
    assert.equal(parsed.length, 2); assert(parsed.every(row => row.objectNumber === '' && row.fullName && !require('../src/utils/objectImportV2').validateObject(row).length));
    await service.patch(admin, x.ids[0], { objectNumber: '00998-G' });
    const numberedRun = await service.fullSearch(admin, [x.ids[0]]);
    await service.publish(admin, [x.ids[0]], numberedRun.id);
    await service.patch(admin, x.ids[0], { objectNumber: '' });
    const clearedRun = await service.fullSearch(admin, [x.ids[0]]);
    const original = result.published.find(item => item.profileId === x.ids[0]).publishedId;
    const unrelated = staffIds.find(id => id !== original);
    await assert.rejects(service.publish(admin, [x.ids[0]], clearedRun.id, { [x.ids[0]]: unrelated }), /не соответствует/);
    const cleared = await service.publish(admin, [x.ids[0]], clearedRun.id);
    assert.equal(cleared.published[0].publishedId, original);
    assert.equal((await pool.query('SELECT registration_number FROM staff_profiles WHERE id=$1', [original])).rows[0].registration_number, null);
    await assert.rejects(pool.query('UPDATE dna_profiles SET internal_number=NULL WHERE id=$1', [ids[0]]), e => e.code === '23514');
  });
  await t.test('После включения режима SQL gate закрывает legacy-публикацию', async () => {
    await pool.query('UPDATE workspace_configuration SET enabled=true WHERE id=true');
    const master = (await pool.query('SELECT id FROM master_arrays WHERE organization_id=$1 AND organization_default=true', [org])).rows[0].id;
    await assert.rejects(pool.query("INSERT INTO master_array_profiles(master_array_id,year,sample_name,internal_number,str_data,created_by,organization_id) VALUES($1,2026,'SYN','BYPASS','{}',$2,$3)", [master, admin.id, org]), e => e.code === '42501');
    const target=(await pool.query('SELECT id FROM master_array_profiles WHERE organization_id=$1 LIMIT 1',[org])).rows[0];
    await assert.rejects(pool.query("UPDATE master_array_profiles SET str_data_encrypted='{}' WHERE id=$1",[target.id]),e=>e.code==='42501');
    await assert.rejects(pool.query("UPDATE master_array_profiles SET is_active=false,str_data='{}'::jsonb WHERE id=$1",[target.id]),e=>e.code==='42501');
    await assert.rejects(pool.query("INSERT INTO staff_profiles(staff_id,full_name,str_data,created_by,organization_id) VALUES($1,'SYN','{}',$2,$3)", ['SYN-' + randomUUID(), admin.id, org]), e => e.code === '42501');
  });
  await t.test('Параллельная публикация не создаёт вторую запись; смена эталонов делает допуск устаревшим', async () => {
    const source = await load(admin, [profile('CONCURRENT')]),
      checked = await service.fullSearch(admin, source.ids, {});
    const results = await Promise.all([publishReady(admin, source.ids, checked.id), publishReady(admin, source.ids, checked.id)]);
    assert.equal(results[0].published[0].publishedId, results[1].published[0].published_id || results[1].published[0].publishedId);
    const another = await load(admin, [profile('STALE-REFERENCE')]);
    const run = await service.fullSearch(admin, another.ids, {});
    await assert.rejects(pool.query('UPDATE master_array_profiles SET comment=$1 WHERE id=$2', ['SYN-comment', results[0].published[0].publishedId]), e=>e.code==='42501');
    assert.equal((await service.list(admin)).profiles.find(p => p.id === another.ids[0]).state, 'CHECKED');
    await pool.query('UPDATE master_array_profiles SET is_active=false WHERE id=$1', [results[0].published[0].publishedId]);
    await assert.rejects(publishReady(admin, another.ids, run.id), /поиск/);
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
    await assert.rejects(publishReady(admin, source.ids, latest.id), /поиск/);
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
    const published = await publishReady(admin, first.ids, checked.id),
      publishedId = published.published[0].publishedId;
    const manager = await user('department_head'),
      copy = await load(manager, [profile('SHARED-IDENTITY')]),
      run = await service.fullSearch(manager, copy.ids, {});
    await assert.rejects(publishReady(manager, copy.ids, run.id), /уже есть объект/);
    const conflicts = await service.publicationPreview(manager, copy.ids);
    assert.equal(conflicts.conflicts[0].publishedId, publishedId);
    await publishReady(manager, copy.ids, run.id, {
      [copy.ids[0]]: publishedId
    });
    assert.equal((await service.list(admin)).profiles.find(p => p.id === first.ids[0]).state, 'STALE');
    const fresh = await service.fullSearch(admin, first.ids, {});
    await publishReady(admin, first.ids, fresh.id, {
      [first.ids[0]]: publishedId
    });
    assert.equal((await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE organization_id=$1 AND internal_number=$2', [org, 'SHARED-IDENTITY'])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM workspace_publications WHERE workspace_profile_id=$1', [first.ids[0]])).rows[0].n, 2);
  });
  await t.test('Изменение параметров сравнения инвалидирует готовность на сервере', async () => {
    const source = await load(admin, [profile('SETTINGS-REVISION')]);
    const run = await service.fullSearch(admin, source.ids, {});
    await service.configureSearch(admin, {
      minMatches: 14
    });
    assert.equal((await service.list(admin)).profiles.find(p => p.id === source.ids[0]).state, 'STALE');
    await assert.rejects(publishReady(admin, source.ids, run.id), /поиск/);
  });
  await t.test('Отключение общего массива инвалидирует доказательство поиска', async () => {
    const source = await load(admin, [profile('ARRAY-REVISION')]);
    const run = await service.fullSearch(admin, source.ids, {});
    await pool.query('UPDATE master_arrays SET is_active=false WHERE organization_id=$1 AND organization_default=true', [org]);
    assert.equal((await service.list(admin)).profiles.find(p => p.id === source.ids[0]).state, 'STALE');
    await assert.rejects(publishReady(admin, source.ids, run.id), /поиск/);
    await pool.query('UPDATE master_arrays SET is_active=true WHERE organization_id=$1 AND organization_default=true', [org]);
  });
  await t.test('Мониторинг сохранности не считает отсутствие справочного отдела ошибкой', async () => {
    const result = await require('../src/services/infrastructure/dataPersistenceService').verifyDataConsistency();
    assert.notEqual(result.status, 'failed', result.error);
    assert(!result.checks.some(check => ['users_without_departments', 'departments_without_master_arrays', 'workspace_owner_mismatch'].includes(check.type)));
  });
  await t.test('Старый черновик с Latin-1 именем файла читается корректно без перезаписи исходного генотипа', async () => {
    const d = await service.createDraft(admin, [file([profile('FILENAME-LEGACY')])]);
    const {
      seal,
      unseal
    } = require('../src/services/workspace/workspaceCrypto');
    const raw = (await pool.query('SELECT encrypted_payload FROM workspace_import_drafts WHERE id=$1', [d.id])).rows[0];
    const payload = unseal(raw.encrypted_payload);
    const garbled = Buffer.from('Сотрудники_2.xlsx', 'utf8').toString('latin1');
    payload.rows[0].sourceFilename = garbled;
    payload.rows[0].provenance.sourceFilename = garbled;
    delete payload.rows[0].provenance.sourceFilenameDecoded;
    await pool.query('UPDATE workspace_import_drafts SET encrypted_payload=$1 WHERE id=$2', [seal(payload), d.id]);
    const loaded = await service.draft(admin, d.id);
    assert.equal(loaded.rows[0].sourceFilename, 'Сотрудники_2.xlsx');
    assert.equal(loaded.rows[0].provenance.originalUploadedFilename, garbled);
    assert.deepEqual(loaded.rows[0].strData, payload.rows[0].strData);
    const unchanged = unseal((await pool.query('SELECT encrypted_payload FROM workspace_import_drafts WHERE id=$1', [d.id])).rows[0].encrypted_payload);
    assert.equal(unchanged.rows[0].sourceFilename, garbled);
  });
  await t.test('Потоки staff и пакетные SQL сохраняют исключение только своей публикации и все три допуска', async () => {
    const actor = await user('admin');
    const staffSource = await load(actor, Array.from({ length: 20 }, (_, i) => profile((900000 + i) + '-G', 'staff')));
    const staffChecked = await service.fullSearch(actor, staffSource.ids);
    const published = await publishReady(actor, staffSource.ids, staffChecked.id);
    const ordinary = await load(actor, Array.from({ length: 100 }, (_, i) => profile('SYN-PARALLEL-' + i)));
    let queries = 0;
    const measured = new (require('../src/services/workspace/workspaceSearchService').WorkspaceSearchService)({
      query: (...args) => { queries++; return pool.query(...args); },
      connect: async () => {
        const client = await pool.connect();
        return { query: (...args) => { queries++; return client.query(...args); }, release: () => client.release() };
      }
    });
    const result = await measured.fullSearch(actor, [...staffSource.ids, ...ordinary.ids]);
    assert.equal(result.staffExecution.mode, 'multi-threaded');
    assert(result.staffExecution.workerCount > 0);
    assert.equal(result.staffExecution.comparisons, 120 * result.referenceCounts.staff - 20);
    assert.equal(result.staff.length, 120);
    assert(result.profiles.every(profile => profile.state === 'CHECKED'));
    for (const publication of published.published) {
      const group = result.staff.find(group => group.profileId === publication.profileId);
      assert(group);
      assert(!group.matches.some(match => match.staffId === publication.publishedId));
    }
    const firstOrdinary = result.staff.find(group => group.profileId === ordinary.ids[0]);
    assert(published.published.every(publication => firstOrdinary.matches.some(match => match.staffId === publication.publishedId)));
    assert(queries < 40, 'No SQL round-trip per profile: ' + queries);
    const proofs = (await pool.query('SELECT state,stages FROM workspace_search_profiles WHERE search_run_id=$1', [result.id])).rows;
    assert.equal(proofs.length, 120);
    assert(proofs.every(proof => proof.state === 'CHECKED' && proof.stages.internal && proof.stages.master && proof.stages.staff));
    const hitIds=new Set(result.staff.flatMap(group=>group.matches.map(match=>match.staffId)));
    assert.deepEqual(new Set(result.staffProfiles.map(p=>p.id)),hitIds,'Only already-authorized matched staff are included');
    assert.deepEqual(result.staff.find(group=>group.profileId===ordinary.ids[0]).reference.str_data,data);
    const snapshotId=published.published[0].publishedId;
    assert.deepEqual(result.staffProfiles.find(p=>p.id===snapshotId).str_data,data);
    // Later changes to the editable source and staff publication must not alter
    // the genotypes shown for this completed search.
    await service.patch(actor,ordinary.ids[0],{strData:{...data,TH01:['7','9']}});
    await service.patch(actor,staffSource.ids[0],{strData:{...data,TH01:['7','9']}});
    const updatedRun=await service.fullSearch(actor,[staffSource.ids[0]]);
    await service.publish(actor,[staffSource.ids[0]],updatedRun.id);
    const stored=await service.search(actor,result.id);
    assert.deepEqual(stored.staff.find(group=>group.profileId===ordinary.ids[0]).reference.str_data,data);
    const updatedId=published.published.find(p=>p.profileId===staffSource.ids[0]).publishedId;
    assert.deepEqual(stored.staffProfiles.find(p=>p.id===updatedId).str_data.TH01,['12','13']);
    assert.deepEqual((await pool.query('SELECT str_data FROM staff_profiles WHERE id=$1',[updatedId])).rows[0].str_data.TH01,['7','9']);

  });
  await t.test('Заявка сохраняет полные, частичные и пустые генотипы с исходными аллелями', async () => {
    const owner = await user('user_analyst');
    const empty = { D3S1358: ['*'], D5S818: ['?'] };
    const partial = Object.fromEntries(Object.entries(data).slice(0, 6));
    const source = await load(owner, [
      profile('SYN-APP-FULL'), profile('SYN-APP-EMPTY', 'gr', {}), profile('SYN-APP-UNKNOWN', 'ug', empty),
      profile('SYN-APP-PARTIAL', 'ug', partial)
    ]);
    const partialId = source.ids[3];
    await assert.rejects(service.approvalPreview(owner, source.ids), error => {
      assert.equal(error.code, 'FULL_SEARCH_REQUIRED');
      assert.deepEqual(error.details.groups.map(g => [g.code, g.profiles.length]), [['NO_SEARCH', 4]]);
      return true;
    });
    const isolated = await service.fullSearch(owner, source.ids.slice(1, 3));
    assert.deepEqual(isolated.profiles.map(row => row.state), ['NO_GENOTYPE', 'NO_GENOTYPE']);
    const onlyEmpty = await service.approvalPreview(owner, source.ids.slice(1, 3));
    assert(onlyEmpty.profiles.every(row => row.withoutGenotype));
    await service.fullSearch(owner, [source.ids[0], partialId]);
    await assert.rejects(service.approvalPreview(owner, source.ids), error => {
      assert.deepEqual(error.details.groups.map(g => [g.code, g.profiles.length]), [['SEPARATE_RUNS', 4]]);
      return true;
    });
    const checked = await service.fullSearch(owner, source.ids);
    const preview = await service.approvalPreview(owner, source.ids);
    assert.equal(preview.searchRunId, checked.id);
    assert.equal(preview.profiles.filter(row => row.withoutGenotype).length, 2);
    assert.equal(checked.profiles.find(row => row.profileId === partialId).state, 'INSUFFICIENT_DATA');
    assert.equal(preview.profiles.find(row => row.id === partialId).belowSearchThreshold, true);
    assert.equal((await service.list(owner, { table: true })).profiles.filter(row => row.readyForMasterApproval).length, 4);
    const request = await service.submitApproval(owner, source.ids, checked.id, {}, randomUUID());
    await assert.rejects(service.approvalPreview(owner, source.ids), error =>
      error.code === 'APPROVAL_BLOCKED' && error.details.groups.some(g => g.code === 'PENDING' && g.profiles.length === 4));
    const detail = await service.approvalDetail(reviewer, request.id);
    assert.equal(detail.requiresSearch, false);
    assert.equal(detail.profiles.filter(row => row.withoutGenotype).length, 2);
    assert.equal(detail.profiles.find(row => row.id === partialId).belowSearchThreshold, true);
    assert.equal((await service.decideApproval(reviewer, request.id, 'approve', detail.reviewToken)).count, 4);

    const { rows } = await pool.query('SELECT * FROM master_array_profiles WHERE source_workspace_profile_id=ANY($1::uuid[])', [source.ids]);
    const byId = new Map(rows.map(row => [row.source_workspace_profile_id, row]));
    assert.deepEqual(byId.get(source.ids[1]).str_data, {});
    assert.deepEqual(byId.get(source.ids[2]).str_data, empty);
    const { prepareMasterExport } = require('../src/services/converters/masterArrayExcelExportService');
    assert.deepEqual(byId.get(partialId).str_data, partial);
    const exported = prepareMasterExport(rows, FORMAT);
    assert.equal(exported.summary.exportable, 4);
    assert.deepEqual(exported.profiles.find(row => row.objectNumber === 'SYN-APP-PARTIAL').strData, partial);

    const next = await service.fullSearch(owner, source.ids);
    assert(!next.master.results.some(group => [source.ids[1], source.ids[2]].includes(group.reference.id)));
    const emptyMasterIds = new Set(source.ids.slice(1, 3).map(id => byId.get(id).id));
    assert(next.master.results.every(group => group.matches.every(match => !emptyMasterIds.has(match.id) && match.id !== byId.get(partialId).id)));
    await service.patch(owner, source.ids[0], { strData: {} });
    await assert.rejects(service.approvalPreview(owner, source.ids), error =>
      error.details.groups.some(g => g.code === 'WORKSPACE_CHANGED' && g.profiles.length === 4));
    await service.fullSearch(owner, source.ids);
    await assert.rejects(service.approvalPreview(owner, source.ids), error =>
      error.details.groups.some(g => g.code === 'EMPTY_REPLACEMENT' && g.profiles[0].profileId === source.ids[0]));
    const staff = await load(admin, [profile('83629-G', 'staff', partial)]);
    const staffRun = await service.fullSearch(admin, staff.ids);
    assert.equal(staffRun.profiles[0].state, 'INSUFFICIENT_DATA');
    await assert.rejects(service.publish(admin, staff.ids, staffRun.id), error => error.code === 'FULL_SEARCH_REQUIRED');
  });

  await t.test('Откат заявки атомарно снимает новые записи и восстанавливает прежние версии', async () => {
    const first = await user('user_analyst'), second = await user('user_analyst'), leader = await user('department_head');
    const base = await load(first, [profile('SYN-UNDO-EXISTING')]);
    const baseRun = await service.fullSearch(first, base.ids);
    const original = await approve(first, base.ids, baseRun.id);
    const masterId = (await pool.query('SELECT target_id FROM workspace_master_approval_items WHERE approval_id=$1', [original.id])).rows[0].target_id;
    const record = async () => (await pool.query('SELECT to_jsonb(p) AS value FROM master_array_profiles p WHERE id=$1', [masterId])).rows[0].value;
    const previous = await record();
    const update = await load(second, [profile('SYN-UNDO-EXISTING', 'ug', { ...data, TH01: ['7', '9'] }), profile('SYN-UNDO-NEW')]);
    const updateRun = await service.fullSearch(second, update.ids);
    const publication = await approve(second, update.ids, updateRun.id, { [update.ids[0]]: masterId });
    assert.notDeepEqual(await record(), previous);

    const earlier = await service.masterRollbackPreview(admin, original.id);
    assert.deepEqual(earlier.groups.map(group => group.code), ['CHANGED']);
    await assert.rejects(service.masterRollbackPreview(second, publication.id), error => error.status === 403);
    await assert.rejects(service.masterRollbackPreview(reviewer, publication.id), error => error.status === 403);
    await assert.rejects(service.masterRollbackPreview(leader, publication.id), error => error.status === 403);
    await assert.rejects(service.masterRollbackPreview(foreign, publication.id), error => error.status === 404);
    await pool.query('UPDATE users SET can_approve_master=true WHERE id=$1', [leader.id]);
    assert((await service.masterPublicationList(leader, 1)).requests.some(row => row.id === publication.id));
    const plan = await service.masterRollbackPreview(leader, publication.id);
    assert.deepEqual([plan.removed, plan.restored, plan.groups.length], [1, 1, 0]);
    await assert.rejects(service.rollbackMasterApproval(leader, publication.id, '0'.repeat(64), 'SYN stale'), error => error.code === 'REVIEW_STALE');
    assert.equal((await service.masterRollbackPreview(admin, publication.id)).state, 'approved');
    const revision = async () => BigInt((await pool.query(
      'SELECT master_revision FROM workspace_reference_versions WHERE organization_id=$1', [org])).rows[0].master_revision);
    const beforeRollback = await revision();
    const completed = await service.rollbackMasterApproval(leader, publication.id, plan.reviewToken, 'SYN повторный анализ');
    assert.equal(completed.state, 'rolled_back');
    assert.deepEqual([completed.receipt.removed, completed.receipt.restored], [1, 1]);
    assert.equal(await revision(), beforeRollback + 1n);
    assert.deepEqual(await record(), previous);
    assert.equal((await pool.query("SELECT is_active FROM master_array_profiles WHERE source_workspace_profile_id=$1", [update.ids[1]])).rows[0].is_active, false);
    assert.equal((await service.list(second)).profiles.filter(row => row.approvalState === 'rolled_back' && row.state === 'ROLLED_BACK').length, 2);
    assert.equal((await service.ownApprovalHistory(second)).requests[0].state, 'rolled_back');
    assert.equal((await service.approvalDetail(second, publication.id)).rollback.reason, 'SYN повторный анализ');
    assert.equal((await service.rollbackMasterApproval(leader, publication.id, plan.reviewToken, 'SYN повтор')).replayed, true);
    assert.equal(await revision(), beforeRollback + 1n);
    assert.equal((await service.masterRollbackPreview(admin, original.id)).removed, 1);

    async function approve(owner, ids, run, targets = {}) {
      const request = await service.submitApproval(owner, ids, run, targets, randomUUID());
      const detail = await service.approvalDetail(reviewer, request.id);
      await service.decideApproval(reviewer, request.id, 'approve', detail.reviewToken);
      return request;
    }
  });

  await t.test('Тайм-аут в последнем пакете отменяет весь откат, повтор по тому же плану проходит', async () => {
    const owner = await user('user_analyst');
    const batchSize = 250;
    const size = batchSize + 1;
    const source = await load(owner, Array.from({ length: size }, (_, i) =>
      profile('SYN-BATCH-UNDO-' + i, 'ug', { TH01: ['6', '9'] })));
    const search = await service.fullSearch(owner, source.ids);
    const request = await service.submitApproval(owner, source.ids, search.id, {}, randomUUID());
    const detail = await service.approvalDetail(reviewer, request.id);
    await service.decideApproval(reviewer, request.id, 'approve', detail.reviewToken);
    const plan = await service.masterRollbackPreview(admin, request.id);
    assert.equal(plan.removed, size);

    const snapshot = async () => (await pool.query(`
      SELECT (SELECT count(*)::int FROM master_array_profiles WHERE is_active AND source_workspace_profile_id=ANY($1::uuid[])) active,
        (SELECT master_revision FROM workspace_reference_versions WHERE organization_id=$2) revision,
        EXISTS (SELECT 1 FROM workspace_master_rollbacks WHERE approval_id=$3) recorded`,
    [source.ids, org, request.id])).rows[0];
    const before = await snapshot();
    const lastProfileId = plan.profiles.at(-1).profileId;
    const installTestTimeout = failOnLast => pool.query(`CREATE OR REPLACE FUNCTION synthetic_timeout_rollback_batch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT count(*) FROM rollback_batch_rows) > ${batchSize} OR (
          ${failOnLast} AND EXISTS (SELECT 1 FROM rollback_batch_rows WHERE source_workspace_profile_id='${lastProfileId}')
        ) THEN
          RAISE EXCEPTION 'synthetic rollback timeout' USING ERRCODE='57014';
        END IF;
        RETURN NULL;
      END $$`);
    await installTestTimeout(true);
    await pool.query(`CREATE TRIGGER synthetic_timeout_rollback_batch AFTER UPDATE ON master_array_profiles
      REFERENCING NEW TABLE AS rollback_batch_rows FOR EACH STATEMENT
      EXECUTE FUNCTION synthetic_timeout_rollback_batch()`);
    try {
      await assert.rejects(service.rollbackMasterApproval(admin, request.id, plan.reviewToken, 'SYN first try'),
        error => error.status === 503 && error.code === 'MASTER_ROLLBACK_TIMEOUT');
      assert.deepEqual(await snapshot(), before);
      await installTestTimeout(false);
      const completed = await service.rollbackMasterApproval(admin, request.id, plan.reviewToken, 'SYN retry');
      assert.equal(completed.receipt.removed, size);
      assert.deepEqual(await snapshot(), { active: 0, revision: String(BigInt(before.revision) + 1n), recorded: true });
    } finally {
      await pool.query('DROP TRIGGER synthetic_timeout_rollback_batch ON master_array_profiles');
      await pool.query('DROP FUNCTION synthetic_timeout_rollback_batch()');
    }
  });

  await t.test('Старый импорт без журнала можно снять с публикации после сверки, замена требует прежнюю версию', async () => {
    const owner = await user('user_analyst');
    const original = await load(owner, [profile('SYN-UNDO-LEGACY')]);
    async function publishWithoutJournal() {
      const run = await service.fullSearch(owner, original.ids);
      const request = await service.submitApproval(owner, original.ids, run.id, {}, randomUUID());
      const detail = await service.approvalDetail(reviewer, request.id);
      await service.decideApproval(reviewer, request.id, 'approve', detail.reviewToken);
      await pool.query(`DELETE FROM workspace_master_publication_versions v USING workspace_master_approval_items i
        WHERE i.approval_id=$1 AND i.publication_id=v.publication_id`, [request.id]);
      return request.id;
    }
    const originalId = await publishWithoutJournal();
    assert.equal((await service.masterRollbackPreview(admin, originalId)).removed, 1);
    const next = await publishWithoutJournal();
    const plan = await service.masterRollbackPreview(admin, next);
    assert.deepEqual(plan.groups.map(group => group.code), ['NO_PREVIOUS_VERSION']);
    await assert.rejects(service.rollbackMasterApproval(admin, next, '0'.repeat(64), 'SYN'), error => error.code === 'APPROVAL_ROLLBACK_BLOCKED');
    assert.equal((await service.masterRollbackPreview(admin, originalId)).groups[0].code, 'CHANGED');
  });

  await t.test('Два подтверждения: выбранные 2/3, неизменная дата поиска, область заявки и история', async()=>{
    const owner=await user('user_analyst');
    const source=await load(owner,[profile('SYN-APP-1'),profile('SYN-APP-2'),profile('SYN-APP-3')]);
    const checked=await service.fullSearch(owner,source.ids,{});
    await pool.query("UPDATE workspace_search_runs SET completed_at='2026-11-10T14:40:00Z' WHERE id=$1",[checked.id]);
    const chosen=source.ids.slice(0,2), preview=await service.approvalPreview(owner,chosen);
    assert.equal(preview.searchRunId,checked.id);
    const request=await service.submitApproval(owner,chosen,checked.id,{},randomUUID());
    await pool.query("UPDATE workspace_master_approvals SET submitted_at='2026-11-11T06:15:00Z' WHERE id=$1",[request.id]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE source_workspace_profile_id=ANY($1::uuid[])',[source.ids])).rows[0].n,0);
    const next=await service.fullSearch(owner,source.ids,{});
    assert.notEqual(next.id,checked.id);
    const detail=await service.approvalDetail(reviewer,request.id);
    assert.deepEqual(new Set(detail.profiles.map(p=>p.id)),new Set(chosen));
    assert.equal(new Date(detail.analysisCompletedAt).toISOString(),'2026-11-10T14:40:00.000Z');
    assert.equal(new Date(detail.submittedAt).toISOString(),'2026-11-11T06:15:00.000Z');
    assert.equal(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(detail.analysisCompletedAt),'17:40');
    assert(!JSON.stringify(detail).includes(source.ids[2]));
    await assert.rejects(service.search(reviewer,checked.id),e=>e.status===404);
    await assert.rejects(service.publish(owner,chosen,checked.id),e=>e.status===403||e.code==='MASTER_APPROVAL_REQUIRED');
    const approved=await service.decideApproval(reviewer,request.id,'approve',detail.reviewToken);
    assert.equal(approved.state,'approved');
    const history=await service.approvalDetail(owner,request.id);
    assert.equal(history.authorId,owner.id);assert(history.deciderName);assert(history.decidedAt);
    assert.equal((await service.list(owner)).profiles.filter(p=>p.state==='PUBLISHED').length,2);
    assert.equal((await service.submitApproval(owner,chosen,checked.id,{},(await pool.query('SELECT submission_key FROM workspace_master_approvals WHERE id=$1',[request.id])).rows[0].submission_key)).replayed,true);
  });
  await t.test('Допуск персональный: администратор, свой автор, чужая организация и отзыв открытого права',async()=>{
    const owner=await user('user_analyst'),source=await load(owner,[profile('SYN-PERM-1')]);
    const checked=await service.fullSearch(owner,source.ids),request=await service.submitApproval(owner,source.ids,checked.id,{},randomUUID());
    const detail=await service.approvalDetail(reviewer,request.id);
    await assert.rejects(service.approvalList(admin),e=>e.status===403);
    await assert.rejects(service.decideApproval(admin,request.id,'approve',detail.reviewToken),e=>e.status===403);
    await pool.query('UPDATE users SET can_approve_master=true WHERE id=$1',[owner.id]);
    await assert.rejects(service.decideApproval(owner,request.id,'approve',detail.reviewToken),e=>e.code==='SELF_APPROVAL_FORBIDDEN');
    await assert.rejects(service.approvalDetail(foreign,request.id),e=>e.status===404);
    await pool.query('UPDATE users SET can_approve_master=false WHERE id=$1',[reviewer.id]);
    await assert.rejects(service.approvalList(reviewer),e=>e.status===403);
    await assert.rejects(service.decideApproval(reviewer,request.id,'approve',detail.reviewToken),e=>e.status===403);
    await pool.query('UPDATE users SET can_approve_master=true WHERE id=$1',[reviewer.id]);
    await service.decideApproval(reviewer,request.id,'return',detail.reviewToken,'Проверьте исходные данные');
    assert.equal((await service.list(owner)).profiles[0].decisionComment,'Проверьте исходные данные');
    const newRun=await service.fullSearch(owner,source.ids),again=await service.submitApproval(owner,source.ids,newRun.id,{},randomUUID());
    assert.notEqual(again.id,request.id);
  });
  await t.test('Комментарий не сбрасывает поиск, но защищает от решения из устаревшего окна',async()=>{
    const owner=await user('user_analyst'),source=await load(owner,[profile('SYN-TEXT-1')]);
    const checked=await service.fullSearch(owner,source.ids),request=await service.submitApproval(owner,source.ids,checked.id,{},randomUUID());
    const before=await service.approvalDetail(reviewer,request.id);
    await service.patch(owner,source.ids[0],{comment:'SYN актуальный текст'});
    await assert.rejects(service.decideApproval(reviewer,request.id,'approve',before.reviewToken),e=>e.code==='REVIEW_STALE');
    const current=await service.approvalDetail(reviewer,request.id);
    assert.equal(current.requiresSearch,false);assert.equal(current.profiles[0].comment,'SYN актуальный текст');
    await service.decideApproval(reviewer,request.id,'approve',current.reviewToken);
    const published=(await pool.query('SELECT comment FROM master_array_profiles WHERE source_workspace_profile_id=$1',[source.ids[0]])).rows[0];
    assert.equal(published.comment,'SYN актуальный текст');
    const accepted=await service.approvalDetail(owner,request.id);
    assert.equal(accepted.profiles[0].comment,'SYN актуальный текст');
    await service.patch(owner,source.ids[0],{comment:'SYN после решения'});
    await service.decideApproval(reviewer,request.id,'approve',current.reviewToken);
    assert.equal((await service.approvalDetail(owner,request.id)).profiles[0].comment,'SYN актуальный текст');
    assert.equal((await pool.query('SELECT comment FROM master_array_profiles WHERE source_workspace_profile_id=$1',[source.ids[0]])).rows[0].comment,'SYN актуальный текст');
    const currentRun=await service.fullSearch(owner,source.ids);
    for(const text of ['SYN отдельное согласование текста 1','SYN отдельное согласование текста 2']) {
      await service.patch(owner,source.ids[0],{comment:text});
      const r=await service.submitApproval(owner,source.ids,currentRun.id,{},randomUUID());
      const view=await service.approvalDetail(reviewer,r.id);
      assert.equal(view.requiresSearch,false);
      await service.decideApproval(reviewer,r.id,'approve',view.reviewToken);
      assert.equal((await pool.query('SELECT comment FROM master_array_profiles WHERE source_workspace_profile_id=$1',[source.ids[0]])).rows[0].comment,text);
    }

  });
  await t.test('Генотип, удаление, отменённый поиск и смена параметров не проходят согласование',async()=>{
    for(const mutation of ['genotype','remove','cancelled','parameters']) {
      const owner=await user('user_analyst'),source=await load(owner,[profile('SYN-STALE-'+mutation)]);
      const checked=await service.fullSearch(owner,source.ids),request=await service.submitApproval(owner,source.ids,checked.id,{},randomUUID());
      if(mutation==='genotype') await service.patch(owner,source.ids[0],{strData:{...data,TH01:['7','9']}});
      if(mutation==='remove') await service.remove(owner,source.ids);
      if(mutation==='cancelled') await pool.query("UPDATE workspace_search_runs SET state='cancelled',completed_at=now() WHERE id=$1",[checked.id]);
      if(mutation==='parameters') await service.configureSearch(owner,{minMatches:14});
      const detail=await service.approvalDetail(reviewer,request.id);
      assert.equal(detail.requiresSearch,true,mutation);
      if(mutation==='cancelled') assert.equal(detail.analysisCompletedAt,null);
      await assert.rejects(service.decideApproval(reviewer,request.id,'approve',detail.reviewToken),e=>e.code==='FULL_SEARCH_REQUIRED');
      await service.decideApproval(reviewer,request.id,'return',detail.reviewToken,'SYN исправить');
      if(mutation==='genotype') {
        const rerun=await service.fullSearch(owner,source.ids),resub=await service.submitApproval(owner,source.ids,rerun.id,{},randomUUID());
        assert.equal(resub.state,'pending');
      }
    }
  });
  await t.test('Два одновременных утверждающих дают один исход без повторной записи',async()=>{
    const owner=await user('user_analyst'),second=await user('user_analyst');
    await pool.query('UPDATE users SET can_approve_master=true WHERE id=$1',[second.id]);
    const source=await load(owner,[profile('SYN-CONCURRENT-A'),profile('SYN-CONCURRENT-B')]);
    const checked=await service.fullSearch(owner,source.ids),key=randomUUID();
    const requests=await Promise.all([service.submitApproval(owner,source.ids,checked.id,{},key),service.submitApproval(owner,source.ids,checked.id,{},key)]);
    assert.equal(requests[0].id,requests[1].id);
    await assert.rejects(service.submitApproval(owner,[source.ids[0]],checked.id,{},key),e=>e.status===409);
    await assert.rejects(service.submitApproval(owner,source.ids,checked.id,{},randomUUID()),e=>e.code==='APPROVAL_PENDING');
    const d=await service.approvalDetail(reviewer,requests[0].id);
    const result=await Promise.all([service.decideApproval(reviewer,d.id,'approve',d.reviewToken),service.decideApproval(second,d.id,'approve',d.reviewToken)]);
    assert(result.every(r=>r.state==='approved'));assert.equal(result.filter(r=>r.replayed).length,1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE source_workspace_profile_id=ANY($1::uuid[])',[source.ids])).rows[0].n,2);
    assert.equal((await pool.query('SELECT count(*)::int n FROM workspace_publications WHERE master_approval_id=$1',[d.id])).rows[0].n,2);
  });
  await t.test('Ошибка записи второй строки откатывает весь пакет и решение; повтор после исправления работает',async()=>{
    const owner=await user('user_analyst'),source=await load(owner,[profile('SYN-ROLLBACK-A'),profile('SYN-ROLLBACK-B')]);
    const checked=await service.fullSearch(owner,source.ids),request=await service.submitApproval(owner,source.ids,checked.id,{},randomUUID());
    const d=await service.approvalDetail(reviewer,request.id);
    // Inject failure into the last row in the actual stable publication order.
    const last=d.profiles[d.profiles.length-1].objectNumber;
    await pool.query(`CREATE OR REPLACE FUNCTION synthetic_approval_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.internal_number='${last}' THEN RAISE EXCEPTION 'SYN_SECOND_ROW_FAILURE'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER synthetic_approval_fail BEFORE INSERT ON master_array_profiles FOR EACH ROW EXECUTE FUNCTION synthetic_approval_fail()');
    try {await assert.rejects(service.decideApproval(reviewer,d.id,'approve',d.reviewToken),/SYN_SECOND_ROW_FAILURE/);}finally{await pool.query('DROP TRIGGER synthetic_approval_fail ON master_array_profiles');await pool.query('DROP FUNCTION synthetic_approval_fail()');}
    assert.equal((await pool.query('SELECT state FROM workspace_master_approvals WHERE id=$1',[d.id])).rows[0].state,'pending');
    assert.equal((await pool.query('SELECT count(*)::int n FROM workspace_publications WHERE master_approval_id=$1',[d.id])).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM master_array_profiles WHERE source_workspace_profile_id=ANY($1::uuid[])',[source.ids])).rows[0].n,0);
    const fresh=await service.approvalDetail(reviewer,d.id);await service.decideApproval(reviewer,d.id,'approve',fresh.reviewToken);
  });

  await t.test('ЧС: обязательный номер только из Excel, сохранение в БД, списке, PATCH и повторном импорте', async () => {
    const number = '000123/А';
    const d = await service.createDraft(analyst, [file([{ ...profile('SYN-CHS-NUMBER', 'chs'), assignedNumber: number }])]);
    assert.equal(d.rows[0].assignedNumber, number);
    assert.equal((await service.validateDraft(analyst, d.id, d.revision)).valid, true);
    await assert.rejects(service.patchDraft(analyst, d.id, d.revision, [{ draftRowId: d.rows[0].draftRowId, assignedNumber: 'forged' }]), /Неизвестное поле/);
    const committed = await service.commitDraft(analyst, d.id, d.revision, randomUUID());
    const id = committed.ids[0];
    assert.equal((await service.list(analyst)).profiles.find(row => row.id === id).assignedNumber, number);
    await assert.rejects(service.patch(analyst, id, { assignedNumber: 'forged' }), /Неизвестное поле/);
    const before = (await pool.query('SELECT str_data,analysis_revision FROM dna_profiles WHERE id=$1', [id])).rows[0];
    await service.patch(analyst, id, { comment: 'SYN updated' });
    const stored = (await pool.query('SELECT * FROM dna_profiles WHERE id=$1', [id])).rows[0];
    assert.equal(stored.sample_name, number); assert.equal(stored.provenance.assignedNumber, number);
    assert.deepEqual(stored.str_data, before.str_data); assert.equal(stored.analysis_revision, before.analysis_revision);
    const exported = await service.exportProfiles(analyst, [id]);
    const again = await service.createDraft(analyst, [{ originalname: 'SYN.xlsx', buffer: exported }]);
    assert.equal(again.rows[0].assignedNumber, number);
    assert.equal((await service.validateDraft(analyst, again.id, again.revision)).valid, true);
    const missing = await service.createDraft(analyst, [file([profile('SYN-CHS-MISSING', 'chs')])]);
    assert((await service.validateDraft(analyst, missing.id, missing.revision)).errors.some(row => row.issues.some(issue => issue.code === 'ASSIGNED_NUMBER_REQUIRED')));
    await assert.rejects(service.commitDraft(analyst, missing.id, missing.revision, randomUUID()), error => error.code === 'VALIDATION_FAILED');
    const raw = await service.createDraft(analyst, [file([profile('SYN-CHANGE-TO-CHS')])]);
    const rawCommit = await service.commitDraft(analyst, raw.id, raw.revision, randomUUID());
    await assert.rejects(service.patch(analyst, rawCommit.ids[0], { expertiseType: 'chs' }), error => error.details?.some(issue => issue.code === 'ASSIGNED_NUMBER_REQUIRED'));
    // Наличие новой проверки не лишает доступа к старому ЧС с сохранёнными исходными колонками.
    await pool.query('UPDATE dna_profiles SET provenance=$1 WHERE id=$2', [JSON.stringify({ legacyCells: { [require('../src/utils/emergencyAssignedNumber').ASSIGNED_HEADER]: number } }), id]);
    assert.equal((await service.list(analyst)).profiles.find(row => row.id === id).assignedNumber, number);
  });


  await t.test('Черновик реестра ЧС: восстановление известных служебных колонок не меняет payload и пользовательские правки', async () => {
    const source = await service.createDraft(analyst, [file([{...profile('SYN-REGISTRY-METADATA','chs'),assignedNumber:'000123'}])]);
    const {unseal,seal}=require('../src/services/workspace/workspaceCrypto');
    const payload=unseal((await pool.query('SELECT encrypted_payload FROM workspace_import_drafts WHERE id=$1',[source.id])).rows[0].encrypted_payload);
    payload.rows[0].comment='SYN ручная правка';
    payload.rows[0].provenance.legacyColumns=[{header:'RT (Small)',value:'0.123'},{header:'№ постановления',value:'SYN-registry'}];
    payload.rows[0].sourceIssues=payload.rows[0].provenance.legacyColumns.map(column=>({code:'UNKNOWN_COLUMN',message:'Неизвестный столбец «'+column.header+'» с данными. Сопоставьте его в конвертере.'}));
    const encrypted=seal(payload);await pool.query('UPDATE workspace_import_drafts SET encrypted_payload=$1 WHERE id=$2',[encrypted,source.id]);
    const restored=await service.draft(analyst,source.id);
    assert.deepEqual(restored.rows[0].sourceIssues,[]);assert.equal(restored.rows[0].comment,'SYN ручная правка');assert.deepEqual(restored.rows[0].strData,payload.rows[0].strData);
    assert.equal((await pool.query('SELECT encrypted_payload FROM workspace_import_drafts WHERE id=$1',[source.id])).rows[0].encrypted_payload,encrypted);
    assert.equal((await service.validateDraft(analyst,source.id,source.revision)).valid,true);
    const committed=await service.commitDraft(analyst,source.id,source.revision,randomUUID());
    const saved=(await pool.query('SELECT comment,provenance,str_data FROM dna_profiles WHERE id=$1',[committed.ids[0]])).rows[0];
    assert.equal(saved.comment,'SYN ручная правка');assert.deepEqual(saved.provenance.legacyColumns,payload.rows[0].provenance.legacyColumns);assert.deepEqual(saved.str_data,payload.rows[0].strData);
  });


  await t.test('Неполный профиль со звёздочками не становится контаминацией по одному RS; старые версии требуют пересчёта',async()=>{
    const actor=await user('user_analyst'),controlData={...data,rs199815934:['1']};
    const control=await load(admin,[{...profile('987654-G','staff',controlData),fullName:'SYN положительный контроль'}]);
    const controlRun=await service.fullSearch(admin,control.ids);
    const published=await service.publish(admin,control.ids,controlRun.id);
    const staffId=published.published[0].publishedId;
    const sparse={...Object.fromEntries(Object.keys(data).map(locus=>[locus,['*']])),rs199815934:['1']};
    const working=await load(actor,[profile('SYN-SPARSE-RS','ug',sparse),profile('SYN-REAL-CONTROL','ug',controlData)]);
    await service.configureSearch(actor,{minMatches:12,staffOptions:{useV4Algorithm:true,useV5Algorithm:false,threshold:5.5,minLociMatch:8}});
    const before=(await pool.query('SELECT id,str_data FROM dna_profiles WHERE id=ANY($1::uuid[]) ORDER BY id',[working.ids])).rows;
    const result=await service.fullSearch(actor,working.ids);
    assert.equal(result.staff.find(group=>group.profileId===working.ids[0]).matches.length,0);
    assert.equal(result.profiles.find(row=>row.profileId===working.ids[0]).state,'INSUFFICIENT_DATA');
    const current=await service.list(actor);
    assert.equal(current.profiles.find(row=>row.id===working.ids[0]).searchState,'INSUFFICIENT_DATA');
    assert(result.staff.find(group=>group.profileId===working.ids[1]).matches.some(match=>match.staffId===staffId));
    assert.deepEqual((await pool.query('SELECT id,str_data FROM dna_profiles WHERE id=ANY($1::uuid[]) ORDER BY id',[working.ids])).rows,before);
    assert.equal((await service.search(actor,result.id)).outdated,false);
    await pool.query("UPDATE workspace_search_runs SET algorithm_version='existing-task-comparison+staff-v5/workspace-1' WHERE id=$1",[result.id]);
    const old=await service.search(actor,result.id);
    assert.equal(old.outdated,true);
    const stale=await service.list(actor);
    for (const id of working.ids) assert.equal(stale.profiles.find(row=>row.id===id).searchState,'STALE');
    await assert.rejects(new (require('../src/services/audit/staffContaminationExcelExportService').StaffContaminationExcelExportService)().createWorkbookBuffer({result:old}),error=>error.status===409);
    await assert.rejects(service.search(other,result.id),error=>error.status===404);
  });


  await t.test('Дубликаты v5: неизвестные локусы не проходят порог совпадения; полные пары находятся внутри и в мастер-массиве',async()=>{
    const homo=Object.fromEntries(Object.keys(data).map(locus=>[locus,['12','12']]));
    const author=await user('user_analyst'),masterSource=await load(author,[profile('SYN-CERTAIN-MASTER','ug',homo)]);
    const masterRun=await service.fullSearch(author,masterSource.ids),published=await publishReady(author,masterSource.ids,masterRun.id);
    const masterId=published.published[0].publishedId;
    const actor=await user('user_analyst'),uncertain=Object.fromEntries(Object.keys(data).map(locus=>[locus,['12','*']]));
    const source=await load(actor,[profile('SYN-CERTAIN-1','ug',homo),profile('SYN-CERTAIN-2','ug',homo),profile('SYN-UNCERTAIN','ug',uncertain),profile('SYN-NO-CALL','ug',Object.fromEntries(Object.keys(data).map(locus=>[locus,['*']])))]);
    await service.configureSearch(actor,{comparisonAlgorithm:'duplicate_v5',minMatches:15,duplicateSettings:{minLoci:15,minScore:15,minPercentage:80},staffOptions:{}});
    const before=(await pool.query('SELECT id,str_data FROM dna_profiles WHERE id=ANY($1::uuid[]) ORDER BY id',[source.ids])).rows;
    const result=await service.fullSearch(actor,source.ids);
    assert.deepEqual(new Set(result.internal.results.map(group=>group.reference.id)),new Set(source.ids.slice(0,2)));
    for(const group of result.internal.results)assert(group.matches.every(match=>source.ids.slice(0,2).includes(match.id)));
    assert(result.master.results.filter(group=>source.ids.slice(0,2).includes(group.reference.id)).every(group=>group.matches.some(match=>match.id===masterId)));
    assert(!result.master.results.some(group=>source.ids.slice(2).includes(group.reference.id)));
    assert.equal(result.profiles.find(p=>p.profileId===source.ids[2]).state,'INSUFFICIENT_DATA');
    assert.equal(result.profiles.find(p=>p.profileId===source.ids[3]).state,'NO_GENOTYPE');
    assert.equal((await service.approvalPreview(actor, [source.ids[2]])).profiles[0].belowSearchThreshold, true);
    assert.deepEqual((await pool.query('SELECT id,str_data FROM dna_profiles WHERE id=ANY($1::uuid[]) ORDER BY id',[source.ids])).rows,before);
  });

});
