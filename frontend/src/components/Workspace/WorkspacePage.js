import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getAnalysisLoci } from '../../../../src/utils/analysisLoci';
import { orderNormalizedLoci } from '../../../../src/utils/normalizedExcelLayout';
import { OBJECT_TYPES as types, WORKSPACE_WRITE_ROLES, objectMetadataIssues } from '../../../../src/utils/objectTypes';
const states = {
  NOT_CHECKED: 'Не проверен',
  CHECKING: 'Проверяется',
  NO_GENOTYPE: 'Нет генотипа',
  CHECKED: 'Проверен',
  STALE: 'Проверка устарела',
  PUBLISHED: 'Опубликован',
  INSUFFICIENT_DATA: 'Недостаточно данных'
};
const fields = ['included', 'objectNumber', 'year', 'expertiseType', 'fullName', 'registrationNumber', 'comment', 'strData'];
function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function WorkspacePage({
  mode = 'profiles',
  preparedFile
}) {
  const {
      user
    } = useAuth(),
    isImport = mode === 'import',
    storageKey = `workspace-draft:${user.organization_id}:${user.id}`;
  const canUpload = WORKSPACE_WRITE_ROLES.includes(user.role) && (user.can_upload_with_task !== false || user.can_upload_without_task === true);
  const canEdit = WORKSPACE_WRITE_ROLES.includes(user.role) && (!isImport || canUpload);
  const [workspace, setWorkspace] = useState(null),
    [draft, setDraft] = useState(null),
    [rows, setRows] = useState([]),
    [selected, setSelected] = useState(new Set()),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [validation, setValidation] = useState(null),
    [result, setResult] = useState(null);
  const [year, setYear] = useState(''),
    [type, setType] = useState('ug'),
    [bulkScope, setBulkScope] = useState('selected'),
    [undo, setUndo] = useState(null),
    [details, setDetails] = useState(null),
    [genotypeText, setGenotypeText] = useState(''),
    [minMatches, setMinMatches] = useState(15),
    [algorithm, setAlgorithm] = useState('standard');
  const [sort, setSort] = useState({
    field: '',
    direction: 1
  });
  const [autoSaving, setAutoSaving] = useState(false);
  const draftRef = useRef(null),
    rowsRef = useRef([]),
    saveInFlight = useRef(null);
  draftRef.current = draft;
  rowsRef.current = rows;
  const input = useRef(),
    retryFiles = useRef([]),
    commitKey = useRef(),
    initial = useRef(null),
    lastPrepared = useRef(null);
  async function api(path, body, method = body ? 'POST' : 'GET', blob = false) {
    const response = await fetch('/api/workspace' + path, {
      method,
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        ...(body instanceof FormData ? {} : {
          'Content-Type': 'application/json'
        })
      },
      ...(body ? {
        body: body instanceof FormData ? body : JSON.stringify(body)
      } : {})
    });
    if (!response.ok) {
      const failure = await response.json();
      const more = Array.isArray(failure.details) ? failure.details.flatMap(i => i.issues || [i]).map(i => i.message).filter(Boolean).join('\n') : '';
      throw Error([failure.message, more].filter(Boolean).join('\n'));
    }
    return blob ? response.blob() : response.json();
  }
  async function load() {
    const data = await api('/');
    setWorkspace(data);
    setMinMatches(data.workspace.analysis_parameters?.minMatches ?? 15);
    setAlgorithm(data.workspace.analysis_parameters?.comparisonAlgorithm || 'standard');
    setRows(data.profiles);
    initial.current = data.profiles;
    setSelected(old => new Set([...old].filter(id => data.profiles.some(p => p.id === id))));
  }
  useEffect(() => {
    let alive = true;
    setError('');
    setDetails(null);
    setPage(0);
    setValidation(null);
    setResult(null);
    if (isImport) {
      const id = localStorage.getItem(storageKey);
      if (id) api('/import-drafts/' + id).then(d => {
        if (alive) {
          setDraft(d);
          setRows(d.rows);
          initial.current = d.rows;
          // UUID черновика уже создан сервером; ключ повтора работает и по обычному HTTP.
          commitKey.current = localStorage.getItem(storageKey + ':commitKey') || d.id;
          localStorage.setItem(storageKey + ':commitKey', commitKey.current);
        }
      }).catch(e => {
        if (alive) setError(e.message);
      });else {
        setDraft(null);
        setRows([]);
      }
    } else load().catch(e => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [mode, user.id, user.organization_id]);
  useEffect(() => {
    if (isImport && preparedFile?.file && lastPrepared.current !== preparedFile.file) {
      lastPrepared.current = preparedFile.file;
      upload([preparedFile.file]);
    }
  }, [preparedFile, isImport]);
  const id = row => row.draftRowId || row.id,
    visible = useMemo(() => {
      const filtered = rows.filter(row => `${row.objectNumber} ${row.year ?? ''} ${types[row.expertiseType] || ''} ${row.fullName || ''} ${row.comment || ''}`.toLowerCase().includes(query.toLowerCase()));
      const value = row => sort.field.startsWith('locus:') ? (row.strData[sort.field.slice(6)] || []).join(',') : row[sort.field] ?? '';
      return sort.field ? filtered.sort((a, b) => String(value(a)).localeCompare(String(value(b)), 'ru', {
        numeric: true,
        sensitivity: 'base'
      }) * sort.direction) : filtered;
    }, [rows, query, sort]);
  const included = rows.filter(row => isImport ? row.included : selected.has(row.id)),
    countEmpty = rs => rs.filter(row => !Object.values(row.strData || {}).some(a => a.length)).length;
  const loci = useMemo(() => orderNormalizedLoci(getAnalysisLoci(rows)), [rows]);
  function sortHeader(field, label) {
    return <th aria-sort={sort.field === field ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" className="workspace-sort" onClick={() => {
        setSort(current => ({
          field,
          direction: current.field === field ? -current.direction : 1
        }));
        setPage(0);
      }}>{label}{sort.field === field ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>;
  }
  function change(row, key, value) {
    setRows(old => old.map(item => id(item) === id(row) ? {
      ...item,
      [key]: value,
      ...(key === 'strData' ? {
        _manualReview: true
      } : {}),
      ...(key === 'expertiseType' && value !== 'staff' ? {
        fullName: '',
        registrationNumber: null
      } : {}),
      ...(key === 'objectNumber' && item.expertiseType === 'staff' ? {
        registrationNumber: value
      } : {})
    } : item));
    setValidation(null);
    setNotice('');
  }
  function chooseAll(value) {
    if (isImport) {
      const ids = new Set(visible.map(id));
      setRows(old => old.map(row => ids.has(id(row)) ? {
        ...row,
        included: row.provenance?.classification && !row.provenance.classification.included ? false : value
      } : row));
      setValidation(null);
    } else setSelected(old => {
      const next = new Set(old);
      visible.forEach(row => value ? next.add(row.id) : next.delete(row.id));
      return next;
    });
  }
  async function upload(files) {
    if (!files.length) return;
    retryFiles.current = files;
    if (draft && !window.confirm('Заменить текущий черновик новыми файлами?')) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      files.forEach(file => form.append('files', file));
      const d = await api('/import-drafts', form);
      setDraft(d);
      setRows(d.rows);
      initial.current = d.rows;
      localStorage.setItem(storageKey, d.id);
      commitKey.current = localStorage.getItem(storageKey + ':commitKey') || d.id;
      localStorage.setItem(storageKey + ':commitKey', commitKey.current);
      setValidation(null);
      setUndo(null);
      setPage(0);
      retryFiles.current = [];
      setNotice('Задайте год и тип выбранным объектам.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const affected = rows.filter(row => bulkScope === 'all' || bulkScope === 'empty' || (isImport ? row.included : selected.has(row.id)));
  function bulk(field, value) {
    if (value === '' || value == null) {
      setError('Выберите значение перед применением.');
      return;
    }
    const targets = affected.filter(row => bulkScope !== 'empty' || row[field] == null || row[field] === '');
    if (targets.some(row => row[field] !== '' && row[field] != null && row[field] !== value) && !window.confirm(`Заменить уже заполненные значения? Объектов: ${targets.length}.`)) return;
    setUndo(rows);
    const ids = new Set(targets.map(id));
    setRows(old => old.map(row => ids.has(id(row)) ? {
      ...row,
      [field]: value,
      ...(field === 'expertiseType' && value !== 'staff' ? {
        fullName: '',
        registrationNumber: null
      } : {})
    } : row));
    setValidation(null);
    setNotice(`Изменено объектов: ${targets.length}.`);
  }
  async function saveDraft() {
    if (saveInFlight.current) await saveInFlight.current;
    const snapshot = rowsRef.current,
      current = draftRef.current;
    const previous = new Map((initial.current || []).map(row => [row.draftRowId, row]));
    const changed = snapshot.filter(row => JSON.stringify(previous.get(row.draftRowId)) !== JSON.stringify(row));
    if (!changed.length) return current;
    const patches = changed.map(row => ({
      draftRowId: row.draftRowId,
      ...Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]))
    }));
    for (const patch of patches) {
      const row = snapshot.find(r => r.draftRowId === patch.draftRowId);
      if (!row._manualReview && JSON.stringify(previous.get(patch.draftRowId)?.strData) === JSON.stringify(patch.strData)) delete patch.strData;
    }
    const promise = api('/import-drafts/' + current.id + '/rows', {
      revision: current.revision,
      rows: patches
    }, 'PATCH').then(next => {
      initial.current = next.rows;
      draftRef.current = next;
      setDraft(next);
      if (rowsRef.current === snapshot) setRows(next.rows);
      return next;
    });
    saveInFlight.current = promise;
    try {
      return await promise;
    } finally {
      saveInFlight.current = null;
    }
  }
  useEffect(() => {
    if (!isImport || !draft || busy || JSON.stringify(rows) === JSON.stringify(initial.current)) return undefined;
    const timer = setTimeout(() => {
      setAutoSaving(true);
      saveDraft().catch(e => setError(e.message)).finally(() => setAutoSaving(false));
    }, 800);
    return () => clearTimeout(timer);
  }, [rows, draft?.revision, busy, isImport]);
  async function updateSearchSettings(next) {
    setResult(null);
    setRows(current => current.map(row => row.state === 'CHECKED' ? {
      ...row,
      state: 'STALE'
    } : row));
    try {
      await api('/search-settings', {
        parameters: {
          minMatches: Number(next.minMatches ?? minMatches),
          comparisonAlgorithm: next.algorithm ?? algorithm
        }
      }, 'PATCH');
    } catch (e) {
      setError(e.message);
    }
  }
  const exportName = () => {
    const filenames = [...new Set(rows.map(row => row.sourceFilename))];
    return filenames.length === 1 && /\.txt$/i.test(filenames[0]) ? filenames[0].replace(/\.txt$/i, '.xlsx') : 'Генотипы.xlsx';
  };
  async function saveWorking() {
    for (const row of rows) {
      const old = initial.current.find(x => x.id === row.id);
      if (JSON.stringify(old) !== JSON.stringify(row)) await api('/profiles/' + row.id, Object.fromEntries(fields.filter(k => k !== 'included' && row[k] !== undefined).map(k => [k, row[k]])), 'PATCH');
    }
  }
  async function action(name) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (isImport) {
        const d = await saveDraft();
        const valid = await api('/import-drafts/' + d.id + '/validate', {
          revision: d.revision
        });
        setValidation(valid);
        if (!valid.valid) {
          setError(`В выбранных строках ошибок: ${valid.errors.length}. Исправьте их или снимите выбор.`);
          return;
        }
        if (name === 'commit') {
          const done = await api('/import-drafts/' + d.id + '/commit', {
            revision: d.revision,
            idempotencyKey: commitKey.current
          });
          setNotice(`Загружено объектов: ${done.ids.length}. Откройте «Мои генотипы» для полного поиска.`);
          localStorage.removeItem(storageKey);
          localStorage.removeItem(storageKey + ':commitKey');
          setDraft(null);
          setRows([]);
        } else {
          saveFile(await api('/import-drafts/' + d.id + '/export', {
            revision: d.revision
          }, 'POST', true), exportName());
          setNotice('Проверка завершена. XLSX подготовлен по выбранным строкам.');
        }
      } else {
        if (name === 'save') {
          await saveWorking();
          await load();
          setNotice('Изменения сохранены.');
          return;
        }
        if (['search', 'publish', 'export'].includes(name)) await saveWorking();
        const ids = [...selected];
        if (!ids.length) throw Error('Выберите объекты.');
        if (name === 'delete') {
          if (!window.confirm(`Удалить выбранные рабочие профили (${ids.length})? Опубликованные записи сохранятся.`)) return;
          await api('/profiles/delete', {
            ids
          });
          setSelected(new Set());
          await load();
        }
        if (name === 'export') saveFile(await api('/profiles/export', {
          ids
        }, 'POST', true), 'Генотипы_' + new Date().toISOString().slice(0, 10) + '.xlsx');
        if (name === 'search') {
          const found = await api('/full-search', {
            ids,
            parameters: {
              minMatches: Number(minMatches),
              comparisonAlgorithm: algorithm
            }
          });
          setResult(found);
          await load();
          setNotice('Поиск завершён. Найденные совпадения показаны отдельно от состояния проверки.');
        }
        if (name === 'publish') {
          if (rows.some(row => ids.includes(row.id) && !['CHECKED', 'PUBLISHED'].includes(row.state))) throw Error('В выборе есть непроверенные или устаревшие записи. Выполните полный поиск либо выберите только готовые.');
          const searchRunId = result?.id || rows.find(row => ids.includes(row.id) && row.searchRunId)?.searchRunId;
          const preview = await api('/publication-preview', {
            ids
          });
          const existingTargets = {};
          if (preview.conflicts.length) {
            if (!window.confirm('В общем массиве уже есть записи: ' + preview.conflicts.map(x => `${x.objectNumber} (${x.year}, ${types[x.expertiseType]})`).join(', ') + '. Явно обновить эти опубликованные записи после выполненного полного поиска?')) return;
            for (const conflict of preview.conflicts) {
              if (existingTargets[conflict.profileId]) throw Error('Найдено несколько опубликованных записей одного объекта. Требуется разбор коллизии.');
              existingTargets[conflict.profileId] = conflict.publishedId;
            }
          }
          await api('/publish', {
            ids,
            searchRunId,
            existingTargets
          });
          await load();
          setNotice('Выбранные профили опубликованы.');
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function editGenotype(row) {
    setDetails(row);
    setGenotypeText(JSON.stringify(row.strData, null, 2));
  }
  return <div className="workspace-page"><div className="workspace-heading"><div><h1>{isImport ? 'Загрузка в личный массив' : 'Мои генотипы'}</h1><p>{isImport ? 'Выберите объекты и заполните год и тип. ФИО требуется только сотрудникам.' : 'Постоянный личный массив. Полный поиск выполняется перед явной публикацией.'}</p></div>{!isImport && <a className="btn btn-primary" href="/upload">Загрузить файлы</a>}</div>
 {error && <div className="alert alert-error workspace-message" role="alert">{error}{!!retryFiles.current.length && <button className="btn btn-secondary" onClick={() => upload(retryFiles.current)}>Повторить загрузку</button>}</div>}{notice && <p role="status">{notice}</p>}{isImport && draft && <p role="status">{autoSaving ? 'Сохраняем правки черновика…' : 'Черновик хранится на сервере 24 часа. В личный массив строки попадут после подтверждения загрузки.'}</p>}
 {isImport && <section className="workspace-drop" onDragOver={e => e.preventDefault()} onDrop={e => {
      e.preventDefault();
      if (!busy && canUpload) upload(Array.from(e.dataTransfer.files));
    }}><input ref={input} type="file" multiple accept=".xlsx,.xls,.txt" hidden onChange={e => {
        upload(Array.from(e.target.files));
        e.target.value = '';
      }} /><strong>Excel, GeneMapper TXT или NGS ASTR+</strong><p>Перетащите до 100 файлов сюда или выберите на компьютере.</p><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => input.current.click()}>Выбрать файлы</button><a href="/excel-converter">Открыть конвертер</a></section>}
 {!!rows.length && <>
 <section className="workspace-toolbar"><label>Поиск<input className="form-input" value={query} onChange={e => {
            setQuery(e.target.value);
            setPage(0);
          }} placeholder="Номер, год, тип или комментарий" /></label><label>Год<input className="form-input" type="number" min="1900" max="2100" value={year} onChange={e => setYear(e.target.value)} /></label><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => bulk('year', year === '' ? '' : Number(year))}>Применить год</button><label>Тип<select className="form-input" value={type} onChange={e => setType(e.target.value)}>{Object.entries(types).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => bulk('expertiseType', type)}>Применить тип</button><label>Применить к<select className="form-input" value={bulkScope} onChange={e => setBulkScope(e.target.value)}><option value="selected">Выбранным</option><option value="all">Всем объектам</option><option value="empty">Только незаполненным</option></select></label><span>Область: {affected.length}</span>{undo && <button className="btn btn-secondary" onClick={() => {
          setRows(undo);
          setUndo(null);
          setValidation(null);
        }}>Отменить массовую правку</button>}</section>
 <div className="workspace-actions"><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => chooseAll(true)}>Выбрать весь текущий фильтр</button><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => chooseAll(false)}>Снять выбор в фильтре</button><strong>Выбрано {included.length} из {rows.length}</strong><span>Пустых в выборе: {countEmpty(included)}</span>{isImport && <span>Строк с ошибками в выборе: {included.filter(row => (row.sourceIssues || []).length || objectMetadataIssues(row).length).length}</span>}</div>
 <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th><input type="checkbox" aria-label="Выбрать все строки текущего фильтра" checked={!!visible.length && visible.every(row => isImport ? row.included : selected.has(row.id))} onChange={e => chooseAll(e.target.checked)} /></th>{sortHeader('objectNumber', 'Исходный объект / № Объекта')}{sortHeader('year', 'Год')}{sortHeader('expertiseType', 'Тип экспертизы')}{sortHeader('fullName', 'ФИО сотрудника')}{sortHeader('comment', 'Комментарий')}{!isImport && loci.map(locus => <React.Fragment key={locus}>{sortHeader('locus:' + locus, locus)}</React.Fragment>)}<th>{isImport ? 'Генотип и проверка' : 'Проверка'}</th><th>Данные</th></tr></thead><tbody>{visible.slice(page * 50, (page + 1) * 50).map(row => <tr key={id(row)}><td><input type="checkbox" aria-label={`Выбрать ${row.objectNumber}`} checked={isImport ? row.included : selected.has(row.id)} disabled={busy || !!(isImport && row.provenance?.classification && !row.provenance.classification.included)} onChange={e => isImport ? change(row, 'included', e.target.checked) : setSelected(old => {
                  const next = new Set(old);
                  e.target.checked ? next.add(row.id) : next.delete(row.id);
                  return next;
                })} /></td>
 <td><input aria-label="Номер объекта" className="form-input" value={row.objectNumber} onChange={e => change(row, 'objectNumber', e.target.value)} disabled={busy || !canEdit} />{row.expertiseType === 'staff' ? <small>№ рег.</small> : <small>№ Экспертизы: {row.objectNumber.split('-')[0]}</small>}</td>
 <td><input aria-label="Год объекта" className="form-input" type="number" min="1900" max="2100" value={row.year ?? ''} onChange={e => change(row, 'year', e.target.value === '' ? null : Number(e.target.value))} disabled={busy || !canEdit} /></td>
 <td><select aria-label="Тип объекта" className="form-input" value={row.expertiseType || ''} onChange={e => change(row, 'expertiseType', e.target.value || null)} disabled={busy || !canEdit}><option value="">Выберите</option>{Object.entries(types).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></td>
 <td><input aria-label="ФИО сотрудника" className="form-input" disabled={busy || !canEdit || row.expertiseType !== 'staff'} value={row.fullName || ''} onChange={e => change(row, 'fullName', e.target.value)} /></td>
 <td><textarea aria-label="Комментарий объекта" className="form-input workspace-comment" rows="1" value={row.comment || ''} onChange={e => change(row, 'comment', e.target.value)} disabled={busy || !canEdit} /></td>
 {!isImport && loci.map(locus => <td className="workspace-alleles" key={locus}>{(row.strData[locus] || []).join(',')}</td>)}
 <td>{isImport ? <><span>{countEmpty([row]) ? 'Нет генотипа' : 'Есть данные'}</span>{[...(row.sourceIssues || []), ...(validation?.errors.find(x => x.draftRowId === row.draftRowId)?.issues || [])].map((issue, i) => <div className="workspace-row-error" key={i}>{issue.message}</div>)}</> : <span>{states[row.state] || row.state}</span>}</td><td><button type="button" className="btn btn-secondary" onClick={() => editGenotype(row)}>Открыть</button></td></tr>)}</tbody></table></div>
 <nav className="workspace-actions" aria-label="Страницы объектов"><button className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Назад</button><span>Страница {page + 1} из {Math.max(1, Math.ceil(visible.length / 50))}</span><button className="btn btn-secondary" disabled={(page + 1) * 50 >= visible.length} onClick={() => setPage(p => p + 1)}>Далее</button></nav>
 <div className="workspace-actions">{isImport ? <><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => action('validate')}>Проверить и подготовить XLSX</button><button className="btn btn-primary" disabled={busy || !canEdit} onClick={() => action('commit')}>Загрузить выбранные</button></> : <><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => action('save')}>Сохранить изменения</button><label>Минимум локусов<input type="number" min="1" max="500" disabled={busy || !canEdit} value={minMatches} onChange={e => {
              setMinMatches(e.target.value);
              if (Number(e.target.value) >= 1 && Number(e.target.value) <= 500) updateSearchSettings({
                minMatches: e.target.value
              });
            }} /></label><select aria-label="Алгоритм сравнения" disabled={busy || !canEdit} value={algorithm} onChange={e => {
            setAlgorithm(e.target.value);
            updateSearchSettings({
              algorithm: e.target.value
            });
          }}><option value="standard">Стандартный</option><option value="duplicate_v5">Дубликаты v5</option><option value="contamination">Контаминация</option></select><button className="btn btn-primary" disabled={busy || !canEdit} onClick={() => action('search')}>{busy ? 'Выполняется операция…' : 'Полный поиск выбранных'}</button><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => action('export')}>Экспортировать выбранные</button><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => action('delete')}>Удалить выбранные</button>{workspace?.canPublish && <button className="btn btn-primary" disabled={busy || !canEdit} onClick={() => action('publish')}>Добавить выбранные в общий массив</button>}<button className="btn btn-secondary" disabled={busy} onClick={() => setSelected(new Set(rows.filter(row => row.state === 'CHECKED').map(row => row.id)))}>Выбрать только готовые</button></>}</div>
 </>}
 {!isImport && !rows.length && <p>Массив пока пуст. Загрузите файлы — задача и отделение для этого не требуются.</p>}
 {result && <section className="workspace-search-results"><h2>Результаты полного поиска</h2><p>Проверено: {result.profiles.filter(p => p.state === 'CHECKED').length}; без генотипа: {result.profiles.filter(p => p.state === 'NO_GENOTYPE').length}; недостаточно локусов: {result.profiles.filter(p => p.state === 'INSUFFICIENT_DATA').length}.</p><p>Эталонов мастер-массива: {result.referenceCounts.master}; сотрудников: {result.referenceCounts.staff}.</p><button className="btn btn-secondary" onClick={async () => {
        try {
          saveFile(await api('/searches/' + result.id + '/duplicates-xlsx', {}, 'POST', true), 'Дубликаты.xlsx');
        } catch (e) {
          setError(e.message);
        }
      }}>Экспорт дубликатов в Excel</button>{[['Внутри личного массива', result.internal.results], ['Мастер-массив', result.master.results]].map(([title, groups]) => <details key={title} open><summary>{title}: групп с совпадениями {groups.length}</summary>{groups.map(group => <div key={group.reference.id}><strong>{group.reference.internal_number} ({group.reference.year})</strong><ul>{(group.exportMatches || group.matches).map(match => <li key={match.id}>{match.internal_number} ({match.year}), совпавших локусов: {match.matchCount}</li>)}</ul></div>)}</details>)}<details open><summary>Контаминация сотрудников</summary>{result.staff.map(item => <div key={item.profileId}>{rows.find(row => row.id === item.profileId)?.objectNumber}: {item.matches.length ? item.matches.map(match => `${match.staffName || match.staffId || ''}${match.registrationNumber ? ' · № рег. ' + match.registrationNumber : ''}: ${match.finalScore ?? match.score ?? match.contaminationScore ?? ''}`).join('; ') : 'совпадений не найдено'}</div>)}</details></section>}
 {details && <div className="workspace-editor" role="dialog" aria-modal="true" aria-label="Генотип и источник объекта"><h2>{details.objectNumber || 'Объект'} — данные</h2><p>{details.sourceFilename || details.provenance?.sourceFilename || ''}</p><label>Аллели по локусам (JSON)<textarea className="form-input workspace-genotype-editor" readOnly={!canEdit} value={genotypeText} onChange={e => setGenotypeText(e.target.value)} /></label><p>Ручное подтверждение всех показанных аллелей сохраняет ваше решение и исходные значения в происхождении. Структурные ошибки файла остаются в диагностике.</p><button className="btn btn-primary" disabled={!canEdit} onClick={() => {
        try {
          const value = JSON.parse(genotypeText);
          if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
          change(details, 'strData', value);
          setDetails(null);
        } catch {
          setError('Введите корректный JSON-объект локусов.');
        }
      }}>Подтвердить ручное значение</button><button className="btn btn-secondary" onClick={() => setDetails(null)}>Закрыть</button></div>}
 </div>;
}
