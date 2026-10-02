import React, { useEffect, useState } from 'react';

/**
 * Настройки алгоритма контаминации
 */
const AlgorithmSettings = ({ isOpen, onClose, onSave, currentSettings }) => {
  const [settings, setSettings] = useState(null);
  const [defaultSettings, setDefaultSettings] = useState(null);
  const [isModified, setIsModified] = useState(false);

  const defaultColors = {
    fullMatch: '#90EE90',
    partialMatch: '#9d8311',
    partialMatchAllele: '#1400e8',
    noMatch: '#FFB6C1'
  };

  useEffect(() => {
    if (isOpen && !defaultSettings) {
      loadDefaultSettings();
    }
  }, [isOpen]);

  useEffect(() => {
    if (currentSettings && !settings && defaultSettings) {
      setSettings({
        useV4Algorithm:
          currentSettings.useV4Algorithm !== undefined
            ? currentSettings.useV4Algorithm
            : defaultSettings.options.useV4Algorithm,
        useV5Algorithm:
          currentSettings.useV5Algorithm !== undefined ? currentSettings.useV5Algorithm : true,
        threshold:
          currentSettings.threshold !== undefined
            ? currentSettings.threshold
            : defaultSettings.options.threshold,
        minLociMatch:
          currentSettings.minLociMatch !== undefined
            ? currentSettings.minLociMatch
            : defaultSettings.options.minLociMatch,
        criticalAlleleCount:
          currentSettings.criticalAlleleCount !== undefined
            ? currentSettings.criticalAlleleCount
            : defaultSettings.options.criticalAlleleCount,
        searchInMasterArray:
          currentSettings.searchInMasterArray !== undefined ? currentSettings.searchInMasterArray : false,
        locusWeights: currentSettings.locusWeights || { ...defaultSettings.locusWeights },
        matchCoefficients: currentSettings.matchCoefficients || { ...defaultSettings.matchCoefficients },
        colors: currentSettings.colors || { ...defaultColors }
      });
    }
  }, [currentSettings, defaultSettings]);

  const loadDefaultSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/staff-contamination/default-parameters', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (data.success) {
        setDefaultSettings(data.data);
        if (!settings) {
          setSettings({
            useV4Algorithm: data.data.options.useV4Algorithm,
            useV5Algorithm: false,
            threshold: data.data.options.threshold,
            minLociMatch: data.data.options.minLociMatch,
            criticalAlleleCount: data.data.options.criticalAlleleCount || 3,
            searchInMasterArray: false,
            locusWeights: { ...data.data.locusWeights },
            matchCoefficients: { ...data.data.matchCoefficients },
            colors: { ...defaultColors }
          });
        }
      }
    } catch (error) {
      console.error('Ошибка загрузки дефолтных настроек:', error);
      if (!settings) {
        setSettings({
          useV4Algorithm: true,
          useV5Algorithm: false,
          threshold: 55,
          minLociMatch: 8,
          criticalAlleleCount: 3,
          searchInMasterArray: false,
          locusWeights: {},
          matchCoefficients: {
            fullMatch: 1.0,
            partialMatch: 0.4,
            penalty: -0.6
          },
          colors: { ...defaultColors }
        });
      }
    }
  };

  const handleChange = (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setIsModified(true);
  };

  const handleSave = () => {
    onSave(settings);
    setIsModified(false);
    onClose();
  };

  if (!isOpen || !settings) {
    return null;
  }

  const algorithmValue = settings.useV5Algorithm ? 'v5' : settings.useV4Algorithm ? 'v4' : 'v1.5';

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-content modal-lg" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>Настройки алгоритма контаминации</h3>
          <button type="button" className="close-button" onClick={onClose} aria-label="Закрыть окно">
            ×
          </button>
        </div>

        <div className="modal-body">
          {!defaultSettings ? (
            <div className="table-loading">Загрузка настроек...</div>
          ) : (
            <div className="population-section">
              <section className="card">
                <div className="card-header">
                  <h4>Алгоритм</h4>
                </div>

                <div className="form-group">
                  <label className="form-label">Версия алгоритма</label>
                  <select
                    value={algorithmValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      handleChange({
                        useV4Algorithm: value === 'v4',
                        useV5Algorithm: value === 'v5'
                      });
                    }}
                    className="form-select"
                  >
                    <option value="v1.5">v1.5 (классический)</option>
                    <option value="v4">v4.0 (нормализация)</option>
                    <option value="v5">v5.0 (LCN + деградация)</option>
                  </select>
                </div>

                <div className="population-format-note">
                  <p><strong>v1.5:</strong> реконструкция профиля и проверка диплоидности.</p>
                  <p><strong>v4.0:</strong> веса локусов, штрафы и нормализация балла.</p>
                  <p><strong>v5.0:</strong> drop-out, редкие аллели, Mini-STR. Рекомендуется для LCN.</p>
                </div>
              </section>

              <section className="card">
                <div className="card-header">
                  <h4>Параметры поиска</h4>
                </div>

                <div className="form-group">
                  <label className="form-label">Порог: {settings.threshold.toFixed(0)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={settings.threshold}
                    onChange={(event) => handleChange({ threshold: parseFloat(event.target.value) })}
                    className="form-input"
                  />
                  <div className="form-hint">Минимальный процент для отображения результатов.</div>
                </div>

                <div className="form-group">
                  <label className="form-label">Минимум локусов: {settings.minLociMatch}</label>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="1"
                    value={settings.minLociMatch}
                    onChange={(event) => handleChange({ minLociMatch: parseInt(event.target.value, 10) })}
                    className="form-input"
                  />
                  <div className="form-hint">Минимальное количество совпадающих локусов.</div>
                </div>

                {settings.useV5Algorithm && (
                  <div className="form-group">
                    <label className="form-label">
                      Критические аллели: {settings.criticalAlleleCount || 3}
                    </label>
                    <input
                      type="range"
                      min="2"
                      max="5"
                      step="1"
                      value={settings.criticalAlleleCount || 3}
                      onChange={(event) =>
                        handleChange({ criticalAlleleCount: parseInt(event.target.value, 10) })
                      }
                      className="form-input"
                    />
                    <div className="form-hint">
                      Количество редких аллелей для применения правила трех редких.
                    </div>
                  </div>
                )}

                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.searchInMasterArray}
                    onChange={(event) => handleChange({ searchInMasterArray: event.target.checked })}
                  />
                  <span>Искать также в мастер-массиве</span>
                </label>
                <div className="form-hint">
                  {settings.searchInMasterArray
                    ? 'Поиск расширен на мастер-массив, время выполнения может увеличиться.'
                    : 'Поиск будет выполнен только в текущей задаче.'}
                </div>
              </section>

              <section className="card">
                <div className="card-header">
                  <h4>Цвета подсветки</h4>
                </div>

                <div className="population-preview-list">
                  <div className="population-preview-card">
                    <div className="population-preview-header">
                      <strong>Полное совпадение</strong>
                    </div>
                    <input
                      type="color"
                      value={settings.colors.fullMatch}
                      onChange={(event) =>
                        handleChange({ colors: { ...settings.colors, fullMatch: event.target.value } })
                      }
                    />
                  </div>

                  <div className="population-preview-card">
                    <div className="population-preview-header">
                      <strong>Контаминация (фон)</strong>
                    </div>
                    <input
                      type="color"
                      value={settings.colors.partialMatch}
                      onChange={(event) =>
                        handleChange({ colors: { ...settings.colors, partialMatch: event.target.value } })
                      }
                    />
                  </div>

                  <div className="population-preview-card">
                    <div className="population-preview-header">
                      <strong>Совпадающие аллели</strong>
                    </div>
                    <input
                      type="color"
                      value={settings.colors.partialMatchAllele}
                      onChange={(event) =>
                        handleChange({
                          colors: { ...settings.colors, partialMatchAllele: event.target.value }
                        })
                      }
                    />
                  </div>

                  <div className="population-preview-card">
                    <div className="population-preview-header">
                      <strong>Несовпадение</strong>
                    </div>
                    <input
                      type="color"
                      value={settings.colors.noMatch}
                      onChange={(event) =>
                        handleChange({ colors: { ...settings.colors, noMatch: event.target.value } })
                      }
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={() => handleChange({ colors: { ...defaultColors } })}
                >
                  Сбросить цвета по умолчанию
                </button>
              </section>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!isModified}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlgorithmSettings;
