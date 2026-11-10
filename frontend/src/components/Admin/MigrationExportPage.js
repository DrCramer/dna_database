import React, { useEffect, useState } from 'react';
import { OBJECT_TYPES } from '../../../../src/utils/objectTypes';
import { useAuth } from '../../contexts/AuthContext';
const labels = {
  master: 'Старые мастер-массивы',
  user: 'Пользовательские профили',
  staff: 'Профили сотрудников',
  chs: 'ЧС',
  ug: 'УГ',
  gr: 'ГР',
  null: 'Не классифицировано'
};
export default function MigrationExportPage() {
  const {
    user
  } = useAuth();
  const [options, setOptions] = useState(null),
    [filters, setFilters] = useState(null),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const headers = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/migration-export/options', {
      headers: headers(),
      signal: controller.signal
    }).then(async r => {
      const b = await r.json();
      if (!r.ok) throw Error(b.message);
      return b;
    }).then(b => {
      setOptions(b);
      setFilters({
        sources: ['master', 'staff'],
        years: [...new Set(b.groups.map(g => g.year))],
        departments: [...new Set(b.groups.map(g => g.department_id))],
        types: ['chs', 'ug', 'gr', 'staff', null],
        includeEmpty: true,
        includeInactive: false
      });
    }).catch(e => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, []);
  const change = (key, value) => {
    setPreview(null);
    setFilters(f => ({
      ...f,
      [key]: value
    }));
  };
  const checkboxGroup = (key, title, items) => <fieldset disabled={busy}><legend>{title}</legend><div className="migration-export-actions"><button type="button" className="btn btn-secondary" onClick={() => change(key, items.map(i => i.value))}>Выбрать все</button><button type="button" className="btn btn-secondary" onClick={() => change(key, [])}>Снять выбор</button></div>{items.map(item => <label className="migration-export-choice" key={String(item.value)}><input type="checkbox" checked={filters[key].includes(item.value)} onChange={e => change(key, e.target.checked ? [...filters[key], item.value] : filters[key].filter(x => x !== item.value))} />{item.label}{item.count != null ? ` (${item.count})` : ''}</label>)}</fieldset>;
  function facets(key, label) {
    const map = new Map();
    for (const g of options.groups) {
      const value = g[key];
      if (!map.has(value)) map.set(value, {
        value,
        label: label(g),
        count: 0
      });
      map.get(value).count += g.count;
    }
    return [...map.values()];
  }
  async function run(operation) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/migration-export/' + operation, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          ...filters,
          ...(operation === 'xlsx' && preview ? {
            previewFingerprint: preview.fingerprint
          } : {})
        })
      });
      if (!response.ok) throw Error((await response.json()).message);
      if (operation === 'preview') setPreview(await response.json());else {
        const blob = await response.blob(),
          url = URL.createObjectURL(blob),
          a = document.createElement('a');
        const name = /filename\*=UTF-8''([^;]+)/.exec(response.headers.get('content-disposition') || '');
        a.href = url;
        a.download = name ? decodeURIComponent(name[1]) : 'Генотипы.xlsx';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!['admin', 'system_administrator'].includes(user?.role)) return <p role="alert">Доступно администратору организации.</p>;
  return <div className="migration-export-page"><h1>Выгрузка генотипов для переноса</h1><p>Выберите источники, годы и прежние отделения. Выгрузка сохраняет пустые и не классифицированные записи. XLSX не заменяет резервную копию приложения.</p>{error && <p role="alert">{error}</p>}{filters && <>
 <div className="migration-export-filters">{checkboxGroup('sources', 'Источники', facets('source', g => labels[g.source]))}{checkboxGroup('years', 'Годы', facets('year', g => g.year ?? 'Год не указан'))}{checkboxGroup('departments', 'Старые отделения', facets('department_id', g => g.department_name || 'Без указанного отделения'))}{checkboxGroup('types', 'Типы экспертизы', Object.entries({
          ...OBJECT_TYPES,
          null: 'Не классифицировано'
        }).map(([value, label]) => ({
          value: value === 'null' ? null : value,
          label
        })))}</div>
 <label className="migration-export-choice"><input type="checkbox" checked={filters.includeEmpty} onChange={e => change('includeEmpty', e.target.checked)} />Включить полностью пустые профили</label><label className="migration-export-choice"><input type="checkbox" checked={filters.includeInactive} onChange={e => change('includeInactive', e.target.checked)} />Включить удалённые/неактивные записи</label>
 <button className="btn btn-secondary" disabled={busy} onClick={() => run('preview')}>Предварительный просмотр</button>{preview && <section aria-live="polite"><h2>Выбрано записей: {preview.total}</h2><p>Пустых: {preview.empty}; без года: {preview.missingYear}; без категории: {preview.unclassified}; сотрудников без № рег.: {preview.missingRegistration}.</p><p>По источникам: {Object.entries(preview.sources).map(([key, count]) => `${labels[key]}: ${count}`).join('; ')}</p><button className="btn btn-primary" disabled={busy || !preview.total} onClick={() => run('xlsx')}>{busy ? 'Подготовка…' : 'Скачать XLSX'}</button></section>}
 </>}</div>;
}
