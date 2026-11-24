import React, { useEffect, useRef, useState } from 'react';
import catalog from '../../../../src/data/objectExportPanels.json';

const panelNames = [catalog.allLociPanel, ...Object.keys(catalog.panels)];

export default function MasterObjectPanelExport({ objectId, includeStaff }) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  const visible = panelNames.filter(name => name.toLowerCase().includes(filter.trim().toLowerCase()));

  function togglePanel(name, checked) {
    setSelected(current => checked ? [...current, name] : current.filter(panel => panel !== name));
    setError('');
  }

  async function download(event) {
    event.preventDefault();
    if (busy || !selected.length) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (includeStaff) params.set('includeStaff', 'true');
      panelNames.filter(name => selected.includes(name)).forEach(name => params.append('panel', name));
      const response = await fetch(`/api/profiles/master-objects/${encodeURIComponent(objectId)}/export.xlsx?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        signal: controller.signal
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.message || 'Не удалось скачать Excel.');
      }
      const disposition = response.headers.get('Content-Disposition') || '';
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const filename = encoded ? decodeURIComponent(encoded) : /filename="([^"]+)"/i.exec(disposition)?.[1] || 'Объект.xlsx';
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || 'Не удалось скачать Excel.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <details className="master-object-panel-export">
    <summary className="btn btn-secondary">Выгрузить Excel</summary>
    <form onSubmit={download}>
      <label className="master-object-panel-filter">
        <span>Панели для экспорта</span>
        <input type="search" className="form-input" placeholder="Найти панель" aria-label="Найти панель"
          value={filter} onChange={event => setFilter(event.target.value)} />
      </label>
      {visible.length ? <div className="master-object-panel-list" role="group" aria-label="Панели для экспорта">
        {visible.map(name => <label key={name}>
          <input type="checkbox" checked={selected.includes(name)} disabled={busy}
            onChange={event => togglePanel(name, event.target.checked)} />
          <span>{name}</span>
        </label>)}
      </div> : <p>Панели не найдены.</p>}
      {error && <div className="master-object-search-alert" role="alert">{error}</div>}
      <div className="master-object-panel-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !selected.length}>
          {busy ? 'Готовим Excel…' : 'Скачать XLSX'}
        </button>
        {selected.length > 0 && <span>Выбрано панелей: {selected.length}</span>}
      </div>
    </form>
  </details>;
}
