import React, { useEffect, useRef, useState } from 'react';
import WorkspaceStaffSettings from '../Workspace/WorkspaceStaffSettings';
import { getUserDisplayName } from '../../../../src/utils/userDisplayName';

export default function UserSearchSettingsDialog({ user, onClose, onSaved }) {
  const dialog = useRef(null);
  const [parameters, setParameters] = useState(null);
  const [base, setBase] = useState(null);
  const [showStaff, setShowStaff] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const endpoint = '/api/workspace/users/' + user.id + '/search-settings';

  async function request(changes, signal) {
    const response = await fetch(endpoint, {
      method: changes ? 'PATCH' : 'GET',
      signal,
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token'), 'Content-Type': 'application/json' },
      body: changes ? JSON.stringify({ parameters: changes }) : undefined
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.message || 'Не удалось получить настройки поиска.');
    return data.parameters;
  }

  useEffect(() => {
    const element = dialog.current;
    const controller = new AbortController();
    element.showModal();
    request(undefined, controller.signal).then(data => {
      const values = {
        ...data,
        duplicateSettings: { minLoci: 15, minScore: 15, minPercentage: 80, ...data.duplicateSettings }
      };
      setParameters(values);
      setBase(values);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); element.close(); };
  }, [endpoint]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const changes = {};
      for (const key of ['comparisonAlgorithm', 'minMatches']) {
        if (parameters[key] !== base[key]) changes[key] = parameters[key];
      }
      if (parameters.comparisonAlgorithm === 'duplicate_v5') {
        const thresholds = Object.fromEntries(['minLoci', 'minScore', 'minPercentage']
          .filter(key => parameters.duplicateSettings[key] !== base.duplicateSettings[key])
          .map(key => [key, parameters.duplicateSettings[key]]));
        if (Object.keys(thresholds).length) changes.duplicateSettings = thresholds;
      }
      if (Object.keys(changes).length) {
        await request(changes);
        onSaved();
      }
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveStaff(staffOptions) {
    const saved = await request({ staffOptions });
    setParameters(current => ({ ...current, staffOptions: saved.staffOptions }));
    onSaved();
  }

  function updateThreshold(event, key, duplicate = false) {
    const value = event.target.value === '' ? '' : Number(event.target.value);
    setParameters(current => duplicate
      ? { ...current, duplicateSettings: { ...current.duplicateSettings, [key]: value } }
      : { ...current, [key]: value });
  }

  return <>
    <dialog ref={dialog} className="workspace-editor-dialog workspace-staff-settings-dialog" aria-label="Настройки поиска пользователя" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
      <form onSubmit={save}>
        <div className="workspace-editor-header">
          <div><h2>Настройки поиска</h2><div>{getUserDisplayName(user)}</div></div>
          <button type="button" className="btn btn-ghost" aria-label="Закрыть" disabled={saving} onClick={onClose}>×</button>
        </div>
        <fieldset className="workspace-editor-body workspace-staff-settings-fields" disabled={saving || !parameters}>
          {!parameters && !error && <p role="status">Загрузка настроек…</p>}
          {parameters && <>
            <label>Алгоритм сравнения
              <select className="form-select" value={parameters.comparisonAlgorithm}
                onChange={event => setParameters(current => ({ ...current, comparisonAlgorithm: event.target.value }))}>
                <option value="standard">Стандартный</option>
                <option value="duplicate_v5">Дубликаты v5</option>
                <option value="contamination">Контаминация</option>
              </select>
            </label>
            <div className="workspace-staff-settings-grid">
              {parameters.comparisonAlgorithm === 'duplicate_v5'
                ? <>
                  <label>Минимум локусов<input className="form-input" type="number" min="1" max="500" required
                    value={parameters.duplicateSettings.minLoci} onChange={event => updateThreshold(event, 'minLoci', true)} /></label>
                  <label>Минимальная оценка<input className="form-input" type="number" min="0" step="any" required
                    value={parameters.duplicateSettings.minScore} onChange={event => updateThreshold(event, 'minScore', true)} /></label>
                  <label>Минимальный процент<input className="form-input" type="number" min="0" max="100" step="any" required
                    value={parameters.duplicateSettings.minPercentage} onChange={event => updateThreshold(event, 'minPercentage', true)} /></label>
                </>
                : <label>Минимум локусов<input className="form-input" type="number" min="1" max="500" required
                  value={parameters.minMatches} onChange={event => updateThreshold(event, 'minMatches')} /></label>}
            </div>
            <button className="btn btn-secondary" type="button" onClick={() => setShowStaff(true)}>Настроить контаминацию сотрудников</button>
          </>}
          {error && <p className="workspace-row-error" role="alert">{error}</p>}
        </fieldset>
        <div className="workspace-editor-footer">
          <span>Для ручной и ночной сверки этого пользователя. После изменений выполните новый поиск.</span>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !parameters}>{saving ? 'Сохраняем…' : 'Сохранить настройки'}</button>
        </div>
      </form>
    </dialog>
    {showStaff && <WorkspaceStaffSettings options={parameters.staffOptions} onSave={saveStaff} onClose={() => setShowStaff(false)} />}
  </>;
}
