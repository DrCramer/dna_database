import React, { useEffect, useRef, useState } from 'react';

const stages = [['internal', 'В личном массиве'], ['master', 'В мастер-массиве'], ['staff', 'Контаминации сотрудников']];
const labels = { preparing: 'Подготавливаем данные', edits: 'Сохраняем ваши изменения', internal: 'Ищем дубликаты в личном массиве',
  master: 'Ищем совпадения в мастер-массиве', staff: 'Проверяем контаминации сотрудников', saving: 'Сохраняем результат', complete: 'Получаем готовый результат' };

export default function WorkspaceSearchProgress({ progress, selectedCount, onCancel }) {
  const dialog = useRef(null), started = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const el = dialog.current; el.showModal();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => { clearInterval(timer); if (el.open) el.close(); };
  }, []);
  const queued = progress.status === 'queued', cancelling = progress.status === 'cancelling';
  const determinate = !queued && !cancelling && Number.isFinite(progress.completed) && progress.total > 0;
  const percent = determinate ? Math.floor(Math.min(1, Math.max(0, progress.completed / progress.total)) * 100) : undefined;
  const stageIndex = ['saving','complete'].includes(progress.stage) ? 3 : stages.findIndex(([key]) => key === progress.stage);
  const cancellable = !['saving','complete'].includes(progress.stage) && !cancelling;
  const caption = cancelling ? 'Отменяем поиск…' : queued ? 'Ожидаем свободные потоки' : labels[progress.stage] || labels.preparing;
  return <dialog className="workspace-editor-dialog workspace-search-dialog" ref={dialog} aria-labelledby="workspace-search-title" aria-describedby="workspace-search-detail"
    onCancel={event => { event.preventDefault(); if (cancellable) onCancel(); }}>
    <div className="workspace-search-header"><span className="workspace-search-symbol" aria-hidden="true">🧬</span><div><h2 id="workspace-search-title">Полный поиск генотипов</h2><p>{selectedCount.toLocaleString('ru-RU')} объектов выбрано</p></div></div>
    <div className="workspace-search-body">
      <div className="workspace-search-caption" role="status" aria-live="polite"><strong>{caption}</strong><span>{stageIndex >= 0 && stageIndex < 3 ? `Этап ${stageIndex + 1} из 3` : 'Полный поиск'}</span></div>
      <progress className="workspace-search-progress" max="100" value={percent} aria-label="Прогресс текущего этапа" />
      <div className="workspace-search-counts"><span>{determinate ? `${progress.completed.toLocaleString('ru-RU')} из ${progress.total.toLocaleString('ru-RU')} ${progress.unit === 'candidates' ? 'кандидатов' : progress.unit === 'changes' ? 'изменений' : 'объектов'}` : queued ? 'Поиск начнётся, когда освободятся ресурсы' : 'Ожидаем подтверждение сервера'}</span><strong>{determinate ? `${percent}%` : '…'}</strong></div>
      <ol className="workspace-search-stages">{stages.map(([key, label], index) => <li key={key} data-state={index < stageIndex ? 'done' : index === stageIndex ? 'current' : 'pending'}><span aria-hidden="true">{index < stageIndex ? '✓' : index + 1}</span><div>{label}<small>{index < stageIndex ? 'Завершено' : index === stageIndex ? queued ? 'В очереди' : 'Выполняется' : 'Следующий этап'}</small></div></li>)}</ol>
      <p id="workspace-search-detail">Результат появится после завершения всех трёх проверок.</p>
    </div>
    <div className="workspace-editor-footer"><span>Прошло {Math.floor(elapsed / 60).toString().padStart(2,'0')}:{(elapsed % 60).toString().padStart(2,'0')}</span><button type="button" className="btn btn-secondary" disabled={!cancellable} onClick={onCancel}>{cancelling ? 'Отменяем…' : 'Отменить поиск'}</button></div>
  </dialog>;
}
