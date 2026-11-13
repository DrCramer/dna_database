const test = require('node:test'),
  assert = require('node:assert/strict'),
  {
    randomUUID
  } = require('node:crypto'),
  XLSX = require('xlsx'),
  JSZip = require('jszip');
const url = process.env.WORKSPACE_TEST_DATABASE_URL;
test('Миграционный экспорт: вся выборка, nullable-фильтры, все аллели, ZIP частей и организация', {
  skip: !url
}, async t => {
  assert.match(new URL(url).pathname, /^\/dna_workspace_test(?:_|$)/);
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  const interval = global.setInterval;
  global.setInterval = (...args) => interval(...args).unref();
  const {
    pool
  } = require('../src/config/database');
  const {
    LegacyMigrationExportService
  } = require('../src/services/converters/legacyMigrationExportService');
  const {
    parseFiles
  } = require('../src/services/workspace/importSourceService');
  t.after(() => pool.end());
  const org = (await pool.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', ['SYN-export-' + randomUUID()])).rows[0].id;
  const dept = (await pool.query("INSERT INTO departments(name,organization_id) VALUES('Старое отделение',$1) RETURNING id", [org])).rows[0].id;
  const id = randomUUID();
  await pool.query("INSERT INTO users(id,username,password_hash,role,organization_id,department_id) VALUES($1,$2,'synthetic','admin',$3,$4)", [id, 'SYN-' + id, org, dept]);
  const user = {
      id,
      role: 'admin',
      organization_id: org
    },
    service = new LegacyMigrationExportService(pool),
    loci = {
      TH01: ['7'],
      D5S818: ['11', '11'],
      D21S11: ['30', '?', '*', '32.2'],
      DYS391: ['10', '10'],
      SRY: ['SRY']
    };
  const fixture = await pool.connect();
  await fixture.query('BEGIN');
  await fixture.query('SELECT * FROM workspace_configuration WHERE id=true FOR UPDATE');
  await fixture.query('UPDATE workspace_configuration SET enabled=false');
  await fixture.query(`INSERT INTO dna_profiles(user_id,year,sample_name,internal_number,str_data,import_format,organization_id,department_id,notes)
 SELECT $1,2026,'SYN', 'EXPORT-'||n,$2,'genetic',$3,$4,'legacy notes' FROM generate_series(1,10003) n`, [id, JSON.stringify(loci), org, dept]);
  await fixture.query("INSERT INTO dna_profiles(user_id,year,sample_name,internal_number,str_data,import_format,organization_id) VALUES($1,2026,'SYN','EMPTY','{}','emergency',$2)", [id, org]);
  await fixture.query("INSERT INTO dna_profiles(user_id,sample_name,internal_number,str_data,import_format,organization_id,department_id) VALUES($1,'SYN','EMPTY-NO-YEAR','{}','genetic',$2,$3)", [id, org, dept]);
  await fixture.query('UPDATE workspace_configuration SET enabled=true');
  await fixture.query('COMMIT');
  fixture.release();
  const filters = {
    sources: ['user'],
    years: [2026, null],
    departments: [dept, null],
    types: [null],
    includeEmpty: true,
    includeInactive: false
  };
  await t.test('Фасеты содержат реальные количества и отдельное отсутствие года/отдела/категории', async () => {
    const options = await service.options(user);
    assert.equal(options.groups.reduce((sum, g) => sum + g.count, 0), 10005);
    assert(options.groups.some(g => g.year === null));
    assert(options.groups.some(g => g.department_id === null));
    await assert.rejects(service.options({
      ...user,
      role: 'department_head'
    }), /администратора/);
  });
  await t.test('Пустой выбор не становится экспортом всего; фильтры групп объединяются AND', async () => {
    assert.equal((await service.inspect(user, {
      ...filters,
      years: []
    })).total, 0);
    assert.equal((await service.inspect(user, {
      ...filters,
      departments: []
    })).total, 0);
    assert.equal((await service.inspect(user, {
      ...filters,
      years: [null],
      departments: [null]
    })).total, 0);
    assert.equal((await service.inspect(user, {
      ...filters,
      includeEmpty: false
    })).total, 10003);
    assert.equal((await service.inspect({
      ...user,
      organization_id: randomUUID()
    }, filters)).total, 0);
  });
  await t.test('10005 строк полностью выгружаются двумя XLSX; значения и происхождение проходят чтение', async () => {
    const preview = await service.inspect(user, filters),
      before = (await pool.query('SELECT count(*)::int n FROM dna_profiles WHERE organization_id=$1', [org])).rows[0].n;
    const result = await service.inspect(user, {
      ...filters,
      previewFingerprint: preview.fingerprint
    }, true);
    assert.equal(result.stats.total, 10005);
    assert.equal(result.mime, 'application/zip');
    const zip = await JSZip.loadAsync(result.buffer);
    const names = Object.keys(zip.files).filter(n => n.endsWith('.xlsx'));
    assert.equal(names.length, 2);
    let count = 0,
      checked = false;
    for (const name of names) {
      const buffer = await zip.file(name).async('nodebuffer'),
        book = XLSX.read(buffer, {
          type: 'buffer'
        });
      count += XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
        header: 1
      }).length - 1;
      const rows = parseFiles([{
        originalname: name,
        buffer
      }]).rows;
      for (const row of rows) {
        if (!row.objectNumber.startsWith('EMPTY') && !checked) {
          assert.deepEqual(row.strData, loci);
          assert.equal(row.provenance.table, 'dna_profiles');
          assert.equal(row.provenance.legacy.notes, 'legacy notes');
          checked = true;
        }
        if (row.objectNumber.startsWith('EMPTY')) assert.deepEqual(row.strData, {});
      }
    }
    assert.equal(count, 10005);
    assert(checked);
    assert.equal((await pool.query('SELECT count(*)::int n FROM dna_profiles WHERE organization_id=$1', [org])).rows[0].n, before);
  });
  await t.test('Потоковый ZIP не держит все части в памяти и очищает временные файлы при завершении/отмене', async () => {
    const fs = require('node:fs'),
      path = require('node:path');
    const root = path.resolve('runtime/exports');
    const before = fs.existsSync(root) ? fs.readdirSync(root).filter(x => x.startsWith('migration-')) : [];
    const result = await service.inspect(user, filters, true, {
      asStream: true
    });
    assert(result.stream);
    assert.equal(result.buffer, undefined);
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    const zip = await JSZip.loadAsync(Buffer.concat(chunks));
    assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.xlsx')).length, 2);
    await result.cleanup();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(service.inspect(user, filters, true, {
      asStream: true,
      signal: controller.signal
    }), error => error.status === 499);
    assert.deepEqual(fs.readdirSync(root).filter(x => x.startsWith('migration-')).sort(), before.sort());
  });
  await t.test('Общий мастер без старого отдела и legacy master в dna_profiles доступны в своей организации', async () => {
    const client = await pool.connect();
    let array;
    try {
      await client.query('BEGIN');
      await client.query('SELECT * FROM workspace_configuration WHERE id=true FOR UPDATE');
      await client.query('UPDATE workspace_configuration SET enabled=false');
      array = (await client.query("INSERT INTO master_arrays(organization_id,organization_default,name) VALUES($1,true,'SYN Org') RETURNING id", [org])).rows[0].id;
      await client.query("INSERT INTO master_array_profiles(master_array_id,organization_id,year,internal_number,sample_name,str_data,expertise_type,created_by) VALUES($1,$2,2026,'ORG-1','SYN',$3,'ug',$4)", [array, org, JSON.stringify(loci), id]);
      await client.query("INSERT INTO dna_profiles(user_id,organization_id,year,internal_number,sample_name,str_data,profile_type) VALUES($1,$2,2026,'LEGACY-MASTER','SYN',$3,'master')", [id, org, JSON.stringify(loci)]);
      await client.query('UPDATE workspace_configuration SET enabled=true');
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const result = await service.inspect(user, {
      ...filters,
      sources: ['master'],
      years: [2026],
      departments: [null],
      types: ['ug', null]
    }, true, {
      asStream: true
    });
    try {
      assert.equal(result.stats.total, 2);
      const chunks = [];
      for await (const chunk of result.stream) chunks.push(chunk);
      const parsed = parseFiles([{
        originalname: 'master.xlsx',
        buffer: Buffer.concat(chunks)
      }]).rows;
      assert.deepEqual(parsed.map(row => row.objectNumber).sort(), ['LEGACY-MASTER', 'ORG-1']);
      for (const row of parsed) assert.deepEqual(row.strData,loci);
    } finally {
      await result.cleanup();
    }
  });
});
