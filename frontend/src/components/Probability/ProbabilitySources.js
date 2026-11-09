import React, { useMemo, useRef, useState } from 'react';
import { sampleRows, sampleLocusCount, assignedRoles } from '../../../../src/utils/probabilitySampleLibrary';

export const participantNames = {
  object: 'Исследуемый генотип', object1: 'Объект 1', object2: 'Объект 2',
  mother: 'Неоспариваемый родитель', child: 'Ребёнок', father: 'Оспариваемый родитель'
};
const reasons = { ladder: 'Аллельная лестница', control: 'Контрольный образец', service_name: 'Служебный образец', unknown_type: 'Требуется классификация' };

function Participant({ role, index, profile, active, disabled, readOnly, activate, choose, request, run }) {
  const [query, setQuery] = useState(''), [matches, setMatches] = useState(null);
  const options = useRef(null);
  const select = source => { setMatches(null); choose(role, source); if (options.current) options.current.open = false; };
  return <section className={'probability-person' + (active ? ' is-target' : '') + (profile ? ' is-assigned' : '')} aria-label={participantNames[role]}>
    <div className="probability-person-heading">
      <span className="probability-role-number" aria-hidden="true">{index + 1}</span>
      <strong>{participantNames[role]}</strong>
      {profile && !disabled && <button className="probability-icon-button" aria-label={'Очистить: ' + participantNames[role]} onClick={() => choose(role, null)}>×</button>}
    </div>
    <button className="probability-person-select" aria-label={(profile ? 'Заменить образец: ' : 'Выбрать образец: ') + participantNames[role]}
      aria-pressed={active} disabled={disabled} onClick={() => activate(role)}>
      <strong>{profile ? profile.displayName : 'Выберите образец'}</strong>
      <span title={profile?.filename}>{profile ? (profile.sourceType === 'txt' ? profile.filename : profile.sourceType === 'database' ? 'Из базы данных' : 'Ручной ввод') : active ? 'Назначьте его из списка ниже' : 'Нажмите, чтобы выбрать из TXT'}{profile?.year ? ` · ${profile.year}` : ''}</span>
      {profile && <small>{active ? 'Выбор образца открыт' : 'Назначен'}{Object.keys(profile.manualOverrides || {}).length > 0 ? ' · есть ручные изменения' : ''}</small>}
    </button>
    {!readOnly && <details className="probability-alternative" ref={options}>
      <summary>Вручную или из БД</summary>
      <button className="btn btn-secondary" disabled={disabled} onClick={() => select({ sourceType: 'manual', displayName: 'Ручной ввод', loci: {}, qualityFlags: [] })}>Ввести вручную</button>
      <form className="probability-search" onSubmit={e => { e.preventDefault(); if (!query.trim()) return; run(async () => {
        const data = await (await request('/profile-search?q=' + encodeURIComponent(query))).json(); setMatches(data.profiles);
      }); }}>
        <label>Поиск в базе данных<input className="form-input" aria-label={'Поиск профиля: ' + participantNames[role]} placeholder="Номер объекта или экспертизы" value={query} disabled={disabled} onChange={e => { setQuery(e.target.value); setMatches(null); }}/></label>
        <button className="btn btn-secondary" disabled={disabled || !query.trim()}>Найти</button>
      </form>
      {matches && <div className="probability-matches" aria-label={'Найденные профили: ' + participantNames[role]}>
        {matches.length ? matches.map(p => <button key={p.id} className="btn btn-secondary" disabled={disabled} onClick={() => run(async () => select(await (await request('/profiles/' + p.id)).json()))}>{p.displayName}{p.year ? ` / ${p.year}` : ''}</button>) : <span>Профили не найдены.</span>}
      </div>}
    </details>}
  </section>;
}

export default function ProbabilitySources({ mode, roles, profiles, files, disabled, readOnly, targetRole, setTargetRole, upload, choose, removeFile, request, run }) {
  const input = useRef(null), [dragging, setDragging] = useState(false), [query, setQuery] = useState('');
  const [showExcluded, setShowExcluded] = useState(false), [expanded, setExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(60);
  const available = files.flatMap(f => f.samples).filter(s => s.selectable).length;
  const excluded = files.reduce((n, f) => n + f.samples.filter(s => !s.selectable).length, 0);
  const rows = useMemo(() => sampleRows(files, query, showExcluded), [files, query, showExcluded]);
  const assigned = roles.filter(role => profiles[role]).length;
  function picked(list) { if (!list.length || disabled) return; setExpanded(true); setQuery(''); setVisibleCount(60); upload(list); }
  function activate(role) { setTargetRole(role); setExpanded(true); setQuery(''); }
  return <section className={'probability-sources-panel'+(files.length&&!readOnly?' has-files':'')} aria-label="Образцы исследования" aria-busy={disabled && !readOnly}>
    <div className="probability-section-heading">
      <div><h2><span className="probability-step">1</span>Образцы исследования</h2>
        <p>{readOnly ? 'Источники сохранённого расчёта' : mode === 'TRIO' ? 'Загрузите TXT один раз и назначьте образцы трём участникам.' : 'Загрузите TXT и выберите исследуемый образец.'}</p></div>
      <div className="probability-source-progress"><span>{assigned} из {roles.length}</span> {assigned === roles.length ? 'выбрано' : 'участников'}
        {files.length > 0 && !readOnly && <button className="probability-text-button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? 'Свернуть список' : `Образцы из TXT (${available})`}</button>}
      </div>
    </div>
    {!readOnly && <>
      <button type="button" className={'probability-dropzone' + (files.length ? ' is-compact' : '') + (dragging ? ' is-dragging' : '')} disabled={disabled}
        aria-label="Загрузить TXT-файлы" onClick={() => input.current.click()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!disabled) { e.dataTransfer.dropEffect = 'copy'; setDragging(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); picked(Array.from(e.dataTransfer.files)); }}>
        <span className="probability-upload-symbol" aria-hidden="true">↑</span>
        <span className="probability-upload-copy"><strong>{dragging ? 'Отпустите файлы здесь' : files.length ? 'Добавить TXT-файлы' : 'Перетащите TXT-файлы сюда'}</strong><span>{files.length ? 'Все образцы будут доступны каждому участнику' : 'Один файл с несколькими образцами или несколько файлов'}</span></span>
        <span className="probability-upload-action">Выбрать файлы</span>
      </button>
      <input ref={input} className="probability-file-input" aria-label="TXT-файлы исследования" type="file" accept=".txt" multiple disabled={disabled}
        onChange={e => { const list = Array.from(e.target.files); e.target.value = ''; picked(list); }}/>
    </>}
    <div className={'probability-participants' + (roles.length === 1 ? ' is-single' : '')}>{roles.map((role, index) => <Participant key={role} role={role} index={index} profile={profiles[role]} active={!readOnly && targetRole === role} disabled={disabled} readOnly={readOnly} activate={activate} choose={choose} request={request} run={run}/>)}</div>
    {!readOnly && files.length > 0 && expanded && <div className="probability-sample-browser">
      <div className="probability-library-toolbar">
        <div className="probability-file-chips" aria-label="Загруженные TXT-файлы">{files.map((file, index) => { const number=files.slice(0,index).filter(f=>f.filename===file.filename).length+1; const label=file.filename+(number>1?` (${number})`:''); return <span key={file.fileId} className="probability-file-chip"><span title={label}>{label}</span><small>{file.samples.filter(s => s.selectable).length}</small><button disabled={disabled} aria-label={'Удалить файл ' + label} onClick={() => removeFile(file.fileId)}>×</button></span>;})}</div>
        <input type="search" aria-label="Поиск образцов TXT" placeholder="Найти образец или файл…" value={query} onChange={e => {setQuery(e.target.value);setVisibleCount(60);}}/>
      </div>
      <div className="probability-library-caption"><p>Выбираете образец: <strong>{participantNames[targetRole]}</strong></p><span>{available} доступно{excluded > 0 && <button className="probability-text-button" aria-pressed={showExcluded} onClick={() => {setShowExcluded(v => !v);setVisibleCount(60);}}>{showExcluded ? 'Скрыть служебные' : `Служебные и пустые (${excluded})`}</button>}</span></div>
      <div className="probability-sample-grid" aria-label="Образцы из TXT">
        {rows.slice(0, visibleCount).map(({ sample, fileLabel }) => {
          const used = assignedRoles(profiles, roles, sample.sourceId), own = used.includes(targetRole), usedElsewhere = used.some(role => role !== targetRole);
          const hard = sample.qualityFlags?.filter(f => f.hard).length || 0;
          const unavailable = !sample.selectable || usedElsewhere;
          return <button key={sample.sourceId} className={'probability-sample-card' + (own ? ' is-selected' : '')} disabled={disabled || unavailable}
            aria-label={`Назначить ${sample.displayName}: ${participantNames[targetRole]}`} aria-pressed={own}
            onClick={() => choose(targetRole, sample)}>
            <span className="probability-sample-card-top"><strong>{sample.displayName}</strong><span className="probability-sample-loci">{sampleLocusCount(sample, mode)} локусов</span></span>
            <span className="probability-sample-file" title={fileLabel}>{fileLabel}{sample.year ? ` · ${sample.year}` : ''}</span>
            <span className={'probability-sample-state' + (hard ? ' has-warning' : '')}>{used.length ? '✓ ' + used.map(role => participantNames[role]).join(', ') : !sample.selectable ? reasons[sample.classification] || 'Нет данных генотипирования' : hard ? `Проверить данные · замечаний: ${hard}` : 'Назначить участнику →'}</span>
          </button>;
        })}
        {!rows.length && <p className="probability-library-empty">{query ? 'Образцы не найдены. Измените запрос.' : 'Доступных образцов нет. Проверьте состав загруженных файлов.'}</p>}
      </div>
      {rows.length>visibleCount&&<button className="probability-text-button probability-library-more" onClick={()=>setVisibleCount(n=>n+60)}>Показать ещё · осталось {rows.length-visibleCount}</button>}
      <small className="probability-library-help">{mode === 'TRIO' ? 'Выберите участника сверху, затем нажмите на образец. Уже назначенные образцы отмечены.' : 'Нажмите на карточку нужного образца.'}</small>
    </div>}
    {!readOnly && !files.length && <small className="probability-upload-limits">GeneMapper TXT · до 10 файлов за загрузку · до 2 МиБ на файл</small>}
  </section>;
}
