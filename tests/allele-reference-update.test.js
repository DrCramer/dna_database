const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Проверяем настоящий Bash-скрипт; внешние Git/Docker заменены изолированными
// командами. SQL самой миграции отдельно выполняется интеграционным тестом.
function runUpdate({ changedFiles = '', tablesReady = false, yearIndexReady = false, identityReady = true, probabilityReady = true, refreshReady = true, profileIdentityReady = true, backupFails = false }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-reference-update-'));
  try {
    for (const name of ['scripts', 'config', 'database/migrations', 'bin']) fs.mkdirSync(path.join(directory, name), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../scripts/update_server.sh'), path.join(directory, 'scripts/update_server.sh'));
    fs.copyFileSync(path.join(__dirname, '../database/migrations/031_allele_references.sql'), path.join(directory, 'database/migrations/031_allele_references.sql'));
    fs.copyFileSync(path.join(__dirname, '../database/migrations/032_genetic_profile_year_identity.sql'), path.join(directory, 'database/migrations/032_genetic_profile_year_identity.sql'));
    fs.copyFileSync(path.join(__dirname, '../database/migrations/033_user_display_names.sql'), path.join(directory, 'database/migrations/033_user_display_names.sql'));
    fs.copyFileSync(path.join(__dirname, '../database/migrations/034_probability_calculations.sql'), path.join(directory, 'database/migrations/034_probability_calculations.sql'));
    for(const migration of ['035_session_refresh_tokens.sql','036_profile_identity_scope.sql'])fs.copyFileSync(path.join(__dirname,'../database/migrations',migration),path.join(directory,'database/migrations',migration));
    fs.writeFileSync(path.join(directory, '.env'), '', { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'config/encryption.key'), Buffer.alloc(32), { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'scripts/prepare-runtime.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const stateFile = path.join(directory, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ changedFiles, tablesReady, yearIndexReady, identityReady, probabilityReady, refreshReady, profileIdentityReady, backupFails, events: [] }));
    const shim = `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2), file=process.env.REFERENCE_UPDATE_STATE;
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const command=require('node:path').basename(process.argv[1]);
const record=event=>{state.events.push(event);fs.writeFileSync(file,JSON.stringify(state));};
if(command==='git'){
 if(args[0]==='status')process.exit(0);
 if(args[0]==='rev-parse')console.log('1111111111111111111111111111111111111111');
 else if(args[0]==='diff')process.stdout.write(state.changedFiles);
 else if(args[0]==='pull')record('pull');
 else if(args[0]==='log')console.log('fixture revision');
 else process.exit(2);
}else if(args.includes('pg_dump')){
 record('backup');if(state.backupFails)process.exit(1);console.log('-- isolated backup fixture');
}else if(args.includes('psql')){
 if(args.includes('-c')){const sql=args[args.indexOf('-c')+1]||'';if(sql.includes('refresh_token_hash')){record('check_refresh');console.log(state.refreshReady?'t':'f');}else if(sql.includes('idx_dna_profiles_year_internal_user')){record('check_profile_identity');console.log(state.profileIdentityReady?'t':'f');}else if(sql.includes('probability_calculations')){record('check_probability');console.log(state.probabilityReady?'t':'f');}else if(sql.includes('information_schema.columns')){record('check_identity');console.log(state.identityReady?'t':'f');}else if(sql.includes('pg_indexes')){record('check_year_index');console.log(state.yearIndexReady?'t':'f');}else{record('check_tables');console.log(state.tablesReady?'t':'f');}}
 else{const sql=fs.readFileSync(0,'utf8');if(!sql.includes('CREATE TABLE IF NOT EXISTS allele_reference_sets')&&!sql.includes('CREATE UNIQUE INDEX idx_dna_profiles_genetic_object')&&!sql.includes('ADD COLUMN IF NOT EXISTS display_name')&&!sql.includes('CREATE TABLE IF NOT EXISTS public.probability_calculations')&&!sql.includes('ADD COLUMN IF NOT EXISTS refresh_token_hash')&&!sql.includes('DROP INDEX IF EXISTS public.idx_dna_profiles_year_internal_user'))process.exit(3);if(sql.includes('CREATE TABLE IF NOT EXISTS allele_reference_sets'))state.tablesReady=true;if(sql.includes('CREATE UNIQUE INDEX idx_dna_profiles_genetic_object'))state.yearIndexReady=true;if(sql.includes('ADD COLUMN IF NOT EXISTS refresh_token_hash')){state.refreshReady=true;record('migrate_refresh');}else if(sql.includes('DROP INDEX IF EXISTS public.idx_dna_profiles_year_internal_user')){state.profileIdentityReady=true;record('migrate_profile_identity');}else if(sql.includes('CREATE TABLE IF NOT EXISTS public.probability_calculations')){state.probabilityReady=true;record('migrate_probability');}else if(sql.includes('ADD COLUMN IF NOT EXISTS display_name')){state.identityReady=true;record('migrate_identity');}else record('migrate');}
}else if(args[0]==='inspect'){console.log('healthy');}
else if(args[0]==='compose'&&['version','config','ps'].includes(args[1])){}
else if(args[0]==='compose'&&args[1]==='build')record('build');
else if(args[0]==='compose'&&args[1]==='up')record('start');
else process.exit(4);
`;
    for (const command of ['git', 'docker']) fs.writeFileSync(path.join(directory, 'bin', command), shim, { mode: 0o700 });
    const result = spawnSync('bash', [path.join(directory, 'scripts/update_server.sh')], {
      env: { ...process.env, PATH: path.join(directory, 'bin') + path.delimiter + process.env.PATH, REFERENCE_UPDATE_STATE: stateFile }, encoding: 'utf8', timeout: 10000
    });
    return { ...result, state: JSON.parse(fs.readFileSync(stateFile, 'utf8')), backups: fs.readdirSync(path.join(directory, 'runtime/backups')).map(name => ({ size: fs.statSync(path.join(directory, 'runtime/backups', name)).size, mode: fs.statSync(path.join(directory, 'runtime/backups', name)).mode & 0o777 })) };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('Обновление после отдельного git pull создаёт дамп и применяет недостающую 031 до запуска', () => {
  const result = runUpdate({}); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.state.events, ['backup', 'pull', 'check_year_index', 'migrate', 'check_tables', 'migrate', 'check_identity', 'check_probability', 'check_refresh', 'check_profile_identity', 'build', 'start']);
  assert.equal(result.backups.length, 1); assert(result.backups[0].size > 0); assert.equal(result.backups[0].mode, 0o600);
});
test('Распознанный релиз применяет миграции 031 и 032; повторное обновление сохраняет схему', () => {
  const first = runUpdate({ changedFiles: 'database/schema.sql\ndatabase/migrations/031_allele_references.sql\ndatabase/migrations/032_genetic_profile_year_identity.sql\n' });
  assert.equal(first.status, 0, first.stderr); assert.equal(first.state.events.filter(event => event === 'migrate').length, 2);
  const repeated = runUpdate({ tablesReady: true, yearIndexReady: true }); assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(repeated.state.events, ['backup', 'pull', 'check_year_index', 'check_tables', 'check_identity', 'check_probability', 'check_refresh', 'check_profile_identity', 'build', 'start']);
});
test('Неизвестная миграция останавливает обновление до изменения БД и запуска кода', () => {
  const result = runUpdate({ changedFiles: 'database/schema.sql\ndatabase/migrations/999_unknown.sql\n' });
  assert.equal(result.status, 1); assert.deepEqual(result.state.events, ['backup', 'pull']); assert.equal(result.state.tablesReady, false);
});
test('Неудачный дамп останавливает обновление до git pull и миграции', () => {
  const result = runUpdate({ backupFails: true }); assert.equal(result.status, 1);
  assert.deepEqual(result.state.events, ['backup']); assert.equal(result.backups.length, 0);
});

test('Миграция 033 применяется до сборки; повторный запуск не меняет данные', () => {
  const first = runUpdate({ tablesReady: true, yearIndexReady: true, identityReady: false, changedFiles: 'database/schema.sql\ndatabase/migrations/033_user_display_names.sql\n' });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.state.identityReady, true);
  assert(first.state.events.indexOf('migrate_identity') < first.state.events.indexOf('build'));
  assert.equal(first.state.events.filter(event => event === 'migrate_identity').length, 1);
  const repeated = runUpdate({ tablesReady: true, yearIndexReady: true });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert(!repeated.state.events.includes('migrate_identity'));
});
test('После отдельного git pull недостающая 033 восстанавливается до запуска', () => {
  const result = runUpdate({ tablesReady: true, yearIndexReady: true, identityReady: false });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.state.events, ['backup', 'pull', 'check_year_index', 'check_tables', 'check_identity', 'migrate_identity', 'check_probability', 'check_refresh', 'check_profile_identity', 'build', 'start']);
});

test('Миграция 034 применяется после резервной копии и до сборки, включая отдельный git pull', () => {
  for (const changedFiles of ['', 'database/schema.sql\ndatabase/migrations/034_probability_calculations.sql\n']) {
    const result = runUpdate({ tablesReady: true, yearIndexReady: true, probabilityReady: false, changedFiles });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.state.probabilityReady, true);
    const events = result.state.events;
    assert(events.indexOf('backup') < events.indexOf('migrate_probability'));
    assert(events.indexOf('migrate_probability') < events.indexOf('build'));
    assert.equal(events.filter(e => e === 'migrate_probability').length, 1);
  }
  const repeated = runUpdate({ tablesReady: true, yearIndexReady: true, probabilityReady: true });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert(!repeated.state.events.includes('migrate_probability'));
});
test('Миграции безопасности 035/036 применяются до сборки и повторяются без изменения готовой схемы',()=>{
 const result=runUpdate({tablesReady:true,yearIndexReady:true,refreshReady:false,profileIdentityReady:false,changedFiles:'database/migrations/035_session_refresh_tokens.sql\ndatabase/migrations/036_profile_identity_scope.sql\n'});
 assert.equal(result.status,0,result.stderr);for(const event of ['migrate_refresh','migrate_profile_identity'])assert(result.state.events.indexOf(event)<result.state.events.indexOf('build'));
});
