import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';
import { normalizedExcelFilename } from '../../../../src/utils/normalizedExcelLayout';
import ConverterSources from './ConverterSources';
import ConverterIssues from './ConverterIssues';
import ConverterGrid from './ConverterGrid';
import ConverterReferenceSettings from './ConverterReferenceSettings';
const counters = { files: 'Файлов', sheets: 'Листов', originalRows: 'Исходных строк', uniqueObjects: 'Объектов', sourceLoci: 'Локусов источника', unchanged: 'Без изменений', autoFixed: 'Исправлено автоматически', warnings: 'Предупреждений', unresolved: 'Нерешённых', conflicts: 'Конфликтов' };
export default function GeneticExcelConverterPage({ onPreparedFile, initialFiles, embedded = false }) {
  const { activeDepartment, activeDepartmentId, user } = useAuth();
  const [files, setFiles] = useState([]), [options, setOptions] = useState({}), [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [hideEmptyLoci, setHideEmptyLoci] = useState(true);
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
    request.current?.abort(); setBusy(false); setFiles(incoming); setOptions(previous => ({ reference: previous.reference, txtEncoding: previous.txtEncoding })); setResult(null); setError('');
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
  if (!allowed) return <div className="alert alert-info">Выберите отделение «Генетические экспертизы» или «ЧС».</div>;
  return <div className="converter-page" aria-busy={busy}><header className="page-header"><div><h1>{embedded ? 'Подготовка GeneMapper TXT' : 'Конвертер генетических профилей'}</h1><p>{importFormat === 'genetic' ? 'Excel, NGS ASTR+ и GeneMapper TXT: проверка генотипов и подготовка к загрузке.' : 'GeneMapper TXT для ЧС: заполните обязательные метаданные перед передачей в обычный импорт.'}</p></div></header>
    {importFormat === 'genetic' && <ConverterReferenceSettings references={references} populations={populations} options={options} result={result} disabled={busy} update={settings => result ? update(settings) : setOptions(settings)} />}
    <section className="converter-card converter-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) select(Array.from(event.dataTransfer.files)); }}>
      <label htmlFor="converter-files">Перетащите файлы или выберите их</label><input ref={input} id="converter-files" type="file" multiple accept={importFormat === 'genetic' ? '.xlsx,.xls,.txt' : '.txt'} disabled={busy} onChange={event => select(Array.from(event.target.files))} /><p>До 100 файлов, 10 МиБ каждый, 50 МиБ всего. Исходные файлы сохраняются без изменений.</p>
      <label>Кодировка GeneMapper TXT<select className="form-input" value={options.txtEncoding || 'auto'} disabled={busy} onChange={event => { const next = { ...options, txtEncoding: event.target.value }; if (files.length) update(next); else setOptions(next); }}><option value="auto">Автоматически (UTF-8 / UTF-16 с BOM)</option><option value="windows-1251">Windows-1251 — выбрать явно</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>
      <ul>{files.map((file, index) => <li key={`${index}-${file.name}`}>{file.name}</li>)}</ul><button className="btn btn-primary" disabled={busy || !files.length} onClick={() => perform('preview')}>{busy ? 'Обработка…' : 'Проверить файлы'}</button>
    </section>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {result?.preparedFiles?.length > 0 && <section className="converter-card" aria-live="polite"><h2>Подготовленные XLSX GeneMapper</h2>
      <p>Каждый TXT обработан отдельно. В XLSX включены только допустимые профили; причины исключения показаны ниже. Файлы пересоздаются после каждого решения. В базу ещё ничего не записано.</p>
      {result.preparedFiles.map(prepared => <div className="converter-prepared-file" key={prepared.fileId}><strong>{prepared.filename}</strong><p>Включено: {prepared.profiles} · исключено или требует проверки: {prepared.excluded}</p>
        {prepared.ready ? <div className="converter-actions"><button className="btn btn-primary" disabled={busy} onClick={() => preparedFile(prepared, false)}>Скачать XLSX</button><button className="btn btn-secondary" disabled={busy || !prepared.canUpload} onClick={() => preparedFile(prepared, true)}>Передать в загрузку профилей</button>{!prepared.canUpload && <span>Подтвердите год исследования в источнике.</span>}</div> : <p role="status">{prepared.reason}</p>}
      </div>)}
      {result.preparedFiles.length > 1 && <button className="btn btn-primary" disabled={busy || !result.preparedFiles.some(file => file.ready)} onClick={downloadZip}>Скачать все ZIP</button>}
    </section>}
    {result && <><div className="converter-summary" aria-live="polite">{Object.entries(counters).map(([key, label]) => <div className="converter-counter" key={key}><strong>{result.summary[key]}</strong><span>{label}</span></div>)}</div><ConverterSources result={result} options={options} update={update} disabled={busy} /><ConverterIssues result={result} options={options} update={update} disabled={busy} /><ConverterGrid result={result} options={options} update={update} disabled={busy} />
      <section className="converter-card"><label className="converter-export-toggle"><input type="checkbox" checked={hideEmptyLoci} disabled={busy} onChange={event => setHideEmptyLoci(event.target.checked)} />Скрывать пустые локусы в Excel</label><p>Скрываются только столбцы, пустые у всех объектов. При необходимости их можно показать в Excel.</p>{result.files.some(file => !file.geneMapper) && <div className="converter-actions"><button className="btn btn-primary" disabled={busy || !(result.legacyCanImport ?? result.canImport)} onClick={() => exportFile(false)}>Скачать нормализованный Excel</button><button className="btn btn-primary" disabled={busy || !(result.legacyCanUpload ?? result.canUpload)} onClick={() => exportFile(true)}>Передать в загрузку профилей</button></div>}<p>{result.canUpload ? 'В Excel включены только генотипы. Диагностика доступна в конвертере. На странице загрузки выберите задачу и панель при необходимости, затем проверьте результат обычного импорта.' : result.canImport ? 'Укажите год исследования для каждого файла в блоке «Источники и панели». После этого можно передать профили в загрузку. При скачивании без указанного года заполните колонку «Год» вручную.' : result.preparedFiles?.length ? 'TXT: допустимые профили уже подготовлены выше. Проблемные профили исключены до ручного решения.' : 'Разрешите все ошибки, неоднозначности и конфликты перед экспортом.'}</p></section></>}
  </div>;
}
