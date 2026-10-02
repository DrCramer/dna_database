import React, { useEffect, useState } from 'react';

const formatDateTime = (value) => {
  if (!value) return 'Нет данных';

  try {
    return new Date(value).toLocaleString('ru-RU');
  } catch (error) {
    return value;
  }
};

const renderValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return 'Нет данных';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
};

const formatLocusValue = (value) => {
  if (value === null || value === undefined) {
    return 'Нет данных';
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(' / ') : 'Нет данных';
  }

  if (typeof value === 'object') {
    const allele1 = value.allele1 ?? value.Allele1 ?? value.a1;
    const allele2 = value.allele2 ?? value.Allele2 ?? value.a2;

    if (allele1 !== undefined || allele2 !== undefined) {
      return [allele1, allele2].filter((item) => item !== undefined && item !== null && item !== '').join(' / ') || 'Нет данных';
    }

    const entries = Object.entries(value);
    if (entries.length === 0) {
      return 'Нет данных';
    }

    return entries.map(([key, item]) => `${key}: ${item}`).join(', ');
  }

  return String(value);
};

const renderStrData = (strData) => {
  if (!strData || typeof strData !== 'object' || Array.isArray(strData)) {
    return <pre>{renderValue(strData)}</pre>;
  }

  const lociEntries = Object.entries(strData);

  if (lociEntries.length === 0) {
    return <p>Нет данных по локусам.</p>;
  }

  return (
    <div className="master-object-loci-list">
      {lociEntries.map(([locus, value]) => (
        <div key={locus} className="master-object-locus-row">
          <div className="master-object-locus-name">{locus}</div>
          <div className="master-object-locus-value">{formatLocusValue(value)}</div>
        </div>
      ))}
    </div>
  );
};

const MasterObjectSearchPage = () => {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadObjectDetails = async (objectId) => {
    if (!objectId) {
      setSelectedObject(null);
      return;
    }

    try {
      setDetailsLoading(true);
      setError('');
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/profiles/master-objects/${objectId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Не удалось загрузить карточку объекта');
      }

      setSelectedObject(data.object || null);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить карточку объекта');
      setSelectedObject(null);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleSearch = async (event) => {
    event.preventDefault();

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError('Введите название объекта, внутренний номер, привоз или фрагмент комментария.');
      setResults([]);
      setSelectedObject(null);
      setSelectedObjectId(null);
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSubmittedQuery(trimmedQuery);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/profiles/master-objects/search?q=${encodeURIComponent(trimmedQuery)}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Не удалось выполнить поиск');
      }

      const objects = data.objects || [];
      setResults(objects);

      if (objects.length > 0) {
        setSelectedObjectId(objects[0].id);
      } else {
        setSelectedObjectId(null);
        setSelectedObject(null);
      }
    } catch (requestError) {
      setError(requestError.message || 'Не удалось выполнить поиск');
      setResults([]);
      setSelectedObject(null);
      setSelectedObjectId(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadObjectDetails(selectedObjectId);
  }, [selectedObjectId]);

  return (
    <div className="master-object-search-page">
      <section className="master-object-search-hero">
        <div>
          <p className="master-object-search-eyebrow">Глобальный поиск</p>
          <h1>Поиск объектов мастер-массива</h1>
          <p className="master-object-search-subtitle">
            Ищите объекты по названию, внутреннему номеру, привозу, комментариям и связанным метаданным.
          </p>
        </div>

        <form className="master-object-search-form" onSubmit={handleSearch}>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Например: объект, внутренний номер, привоз, комментарий..."
            className="master-object-search-input form-input"
          />
          <button type="submit" className="master-object-search-button btn btn-primary" disabled={loading}>
            {loading ? 'Поиск...' : 'Найти объект'}
          </button>
        </form>
      </section>

      {error && (
        <div className="master-object-search-alert">
          {error}
        </div>
      )}

      <div className="master-object-search-layout">
        <section className="master-object-search-results">
          <div className="master-object-search-section-head">
            <div>
              <h2>Результаты</h2>
              <p>
                {submittedQuery
                  ? `Запрос: "${submittedQuery}". Найдено: ${results.length}.`
                  : 'Введите запрос, чтобы найти объект в доступных мастер-массивах.'}
              </p>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="master-object-search-empty">
              {submittedQuery
                ? 'По этому запросу ничего не найдено.'
                : 'Поиск ещё не выполнялся.'}
            </div>
          ) : (
            <div className="master-object-search-result-list">
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`master-object-search-result-card ${selectedObjectId === item.id ? 'is-active' : ''}`}
                  onClick={() => setSelectedObjectId(item.id)}
                >
                  <div className="master-object-search-result-top">
                    <strong>{item.sample_name || 'Без названия'}</strong>
                    <span>{item.department_name || 'Без отдела'}</span>
                  </div>
                  <div className="master-object-search-result-meta">
                    <span>Внутренний номер: {item.internal_number || 'Нет данных'}</span>
                    <span>Привоз: {item.import_number || 'Нет данных'}</span>
                    <span>Год: {item.year || 'Нет данных'}</span>
                    <span>Изменён: {formatDateTime(item.updated_at)}</span>
                  </div>
                  {item.comment && (
                    <p className="master-object-search-result-comment">{item.comment}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="master-object-search-details">
          <div className="master-object-search-section-head">
            <div>
              <h2>Карточка объекта</h2>
              <p>Вся доступная информация по выбранному объекту.</p>
            </div>
          </div>

          {detailsLoading ? (
            <div className="master-object-search-empty">Загрузка карточки...</div>
          ) : !selectedObject ? (
            <div className="master-object-search-empty">Выберите объект из списка результатов.</div>
          ) : (
            <div className="master-object-card">
              <div className="master-object-card-header">
                <div>
                  <h3>{selectedObject.sample_name || 'Без названия'}</h3>
                  <p>
                    {selectedObject.master_array_name || 'Мастер-массив не указан'}
                    {' · '}
                    {selectedObject.department_name || 'Отдел не указан'}
                  </p>
                </div>
                <div className="master-object-card-badge">
                  {selectedObject.is_active ? 'Активен' : 'Неактивен'}
                </div>
              </div>

              <div className="master-object-card-grid">
                <div className="master-object-card-field">
                  <span>Внутренний номер</span>
                  <strong>{selectedObject.internal_number || 'Нет данных'}</strong>
                </div>
                <div className="master-object-card-field">
                  <span>Привоз</span>
                  <strong>{selectedObject.import_number || 'Нет данных'}</strong>
                </div>
                <div className="master-object-card-field">
                  <span>Год</span>
                  <strong>{selectedObject.year || 'Нет данных'}</strong>
                </div>
                <div className="master-object-card-field">
                  <span>Создан</span>
                  <strong>{formatDateTime(selectedObject.created_at)}</strong>
                </div>
                <div className="master-object-card-field">
                  <span>Создал</span>
                  <strong>{selectedObject.created_by_username || 'Нет данных'}</strong>
                </div>
                <div className="master-object-card-field">
                  <span>Последнее изменение</span>
                  <strong>{formatDateTime(selectedObject.updated_at)}</strong>
                </div>
                <div className="master-object-card-field">
                  <span>Кем изменён</span>
                  <strong>{selectedObject.last_modified_by || 'Нет данных'}</strong>
                </div>
                <div className="master-object-card-field">
                  <span>Отдел</span>
                  <strong>{selectedObject.department_name || 'Нет данных'}</strong>
                </div>
                <div className="master-object-card-field">
                  <span>Комментарий обновлён</span>
                  <strong>{formatDateTime(selectedObject.comment_updated_at)}</strong>
                </div>
              </div>

              <div className="master-object-card-block">
                <h4>Комментарий</h4>
                <p>{selectedObject.comment || 'Комментарий отсутствует.'}</p>
                <small>Автор/обновил: {selectedObject.comment_updated_by || 'Нет данных'}</small>
              </div>

              <div className="master-object-card-block">
                <h4>История по объекту</h4>
                {selectedObject.timeline && selectedObject.timeline.length > 0 ? (
                  <div className="master-object-timeline">
                    {selectedObject.timeline.map((event) => (
                      <div key={`${event.type}-${event.timestamp}`} className="master-object-timeline-item">
                        <strong>{event.label}</strong>
                        <span>{formatDateTime(event.timestamp)}</span>
                        <small>{event.actor || 'Исполнитель не указан'}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>История изменений пока отсутствует.</p>
                )}
              </div>

              <div className="master-object-card-block">
                <h4>STR и связанные данные</h4>
                {renderStrData(selectedObject.str_data)}
              </div>

              <div className="master-object-card-block">
                <h4>Метаданные объекта</h4>
                <pre>{renderValue(selectedObject.metadata)}</pre>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default MasterObjectSearchPage;
