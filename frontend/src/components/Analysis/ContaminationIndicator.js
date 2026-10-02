import React, { useState } from 'react';

const ContaminationIndicator = ({ results }) => {
  const [showDetails, setShowDetails] = useState(false);

  if (!results || !results.analysis) {
    return null;
  }

  const { analysis, profile } = results;
  const { isContaminated, contaminationProbability, flaggedLoci, detectionMethod, confidence } = analysis;

  const getContaminationStatus = () => {
    if (isContaminated) {
      if (contaminationProbability > 0.8) {
        return { status: 'Высокий риск', icon: '⚠️', level: 'danger' };
      }
      if (contaminationProbability > 0.5) {
        return { status: 'Средний риск', icon: '⚡', level: 'warning' };
      }
      return { status: 'Низкий риск', icon: '⚠️', level: 'warning' };
    }
    return { status: 'Признаков контаминации не выявлено', icon: '✅', level: 'success' };
  };

  const status = getContaminationStatus();
  const formatProbability = (value) => `${(value * 100).toFixed(1)}%`;

  const getMethodDescription = (method) => {
    const descriptions = {
      str_multi_allele: 'Обнаружение множественных аллелей STR',
      snp_heterozygosity: 'Избыточная гетерозиготность SNP',
      population_frequency: 'Популяционный частотный анализ'
    };
    return descriptions[method] || method;
  };

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
        <div className="analysis-emphasis">
          Вероятность контаминации: {formatProbability(contaminationProbability)}
        </div>
        <div className="analysis-status-text">Уровень достоверности: {formatProbability(confidence)}</div>
      </div>

      <div className="analysis-detail-card">
        <div className="analysis-mini-label">Шкала риска</div>
        <div className="analysis-badge-grid">
          <span className="analysis-badge success">до 10%: чисто</span>
          <span className="analysis-badge warning">10-50%: низкий риск</span>
          <span className="analysis-badge warning">50-80%: средний риск</span>
          <span className="analysis-badge warning">свыше 80%: высокий риск</span>
        </div>
      </div>

      {detectionMethod && detectionMethod.length > 0 && (
        <div className="analysis-detail-card">
          <div className="analysis-mini-label">Использованные методы</div>
          <div className="analysis-badge-grid">
            {detectionMethod.map((method, index) => (
              <span key={`${method}-${index}`} className="analysis-badge info">
                {getMethodDescription(method)}
              </span>
            ))}
          </div>
        </div>
      )}

      {flaggedLoci && flaggedLoci.length > 0 && (
        <>
          <button
            type="button"
            className="btn btn-tertiary analysis-toggle"
            onClick={() => setShowDetails((prev) => !prev)}
          >
            {showDetails ? 'Скрыть' : 'Показать'} подозрительные локусы ({flaggedLoci.length})
          </button>

          {showDetails && (
            <div className="analysis-flagged-grid">
              {flaggedLoci.map((locus, index) => (
                <div key={`${locus.locusName}-${index}`} className="analysis-flagged-card">
                  <div className="analysis-main-value">{locus.locusName}</div>
                  <div className="analysis-subtle"><strong>Проблема:</strong> {locus.issue || 'Обнаружены признаки контаминации'}</div>
                  {locus.alleleCount && (
                    <div className="analysis-subtle"><strong>Аллелей обнаружено:</strong> {locus.alleleCount}</div>
                  )}
                  {locus.expectedAlleles && (
                    <div className="analysis-subtle"><strong>Ожидалось:</strong> {locus.expectedAlleles}</div>
                  )}
                  {locus.probability && (
                    <div className="analysis-subtle"><strong>Вероятность:</strong> {formatProbability(locus.probability)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="analysis-detail-card">
        <div className="analysis-mini-label">Рекомендации</div>
        {isContaminated ? (
          <ul className="analysis-list">
            <li>Проверьте условия отбора и подготовки образца.</li>
            <li>С осторожностью интерпретируйте результаты по загрязненным локусам.</li>
            <li>Задокументируйте факт контаминации в материалах задачи.</li>
            {contaminationProbability > 0.8 && (
              <li className="analysis-highlight-danger">При высоком риске рассмотрите исключение образца из основного анализа.</li>
            )}
          </ul>
        ) : (
          <ul className="analysis-list">
            <li>Образец не показывает значимых признаков контаминации.</li>
            <li>Можно продолжать стандартный аналитический сценарий.</li>
            <li>Сохраните обычный контроль качества по ходу работы.</li>
          </ul>
        )}
      </div>

      <div className="analysis-detail-card">
        <div className="analysis-mini-label">Детали анализа</div>
        <ul className="analysis-list">
          <li><strong>Популяция:</strong> {results.populationUsed}</li>
          <li><strong>Время анализа:</strong> {new Date(results.analysisTimestamp).toLocaleString('ru-RU')}</li>
          <li><strong>Достоверность детекции:</strong> {formatProbability(confidence)}</li>
        </ul>
      </div>
    </div>
  );
};

export default ContaminationIndicator;
