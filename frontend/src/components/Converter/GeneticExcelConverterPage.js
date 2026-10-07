import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';
import ConverterSources from './ConverterSources';
import ConverterIssues from './ConverterIssues';
import ConverterGrid from './ConverterGrid';
const counters = { files: 'Файлов', sheets: 'Листов', originalRows: 'Исходных строк', uniqueObjects: 'Объектов', sourceLoci: 'Локусов источника', unchanged: 'Без изменений', autoFixed: 'Исправлено автоматически', warnings: 'Предупреждений', unresolved: 'Нерешённых', conflicts: 'Конфликтов' };
export default function GeneticExcelConverterPage({ onPreparedFile }) {
  const { activeDepartment, activeDepartmentId, user } = useAuth();
  const [files, setFiles] = useState([]), [options, setOptions] = useState({}), [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(null), input = useRef(null);
  const allowed = resolveProfileImportFormat(activeDepartment) === 'genetic';
  useEffect(() => { request.current?.abort(); setFiles([]); setOptions({}); setResult(null); setError(''); setBusy(false); if (input.current) input.current.value = ''; return () => request.current?.abort(); }, [activeDepartmentId]);
  const select = incoming => {
    if (incoming.length > 20 || incoming.some(file => !/\.(xlsx|xls)$/i.test(file.name) || file.size > 10 * 1024 * 1024) || incoming.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) { setError('Выберите до 20 файлов .xlsx/.xls: до 10 МиБ каждый и 50 МиБ всего.'); return; }
    request.current?.abort(); setBusy(false); setFiles(incoming); setOptions({}); setResult(null); setError('');
  };
  const perform = async (operation, settings = options) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const body = new FormData(); files.forEach(file => body.append('files', file)); body.append('options', JSON.stringify(settings));
      const response = await fetch(`/api/genetic-excel-converter/${operation}`, { method: 'POST', body, signal: controller.signal, headers: { Authorization: `Bearer ${user?.accessToken || localStorage.getItem('token')}`, 'X-Active-Department-Id': activeDepartmentId } });
      if (!response.ok) { const data = await response.json(); throw new Error(data.message || 'Ошибка конвертации.'); }
      if (operation === 'preview') { const next = await response.json(); if (!controller.signal.aborted) { setOptions(settings); setResult(next); } return; }
      const blob = await response.blob(); if (!controller.signal.aborted) return blob;
    } catch (caught) { if (caught.name !== 'AbortError') setError(caught.message); }
    finally { if (request.current === controller) setBusy(false); }
  };
  const update = settings => perform('preview', settings);
  const exportFile = async direct => {
    const blob = await perform('export'); if (!blob) return;
    if (direct) onPreparedFile({ file: new File([blob], 'DNA-normalized.xlsx', { type: blob.type }), departmentId: activeDepartmentId, ownerId: user.id });
    else { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'DNA-normalized.xlsx'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  if (!allowed) return <div className="alert alert-info">Конвертер доступен в отделении «Генетические экспертизы».</div>;
  return <div className="converter-page" aria-busy={busy}><header className="page-header"><div><h1>Конвертер Excel</h1><p>Объединение старых генотипов, проверка значений и подготовка к загрузке.</p></div></header>
    <section className="converter-card converter-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) select(Array.from(event.dataTransfer.files)); }}>
      <label htmlFor="converter-files">Перетащите Excel-файлы или выберите их</label><input ref={input} id="converter-files" type="file" multiple accept=".xlsx,.xls" disabled={busy} onChange={event => select(Array.from(event.target.files))} /><p>До 20 файлов, 10 МиБ каждый, 50 МиБ всего. Исходные файлы сохраняются без изменений.</p>
      <ul>{files.map((file, index) => <li key={`${index}-${file.name}`}>{file.name}</li>)}</ul><button className="btn btn-primary" disabled={busy || !files.length} onClick={() => perform('preview')}>{busy ? 'Обработка…' : 'Проверить и объединить'}</button>
    </section>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {result && <><div className="converter-summary" aria-live="polite">{Object.entries(counters).map(([key, label]) => <div className="converter-counter" key={key}><strong>{result.summary[key]}</strong><span>{label}</span></div>)}</div><ConverterSources result={result} options={options} update={update} disabled={busy} /><ConverterIssues result={result} options={options} update={update} disabled={busy} /><ConverterGrid result={result} options={options} update={update} disabled={busy} />
      <section className="converter-card"><div className="converter-actions"><button className="btn btn-primary" disabled={busy || !result.canImport} onClick={() => exportFile(false)}>Скачать нормализованный Excel</button><button className="btn btn-primary" disabled={busy || !result.canImport} onClick={() => exportFile(true)}>Передать в загрузку профилей</button></div><p>{result.canImport ? 'Предупреждения сохранены в журнале. На странице загрузки выберите задачу и проверьте результат обычного импорта.' : 'Разрешите все ошибки, неоднозначности и конфликты перед экспортом.'}</p></section></>}
  </div>;
}
