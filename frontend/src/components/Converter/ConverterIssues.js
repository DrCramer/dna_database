import React, { useId, useMemo, useState } from 'react';
import { groupConverterIssues } from '../../../../src/utils/converterIssueGroups';
import ReferenceEvidence from './ReferenceEvidence';
const names = { OK: 'Без изменений', AUTO_FIXED: 'Исправлено', WARNING: 'Предупреждение', NEEDS_REVIEW: 'Проверить', CONFLICT: 'Конфликт', ERROR: 'Ошибка' };
const columns = ['Источник / случаи', 'Объекты / локус', 'Исходное', 'Результат', 'Статус / причина', 'Решение'];
function Decision({ issue, apply, disabled, count = 1 }) {
  const [value, setValue] = useState(issue.normalizedValue || '');
  const structural = !issue.locus && issue.code !== 'INVALID_OBJECT';
  if (issue.ngs) return <span>Откройте локус в NGS-предпросмотре источника: решение принимается с учётом Result и Detail.</span>;
  if (structural) return <span>Откройте вкладку «Образцы и распознавание»</span>;
  const action = decision => apply(decision);
  const label = text => count > 1 ? `${text} (${count})` : text;
  if (issue.code === 'INVALID_OBJECT') return <div className="converter-decisions"><input className="form-input" aria-label="Исправленный номер объекта" disabled={disabled} maxLength={100} value={value} onChange={e => setValue(e.target.value)} /><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'object', value })}>Сохранить номер</button><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'ignore_row' })}>Исключить строку</button></div>;
  return <div className="converter-decisions">
    {count > 1 && <strong className="converter-group-scope">Решение для всех случаев этой группы</strong>}
    {issue.reference?.suggestedDecision && issue.hard && <button className="btn btn-primary" disabled={disabled} onClick={() => action(issue.reference.suggestedDecision)}>{label(`Принять предложение: ${issue.reference.suggestedValue}`)}</button>}
    {['REPEATED_RESULT','MANUAL_RESULT'].includes(issue.code) && issue.variants.map(variant => <button className="btn btn-secondary" key={variant.id} disabled={disabled || variant.hard} onClick={() => action({ sourceId: variant.id })}>{variant.sourceFile}, строка {variant.sourceRow}: {variant.normalizedValue}</button>)}
    {issue.events?.some(event => event.code === 'AMBIGUOUS_DOT') && <><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'split_dot' })}>{label('Разделить точку')}</button><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'keep' })}>{label('Оставить микроаллель')}</button></>}
    {issue.events?.some(event => event.code === 'SINGLE_DIPLOID') && <button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'homozygous' })}>{label('Подтвердить гомозиготу')}</button>}
    {!['REPEATED_RESULT','MANUAL_RESULT'].includes(issue.code) && <><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'unknown' })}>{label('Неизвестная аллель')}</button><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'missing' })}>{label('Нет результата')}</button></>}
    <div className="converter-manual"><input className="form-input" aria-label={count > 1 ? `Ручное значение для группы ${issue.locus}` : `Ручное значение ${issue.objectNumber} ${issue.locus}`} disabled={disabled} value={value} maxLength={500} onChange={e => setValue(e.target.value)} /><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'manual', value })}>{count > 1 ? `Применить ко всем (${count})` : 'Применить'}</button></div>
  </div>;
}
function IssueCells({ issue }) {
  return <><td className="converter-value">{issue.rawValue || '—'}</td><td className="converter-value">{issue.normalizedValue || '—'}</td><td><span className={`converter-status converter-status-${issue.status}`}>{names[issue.status]}</span><p>{issue.reason}</p><ReferenceEvidence reference={issue.reference} /></td></>;
}
function IssueGroup({ group, apply, disabled }) {
  const [expanded, setExpanded] = useState(false), [page, setPage] = useState(0);
  const detailId = useId(), { issue, members } = group, count = members.length;
  const current = Math.min(page, Math.max(0, Math.ceil(count / 20) - 1));
  const objects = [...group.objects], files = [...group.files.values()];
  return <>
    <tr className={count > 1 ? 'converter-group-row' : undefined}>
      <td>{count > 1 && <strong className="converter-group-count">Случаев: {count}</strong>}<span>{files.length === 1 ? files[0] : `Файлов: ${files.length}`}</span>{count === 1 && <><br />{issue.sourceSheet}{issue.sourceRow ? ` · строка ${issue.sourceRow}` : ''}</>}
        {count > 1 && <button className="converter-text-button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Свернуть случаи' : `Показать случаи (${count})`}</button>}
      </td>
      <td><strong>{issue.locus || 'Структура файла'}</strong><p>{objects.slice(0, 3).join(', ') || 'Без номера объекта'}{objects.length > 3 ? ` и ещё ${objects.length - 3}` : ''}</p></td>
      <IssueCells issue={issue} />
      <td>{count === 1 || group.canBatch ? <Decision key={`${issue.id}:${issue.normalizedValue}`} issue={issue} disabled={disabled} count={count} apply={decision => apply(members, decision)} /> : <span>Нужна индивидуальная проверка исходных данных. Раскройте случаи, чтобы принять решения отдельно.</span>}</td>
    </tr>
    {expanded && <tr className="converter-group-details" id={detailId}><td colSpan={6}>
      <h3>Случаи группы: {count}</h3>
      <table className="converter-issue-table"><thead><tr>{['Источник', 'Объект / локус', 'Исходное', 'Результат', 'Статус / причина', 'Индивидуальное решение'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{members.slice(current * 20, current * 20 + 20).map(item => <tr key={item.id}><td>{item.sourceFile}<br />{item.sourceSheet} · строка {item.sourceRow ?? '—'}</td><td>{item.objectNumber || '—'}<br />{item.locus}</td><IssueCells issue={item} /><td><Decision issue={item} disabled={disabled} apply={decision => apply([item], decision)} /></td></tr>)}</tbody></table>
      {count > 20 && <div className="converter-actions"><button className="btn btn-secondary" disabled={!current} onClick={() => setPage(current - 1)}>Предыдущие случаи</button><span>{current * 20 + 1}–{Math.min((current + 1) * 20, count)} из {count}</span><button className="btn btn-secondary" disabled={(current + 1) * 20 >= count} onClick={() => setPage(current + 1)}>Следующие случаи</button></div>}
    </td></tr>}
  </>;
}
export default function ConverterIssues({ result, onDecision, disabled }) {
  const [status, setStatus] = useState('hard'), [search, setSearch] = useState(''), [page, setPage] = useState(0), [actionError, setActionError] = useState('');
  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return result.issues.filter(issue => (status === 'all' || (status === 'hard' ? issue.hard : issue.status === status)) && `${issue.objectNumber || ''} ${issue.locus || ''} ${issue.sourceFile || ''}`.toLowerCase().includes(query));
  }, [result, status, search]);
  const groups = useMemo(() => groupConverterIssues(filtered), [filtered]);
  const current = Math.min(page, Math.max(0, Math.ceil(groups.length / 20) - 1));
  const apply = (members, decision) => {
    try { setActionError(''); onDecision(members, decision); }
    catch (error) { setActionError(error.message); }
  };
  return <section className="converter-card"><h2>Проверка и исправления</h2>
    <p className="converter-hint">Одинаковые записи одного локуса объединены в группы. Решение применяется только к случаям группы в текущем фильтре.{status === 'hard' && ' Показаны только записи, требующие решения; остальные доступны в фильтре «Все замечания».'}</p>
    <div className="converter-actions"><label>Статус<select className="form-input" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="hard">Требуют решения</option><option value="all">Все замечания</option>{Object.entries(names).filter(([key]) => key !== 'OK').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Объект, локус или файл<input className="form-input" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><span>Групп: {groups.length} · случаев: {groups.reduce((total, group) => total + group.members.length, 0)}</span></div>
    {actionError && <p className="alert alert-danger" role="alert">{actionError}</p>}
    {groups.length > 0 && <div className="converter-scroll"><table className="converter-issue-table"><thead><tr>{columns.map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{groups.slice(current * 20, current * 20 + 20).map(group => <IssueGroup key={group.key} group={group} apply={apply} disabled={disabled} />)}</tbody></table></div>}
    {!filtered.length && <div role="status"><p>{status === 'hard' && !search ? 'Ошибок и неоднозначностей, требующих решения, нет.' : 'Нет записей с выбранным фильтром.'}</p>{status === 'hard' && result.issues.length > 0 && <button className="btn btn-secondary" onClick={() => { setStatus('all'); setSearch(''); setPage(0); }}>Показать все замечания</button>}</div>}
    {groups.length > 20 && <div className="converter-actions"><button className="btn btn-secondary" disabled={!current} onClick={() => setPage(current - 1)}>Назад</button><span>Группы: страница {current + 1} из {Math.max(1, Math.ceil(groups.length / 20))}</span><button className="btn btn-secondary" disabled={(current + 1) * 20 >= groups.length} onClick={() => setPage(current + 1)}>Далее</button></div>}
  </section>;
}
