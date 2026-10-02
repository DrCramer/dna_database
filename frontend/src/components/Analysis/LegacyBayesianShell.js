import React from 'react';
import BayesianAnalysisApp from '../../../../src/components/bayesian/BayesianAnalysisApp';

const LegacyBayesianShell = ({ onNavigate }) => {
  return (
    <div className="legacy-page-shell bayesian-page-shell">
      <div className="legacy-page-card bayesian-page-header">
        <h2 className="legacy-page-title">🧬 Модуль байесовского анализа и сравнения генотипов</h2>
        <div className="legacy-page-actions">
          <button onClick={() => onNavigate('/dashboard')} className="btn btn-secondary">
            🏠 На главную
          </button>
        </div>
      </div>

      <div className="bayesian-page-panel">
        <BayesianAnalysisApp />
      </div>
    </div>
  );
};

export default LegacyBayesianShell;
