import { formatDateRu } from '../../../../src/utils/dateFormatter';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { OBJECT_TYPES } from '../../../../src/utils/objectTypes';
import { groupApprovalProblems } from '../../../../src/utils/workspaceApprovalProblems';

const number = value => value.toLocaleString('ru-RU');
const noGenotype = row => row.withoutGenotype || row.searchState === 'NO_GENOTYPE';
const belowSearchThreshold = row => row.belowSearchThreshold || row.searchState === 'INSUFFICIENT_DATA';
const pageSize = 50;
function ApprovalPage({ rows, children }) {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const current = Math.min(page, last);
  const start = current * pageSize;
  return <>
    {children(rows.slice(start, start + pageSize))}
    {last > 0 && <div className="master-approval-pagination"><span>{number(start + 1)}–{number(Math.min(start + pageSize, rows.length))} из {number(rows.length)}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Назад</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={current === last} onClick={() => setPage(current + 1)}>Далее</button>
    </div>}
  </>;
}

function ApprovalProblemGroups({ groups }) {
  if (!groups.length) return null;
  return <section className="master-approval-problems" aria-label="Причины блокировки">
    {groups.map(group => <section key={JSON.stringify([group.code, group.message])} className="master-approval-problem">
      <strong>{group.message} <span>({number(group.profiles.length)})</span></strong>
      <p>{group.instruction}</p>
      <details>
        <summary>Показать объекты</summary>
        <ApprovalPage rows={group.profiles}>{rows => <ul>{rows.map((row, i) => <li key={row.profileId || i}>
          {[row.objectNumber || 'Объект', row.year, OBJECT_TYPES[row.expertiseType]].filter(Boolean).join(' · ')}
        </li>)}</ul>}</ApprovalPage>
      </details>
    </section>)}
  </section>;
}

const date = value => value ? formatDateRu(value) : '—';
const names = {pending:'На подтверждении',approved:'В мастер-массиве',returned:'Возвращено на доработку',rolled_back:'Публикация отозвана'};

function ApprovalRequestList({ requests, history, busy, onOpen }) {
  return <ApprovalPage rows={requests}>{rows => <ul className="master-approval-request-list" aria-label={history ? 'Мои заявки' : 'Заявки на подтверждение'}>
    {rows.map(request => <li key={request.id} className="master-approval-request">
      <div>
        <h3>{history ? names[request.state] : request.author_name}</h3>
        {history && request.decider_name && <small>Решение принял {request.decider_name}</small>}
      </div>
      <dl>
        <div><dt>Объекты</dt><dd>{number(request.profile_count)}</dd></div>
        <div><dt>Отправлена</dt><dd>{date(request.submitted_at)}</dd></div>
      </dl>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onOpen(request.id)}>
        {history ? 'Открыть заявку' : 'Рассмотреть заявку'}
      </button>
    </li>)}
  </ul>}</ApprovalPage>;
}

// Web Crypto getRandomValues is available over local HTTP; randomUUID is not.
function submissionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const h = [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export default function MasterApprovalDialog({api,mode,selectedRows=[],requestId,onClose,onChanged,userId}) {
  const dialog=useRef(), key=useRef(submissionKey());
  const heading = useRef(null), body = useRef(null);
  const titleId = useId();
  const submitting = mode === 'submit', history = mode === 'own-history';
  const [queue,setQueue]=useState([]),[detail,setDetail]=useState(null),[preview,setPreview]=useState(null),[conflicts,setConflicts]=useState([]),[targets,setTargets]=useState({});
  const [busy,setBusy]=useState('Загрузка…'),[error,setError]=useState(null),[comment,setComment]=useState(''),[done,setDone]=useState('');
  const [mustRefresh, setMustRefresh] = useState(false);
  useEffect(()=>{const d=dialog.current;d.showModal();return()=>{if(d.open)d.close();};},[]);
  useEffect(() => {
    body.current.scrollTop = 0;
    heading.current.focus({ preventScroll: true });
  }, [detail?.id]);

  async function run(fn, message = 'Загрузка…') {
    setBusy(message);
    setError(null);
    try { await fn(); }
    catch (e) { setError(e); }
    finally { setBusy(''); }
  }
  const readRequest = id => api('/approvals/' + id);
  async function open(id) {
    setDetail(await readRequest(id));
    setMustRefresh(false);
    setComment('');
    setDone('');
  }
  async function refreshQueue() {setQueue((await api(history?'/approval-history':'/approvals')).requests);}
  async function prepare(existingTargets=targets) {
    setPreview(null);
    const result = await api('/approval-preview', { ids: selectedRows.map(r => r.id), existingTargets });
    if (result.conflicts?.length) setConflicts(result.conflicts);
    else { setConflicts([]); setPreview(result); }
  }
  useEffect(()=>{run(async()=>{
    if (submitting) await prepare({});
    else if(requestId) await open(requestId);
    else await refreshQueue();
  });},[]);
  async function decide(decision) {
    const approving = decision === 'approve';
    await run(async () => {
      const { id, state } = await api('/approvals/' + detail.id + '/decision', { decision, reviewToken: detail.reviewToken, comment }).catch(e => {
        if (e.code === 'REVIEW_STALE') setMustRefresh(true);
        throw e;
      });
      setDetail(previous => ({ ...previous, state, decisionComment: comment }));
      setDone(state === 'approved' ? 'Профили загружены в общий мастер-массив.' : 'Заявка возвращена на доработку.');
      try {
        setDetail(await readRequest(id));
        await onChanged();
      } catch {
        setError(new Error('Решение сохранено. Обновите данные, чтобы увидеть актуальные сведения.'));
      }
    }, approving ? 'Загружаем профили в мастер-массив…' : 'Возвращаем заявку на доработку…');
  }
  const canDecide = detail?.state === 'pending' && detail.authorId !== userId;
  const blockedReason = mustRefresh ? 'Данные заявки изменились. Нажмите «Обновить данные» и проверьте заявку ещё раз.'
    : detail?.requiresSearch || error?.details?.groups?.length ? 'Для подтверждения нужно устранить причины, указанные ниже.' : '';
  const title = submitting ? 'Отправить на подтверждение' : detail ? 'Рассмотрение заявки' : history ? 'Мои заявки' : 'На подтверждении';
  const list=preview?.profiles||selectedRows;
  const emptyCount = list.filter(noGenotype).length;
  const partialCount = list.filter(belowSearchThreshold).length;
  const detailGroups = useMemo(() => groupApprovalProblems(detail?.problems || []), [detail]);
  const detailProblemIds = new Set(detail?.problems.map(p => p.profileId));
  const evidence = useMemo(() => {
    const byProfile = new Map();
    for (const stage of ['internal','master','staff']) {
      for (const group of detail?.matches?.[stage] || []) {
        const profileId = group.profileId || group.reference?.id;
        const matches = group.exportMatches || group.matches || [];
        if (!matches.length) continue;
        if (!byProfile.has(profileId)) byProfile.set(profileId, {});
        const stages = byProfile.get(profileId);
        stages[stage] ||= [];
        for (const match of matches) stages[stage].push(match);
      }
    }
    return byProfile;
  }, [detail]);
  const evidenceProfiles = detail?.profiles.filter(p => evidence.has(p.id)) || [];
  return <dialog ref={dialog} className="workspace-editor-dialog master-approval-dialog" aria-labelledby={titleId} onCancel={e=>{if(busy)e.preventDefault();else onClose();}}>
    <div className="workspace-editor-header"><div><span className="workspace-eyebrow">Общий мастер-массив</span><h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2></div><button className="btn btn-ghost" aria-label="Закрыть окно" disabled={!!busy} onClick={onClose}>×</button></div>
    <div className="workspace-editor-body" ref={body}>
      {error && <p className="workspace-row-error master-approval-error" role="alert">{error.message}</p>}
      {done && <p className="workspace-message workspace-message-success" role="status"><span>{done}</span></p>}
      {busy && <p className="master-approval-busy" role="status"><span className="workspace-loading-spinner" aria-hidden="true" />{busy}</p>}
      {submitting ? <>
        <ApprovalProblemGroups groups={error?.details?.groups || []} />
        <p>Выбрано объектов: <strong>{number(list.length)}</strong>. Записи появятся в мастер-массиве после подтверждения другим сотрудником.</p>
        {!!emptyCount && <p>Без генотипа: <strong>{number(emptyCount)}</strong>. Эти объекты сохраняются как учётные записи и не сравниваются по аллелям.</p>}
        {!!partialCount && <p>Ниже порога поиска: <strong>{number(partialCount)}</strong>. Эти объекты можно опубликовать с имеющимися аллелями.</p>}
        <ApprovalPage rows={list}>{rows => <div className="master-approval-scroll"><table className="master-approval-table"><thead><tr><th>Объект</th><th>Год</th><th>Тип</th><th>Назначение</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.objectNumber}</td><td>{row.year}</td><td>{OBJECT_TYPES[row.expertiseType]}</td><td>{row.replaceExisting ? 'Обновление мастер-записи' : 'Мастер-массив'}{noGenotype(row) && <small>Без генотипа</small>}{belowSearchThreshold(row) && <small>Ниже порога поиска</small>}</td></tr>)}</tbody></table></div>}</ApprovalPage>
        {!!conflicts.length && <fieldset disabled={!!busy}><legend>Нужны решения по существующим записям ({number(conflicts.length)})</legend>
          <p>Отметьте записи мастер-массива, которые нужно обновить.</p>
          <ApprovalPage rows={conflicts}>{rows => rows.map(c => <label className="master-approval-target" key={c.profileId + ':' + c.publishedId}><input type="checkbox" checked={targets[c.profileId] === c.publishedId} onChange={e => {
            const checked = e.target.checked;
            setPreview(null);
            setTargets(old => {
              const next = { ...old };
              if (checked) next[c.profileId] = c.publishedId;
              else delete next[c.profileId];
              return next;
            });
          }} />Обновить {c.objectNumber} · {c.year} · {OBJECT_TYPES[c.expertiseType]}</label>)}</ApprovalPage>
          <button type="button" className="btn btn-secondary" onClick={()=>run(()=>prepare())}>Проверить сопоставление</button>
        </fieldset>}
        {preview&&<p>Дата окончания анализа генотипов: <strong>{date(preview.analysisCompletedAt)}</strong> (Москва).</p>}
      </> : detail ? <>
        <dl className="master-approval-summary">
          <div><dt>Автор заявки</dt><dd>{detail.authorName}</dd></div>
          <div><dt>Объекты</dt><dd>{number(detail.profiles.length)}</dd></div>
          <div><dt>Поиск завершён</dt><dd>{date(detail.analysisCompletedAt)}</dd></div>
          <div><dt>Заявка отправлена</dt><dd>{date(detail.submittedAt)}</dd></div>
          {!canDecide && <div><dt>Состояние</dt><dd>{names[detail.state]}</dd></div>}
          {detail.decidedAt && <div><dt>Решение</dt><dd>{detail.deciderName} · {date(detail.decidedAt)}</dd></div>}
        </dl>
        {canDecide && <section className="master-approval-review-status" data-blocked={!!blockedReason} id={titleId + '-status'}>
          <strong>{blockedReason ? 'Подтверждение пока недоступно' : 'Заявка готова к подтверждению'}</strong>
          <p>{blockedReason || 'Подтверждение сразу опубликует все объекты из заявки в общем мастер-массиве.'}</p>
        </section>}
        {detail.state === 'pending' && <ApprovalProblemGroups groups={error?.details?.groups || detailGroups} />}
        <details className="master-approval-evidence"><summary>Совпадения и предупреждения</summary>
          {!evidenceProfiles.length && <p>По выбранным объектам в результате поиска нет дубликатов и контаминаций сотрудниками.</p>}
          <ApprovalPage rows={evidenceProfiles}>{rows => rows.map(p => <section key={p.id}><h3>{p.objectNumber} · {p.year}</h3>
            {Object.entries(evidence.get(p.id)).map(([stage, matches]) => <div key={stage}><strong>{{internal:'Личный массив',master:'Мастер-массив',staff:'Контаминация сотрудников'}[stage]}: {number(matches.length)}</strong>
              <ul>{matches.map((m,i)=><li key={i}>{stage==='staff'?(m.staffName||'Эталон сотрудника'):(m.internal_number||'Совпадение в личном массиве')}{m.year ? ` · ${m.year}` : ''} · {stage==='staff'?`Оценка: ${m.finalScore??m.score??m.contaminationScore??'—'}`:`Совпавших локусов: ${m.matchCount??m.matchedLoci?.length??'—'}`}{Array.isArray(m.matchedLoci)&&m.matchedLoci.every(l=>typeof l==='string')&&<small>{m.matchedLoci.join(', ')}</small>}</li>)}</ul>
            </div>)}
          </section>)}</ApprovalPage>
        </details>
        <h3 className="master-approval-detail-title">Объекты заявки</h3>
        <ApprovalPage key={detail.id} rows={detail.profiles}>{rows => <div className="master-approval-scroll"><table className="master-approval-table"><thead><tr><th>Объект</th><th>Год</th><th>Тип</th><th>Комментарий</th><th>Проверка</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.objectNumber}{row.replaceExisting&&<small>Обновление существующей записи</small>}</td><td>{row.year}</td><td>{OBJECT_TYPES[row.expertiseType]}</td><td className="master-approval-comment">{row.comment||'—'}</td><td>{detailProblemIds.has(row.id) && detail.state === 'pending' ? 'Требует внимания' : row.withoutGenotype ? 'Без генотипа' : row.belowSearchThreshold ? 'Ниже порога поиска' : detail.state !== 'pending' ? 'Решение сохранено' : 'Все три этапа пройдены'}</td></tr>)}</tbody></table></div>}</ApprovalPage>
        {detail.rollback && <div className="workspace-message" role="status"><div><strong>Публикация отозвана</strong>
          <p>Откат выполнил {detail.rollback.rolledBackBy} · {date(detail.rollback.rolledBackAt)}</p>
          <p className="master-approval-decision-note">{detail.rollback.reason}</p>
        </div></div>}
        {!!detail.decisionComment&&<p><strong>Комментарий решения:</strong> {detail.decisionComment}</p>}
        {canDecide && <label className="master-approval-comment-label">Комментарий к решению<textarea className="form-input" value={comment} maxLength="20000" placeholder="Необязательно" onChange={e => setComment(e.target.value)} disabled={!!busy} /></label>}
      </> : <>
        {!!queue.length && <>
          <p className="master-approval-queue-intro">{history ? 'Ваши заявки' : 'Ожидают рассмотрения'} <strong>{number(queue.length)}</strong></p>
          <ApprovalRequestList requests={queue} history={history} busy={!!busy} onOpen={id => run(() => open(id), 'Открываем заявку…')} />
        </>}
        {!queue.length && !busy && !error && !requestId && <p>{history ? 'У вас пока нет заявок.' : 'Заявок на подтверждение нет.'}</p>}
      </>}
    </div>
    <div className="workspace-editor-footer master-approval-footer">
      {detail && !requestId ? <button className="btn btn-secondary" disabled={!!busy} onClick={() => run(async () => {
        await refreshQueue();
        setDetail(null);
        setDone('');
      })}>К списку заявок</button> : <button className="btn btn-secondary" disabled={!!busy} onClick={onClose}>Закрыть</button>}
      <div className="master-approval-footer-actions">
        {submitting && <button className="btn btn-primary" disabled={!!busy || !preview} onClick={() => run(async () => {
          await api('/approvals', { ids: selectedRows.map(r => r.id), searchRunId: preview.searchRunId, existingTargets: targets, idempotencyKey: key.current });
          await onChanged();
          onClose();
        }, 'Отправляем заявку…')}>Отправить на подтверждение</button>}
        {!submitting && !detail && !requestId && <button className="btn btn-secondary" disabled={!!busy} onClick={() => run(refreshQueue)}>Обновить список</button>}
        {!submitting && (detail || requestId) && <button className="btn btn-ghost" disabled={!!busy} onClick={() => run(() => open(detail?.id || requestId))}>Обновить данные</button>}
        {canDecide && <>
          <button className="btn btn-secondary" disabled={!!busy || mustRefresh} onClick={() => decide('return')}>Вернуть на доработку</button>
          <button className="btn btn-primary" disabled={!!busy || !!blockedReason} aria-describedby={titleId + '-status'} onClick={() => decide('approve')}>Подтвердить и загрузить</button>
        </>}
      </div>
    </div>
  </dialog>;
}

export function MasterPublicationHistory({ api, onClose, onChanged }) {
  const dialog = useRef(null);
  const titleId = useId();
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState({ requests: [], hasMore: false });
  const [plan, setPlan] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    run(() => load(1));
    return () => { if (node.open) node.close(); };
  }, []);

  async function run(action) {
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  async function load(next) {
    setQueue(await api('/master-publications?page=' + next));
    setPage(next);
    setPlan(null);
    setReason('');
  }
  async function open(id) {
    setPlan(await api('/approvals/' + id + '/rollback-preview'));
  }
  async function rollback() {
    await run(async () => {
      try {
        setPlan(await api('/approvals/' + plan.id + '/rollback', { reviewToken: plan.reviewToken, reason: reason.trim() }));
      } catch (failure) {
        if (failure.status === 409) {
          setPlan(current => ({ ...current, reviewToken: null }));
          await open(plan.id);
        }
        throw failure;
      }
      try { await onChanged(); }
      catch { setError(new Error('Откат сохранён. Обновите страницу, чтобы увидеть актуальные статусы личного массива.')); }
    });
  }

  return <dialog ref={dialog} className="workspace-editor-dialog master-approval-dialog" aria-labelledby={titleId}
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="workspace-editor-header">
      <div><span className="workspace-eyebrow">Общий мастер-массив</span><h2 id={titleId}>{plan ? 'Откат публикации' : 'Публикации мастер-массива'}</h2></div>
      <button type="button" className="btn btn-ghost" aria-label="Закрыть окно" disabled={busy} onClick={onClose}>×</button>
    </div>
    <div className="workspace-editor-body">
      {busy && <p className="master-approval-busy" role="status"><span className="workspace-loading-spinner" aria-hidden="true" />Выполняем операцию…</p>}
      {error && <p className="workspace-row-error" role="alert">{error.message}</p>}
      {plan?.state === 'rolled_back' ? <>
        <p className="workspace-message workspace-message-success" role="status">Публикация отозвана</p>
        <dl className="master-approval-summary">
          <div><dt>Снято с публикации</dt><dd>{number(plan.receipt.removed)}</dd></div>
          <div><dt>Восстановлено прежних версий</dt><dd>{number(plan.receipt.restored)}</dd></div>
          <div><dt>Кто выполнил откат</dt><dd>{plan.receipt.rolledBackBy}</dd></div>
          <div><dt>Дата отката</dt><dd>{date(plan.receipt.rolledBackAt)}</dd></div>
        </dl>
        <p className="master-approval-decision-note">Причина отката · {plan.receipt.reason}</p>
      </> : plan ? <>
        <dl className="master-approval-summary">
          <div><dt>Автор заявки</dt><dd>{plan.authorName}</dd></div>
          <div><dt>Опубликовано</dt><dd>{date(plan.decidedAt)}</dd></div>
          <div><dt>Снимутся с публикации</dt><dd>{number(plan.removed)}</dd></div>
          <div><dt>Восстановятся из прежней версии</dt><dd>{number(plan.restored)}</dd></div>
        </dl>
        <p>{plan.groups.length ? 'Откат выполняется для всей заявки. Сначала разберите причины блокировки.' :
          'Исходные записи остаются в личном массиве. Перед повторной публикацией потребуется новый полный поиск.'}</p>
        <ApprovalProblemGroups groups={plan.groups} />
        {plan.profiles.length > 0 && <details className="master-approval-evidence">
          <summary>Показать объекты</summary>
          <ApprovalPage rows={plan.profiles}>{rows => <div className="master-approval-scroll"><table className="master-approval-table">
            <thead><tr><th>Объект</th><th>Год</th><th>Тип</th><th>Действие</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.profileId}><td>{row.objectNumber}</td><td>{row.year}</td><td>{OBJECT_TYPES[row.expertiseType]}</td>
              <td>{row.action === 'restore' ? 'Восстановить прежнюю версию' : 'Снять с публикации'}</td></tr>)}</tbody>
          </table></div>}</ApprovalPage>
        </details>}
        {plan.reviewToken && <label className="master-approval-comment-label">Причина отката
          <textarea className="form-input" required value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} disabled={busy} />
        </label>}
      </> : <>
        {queue.requests.length > 0 && <ul className="master-approval-request-list" aria-label="Публикации">
          {queue.requests.map(request => <li className="master-approval-request" key={request.id}>
            <div><h3>{request.author_name}</h3><small>{names[request.state]}</small></div>
            <dl><div><dt>Объекты</dt><dd>{number(request.profile_count)}</dd></div><div><dt>Опубликована</dt><dd>{date(request.decided_at)}</dd></div></dl>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(() => open(request.id))}>
              {request.state === 'rolled_back' ? 'Посмотреть откат' : 'Проверить откат'}
            </button>
          </li>)}
        </ul>}
        {queue.requests.length === 0 && !busy && !error && <p>Публикаций пока нет.</p>}
        {(page > 1 || queue.hasMore) && <div className="master-approval-pagination"><span>Страница {number(page)}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || page === 1} onClick={() => run(() => load(page - 1))}>Назад</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !queue.hasMore} onClick={() => run(() => load(page + 1))}>Далее</button>
        </div>}
      </>}
    </div>
    <div className="workspace-editor-footer master-approval-footer">
      {plan ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(() => load(page))}>К публикациям</button> :
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Закрыть</button>}
      <div className="master-approval-footer-actions">
        {!plan && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(() => load(page))}>Обновить список</button>}
        {plan?.state === 'approved' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(() => open(plan.id))}>Обновить план</button>}
        {plan?.state === 'approved' && <button type="button" className="btn btn-primary" disabled={busy || !plan.reviewToken || !reason.trim()} onClick={rollback}>Откатить публикацию</button>}
      </div>
    </div>
  </dialog>;
}
