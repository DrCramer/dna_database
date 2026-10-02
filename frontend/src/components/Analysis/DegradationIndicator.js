import React from 'react';

const DegradationIndicator = ({ results }) => {
  if (!results || !results.analysis) {
    return null;
  }

  const { analysis, profile } = results;
  const { degradationIndex, qualityScore, confidenceInterval, recommendation } = analysis;

  const getDegradationStatus = () => {
    if (degradationIndex > 0.7) {
      return { status: 'Сильная деградация', icon: '🔴', level: 'danger', description: 'Образец имеет выраженные признаки деградации.' };
    }
    if (degradationIndex > 0.5) {
      return { status: 'Умеренная деградация', icon: '🟡', level: 'warning', description: 'Образец показывает умеренную деградацию.' };
    }
    if (degradationIndex > 0.3) {
      return { status: 'Незначительная деградация', icon: '🟡', level: 'warning', description: 'Качество образца слегка снижено.' };
    }
    return { status: 'Хорошее качество', icon: '🟢', level: 'success', description: 'Признаки деградации минимальны.' };
  };

  const getQualityRating = (score) => {
    if (score >= 0.8) return { rating: 'Отлично', level: 'success' };
    if (score >= 0.6) return { rating: 'Хорошо', level: 'success' };
    if (score >= 0.4) return { rating: 'Удовлетворительно', level: 'warning' };
    if (score >= 0.2) return { rating: 'Низко', level: 'warning' };
    return { rating: 'Очень низко', level: 'danger' };
  };

  const status = getDegradationStatus();
  const quality = getQualityRating(qualityScore);
  const formatIndex = (value) => `${(value * 100).toFixed(1)}%`;
  const formatScore = (value) => `${(value * 100).toFixed(0)}%`;

  return (
    <div className="analysis-result-shell">
      <div className="analysis-profile-card">
        <div className="analysis-mini-label">Анализируемый профиль</div>
        <div className="analysis-main-value">{profile.sampleName}</div>
        <div className="analysis-subtle">
          ID: {profile.id.substring(0, 16)}... | Загружен: {new Date(profile.uploadDate).toLocaleDateString('ru-RU')}
        </div>
      </div>

      <div className={`analysis-status-card status-${status.level}`}>
        <div className="analysis-status-icon">{status.icon}</div>
        <div className="analysis-status-title">{status.status}</div>
        <div className="analysis-status-text">{status.description}</div>
        <div className="analysis-emphasis">Индекс деградации: {formatIndex(degradationIndex)}</div>
        {confidenceInterval && (
          <div className="analysis-status-text">
            95% ДИ: [{formatIndex(confidenceInterval[0])}, {formatIndex(confidenceInterval[1])}]
          </div>
        )}
      </div>

      <div className="analysis-metrics-grid">
        <div className="analysis-metric-card">
          <div className="analysis-mini-label">Общая оценка качества</div>
          <div className={quality.level === 'success' ? 'analysis-highlight-success' : quality.level === 'danger' ? 'analysis-highlight-danger' : 'analysis-highlight-warning'}>
            {formatScore(qualityScore)}
          </div>
          <div className="analysis-subtle">{quality.rating}</div>
        </div>

        <div className="analysis-metric-card">
          <div className="analysis-mini-label">Индекс деградации</div>
          <div className={status.level === 'success' ? 'analysis-highlight-success' : status.level === 'danger' ? 'analysis-highlight-danger' : 'analysis-highlight-warning'}>
            {formatIndex(degradationIndex)}
          </div>
          <div className="analysis-subtle">Оценивается по STR-гомозиготности</div>
        </div>

        {confidenceInterval && (
          <div className="analysis-metric-card">
            <div className="analysis-mini-label">Диапазон доверия</div>
            <div className="analysis-main-value">
              ±{formatIndex(Math.abs(confidenceInterval[1] - confidenceInterval[0]) / 2)}
            </div>
            <div className="analysis-subtle">95% доверительный интервал</div>
          </div>
        )}
      </div>

      <div className="analysis-detail-card">
        <div className="analysis-mini-label">Шкала деградации</div>
        <div className="analysis-badge-grid">
          <span className="analysis-badge success">0-30%: хорошее качество</span>
          <span className="analysis-badge warning">30-50%: легкая деградация</span>
          <span className="analysis-badge warning">50-70%: умеренная деградация</span>
          <span className="analysis-badge warning">&gt;70%: сильная деградация</span>
        </div>
      </div>

      <div className="analysis-detail-card">
        <div className="analysis-mini-label">Рекомендации</div>
        {recommendation ? (
          <>
            <div className="analysis-main-value">{recommendation.action}</div>
            {recommendation.details && <div className="analysis-subtle">{recommendation.details}</div>}
          </>
        ) : degradationIndex > 0.7 ? (
          <ul className="analysis-list">
            <li>Используйте повышенную осторожность при интерпретации результатов.</li>
            <li>Рассмотрите дополнительные меры контроля качества.</li>
            <li>По возможности инициируйте повторный отбор материала.</li>
            <li className="analysis-highlight-danger">Для этого образца может потребоваться специальный режим анализа.</li>
          </ul>
        ) : degradationIndex > 0.5 ? (
          <ul className="analysis-list">
            <li>Продолжайте анализ, но зафиксируйте ухудшение качества.</li>
            <li>Добавьте дополнительные этапы валидации, если это необходимо.</li>
            <li>Отметьте результат в итоговом заключении.</li>
          </ul>
        ) : (
          <ul className="analysis-list">
            <li>Качество образца подходит для стандартного анализа.</li>
            <li>Можно использовать обычные протоколы обработки.</li>
            <li>Сохраните стандартный мониторинг качества.</li>
          </ul>
        )}
      </div>

      <div className="analysis-detail-card">
        <div className="analysis-mini-label">Детали анализа</div>
        <ul className="analysis-list">
          <li><strong>Время анализа:</strong> {new Date(results.analysisTimestamp).toLocaleString('ru-RU')}</li>
          <li><strong>Метод:</strong> анализ отношения STR-гомозиготности</li>
          <li><strong>Порог деградации:</strong> 70%</li>
          {confidenceInterval && <li><strong>Статистическая достоверность:</strong> 95%</li>}
        </ul>
      </div>
    </div>
  );
};

export default DegradationIndicator;
