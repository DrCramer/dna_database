import { canTransferStaffName, transferStaffName } from '../../../../src/utils/staffImportMapping';
import MasterApprovalDialog from './MasterApprovalDialog';
import WorkspaceStaffSettings from './WorkspaceStaffSettings';
import { staffSearchOptions } from '../../../../src/utils/staffSearchOptions';
import WorkspaceDuplicateResults, { WorkspaceStaffResults, storedComparisonColors } from './WorkspaceDuplicateResults';
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
  PUBLISHED: 'В мастер-массиве',
  PENDING_APPROVAL: 'На подтверждении',
  RETURNED: 'На доработке',
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
function savedStaffOptions() {
  try { return staffSearchOptions(JSON.parse(localStorage.getItem('genotypeAnalysisSettings') || '{}')); }
  catch { return staffSearchOptions(); }
}
function WorkspaceIcon({
  name
}) {
  const paths = {
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
    download: 'M12 3v13m-5-5 5 5 5-5M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
    file: 'M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8l-6-6Zm0 0v6h6M8 13h8m-8 4h5',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
    check: 'm5 12 4 4L19 6',
    close: 'm6 6 12 12M6 18 18 6',
    edit: 'm16 3 5 5-13 13H3v-5L16 3Zm-3 3 5 5',
    shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6',
    settings: 'M4 5h16M4 12h16M4 19h16M8 2v6m8 1v6m-7 1v6',
    chevron: 'm6 9 6 6 6-6',
    left: 'm15 5-7 7 7 7',
    right: 'm9 5 7 7-7 7',
    delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    open: 'M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6',
    alert: 'm12 3 10 18H2L12 3Zm0 5v6m0 3v1'
  };
  return <svg className="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.grid} /></svg>;
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
  const [approvalWindow, setApprovalWindow] = useState(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [exportingStaff, setExportingStaff] = useState(false);
  const [activeView, setActiveView] = useState('profiles');
  const resultViewButton = useRef(null);
  const showingResults = !isImport && !!result && activeView === 'results';
  useEffect(() => {
    if (result) resultViewButton.current?.focus({ preventScroll: true });
  }, [result?.id]);
  const [staffOptions, setStaffOptions] = useState(savedStaffOptions);
  const [staffSettingsOpen, setStaffSettingsOpen] = useState(false);
  const resultColors = useMemo(storedComparisonColors, [result?.id]);
  const [viewFilter, setViewFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [locusEdits, setLocusEdits] = useState({});
  const dragDepth = useRef(0),
    editorDialog = useRef(null),
    actionsMenu = useRef(null);
  useEffect(() => {
    if (!details || !editorDialog.current) return undefined;
    const dialog = editorDialog.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [details]);
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
  useEffect(() => {
    const close = event => {
      if (actionsMenu.current && (event.key === 'Escape' || event.type === 'mousedown' && !actionsMenu.current.contains(event.target))) actionsMenu.current.open = false;
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
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
    setStaffOptions(data.workspace.analysis_parameters?.staffOptions ? staffSearchOptions(data.workspace.analysis_parameters.staffOptions) : savedStaffOptions());
    setRows(data.profiles);
    initial.current = data.profiles;
    setSelected(old => new Set([...old].filter(id => data.profiles.some(p => p.id === id))));
  }
  useEffect(() => {
    let alive = true;
    setError('');
    setDetails(null);
    setViewFilter('all');
    setEditingId(null);
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
      const filtered = rows.filter(row => viewFilter === 'all' || viewFilter === 'selected' && (isImport ? row.included : selected.has(row.id)) || viewFilter === 'empty' && !Object.values(row.strData || {}).some(value => value.length) || viewFilter === 'issues' && ((row.sourceIssues || []).length || objectMetadataIssues(row).length || validation?.errors.some(item => item.draftRowId === row.draftRowId && item.issues.length)) || viewFilter === 'ready' && (row.searchState || row.state) === 'CHECKED' || viewFilter === 'stale' && ['STALE', 'NOT_CHECKED', 'INSUFFICIENT_DATA'].includes(row.state)).filter(row => `${row.objectNumber} ${row.year ?? ''} ${types[row.expertiseType] || ''} ${row.fullName || ''} ${row.comment || ''}`.toLowerCase().includes(query.toLowerCase()));
      const value = row => sort.field.startsWith('locus:') ? (row.strData[sort.field.slice(6)] || []).join(',') : row[sort.field] ?? '';
      return sort.field ? filtered.sort((a, b) => String(value(a)).localeCompare(String(value(b)), 'ru', {
        numeric: true,
        sensitivity: 'base'
      }) * sort.direction) : filtered;
    }, [rows, query, sort, viewFilter, selected, isImport, validation]);
  useEffect(() => {
    setPage(current => Math.min(current, Math.max(0, Math.ceil(visible.length / 50) - 1)));
  }, [visible.length]);
  const included = rows.filter(row => isImport ? row.included : selected.has(row.id)),
    countEmpty = rs => rs.filter(row => !Object.values(row.strData || {}).some(a => a.length)).length;
  const loci = useMemo(() => orderNormalizedLoci(getAnalysisLoci(rows)), [rows]);
  function sortHeader(field, label, className) {
    return <th className={className} aria-sort={sort.field === field ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button type="button" className="workspace-sort" onClick={() => {
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
      setNotice('');
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
  function moveStaffNames() {
    const candidates = affected.filter(canTransferStaffName);
    if (!candidates.length || !window.confirm(`Перенести ФИО из поля «Объект» у сотрудников: ${candidates.length}? Заполненные ФИО и регистрационные номера не заменяются. Если номера регистрации нет, поле «Объект» останется пустым — его нужно заполнить отдельно. Исходные значения сохранятся.`)) return;
    setUndo(rows);
    const ids = new Set(candidates.map(id));
    setRows(current => current.map(row => ids.has(id(row)) ? transferStaffName(row) : row));
    setValidation(null);
    setNotice(`ФИО перенесены: ${candidates.length}. Укажите год и регистрационные номера сотрудников.`);
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
          comparisonAlgorithm: next.algorithm ?? algorithm,
          staffOptions
        }
      }, 'PATCH');
    } catch (e) {
      setError(e.message);
    }
  }
  async function saveStaffSettings(options) {
    const next = staffSearchOptions(options);
    await api('/search-settings', { parameters: { staffOptions: next } }, 'PATCH');
    setStaffOptions(next);
    setResult(null);
    setRows(current => current.map(row => ({ ...row, searchState: row.searchState === 'CHECKED' ? 'STALE' : row.searchState, state: row.state === 'CHECKED' ? 'STALE' : row.state })));
    try {
      const saved = JSON.parse(localStorage.getItem('genotypeAnalysisSettings') || '{}');
      localStorage.setItem('genotypeAnalysisSettings', JSON.stringify({ ...saved, ...next }));
    } catch { /* Server settings are saved even if browser storage is unavailable. */ }
    setNotice('Настройки контаминации сохранены. Выполните поиск с новыми параметрами.');
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
    if (actionsMenu.current) actionsMenu.current.open = false;
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
        if (['search', 'publish', 'send', 'export'].includes(name)) await saveWorking();
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
              comparisonAlgorithm: algorithm,
              staffOptions
            }
          });
          setResult(found);
          setActiveView('results');
          await load();
          setNotice('Поиск завершён. Найденные совпадения показаны отдельно от состояния проверки.');
        }
        if (name === 'send') {
          if (included.some(row => row.expertiseType === 'staff')) throw Error('В выборе есть эталоны сотрудников. Для них предназначена отдельная административная команда «Публиковать эталоны сотрудников». Для заявки выберите только ЧС, УГ и ГР.');
          setApprovalWindow({mode:'submit', selectedRows:included});
        }
        if (name === 'publish') {
          if (included.some(row => row.expertiseType !== 'staff')) throw Error('Для ЧС, УГ и ГР используйте «Отправить на подтверждение».');
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
    setEditorError('');
    setLocusEdits({});
    setGenotypeText(JSON.stringify(row.strData, null, 2));
  }
  const showStaff = rows.some(row => row.expertiseType === 'staff' || row.fullName);
  const staffNameCandidates = isImport ? affected.filter(canTransferStaffName) : [];
  const readyCount = rows.filter(row => (row.searchState || row.state) === 'CHECKED' && row.approvalState !== 'pending').length;
  const originals = new Map((initial.current || []).map(row => [row.id, row]));
  const dirtyCount = !isImport && initial.current ? rows.filter(row => {
    const original = originals.get(row.id);
    return fields.some(field => JSON.stringify(row[field]) !== JSON.stringify(original?.[field]));
  }).length : 0;
  const issuesFor = row => [...(row.sourceIssues || []), ...objectMetadataIssues(row), ...(validation?.errors.find(item => item.draftRowId === row.draftRowId)?.issues || [])].filter((issue, index, list) => list.findIndex(item => item.message === issue.message) === index);
  const errorCount = isImport ? included.filter(row => issuesFor(row).length).length : 0;
  const draftPending = isImport && initial.current && rows !== initial.current && JSON.stringify(rows) !== JSON.stringify(initial.current);
  const sourceFiles = [...new Set(rows.map(row => row.sourceFilename).filter(Boolean))];
  const selectable = visible.filter(row => !isImport || !row.provenance?.classification || row.provenance.classification.included);
  const isSelected = row => isImport ? row.included : selected.has(row.id);
  const allSelected = !!selectable.length && selectable.every(isSelected);
  const pageRows = visible.slice(page * 50, (page + 1) * 50);
  const totalPages = Math.max(1, Math.ceil(visible.length / 50));
  let genotypePreview;
  try {
    genotypePreview = JSON.parse(genotypeText);
  } catch {
    genotypePreview = null;
  }
  const previewLoci = genotypePreview && !Array.isArray(genotypePreview) && typeof genotypePreview === 'object' ? orderNormalizedLoci(getAnalysisLoci([{
    strData: genotypePreview
  }])) : [];
  const stateBadge = row => <div><span className="workspace-badge" data-state={row.state || 'NOT_CHECKED'}>{row.expertiseType === 'staff' && row.state === 'PUBLISHED' ? 'В эталонах сотрудников' : states[row.state] || 'Не проверен'}</span>{row.approvalId && <button className="workspace-object-link master-approval-history-link" onClick={() => setApprovalWindow({mode:'history',requestId:row.approvalId})}>Решение и история</button>}{row.decisionComment && <small className="master-approval-decision-note">{row.decisionComment}</small>}</div>;
  const objectNumber = row => row.expertiseType === 'staff' ? 'Регистрационный номер' : `№ экспертизы ${row.objectNumber.split('-')[0] || '—'}`;
  return <div className={`workspace-page ${isImport ? 'workspace-import-page' : 'workspace-profiles-page'}`} aria-label={isImport ? undefined : 'Мои генотипы'} aria-busy={busy}>
    {isImport ? <header className="workspace-heading">
      <div><span className="workspace-eyebrow">Личная рабочая область</span><h1>Загрузка в личный массив</h1>{!rows.length && <p>Добавьте файлы, выберите объекты и подтвердите загрузку.</p>}</div>
      <a className="btn btn-secondary" href="/analysis"><WorkspaceIcon name="grid" />Мои генотипы</a>
    </header> : <div className="workspace-compact-toolbar">
      <div className="workspace-view-switch" role="group" aria-label="Представление личного массива">
        <button className="btn btn-secondary" aria-pressed={!showingResults} onClick={() => setActiveView('profiles')}><WorkspaceIcon name="grid" />Профили<span className="workspace-count-pill">{rows.length}</span></button>
        <button className="btn btn-secondary" ref={resultViewButton} disabled={!result} aria-pressed={showingResults} onClick={() => setActiveView('results')}><WorkspaceIcon name="search" />Результаты поиска</button>
        <span className="workspace-ready-count">Готовы к публикации: {readyCount}</span>
      </div>
      <div className="master-approval-header-actions"><button className="btn btn-secondary" onClick={() => setApprovalWindow({mode:'own-history'})}>Мои заявки</button>{workspace?.canApproveMaster && <button className="btn btn-secondary" onClick={() => setApprovalWindow({mode:'queue'})}>На подтверждении</button>}<a className="btn btn-primary" href="/upload"><WorkspaceIcon name="upload" />Загрузить файлы</a></div>
    </div>}

    {isImport && !rows.length && <ol className="workspace-steps" aria-label="Этапы загрузки">{['Выбор файлов', 'Подготовка объектов', 'Загрузка в массив'].map((label, index) => <li key={label} aria-current={(rows.length ? index === 1 : index === 0) ? 'step' : undefined} data-complete={!!rows.length && index === 0}><span>{rows.length && index === 0 ? <WorkspaceIcon name="check" /> : index + 1}</span>{label}</li>)}</ol>}
    {error && <div className="workspace-message workspace-message-error" role="alert"><WorkspaceIcon name="alert" /><div>{error}</div>{!!retryFiles.current.length && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => upload(retryFiles.current)}>Повторить загрузку</button>}</div>}
    {notice && <div className="workspace-message workspace-message-success" role="status"><WorkspaceIcon name="check" /><span>{notice}</span>{isImport && !rows.length && <a href="/analysis">Открыть личный массив →</a>}</div>}

    {isImport && <section className={`workspace-drop ${rows.length ? 'workspace-drop-compact' : ''} ${dragging ? 'is-dragging' : ''}`} aria-label="Загрузка файлов" onDragEnter={e => {
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    }} onDragOver={e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }} onDragLeave={e => {
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }} onDrop={e => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!busy && canUpload) upload(Array.from(e.dataTransfer.files));
    }}>
      <input ref={input} type="file" multiple accept=".xlsx,.xls,.txt" hidden onChange={e => {
        upload(Array.from(e.target.files));
        e.target.value = '';
      }} />
      <span className="workspace-drop-icon"><WorkspaceIcon name={rows.length ? 'file' : 'upload'} /></span>
      <div className="workspace-drop-copy"><h2>{rows.length ? `Файлов в черновике: ${sourceFiles.length || 1}` : 'Перетащите файлы сюда'}</h2><p>{rows.length ? sourceFiles.join(' · ') : 'Excel, GeneMapper TXT и NGS ASTR+ · до 100 файлов'}</p>{!rows.length && <span className="workspace-drop-hint">Или выберите их на компьютере. Задача и отделение не нужны.</span>}</div>
      <div className="workspace-drop-actions"><button className="btn btn-primary" disabled={busy || !canUpload} onClick={() => input.current.click()}>{busy ? 'Обработка файлов…' : rows.length ? 'Заменить файлы' : 'Выбрать файлы'}</button><a href="/excel-converter">Открыть конвертер <span aria-hidden="true">↗</span></a></div>
    </section>}

    <div className="workspace-profile-panel" hidden={showingResults}>
    {!!rows.length && <>
      {isImport && <div className="workspace-draft-status"><span><strong>{rows.length.toLocaleString('ru-RU')}</strong> объектов из файлов{errorCount > 0 && <span className="workspace-draft-warning"> · требуют внимания: {errorCount}</span>}</span><span><span className={`workspace-save-dot ${autoSaving || draftPending ? 'is-saving' : ''}`} /><span role="status">{autoSaving ? 'Сохраняем правки…' : draftPending ? 'Правки ожидают сохранения' : 'Черновик сохранён'}</span><small>· 24 часа</small></span></div>}

      <section className="workspace-data-card">
        <div className="workspace-profile-controls">
        <div className="workspace-data-heading"><div><h2>{isImport ? 'Объекты из файлов' : 'Рабочие профили'}</h2>{isImport && <p>Укажите год и тип. ФИО заполняется только для сотрудников.</p>}</div>{!isImport && !!dirtyCount && <span className="workspace-badge" data-state="STALE">Есть изменения: {dirtyCount}</span>}</div>
        <div className="workspace-filter-bar">
          <label className="workspace-search"><WorkspaceIcon name="search" /><input className="form-input" aria-label="Поиск объектов" value={query} onChange={e => {
              setQuery(e.target.value);
              setPage(0);
            }} placeholder="Найти по номеру, году или комментарию" />{query && <button className="workspace-icon-button" aria-label="Очистить поиск" onClick={() => {
              setQuery('');
              setPage(0);
            }}><WorkspaceIcon name="close" /></button>}</label>
          <select className="form-select workspace-filter" aria-label="Показать объекты" value={viewFilter} onChange={e => {
            setViewFilter(e.target.value);
            setPage(0);
          }}><option value="all">Все объекты</option><option value="selected">Только выбранные</option><option value="empty">Без генотипа</option>{isImport ? <option value="issues">Требуют внимания</option> : <><option value="ready">Готовы к публикации</option><option value="stale">Нужен повторный поиск</option></>}</select>
          <span className="workspace-filter-count">Найдено: {visible.length.toLocaleString('ru-RU')}</span>
          <button className="btn btn-ghost btn-sm" disabled={busy || !canEdit} onClick={() => chooseAll(true)}>Выбрать весь текущий фильтр</button>
          {!!included.length && <button className="btn btn-ghost btn-sm" disabled={busy || !canEdit} onClick={() => chooseAll(false)}>Снять выбор в фильтре</button>}
        </div>
        <div className="workspace-tools-row"><details className="workspace-bulk" open={isImport ? true : undefined}><summary><WorkspaceIcon name="edit" /><span>Год и тип для нескольких объектов</span><WorkspaceIcon name="chevron" /></summary>
          <section className="workspace-toolbar" aria-label="Массовое заполнение"><label>Применить к<select className="form-select" value={bulkScope} disabled={busy || !canEdit} onChange={e => setBulkScope(e.target.value)}><option value="selected">Выбранным объектам</option><option value="all">Всем объектам</option><option value="empty">Незаполненным полям</option></select></label><div className="workspace-bulk-field"><label>Год<input className="form-input" type="number" min="1900" max="2100" placeholder="2026" value={year} disabled={busy || !canEdit} onChange={e => setYear(e.target.value)} /></label><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => bulk('year', year === '' ? '' : Number(year))}>Применить год</button></div><div className="workspace-bulk-field"><label>Тип<select className="form-select" value={type} disabled={busy || !canEdit} onChange={e => setType(e.target.value)}>{Object.entries(types).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => bulk('expertiseType', type)}>Применить тип</button></div><span className="workspace-bulk-count">Объектов: {affected.length}</span>{undo && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
                setRows(undo);
                setUndo(null);
                setValidation(null);
              }}>Отменить массовую правку</button>}</section>
        {staffNameCandidates.length > 0 && <div className="workspace-staff-mapping"><WorkspaceIcon name="edit" /><div><strong>ФИО записаны в поле «Объект»</strong><p>Можно перенести имена сотрудников в нужную колонку. Регистрационные номера заполняются отдельно.</p></div><button className="btn btn-secondary btn-sm" disabled={busy || !canEdit} onClick={moveStaffNames}>Перенести ФИО ({staffNameCandidates.length})</button></div>}
        </details>
        {!isImport && <details className="workspace-search-settings"><summary><WorkspaceIcon name="settings" />Настройки поиска<WorkspaceIcon name="chevron" /></summary><div><label>Минимум локусов<input className="form-input" type="number" min="1" max="500" disabled={busy || !canEdit} value={minMatches} onChange={e => {
                  setMinMatches(e.target.value);
                  if (Number(e.target.value) >= 1 && Number(e.target.value) <= 500) updateSearchSettings({
                    minMatches: e.target.value
                  });
                }} /></label><label>Алгоритм<select className="form-select" aria-label="Алгоритм сравнения" disabled={busy || !canEdit} value={algorithm} onChange={e => {
                  setAlgorithm(e.target.value);
                  updateSearchSettings({
                    algorithm: e.target.value
                  });
                }}><option value="standard">Стандартный</option><option value="duplicate_v5">Дубликаты v5</option><option value="contamination">Контаминация</option></select></label><button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => setStaffSettingsOpen(true)}>Контаминация сотрудников: настройки</button><p>Сотрудники: {staffOptions.useV5Algorithm ? 'v5.0' : staffOptions.useV4Algorithm ? 'v4.0' : 'v1.5'} · порог {staffOptions.threshold}. Изменение параметров требует нового полного поиска.</p></div></details>}</div>

        </div>
        <div className="workspace-table-scroll" tabIndex="0" role="region" aria-label="Таблица объектов">
          <table className={`workspace-table ${isImport ? 'workspace-import-table' : ''}`}><thead><tr><th className="workspace-check-column"><input type="checkbox" aria-label="Выбрать все строки текущего фильтра" checked={allSelected} ref={el => {
                    if (el) el.indeterminate = !allSelected && selectable.some(isSelected);
                  }} disabled={busy || !selectable.length} onChange={e => chooseAll(e.target.checked)} /></th>{sortHeader('objectNumber', 'Объект', 'workspace-object-column')}{sortHeader('year', 'Год', 'workspace-year-column')}{sortHeader('expertiseType', 'Тип', 'workspace-type-column')}{showStaff && sortHeader('fullName', 'ФИО сотрудника', 'workspace-name-column')}{sortHeader('comment', 'Комментарий', 'workspace-comment-column')}<th className="workspace-state-column">{isImport ? 'Данные и проверка' : 'Состояние'}</th>{!isImport && loci.map(locus => <React.Fragment key={locus}>{sortHeader('locus:' + locus, locus, 'workspace-locus-column')}</React.Fragment>)}<th className="workspace-row-actions">Действия</th></tr></thead>
            <tbody>{pageRows.map(row => {
                const editable = isImport || editingId === row.id;
                const issues = isImport ? issuesFor(row) : [];
                const checked = isSelected(row);
                return <tr key={id(row)} data-object-number={row.objectNumber} data-selected={!!checked} data-excluded={isImport && !row.included}>
                <td className="workspace-check-column"><input type="checkbox" aria-label={`Выбрать ${row.objectNumber}`} checked={!!checked} disabled={busy || !!(isImport && row.provenance?.classification && !row.provenance.classification.included)} onChange={e => isImport ? change(row, 'included', e.target.checked) : setSelected(old => {
                      const next = new Set(old);
                      e.target.checked ? next.add(row.id) : next.delete(row.id);
                      return next;
                    })} /></td>
                <td className="workspace-object-column">{editable ? <input aria-label="Номер объекта" aria-invalid={issues.some(issue => ['OBJECT_NUMBER', 'REGISTRATION', 'REGISTRATION_CONFLICT'].includes(issue.code))} className="form-input" value={row.objectNumber} placeholder={row.expertiseType === 'staff' ? 'Например, 870-G' : ''} disabled={busy || !canEdit} onChange={e => change(row, 'objectNumber', e.target.value)} /> : <button className="workspace-object-link" title={row.objectNumber} onClick={() => editGenotype(row)}>{row.objectNumber}</button>}<small title={objectNumber(row)}>{objectNumber(row)}</small></td>
                <td className="workspace-year-column">{editable ? <input aria-label="Год объекта" aria-invalid={issues.some(issue => issue.code === 'YEAR')} className="form-input" type="number" min="1900" max="2100" value={row.year ?? ''} disabled={busy || !canEdit} onChange={e => change(row, 'year', e.target.value === '' ? null : Number(e.target.value))} /> : row.year || '—'}</td>
                <td className="workspace-type-column">{editable ? <select aria-label="Тип объекта" aria-invalid={issues.some(issue => issue.code === 'TYPE')} className="form-select" value={row.expertiseType || ''} disabled={busy || !canEdit} onChange={e => change(row, 'expertiseType', e.target.value || null)}><option value="">Выберите тип</option>{Object.entries(types).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select> : <span className="workspace-type" data-type={row.expertiseType}>{types[row.expertiseType] || 'Не указан'}</span>}</td>
                {showStaff && <td className="workspace-name-column">{editable && row.expertiseType === 'staff' ? <input aria-label="ФИО сотрудника" aria-invalid={issues.some(issue => issue.code === 'FULL_NAME')} className="form-input" value={row.fullName || ''} disabled={busy || !canEdit} onChange={e => change(row, 'fullName', e.target.value)} placeholder="Фамилия Имя Отчество" /> : <span className={row.fullName ? '' : 'workspace-muted'} title={row.fullName || ''}>{row.fullName || '—'}</span>}</td>}
                <td className="workspace-comment-column">{editable ? <textarea aria-label="Комментарий объекта" className="form-input workspace-comment" rows="1" value={row.comment || ''} disabled={busy || !canEdit} onChange={e => change(row, 'comment', e.target.value)} placeholder="Необязательно" /> : <span className={`workspace-comment-preview ${row.comment ? '' : 'workspace-muted'}`} title={row.comment || ''}>{row.comment || '—'}</span>}</td>
                <td className="workspace-state-column">{isImport ? <><span className="workspace-badge" data-state={issues.length ? 'STALE' : countEmpty([row]) ? 'NO_GENOTYPE' : 'CHECKED'}>{issues.length ? `Замечаний: ${issues.length}` : countEmpty([row]) ? 'Нет генотипа' : 'Готов к загрузке'}</span>{issues.length > 0 && <details className="workspace-issues"><summary>Что исправить</summary>{issues.map((issue, index) => <div className="workspace-row-error" key={index}>{issue.message}</div>)}</details>}</> : stateBadge(row)}</td>
                {!isImport && loci.map(locus => <td className="workspace-alleles" key={locus}>{(row.strData[locus] || []).join(',') || <span className="workspace-muted">—</span>}</td>)}
                <td className="workspace-row-actions"><div>{!isImport && canEdit && <button className="workspace-icon-button" aria-label={`Редактировать ${row.objectNumber}`} title="Редактировать метаданные" disabled={busy} onClick={() => setEditingId(editingId === row.id ? null : row.id)}><WorkspaceIcon name={editingId === row.id ? 'check' : 'edit'} /></button>}<button className="workspace-icon-button" aria-label={`Открыть генотип ${row.objectNumber}`} title="Генотип и источник" onClick={() => editGenotype(row)}><WorkspaceIcon name="open" /></button></div></td>
              </tr>;
              })}</tbody>
          </table>
          {!pageRows.length && <div className="workspace-filter-empty"><WorkspaceIcon name="search" /><strong>Объекты не найдены</strong><span>Измените запрос или выбранный фильтр.</span><button className="btn btn-secondary btn-sm" onClick={() => {
              setQuery('');
              setViewFilter('all');
              setPage(0);
            }}>Сбросить фильтры</button></div>}
        </div>
        <div className="workspace-pagination"><span>{visible.length ? `${page * 50 + 1}–${Math.min((page + 1) * 50, visible.length)} из ${visible.length.toLocaleString('ru-RU')}` : '0 объектов'}</span><div><button className="workspace-icon-button" aria-label="Предыдущая страница" disabled={page === 0} onClick={() => setPage(value => value - 1)}><WorkspaceIcon name="left" /></button><span>Страница {page + 1} из {totalPages}</span><button className="workspace-icon-button" aria-label="Следующая страница" disabled={page + 1 >= totalPages} onClick={() => setPage(value => value + 1)}><WorkspaceIcon name="right" /></button></div><small>По 50 объектов на странице</small></div>
      </section>

      <div className="workspace-command-bar">
        <div className="workspace-selection"><span className="workspace-selection-number">{included.length}</span><div><strong>объектов выбрано</strong><small>{isImport ? `Пустых: ${countEmpty(included)} · требуют внимания: ${errorCount}` : dirtyCount ? `Несохранённых изменений: ${dirtyCount}` : 'Действия применяются к выбору'}</small></div></div>
        <div className="workspace-command-actions">{isImport ? <><button className="btn btn-secondary" disabled={busy || !canEdit || !included.length} onClick={() => action('validate')}><WorkspaceIcon name="download" />Подготовить XLSX</button><button className="btn btn-primary" disabled={busy || !canEdit || !included.length} onClick={() => action('commit')}><WorkspaceIcon name="upload" />{busy ? 'Подождите…' : 'Загрузить выбранные'}</button></> : <>
          {!!dirtyCount && <button className="btn btn-secondary" disabled={busy || !canEdit} onClick={() => action('save')}><WorkspaceIcon name="check" />Сохранить изменения</button>}
          <details className="workspace-more-actions" ref={actionsMenu}><summary className="btn btn-secondary">Действия<WorkspaceIcon name="chevron" /></summary><div role="group" aria-label="Действия с выбранными профилями"><button disabled={busy || !canEdit || !included.length} onClick={() => action('export')}><WorkspaceIcon name="download" />Экспортировать выбранные</button>{workspace?.canSubmitMaster && <button disabled={busy || !included.length} onClick={() => action('send')}><WorkspaceIcon name="shield" />Отправить на подтверждение</button>}{workspace?.canManageStaff && <button disabled={busy || !included.length} onClick={() => action('publish')}><WorkspaceIcon name="shield" />Публиковать эталоны сотрудников</button>}<button disabled={busy || !readyCount} onClick={() => setSelected(new Set(rows.filter(row => (row.searchState || row.state) === 'CHECKED' && row.approvalState !== 'pending').map(row => row.id)))}><WorkspaceIcon name="check" />Выбрать только готовые</button><button className="workspace-delete-action" disabled={busy || !canEdit || !included.length} onClick={() => action('delete')}><WorkspaceIcon name="delete" />Удалить выбранные</button></div></details>
          <button className="btn btn-primary" disabled={busy || !canEdit || !included.length} onClick={() => action('search')}><WorkspaceIcon name="search" />{busy ? 'Выполняется операция…' : 'Полный поиск выбранных'}</button>
        </>}</div>
      </div>
    </>}

    {!isImport && !rows.length && <section className="workspace-empty"><span className="workspace-empty-icon"><WorkspaceIcon name="grid" /></span><h2>Здесь будут ваши генотипы</h2><p>Загрузите файлы, выберите нужные объекты и начните работу с личным массивом.</p><a className="btn btn-primary" href="/upload"><WorkspaceIcon name="upload" />Загрузить первые файлы</a><div><span><WorkspaceIcon name="check" />Без назначения задачи</span><span><WorkspaceIcon name="shield" />С доступом только для вас</span></div></section>}
    </div>

    {result && <section className="workspace-search-results" hidden={!showingResults} tabIndex="0" aria-label="Результаты поиска"><div className="workspace-data-heading"><div><span className="workspace-eyebrow">Поиск завершён</span><h2>Результаты полного поиска</h2><p>Проверено: {result.profiles.filter(profile => profile.state === 'CHECKED').length}; без генотипа: {result.profiles.filter(profile => profile.state === 'NO_GENOTYPE').length}; недостаточно локусов: {result.profiles.filter(profile => profile.state === 'INSUFFICIENT_DATA').length}.</p></div><button className="btn btn-secondary" onClick={async () => {
          try {
            saveFile(await api('/searches/' + result.id + '/duplicates-xlsx', {}, 'POST', true), 'Дубликаты.xlsx');
          } catch (e) {
            setError(e.message);
          }
        }}><WorkspaceIcon name="download" />Экспорт дубликатов в Excel</button></div>
      <div className="workspace-result-overview"><div><WorkspaceIcon name="grid" /><span>Внутри личного массива<strong>{result.internal.results.length} групп с совпадениями</strong></span></div><div><WorkspaceIcon name="search" /><span>Мастер-массив<strong>{result.master.results.length} групп · {result.referenceCounts.master} эталонов</strong></span></div><div><WorkspaceIcon name="shield" /><span>Контаминация сотрудников<strong>{result.staff.filter(item => item.matches.length).length} объектов · {result.referenceCounts.staff} эталонов</strong></span></div></div>
      {[['Внутри личного массива', result.internal.results], ['Мастер-массив', result.master.results]].map(([title, groups]) => <details className="workspace-result-group" key={title} open={groups.length > 0}><summary>{title}<span className="workspace-count-pill">{groups.length}</span><WorkspaceIcon name="chevron" /></summary><WorkspaceDuplicateResults key={result.id + title} groups={groups} ignoredLoci={result.parameters?.ignoredLoci || []} /></details>)}
      <details className="workspace-result-group"><summary>Контаминация сотрудников<span className="workspace-count-pill">{result.staff.filter(item => item.matches.length).length}</span><WorkspaceIcon name="chevron" /></summary>
        {result.staff.some(item => item.matches.length) && <div className="workspace-result-actions"><button className="btn btn-secondary" disabled={exportingStaff} onClick={async () => {
          setExportingStaff(true);
          try {
            saveFile(await api('/searches/' + result.id + '/staff-contaminations-xlsx', { colors: resultColors }, 'POST', true), 'Контаминации_сотрудников.xlsx');
          } catch (e) { setError(e.message); }
          finally { setExportingStaff(false); }
        }}><WorkspaceIcon name="download" />{exportingStaff ? 'Подготовка Excel…' : 'Экспорт контаминаций сотрудников в Excel'}</button></div>}
        <WorkspaceStaffResults key={result.id + ':staff'} groups={result.staff} staffProfiles={result.staffProfiles} ignoredLoci={result.parameters?.staffOptions?.ignoredLoci ?? result.parameters?.ignoredLoci ?? []} colors={resultColors} />
      </details>
    </section>}

    {staffSettingsOpen && <WorkspaceStaffSettings options={staffOptions} onClose={() => setStaffSettingsOpen(false)} onSave={saveStaffSettings} />}
    {approvalWindow && <MasterApprovalDialog {...approvalWindow} api={api} userId={user.id} onClose={() => setApprovalWindow(null)} onChanged={load} />}
    {details && <dialog className="workspace-editor-dialog" ref={editorDialog} aria-label="Генотип и источник объекта" onCancel={() => setDetails(null)} onClick={e => {
      if (e.target === e.currentTarget) setDetails(null);
    }}>
      <div className="workspace-editor-header"><div><span className="workspace-eyebrow">Генотип объекта</span><h2>{details.objectNumber || 'Без номера'}<span className="workspace-type" data-type={details.expertiseType}>{types[details.expertiseType] || 'Тип не задан'}</span></h2></div><button className="workspace-icon-button" aria-label="Закрыть окно" onClick={() => setDetails(null)}><WorkspaceIcon name="close" /></button></div>
      <div className="workspace-editor-body"><div className="workspace-editor-summary"><span><strong>{details.year || '—'}</strong>Год</span><span><strong>{previewLoci.filter(locus => genotypePreview[locus]?.length).length}</strong>Локусов с данными</span><span className="workspace-editor-source" title={details.sourceFilename || details.provenance?.sourceFilename || ''}><WorkspaceIcon name="file" />{details.sourceFilename || details.provenance?.sourceFilename || 'Профиль из личного массива'}</span></div>
        <div className="workspace-genotype-grid">{previewLoci.map(locus => <label key={locus}>{locus}<input className="form-input" aria-label={`Аллели ${locus}`} readOnly={!canEdit} value={Object.hasOwn(locusEdits, locus) ? locusEdits[locus] : Array.isArray(genotypePreview[locus]) ? genotypePreview[locus].join(',') : String(genotypePreview[locus] ?? '')} onChange={e => {
              setLocusEdits(current => ({
                ...current,
                [locus]: e.target.value
              }));
              setGenotypeText(JSON.stringify({
                ...genotypePreview,
                [locus]: e.target.value.split(',').map(value => value.trim()).filter(Boolean)
              }, null, 2));
              setEditorError('');
            }} placeholder="Нет данных" /></label>)}</div>
        {!previewLoci.length && <p className="workspace-no-matches">Локусы не заполнены. Добавьте данные в ручном редакторе.</p>}
        <details className="workspace-editor-advanced"><summary>Ручной редактор JSON<WorkspaceIcon name="chevron" /></summary><label>Аллели по локусам (JSON)<textarea className="form-input workspace-genotype-editor" readOnly={!canEdit} value={genotypeText} onChange={e => {
              setGenotypeText(e.target.value);
              setLocusEdits({});
              setEditorError('');
            }} /></label></details>
        {!!details.sourceIssues?.length && <div className="workspace-editor-issues"><strong>Замечания к исходным данным</strong>{details.sourceIssues.map((issue, index) => <p key={index}>{issue.message}</p>)}</div>}
        {editorError && <p className="workspace-row-error" role="alert">{editorError}</p>}
      </div>
      <div className="workspace-editor-footer"><span>Изменения применятся после подтверждения.</span><button className="btn btn-secondary" onClick={() => setDetails(null)}>Закрыть</button><button className="btn btn-primary" disabled={!canEdit} onClick={() => {
          try {
            const value = JSON.parse(genotypeText);
            if (!value || Array.isArray(value) || typeof value !== 'object' || Object.entries(value).some(([locus, alleles]) => !locus.trim() || !Array.isArray(alleles) || alleles.some(allele => typeof allele !== 'string'))) throw Error();
            change(details, 'strData', value);
            setDetails(null);
          } catch {
            setEditorError('Для каждого локуса нужен массив строк, например: "TH01": ["7", "9.3"].');
          }
        }}>Применить генотип</button></div>
    </dialog>}
  </div>;
}
