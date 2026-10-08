import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';
import { LociTypeDetector } from '../../../../src/utils/lociTypeDetector';

const detector = new LociTypeDetector();
const emptyPanel = () => ({ name: '', description: '', lociOrder: [], isActive: true, referenceSetIds: [] });

export default function GenotypePanelsPage() {
  const { user, activeDepartment, activeDepartmentId } = useAuth();
  const isGenetic = resolveProfileImportFormat(activeDepartment) === 'genetic';
  const canEdit = ['admin', 'system_administrator', 'department_head'].includes(user?.role);
  const [panels, setPanels] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [references, setReferences] = useState([]);
  const [draft, setDraft] = useState(null);
  const [locusInput, setLocusInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const draggedIndex = useRef(null);

  const request = async (path = '', options = {}) => {
    const response = await fetch(`/api/genotype-panels${path}`, {
      ...options, headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'X-Active-Department-Id': activeDepartmentId,
        'Content-Type': 'application/json'
      }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'Не удалось загрузить панели.');
    return body;
  };

  useEffect(() => {
    const controller = new AbortController();
    setPanels([]); setCatalog([]); setDraft(null); setError(''); setMessage('');
    if (!isGenetic) return;
    setLoading(true);
    Promise.all([request('?includeInactive=true', { signal: controller.signal }), request('/loci', { signal: controller.signal }), fetch('/api/allele-references?includeInactive=true', { signal: controller.signal, headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'X-Active-Department-Id': activeDepartmentId } }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Ошибка справочников.'); return body; })])
      .then(([list, loci, refs]) => { if (!controller.signal.aborted) { setPanels(list.panels); setCatalog(loci.loci); setReferences(refs.references); } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activeDepartmentId, isGenetic]);

  const addLocus = () => {
    const canonical = detector.getCanonicalLocusName(locusInput);
    if (!canonical) { setError(`Локус ${locusInput || 'с пустым названием'} пока не поддерживается системой. Сначала добавьте его в каталог поддерживаемых локусов.`); return; }
    if (draft.lociOrder.includes(canonical)) { setError('Этот локус уже добавлен в панель.'); return; }
    setDraft({ ...draft, lociOrder: [...draft.lociOrder, canonical] }); setLocusInput(''); setError('');
  };
  const move = (from, to) => {
    if (from == null || to < 0 || to >= draft.lociOrder.length) return;
    const lociOrder = [...draft.lociOrder];
    lociOrder.splice(to, 0, lociOrder.splice(from, 1)[0]);
    setDraft({ ...draft, lociOrder });
  };
  const save = async event => {
    event.preventDefault(); setError(''); setMessage(''); setSaving(true);
    try {
      const result = await request(draft.id ? `/${draft.id}` : '', { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify(draft) });
      setPanels(previous => [...previous.filter(panel => panel.id !== result.panel.id), result.panel]);
      setDraft(null); setMessage('Панель сохранена.');
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const deactivate = async panel => {
    setError(''); setSaving(true);
    try {
      const result = await request(`/${panel.id}`, { method: 'DELETE' });
      setPanels(previous => previous.map(item => item.id === panel.id ? result.panel : item));
      setMessage('Панель деактивирована. У ранее загруженных профилей она сохранена.');
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return <div className="panels-page">
    <div className="page-header"><div><h1>Генетические панели</h1><p className="page-subtitle">Название, состав и порядок локусов для отделения «Генетические экспертизы».</p></div>
      {isGenetic && canEdit && <button className="btn btn-primary" disabled={saving || loading} onClick={() => { setDraft(emptyPanel()); setLocusInput(''); setError(''); setMessage(''); }}>Создать панель</button>}
    </div>
    {!isGenetic ? <div className="alert alert-info">Выберите отделение «Генетические экспертизы», чтобы открыть справочник панелей.</div> : <>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {loading ? <p role="status">Загрузка панелей…</p> : <div className="table-container"><table className="table panels-table"><thead><tr><th>Название</th><th>Локусы</th><th>Активность</th><th>Обновлена</th><th>Действия</th></tr></thead><tbody>
        {panels.map(panel => <tr key={panel.id}><td>{panel.name}</td><td>{panel.lociOrder.length}</td><td>{panel.isActive ? 'Активна' : 'Неактивна'}</td><td>{new Date(panel.updatedAt).toLocaleString('ru-RU')}</td><td className="panels-actions">
          <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => { setDraft({ ...panel }); setLocusInput(''); setError(''); }}>{canEdit ? 'Редактировать' : 'Просмотреть'}</button>
          {canEdit && panel.isActive && <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => deactivate(panel)}>Деактивировать</button>}
        </td></tr>)}
        {!panels.length && <tr><td colSpan="5">Панели пока не созданы. Добавьте состав и порядок локусов по документации вашей панели.</td></tr>}
      </tbody></table></div>}
      {draft && <section className="card panels-editor"><h2>{draft.id ? draft.name : 'Новая панель'}</h2><form onSubmit={save}>
        <div className="form-group"><label className="form-label" htmlFor="panel-name">Название панели</label><input id="panel-name" className="form-input" value={draft.name} maxLength={150} required disabled={!canEdit || saving} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="panel-description">Описание</label><textarea id="panel-description" className="form-input" value={draft.description || ''} maxLength={10000} disabled={!canEdit || saving} onChange={e => setDraft({ ...draft, description: e.target.value })} /></div>
        <label className="panels-active"><input type="checkbox" checked={draft.isActive} disabled={!canEdit || saving} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} /> Активная панель</label>
        <h3>Подтверждённые референсные наборы</h3><p>Выберите соответствующие источники вручную. Если активных лестниц несколько, версия выбирается в конвертере.</p>
        {references.map(reference => <label className="panels-active" key={reference.id}><input type="checkbox" disabled={!canEdit || saving} checked={(draft.referenceSetIds || []).includes(reference.id)} onChange={event => setDraft({ ...draft, referenceSetIds: event.target.checked ? [...(draft.referenceSetIds || []), reference.id] : draft.referenceSetIds.filter(id => id !== reference.id) })} />{reference.name} · {reference.sourceVersion}{!reference.isActive && ' (неактивен)'}</label>)}
        {!references.length && <p>Справочники пока не загружены. <a href="/settings/allele-references">Открыть справочники</a></p>}
        <h3>Порядок локусов</h3><p>Перетащите локус или используйте кнопки перемещения.</p>
        <ol className="panels-loci-list">{draft.lociOrder.map((name, index) => <li key={name} draggable={canEdit && !saving}
          onDragStart={event => { draggedIndex.current = index; event.dataTransfer.setData('text/plain', name); event.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => { draggedIndex.current = null; }} onDragOver={event => event.preventDefault()}
          onDrop={event => { event.preventDefault(); if (canEdit && !saving) move(draggedIndex.current, index); draggedIndex.current = null; }}>
          <span className="panels-locus-name">{index + 1}. {name}</span>
          {canEdit && <span className="panels-actions"><button type="button" className="btn btn-secondary btn-sm" aria-label={`Переместить ${name} вверх`} disabled={saving || index === 0} onClick={() => move(index, index - 1)}>↑</button><button type="button" className="btn btn-secondary btn-sm" aria-label={`Переместить ${name} вниз`} disabled={saving || index === draft.lociOrder.length - 1} onClick={() => move(index, index + 1)}>↓</button><button type="button" className="btn btn-secondary btn-sm" aria-label={`Удалить ${name} из панели`} disabled={saving} onClick={() => setDraft({ ...draft, lociOrder: draft.lociOrder.filter(locus => locus !== name) })}>Удалить</button></span>}
        </li>)}</ol>
        {canEdit && <div className="panels-add"><label className="form-label" htmlFor="panel-locus">Добавить локус</label><input id="panel-locus" className="form-input" list="panel-locus-catalog" placeholder="Найдите или введите локус" value={locusInput} disabled={saving} onChange={e => setLocusInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLocus(); } }} /><datalist id="panel-locus-catalog">{catalog.filter(locus => !draft.lociOrder.includes(locus.name)).map(locus => <option key={locus.name} value={locus.name}>{locus.type}</option>)}</datalist><button type="button" className="btn btn-secondary" disabled={!locusInput.trim() || saving} onClick={addLocus}>Добавить</button></div>}
        <div className="panels-actions">{canEdit && <button className="btn btn-primary" type="submit" disabled={saving || !draft.lociOrder.length}>{saving ? 'Сохранение…' : 'Сохранить панель'}</button>}<button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setDraft(null)}>Закрыть</button></div>
      </form></section>}
    </>}
  </div>;
}
