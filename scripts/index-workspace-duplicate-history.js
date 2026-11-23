#!/usr/bin/env node
const { pool } = require('../src/config/database');
const { ALGORITHM_VERSION } = require('../src/services/workspace/workspaceSearchService');
const { indexSavedDuplicateHistory } = require('../src/services/workspace/workspaceDuplicateHistory');
const { backgroundAllowed } = require('../src/services/infrastructure/memoryBudget');

async function main() {
  const client = await pool.connect();
  const lock = 'dna_database:workspace-duplicate-history-v1';
  try {
    const { rows: [state] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lock]);
    if (!state.locked) throw Object.assign(new Error('Duplicate history indexing is already running'), { code: 'ALREADY_RUNNING' });
    try {
      const report = await indexSavedDuplicateHistory(client, ALGORITHM_VERSION, { canContinue: backgroundAllowed });
      await new Promise(resolve => process.stdout.write(JSON.stringify(report) + '\n', resolve));
      if (report.paused) process.exitCode = 2;
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lock]);
    }
  } finally {
    client.release();
  }
}

async function run() {
  try {
    await main();
  } finally {
    await pool.end();
  }
}

// Loading the encryption configuration also starts a session cleanup timer.
// Close the DB client and finish the CLI without waiting for the server timer.
run().then(() => process.exit(process.exitCode || 0)).catch(error => {
  console.error('WORKSPACE_DUPLICATE_HISTORY_INDEX_FAILED', error.code || error.name);
  process.exit(1);
});
