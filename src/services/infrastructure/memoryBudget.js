const fs = require('node:fs');
const MiB = 1024 * 1024;
function numberFile(path) { try { const n = Number(fs.readFileSync(path, 'utf8').trim()); return Number.isFinite(n) && n > 0 ? n : null; } catch { return null; } }
function readMemory() {
  let hostAvailable = null;
  try { const raw = fs.readFileSync('/proc/meminfo', 'utf8'); hostAvailable = Number(raw.match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024 || null; } catch { /* Non-Linux development host. */ }
  const limit = numberFile('/sys/fs/cgroup/memory.max') || numberFile('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const current = numberFile('/sys/fs/cgroup/memory.current') || numberFile('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  const containerAvailable = limit && current && limit < Number.MAX_SAFE_INTEGER ? Math.max(0, limit - current) : null;
  return { hostAvailable, containerAvailable, rss: process.memoryUsage().rss };
}
function workerCapacity(snapshot) {
  const available = [snapshot.hostAvailable, snapshot.containerAvailable].filter(n => n !== null);
  return available.length ? Math.max(1, Math.floor((Math.min(...available) - 256 * MiB) / (256 * MiB))) : 16;
}
function backgroundAllowed(snapshot = readMemory()) {
  return (snapshot.hostAvailable === null || snapshot.hostAvailable >= 1024 * MiB) && (snapshot.containerAvailable === null || snapshot.containerAvailable >= 768 * MiB);
}
function assertSearchMemory(snapshot = readMemory()) {
  if ((snapshot.hostAvailable !== null && snapshot.hostAvailable < 256 * MiB) || (snapshot.containerAvailable !== null && snapshot.containerAvailable < 192 * MiB)) {
    throw Object.assign(Error('Недостаточно свободной памяти для поиска. Повторите после завершения других операций.'), { status: 503, code: 'SEARCH_MEMORY_PRESSURE' });
  }
}
module.exports = { readMemory, workerCapacity, backgroundAllowed, assertSearchMemory, MiB };
