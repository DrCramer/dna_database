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
  const counters = { totalSamples: 'Всего образцов', ordinarySamples: 'Обычных', controls: 'Контролей', ladders: 'Лестниц', serviceNames: 'Служебных обозначений', emptyProfiles: 'Пустых', partialProfiles: 'Частичных', warningProfiles: 'С предупреждениями', readyProfiles: 'Готово к экспорту' };
  const current = Math.min(page, Math.max(0, Math.ceil(gene.samples.length / 30) - 1));
  return <div className="converter-gene-preview">
    <p><strong>Формат: GeneMapper TXT</strong> · {gene.encoding} · Панели источника: {gene.panelNames.join(', ') || 'не указаны'}</p>
    <p>Год из имени файла — только предложение. Подтвердите его полем «Год исследования». Название панели сопоставляется вместе с составом локусов; при отсутствии соответствия панель можно выбрать вручную.</p>
    <div className="converter-summary">{Object.entries(counters).map(([key, label]) => <div className="converter-counter" key={key}><strong>{gene.summary[key]}</strong><span>{label}</span></div>)}</div>
    <div className="converter-source-controls"><label>Кодировка TXT<select className="form-input" value={settings.encoding || 'auto'} disabled={disabled} onChange={event => set({ encoding: event.target.value })}><option value="auto">Автоматически (UTF-8 / UTF-16 BOM)</option><option value="utf-8">UTF-8</option><option value="windows-1251">Windows-1251 — подтвердить</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>
      {result.importFormat === 'emergency' && <MetadataInput key={settings.shippingNumber || ''} label="Номер привоза для файла" value={settings.shippingNumber} numeric disabled={disabled} apply={shippingNumber => set({ shippingNumber })} />}
    </div>
    <label className="converter-export-toggle"><input type="checkbox" checked={settings.confirmHaploidDuplicates === true} disabled={disabled} onChange={event => set({ confirmHaploidDuplicates: event.target.checked })} />Подтверждаю: одинаковые вызовы Y-маркера в этом GeneMapper-файле дублируют один результат (10,10 → 10)</label>
    <p>Это правило не применяется к диплоидным гомозиготам. Различные значения Y-маркера требуют отдельного решения. Аллели 3–5 сохраняются, включая специальные значения; они не подтверждают стандартный диплоидный профиль.</p>
    <div className="converter-scroll"><table className="converter-issue-table"><thead><tr>{['Включить', 'Объект', 'Панель', 'Локусы', 'Предупреждения / статус', ...(result.importFormat === 'emergency' ? ['Метаданные ЧС'] : []), 'Генотип'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {gene.samples.slice(current * 30, current * 30 + 30).map(sample => {
        const profile = result.profiles.find(profile => profile.sources.some(source => source.fileId === file.id && source.geneMapper?.sampleName === sample.sampleName));
        return <tr key={sample.sampleName}><td><input aria-label={`Включить ${sample.sampleName}`} type="checkbox" checked={sample.included} disabled={disabled || sample.empty || ['ladder', 'control'].includes(sample.classification)} onChange={event => sampleSet(sample, { include: event.target.checked })} /></td>
          <th scope="row">{sample.sampleName}<small>{sample.sampleTypes.join(', ')}</small></th>
          <td>{sample.panelNames.join(', ') || 'Не указана'}<select className="form-input" aria-label={`Панель ${sample.sampleName}`} value={sample.panelId || ''} disabled={disabled} onChange={event => sampleSet(sample, { panelId: event.target.value })}><option value="">Не назначена</option>{sample.panelCandidates.map(panel => <option key={panel.id} value={panel.id}>{panel.name} ({panel.matches}/{panel.expected})</option>)}</select></td>
          <td>{sample.populatedLoci} / {sample.totalLoci}</td><td><strong>{sample.status}</strong><p>{sample.reason}</p>{sample.warnings > 0 && <span>Предупреждений: {sample.warnings}</span>}</td>
          {result.importFormat === 'emergency' && <td><MetadataInput key={sample.emergency.assignedNumber} label={`№ в в/ч ${sample.sampleName}`} value={sample.emergency.assignedNumber} disabled={disabled || !sample.included} apply={assignedNumber => sampleSet(sample, { assignedNumber })} /><MetadataInput key={sample.emergency.shippingNumber} label={`Привоз ${sample.sampleName}`} value={sample.emergency.shippingNumber} numeric disabled={disabled || !sample.included} apply={shippingNumber => sampleSet(sample, { shippingNumber })} /></td>}
          <td>{profile ? <details><summary>Посмотреть</summary><dl>{profile.sourceLoci.map(locus => <React.Fragment key={locus}><dt>{locus}</dt><dd>{profile.strData[locus]?.join(',') || '—'}</dd></React.Fragment>)}</dl></details> : 'Не включён'}</td></tr>;
      })}</tbody></table></div>
    <div className="converter-actions"><button className="btn btn-secondary" disabled={!current} onClick={() => setPage(current - 1)}>Назад</button><span>Страница {current + 1} из {Math.max(1, Math.ceil(gene.samples.length / 30))}</span><button className="btn btn-secondary" disabled={(current + 1) * 30 >= gene.samples.length} onClick={() => setPage(current + 1)}>Далее</button></div>
  </div>;
}
