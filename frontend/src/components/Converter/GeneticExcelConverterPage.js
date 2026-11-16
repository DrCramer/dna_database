import PageHeader from '../Layout/PageHeader';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';
import { normalizedExcelFilename } from '../../../../src/utils/normalizedExcelLayout';
import ConverterSources from './ConverterSources';
import SourceYear from './SourceYear';
import SourceObjectNumber from './SourceObjectNumber';
import { FORMAT as PREVIEW_FORMAT, unpackConverterPreview } from '../../../../src/utils/converterPreviewTransport';
import { converterFileSummary } from '../../../../src/utils/converterPresentation';
import ConverterIssues from './ConverterIssues';
import ConverterGrid from './ConverterGrid';
import ConverterReferenceSettings from './ConverterReferenceSettings';
const counters = { files: 'Файлов', sheets: 'Листов', originalRows: 'Исходных строк', uniqueObjects: 'Объектов', sourceLoci: 'Локусов источника', unchanged: 'Без изменений', autoFixed: 'Исправлено автоматически', warnings: 'Предупреждений', unresolved: 'Нерешённых', conflicts: 'Конфликтов' };
export default function GeneticExcelConverterPage({ onPreparedFile, initialFiles, embedded = false }) {
  const { activeDepartment, activeDepartmentId, user, workspaceMode, workspaceModeReady } = useAuth();
  const [files, setFiles] = useState([]), [options, setOptions] = useState({}), [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [hideEmptyLoci, setHideEmptyLoci] = useState(true);
  const [draftYears, setDraftYears] = useState({}), [draftObjects, setDraftObjects] = useState({});
  const [previewStale, setPreviewStale] = useState(false);
  const previewAttempt = useRef(null);
  const fileSummary = useMemo(() => converterFileSummary(result), [result]);
  const [reviewFile, setReviewFile] = useState(null);
  const [reviewTab, setReviewTab] = useState(null), [advanced, setAdvanced] = useState(false);
  const [output, setOutput] = useState(''), [bulkYear, setBulkYear] = useState('');
  const [dragging, setDragging] = useState(false), [referenceError, setReferenceError] = useState('');
  const dragDepth = useRef(0), reviewArea = useRef(null);
  const [references, setReferences] = useState([]), [populations, setPopulations] = useState([]);
  const request = useRef(null), requestOperation = useRef(null), input = useRef(null);
  const importFormat = (workspaceMode ? 'genetic' : resolveProfileImportFormat(activeDepartment));
  const allowed = ['genetic', 'emergency'].includes(importFormat);
  useEffect(() => { request.current?.abort(); setFiles([]); setOptions({}); setResult(null); setError(''); setBusy(false); setPreviewStale(false); previewAttempt.current = null; if (input.current) input.current.value = ''; return () => request.current?.abort(); }, [workspaceMode ? user.organization_id : activeDepartmentId]);
  useEffect(() => {
    const controller = new AbortController(); setReferences([]); setPopulations([]); setReferenceError('');
    if (importFormat === 'genetic') Promise.all(['', '/populations'].map(async path => {
      const response = await fetch(`/api/allele-references${path}`, { signal: controller.signal, headers: { Authorization: `Bearer ${user?.accessToken || localStorage.getItem('token')}`, 'X-Active-Department-Id': activeDepartmentId } });
      if (!response.ok) throw new Error('Не удалось загрузить справочники.');
      return response.json();
    })).then(([refs, populations]) => { if (!controller.signal.aborted) { setReferences(refs.references); setPopulations(populations.populations); } }).catch(error => { if (!controller.signal.aborted) setReferenceError(error.message); });
    return () => controller.abort();
  }, [activeDepartmentId, allowed]);
  const select = incoming => {
    if (!incoming.length) return;
    if (incoming.length > 100 || incoming.some(file => !/\.(xlsx|xls|txt)$/i.test(file.name) || file.size > 10 * 1024 * 1024) || incoming.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) { setError('Выберите до 100 файлов .xlsx/.xls/.txt: до 10 МиБ каждый и 50 МиБ всего.'); return; }
    request.current?.abort(); setBusy(false); setFiles(incoming); setOptions(previous => ({ reference: previous.reference, txtEncoding: previous.txtEncoding })); setResult(null); setError(''); setReviewTab(null); setOutput(''); setDraftYears({}); setDraftObjects({}); setPreviewStale(false); previewAttempt.current = null;
  };
  useEffect(() => { if (workspaceModeReady && initialFiles?.length) select(initialFiles); }, [initialFiles, workspaceModeReady]);
  useEffect(() => { if (files.length) perform('preview', { ...options, export: { hideEmptyLoci } }); }, [files]);
  useEffect(() => { if (result?.preparedFiles?.length) perform('preview', { ...options, export: { hideEmptyLoci } }); }, [hideEmptyLoci]);
  const perform = async (operation, settings = options) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; requestOperation.current = operation;
    setBusy(true); setError('');
    if (operation === 'preview') { previewAttempt.current = settings; setPreviewStale(true); }
    try {
      const body = new FormData(); files.forEach(file => body.append('files', file)); body.append('options', JSON.stringify(operation === 'preview' ? { ...settings, previewFormat: PREVIEW_FORMAT } : settings));
      const response = await fetch(`/api/genetic-excel-converter/${operation}`, { method: 'POST', body, signal: controller.signal, headers: { Authorization: `Bearer ${user?.accessToken || localStorage.getItem('token')}`, 'X-Active-Department-Id': activeDepartmentId } });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || `Сервер не смог обработать файл (HTTP ${response.status}). Повторите проверку.`); }
      if (operation === 'preview') { const next = unpackConverterPreview(await response.json()); if (!controller.signal.aborted) { setOptions(settings); setResult(next); setPreviewStale(false); } return; }
      const blob = await response.blob();
      if (!controller.signal.aborted) {
        let filename = normalizedExcelFilename(result?.profiles);
        const encoded = (response.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        if (encoded) { try { filename = decodeURIComponent(encoded); } catch { /* Используем имя, рассчитанное по объектам. */ } }
        return { blob, filename };
      }
    } catch (caught) { if (!controller.signal.aborted && request.current === controller) setError(caught.message); }
    finally { if (request.current === controller) setBusy(false); }
  };
  const update = settings => perform('preview', { ...settings, export: { hideEmptyLoci } });
  const download = (blob, filename) => { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const preparedFile = (prepared, direct) => {
    const bytes = Uint8Array.from(atob(prepared.base64), character => character.charCodeAt(0));
    const file = new File([bytes], prepared.filename, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (direct) onPreparedFile({ file, departmentId: activeDepartmentId, ownerId: user.id, organizationId: user.organization_id }); else download(file, prepared.filename);
  };
  const downloadZip = async () => { const exported = await perform('export', { ...options, export: { hideEmptyLoci } }); if (exported) download(exported.blob, 'GeneMapper_Export.zip'); };
  const exportFile = async direct => {
    const exported = await perform('export', { ...options, export: { hideEmptyLoci, legacyOnly: Boolean(result?.preparedFiles?.length) } }); if (!exported) return;
    const { blob, filename } = exported;
    if (direct) onPreparedFile({ file: new File([blob], filename, { type: blob.type }), departmentId: activeDepartmentId, ownerId: user.id, organizationId: user.organization_id });
    else { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  const unresolved = result?.issues.filter(issue => issue.hard).length || 0;
  const sourceNeedsAttention = Boolean(result?.issues.some(issue => issue.hard && !issue.locus));

  const setFileOptions = (id, patch) => update({ ...options, files: { ...options.files, [id]: { ...options.files?.[id], ...patch } } });
  const review = (tab, fileId = null) => {
    setReviewFile(fileId);
    setReviewTab(tab || (sourceNeedsAttention ? 'sources' : 'issues'));
    requestAnimationFrame(() => reviewArea.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const hasLegacy = Boolean(result?.files.some(file => !file.geneMapper));
  const pendingYear = file => draftYears[file.id] !== undefined && draftYears[file.id] !== String(file.year ?? '');
  const pendingObject = file => Boolean(file.ngs && draftObjects[file.id] !== undefined && draftObjects[file.id].trim() !== file.ngs.objectNumber);
  const pendingLegacyYear = Boolean(result?.files.some(file => !file.geneMapper && (pendingYear(file) || pendingObject(file))));
  const outputs = result ? [
    ...(hasLegacy ? [{ id: 'legacy', name: result.files.filter(file => !file.geneMapper).length > 1 ? 'Общий Excel из файлов' : result.files.find(file => !file.geneMapper)?.name, ready: result.legacyCanImport ?? result.canImport, upload: result.legacyCanUpload ?? result.canUpload, pending: pendingLegacyYear }] : []),
    ...(result.preparedFiles || []).map(file => ({ id: file.fileId, name: file.filename, ready: file.ready, upload: file.canUpload, pending: pendingYear(result.files.find(source => source.id === file.fileId)), prepared: file }))
  ] : [];
  const selectedOutput = outputs.find(item => item.id === output) || outputs[0];
  const saveOutput = direct => selectedOutput?.prepared ? preparedFile(selectedOutput.prepared, direct) : exportFile(direct);
  const changeEncoding = value => { const next = { ...options, txtEncoding: value }; if (files.length) update(next); else setOptions(next); };
  const applyBulkYear = () => {
    if (!/^\d{4}$/.test(bulkYear) || Number(bulkYear) < 1900 || Number(bulkYear) > 2100) return;
    const fileOptions = { ...options.files };
    result.files.forEach(file => { fileOptions[file.id] = { ...fileOptions[file.id], year: bulkYear }; });
    setDraftYears({}); update({ ...options, files: fileOptions });
  };
  if (!workspaceModeReady) return <div className="workspace-entry-loading" role="status"><span className="workspace-loading-spinner" aria-hidden="true" />Открываем конвертер…</div>;
  if (!allowed) return <div className="alert alert-info">Выберите отделение «Генетические экспертизы» или «ЧС».</div>;
  return <div className="converter-page" aria-busy={busy}>
    {!embedded && <PageHeader title="Конвертер профилей" description="Подготовьте файлы к загрузке или сохраните нормализованный Excel." />}
    <ol className="converter-steps" aria-label="Этапы конвертации">
      {['Выберите файлы', 'Проверьте данные', 'Сохраните результат'].map((label, index) => <li key={label} aria-current={(result ? 1 : 0) === index ? 'step' : undefined} data-complete={index === 0 && !!files.length}><span>{index + 1}</span>{label}</li>)}
    </ol>
    <section className={`converter-card converter-drop ${dragging ? 'is-dragging' : ''} ${files.length ? 'has-files' : ''}`} aria-label="Файлы для конвертации"
      onDragEnter={event => { event.preventDefault(); dragDepth.current++; setDragging(true); }}
      onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
      onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!busy) select(Array.from(event.dataTransfer.files)); }}>
      <div className="converter-file-picker"><span className="converter-upload-icon" aria-hidden="true">↑</span>
        <div><h2>{files.length ? `Файлов выбрано: ${files.length}` : 'Перетащите файлы сюда'}</h2><p>{files.length ? 'Формат определяется автоматически' : importFormat === 'genetic' ? 'Excel, GeneMapper TXT или NGS ASTR+' : 'GeneMapper TXT'} · до 100 файлов</p><small>До 10 МиБ на файл, 50 МиБ всего</small></div>
        <input ref={input} id="converter-files" type="file" hidden multiple accept={importFormat === 'genetic' ? '.xlsx,.xls,.txt' : '.txt'} disabled={busy} onChange={event => { select(Array.from(event.target.files)); event.target.value = ''; }} />
        <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>{files.length ? 'Заменить файлы' : 'Выбрать файлы'}</button>
      </div>
    </section>
    {error && <div className="alert alert-danger converter-error" role="alert"><span>{error}</span>{!!files.length && <button className="btn btn-secondary" disabled={busy} onClick={() => perform('preview', previewAttempt.current || { ...options, export: { hideEmptyLoci } })}>Повторить проверку</button>}</div>}
    {busy && <div className="converter-processing" role="status"><span className="workspace-loading-spinner" aria-hidden="true" />{requestOperation.current === 'export' ? 'Готовим файл для скачивания…' : result ? 'Обновляем результат проверки…' : 'Распознаём файлы и проверяем профили…'}<button className="btn btn-secondary btn-sm" onClick={() => { request.current?.abort(); setBusy(false); setError('Ожидание операции отменено. Можно повторить проверку или выбрать другие файлы.'); }}>Отменить ожидание</button></div>}
    {result && <>
      <section className="converter-card converter-files-review" aria-label="Проверка файлов">
        <div className="converter-section-heading"><div><h2>Проверка файлов</h2><p>Объектов: <strong>{result.profiles.length}</strong> · {unresolved ? `Требуют решения: ${unresolved}` : 'Данные проверены'}</p></div><button className="btn btn-secondary" disabled={busy} onClick={() => review(unresolved ? undefined : 'genotypes')}>{unresolved ? 'Исправить замечания' : 'Посмотреть генотипы'}</button></div>
        {result.files.length > 1 && <div className="converter-bulk-year"><label>Год для всех файлов<input className="form-input" type="number" min="1900" max="2100" placeholder="2026" value={bulkYear} disabled={busy} onChange={event => setBulkYear(event.target.value)} /></label><button className="btn btn-secondary btn-sm" disabled={busy || !/^\d{4}$/.test(bulkYear) || +bulkYear < 1900 || +bulkYear > 2100} onClick={applyBulkYear}>Применить ко всем</button><span>Или укажите год отдельно для каждого файла ниже.</span></div>}
        <div className="converter-file-list">{result.files.map(file => {
          const { prepared, count, hard, reason } = fileSummary.get(file.id);
          return <article className="converter-file-row" key={file.id}><div className="converter-file-info"><span className="converter-format-label">{file.geneMapper ? 'TXT' : file.ngs ? 'ASTR+' : 'Excel'}</span><div><h3>{file.name}</h3><p>Объектов: {count}{prepared?.excluded > 0 && ` · исключено: ${prepared.excluded}`}</p>{hard > 0 && reason && <p className="converter-file-problem">{reason}</p>}<button className="converter-text-button" disabled={busy} onClick={() => review('sources', file.id)}>{hard ? `Замечания: ${hard}` : prepared?.excluded ? 'Посмотреть исключённые образцы' : 'Параметры файла'}</button></div></div><div className="converter-file-controls">{file.ngs && <SourceObjectNumber key={`${file.id}:${file.ngs.objectNumber || ''}:${file.ngs.objectConfirmed}`} file={file} disabled={busy} apply={objectNumber => { setDraftObjects(current => ({ ...current, [file.id]: objectNumber })); setFileOptions(file.id, { objectNumber, objectConfirmed: true }); }} onDraftChange={value => setDraftObjects(current => ({ ...current, [file.id]: value }))} />}<SourceYear key={`${file.id}:${file.year ?? ''}`} file={file} disabled={busy} apply={year => setFileOptions(file.id, { year })} onDraftChange={year => setDraftYears(previous => ({ ...previous, [file.id]: year }))} /></div></article>;
        })}</div>
      </section>
      {unresolved > 0 && <div className="converter-review-notice" role="status"><span>Проверьте замечания перед выгрузкой. Доступность каждого файла указана ниже.</span><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => review()}>Перейти к замечаниям</button></div>}
      <section className="converter-card converter-save" aria-label="Сохранение результата"><div className="converter-section-heading"><div><h2>Сохранить результат</h2><p>Скачайте Excel или передайте его на экран загрузки профилей.</p></div></div>
        {outputs.length > 1 && <label className="converter-output-select">Результат для сохранения<select className="form-input" disabled={busy} value={selectedOutput?.id || ''} onChange={event => setOutput(event.target.value)}>{outputs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label className="converter-export-toggle"><input type="checkbox" checked={hideEmptyLoci} disabled={busy} onChange={event => { if (result?.preparedFiles?.length) setPreviewStale(true); setHideEmptyLoci(event.target.checked); }} />Скрывать пустые локусы в Excel</label>
        <div className="converter-save-actions"><button className="btn btn-primary" disabled={busy || previewStale || !selectedOutput?.ready || selectedOutput.pending} onClick={() => saveOutput(false)}>Скачать Excel</button>{onPreparedFile && <button className="btn btn-secondary" disabled={busy || previewStale || !selectedOutput?.upload || selectedOutput.pending} onClick={() => saveOutput(true)}>Перейти к загрузке</button>}{result.preparedFiles?.length > 1 && <button className="btn btn-secondary" disabled={busy || previewStale || !result.preparedFiles.some(file => file.ready) || result.files.some(file => file.geneMapper && pendingYear(file))} onClick={downloadZip}>Скачать готовые Excel (ZIP)</button>}</div>
        {previewStale && !busy && <p className="converter-hint" role="status">Результат не обновлён. Повторите проверку перед сохранением.</p>}
        {selectedOutput && (!selectedOutput.upload || selectedOutput.pending) && <p className="converter-hint">{selectedOutput.pending ? 'Подтвердите изменённые номер объекта и год перед сохранением.' : !selectedOutput.ready ? 'Исправьте замечания, чтобы сохранить выбранный результат.' : 'Для загрузки в базу подтвердите год исследования в каждом файле.'}</p>}
        <p className="converter-hint">Скачивание не добавляет профили в базу. На экране загрузки вы сможете выбрать объекты.</p>
      </section>
      <section className="converter-review" ref={reviewArea} aria-label="Просмотр и проверка данных">
        <div className="converter-review-toolbar"><strong>Данные файлов</strong><button className="converter-text-button" onClick={() => setReviewTab(reviewTab ? null : 'genotypes')}>{reviewTab ? 'Свернуть просмотр' : 'Открыть просмотр'}</button></div>
        {reviewTab && <><div className="converter-review-tabs" role="tablist" aria-label="Данные конвертера">{[['genotypes', 'Генотипы'], ['issues', `Замечания${unresolved ? ` (${unresolved})` : ''}`], ['sources', 'Образцы и распознавание']].map(([id, label]) => <button key={id} id={`converter-tab-${id}`} role="tab" aria-selected={reviewTab === id} aria-controls="converter-review-panel" tabIndex={reviewTab === id ? 0 : -1} onKeyDown={event => { const ids = ['genotypes', 'issues', 'sources']; const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (offset) { event.preventDefault(); const next = ids[(ids.indexOf(id) + offset + ids.length) % ids.length]; setReviewTab(next); document.getElementById(`converter-tab-${next}`)?.focus(); } }} onClick={() => setReviewTab(id)}>{label}</button>)}</div><div id="converter-review-panel" role="tabpanel" aria-labelledby={`converter-tab-${reviewTab}`}>
          {reviewTab === 'genotypes' && <ConverterGrid result={result} options={options} update={update} disabled={busy} />}
          {reviewTab === 'issues' && <ConverterIssues result={result} options={options} update={update} disabled={busy} />}
          {reviewTab === 'sources' && <ConverterSources key={reviewFile || 'default'} initialFileId={reviewFile} result={result} options={options} update={update} disabled={busy} />}
        </div></>}
      </section>
    </>}
    <details className="converter-disclosure converter-advanced" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}><summary>Настройки конвертации<span>Кодировка TXT, распознавание аллелей и справочники</span></summary>
      {advanced && <><div className="converter-card"><div className="converter-source-controls"><label>Кодировка TXT<select className="form-input" value={options.txtEncoding || 'auto'} disabled={busy} onChange={event => changeEncoding(event.target.value)}><option value="auto">Автоматически</option><option value="utf-8">UTF-8</option><option value="windows-1251">Windows-1251</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label></div><p className="converter-hint">Обычно менять настройки не требуется. При смене параметров файлы проверяются заново.</p></div>
      {referenceError && <p role="alert">{referenceError} Автоматическая проверка файлов остаётся доступна.</p>}
      {importFormat === 'genetic' && <ConverterReferenceSettings references={references} populations={populations} options={options} result={result} disabled={busy} update={settings => result ? update(settings) : setOptions(settings)} />}
      {result && <details><summary>Сводка обработки</summary><dl className="converter-technical-summary">{Object.entries(counters).map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{result.summary[key]}</dd></React.Fragment>)}</dl></details>}</>}
    </details>
  </div>;
}
