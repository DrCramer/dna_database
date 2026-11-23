async function readSearchStream(response, onProgress = () => {}) {
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw Error(failure.message || 'Не удалось запустить поиск.');
  }
  if (!response.body?.getReader) throw Error('Браузер не поддерживает отображение прогресса поиска. Обновите браузер.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result, received = false, finished = false;
  function frame(line) {
    if (!line.trim()) return;
    let data;
    try { data = JSON.parse(line); } catch { throw Error('Получен некорректный ответ поиска. Повторите поиск.'); }
    if (data.type === 'error') throw Error(data.message || 'Не удалось завершить поиск.');
    if (data.type === 'progress') onProgress(data.progress);
    else if (data.type === 'result' && !received && data.result?.id) { result = data.result; received = true; }
    else if (data.type !== 'heartbeat') throw Error('Нарушен порядок ответа поиска. Повторите поиск.');
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) { frame(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (done) break;
    }
    if (buffer.trim()) frame(buffer);
    if (!received) throw Error('Соединение прервалось до получения результата. Повторите поиск.');
    finished = true;
    return result;
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
module.exports = { readSearchStream };
