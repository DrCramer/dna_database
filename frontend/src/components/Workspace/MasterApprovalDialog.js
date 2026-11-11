import React, { useEffect, useRef, useState } from 'react';
import { OBJECT_TYPES } from '../../../../src/utils/objectTypes';
const date = value => value ? new Date(value).toLocaleString('ru-RU', { timeZone:'Europe/Moscow', dateStyle:'short',timeStyle:'short' }) : '—';
const names = {pending:'На подтверждении',approved:'В мастер-массиве',returned:'Возвращено на доработку'};
// Web Crypto getRandomValues is available over local HTTP; randomUUID is not.
function submissionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const h = [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export default function MasterApprovalDialog({api,mode,selectedRows=[],requestId,onClose,onChanged,userId}) {
  const dialog=useRef(), key=useRef(submissionKey());
  const [queue,setQueue]=useState([]),[detail,setDetail]=useState(null),[preview,setPreview]=useState(null),[conflicts,setConflicts]=useState([]),[targets,setTargets]=useState({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[comment,setComment]=useState(''),[done,setDone]=useState('');
  useEffect(()=>{const d=dialog.current;d.showModal();return()=>{if(d.open)d.close();};},[]);
  async function run(fn) {setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function open(id) {setDetail(await api('/approvals/'+id));setComment('');setDone('');}
  async function refreshQueue() {setQueue((await api(mode==='own-history'?'/approval-history':'/approvals')).requests);}
  async function prepare(existingTargets=targets) {setPreview(await api('/approval-preview',{ids:selectedRows.map(r=>r.id),existingTargets}));}
  useEffect(()=>{run(async()=>{
    if(mode==='submit') {
      const result=await api('/publication-preview',{ids:selectedRows.map(r=>r.id)});setConflicts(result.conflicts);
      if(!result.conflicts.length) await prepare({});
    } else if(requestId) await open(requestId);
    else await refreshQueue();
  });},[]);
  async function decide(decision) {
    await run(async()=>{
      const result=await api('/approvals/'+detail.id+'/decision',{decision,reviewToken:detail.reviewToken,comment});
      setDone(result.state==='approved'?'Профили загружены в общий мастер-массив.':'Заявка возвращена на доработку.');
      await open(detail.id);setDone(names[result.state]);await onChanged();
    });
  }
  const list=preview?.profiles||selectedRows;
  return <dialog ref={dialog} className="workspace-editor-dialog master-approval-dialog" aria-label={mode==='submit'?'Отправить на подтверждение':'На подтверждении'} onCancel={e=>{if(busy)e.preventDefault();else onClose();}}>
    <div className="workspace-editor-header"><div><span className="workspace-eyebrow">Общий мастер-массив</span><h2>{mode==='submit'?'Отправить на подтверждение':detail?'Рассмотрение заявки':mode==='own-history'?'Мои заявки':'На подтверждении'}</h2></div><button className="btn btn-ghost" aria-label="Закрыть подтверждение" disabled={busy} onClick={onClose}>×</button></div>
    <div className="workspace-editor-body">
      {error&&<p className="workspace-row-error master-approval-error" role="alert">{error}</p>}{done&&<p role="status">{done}</p>}
      {busy&&<p role="status">Загрузка…</p>}
      {mode==='submit'?<>
        <p>Выбрано профилей: <strong>{list.length}</strong>. Назначение: общий мастер-массив ЧС, УГ и ГР. Записи появятся в нём после решения другого пользователя.</p>
        <div className="master-approval-scroll"><table className="master-approval-table"><thead><tr><th>Объект</th><th>Год</th><th>Тип</th><th>Назначение</th></tr></thead><tbody>{list.map(row=><tr key={row.id}><td>{row.objectNumber}</td><td>{row.year}</td><td>{OBJECT_TYPES[row.expertiseType]}</td><td>{row.expertiseType==='staff'?'Эталон сотрудников — отправляется отдельно':row.replaceExisting?'Обновление мастер-записи':'Мастер-массив'}</td></tr>)}</tbody></table></div>
        {!!conflicts.length&&<fieldset disabled={busy}><legend>Сопоставление существующих записей</legend>{conflicts.map((c,i)=><label className="master-approval-target" key={c.profileId+':'+i}><input type="checkbox" checked={targets[c.profileId]===c.publishedId} onChange={e=>{setPreview(null);setTargets(old=>{const v={...old};if(e.target.checked)v[c.profileId]=c.publishedId;else delete v[c.profileId];return v;});}}/>Обновить {c.objectNumber} · {c.year} · {OBJECT_TYPES[c.expertiseType]}</label>)}<button className="btn btn-secondary" onClick={()=>run(()=>prepare())}>Проверить выбранные</button></fieldset>}
        {preview&&<p>Дата окончания анализа генотипов: <strong>{date(preview.analysisCompletedAt)}</strong> (Москва).</p>}
      </>:detail?<>
        <dl className="master-approval-summary"><div><dt>Сотрудник</dt><dd>{detail.authorName}</dd></div><div><dt>Дата окончания анализа генотипов</dt><dd>{date(detail.analysisCompletedAt)} (Москва)</dd></div><div><dt>Отправлено</dt><dd>{date(detail.submittedAt)}</dd></div><div><dt>Состояние</dt><dd>{names[detail.state]}</dd></div>{detail.decidedAt&&<div><dt>Решение</dt><dd>{detail.deciderName} · {date(detail.decidedAt)}</dd></div>}</dl>
        {detail.requiresSearch&&detail.state==='pending'&&<div className="workspace-row-error"><strong>Требуется повторный поиск</strong>{detail.problems.map((p,i)=><p key={i}>{p.message}</p>)}</div>}
        <div className="master-approval-scroll"><table className="master-approval-table"><thead><tr><th>Объект</th><th>Год</th><th>Тип</th><th>Комментарий</th><th>Проверка</th></tr></thead><tbody>{detail.profiles.map(row=><tr key={row.id}><td>{row.objectNumber}{row.replaceExisting&&<small>Обновление существующей записи</small>}</td><td>{row.year}</td><td>{OBJECT_TYPES[row.expertiseType]}</td><td className="master-approval-comment">{row.comment||'—'}</td><td>{detail.state!=='pending'?'Решение сохранено':detail.problems.some(p=>p.profileId===row.id)?'Повторный поиск':'Все три этапа пройдены'}</td></tr>)}</tbody></table></div>
        <details className="master-approval-evidence"><summary>Совпадения и предупреждения выбранных профилей</summary>{detail.profiles.map(p=><section key={p.id}><h3>{p.objectNumber} · {p.year}</h3>{['internal','master','staff'].map(stage=>{const groups=detail.matches[stage].filter(g=>(g.profileId||g.reference?.id)===p.id);const count=groups.reduce((n,g)=>n+(g.exportMatches||g.matches||[]).length,0);return <div key={stage}><strong>{{internal:'Личный массив',master:'Мастер-массив',staff:'Контаминация сотрудников'}[stage]}: {count}</strong>{count>0&&<ul>{groups.flatMap(g=>g.exportMatches||g.matches||[]).map((m,i)=><li key={i}>{stage==='staff'?(m.staffName||'Эталон сотрудника'):(m.internal_number||'Совпадение в личном массиве')}{m.year ? ` · ${m.year}` : ''} · {stage==='staff'?`Оценка: ${m.finalScore??m.score??m.contaminationScore??'—'}`:`Совпавших локусов: ${m.matchCount??m.matchedLoci?.length??'—'}`}{Array.isArray(m.matchedLoci)&&m.matchedLoci.every(l=>typeof l==='string')&&<small>{m.matchedLoci.join(', ')}</small>}</li>)}</ul>}</div>;})}</section>)}</details>
        {!!detail.decisionComment&&<p><strong>Комментарий решения:</strong> {detail.decisionComment}</p>}
        {detail.state==='pending'&&detail.authorId!==userId&&<label className="master-approval-comment-label">Комментарий к решению<textarea className="form-input" value={comment} maxLength="20000" onChange={e=>setComment(e.target.value)} disabled={busy}/></label>}
      </>:<><p>{mode==='own-history'?'Ваши последние 200 заявок и решения по ним.':'Ожидающие заявки вашей организации. Собственные заявки здесь не показываются.'}</p><div className="master-approval-scroll"><table className="master-approval-table"><thead><tr><th>{mode==='own-history'?'Состояние / решение':'Сотрудник'}</th><th>Дата окончания анализа генотипов</th><th>Отправлено</th><th>Профили</th></tr></thead><tbody>{queue.map(row=><tr key={row.id}><td><button className="workspace-object-link" onClick={()=>run(()=>open(row.id))}>{mode==='own-history'?names[row.state]:row.author_name}</button>{row.decider_name&&<small>{row.decider_name}</small>}</td><td>{date(row.analysis_completed_at)}</td><td>{date(row.submitted_at)}</td><td>{row.profile_count}</td></tr>)}</tbody></table></div>{!queue.length&&!busy&&<p>Заявок на подтверждение нет.</p>}</>}
    </div>
    <div className="workspace-editor-footer">
      <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Закрыть</button>
      {mode==='submit'&&<button className="btn btn-primary" disabled={busy||!preview} onClick={()=>run(async()=>{await api('/approvals',{ids:selectedRows.map(r=>r.id),searchRunId:preview.searchRunId,existingTargets:targets,idempotencyKey:key.current});await onChanged();onClose();})}>Отправить на подтверждение</button>}
      {mode!=='submit'&&detail&&<button className="btn btn-secondary" disabled={busy} onClick={()=>run(()=>open(detail.id))}>Обновить данные</button>}
      {mode!=='submit'&&detail?.state==='pending'&&detail.authorId!==userId&&<><button className="btn btn-secondary" disabled={busy} onClick={()=>decide('return')}>Вернуть на доработку</button><button className="btn btn-primary" disabled={busy||detail.requiresSearch} onClick={()=>decide('approve')}>Подтвердить и загрузить</button></>}
      {mode!=='submit'&&detail&&!requestId&&<button className="btn btn-secondary" disabled={busy} onClick={()=>run(async()=>{setDetail(null);await refreshQueue();})}>К списку заявок</button>}
    </div>
  </dialog>;
}
