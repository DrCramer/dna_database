const path = require('node:path');
const { executeWorkerRanges, partitionPlan, rangeBounds, searchProfile, createRangeProgress } = require('../profiles/searchWorkerExecutor');
const { compareStaffProfiles } = require('./staffComparisonService');

async function runStaffSearch(input, { signal, useWorkers = true, minParallelComparisons = 2000, onProgress } = {}) {
  const references = input.referenceProfiles.length, comparisons = input.staffProfiles.length;
  if (signal?.aborted) throw signal.reason;
  if (!useWorkers || !references || !comparisons || references * comparisons < minParallelComparisons) {
    return { ...await compareStaffProfiles(input, { signal, onProgress }), mode: 'single-threaded-optimized', workerCount: 0 };
  }
  const plan = partitionPlan(references, comparisons);
  const compact = { ...input, referenceProfiles: input.referenceProfiles.map(searchProfile),
    staffProfiles: input.staffProfiles.map(profile => ({ ...searchProfile(profile),
      staff_id: profile.staff_id, full_name: profile.full_name, registration_number: profile.registration_number })) };
  const ranges = await executeWorkerRanges({
    workerPath: path.join(__dirname, '../../workers/staffSearchWorker.js'), signal, count: plan.count, onProgress: createRangeProgress(plan, onProgress),
    createInput: (index, count) => {
      const [start, end] = rangeBounds(index, count, plan.length);
      return plan.axis === 'references' ? { ...compact, referenceProfiles: compact.referenceProfiles.slice(start, end) }
        : { ...compact, staffRange: [start, end] };
    }
  });
  let results = ranges.flatMap(range => range.results);
  if (plan.axis === 'comparisons') {
    const matches = results.flatMap(group => group.matches);
    matches.sort((a, b) => b.finalScore - a.finalScore);
    results = [{ profileId: input.referenceProfiles[0].id, matches }];
  }
  return { results, comparisons: ranges.reduce((sum, range) => sum + range.comparisons, 0),
    mode: 'multi-threaded', workerCount: plan.count };
}

module.exports = { runStaffSearch };
