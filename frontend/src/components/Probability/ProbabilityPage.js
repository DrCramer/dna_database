import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';
import { LociTypeDetector } from '../../../../src/utils/lociTypeDetector';
import { hasAllProbabilityGenotypes } from '../../../../src/utils/probabilityLocusSelection';
import { reportPng, downloadBlob, reportView } from './probabilityPng';
import { isProbabilityLocus } from '../../../../src/utils/probabilityLoci';
import ProbabilityHelp from './ProbabilityMath';
import ProbabilityReport from './ProbabilityReport';
import ProbabilitySources, { participantNames } from './ProbabilitySources';
import { mergeTxtFiles, withoutTxtFile } from '../../../../src/utils/probabilitySampleLibrary';
const roles = { IDENT: ['object'], TRIO: ['mother','child','father'] };
const labels = { object: 'Исследуемый генотип', object1: 'Объект 1', object2: 'Объект 2',
  mother: 'Аллели неоспариваемого родителя', child: 'Аллели ребёнка', father: 'Аллели оспариваемого родителя' };
const detector = new LociTypeDetector();
const canUse = role => ['admin','system_administrator','department_head','user_analyst','analyst'].includes(role);
function PaternalAllele({ row }) {
  // Older immutable snapshots stored the pre-father candidates in this field.
  // Correct their presentation using the frozen genotypes, without resaving.
  const alleles=(row.paternalAlleles||[]).filter(allele=>(row.genotypes?.[2]||[]).some(value=>Number(value)===Number(allele)));
  const mutation=row.status==='OK'&&row.mismatch;
  return <td className="probability-paternal" title={mutation?'Нет совместимой аллели у оспариваемого родителя: мутационная ветвь модели':alleles.length>1?'Оба варианта совместимы с оспариваемым родителем':'Аллель ребёнка, совместимая с генотипами обоих родителей'}>
    {mutation?'Мутация':alleles.join(' или ')||'—'}
  </td>;
}
function Workspace({ departmentId }) {
  const [mode,setMode] = useState('IDENT'), [profiles,setProfiles] = useState({}), [files,setFiles] = useState([]);
  const [selectedRole,setTargetRole] = useState('object');
  const [config,setConfig] = useState(null), [selection,setSelection] = useState({});
  const [result,setResult] = useState(null), [saved,setSaved] = useState([]), [readOnly,setReadOnly] = useState(false);
  const [announcement,setAnnouncement] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState(''), [help,setHelp] = useState(false);
  const [showDetails,setShowDetails] = useState(false), [extraLoci,setExtraLoci] = useState([]), [newLocus,setNewLocus] = useState('');
  const busyRef = useRef(false);
  const activeRoles = mode==='IDENT'&&readOnly&&profiles.object1 ? ['object1','object2'] : roles[mode];
  const targetRole = activeRoles.includes(selectedRole) ? selectedRole : activeRoles[0];
  const singleIdent = mode==='IDENT'&&activeRoles.length===1;
  const request = async (path, options={}) => {
    const response = await fetch('/api/probability'+path,{...options,headers:{Authorization:'Bearer '+localStorage.getItem('token'),'X-Active-Department-Id':departmentId,...(options.body && !(options.body instanceof FormData) ? {'Content-Type':'application/json'} : {}),...options.headers}});
    if (!response.ok) { const data = await response.json().catch(()=>({})); throw new Error(data.message||'Не удалось выполнить запрос.'); }
    return response;
  };
  useEffect(() => {
    let mounted=true;
    Promise.all([request('/configuration').then(r=>r.json()),request('/calculations').then(r=>r.json())]).then(([c,s])=>{if(mounted){setConfig(c);setSaved(s.calculations);}}).catch(e=>{if(mounted)setError(e.message);});
    return ()=>{mounted=false;};
  },[]);
  const loci = useMemo(() => {
    const names = [...new Set([...activeRoles.flatMap(role => Object.keys(profiles[role]?.loci||{})),...extraLoci])].filter(locus=>isProbabilityLocus(locus,mode));
    const order=config?.loci||[];
    return names.sort((a,b)=>(order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b))||a.localeCompare(b));
  },[mode,profiles,extraLoci,config]);
  // A calculation omits empty manual loci; keep their input rows editable.
  const resultRows = new Map((result?.rows || []).map(row=>[row.locus,row]));
  const editableRows = loci.map(locus=>resultRows.get(locus)||{locus,selectable:isProbabilityLocus(locus,mode)});
  const view=useMemo(()=>result?.report?reportView(result.report):null,[result?.report]);
  const filled = locus => hasAllProbabilityGenotypes(activeRoles.map(role=>profiles[role]?.loci[locus]));
  const enabled = locus => isProbabilityLocus(locus,mode)
    && (typeof selection[mode]?.[locus]==='boolean' ? selection[mode][locus] : filled(locus));
  const invalidate = () => {setResult(null);setNotice('');};
  const choose = (role,source) => {
    if(readOnly)return;
    const current=profiles[role];
    if(source?.sourceType==='txt' && current?.sourceType==='txt' && current.sourceId===source.sourceId) {
      setTargetRole(activeRoles.find(r=>!profiles[r])||role);return;
    }
    if(current && Object.keys(current.manualOverrides||{}).length && !window.confirm('Заменить образец? Ручные изменения этого участника будут удалены.'))return;
    const next={...profiles,[role]:source ? {...source,manualOverrides:{}} : null};
    setProfiles(next);setTargetRole(source ? activeRoles.find(r=>!next[r])||role : role);invalidate();
    setAnnouncement(source ? `${participantNames[role]}: ${source.displayName}` : 'Выбор образца очищен.');
  };
  const run = async fn => {if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{busyRef.current=false;setBusy(false);}};
  const payload = () => ({mode,formulaVersion:config?.formulaVersion,referenceId:config?.reference?.id,includedLoci:loci.filter(enabled),participants:activeRoles.map(role=>({role,...profiles[role]}))});
  async function compute(save=false) {
    const data=await (await request(save?'/calculations':'/calculate',{method:'POST',body:JSON.stringify(payload())})).json();
    setResult(data);
    if(save){setReadOnly(true);setNotice('Расчёт сохранён: '+data.id);setSaved((await (await request('/calculations')).json()).calculations);}
  }
  const complete = activeRoles.every(role=>profiles[role]);
  useEffect(() => {
    if(!complete||!config||readOnly)return undefined;
    let cancelled=false;
    const timer=setTimeout(async()=>{try{const data=await(await request('/calculate',{method:'POST',body:JSON.stringify(payload())})).json();if(!cancelled){setResult(data);setError('');}}catch(e){if(!cancelled)setError(e.message);}},350);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[mode,profiles,selection,extraLoci,config,readOnly]);
  async function upload(picked) {
    if(!picked.length||readOnly)return;
    await run(async()=>{
      if(picked.some(file=>!file.name.toLowerCase().endsWith('.txt')))throw new Error('Выберите GeneMapper TXT.');
      if(picked.length>10||picked.some(file=>file.size>2*1024*1024)||picked.reduce((sum,file)=>sum+file.size,0)>20*1024*1024)throw new Error('За раз можно загрузить до 10 TXT по 2 МиБ, суммарно до 20 МиБ.');
      const body=new FormData();picked.forEach(file=>body.append('files',file));
      const data=await(await request('/txt/preview',{method:'POST',body})).json();
      setFiles(prev=>mergeTxtFiles(prev,data.files));
      const available=data.files.flatMap(f=>f.samples).filter(sample=>sample.selectable);
      if(mode==='IDENT' && available.length===1 && !profiles.object)choose('object',available[0]);
      setAnnouncement(available.length ? `Доступно новых образцов: ${available.length}. ${mode==='TRIO'?'Назначьте их участникам TRIO.':'Выберите исследуемый образец.'}` : 'В файлах нет доступных образцов. Проверьте служебные образцы и результаты генотипирования.');
    });
  }
  function removeFile(fileId) {
    const next=withoutTxtFile(files,profiles,fileId);
    const removed=Object.keys(profiles).filter(role=>profiles[role]&&!next.profiles[role]);
    if(removed.length&&!window.confirm(`Удалить файл и очистить выбранные из него образцы (${removed.map(role=>participantNames[role]).join(', ')})?`))return;
    setFiles(next.files);setProfiles(next.profiles);setTargetRole(activeRoles.find(role=>!next.profiles[role])||activeRoles[0]);invalidate();
  }
  async function openSaved(id) {
    if(!id)return;
    if(Object.values(profiles).some(Boolean)&&!readOnly&&!window.confirm('Открыть сохранённый расчёт? Несохранённый ввод будет заменён.'))return;
    await run(async()=>{const data=await (await request('/calculations/'+id)).json();setMode(data.mode);setProfiles(Object.fromEntries(data.participants.map(p=>[p.role,p])));setResult(data);setReadOnly(true);setSelection({[data.mode]:Object.fromEntries(data.rows.map(r=>[r.locus,r.enabled]))});});
  }
  function edit(role,locus,value) {
    setProfiles(all=>{const p=all[role];if(!p)return all;return{...all,[role]:{...p,loci:{...p.loci,[locus]:value.split(',').map(a=>a.trim()).filter(Boolean)},manualOverrides:{...p.manualOverrides,[locus]:value}}};});invalidate();
  }
  function editAllele(locus,index,value) {
    const values=alleleValues(locus);
    edit('object',locus,(index===0?[value,...values.slice(1)]:[values[0]||'',value]).join(','));
  }
  const alleleValues = locus => typeof profiles.object?.manualOverrides?.[locus]==='string'
    ? profiles.object.manualOverrides[locus].split(',') : profiles.object?.loci[locus]||[];
  async function image() {
    if(!result?.report)return;
    downloadBlob(await reportPng(result.report),`probability-${mode}.png`);
  }
  function reset(){if(Object.values(profiles).some(Boolean)&&!readOnly&&!window.confirm('Начать новый расчёт? Текущий несохранённый ввод будет очищен.'))return;setProfiles({});setFiles([]);setTargetRole(roles[mode][0]);setResult(null);setReadOnly(false);setSelection({});setExtraLoci([]);setError('');setNotice('');}
  return <section className="probability-page" aria-label="Расчёт вероятности" onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}}>
    <div className="probability-toolbar">
      <div className="probability-modes" role="tablist" aria-label="Режим расчёта">{Object.keys(roles).map(m=><button key={m} id={'probability-tab-'+m} role="tab" aria-controls="probability-panel" tabIndex={mode===m?0:-1} className={'probability-tab'+(mode===m?' is-active':'')} disabled={busy||readOnly} aria-selected={mode===m} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const names=Object.keys(roles),index=names.indexOf(m);const next=e.key==='Home'?names[0]:e.key==='End'?names[names.length-1]:names[(index+(e.key==='ArrowRight'?1:-1)+names.length)%names.length];setMode(next);setTargetRole(roles[next][0]);invalidate();document.getElementById('probability-tab-'+next)?.focus();}} onClick={()=>{setMode(m);setTargetRole(roles[m][0]);invalidate();}}>{m}</button>)}</div>
      <button className="btn btn-secondary" onClick={reset} disabled={busy}>Новый расчёт</button>
      <label className="probability-saved">Сохранённые<select aria-label="Сохранённые расчёты" value={result?.id||''} disabled={busy} onChange={e=>openSaved(e.target.value)}><option value="">Открыть сохранённый…</option>{saved.map(s=><option key={s.id} value={s.id}>{s.mode} · {new Date(s.created_at).toLocaleString('ru-RU')}</option>)}</select></label>
      <button className="btn btn-secondary" aria-label="Справка по расчёту вероятности" aria-expanded={help} onClick={()=>setHelp(v=>!v)}>Формулы</button>
    </div>
    <div className="probability-sr-only" role="status" aria-live="polite">{announcement}</div>
    {error&&<div className="alert alert-danger" role="alert">{error}</div>}{notice&&<div className="probability-notice" role="status">{notice}</div>}
    {help&&<ProbabilityHelp mode={mode} onClose={()=>setHelp(false)}/>}
    <div role="tabpanel" id="probability-panel" aria-labelledby={'probability-tab-'+mode} className="probability-tab-panel">
    <ProbabilitySources mode={mode} roles={activeRoles} profiles={profiles} files={files} disabled={readOnly||busy} readOnly={readOnly}
      targetRole={targetRole} setTargetRole={setTargetRole} upload={upload} choose={choose} removeFile={removeFile} request={request} run={run}/>
    <div className={'probability-workspace'+(singleIdent?' probability-workspace-ident':'')}><section className="probability-input-workspace" aria-label="Генотипы участников">
    <div className="probability-section-heading"><h2><span className="probability-step">2</span>Генотипы</h2><span className="probability-count">{loci.filter(enabled).length} из {loci.length} локусов</span></div>
    <div className="probability-locus-actions"><span>Локусы</span>{[['Все заполненные',true],['Снять',false]].map(([text,on])=><button className="btn btn-secondary" key={text} disabled={busy||readOnly} onClick={()=>{setSelection(prev=>({...prev,[mode]:Object.fromEntries(loci.map(l=>[l,on&&filled(l)]))}));invalidate();}}>{text}</button>)}
      <input aria-label="Добавить локус" list="probability-loci" placeholder="Локус" value={newLocus} onChange={e=>setNewLocus(e.target.value)} disabled={readOnly||busy}/><datalist id="probability-loci">{config?.loci.filter(l=>isProbabilityLocus(l,mode)).map(l=><option key={l} value={l}/>)}</datalist><button className="btn btn-secondary" disabled={readOnly||busy||!newLocus.trim()} onClick={()=>{const name=detector.getCanonicalLocusName(newLocus)||newLocus.trim();setExtraLoci(v=>[...new Set([...v,name])]);setNewLocus('');invalidate();}}>Добавить</button>
      <button className="btn btn-secondary" aria-pressed={showDetails} onClick={()=>setShowDetails(v=>!v)}>Частоты и LR</button>
    </div>
    {singleIdent&&<p className="probability-input-note">Две колонки — аллели одного объекта. Одиночная аллель и запись вида 30,* учитываются как гомозиготная пара; исходная запись сохраняется.</p>}
    {mode==='TRIO'&&<p className="probability-input-note">Отцовская аллель учитывает все три генотипа; «или» — два совместимых варианта.</p>}
    {editableRows.length>0 ? <div className={'probability-table-scroll'+(singleIdent?' probability-ident-scroll':'')}><table className={'probability-loci-table'+(singleIdent?' probability-ident-table':'')+(showDetails?' probability-table-details':'')}>
      <colgroup><col className="probability-col-check"/><col className="probability-col-locus"/>
        {singleIdent?[0,1].map(i=><col className="probability-col-allele" key={i}/>):activeRoles.map(role=><col className="probability-col-genotype" key={role}/>)}
        {mode==='TRIO'&&<col className="probability-col-paternal"/>}{showDetails&&<><col className="probability-col-frequency"/><col className="probability-col-value"/></>}<col className="probability-col-status"/>
      </colgroup><thead><tr>
      <th>✓</th><th>Локус</th>{singleIdent?[0,1].map(i=><th key={i} aria-label={'Аллель '+(i+1)}/>):activeRoles.map(r=><th key={r}>{labels[r]}</th>)}
      {mode==='TRIO'&&<th>Отцовская аллель ребёнка</th>}{showDetails&&<><th>Частоты p/q</th><th>{mode==='IDENT'?'1/Q':'LR'}</th></>}<th>Статус</th>
    </tr></thead><tbody>{editableRows.map(row=><tr key={row.locus} className={row.selectable?'':'probability-noncalculating'}>
      <td><input type="checkbox" aria-label={'Учитывать '+row.locus} checked={enabled(row.locus)} disabled={!row.selectable||busy||readOnly} onChange={e=>{const on=e.target.checked;setSelection(prev=>({...prev,[mode]:{...prev[mode],[row.locus]:on}}));invalidate();}}/></td><th scope="row">{row.locus}</th>
      {singleIdent?[0,1].map(index=><td key={index}><input aria-label={`Аллель ${index+1}: ${row.locus}`}
        value={index===0?alleleValues(row.locus)[0]||'':alleleValues(row.locus).slice(1).join(',')}
        disabled={!profiles.object||busy||readOnly} onChange={e=>editAllele(row.locus,index,e.target.value)} title="Аллель исследуемого генотипа; изменяется только копия для расчёта"/></td>)
        :activeRoles.map(role=><td key={role}><input aria-label={labels[role]+': '+row.locus} value={typeof profiles[role]?.manualOverrides?.[row.locus]==='string'?profiles[role].manualOverrides[row.locus]:(profiles[role]?.loci[row.locus]||[]).join(',')} disabled={!profiles[role]||busy||readOnly} onChange={e=>edit(role,row.locus,e.target.value)} title="Изменяется только копия для расчёта"/></td>)}
      {mode==='TRIO'&&<PaternalAllele row={row}/>}
      {showDetails&&<><td className="probability-frequency">{row.frequencies?.length?row.frequencies.map(f=><span key={f.allele}>{f.allele}: {f.value.toFixed(4)}{f.origin==='locus_minimum'?'*':''}</span>):'—'}</td><td title={row.formula}>{row.value!=null?row.value.toExponential(6):'—'}</td></>}<td className="probability-row-status" title={row.message}>{row.message||(!row.selectable?'Не рассчитывается':!filled(row.locus)?'Неполные генотипы':'—')}</td>
    </tr>)}{!editableRows.length&&<tr><td colSpan={(singleIdent?2:activeRoles.length)+3+(mode==='TRIO'?1:0)+(showDetails?2:0)}>Загрузите TXT в нужный блок или добавьте локус для ручного ввода.</td></tr>}</tbody></table></div> : <div className="probability-empty-state"><span className="probability-empty-glyph" aria-hidden="true">≡</span><strong>Локусы появятся после выбора образцов</strong><p>Загрузите TXT и назначьте участников. Для ручного ввода добавьте локус выше.</p></div>}
    </section>
    <aside className="probability-result-workspace" aria-label="Результат расчёта">
      <div className="probability-section-heading"><h2><span className="probability-step">3</span>Результат расчёта</h2><span className="probability-count">{readOnly?'Сохранён':'Предпросмотр A4'}</span></div>
      <div className="probability-results-actions">
        <button className="btn btn-primary" disabled={busy||!complete||!config||readOnly} onClick={()=>run(()=>compute())}>{busy?'Обработка…':'Рассчитать'}</button>
        <button className="btn btn-secondary" disabled={busy||!complete||readOnly||!config} onClick={()=>run(()=>compute(true))}>Сохранить</button>
        <button className="btn btn-secondary" disabled={!result?.report||busy} onClick={()=>run(()=>image())}>PNG</button>
        <button className="btn btn-secondary" disabled={!result?.summary||busy} onClick={()=>run(async()=>{const response=readOnly?await request('/calculations/'+result.id+'/export?format=xlsx'):await request('/export',{method:'POST',body:JSON.stringify(payload())});downloadBlob(await response.blob(),`probability-${mode}.xlsx`);})}>Выгрузить в формате XLSX</button>
      </div>
      {result?.status==='blocked'&&<p className="probability-blocked" role="alert">Расчёт заблокирован: {result.blockedLoci.join(', ')}. Проверьте значения и статусы или явно исключите эти локусы.</p>}
      {result?.report?<>
        <div className="probability-report-area"><ProbabilityReport report={result.report} view={view}/></div>
      </>:<div className="probability-result-placeholder"><span className="probability-empty-glyph" aria-hidden="true">↗</span><strong>{result?.status==='blocked'?'Проверьте отмеченные локусы':'Результат появится здесь'}</strong><p>{result?.status==='blocked'?'Исправьте значения или исключите локусы из расчёта.':`Выберите ${mode==='TRIO'?'образцы трёх участников':'исследуемый образец'}. Расчёт выполнится автоматически.`}</p></div>}
    </aside></div></div>
  </section>;
}
export default function ProbabilityPage() {
  const { user, activeDepartment }=useAuth();
  if(resolveProfileImportFormat(activeDepartment)!=='genetic'||!canUse(user?.role))return <div className="alert alert-warning">Раздел доступен экспертам отделения «Генетические экспертизы».</div>;
  return <Workspace key={activeDepartment.id} departmentId={activeDepartment.id}/>;
}
