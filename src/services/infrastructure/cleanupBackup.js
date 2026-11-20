const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    // Credentials stay in the child environment, never in arguments or logs.
    const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'ignore'] });
    let timedOut = false, force;
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), 5000); force.unref();
    }, 10 * 60 * 1000);
    timer.unref();
    const clear = () => { clearTimeout(timer); clearTimeout(force); };
    child.once('error', error => { clear(); reject(error); });
    child.once('close', code => { clear(); code === 0 && !timedOut ? resolve() : reject(Error('BACKUP_TOOL_FAILED')); });
  });
}

async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function createCleanupBackup({ connectionString, snapshot, id, directory = path.resolve('backups') }) {
  const u = new URL(connectionString);
  const env = {
    PATH: process.env.PATH, LANG: 'C.UTF-8', PGHOST: u.hostname, PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'dna_cleanup_backup', PGSSLMODE: u.searchParams.get('sslmode') || 'prefer'
  };
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `genotypes-before-cleanup-${id}.dump`), partial = file + '.partial';
  try {
    const created = await fs.open(partial, 'wx', 0o600); await created.close();
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--snapshot=' + snapshot, '--file=' + partial], env);
    const handle = await fs.open(partial, 'r'), header = Buffer.alloc(5);
    try { await handle.read(header, 0, 5, 0); await handle.sync(); } finally { await handle.close(); }
    if (header.toString() !== 'PGDMP') throw Error('INVALID_BACKUP');
    await run('pg_restore', ['--list', partial], env);
    const sha256 = await checksum(partial);
    await fs.rename(partial, file); await fs.chmod(file, 0o600);
    const parent = await fs.open(directory, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    return { filename: path.basename(file), bytes: (await fs.stat(file)).size, sha256 };
  } catch (error) {
    await fs.unlink(partial).catch(() => {});
    throw error;
  }
}
module.exports = { createCleanupBackup, checksum };
