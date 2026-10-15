import React, { useState } from 'react';

function MetadataInput({ label, value, disabled, apply, numeric }) {
  const [draft, setDraft] = useState(value || '');
  return <label>{label}<input className="form-input" value={draft} inputMode={numeric ? 'numeric' : 'text'} maxLength={numeric ? 12 : 100} disabled={disabled}
    onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft !== (value || '')) apply(draft); }} /></label>;
}
export default function GeneMapperSourcePreview({ file, result, options, update, disabled }) {
  const [page, setPage] = useState(0);
  const gene = file.geneMapper;
  const settings = options.files?.[file.id] || {};
  const set = patch => update({ ...options, files: { ...options.files, [file.id]: { ...settings, ...patch } } });
  const sampleSet = (sample, patch) => set({ samples: { ...settings.samples, [sample.sampleName]: { ...settings.samples?.[sample.sampleName], ...patch } } });
  const needsReview = gene.samples.filter(sample => sample.included && !sample.exportable);
  const [filter, setFilter] = useState(needsReview.length ? 'review' : 'excluded');
  const filtered = gene.samples.filter(sample => filter === 'all' || (filter === 'review' ? sample.included && !sample.exportable : !sample.included));
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 30) - 1));
  return <div className="converter-gene-preview">
    <p className="converter-hint">Панель источника: {gene.panelNames.join(', ') || 'не указана'} · Всего образцов: {gene.summary.totalSamples}</p>
    <details><summary>Настройки GeneMapper</summary>
      <div className="converter-source-controls"><label>Кодировка TXT<select className="form-input" value={settings.encoding || 'auto'} disabled={disabled} onChange={event => set({ encoding: event.target.value })}><option value="auto">Автоматически</option><option value="utf-8">UTF-8</option><option value="windows-1251">Windows-1251</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label></div>
      <label className="converter-export-toggle"><input type="checkbox" checked={settings.confirmHaploidDuplicates === true} disabled={disabled} onChange={event => set({ confirmHaploidDuplicates: event.target.checked })} />Подтверждаю дублированные вызовы Y-маркеров: 10,10 → 10</label>
      <p className="converter-hint">Диплоидные гомозиготы не меняются. Разные значения Y-маркера требуют отдельного решения.</p>
    </details>
    {result.importFormat === 'emergency' && <div className="converter-source-controls"><MetadataInput key={settings.shippingNumber || ''} label="Номер привоза для файла" value={settings.shippingNumber} numeric disabled={disabled} apply={shippingNumber => set({ shippingNumber })} /></div>}
    <div className="converter-actions"><label>Образцы<select className="form-input" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="review">Требуют решения ({needsReview.length})</option><option value="excluded">Исключены ({gene.samples.filter(sample => !sample.included).length})</option><option value="all">Все ({gene.samples.length})</option></select></label></div>
    <div className="converter-scroll"><table className="converter-issue-table"><thead><tr>{['Включить', 'Объект', 'Локусы', 'Состояние', ...(result.importFormat === 'emergency' ? ['Метаданные ЧС'] : []), 'Подробнее'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {filtered.slice(current * 30, current * 30 + 30).map(sample => {
        const profile = result.profiles.find(profile => profile.sources.some(source => source.fileId === file.id && source.geneMapper?.sampleName === sample.sampleName));
        return <tr key={sample.sampleName}><td><input aria-label={`Включить ${sample.sampleName}`} type="checkbox" checked={sample.included} disabled={disabled || sample.empty || ['ladder', 'control'].includes(sample.classification)} onChange={event => sampleSet(sample, { include: event.target.checked })} /></td>
          <th scope="row">{sample.sampleName}<small>{sample.sampleTypes.join(', ')}</small></th>
          <td>{sample.populatedLoci} / {sample.totalLoci}</td><td><strong>{sample.status}</strong><p>{sample.reason}</p>{sample.warnings > 0 && <span>Предупреждений: {sample.warnings}</span>}</td>
          {result.importFormat === 'emergency' && <td><MetadataInput key={sample.emergency.assignedNumber} label={`№ в в/ч ${sample.sampleName}`} value={sample.emergency.assignedNumber} disabled={disabled || !sample.included} apply={assignedNumber => sampleSet(sample, { assignedNumber })} /><MetadataInput key={sample.emergency.shippingNumber} label={`Привоз ${sample.sampleName}`} value={sample.emergency.shippingNumber} numeric disabled={disabled || !sample.included} apply={shippingNumber => sampleSet(sample, { shippingNumber })} /></td>}
          <td><details><summary>Параметры образца</summary><p>{sample.panelNames.join(', ') || 'Панель не указана'}</p><label>Панель<select className="form-input" aria-label={`Панель ${sample.sampleName}`} value={sample.panelId || ''} disabled={disabled} onChange={event => sampleSet(sample, { panelId: event.target.value })}><option value="">Не назначена</option>{sample.panelCandidates.map(panel => <option key={panel.id} value={panel.id}>{panel.name}</option>)}</select></label>{profile && <dl>{profile.sourceLoci.map(locus => <React.Fragment key={locus}><dt>{locus}</dt><dd>{profile.strData[locus]?.join(',') || '—'}</dd></React.Fragment>)}</dl>}</details></td></tr>;
      })}</tbody></table></div>
    {!filtered.length && <p className="converter-hint">Нет образцов с выбранным состоянием.</p>}
    {filtered.length > 30 && <div className="converter-actions"><button className="btn btn-secondary" disabled={!current} onClick={() => setPage(current - 1)}>Назад</button><span>Страница {current + 1} из {Math.max(1, Math.ceil(filtered.length / 30))}</span><button className="btn btn-secondary" disabled={(current + 1) * 30 >= filtered.length} onClick={() => setPage(current + 1)}>Далее</button></div>}
  </div>;
}
