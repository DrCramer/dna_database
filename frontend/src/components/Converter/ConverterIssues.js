import React, { useMemo, useState } from 'react';
import { LociTypeDetector } from '../../../../src/utils/lociTypeDetector';
import ReferenceEvidence from './ReferenceEvidence';
const detector = new LociTypeDetector();
const names = { OK: 'Без изменений', AUTO_FIXED: 'Исправлено', WARNING: 'Предупреждение', NEEDS_REVIEW: 'Проверить', CONFLICT: 'Конфликт', ERROR: 'Ошибка' };
function Decision({ issue, apply, disabled }) {
  const [value, setValue] = useState(issue.normalizedValue || '');
  const [all, setAll] = useState(false);
  const structural = !issue.locus && issue.code !== 'INVALID_OBJECT';
  if (structural) return <span>Настройте источник выше</span>;
  const action = decision => apply(issue, decision, all);
  if (issue.code === 'INVALID_OBJECT') return <div className="converter-decisions"><input className="form-input" aria-label="Исправленный номер объекта" maxLength={100} value={value} onChange={e => setValue(e.target.value)} /><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'object', value })}>Сохранить номер</button><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'ignore_row' })}>Исключить строку</button></div>;
  return <div className="converter-decisions">
    {issue.reference?.suggestedDecision && issue.hard && <button className="btn btn-primary" disabled={disabled} onClick={() => action(issue.reference.suggestedDecision)}>Принять предложение: {issue.reference.suggestedValue}</button>}
    {['REPEATED_RESULT','MANUAL_RESULT'].includes(issue.code) && issue.variants.map(variant => <button className="btn btn-secondary" key={variant.id} disabled={disabled || variant.hard} onClick={() => action({ sourceId: variant.id })}>{variant.sourceFile}, строка {variant.sourceRow}: {variant.normalizedValue}</button>)}
    {issue.events?.some(event => event.code === 'AMBIGUOUS_DOT') && <><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'split_dot' })}>Разделить точку</button><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'keep' })}>Оставить микроаллель</button></>}
    {issue.events?.some(event => event.code === 'SINGLE_DIPLOID') && <button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'homozygous' })}>Подтвердить гомозиготу</button>}
    {!['REPEATED_RESULT','MANUAL_RESULT'].includes(issue.code) && <><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'unknown' })}>Неизвестная аллель</button><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'missing' })}>Нет результата</button><label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />Все одинаковые значения этого типа локуса в файле</label></>}
    <div className="converter-manual"><input className="form-input" aria-label={`Ручное значение ${issue.objectNumber} ${issue.locus}`} value={value} maxLength={500} onChange={e => setValue(e.target.value)} /><button className="btn btn-secondary" disabled={disabled} onClick={() => action({ action: 'manual', value })}>Применить</button></div>
  </div>;
}
export default function ConverterIssues({ result, options, update, disabled }) {
  const [status, setStatus] = useState('hard');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => result.issues.filter(issue => (status === 'all' || status === 'hard' ? status === 'all' || issue.hard : issue.status === status) && `${issue.objectNumber || ''} ${issue.locus || ''} ${issue.sourceFile || ''}`.toLowerCase().includes(search.toLowerCase())), [result, status, search]);
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 30) - 1));
  const apply = (issue, decision, all) => {
    let next = { ...options };
    if (decision.action === 'object') next.objects = { ...options.objects, [issue.id]: decision.value };
    else if (decision.action === 'ignore_row') next.rows = { ...options.rows, [issue.id.replace(/:object$/, '')]: { ignore: true } };
    else if (['REPEATED_RESULT','MANUAL_RESULT'].includes(issue.code)) next.conflicts = { ...options.conflicts, [issue.id]: decision };
    else {
      next.cells = { ...options.cells, [issue.id]: decision };
      if (all) next.rules = [...(options.rules || []), { fileId: issue.fileId, code: issue.events?.find(event => event.hard)?.code || issue.code, rawValue: issue.rawValue, locusType: detector.detectLocusType(issue.locus), decision }];
    }
    update(next);
  };
  return <section className="converter-card"><h2>Проверка и исправления</h2><div className="converter-actions"><label>Статус<select className="form-input" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="hard">Нерешённые</option><option value="all">Все изменения</option>{Object.entries(names).filter(([key]) => key !== 'OK').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Объект, локус или файл<input className="form-input" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><span>{filtered.length} записей</span></div>
    <div className="converter-scroll"><table className="converter-issue-table"><thead><tr>{['Источник', 'Объект / локус', 'Исходное', 'Результат', 'Статус / причина', 'Решение'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{filtered.slice(current * 30, current * 30 + 30).map(issue => <tr key={issue.id}><td>{issue.sourceFile}<br />{issue.sourceSheet} {issue.sourceRow ? `· строка ${issue.sourceRow}` : ''}</td><td>{issue.objectNumber}<br />{issue.locus}</td><td className="converter-value">{issue.rawValue || '—'}</td><td className="converter-value">{issue.normalizedValue || '—'}</td><td><span className={`converter-status converter-status-${issue.status}`}>{names[issue.status]} ({issue.status})</span><p>{issue.reason}</p><ReferenceEvidence reference={issue.reference} /></td><td><Decision key={`${issue.id}:${issue.normalizedValue}`} issue={issue} apply={apply} disabled={disabled} /></td></tr>)}</tbody></table></div>
    {!filtered.length && <p>Нет записей с выбранным фильтром. Неизменённые значения доступны в таблице профилей.</p>}
    <div className="converter-actions"><button className="btn btn-secondary" disabled={!current} onClick={() => setPage(current - 1)}>Назад</button><span>Страница {current + 1} из {Math.max(1, Math.ceil(filtered.length / 30))}</span><button className="btn btn-secondary" disabled={(current + 1) * 30 >= filtered.length} onClick={() => setPage(current + 1)}>Далее</button></div>
  </section>;
}
