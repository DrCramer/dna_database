import React, { useState, useEffect } from 'react';
import AlgorithmSettings from './AlgorithmSettings';

// Локусы для анализа (24 основных) - порядок как в таблице данных
const ANALYSIS_LOCI = [
  'D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'Yindel', 'AMEL',
  'D8S1179', 'D21S11', 'D18S51', 'DYS391', 'D2S441', 'D19S433',
  'TH01', 'FGA', 'D22S1045', 'D5S818', 'D13S317', 'D7S820', 'SE33',
  'D10S1248', 'D1S1656', 'D12S391', 'D2S1338'
];

/**
 * Компонент для анализа контаминации сотрудников
 */
const StaffContaminationPanel = ({ profiles }) => {
  const [selectedSample, setSelectedSample] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [staffProfiles, setStaffProfiles] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [customSettings, setCustomSettings] = useState(null);
  const [options, setOptions] = useState({
    minLociMatch: 8,
    criticalAlleleCount: 3,
    threshold: 5.5,  // Порог для v4.0 (нормализованный балл 0-30)
    useV4Algorithm: true  // Использовать алгоритм v4.0 по умолчанию
  });

  // Загрузка профилей сотрудников
  useEffect(() => {
    loadStaffProfiles();
  }, []);

  // Загрузка кастомных настроек из LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('contamination-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCustomSettings(parsed);
      } catch (error) {
        console.error('Ошибка загрузки настроек:', error);
      }
    }
  }, []);

  const loadStaffProfiles = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/staff-contamination/staff-profiles', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (data.success) {
        setStaffProfiles(data.data);
      }
    } catch (err) {
      console.error('Ошибка загрузки профилей сотрудников:', err);
    }
  };

  // Обработчик сохранения настроек
  const handleSaveSettings = (newSettings) => {
    setCustomSettings(newSettings);
    localStorage.setItem('contamination-settings', JSON.stringify(newSettings));
  };

  const analyzeContamination = async () => {
    if (!selectedSample) {
      setError('Выберите образец для анализа');
      return;
    }

    setAnalyzing(true);
    setError(null);
    setResults(null);

    try {
      const token = localStorage.getItem('token');

      // Используем кастомные настройки, если они есть, иначе дефолтные
      const analysisOptions = customSettings || options;

      const response = await fetch('/api/staff-contamination/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          sampleProfileId: selectedSample.id,
          options: analysisOptions
        })
      });

      const data = await response.json();

      if (data.success) {
        setResults(data.data);
      } else {
        setError(data.error || 'Ошибка анализа');
      }
    } catch (err) {
      console.error('Ошибка анализа контаминации:', err);
      setError('Ошибка выполнения анализа');
    } finally {
      setAnalyzing(false);
    }
  };

  const getConfidenceTone = (confidence) => {
    switch (confidence) {
      case 'CRITICAL': return 'critical';
      case 'HIGH': return 'high';
      case 'MEDIUM': return 'medium';
      case 'LOW': return 'low';
      default: return 'neutral';
    }
  };

  const getConfidenceIcon = (confidence) => {
    switch (confidence) {
      case 'CRITICAL': return '🔴';
      case 'HIGH': return '🟠';
      case 'MEDIUM': return '🟡';
      case 'LOW': return '🟢';
      default: return '⚪';
    }
  };

  return (
    <div className="staff-contamination-panel">
      <div className="contamination-header">
        <h2>🧬 Анализ контаминации сотрудников</h2>
        <p className="contamination-description">
          Выявление контаминации образцов профилями сотрудников через анализ STR-локусов
        </p>
      </div>

      {/* Выбор образца */}
      <div className="contamination-section">
        <h3>1. Выбор образца для анализа</h3>
        <div className="sample-selector">
          <select
            value={selectedSample?.id || ''}
            onChange={(e) => {
              const profile = profiles.find(p => p.id === e.target.value);
              setSelectedSample(profile);
              setResults(null);
            }}
            className="sample-select form-select"
          >
            <option value="">-- Выберите образец --</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.sample_name} ({profile.internal_number || 'без номера'})
              </option>
            ))}
          </select>

          {selectedSample && (
            <div className="selected-sample-info">
              <strong>Выбран:</strong> {selectedSample.sample_name}
              <br />
              <strong>Внутренний номер:</strong> {selectedSample.internal_number || 'не указан'}
            </div>
          )}
        </div>
      </div>

      {/* Настройки анализа */}
      <div className="contamination-section">
        <h3>2. Параметры анализа</h3>
        <div className="analysis-options">
          <div className="option-group">
            <label>
              Минимум совпадающих локусов:
              <input
                type="number"
                min="1"
                max="24"
                value={options.minLociMatch}
                onChange={(e) => setOptions({...options, minLociMatch: parseInt(e.target.value)})}
               className="form-input"/>
            </label>
            <span className="option-hint">Минимальное количество локусов для выявления контаминации</span>
          </div>

          <div className="option-group">
            <label>
              Порог критического локуса (аллелей):
              <input
                type="number"
                min="3"
                max="10"
                value={options.criticalAlleleCount}
                onChange={(e) => setOptions({...options, criticalAlleleCount: parseInt(e.target.value)})}
               className="form-input"/>
            </label>
            <span className="option-hint">Количество аллелей для определения критического локуса</span>
          </div>

          <div className="option-group">
            <label>
              Порог контаминации (%):
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={options.threshold}
                onChange={(e) => setOptions({...options, threshold: parseFloat(e.target.value)})}
               className="form-input"/>
            </label>
            <span className="option-hint">Минимальный процент для отображения результата</span>
          </div>
        </div>

        <div className="staff-info">
          <strong>Профилей сотрудников в базе:</strong> {staffProfiles.length}
        </div>
      </div>

      {/* Кнопка анализа */}
      <div className="contamination-section">
        <div className="analysis-controls">
          <button
            onClick={analyzeContamination}
            disabled={!selectedSample || analyzing}
            className="analyze-button btn btn-primary"
          >
            {analyzing ? '⏳ Анализ...' : '🔍 Запустить анализ'}
          </button>

          {/* Быстрый переключатель алгоритма */}
          <div className="algorithm-quick-switch">
            <label className="quick-switch-label">Алгоритм:</label>
            <select
              className="algorithm-select form-select"
              value={
                customSettings?.useV5Algorithm ? 'v5' :
                customSettings?.useV4Algorithm ? 'v4' :
                'v1.5'
              }
              onChange={(e) => {
                const value = e.target.value;
                const newSettings = {
                  ...(customSettings || options),
                  useV4Algorithm: value === 'v4',
                  useV5Algorithm: value === 'v5'
                };
                handleSaveSettings(newSettings);
              }}
              title="Быстрое переключение алгоритма"
            >
              <option value="v1.5">v1.5 (Классический)</option>
              <option value="v4">v4.0 (Нормализация)</option>
              <option value="v5">v5.0 (LCN + Деградация) 🆕</option>
            </select>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="btn-secondary btn"
            title="Настройки алгоритма контаминации"
          >
            ⚙️ Настройки алгоритма
          </button>

          <div className="settings-indicator">
            {customSettings ? (
              <span className="custom-indicator" title="Используются кастомные настройки">
                🔧 Кастомные настройки
                {customSettings.useV5Algorithm && ' (v5.0)'}
                {customSettings.useV4Algorithm && !customSettings.useV5Algorithm && ' (v4.0)'}
                {!customSettings.useV4Algorithm && !customSettings.useV5Algorithm && ' (v1.5)'}
              </span>
            ) : (
              <span className="default-indicator" title="Используются дефолтные настройки">
                ✅ Дефолт v4.0
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Ошибка */}
      {error && (
        <div className="contamination-error">
          ❌ {error}
        </div>
      )}

      {/* Результаты */}
      {results && (
        <div className="contamination-results">
          <div className="results-header">
            <h3>📊 Результаты анализа</h3>
            <div className="results-summary">
              <div className="summary-item">
                <span className="summary-label">Образец:</span>
                <span className="summary-value">{results.sample_name}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Проанализировано сотрудников:</span>
                <span className="summary-value">{results.total_staff_analyzed}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Обнаружено случаев:</span>
                <span className="summary-value highlight">{results.contamination_cases}</span>
              </div>
            </div>
          </div>

          {results.contamination_cases === 0 ? (
            <div className="no-contamination">
              ✅ Контаминация не обнаружена
            </div>
          ) : (
            <div className="contamination-list">
              {results.results.map((result, index) => (
                <div
                  key={index}
                  className={`contamination-card tone-${getConfidenceTone(result.confidence)}`}
                >
                  <div className="card-header">
                    <div className="staff-info-header">
                      <span className="confidence-icon">{getConfidenceIcon(result.confidence)}</span>
                      <h4>{result.staffName}</h4>
                      <span className="staff-id">({result.staffIdentifier})</span>
                    </div>
                    <div className="contamination-score">
                      <div className="score-value">
                        {result.percentage}%
                      </div>
                      <div className="confidence-level">{result.confidence}</div>
                    </div>
                  </div>

                  <div className="card-body">
                    <div className={`recommendation ${result.confidence === 'CRITICAL' || result.confidence === 'HIGH' ? 'is-warning' : 'is-success'}`}>
                      <strong>Рекомендация:</strong> {result.recommendation}
                    </div>

                    <div className="statistics-grid">
                      <div className="stat-item">
                        <div className="stat-label">Совпадающих локусов</div>
                        <div className="stat-value">{result.matchingLoci.length}</div>
                      </div>
                      <div className="stat-item critical">
                        <div className="stat-label">Критических локусов</div>
                        <div className="stat-value">{result.criticalLoci.length}</div>
                      </div>
                      <div className="stat-item critical">
                        <div className="stat-label">Сильных критических</div>
                        <div className="stat-value">{result.strongCriticalLoci?.length || 0}</div>
                      </div>
                      <div className="stat-item">
                        <div className="stat-label">Лишних аллелей</div>
                        <div className="stat-value">{result.totalExtraAlleles}</div>
                      </div>
                      <div className="stat-item success">
                        <div className="stat-label">Объяснено</div>
                        <div className="stat-value">{result.extraAllelesExplained}</div>
                      </div>
                      <div className="stat-item">
                        <div className="stat-label">Взвешенный балл</div>
                        <div className="stat-value">{result.weightedMatchScore?.toFixed(1) || 0}</div>
                      </div>
                      <div className="stat-item success">
                        <div className="stat-label">Диплоидный остаток</div>
                        <div className="stat-value">{result.diploidAfterSubtraction ? '✅ ДА' : '❌ НЕТ'}</div>
                      </div>
                      <div className="stat-item">
                        <div className="stat-label">Нарушений до/после</div>
                        <div className="stat-value">{result.totalViolationsBefore} → {result.totalViolationsAfter}</div>
                      </div>
                    </div>

                    {result.criticalLoci.length > 0 && (
                      <div className="critical-loci-section">
                        <strong>⚠️ Критические локусы ({result.criticalLoci.length}):</strong>
                        <div className="loci-tags">
                          {result.criticalLoci.map(locus => (
                            <span key={locus} className="locus-tag critical">{locus}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {result.strongCriticalLoci && result.strongCriticalLoci.length > 0 && (
                      <div className="critical-loci-section">
                        <strong>🔴 Сильные критические локусы ({result.strongCriticalLoci.length}):</strong>
                        <div className="loci-tags">
                          {result.strongCriticalLoci.map(locus => (
                            <span key={locus} className="locus-tag strong-critical">{locus}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {result.detailedMatches.length > 0 && (
                      <details className="detailed-matches">
                        <summary>Детальное совпадение по локусам ({result.detailedMatches.length})</summary>
                        <div className="matches-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Локус</th>
                                <th>Образец</th>
                                <th>Сотрудник</th>
                                <th>Совпадение</th>
                                <th>Остаток</th>
                                <th>Вес</th>
                                <th>Тип</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...result.detailedMatches].sort((a, b) => {
                                const indexA = ANALYSIS_LOCI.indexOf(a.locus);
                                const indexB = ANALYSIS_LOCI.indexOf(b.locus);
                                return indexA - indexB;
                              }).map((match, idx) => (
                                <tr key={idx} className={match.isStrongCritical ? 'strong-critical-row' : match.isCritical ? 'critical-row' : ''}>
                                  <td><strong>{match.locus}</strong></td>
                                  <td>{match.sampleAlleles.length > 0 ? match.sampleAlleles.join(', ') : '—'}</td>
                                  <td>{match.staffAlleles.length > 0 ? match.staffAlleles.join(', ') : '—'}</td>
                                  <td className="match-alleles">
                                    {match.explainedAlleles.length > 0 ? match.explainedAlleles.join(', ') : '—'}
                                  </td>
                                  <td>{match.remainingAlleles.length > 0 ? match.remainingAlleles.join(', ') : '—'}</td>
                                  <td>{match.matchWeight?.toFixed(1) || '0.0'}</td>
                                  <td>
                                    {match.isStrongCritical && <span className="badge strong-critical">Сильный критический</span>}
                                    {match.isCritical && !match.isStrongCritical && <span className="badge critical">Критический</span>}
                                    {match.isFullMatch && <span className="badge full-match">Полное совпадение</span>}
                                    {!match.isCritical && <span className="badge normal">Обычный</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Модальное окно настроек */}
      <AlgorithmSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
        currentSettings={customSettings || options}
      />
    </div>
  );
};

export default StaffContaminationPanel;
