import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';
import { normalizedExcelFilename } from '../../../../src/utils/normalizedExcelLayout';
import ConverterSources from './ConverterSources';
import SourceYear from './SourceYear';
import ConverterIssues from './ConverterIssues';
import ConverterGrid from './ConverterGrid';
import ConverterReferenceSettings from './ConverterReferenceSettings';
const counters = { files: 'Файлов', sheets: 'Листов', originalRows: 'Исходных строк', uniqueObjects: 'Объектов', sourceLoci: 'Локусов источника', unchanged: 'Без изменений', autoFixed: 'Исправлено автоматически', warnings: 'Предупреждений', unresolved: 'Нерешённых', conflicts: 'Конфликтов' };
export default function GeneticExcelConverterPage({ onPreparedFile, initialFiles, embedded = false }) {
  const { activeDepartment, activeDepartmentId, user } = useAuth();
  const [files, setFiles] = useState([]), [options, setOptions] = useState({}), [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [hideEmptyLoci, setHideEmptyLoci] = useState(true);
  const [draftYears, setDraftYears] = useState({});
  const [openSources, setOpenSources] = useState(false), [openIssues, setOpenIssues] = useState(false);
  const [references, setReferences] = useState([]), [populations, setPopulations] = useState([]);
  const request = useRef(null), input = useRef(null);
  const importFormat = resolveProfileImportFormat(activeDepartment);
  const allowed = ['genetic', 'emergency'].includes(importFormat);
  useEffect(() => { request.current?.abort(); setFiles([]); setOptions({}); setResult(null); setError(''); setBusy(false); if (input.current) input.current.value = ''; return () => request.current?.abort(); }, [activeDepartmentId]);
  useEffect(() => {
    const controller = new AbortController(); setReferences([]); setPopulations([]);
    if (importFormat === 'genetic') Promise.all(['', '/populations'].map(async path => {
      const response = await fetch(`/api/allele-references${path}`, { signal: controller.signal, headers: { Authorization: `Bearer ${user?.accessToken || localStorage.getItem('token')}`, 'X-Active-Department-Id': activeDepartmentId } });
      if (!response.ok) throw new Error('Не удалось загрузить справочники.');
      return response.json();
    })).then(([refs, populations]) => { if (!controller.signal.aborted) { setReferences(refs.references); setPopulations(populations.populations); } }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [activeDepartmentId, allowed]);
  const select = incoming => {
    if (incoming.length > 100 || incoming.some(file => !/\.(xlsx|xls|txt)$/i.test(file.name) || file.size > 10 * 1024 * 1024) || incoming.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) { setError('Выберите до 100 файлов .xlsx/.xls/.txt: до 10 МиБ каждый и 50 МиБ всего.'); return; }
    request.current?.abort(); setBusy(false); setFiles(incoming); setOptions(previous => ({ reference: previous.reference, txtEncoding: previous.txtEncoding })); setResult(null); setError(''); setOpenSources(false); setOpenIssues(false); setDraftYears({});
  };
  useEffect(() => { if (initialFiles?.length) select(initialFiles); }, [initialFiles]);
  useEffect(() => { if (files.some(file => /\.txt$/i.test(file.name))) perform('preview', { ...options, export: { hideEmptyLoci } }); }, [files]);
  useEffect(() => { if (result?.preparedFiles?.length) perform('preview', { ...options, export: { hideEmptyLoci } }); }, [hideEmptyLoci]);
  const perform = async (operation, settings = options) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const body = new FormData(); files.forEach(file => body.append('files', file)); body.append('options', JSON.stringify(settings));
      const response = await fetch(`/api/genetic-excel-converter/${operation}`, { method: 'POST', body, signal: controller.signal, headers: { Authorization: `Bearer ${user?.accessToken || localStorage.getItem('token')}`, 'X-Active-Department-Id': activeDepartmentId } });
      if (!response.ok) { const data = await response.json(); throw new Error(data.message || 'Ошибка конвертации.'); }
      if (operation === 'preview') { const next = await response.json(); if (!controller.signal.aborted) { setOptions(settings); setResult(next); } return; }
      const blob = await response.blob();
      if (!controller.signal.aborted) {
        let filename = normalizedExcelFilename(result?.profiles);
        const encoded = (response.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        if (encoded) { try { filename = decodeURIComponent(encoded); } catch { /* Используем имя, рассчитанное по объектам. */ } }
        return { blob, filename };
      }
    } catch (caught) { if (caught.name !== 'AbortError') setError(caught.message); }
    finally { if (request.current === controller) setBusy(false); }
  };
  const update = settings => perform('preview', { ...settings, export: { hideEmptyLoci } });
  const download = (blob, filename) => { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const preparedFile = (prepared, direct) => {
    const bytes = Uint8Array.from(atob(prepared.base64), character => character.charCodeAt(0));
    const file = new File([bytes], prepared.filename, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (direct) onPreparedFile({ file, departmentId: activeDepartmentId, ownerId: user.id }); else download(file, prepared.filename);
  };
  const downloadZip = async () => { const exported = await perform('export', { ...options, export: { hideEmptyLoci } }); if (exported) download(exported.blob, 'GeneMapper_Export.zip'); };
  const exportFile = async direct => {
    const exported = await perform('export', { ...options, export: { hideEmptyLoci, legacyOnly: Boolean(result?.preparedFiles?.length) } }); if (!exported) return;
    const { blob, filename } = exported;
    if (direct) onPreparedFile({ file: new File([blob], filename, { type: blob.type }), departmentId: activeDepartmentId, ownerId: user.id });
    else { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  const unresolved = result?.issues.filter(issue => issue.hard).length || 0;
  const hasWarnings = Boolean(result?.issues.some(issue => issue.status === 'WARNING'));
  const sourceNeedsAttention = Boolean(result?.issues.some(issue => issue.hard && !issue.locus));
  useEffect(() => { if (sourceNeedsAttention) setOpenSources(true); }, [sourceNeedsAttention]);
  const setFileOptions = (id, patch) => update({ ...options, files: { ...options.files, [id]: { ...options.files?.[id], ...patch } } });
  const review = () => {
    if (sourceNeedsAttention) setOpenSources(true); else setOpenIssues(true);
    document.getElementById(sourceNeedsAttention ? 'converter-sources' : 'converter-issues')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const hasLegacy = Boolean(result?.files.some(file => !file.geneMapper));
  const pendingYear = file => draftYears[file.id] !== undefined && draftYears[file.id] !== String(file.year ?? '');
  const pendingLegacyYear = Boolean(result?.files.some(file => !file.geneMapper && pendingYear(file)));
  if (!allowed) return <div className="alert alert-info">Выберите отделение «Генетические экспертизы» или «ЧС».</div>;
  return <div className="converter-page" aria-busy={busy}>
    {!embedded && <header className="page-header"><div><h1>Подготовка профилей</h1><p>Выберите файл, проверьте результат и перейдите к загрузке.</p></div></header>}
    <section className="converter-card converter-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) select(Array.from(event.dataTransfer.files)); }}>
      <div className="converter-file-picker">
        <div><strong>{files.length ? `Выбрано файлов: ${files.length}` : importFormat === 'genetic' ? 'Excel или GeneMapper TXT' : 'GeneMapper TXT'}</strong><p>{busy ? 'Подготовка файлов…' : 'До 100 файлов · 10 МиБ на файл'}</p></div>
        <input ref={input} id="converter-files" type="file" hidden multiple accept={importFormat === 'genetic' ? '.xlsx,.xls,.txt' : '.txt'} disabled={busy} onChange={event => select(Array.from(event.target.files))} />
        <button className="btn btn-secondary" disabled={busy} onClick={() => input.current?.click()}>{files.length ? 'Выбрать другие файлы' : 'Выбрать файлы'}</button>
        {files.length > 0 && !result && !files.some(file => /\.txt$/i.test(file.name)) && <button className="btn btn-primary" disabled={busy} onClick={() => perform('preview')}>Подготовить</button>}
      </div>
    </section>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {result && <>
      <section className="converter-results" aria-label="Результат подготовки" aria-busy={busy}>
        {result.files.map(file => {
          const prepared = result.preparedFiles?.find(item => item.fileId === file.id);
          const profiles = result.profiles.filter(profile => profile.sources.some(source => source.fileId === file.id));
          const needsReview = file.geneMapper?.samples.filter(sample => sample.included && !sample.exportable).length || 0;
          return <article className="converter-card converter-result" key={file.id}>
            <div className="converter-result-heading"><div><h2>{file.name}</h2><p>{file.geneMapper ? 'GeneMapper TXT' : file.ngs ? 'NGS ASTR+' : 'Excel'}{prepared ? ` · Готово: ${prepared.profiles}` : ` · Объектов: ${profiles.length}`}</p></div>
              <SourceYear file={file} disabled={busy} apply={year => setFileOptions(file.id, { year })} onDraftChange={year => setDraftYears(previous => ({ ...previous, [file.id]: year }))} />
            </div>
            {prepared && <>
              {prepared.excluded > 0 && <p className="converter-exclusions">Не включено: {prepared.excluded}{needsReview > 0 ? ` · Нужна проверка: ${needsReview}` : ' (служебные или пустые образцы)'}. <button className="converter-text-button" onClick={() => { if (needsReview) { review(); return; } setOpenSources(true); document.getElementById('converter-sources')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{needsReview ? 'Разобрать' : 'Посмотреть'}</button></p>}
              {!prepared.ready && <p role="status">{prepared.reason}</p>}
              <div className="converter-actions">
                <button className="btn btn-primary" disabled={busy || !prepared.canUpload || pendingYear(file)} onClick={() => preparedFile(prepared, true)}>Перейти к загрузке</button>
                <button className="btn btn-secondary" disabled={busy || !prepared.ready || pendingYear(file)} onClick={() => preparedFile(prepared, false)}>Скачать Excel</button>
              </div>
              {prepared.ready && (!prepared.canUpload || pendingYear(file)) && <p className="converter-hint">Подтвердите год, чтобы перейти к загрузке.</p>}
            </>}
          </article>;
        })}
        {result.preparedFiles?.length > 1 && <button className="btn btn-secondary converter-zip" disabled={busy || !result.preparedFiles.some(file => file.ready) || result.files.some(pendingYear)} onClick={downloadZip}>Скачать все ZIP</button>}
        {hasLegacy && <div className="converter-card"><div className="converter-actions"><button className="btn btn-primary" disabled={busy || pendingLegacyYear || !(result.legacyCanUpload ?? result.canUpload)} onClick={() => exportFile(true)}>Перейти к загрузке</button><button className="btn btn-secondary" disabled={busy || pendingLegacyYear || !(result.legacyCanImport ?? result.canImport)} onClick={() => exportFile(false)}>Скачать Excel</button></div>{(pendingLegacyYear || !(result.legacyCanUpload ?? result.canUpload)) && <p className="converter-hint">Подтвердите год каждого файла и разрешите нерешённые вопросы.</p>}</div>}
      </section>
      {unresolved > 0 && hasLegacy && <div className="converter-review-notice" role="status"><span>Есть нерешённые вопросы: {unresolved}. {result.preparedFiles?.some(file => file.ready) ? 'Допустимые профили уже доступны выше.' : 'Проверьте данные перед загрузкой.'}</span><button className="btn btn-secondary" onClick={review}>Разобрать</button></div>}
      <details id="converter-sources" className="converter-disclosure" open={openSources} onToggle={event => setOpenSources(event.currentTarget.open)}><summary>Образцы, исключения и панели</summary>{openSources && <ConverterSources result={result} options={options} update={update} disabled={busy} />}</details>
      <details id="converter-issues" className="converter-disclosure" open={openIssues} onToggle={event => setOpenIssues(event.currentTarget.open)}><summary>Диагностика и исправления{unresolved > 0 ? ` · нерешённых: ${unresolved}` : hasWarnings ? ' · есть предупреждения' : ''}</summary>{openIssues && <ConverterIssues result={result} options={options} update={update} disabled={busy} />}</details>
      <details className="converter-disclosure"><summary>Просмотреть генотипы · {result.profiles.length}</summary><ConverterGrid result={result} options={options} update={update} disabled={busy} /></details>
    </>}
    <details className="converter-disclosure"><summary>Дополнительные настройки</summary>
      <div className="converter-card">
        <label className="converter-export-toggle"><input type="checkbox" checked={hideEmptyLoci} disabled={busy} onChange={event => setHideEmptyLoci(event.target.checked)} />Скрывать пустые локусы в Excel</label>
        <div className="converter-source-controls"><label>Кодировка TXT<select className="form-input" value={options.txtEncoding || 'auto'} disabled={busy} onChange={event => { const next = { ...options, txtEncoding: event.target.value }; if (files.length) update(next); else setOptions(next); }}><option value="auto">Автоматически</option><option value="windows-1251">Windows-1251</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label></div>
        <p className="converter-hint">Excel, NGS ASTR+ и GeneMapper TXT. До 50 МиБ суммарно. Скачивание и подготовка не сохраняют профили в базу.</p>
        {files.length > 0 && <button className="btn btn-secondary" disabled={busy} onClick={() => perform('preview')}>Проверить повторно</button>}
      </div>
      {importFormat === 'genetic' && <ConverterReferenceSettings references={references} populations={populations} options={options} result={result} disabled={busy} update={settings => result ? update(settings) : setOptions(settings)} />}
      {result && <details><summary>Техническая сводка</summary><dl className="converter-technical-summary">{Object.entries(counters).map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{result.summary[key]}</dd></React.Fragment>)}</dl></details>}
    </details>
  </div>;
}
