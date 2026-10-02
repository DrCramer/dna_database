import React, { useState } from 'react';
import { bayesianService } from '../../services/bayesianService';

const PopulationList = ({
  populations,
  loading,
  isAdmin,
  onEdit,
  onDelete,
  onExport,
  onRefresh
}) => {
  const [expandedPopulation, setExpandedPopulation] = useState(null);
  const [populationDetails, setPopulationDetails] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});

  const handleToggleExpand = async (populationId) => {
    if (expandedPopulation === populationId) {
      setExpandedPopulation(null);
      return;
    }

    setExpandedPopulation(populationId);

    if (!populationDetails[populationId]) {
      setLoadingDetails((prev) => ({ ...prev, [populationId]: true }));
      try {
        const response = await bayesianService.getPopulation(populationId);
        setPopulationDetails((prev) => ({
          ...prev,
          [populationId]: response.data
        }));
      } catch (error) {
        console.error('Failed to load population details:', error);
      } finally {
        setLoadingDetails((prev) => ({ ...prev, [populationId]: false }));
      }
    }
  };

  const formatDate = (dateString) => new Date(dateString).toLocaleDateString('ru-RU');
  const formatNumber = (num) => num?.toLocaleString('ru-RU') || 'Нет данных';

  const renderPopulationDetails = (populationId) => {
    const details = populationDetails[populationId];
    const isLoading = loadingDetails[populationId];

    if (isLoading) {
      return <div className="table-loading">Загрузка деталей справочника...</div>;
    }

    if (!details) {
      return <div className="table-empty">Не удалось загрузить подробности по справочнику.</div>;
    }

    const lociEntries = details.locusFrequencies ? Object.entries(details.locusFrequencies) : [];

    return (
      <div className="population-detail-card">
        <div className="population-detail-grid">
          <div>
            <div className="population-detail-label">Объем выборки</div>
            <div className="population-detail-value">{formatNumber(details.sampleSize)}</div>
          </div>
          <div>
            <div className="population-detail-label">Коэффициент инбридинга</div>
            <div className="population-detail-value">
              {((details.inbreedingCoefficient || 0) * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="population-detail-label">Количество локусов</div>
            <div className="population-detail-value">{lociEntries.length}</div>
          </div>
          <div>
            <div className="population-detail-label">Обновлено</div>
            <div className="population-detail-value">
              {details.lastUpdated ? formatDate(details.lastUpdated) : 'Не указано'}
            </div>
          </div>
        </div>

        {lociEntries.length > 0 && (
          <div className="population-section">
            <h4 className="population-section-title">Обзор локусов</h4>
            <div className="population-loci-grid">
              {lociEntries.slice(0, 10).map(([locusName, locusData]) => (
                <div key={locusName} className="population-locus-card">
                  <h5>{locusName}</h5>
                  <div className="population-locus-meta">
                    Аллелей: {locusData.frequencies ? Object.keys(locusData.frequencies).length : 0}
                  </div>
                  <div className="population-locus-meta">
                    Выборка: {formatNumber(locusData.sampleSize)}
                  </div>
                </div>
              ))}
            </div>
            {lociEntries.length > 10 && (
              <div className="population-loci-more">
                И еще {lociEntries.length - 10} локусов в этом справочнике.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="table-loading">Загрузка популяционных данных...</div>;
  }

  if (populations.length === 0) {
    return (
      <div className="card population-empty">
        <div className="population-empty-icon">📊</div>
        <h4>Справочники популяций пока не добавлены</h4>
        <p>
          В системе еще нет наборов частот аллелей для байесовского анализа.
          {isAdmin ? ' Создайте новый справочник или загрузите файл импорта.' : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="population-section">
      <div className="population-list-meta">
        <div className="population-list-count">Доступно справочников: {populations.length}</div>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={onRefresh}>
          Обновить список
        </button>
      </div>

      <div className="population-list">
        {populations.map((population) => (
          <article key={population.populationId} className="population-item">
            <div
              className="population-item-header"
              onClick={() => handleToggleExpand(population.populationId)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleToggleExpand(population.populationId);
                }
              }}
            >
              <div className="population-item-main">
                <div className="population-item-title">
                  <h4>{population.name}</h4>
                  <span className="population-badge">{population.populationId}</span>
                </div>
                <div className="population-item-stats">
                  <span>Выборка: {formatNumber(population.sampleSize)}</span>
                  <span>Локусы: {population.lociCount || 'Не указано'}</span>
                  <span>Инбридинг: {((population.inbreedingCoefficient || 0) * 100).toFixed(1)}%</span>
                </div>
              </div>

              <div className="population-item-actions">
                <div className="table-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onExport(population.populationId, 'json');
                    }}
                    title="Экспортировать справочник"
                  >
                    Экспорт
                  </button>

                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(population);
                        }}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(population.populationId);
                        }}
                      >
                        Удалить
                      </button>
                    </>
                  )}
                </div>

                <span
                  className={`population-item-chevron ${expandedPopulation === population.populationId ? 'is-open' : ''}`}
                  aria-hidden="true"
                >
                  ▼
                </span>
              </div>
            </div>

            {expandedPopulation === population.populationId && (
              <div className="population-item-body">
                {renderPopulationDetails(population.populationId)}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
};

export default PopulationList;
