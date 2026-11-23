#!/usr/bin/env node
// Synthetic data only. This benchmark never connects to a database.
process.env.LOG_LEVEL = 'error';
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { syntheticProfiles } = require('./benchmark-task-search');
const { runStaffSearch } = require('../src/services/contamination/staffSearchWorkerExecutor');
const Analyzer = require('../src/services/contamination/staffContaminationAnalyzer');

async function benchmark({ count = 3000, staffCount = 160, mode = 'parallel', algorithm = 'v5' } = {}) {
  const options = { useV5Algorithm: algorithm === 'v5', useV4Algorithm: algorithm === 'v4' };
  const referenceProfiles = syntheticProfiles(count);
  const staffProfiles = syntheticProfiles(staffCount).map((profile, index) => ({ ...profile,
    id: 'synthetic-staff-' + index, staff_id: 'SYN-' + index, full_name: 'Synthetic ' + index,
    registration_number: (index + 1) + '-G', year: 2026 }));
  let maxEventLoopDelayMs = 0, last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, now - last - 10); last = now; }, 10);
  await new Promise(resolve => setTimeout(resolve, 20));
  const start = performance.now(), startCpu = process.cpuUsage();
  let result;
  try {
    if (mode === 'legacy') {
      const analyzer = new Analyzer(null, { quiet: true });
      const results = [];
      for (const profile of referenceProfiles) {
        results.push({ profileId: profile.id, matches: (await analyzer.detectStaffContamination(profile, staffProfiles, options)).map(match => ({
          ...match, registrationNumber: staffProfiles.find(staff => staff.id === match.staffId)?.registration_number || null,
          staffYear: staffProfiles.find(staff => staff.id === match.staffId)?.year || null
        })) });
      }
      result = { results, comparisons: count * staffCount, workerCount: 0 };
    } else result = await runStaffSearch({ referenceProfiles, staffProfiles, options }, { useWorkers: mode === 'parallel' });
    const durationMs = performance.now() - start, cpu = process.cpuUsage(startCpu);
    await new Promise(resolve => setTimeout(resolve, 20));
    return { profiles: count, staff: staffCount, algorithm, mode, workers: result.workerCount,
      comparisons: result.comparisons, durationMs: Math.round(durationMs), cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      maxEventLoopDelayMs: Math.round(maxEventLoopDelayMs), groups: result.results.length,
      resultHash: createHash('sha256').update(JSON.stringify(result.results)).digest('hex') };
  } finally { clearInterval(timer); }
}

if (require.main === module) {
  const count = Number(process.argv[2] || 3000), staffCount = Number(process.argv[3] || 160), mode = process.argv[4] || 'parallel', algorithm = process.argv[5] || 'v5';
  if (![count, staffCount].every(value => Number.isInteger(value) && value > 0 && value <= 10000) || !['legacy', 'sequential', 'parallel', 'compare'].includes(mode) || !['v1.5','v4','v5'].includes(algorithm)) {
    console.error('Usage: node scripts/benchmark-staff-search.js [profiles:1..10000] [staff:1..10000] [legacy|sequential|parallel|compare] [v1.5|v4|v5]');
    process.exitCode = 1;
  } else (async () => {
    let hash;
    for (const variant of mode === 'compare' ? ['legacy', 'sequential', 'parallel'] : [mode]) {
      const result = await benchmark({ count, staffCount, mode: variant, algorithm });
      console.log(JSON.stringify(result));
      if (hash && result.resultHash !== hash) throw new Error('Staff results changed between execution modes.');
      hash = result.resultHash;
    }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { benchmark };
