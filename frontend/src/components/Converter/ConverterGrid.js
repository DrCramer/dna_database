import React, { useMemo, useState } from 'react';
import { geneticObjectKey, geneticProfileKey } from '../../../../src/utils/profileImportFormat';
import { orderNormalizedLoci } from '../../../../src/utils/normalizedExcelLayout';
import ReferenceEvidence from './ReferenceEvidence';

const PAGE_SIZE = 50;

export default function ConverterGrid({ result, options, update, disabled, excluded, chooseProfiles }) {
  const [editor, setEditor] = useState(null);
  const [mode, setMode] = useState('populated');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('all');
  const [page, setPage] = useState(0);
  const problem = useMemo(() => new Set(result.issues.filter(issue => issue.hard || issue.status === 'WARNING').map(issue => issue.locus)), [result]);
  const populated = useMemo(() => new Set(result.profiles.flatMap(profile => profile.populatedLoci)), [result]);
  const loci = orderNormalizedLoci(result.catalogLoci).filter(locus => mode === 'all' || (mode === 'source' ? result.sourceLoci.includes(locus) : mode === 'populated' ? populated.has(locus) : problem.has(locus)));
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ru');
    return result.profiles.flatMap((profile, index) => {
      const checked = !excluded.has(index);
      if ((view === 'selected' && !checked) || (view === 'excluded' && checked)) return [];
      if (search && ![profile.objectNumber, profile.year, ...profile.sources.map(source => source.file)]
        .some(value => String(value ?? '').toLocaleLowerCase('ru').includes(search))) return [];
      return [{ profile, index, checked }];
    });
  }, [result.profiles, excluded, query, view]);
  const selectedInFilter = filtered.reduce((count, row) => count + Number(row.checked), 0);
  const allInFilter = filtered.length > 0 && selectedInFilter === filtered.length;
  const toggleFiltered = checked => chooseProfiles(filtered.map(row => row.index), checked);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const editorProfile = editor && result.profiles.find(profile => profile.key === editor.key);
  const identityKey = profile => profile.key || (profile.year == null ? `legacy:${geneticObjectKey(profile.objectNumber)}` : geneticProfileKey(profile.year, profile.objectNumber));

  return <section className="converter-card">
    <h2>Подготовленные профили</h2>
    <div className="converter-actions converter-selection-controls">
      <label>Поиск объектов<input type="search" className="form-input" placeholder="Номер, год или имя файла" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>Показать<select className="form-input" value={view} onChange={event => { setView(event.target.value); setPage(0); }}>
        <option value="all">Все объекты</option><option value="selected">Выбранные</option><option value="excluded">Снятые с выбора</option>
      </select></label>
      <button type="button" className="btn btn-secondary" disabled={disabled || !filtered.length || allInFilter} onClick={() => toggleFiltered(true)}>Выбрать весь текущий фильтр</button>
      <button type="button" className="btn btn-secondary" disabled={disabled || !selectedInFilter} onClick={() => toggleFiltered(false)}>Снять выбор в фильтре</button>
    </div>
    <div className="converter-actions">
      <label>Колонки<select className="form-input" value={mode} onChange={event => setMode(event.target.value)}><option value="source">Локусы источников</option><option value="all">Весь каталог</option><option value="populated">Заполненные</option><option value="problems">С предупреждениями и ошибками</option></select></label>
      <span>Локусов с данными: {populated.size}</span>
      <span role="status">Выбрано {result.profiles.length - excluded.size} из {result.profiles.length} · В фильтре {filtered.length}</span>
    </div>
    {!filtered.length && <p className="converter-hint">По текущему фильтру объектов нет.</p>}
    {filtered.length > 0 && <><div className="converter-scroll converter-grid-scroll" tabIndex={0} aria-label="Таблица генотипов, горизонтальная прокрутка">
      <table className="converter-genotypes"><thead><tr><th scope="col" className="converter-selection-column"><input type="checkbox" aria-label="Выбрать все объекты текущего фильтра"
        checked={allInFilter} disabled={disabled} onChange={event => toggleFiltered(event.target.checked)}
        ref={element => { if (element) element.indeterminate = selectedInFilter > 0 && !allInFilter; }} />
      </th><th>Год</th><th>Объект</th>{loci.map(locus => <th key={locus}>{locus}</th>)}</tr></thead>
        <tbody>{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(({ profile, index, checked }) => <tr key={identityKey(profile)} data-excluded={!checked}>
          <td className="converter-selection-column"><input type="checkbox" aria-label={`Выбрать ${profile.objectNumber}${profile.year == null ? '' : ` · ${profile.year}`}`}
            checked={checked} disabled={disabled} onChange={event => chooseProfiles([index], event.target.checked)} /></td>
          <td>{profile.year ?? '—'}</td><th scope="row">{profile.objectNumber}</th>
          {loci.map(locus => <td key={locus} className={problem.has(locus) ? 'converter-problem-cell' : undefined}>
            {profile.transfer ? (profile.strData[locus] || []).join(',') || '—' : <button className="converter-cell-button" disabled={disabled || !profile.sourceLoci.includes(locus)} title="Изменить результат" onClick={() => setEditor({ key: profile.key, object: profile.objectNumber, year: profile.year, locus, value: (profile.strData[locus] || []).join(',') })}>{(profile.strData[locus] || []).join(',') || '—'}</button>}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {pages > 1 && <div className="converter-actions"><button className="btn btn-secondary" disabled={!current} onClick={() => setPage(current - 1)}>Назад</button><span>Страница {current + 1} из {pages}</span><button className="btn btn-secondary" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Далее</button></div>}
    </>}
    {editorProfile && <div className="modal-overlay"><div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="converter-edit-title">
      <h2 id="converter-edit-title">{editor.year ? `${editor.year} · ` : ''}{editor.object} · {editor.locus}</h2>
      {editorProfile?.audit.filter(issue => issue.locus === editor.locus && issue.reference).map(issue => <div key={issue.id}>
        <p>Источник: {issue.sourceFile || 'Ручной результат'} · исходное: {issue.rawValue}</p><ReferenceEvidence reference={issue.reference} />
        {issue.hard && issue.reference.suggestedDecision && <button className="btn btn-primary" disabled={disabled} onClick={() => { update({ ...options, cells: { ...options.cells, [issue.id]: issue.reference.suggestedDecision } }, editorProfile.key); setEditor(null); }}>Принять предложение: {issue.reference.suggestedValue}</button>}
      </div>)}
      <p>Введите отдельные аллели через запятую. Исходное одиночное значение сохраняется как есть; при необходимости введите явную пару.</p>
      <label>Результат<input autoFocus className="form-input" maxLength={500} value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })} /></label>
      <div className="converter-actions"><button className="btn btn-primary" disabled={disabled} onClick={() => { update({ ...options, conflicts: { ...options.conflicts, [`merge:${identityKey(editorProfile)}:${editor.locus}`]: { action: 'manual', value: editor.value } } }, editorProfile.key); setEditor(null); }}>Проверить и сохранить</button><button className="btn btn-secondary" onClick={() => setEditor(null)}>Отмена</button></div>
    </div></div>}
  </section>;
}
