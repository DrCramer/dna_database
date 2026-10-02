import React, { useState } from 'react';
import { dnaAnalysisService } from '../../services/dnaAnalysisService';

const ResultsDisplay = ({ results, searchSettings }) => {
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const getMatchClass = (percentage) => {
    if (percentage >= 90) return 'match-high';
    if (percentage >= 70) return 'match-medium';
    return 'match-low';
  };

  const handleExportResults = async () => {
    setExporting(true);
    setExportError(null);

    try {
      const blob = await dnaAnalysisService.exportResults(results.matches, 'excel');
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `dna_analysis_results_${new Date().toISOString().split('T')[0]}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message);
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  if (!results || !results.matches) {
    return null;
  }

  const { matches, searchProfile, totalComparisons, executionTime } = results;

  return (
    <div className="card analysis-result-shell">
      <div className="analysis-toolbar">
        <h2 className="population-section-title">Результаты поиска</h2>
        <button className="btn btn-primary" onClick={handleExportResults} disabled={exporting || matches.length === 0}>
          {exporting ? 'Экспорт...' : 'Экспортировать результаты'}
        </button>
      </div>

      {exportError && (
        <div className="alert alert-danger">
          <div className="alert-content">
            <div className="alert-title">Ошибка экспорта</div>
            <p className="alert-message">{exportError}</p>
          </div>
        </div>
      )}

      <div className="analysis-metrics-grid">
        <div className="analysis-metric-card">
          <div className="analysis-mini-label">Профиль поиска</div>
          <div className="analysis-main-value">{searchProfile?.sample_name || 'Пакетный поиск'}</div>
        </div>
        <div className="analysis-metric-card">
          <div className="analysis-mini-label">Найдено совпадений</div>
          <div className="analysis-main-value">{matches.length}</div>
        </div>
        <div className="analysis-metric-card">
          <div className="analysis-mini-label">Всего сравнений</div>
          <div className="analysis-main-value">{totalComparisons?.toLocaleString('ru-RU') || 'Нет данных'}</div>
        </div>
        <div className="analysis-metric-card">
          <div className="analysis-mini-label">Время выполнения</div>
          <div className="analysis-main-value">{executionTime ? `${executionTime} мс` : 'Нет данных'}</div>
        </div>
        <div className="analysis-metric-card">
          <div className="analysis-mini-label">Порог совпадения</div>
          <div className="analysis-main-value">{searchSettings.threshold}%</div>
        </div>
      </div>

      {matches.length > 0 ? (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Имя образца</th>
                <th>Совпадение</th>
                <th>Совпавшие локусы</th>
                <th>Всего локусов</th>
                <th>Дата загрузки</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match, index) => (
                <tr key={`${match.profile?.id || match.sample_name}-${index}`}>
                  <td><strong>{match.profile?.sample_name || match.sample_name}</strong></td>
                  <td>
                    <span className={`match-percentage ${getMatchClass(match.overall_match_percentage)}`}>
                      {match.overall_match_percentage.toFixed(1)}%
                    </span>
                  </td>
                  <td>{match.matching_loci_count || 'Нет данных'}</td>
                  <td>{match.total_loci_count || 'Нет данных'}</td>
                  <td>
                    {match.profile?.upload_date
                      ? new Date(match.profile.upload_date).toLocaleDateString('ru-RU')
                      : 'Нет данных'}
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelectedMatch(match)}>
                      Подробности
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="analysis-empty">
          <h3>Совпадения не найдены</h3>
          <p>Ни один профиль не превысил порог {searchSettings.threshold}%.</p>
          <p>Попробуйте снизить порог или изменить параметры поиска.</p>
        </div>
      )}

      {selectedMatch && (
        <div className="modal-overlay">
          <div className="modal-content modal-lg">
            <div className="modal-header">
              <h3>Детали совпадения: {selectedMatch.profile?.sample_name || selectedMatch.sample_name}</h3>
              <button type="button" className="close-button" onClick={() => setSelectedMatch(null)} aria-label="Закрыть окно">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="analysis-metrics-grid">
                <div className="analysis-metric-card">
                  <div className="analysis-mini-label">Общее совпадение</div>
                  <div className="analysis-main-value">{selectedMatch.overall_match_percentage.toFixed(2)}%</div>
                </div>
                <div className="analysis-metric-card">
                  <div className="analysis-mini-label">Совпавшие локусы</div>
                  <div className="analysis-main-value">{selectedMatch.matching_loci_count} / {selectedMatch.total_loci_count}</div>
                </div>
                <div className="analysis-metric-card">
                  <div className="analysis-mini-label">Дата анализа</div>
                  <div className="analysis-main-value">
                    {selectedMatch.analysis_date ? new Date(selectedMatch.analysis_date).toLocaleString('ru-RU') : 'Нет данных'}
                  </div>
                </div>
              </div>

              <h4 className="population-section-title">Сравнение по локусам STR</h4>
              <div className="analysis-scroll-box">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Локус STR</th>
                      <th>Профиль 1</th>
                      <th>Профиль 2</th>
                      <th>Совпадение</th>
                      <th>Процент</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedMatch.locus_matches &&
                      Object.entries(selectedMatch.locus_matches).map(([locus, locusMatch]) => (
                        <tr key={locus} className={locusMatch.match ? 'selected' : 'highlighted'}>
                          <td className="analysis-code"><strong>{locus}</strong></td>
                          <td className="analysis-code">{locusMatch.profile1_alleles || 'Нет данных'}</td>
                          <td className="analysis-code">{locusMatch.profile2_alleles || 'Нет данных'}</td>
                          <td>{locusMatch.match ? 'Да' : 'Нет'}</td>
                          <td>{locusMatch.percentage !== undefined ? `${locusMatch.percentage.toFixed(1)}%` : 'Нет данных'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {selectedMatch.profile && (
                <>
                  <h4 className="population-section-title">Информация о профиле</h4>
                  <div className="analysis-metrics-grid">
                    <div className="analysis-metric-card">
                      <div className="analysis-mini-label">Имя образца</div>
                      <div className="analysis-main-value">{selectedMatch.profile.sample_name}</div>
                    </div>
                    <div className="analysis-metric-card">
                      <div className="analysis-mini-label">Дата загрузки</div>
                      <div className="analysis-main-value">{new Date(selectedMatch.profile.upload_date).toLocaleString('ru-RU')}</div>
                    </div>
                    <div className="analysis-metric-card">
                      <div className="analysis-mini-label">Источник файла</div>
                      <div className="analysis-main-value">{selectedMatch.profile.file_source || 'Нет данных'}</div>
                    </div>
                    <div className="analysis-metric-card">
                      <div className="analysis-mini-label">Примечания</div>
                      <div className="analysis-main-value">{selectedMatch.profile.notes || 'Нет'}</div>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedMatch(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsDisplay;
