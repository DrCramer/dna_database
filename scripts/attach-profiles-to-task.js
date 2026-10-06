#!/usr/bin/env node
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function main() {
  const options = {};
  const flags = { '--task': 'task', '--user': 'username', '--file': 'file', '--uploaded-at': 'uploadedAt' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') {
      console.log('node scripts/attach-profiles-to-task.js --task 258 --user expert [--file файл.xlsx] [--uploaded-at "2026-10-06 12:00:00"] [--apply]\nБез --apply выполняется только проверка.');
      return;
    }
    if (arg === '--apply') { options.apply = true; continue; }
    if (!flags[arg] || !args[i + 1] || args[i + 1].startsWith('--') || options[flags[arg]]) throw new Error(`Некорректный аргумент: ${arg}`);
    options[flags[arg]] = args[++i];
  }
  if (!options.task || !options.username) throw new Error('Укажите --task и --user; --help покажет пример.');
  const { pool } = require('../src/config/database');
  try {
    const { attachOrphanProfiles } = require('../src/services/profileTaskRecoveryService');
    const report = await attachOrphanProfiles({ ...options, saveUndo: async undo => {
      const directory = path.resolve(process.cwd(), fs.existsSync('/app/backups') ? '/app/backups' : 'runtime/backups');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const filename = path.join(directory, `profile-task-repair-${Date.now()}-${randomUUID()}.json`);
      fs.writeFileSync(filename, JSON.stringify(undo, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      return filename;
    } });
    console.log(JSON.stringify(report, null, 2));
  } finally { await pool.end(); }
}

main().then(() => process.exit(0)).catch(error => { console.error(`Восстановление не выполнено: ${error.message}`); process.exit(1); });
