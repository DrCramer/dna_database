import React, { useEffect, useRef, useState } from 'react';
import { staffSearchOptions } from '../../../../src/utils/staffSearchOptions';

export default function WorkspaceStaffSettings({ options, onSave, onClose }) {
  const [value, setValue] = useState(() => {
    const initial = staffSearchOptions(options);
    if (initial.threshold === 0) initial.threshold = 5.5;
    return initial;
  });
  const [weights, setWeights] = useState(() => Object.entries(options.locusWeights || {}).map(([locus, weight]) => `${locus}=${weight}`).join('\n'));
  const [ignored, setIgnored] = useState(() => (options.ignoredLoci || []).join(', '));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const dialog = useRef(null);
  useEffect(() => { const el = dialog.current; el.showModal(); return () => el.close(); }, []);
  function number(key, label, min, max, step = 1) {
    return <label key={key}>{label}<input className="form-input" type="number" min={min} max={max} step={step} required value={value[key]} onChange={e => setValue(current => ({ ...current, [key]: e.target.value === '' ? '' : Number(e.target.value) }))} /></label>;
  }
  async function submit(event) {
    event.preventDefault(); setError('');
    const entries = [];
    for (const line of weights.split(/\r?\n/).filter(line => line.trim())) {
      const match = line.trim().match(/^([^=\s]{1,100})\s*=\s*(\d+(?:[.,]\d+)?)$/);
      if (!match || Number(match[2].replace(',', '.')) > 100 || ['__proto__','constructor','prototype'].includes(match[1])) { setError('Укажите веса по одному на строке: SE33=2.5. Допустимы значения от 0 до 100.'); return; }
      if (entries.some(([locus]) => locus === match[1])) { setError('Каждый локус в весах должен быть указан один раз.'); return; }
      entries.push([match[1], Number(match[2].replace(',', '.'))]);
    }
    const ignoredLoci = [...new Set(ignored.split(/[\s,;]+/).filter(Boolean))];
    if (entries.length > 510 || ignoredLoci.length > 510 || ignoredLoci.some(locus => locus.length > 100)) { setError('Слишком много локусов или слишком длинное название локуса.'); return; }
    setSaving(true);
    try { await onSave({ ...value, locusWeights: Object.fromEntries(entries), ignoredLoci }); onClose(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return <dialog className="workspace-editor-dialog workspace-staff-settings-dialog" ref={dialog} aria-label="Настройки контаминации сотрудников" onCancel={e => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={submit}>
      <div className="workspace-editor-header"><div><h2>Контаминация сотрудников</h2><p>Прежние алгоритмы и настройки поиска</p></div><button className="btn btn-ghost" type="button" disabled={saving} onClick={onClose} aria-label="Закрыть настройки контаминации">×</button></div>
      <fieldset disabled={saving} className="workspace-editor-body workspace-staff-settings-fields">
        <label>Алгоритм контаминации<select className="form-select" value={value.useV5Algorithm ? 'v5' : value.useV4Algorithm ? 'v4' : 'v1.5'} onChange={e => setValue(current => ({ ...current, useV4Algorithm: e.target.value === 'v4', useV5Algorithm: e.target.value === 'v5' }))}><option value="v5">v5.0 — LCN и деградация</option><option value="v4">v4.0 — нормализация</option><option value="v1.5">v1.5 — реконструкция профиля</option></select></label>
        <div className="workspace-staff-settings-grid">
          {number('threshold', 'Порог отображения', 0.5, 100, 'any')}
          {number('minLociMatch', 'Минимум локусов', 1, 500)}
          {number('criticalAlleleCount', 'Критическое число аллелей', 1, 100)}
          {number('weightCriticalLocus', 'Вес критического локуса', 0, 100, 'any')}
          {number('stutterThreshold', 'Порог stutter', 0, 1, 'any')}
        </div>
        <details><summary>Веса локусов и коэффициенты</summary>
          <p>Параметры применяются выбранным алгоритмом так же, как на прежнем экране. В v4 пустой список весов означает вес 1 для каждого локуса. В v5 используются встроенные веса и коэффициенты.</p>
          <label>Веса локусов<textarea className="form-input" rows="4" placeholder="SE33=2.5" value={weights} onChange={e => setWeights(e.target.value)} /></label>
          <div className="workspace-staff-settings-grid">{Object.entries({ fullMatch: 'Полное совпадение', partialMatch: 'Частичное совпадение', penalty: 'Несовпадение', inclusiveDropout: 'Выпадение аллели', overInclusiveMix: 'Смесь' }).map(([key, label]) => <label key={key}>{label}<input className="form-input" type="number" min={key === 'penalty' ? -100 : 0} max="100" step="any" required value={value.matchCoefficients[key]} onChange={e => setValue(current => ({ ...current, matchCoefficients: { ...current.matchCoefficients, [key]: e.target.value === '' ? '' : Number(e.target.value) } }))} /></label>)}</div>
          <label>Исключённые локусы сотрудников<input className="form-input" value={ignored} onChange={e => setIgnored(e.target.value)} placeholder="Названия через запятую" /></label>
        </details>
        {error && <p className="workspace-row-error" role="alert">{error}</p>}
      </fieldset>
      <div className="workspace-editor-footer"><span>После сохранения потребуется новый поиск.</span><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Отмена</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить настройки'}</button></div>
    </form>
  </dialog>;
}
