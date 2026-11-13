const { requireUser, err } = require('./workspaceService');

// This is a live HTTP search, not a durable background job. Disconnecting cancels
// its signal; only the service's committed, complete run may be used as proof.
async function streamWorkspaceSearch(req, res, service, value) {
  requireUser(req.user, true);
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(err('Поиск отменён.', 409, 'CANCELLED')); };
  req.once('aborted', cancel);
  res.once('close', cancel);
  if (req.aborted || res.destroyed) cancel();
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no' });
  let lastStage, lastStatus, lastSent = 0;
  function send(frame) {
    if (res.destroyed || res.writableEnded) return;
    res.write(JSON.stringify(frame) + '\n');
    res.flush?.();
  }
  const progress = data => {
    const now = Date.now();
    if (data.stage !== lastStage || data.status !== lastStatus || data.completed === data.total || now - lastSent >= 200) {
      send({ type: 'progress', progress: data });
      lastStage = data.stage; lastStatus = data.status; lastSent = now;
    }
  };
  const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15000);
  const timeout = setTimeout(() => controller.abort(err('Превышено время поиска (10 минут).', 408, 'SEARCH_TIMEOUT')), 600000);
  heartbeat.unref(); timeout.unref();
  try {
    const result = await service.fullSearch(req.user, value.ids, value.parameters, controller.signal, progress);
    if (!controller.signal.aborted) send({ type: 'result', result });
  } catch (e) {
    res.locals.workspaceOperationFailed = true;
    const status = e.status || 500;
    send({ type: 'error', status, code: e.status ? e.code || 'WORKSPACE_ERROR' : 'SEARCH_FAILED',
      message: status === 500 ? 'Не удалось завершить поиск. Повторите попытку.' : e.message });
  } finally {
    clearInterval(heartbeat); clearTimeout(timeout);
    req.removeListener('aborted', cancel); res.removeListener('close', cancel);
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}
module.exports = { streamWorkspaceSearch };
