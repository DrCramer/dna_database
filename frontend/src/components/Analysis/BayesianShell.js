import PageHeader from '../Layout/PageHeader';
import React from 'react';
import BayesianAnalysisApp from './Bayesian/BayesianAnalysisApp';

const BayesianShell = ({ onNavigate }) => {
  return (
    <div className="legacy-page-shell bayesian-page-shell">
      <PageHeader title="Байесовский анализ" description="Сравнение генотипов и контроль качества образцов." actions={<button onClick={() => onNavigate('/dashboard')} className="btn btn-secondary">На главную</button>} />

      <div className="bayesian-page-panel">
        <BayesianAnalysisApp />
      </div>
    </div>
  );
};

export default BayesianShell;
