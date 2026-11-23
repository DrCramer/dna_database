const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runCutover(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-cutover-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(__dirname, '..');
  for (const dir of ['bin', 'config', 'scripts', 'database']) fs.mkdirSync(path.join(root, dir));
  fs.copyFileSync(path.join(repo, 'scripts/workspace-cutover.sh'), path.join(root, 'scripts/workspace-cutover.sh'));
  fs.cpSync(path.join(repo, 'database/migrations'), path.join(root, 'database/migrations'), { recursive: true });
  fs.writeFileSync(path.join(root, '.env'), options.env || 'UNIFIED_WORKSPACE_ENABLED=false\n');
  fs.writeFileSync(path.join(root, 'config/encryption.key'), Buffer.alloc(32));
  fs.writeFileSync(path.join(root, 'bin/git'), '#!/bin/sh\nprintf "%s\\n" fixture-revision\n', { mode: 0o700 });
  const eventsPath = path.join(root, 'events');
  fs.writeFileSync(eventsPath, '');
  fs.writeFileSync(path.join(root, 'bin/docker'), `#!/bin/sh
record() { printf '%s\\n' "$1" >> "$CUTOVER_TEST_EVENTS"; }
case "$*" in
  'compose ps --all --quiet web') record container; echo fixture-web ;;
  'inspect --type container '*) record previous; echo sha256:fixture-old ;;
  'image inspect sha256:fixture-old')
    record inspect-image
    [ "$CUTOVER_TEST_MISSING" != 1 ] || exit 1
    ;;
  'image tag sha256:fixture-old '*) record tag ;;
  'compose build web'|'build -t '*) record build ;;
  'compose exec -T db pg_dump '*)
    record backup
    [ "$CUTOVER_TEST_BACKUP_FAILS" != 1 ] || exit 1
    echo '-- synthetic dump'
    ;;
  'compose stop web') record stop ;;
  'compose exec -T db psql '*)
    if [ "$*" = "compose exec -T db psql -X -U dna_user -d $WORKSPACE_DATABASE_NAME -v ON_ERROR_STOP=1 -c UPDATE workspace_configuration SET enabled=true WHERE id=true;" ]; then
      record enable
    else
      record migration
    fi
    ;;
  'compose up -d --no-deps --wait --wait-timeout 180 web') record up ;;
  *) printf 'Unexpected Docker command: %s\\n' "$*" >&2; exit 2 ;;
esac
`, { mode: 0o700 });
  const result = spawnSync('bash', [path.join(root, 'scripts/workspace-cutover.sh'),
    options.staging ? '--staging' : '--confirm-production-cutover'
  ], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH,
      CUTOVER_TEST_EVENTS: eventsPath,
      CUTOVER_TEST_MISSING: options.missingImage ? '1' : '0',
      CUTOVER_TEST_BACKUP_FAILS: options.backupFails ? '1' : '0',
      WORKSPACE_DATABASE_NAME: 'dna_workspace_test_cutover'
    }
  });
  assert.ifError(result.error);
  const backupRoot = path.join(root, 'runtime/backups');
  const backup = path.join(backupRoot, fs.readdirSync(backupRoot)[0]);
  return {
    ...result,
    backup,
    events: fs.readFileSync(eventsPath, 'utf8').trim().split('\n'),
    env: fs.readFileSync(path.join(root, '.env'), 'utf8')
  };
}

test('Переход сохраняет прежний образ до сборки и делает финальный дамп до миграций', t => {
  const env = '# Synthetic settings\nWEB_PORT=3001\nUNIFIED_WORKSPACE_ENABLED=false\nexport UNIFIED_WORKSPACE_ENABLED = false\n';
  const result = runCutover(t, { env });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, ['container', 'previous', 'inspect-image', 'tag', 'build', 'backup', 'stop', 'backup',
    ...Array(8).fill('migration'), 'enable', 'up']);
  assert.match(fs.readFileSync(path.join(result.backup, 'previous-image-tag.txt'), 'utf8'), /^dna_database-web:workspace-before-/);
  assert.equal(fs.readFileSync(path.join(result.backup, 'env.before'), 'utf8'), env);
  assert.equal(result.env, '# Synthetic settings\nWEB_PORT=3001\nUNIFIED_WORKSPACE_ENABLED=true\n');
});

test('Отсутствующий образ запущенного web описан в предупреждении, SQL-дампы сохраняются', t => {
  const result = runCutover(t, { missingImage: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Previous web image sha256:fixture-old is unavailable/);
  assert(!result.events.includes('tag'));
  assert.equal(result.events.filter(event => event === 'backup').length, 2);
  assert.equal(fs.readFileSync(path.join(result.backup, 'previous-image-id.txt'), 'utf8').trim(), 'sha256:fixture-old');
  assert(fs.statSync(path.join(result.backup, 'database.final.sql')).size > 0);
});

test('Ошибка первичного дампа останавливает переключение до остановки web', t => {
  const result = runCutover(t, { backupFails: true });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.events.slice(-2), ['build', 'backup']);
  assert.match(result.env, /^UNIFIED_WORKSPACE_ENABLED=false\n$/);
});

test('Стенд не обращается к предыдущему web и не останавливает его', t => {
  const result = runCutover(t, { staging: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, ['build', 'backup', ...Array(8).fill('migration'), 'enable']);
  assert.match(result.env, /^UNIFIED_WORKSPACE_ENABLED=false\n$/);
});
