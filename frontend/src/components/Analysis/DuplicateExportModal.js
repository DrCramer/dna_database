import React, { useMemo, useState } from 'react';

const OPTIONS = [
  ['includeReferences', 'Включить эталонные профили'],
  ['includeHighlights', 'Сохранить подсветку локусов'],
  ['highlightAlleles', 'Выделять совпавшие аллели'],
  ['includeComparisons', 'Добавить лист с подробными сравнениями'],
  ['includeAnalysis', 'Добавить информацию об анализе']
];

export default function DuplicateExportModal({
  groups = [],
  defaultReferenceKey = '',
  profileCount,
  pairCount,
  locusCount,
  colors,
  busy,
  progress,
  onClose,
  onExport
}) {
  const [settings, setSettings] = useState({
    scope: 'all',
    referenceKey: groups.some(group => group.key === defaultReferenceKey) ? defaultReferenceKey : (groups[0]?.key || ''),
    includeReferences: true,
    includeHighlights: true,
    highlightAlleles: true,
    includeComparisons: true,
    includeAnalysis: true,
    locusMode: 'all'
  });
  const groupCount = useMemo(() => groups.length, [groups]);

  const update = (key, value) => setSettings(previous => ({ ...previous, [key]: value }));

  return (
    <div className="duplicate-export-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
      <section className="duplicate-export-modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-export-title">
        <header className="duplicate-export-modal-header">
          <div>
            <h2 id="duplicate-export-title">Экспорт дубликатов в Excel</h2>
            <p>Отчёт использует результаты завершённого поиска.</p>
          </div>
          <button type="button" className="duplicate-export-close" onClick={onClose} disabled={busy} aria-label="Закрыть">×</button>
        </header>

        <div className="duplicate-export-stats" aria-live="polite">
          <span><strong>{pairCount}</strong> найденных пар</span>
          <span><strong>{profileCount}</strong> уникальных профилей</span>
          <span><strong>{groupCount}</strong> эталонных профилей</span>
          <span><strong>{locusCount}</strong> локусов</span>
        </div>

        <fieldset className="duplicate-export-fieldset">
          <legend>Область экспорта</legend>
          <label>
            <input type="radio" name="duplicate-export-scope" checked={settings.scope === 'all'} onChange={() => update('scope', 'all')} />
            Все найденные пары текущего поиска
          </label>
          <label>
            <input type="radio" name="duplicate-export-scope" checked={settings.scope === 'reference'} onChange={() => update('scope', 'reference')} disabled={!groupCount} />
            Только группа выбранного эталона
          </label>
          {settings.scope === 'reference' && (
            <select value={settings.referenceKey} onChange={event => update('referenceKey', event.target.value)} aria-label="Эталон для экспорта">
              {groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
            </select>
          )}
        </fieldset>

        <fieldset className="duplicate-export-fieldset">
          <legend>Локусы и оформление</legend>
          <label>
            <input type="radio" name="duplicate-export-loci" checked={settings.locusMode === 'all'} onChange={() => update('locusMode', 'all')} />
            Все локусы профилей
          </label>
          <label>
            <input type="radio" name="duplicate-export-loci" checked={settings.locusMode === 'visible'} onChange={() => update('locusMode', 'visible')} />
            Только локусы, отображаемые в анализе
          </label>
          <div className="duplicate-export-checkboxes">
            {OPTIONS.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={settings[key]} onChange={event => update(key, event.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          <div className="duplicate-export-color-preview">
            <span><i style={{ backgroundColor: colors?.fullMatch }} />Полное</span>
            <span><i style={{ backgroundColor: colors?.partialMatch }} />Частичное</span>
            <span><i className="duplicate-export-allele-swatch" style={{ color: colors?.partialMatchAllele }} />Аллель</span>
            <span><i style={{ backgroundColor: colors?.noMatch }} />Несовпадение</span>
          </div>
        </fieldset>

        {busy && <div className="duplicate-export-progress" role="status">{progress || 'Подготовка данных…'}</div>}

        <footer className="duplicate-export-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={() => onExport(settings)} disabled={busy || !pairCount}>
            {busy ? 'Формирование…' : 'Скачать XLSX'}
          </button>
        </footer>
      </section>
    </div>
  );
}
