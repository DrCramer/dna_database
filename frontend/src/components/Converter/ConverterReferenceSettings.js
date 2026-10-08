import React from 'react';
export default function ConverterReferenceSettings({ references, populations, options, result, update, disabled }) {
  const settings = { ladder: true, variants: true, population: true, referenceSetId: 'auto', populationIds: [], ...options.reference };
  const set = patch => update({ ...options, reference: { ...settings, ...patch } });
  const summary = result?.referenceSummary;
  return <section className="converter-card"><h2>Интеллектуальная проверка аллелей</h2>
    <div className="converter-actions">{[['ladder', 'Использовать аллельные лестницы'], ['variants', 'Использовать известные STR-варианты'], ['population', 'Использовать популяционные частоты']].map(([key, title]) => <label className="converter-reference-toggle" key={key}><input type="checkbox" checked={settings[key]} disabled={disabled} onChange={event => set({ [key]: event.target.checked })} />{title}</label>)}</div>
    <div className="converter-source-controls"><label>Референсная лестница<select className="form-input" disabled={disabled || !settings.ladder} value={settings.referenceSetId} onChange={event => set({ referenceSetId: event.target.value })}><option value="auto">Автоматически по панели</option><option value="none">Не использовать лестницу</option>{references.filter(set => set.type === 'KIT_LADDER').map(set => <option key={set.id} value={set.id}>{set.name} · {set.sourceVersion}</option>)}</select></label>
      <label>Популяционная база<select className="form-input" disabled={disabled || !settings.population} value={settings.populationIds[0] || ''} onChange={event => set({ populationIds: event.target.value ? [event.target.value] : [] })}><option value="">Все доступные базы</option>{populations.map(population => <option key={population.populationId} value={population.populationId}>{population.name}</option>)}</select></label></div>
    <p>Неоднозначные изменения требуют подтверждения. Популяционные частоты не определяют допустимость аллели или гомозиготность.</p>
    {!references.some(set => set.type === 'KIT_LADDER') && <p>Референсная лестница не выбрана. Используется стандартная проверка значений.</p>}
    {summary && <p>Неоднозначных значений: {summary.ambiguous} · Сильные предложения: {summary.high} · Средние: {summary.medium} · Недостаточно данных или спорные: {summary.insufficient}</p>}
    <a href="/settings/allele-references">Справочники и источники данных</a>
  </section>;
}
