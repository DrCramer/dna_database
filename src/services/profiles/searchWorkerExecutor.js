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

async function executeSearchWorkers({ operation, input, referenceCount, comparisonCount, signal, useWorkers = true, minParallelComparisons = 10000, runSequential }) {
  if (!useWorkers || !referenceCount || !comparisonCount || referenceCount * comparisonCount < minParallelComparisons) {
    if (signal?.aborted) throw signal.reason;
    return { ...runSequential(), mode: 'single-threaded-optimized', workerCount: 0 };
  }
  const unlock = await acquire(signal);
  const workers = [];
  const count = Math.min(workerLimit(), referenceCount);
  const abort = () => workers.forEach(worker => worker.terminate());
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw signal.reason;
    const ranges = await Promise.all(Array.from({ length: count }, (_, index) => new Promise((resolve, reject) => {
      const startIndex = Math.floor(index * referenceCount / count);
      const endIndex = Math.floor((index + 1) * referenceCount / count);
      const worker = new Worker(path.join(__dirname, '../../workers/profileSearchWorker.js'), {
        workerData: {
          operation,
          input: { ...input, referenceProfiles: input.referenceProfiles.slice(startIndex, endIndex) }
        }
      });
      workers.push(worker);
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => reject(signal?.aborted ? signal.reason : new Error(`Search worker exited before a result (${code})`)));
    })));
    if (signal?.aborted) throw signal.reason;
    return {
      results: ranges.flatMap(range => range.results),
      comparisons: ranges.reduce((sum, range) => sum + range.comparisons, 0),
      mode: 'multi-threaded', workerCount: workers.length
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    await Promise.allSettled(workers.map(worker => worker.terminate()));
    unlock();
  }
}

async function runProfileSearch(input, { signal, useWorkers = true, minParallelComparisons = 10000 } = {}) {
  const { compareTaskProfiles, compareDepartmentProfiles } = require('./taskComparisonService');
  const operation = input.searchMode === 'department_tasks' ? 'department' : 'task';
  return executeSearchWorkers({
    operation, input, signal, useWorkers, minParallelComparisons,
    referenceCount: input.referenceProfiles.length, comparisonCount: input.compareProfiles.length,
    runSequential: () => (operation === 'department' ? compareDepartmentProfiles : compareTaskProfiles)(input)
  });
}

async function runProfileSearchForRequest(req, res, input) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(new Error('Клиент отменил поиск.')); };
  req.once('aborted', abort);
  res.once('close', abort);
  if (req.aborted || res.destroyed) abort();
  const timeout = setTimeout(() => controller.abort(new Error('Превышено время поиска (10 минут).')), 10 * 60 * 1000);
  timeout.unref();
  try { return await runProfileSearch(input, { signal: controller.signal, useWorkers: req.body.useWorkers !== false }); }
  finally { clearTimeout(timeout); req.removeListener('aborted', abort); res.removeListener('close', abort); }
}

module.exports = { runProfileSearch, runProfileSearchForRequest, workerLimit };
