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
  const [personalMode, setPersonalMode] = useState('user'), [personalUserId, setPersonalUserId] = useState('');
  const [users, setUsers] = useState([]), [usersLoading, setUsersLoading] = useState(true), [usersError, setUsersError] = useState('');
  const [personalYear, setPersonalYear] = useState(''), [years, setYears] = useState([]), [yearsLoading, setYearsLoading] = useState(false), [yearsError,setYearsError] = useState(''), [undatedCount,setUndatedCount] = useState(0);
  const targeted = selection.includes('personal') && personalMode === 'user';
  const personalScope = selection.includes('personal') ? personalMode === 'user' ? {mode:'user',userId:personalUserId,...(personalYear && personalYear !== 'all' ? {year:Number(personalYear)} : {})} : {mode:'all'} : null;
  const previewMatches = preview => (!targeted || !!personalYear) && preview && preview.categories.length === selection.length && selection.every(key => preview.categories.includes(key)) && JSON.stringify(preview.personalScope || null) === JSON.stringify(personalScope);
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

  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    setUsersLoading(true); setUsersError('');
    request('/users', {signal:controller.signal}).then(data => { if (!controller.signal.aborted) setUsers(data.users); })
      .catch(failure => { if (!controller.signal.aborted) setUsersError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setUsersLoading(false); });
    return () => controller.abort();
  }, [admin, user?.id]);
  useEffect(() => {
    const controller = new AbortController();
    setYears([]);setYearsError('');setUndatedCount(0);setPersonalYear('');resetPreview();
    if (!admin || !targeted || !personalUserId) {setYearsLoading(false);return () => controller.abort();}
    setYearsLoading(true);
    request('/users/'+encodeURIComponent(personalUserId)+'/years',{signal:controller.signal})
      .then(data => {if(!controller.signal.aborted){setYears(data.years);setUndatedCount(data.undatedCount);}})
      .catch(failure => {if(!controller.signal.aborted)setYearsError(failure.message);})
      .finally(() => {if(!controller.signal.aborted)setYearsLoading(false);});
    return () => controller.abort();
  }, [admin,targeted,personalUserId]);
  function resetPreview() { setPreview(null); setPhrase(''); setAcknowledged(false); setError(''); }
  async function inspect() {
    setBusy('preview'); setError(''); setPreview(null); setPhrase(''); setAcknowledged(false);
    try { setPreview(await request('/preview?categories='+encodeURIComponent(selection.join(','))+(personalScope ? '&personalMode='+personalScope.mode+(targeted ? '&personalUserId='+encodeURIComponent(personalUserId)+(personalScope.year != null ? '&year='+personalScope.year : '') : '') : ''))); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  async function execute() {
    if (!previewMatches(preview)) return;
    setBusy('execute'); setError('');
    try {
      const data = await request('/execute', { method: 'POST', body: JSON.stringify({ personalScope, categories: selection, token: preview.token, confirmation: phrase, acknowledged }) });
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
    resetPreview();
    setSelection(previous => checked ? [...(key === 'personal' && personalMode === 'user' ? previous.filter(value => !['master','staff'].includes(value)) : previous), key] : previous.filter(value => value !== key));
  }
  return <div className="master-export-page database-maintenance-page">
    <header className="page-header"><div><h1 className="page-title">Очистка данных</h1><p>Выберите данные для очистки. Пользователи и настройки сохранятся.</p></div></header>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    <section className="card master-export-card">
      <h2>Что очистить</h2>
      <p>{targeted ? 'Будут очищены только личные данные выбранного пользователя. Общие массивы сохранятся.' : 'Можно выбрать несколько категорий. Выбор действует для всех пользователей и отделений этой установки.'}</p>
      <fieldset className="maintenance-categories"><legend className="visually-hidden">Категории очистки</legend>{categories.map(category => <label key={category.key}>
        <input type="checkbox" checked={selection.includes(category.key) || category.key === 'results' && removesGenotypes} disabled={!!busy || running || targeted && ['master','staff'].includes(category.key) || category.key === 'results' && removesGenotypes} onChange={event => choose(category.key, event.target.checked)} />
        <span><strong>{category.label}</strong><small>{category.key === 'results' && removesGenotypes ? targeted ? 'Сбрасываются результаты выбранного пользователя и записи, связанные с удаляемыми профилями.' : 'Результаты сбрасываются автоматически при удалении генотипов, чтобы не оставалось устаревших совпадений.' : category.hint}</small></span>
      </label>)}</fieldset>
      {selection.includes('personal') && <fieldset className="maintenance-personal-scope"><legend>Чьи личные генотипы очистить</legend>
        <div className="maintenance-scope-options"><label><input type="radio" name="personal-scope" checked={personalMode === 'user'} disabled={!!busy || running} onChange={() => {resetPreview();setPersonalMode('user');setSelection(previous => previous.filter(key => !['master','staff'].includes(key)));}} />Конкретный пользователь</label>
        <label><input type="radio" name="personal-scope" checked={personalMode === 'all'} disabled={!!busy || running} onChange={() => {resetPreview();setPersonalMode('all');}} />Все пользователи</label></div>
        {targeted && <label>Пользователь<select className="form-input" value={personalUserId} disabled={!!busy || running || usersLoading} onChange={event => {resetPreview();setPersonalYear('');setPersonalUserId(event.target.value);}}>
          <option value="">{usersLoading ? 'Загрузка пользователей…' : 'Выберите пользователя'}</option>{users.map(person => <option key={person.id} value={person.id}>{person.display_name ? `${person.display_name} (${person.username})` : person.username}{person.organization_name ? ` · ${person.organization_name}` : ''}{person.is_active ? '' : ' · неактивен'}</option>)}
        </select></label>}
        {targeted && personalUserId && <label>Год исследования<select className="form-input" value={personalYear} disabled={!!busy || running || yearsLoading || !!yearsError} onChange={event => {resetPreview();setPersonalYear(event.target.value);}}>
          <option value="">{yearsLoading ? 'Загрузка годов…' : 'Выберите год'}</option><option value="all">Все годы</option>{years.map(item => <option key={item.year} value={String(item.year)}>{item.year} · объектов: {item.count}</option>)}
        </select></label>}
        {targeted && undatedCount > 0 && <p className="master-export-hint">Без указанного года: {undatedCount}. Эти профили удаляются только при выборе «Все годы».</p>}
        {targeted && yearsError && <div className="alert alert-danger" role="alert">{yearsError}</div>}
        {targeted && usersError && <div className="alert alert-danger" role="alert">{usersError}</div>}
      </fieldset>}
      <div className="alert alert-info">Пользователи, права, настройки, отделения, задачи и справочники сохранятся. Сохранённые расчёты вероятности также сохранятся. Исходные файлы и прежние резервные копии останутся на диске.</div>
      <p>Сначала будет создана и проверена полная резервная копия БД. Если копию создать не удастся, очистка не начнётся. Во время операции работа с данными будет временно приостановлена.</p>
      <button className="btn btn-secondary" disabled={!!busy || running || !selection.length || targeted && (usersLoading || !!usersError || !users.some(person => person.id === personalUserId) || yearsLoading || !!yearsError || !personalYear || personalYear !== 'all' && !years.some(item => String(item.year) === personalYear))} onClick={inspect}>{busy === 'loading' ? 'Проверка состояния…' : busy === 'preview' ? 'Подсчёт данных…' : 'Предварительный просмотр'}</button>
    </section>
    {job && <section className="card master-export-card" aria-live="polite" aria-busy={running}>
      <h2>{phases[job.state] || job.state}</h2>
      {job.targetUser && <p>Пользователь: <strong>{job.targetUser.display_name || job.targetUser.username} ({job.targetUser.username})</strong>.</p>}
      {job.targetUser && <p>Год: <strong>{job.personalScope?.year ?? 'Все годы'}</strong>.</p>}
      {job.categoryLabels && <p>Выбранные категории: <strong>{job.categoryLabels.join(', ')}</strong>.</p>}
      <p>{job.message || (running ? 'Оставьте эту страницу открытой или вернитесь позже: состояние операции сохранится.' : `Начало операции: ${new Date(job.startedAt).toLocaleString('ru-RU')}`)}</p>
      {running && <ol className="maintenance-steps">{['waiting', 'backing_up', 'clearing'].map(state => <li key={state} aria-current={job.state === state ? 'step' : undefined}>{phases[state]}</li>)}</ol>}
      {job.backup && <><p>Резервная копия: {(job.backup.bytes / 1048576).toFixed(1)} МБ. Хранится на сервере в папке резервных копий проекта.</p><button className="btn btn-secondary" disabled={!!busy || running} onClick={download}>{busy === 'download' ? 'Скачивание…' : 'Скачать резервную копию'}</button></>}
    </section>}
    {previewMatches(preview) && !running && <section className="card master-export-card">
      <h2>Предварительный просмотр</h2><p><strong>{preview.scope}</strong>. Выбрано: <strong>{preview.categoryLabels.join(', ')}</strong>. Изменения по связанным данным:</p>
      <div className="maintenance-counts"><table className="data-table"><thead><tr><th>Данные</th><th>Действие</th><th>Записей</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.key}><td>{row.label}</td><td>{row.action === 'delete' ? 'Удаление' : row.action === 'unlink' ? 'Удаление связи с исходником' : 'Сброс'}</td><td>{row.count.toLocaleString('ru-RU')}</td></tr>)}</tbody></table></div>
      <div className="alert alert-info">{preview.targetUser ? 'Сбрасываются только его поиски и согласования, а также результаты, напрямую связанные с удаляемыми профилями. Личные данные остальных сотрудников сохраняются.' : 'Результаты поиска и ожидающие согласования сбрасываются.'} История завершённых согласований и публикаций сохраняется, если её исходники не удаляются. Копии генотипов в невыбранных массивах остаются; связь с удалённым личным исходником будет снята.</div>
      {preview.personalScope?.year != null && <div className="alert alert-info">Удаляются личные генотипы только за {preview.personalScope.year} год. Смешанные поиски и заявки, включающие этот год, сбрасываются целиком. Генотипы остальных лет, черновики и старые записи без надёжной связи с годом сохраняются. После изменения состава личного массива может потребоваться повторный поиск.</div>}
      <p>Просмотр действителен 5 минут. Если данные изменятся, потребуется обновить просмотр.</p>
      <label className="maintenance-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />Я проверил выбранные категории и связанные изменения. {preview.targetUser ? `Личная очистка выполняется для пользователя ${preview.targetUser.display_name || preview.targetUser.username} (${preview.targetUser.username}), ${preview.personalScope?.year != null ? 'год '+preview.personalScope.year : 'все годы'}.` : 'Очистка затронет всех пользователей и отделения этой установки.'}</label>
      <label className="maintenance-phrase">Для подтверждения введите <strong>{preview.confirmation}</strong><input className="form-input" autoComplete="off" value={phrase} onChange={event => setPhrase(event.target.value)} /></label>
      <button className="btn btn-danger" disabled={!!busy || !acknowledged || phrase !== preview.confirmation || !preview.rows.some(row => row.count)} onClick={execute}>{busy === 'execute' ? 'Запуск…' : 'Создать резервную копию и очистить'}</button>
    </section>}
  </div>;
}
