#!/usr/bin/env node
// Синтетические профили: ни чтения БД, ни реальных генотипов.
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { runProfileSearch } = require('../src/services/profiles/searchWorkerExecutor');

function syntheticProfiles(count) {
  const loci = ['D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'D8S1179', 'D21S11', 'D18S51', 'D2S441', 'D19S433', 'TH01', 'FGA', 'D22S1045', 'D5S818', 'D13S317', 'D7S820', 'SE33', 'D10S1248', 'D1S1656', 'D12S391', 'D2S1338', 'AMEL', 'DYS391'];
  let seed = 258;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const profiles = Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${index}`, sample_name: '258', internal_number: `258-${index + 1}`, year: 2026,
    str_data: Object.fromEntries(loci.map(locus => [locus, [String(7 + next() % 25), String(7 + next() % 25)]]))
  }));
  profiles.forEach((profile, index) => { if (index > 0 && index % 100 === 0) profile.str_data = structuredClone(profiles[index - 1].str_data); });
  return profiles;
}

async function benchmark({ count = 3000, algorithm = 'duplicate_v5', useWorkers = true, legacy } = {}) {
  const profiles = syntheticProfiles(count);
  const input = { referenceProfiles: profiles, compareProfiles: profiles, searchMode: 'task', comparisonAlgorithm: algorithm, minMatches: 15 };
  let maxDelayMs = 0, previous = performance.now();
  const timer = setInterval(() => { const now = performance.now(); maxDelayMs = Math.max(maxDelayMs, now - previous - 10); previous = now; }, 10);
  await new Promise(resolve => setTimeout(resolve, 20));
  const started = performance.now();
  const result = legacy ? legacy.compareTaskProfiles(input) : await runProfileSearch(input, { useWorkers });
  const durationMs = performance.now() - started;
  await new Promise(resolve => setTimeout(resolve, 20));
  clearInterval(timer);
  return {
    profiles: count, algorithm, mode: result.mode || 'legacy', workers: result.workerCount || 0,
    comparisons: result.comparisons, durationMs: Math.round(durationMs), maxEventLoopDelayMs: Math.round(maxDelayMs),
    groups: result.results.length,
    resultHash: createHash('sha256').update(JSON.stringify(result.results)).digest('hex')
  };
}

if (require.main === module) {
  benchmark({ count: Number(process.argv[2] || 3000), algorithm: process.argv[3] || 'duplicate_v5', useWorkers: process.argv[4] !== 'sequential' })
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { syntheticProfiles, benchmark };
