const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Проверяем настоящий Bash-скрипт; внешние Git/Docker заменены изолированными
// командами. SQL самой миграции отдельно выполняется интеграционным тестом.
function runUpdate({ changedFiles = '', tablesReady = false, backupFails = false }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-reference-update-'));
  try {
    for (const name of ['scripts', 'config', 'database/migrations', 'bin']) fs.mkdirSync(path.join(directory, name), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../scripts/update_server.sh'), path.join(directory, 'scripts/update_server.sh'));
    fs.copyFileSync(path.join(__dirname, '../database/migrations/031_allele_references.sql'), path.join(directory, 'database/migrations/031_allele_references.sql'));
    fs.writeFileSync(path.join(directory, '.env'), '', { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'config/encryption.key'), Buffer.alloc(32), { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'scripts/prepare-runtime.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const stateFile = path.join(directory, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ changedFiles, tablesReady, backupFails, events: [] }));
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
 if(args.includes('-c')){record('check_tables');console.log(state.tablesReady?'t':'f');}
 else{const sql=fs.readFileSync(0,'utf8');if(!sql.includes('CREATE TABLE IF NOT EXISTS allele_reference_sets'))process.exit(3);state.tablesReady=true;record('migrate');}
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
  assert.deepEqual(result.state.events, ['backup', 'pull', 'check_tables', 'migrate', 'build', 'start']);
  assert.equal(result.backups.length, 1); assert(result.backups[0].size > 0); assert.equal(result.backups[0].mode, 0o600);
});
test('Распознанный релиз применяет 031 один раз; повторное обновление сохраняет таблицы', () => {
  const first = runUpdate({ changedFiles: 'database/schema.sql\ndatabase/migrations/031_allele_references.sql\n' });
  assert.equal(first.status, 0, first.stderr); assert.equal(first.state.events.filter(event => event === 'migrate').length, 1);
  const repeated = runUpdate({ tablesReady: true }); assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(repeated.state.events, ['backup', 'pull', 'check_tables', 'build', 'start']);
});
test('Неизвестная миграция останавливает обновление до изменения БД и запуска кода', () => {
  const result = runUpdate({ changedFiles: 'database/schema.sql\ndatabase/migrations/999_unknown.sql\n' });
  assert.equal(result.status, 1); assert.deepEqual(result.state.events, ['backup', 'pull']); assert.equal(result.state.tablesReady, false);
});
test('Неудачный дамп останавливает обновление до git pull и миграции', () => {
  const result = runUpdate({ backupFails: true }); assert.equal(result.status, 1);
  assert.deepEqual(result.state.events, ['backup']); assert.equal(result.backups.length, 0);
});
