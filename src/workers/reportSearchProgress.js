// Bounded telemetry: no identifiers, genotypes or per-pair messages.
function createWorkerProgress(parentPort) {
  let last = 0;
  return progress => {
    const now = Date.now();
    if (progress.completed === 0 || progress.completed === progress.total || now - last >= 200) {
      parentPort.postMessage({ type: 'progress', progress });
      last = now;
    }
  };
}
module.exports = { createWorkerProgress };
