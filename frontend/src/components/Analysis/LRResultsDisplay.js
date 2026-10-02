import React, { useState } from 'react';

const LRResultsDisplay = ({ results }) => {
  const [showLocusDetails, setShowLocusDetails] = useState(false);

  if (!results || !results.analysis) {
    return null;
  }

  const { analysis, profiles } = results;
  const { overallLR, locusLRs, confidenceInterval, calculationMetadata } = analysis;

  const formatLR = (lr) => {
    if (lr === null || lr === undefined) return 'Нет данных';
    if (lr === 0) return '0';
    if (lr < 0.001 || lr > 1000) return lr.toExponential(2);
    return lr.toFixed(3);
  };

  const getLRInterpretation = (lr) => {
    if (lr === null || lr === undefined || lr === 0) {
      return { text: 'Доказательств недостаточно', level: 'neutral' };
    }
    if (lr < 1) {
      return { text: 'Доводы против совпадения', level: 'danger' };
    }
    if (lr < 10) {
      return { text: 'Ограниченные доводы в пользу совпадения', level: 'warning' };
    }
    if (lr < 100) {
      return { text: 'Умеренные доводы в пользу совпадения', level: 'warning' };
    }
    if (lr < 1000) {
      return { text: 'Сильные доводы в пользу совпадения', level: 'success' };
    }
    return { text: 'Очень сильные доводы в пользу совпадения', level: 'success' };
  };

  const interpretation = getLRInterpretation(overallLR);

  return (
    <div className="analysis-result-shell">
      <div className="analysis-profile-grid">
        <div className="analysis-profile-card">
          <div className="analysis-mini-label">Профиль 1</div>
          <div className="analysis-main-value">{profiles.profile1.sampleName}</div>
          <div className="analysis-subtle">ID: {profiles.profile1.id.substring(0, 16)}...</div>
        </div>
        <div className="analysis-profile-card">
          <div className="analysis-mini-label">Профиль 2</div>
          <div className="analysis-main-value">{profiles.profile2.sampleName}</div>
          <div className="analysis-subtle">ID: {profiles.profile2.id.substring(0, 16)}...</div>
        </div>
      </div>

      <div className={`analysis-status-card status-${interpretation.level === 'neutral' ? 'warning' : interpretation.level}`}>
        <div className="analysis-status-title">Общий LR: {formatLR(overallLR)}</div>
        <div className="analysis-status-text">{interpretation.text}</div>
        {confidenceInterval && (
          <div className="analysis-emphasis">
            95% ДИ: [{formatLR(confidenceInterval[0])}, {formatLR(confidenceInterval[1])}]
          </div>
        )}
      </div>

      <div className="analysis-detail-card">
        <div className="analysis-mini-label">Шкала интерпретации LR</div>
        <div className="analysis-badge-grid">
          <span className="analysis-badge warning">&lt; 1: против совпадения</span>
          <span className="analysis-badge warning">1-10: ограниченно</span>
          <span className="analysis-badge warning">10-100: умеренно</span>
          <span className="analysis-badge success">100-1000: сильно</span>
          <span className="analysis-badge success">&gt; 1000: очень сильно</span>
        </div>
      </div>

      {locusLRs && Object.keys(locusLRs).length > 0 && (
        <>
          <button
            type="button"
            className="btn btn-tertiary analysis-toggle"
            onClick={() => setShowLocusDetails((prev) => !prev)}
          >
            {showLocusDetails ? 'Скрыть' : 'Показать'} детализацию по локусам
          </button>

          {showLocusDetails && (
            <div className="analysis-flagged-grid">
              {Object.entries(locusLRs).map(([locus, lr]) => {
                const locusInterpretation = getLRInterpretation(lr);
                return (
                  <div key={locus} className="analysis-detail-card">
                    <div className="analysis-main-value">{locus}</div>
                    <div
                      className={
                        locusInterpretation.level === 'success'
                          ? 'analysis-highlight-success'
                          : locusInterpretation.level === 'danger'
                            ? 'analysis-highlight-danger'
                            : 'analysis-highlight-warning'
                      }
                    >
                      {formatLR(lr)}
                    </div>
                    <div className="analysis-subtle">{locusInterpretation.text}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {calculationMetadata && (
        <div className="analysis-detail-card">
          <div className="analysis-mini-label">Детали расчета</div>
          <div className="analysis-list">
            <li><strong>Популяция:</strong> {results.populationUsed}</li>
            <li><strong>Время анализа:</strong> {new Date(results.analysisTimestamp).toLocaleString('ru-RU')}</li>
            {calculationMetadata.lociAnalyzed && (
              <li><strong>Проанализировано локусов:</strong> {calculationMetadata.lociAnalyzed}</li>
            )}
            {calculationMetadata.calculationTime && (
              <li><strong>Длительность расчета:</strong> {calculationMetadata.calculationTime} мс</li>
            )}
          </div>
          {calculationMetadata.warnings && calculationMetadata.warnings.length > 0 && (
            <>
              <div className="analysis-mini-label analysis-section-gap">Предупреждения</div>
              <ul className="analysis-list">
                {calculationMetadata.warnings.map((warning, index) => (
                  <li key={`warning-${index}`} className="analysis-highlight-warning">{warning}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default LRResultsDisplay;
