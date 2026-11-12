const { Worker } = require('node:worker_threads');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

function cpuCapacity() {
  let count = os.availableParallelism?.() || os.cpus().length || 1;
  // availableParallelism учитывает affinity, но не всегда CPU quota Docker.
  for (const file of ['/sys/fs/cgroup/cpu.max', '/sys/fs/cgroup/cpu/cpu.cfs_quota_us', '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us']) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      const [quota, period] = file.endsWith('cpu.max')
        ? value.split(/\s+/).map(Number)
        : [Number(value), Number(fs.readFileSync(path.join(path.dirname(file), 'cpu.cfs_period_us'), 'utf8'))];
      if (quota > 0 && period > 0) count = Math.min(count, Math.max(1, Math.ceil(quota / period)));
    } catch { /* Хост без cgroup quota. */ }
  }
  return Math.max(1, count);
}

function workerLimit() {
  const configured = Number(process.env.GENOTYPE_SEARCH_WORKERS || 4);
  return Math.min(cpuCapacity(), Number.isInteger(configured) && configured > 0 ? Math.min(configured, 16) : 4);
}

// Один тяжёлый поиск на процесс: параллельные HTTP-запросы не размножают
// наборы профилей и потоки сверх лимита. Ожидание не блокирует event loop.
let busy = false;
const queue = [];
function acquire(signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('Поиск отменён.'));
  if (!busy) { busy = true; return Promise.resolve(release); }
  if (queue.length >= 8) return Promise.reject(Object.assign(new Error('Очередь поиска заполнена. Повторите позже.'), { status: 503 }));
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, signal };
    entry.abort = () => {
      const index = queue.indexOf(entry);
      if (index !== -1) queue.splice(index, 1);
      reject(signal.reason || new Error('Поиск отменён.'));
    };
    signal?.addEventListener('abort', entry.abort, { once: true });
    queue.push(entry);
  });
}
function release() {
  const next = queue.shift();
  if (next) { next.signal?.removeEventListener('abort', next.abort); next.resolve(release); }
  else busy = false;
}

// Shared budget for duplicate search and staff analysis: never multiply the CPU
// limit by the number of concurrent users or analysis stages.
async function executeWorkerRanges({ workerPath, count, createInput, signal }) {
  const unlock = await acquire(signal);
  const workers = [];
  const abort = () => workers.forEach(worker => worker.terminate());
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw signal.reason;
    const ranges = await Promise.all(Array.from({ length: count }, (_, index) => new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: createInput(index, count),
        env: { NODE_ENV: process.env.NODE_ENV || 'production', LOG_LEVEL: process.env.LOG_LEVEL || 'info' },
        resourceLimits: { maxOldGenerationSizeMb: 256 }
      });
      workers.push(worker);
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => reject(signal?.aborted ? signal.reason : new Error(`Search worker exited before a result (${code})`)));
    })));
    if (signal?.aborted) throw signal.reason;
    return ranges;
  } finally {
    signal?.removeEventListener('abort', abort);
    await Promise.allSettled(workers.map(worker => worker.terminate()));
    unlock();
  }
}

function partitionPlan(referenceCount, comparisonCount) {
  // One reference against a large array must also use more than one CPU.
  const axis = referenceCount === 1 ? 'comparisons' : 'references';
  const length = axis === 'references' ? referenceCount : comparisonCount;
  return { axis, count: Math.min(workerLimit(), length), length };
}
function rangeBounds(index, count, length) {
  return [Math.floor(index * length / count), Math.floor((index + 1) * length / count)];
}
function searchProfile(profile) {
  // No imported Excel provenance, ciphertext, user records or DB connections in workers.
  const keys = ['id', 'sample_name', 'internal_number', 'import_number', 'year', 'str_data',
    'source', 'task_id', 'task_name', 'task_owner', 'panel'];
  const result = Object.fromEntries(keys.map(key => [key, profile[key]]));
  if (profile.metadata?.panelLociOrder) result.metadata = { panelLociOrder: profile.metadata.panelLociOrder };
  return result;
}
function mergeComparisonRanges(ranges, operation, algorithm) {
  const groups = ranges.flatMap(range => range.results);
  if (!groups.length) return [];
  const matches = groups.flatMap(group => group.exportMatches || group.matches);
  matches.sort(operation === 'department'
    ? (a, b) => ['contamination', 'duplicate_v5'].includes(algorithm) ? b.score - a.score : b.matchingLoci - a.matchingLoci
    : (a, b) => b.matchCount - a.matchCount);
  return operation === 'department' ? [{ reference: groups[0].reference, matches }]
    : [{ reference: groups[0].reference, matches: matches.slice(0, 100), exportMatches: matches,
      matchCount: matches.length, displayedCount: Math.min(matches.length, 100) }];
}

async function runProfileSearch(input, { signal, useWorkers = true, minParallelComparisons = 2000 } = {}) {
  const { compareTaskProfiles, compareDepartmentProfiles } = require('./taskComparisonService');
  const operation = input.searchMode === 'department_tasks' ? 'department' : 'task';
  const referenceCount = input.referenceProfiles.length, comparisonCount = input.compareProfiles.length;
  if (!useWorkers || !referenceCount || !comparisonCount || referenceCount * comparisonCount < minParallelComparisons) {
    if (signal?.aborted) throw signal.reason;
    return { ...(operation === 'department' ? compareDepartmentProfiles : compareTaskProfiles)(input), mode: 'single-threaded-optimized', workerCount: 0 };
  }
  const plan = partitionPlan(referenceCount, comparisonCount);
  const compact = { ...input, referenceProfiles: input.referenceProfiles.map(searchProfile), compareProfiles: input.compareProfiles.map(searchProfile) };
  const ranges = await executeWorkerRanges({
    workerPath: path.join(__dirname, '../../workers/profileSearchWorker.js'), count: plan.count, signal,
    createInput: (index, count) => {
      const [start, end] = rangeBounds(index, count, plan.length);
      const key = plan.axis === 'references' ? 'referenceProfiles' : 'compareProfiles';
      return { operation, input: { ...compact, [key]: compact[key].slice(start, end) } };
    }
  });
  return { results: plan.axis === 'references' ? ranges.flatMap(range => range.results) : mergeComparisonRanges(ranges, operation, input.comparisonAlgorithm),
    comparisons: ranges.reduce((sum, range) => sum + range.comparisons, 0),
    candidateComparisons: ranges.reduce((sum, range) => sum + range.candidateComparisons, 0), mode: 'multi-threaded', workerCount: plan.count };
}

async function runSearchForRequest(req, res, run) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(new Error('Клиент отменил поиск.')); };
  req.once('aborted', abort);
  res.once('close', abort);
  if (req.aborted || res.destroyed) abort();
  const timeout = setTimeout(() => controller.abort(new Error('Превышено время поиска (10 минут).')), 10 * 60 * 1000);
  timeout.unref();
  try { return await run(controller.signal); }
  finally { clearTimeout(timeout); req.removeListener('aborted', abort); res.removeListener('close', abort); }
}

function runProfileSearchForRequest(req, res, input) {
  return runSearchForRequest(req, res, signal => runProfileSearch(input, { signal, useWorkers: req.body.useWorkers !== false }));
}

module.exports = { runSearchForRequest, runProfileSearch, runProfileSearchForRequest, workerLimit, executeWorkerRanges, partitionPlan, rangeBounds, searchProfile };
