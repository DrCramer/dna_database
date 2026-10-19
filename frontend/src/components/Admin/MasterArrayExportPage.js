import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { matchesRoles } from '../../../../src/utils/accessPolicyRules';

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MasterArrayExportPage() {
  const { user, activeDepartmentId } = useAuth();
  const admin = matchesRoles(user, ['admin', 'system_administrator']);
  const [arrays, setArrays] = useState([]), [arrayId, setArrayId] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [scope, setScope] = useState('all'), [yearFrom, setYearFrom] = useState(''), [yearTo, setYearTo] = useState(''), [objectQuery, setObjectQuery] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true), [includeCatalog, setIncludeCatalog] = useState(false);
  const [preview, setPreview] = useState(null), [validOnly, setValidOnly] = useState(false), [confirmed, setConfirmed] = useState(false);
  const request = useRef(null);
  const selected = arrays.find(array => array.id === arrayId);
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, 'X-Active-Department-Id': activeDepartmentId, 'Content-Type': 'application/json' });

  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setArrays([]); setArrayId('');
    fetch('/api/master-arrays/export/options', { signal: controller.signal, headers: headers() })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Не удалось получить массивы.'); return data.arrays; })
      .then(list => { if (!controller.signal.aborted) { setArrays(list); setArrayId((list.find(array => array.department_id === activeDepartmentId) || list[0])?.id || ''); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [admin, activeDepartmentId]);

  useEffect(() => {
    request.current?.abort(); setBusy(''); setPreview(null); setValidOnly(false); setConfirmed(false); setError('');
  }, [arrayId, activeDepartmentId, scope, yearFrom, yearTo, objectQuery, hideEmpty, includeCatalog]);
  useEffect(() => { setScope('all'); setYearFrom(''); setYearTo(''); setObjectQuery(''); }, [arrayId, activeDepartmentId]);
  useEffect(() => () => request.current?.abort(), []);

  const filters = scope === 'all' ? {} : {
    ...(yearFrom !== '' ? { yearFrom: Number(yearFrom) } : {}), ...(yearTo !== '' ? { yearTo: Number(yearTo) } : {}), ...(objectQuery.trim() ? { objectQuery: objectQuery.trim() } : {})
  };
  const body = { filters, options: { hideEmptyLoci: hideEmpty, includeCatalogLoci: includeCatalog, exportValidOnly: validOnly, confirmValidOnly: confirmed,
    ...(preview ? { previewFingerprint: preview.fingerprint } : {}) } };
  const yearsValid = [filters.yearFrom, filters.yearTo].every(year => year == null || Number.isInteger(year) && year >= 1900 && year <= 2100)
    && !(filters.yearFrom != null && filters.yearTo != null && filters.yearFrom > filters.yearTo);

  async function perform(operation) {
    if (busy || !arrayId || !yearsValid) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(operation); setError('');
    try {
      const response = await fetch(`/api/master-arrays/${arrayId}/export/${operation}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json();
        if (failure.code === 'PREVIEW_CHANGED') { setPreview(null); setConfirmed(false); }
        throw new Error(failure.message || 'Не удалось выполнить выгрузку.');
      }
      if (operation === 'preview') { const data = await response.json(); if (!controller.signal.aborted) { setPreview(data); setValidOnly(false); setConfirmed(false); } }
      else {
        const filename = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') || '')?.[1];
        const blob = await response.blob();
        if (!controller.signal.aborted) saveBlob(blob, filename ? decodeURIComponent(filename) : 'Мастер-массив.xlsx');
      }
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  }

  function downloadIssues() {
    const cell = value => { const text = String(value ?? ''); return `"${(/^[\s\u0000-\u001f\u007f-\u009f]*[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`; };
    const rows = [['ID записи', 'Объект', 'Год', 'Причины'], ...preview.reasons.map(reason => [reason.id, reason.objectNumber, reason.year, reason.problems.map(problem => problem.message).join(' ')])];
    saveBlob(new Blob(['\uFEFF', rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'Мастер-массив_проблемные-записи.csv');
  }

  if (!admin) return <div className="alert alert-danger" role="alert">Экспорт мастер-массива доступен только администраторам.</div>;
  const organizations = [...new Map(arrays.map(array => [array.organization_id, array.organization_name])).entries()];
  const departments = [...new Map(arrays.filter(array => array.organization_id === selected?.organization_id).map(array => [array.department_id, array.department_name])).entries()];
  const canDownload = preview?.exportable > 0 && (preview.needsReview === 0 || validOnly && confirmed);
  return <div className="master-export-page">
    <header className="page-header"><div><h1>Экспорт мастер-массива</h1><p>Активные профили в формате штатной загрузки. Данные мастер-массива не изменяются.</p></div></header>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {loading ? <p role="status">Загрузка доступных массивов…</p> : !arrays.length ? <div className="alert alert-info">Нет доступных активных мастер-массивов ЧС или Генетических экспертиз.</div> : <>
      <section className="card master-export-card"><h2>Источник и настройки</h2>
        <div className="master-export-fields">
          <label>Организация<select className="form-input" value={selected?.organization_id || ''} disabled={!!busy} onChange={event => setArrayId(arrays.find(array => array.organization_id === event.target.value)?.id || '')}>{organizations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>Отделение<select className="form-input" value={selected?.department_id || ''} disabled={!!busy} onChange={event => setArrayId(arrays.find(array => array.department_id === event.target.value)?.id || '')}>{departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>Мастер-массив<select className="form-input" value={arrayId} disabled={!!busy} onChange={event => setArrayId(event.target.value)}>{arrays.filter(array => array.department_id === selected?.department_id).map(array => <option key={array.id} value={array.id}>{array.name} · активных: {array.active_profiles}</option>)}</select></label>
        </div>
        <p className="master-export-hint">Активных профилей в массиве: <strong>{selected?.active_profiles ?? 0}</strong>.</p>
        <fieldset className="master-export-scope"><legend>Объём</legend><label><input type="radio" name="master-export-scope" checked={scope === 'all'} disabled={!!busy} onChange={() => setScope('all')} />Все активные</label><label><input type="radio" name="master-export-scope" checked={scope === 'filtered'} disabled={!!busy} onChange={() => setScope('filtered')} />По фильтрам</label></fieldset>
        {scope === 'filtered' && <div className="master-export-fields"><label>Год от<input className="form-input" type="number" min="1900" max="2100" step="1" value={yearFrom} disabled={!!busy} onChange={event => setYearFrom(event.target.value)} /></label><label>Год до<input className="form-input" type="number" min="1900" max="2100" step="1" value={yearTo} disabled={!!busy} onChange={event => setYearTo(event.target.value)} /></label><label>{selected?.importFormat === 'genetic' ? 'Номер объекта или экспертизы' : 'Номер объекта или присвоенный номер'}<input className="form-input" maxLength={100} value={objectQuery} disabled={!!busy} onChange={event => setObjectQuery(event.target.value)} /></label></div>}
        {!yearsValid && <p className="alert alert-danger" role="alert">Укажите годы от 1900 до 2100; начало диапазона не должно быть больше конца.</p>}
        <div className="master-export-checks"><label><input type="checkbox" checked={hideEmpty} disabled={!!busy} onChange={event => setHideEmpty(event.target.checked)} />Скрывать полностью пустые локусы</label><label><input type="checkbox" checked={includeCatalog} disabled={!!busy} onChange={event => setIncludeCatalog(event.target.checked)} />Включить локусы общего каталога</label></div>
        <p className="master-export-hint">По умолчанию включаются все локусы выбранных профилей. Общий каталог добавляет пустые колонки и увеличивает ширину файла.</p>
        <button className="btn btn-secondary" disabled={!!busy || !yearsValid} onClick={() => perform('preview')}>{busy === 'preview' ? 'Проверка всех профилей…' : 'Проверить выгрузку'}</button>
      </section>
      {preview && <section className="card master-export-card" aria-live="polite"><h2>Предпросмотр</h2>
        <dl className="master-export-summary"><div><dt>Выбрано</dt><dd>{preview.totalMatched}</dd></div><div><dt>Готовы к импорту</dt><dd>{preview.exportable}</dd></div><div><dt>Требуют проверки</dt><dd>{preview.needsReview}</dd></div><div><dt>Локусов</dt><dd>{preview.lociCount}</dd></div></dl>
        {!preview.totalMatched ? <p>По выбранным фильтрам нет активных профилей.</p> : <>
          <details><summary>Пример объектов (до 10)</summary><ul>{preview.examples.map(example => <li key={example.id}>{example.objectNumber || 'Без номера'} · {example.year ?? 'Без года'} · {example.ready ? 'Готов' : 'Требует проверки'}</li>)}</ul></details>
          {preview.needsReview > 0 && <div className="master-export-problems"><p>Полная выгрузка заблокирована: проблемных записей — {preview.needsReview}. Их данные не исправляются автоматически.</p>
            <button className="btn btn-secondary" onClick={downloadIssues}>Скачать отчёт о проблемных записях (CSV)</button>
            <details><summary>Причины (первые 100 записей)</summary><ul>{preview.reasons.slice(0, 100).map(reason => <li key={reason.id}><strong>{reason.objectNumber || reason.id} · {reason.year ?? 'без года'}</strong><ul>{reason.problems.map((problem, index) => <li key={index}>{problem.message}</li>)}</ul></li>)}</ul></details>
            {preview.exportable > 0 && <div className="master-export-checks"><label><input type="checkbox" checked={validOnly} disabled={!!busy} onChange={event => { setValidOnly(event.target.checked); setConfirmed(false); }} />Выгрузить только пригодные ({preview.exportable} из {preview.totalMatched})</label>{validOnly && <label><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} />Подтверждаю исключение {preview.needsReview} записей; причины доступны в отчёте.</label>}</div>}
          </div>}
          <p>В файл попадёт строк: {validOnly ? preview.exportable : preview.totalMatched}. Первый лист — «Импорт».</p>
          <button className="btn btn-primary" disabled={!!busy || !canDownload} onClick={() => perform('xlsx')}>{busy === 'xlsx' ? 'Формирование XLSX…' : validOnly ? 'Выгрузить только пригодные (XLSX)' : 'Выгрузить мастер-массив (XLSX)'}</button>
        </>}
      </section>}
    </>}
    {busy && <p role="status">{busy === 'preview' ? 'Проверяется весь выбранный набор…' : 'Формируется файл. Дождитесь завершения…'}</p>}
  </div>;
}
