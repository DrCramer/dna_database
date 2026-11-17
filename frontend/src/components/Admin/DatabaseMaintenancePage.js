import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { matchesRoles } from '../../../../src/utils/accessPolicyRules';

const base = '/api/admin/database-maintenance';
const phases = { preparing: 'Подготовка', waiting: 'Завершение текущих операций', backing_up: 'Создание и проверка резервной копии', clearing: 'Очистка данных', completed: 'Очистка завершена', failed: 'Очистка не выполнена', interrupted: 'Операция прервана', unknown: 'Проверьте состояние БД' };
const categories = [{key:'personal',label:'Личные генотипы',hint:'Профили пользователей, старые задачи и черновики импорта.'},{key:'master',label:'Мастер-массив',hint:'Опубликованные и старые мастер-профили.'},{key:'staff',label:'Профили сотрудников',hint:'Эталоны сотрудников для проверки контаминаций.'},{key:'results',label:'Результаты поиска',hint:'Сравнения, контаминации и задания ночного поиска. Генотипы сохранятся.'}];
const active = job => job && ['preparing', 'waiting', 'backing_up', 'clearing'].includes(job.state);

export default function DatabaseMaintenancePage() {
  const { user, activeDepartmentId } = useAuth();
  const admin = matchesRoles(user, ['admin', 'system_administrator']);
  const [selection, setSelection] = useState([]);
  const [preview, setPreview] = useState(null), [job, setJob] = useState(null);
  const [busy, setBusy] = useState('loading'), [error, setError] = useState('');
  const [phrase, setPhrase] = useState(''), [acknowledged, setAcknowledged] = useState(false);
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, 'X-Active-Department-Id': activeDepartmentId, 'Content-Type': 'application/json' });
  async function request(url, options = {}) {
    const response = await fetch(base + url, { ...options, headers: headers() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Не удалось выполнить запрос.');
    return data;
  }
  useEffect(() => {
    if (!admin) return;
    let disposed = false, timer;
    async function poll() {
      try {
        const data = await request('/status');
        if (disposed) return;
        setJob(data.job); setBusy(''); setError('');
        if (active(data.job)) timer = setTimeout(poll, 1500);
      } catch (failure) {
        if (!disposed) { setError(failure.message); setBusy(''); timer = setTimeout(poll, 5000); }
      }
    }
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [admin, activeDepartmentId, job?.id, active(job)]);

  async function inspect() {
    setBusy('preview'); setError(''); setPreview(null); setPhrase(''); setAcknowledged(false);
    try { setPreview(await request('/preview?categories='+encodeURIComponent(selection.join(',')))); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  async function execute() {
    if (!preview || preview.categories.length !== selection.length || !selection.every(key => preview.categories.includes(key))) return;
    setBusy('execute'); setError('');
    try {
      const data = await request('/execute', { method: 'POST', body: JSON.stringify({ categories: selection, token: preview.token, confirmation: phrase, acknowledged }) });
      setJob(data.job); setPreview(null); setPhrase(''); setAcknowledged(false);
    } catch (failure) { setError(failure.message); setPreview(null); }
    finally { setBusy(''); }
  }
  async function download() {
    setBusy('download'); setError('');
    try {
      const response = await fetch(`${base}/${job.id}/backup`, { headers: headers() });
      if (!response.ok) throw new Error((await response.json()).message);
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = job.backup.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure.message || 'Не удалось скачать резервную копию.'); }
    finally { setBusy(''); }
  }
  if (!admin) return <div className="alert alert-danger" role="alert">Раздел доступен только администраторам.</div>;
  const running = active(job), removesGenotypes = selection.some(key => key !== 'results');
  function choose(key, checked) {
    setPreview(null); setPhrase(''); setAcknowledged(false); setError('');
    setSelection(previous => checked ? [...previous, key] : previous.filter(value => value !== key));
  }
  return <div className="master-export-page database-maintenance-page">
    <header className="page-header"><div><h1 className="page-title">Очистка данных</h1><p>Выберите данные для очистки. Пользователи и настройки сохранятся.</p></div></header>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    <section className="card master-export-card">
      <h2>Что очистить</h2>
      <p>Можно выбрать несколько категорий. Выбор действует для всех пользователей и отделений этой установки.</p>
      <fieldset className="maintenance-categories"><legend className="visually-hidden">Категории очистки</legend>{categories.map(category => <label key={category.key}>
        <input type="checkbox" checked={selection.includes(category.key) || category.key === 'results' && removesGenotypes} disabled={!!busy || running || category.key === 'results' && removesGenotypes} onChange={event => choose(category.key, event.target.checked)} />
        <span><strong>{category.label}</strong><small>{category.key === 'results' && removesGenotypes ? 'Результаты сбрасываются автоматически при удалении генотипов, чтобы не оставалось устаревших совпадений.' : category.hint}</small></span>
      </label>)}</fieldset>
      <div className="alert alert-info">Пользователи, права, настройки, отделения, задачи и справочники сохранятся. Сохранённые расчёты вероятности также сохранятся. Исходные файлы и прежние резервные копии останутся на диске.</div>
      <p>Сначала будет создана и проверена полная резервная копия БД. Если копию создать не удастся, очистка не начнётся. Во время операции работа с данными будет временно приостановлена.</p>
      <button className="btn btn-secondary" disabled={!!busy || running || !selection.length} onClick={inspect}>{busy === 'loading' ? 'Проверка состояния…' : busy === 'preview' ? 'Подсчёт данных…' : 'Предварительный просмотр'}</button>
    </section>
    {job && <section className="card master-export-card" aria-live="polite" aria-busy={running}>
      <h2>{phases[job.state] || job.state}</h2>
      {job.categoryLabels && <p>Выбранные категории: <strong>{job.categoryLabels.join(', ')}</strong>.</p>}
      <p>{job.message || (running ? 'Оставьте эту страницу открытой или вернитесь позже: состояние операции сохранится.' : `Начало операции: ${new Date(job.startedAt).toLocaleString('ru-RU')}`)}</p>
      {running && <ol className="maintenance-steps">{['waiting', 'backing_up', 'clearing'].map(state => <li key={state} aria-current={job.state === state ? 'step' : undefined}>{phases[state]}</li>)}</ol>}
      {job.backup && <><p>Резервная копия: {(job.backup.bytes / 1048576).toFixed(1)} МБ. Хранится на сервере в папке резервных копий проекта.</p><button className="btn btn-secondary" disabled={!!busy || running} onClick={download}>{busy === 'download' ? 'Скачивание…' : 'Скачать резервную копию'}</button></>}
    </section>}
    {preview && preview.categories.length === selection.length && selection.every(key => preview.categories.includes(key)) && !running && <section className="card master-export-card">
      <h2>Предварительный просмотр</h2><p><strong>{preview.scope}</strong>. Выбрано: <strong>{preview.categoryLabels.join(', ')}</strong>. Изменения по связанным данным:</p>
      <div className="maintenance-counts"><table className="data-table"><thead><tr><th>Данные</th><th>Действие</th><th>Записей</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.key}><td>{row.label}</td><td>{row.action === 'delete' ? 'Удаление' : row.action === 'unlink' ? 'Удаление связи с исходником' : 'Сброс'}</td><td>{row.count.toLocaleString('ru-RU')}</td></tr>)}</tbody></table></div>
      <div className="alert alert-info">Результаты поиска и ожидающие согласования сбрасываются. История завершённых согласований и публикаций сохраняется, если её исходники не удаляются. Копии генотипов в невыбранных массивах остаются; связь с удалённым личным исходником будет снята.</div>
      <p>Просмотр действителен 5 минут. Если данные изменятся, потребуется обновить просмотр.</p>
      <label className="maintenance-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />Я проверил выбранные категории и связанные изменения. Очистка затронет всех пользователей и отделения этой установки.</label>
      <label className="maintenance-phrase">Для подтверждения введите <strong>{preview.confirmation}</strong><input className="form-input" autoComplete="off" value={phrase} onChange={event => setPhrase(event.target.value)} /></label>
      <button className="btn btn-danger" disabled={!!busy || !acknowledged || phrase !== preview.confirmation || !preview.rows.some(row => row.count)} onClick={execute}>{busy === 'execute' ? 'Запуск…' : 'Создать резервную копию и очистить'}</button>
    </section>}
  </div>;
}
