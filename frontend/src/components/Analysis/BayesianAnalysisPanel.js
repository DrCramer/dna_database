import React, { useEffect, useState } from 'react';
import { bayesianService } from '../../services/bayesianService';
import featureService from '../../services/featureService';
import LRResultsDisplay from './LRResultsDisplay';
import ContaminationIndicator from './ContaminationIndicator';
import DegradationIndicator from './DegradationIndicator';
import ProgressIndicator from './ProgressIndicator';
import ExportButton from '../Export/ExportButton';

const BayesianAnalysisPanel = ({ selectedProfile, profiles, onAnalysisComplete }) => {
  const [analysisType, setAnalysisType] = useState('compare');
  const [compareProfile, setCompareProfile] = useState('');
  const [populationId, setPopulationId] = useState('');
  const [populations, setPopulations] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [isBayesianEnabled, setIsBayesianEnabled] = useState(true);
  const [featureCheckLoading, setFeatureCheckLoading] = useState(true);

  useEffect(() => {
    checkFeatureAvailability();
    loadPopulations();
  }, []);

  const checkFeatureAvailability = async () => {
    try {
      const enabled = await featureService.isBayesianAnalysisEnabled();
      setIsBayesianEnabled(enabled);
    } catch (err) {
      console.warn('Failed to check Bayesian feature availability:', err);
      setIsBayesianEnabled(true);
    } finally {
      setFeatureCheckLoading(false);
    }
  };

  const loadPopulations = async () => {
    try {
      const response = await bayesianService.getPopulations();
      setPopulations(response.data.populations);
      if (response.data.populations.length > 0) {
        setPopulationId(response.data.populations[0].populationId);
      }
    } catch (err) {
      console.error('Failed to load populations:', err);
      setError('Не удалось загрузить популяционные справочники');
    }
  };

  const handleAnalysis = async () => {
    if (!selectedProfile) {
      setError('Сначала выберите профиль для анализа');
      return;
    }

    if (!populationId && analysisType !== 'degradation') {
      setError('Выберите популяционный справочник');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResults(null);
    setAnalysisProgress(0);

    let progressInterval;

    try {
      progressInterval = setInterval(() => {
        setAnalysisProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      let result;

      switch (analysisType) {
        case 'compare':
          if (!compareProfile) {
            throw new Error('Выберите профиль для сравнения');
          }
          result = await bayesianService.compareProfiles(selectedProfile.id, compareProfile, populationId);
          break;
        case 'contamination':
          result = await bayesianService.detectContamination(selectedProfile.id, populationId);
          break;
        case 'degradation':
          result = await bayesianService.assessDegradation(selectedProfile.id);
          break;
        case 'duplicates':
          result = await bayesianService.findDuplicates(selectedProfile.id, populationId, {
            threshold: 0.95,
            limit: 50
          });
          break;
        default:
          throw new Error('Неизвестный тип анализа');
      }

      clearInterval(progressInterval);
      setAnalysisProgress(100);
      setResults(result.data);

      if (onAnalysisComplete) {
        onAnalysisComplete(result.data);
      }
    } catch (err) {
      setError(err.message || 'Ошибка выполнения анализа');
      console.error('Analysis error:', err);
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      setIsAnalyzing(false);
      setTimeout(() => setAnalysisProgress(0), 1000);
    }
  };

  const getAnalysisLabel = () => {
    switch (analysisType) {
      case 'compare':
        return 'сравнительный';
      case 'contamination':
        return 'контаминации';
      case 'degradation':
        return 'деградации';
      case 'duplicates':
        return 'поиска дубликатов';
      default:
        return 'байесовский';
    }
  };

  const renderAnalysisOptions = () => {
    switch (analysisType) {
      case 'compare':
        return (
          <div className="form-group">
            <label className="form-label">Профиль для сравнения</label>
            <select
              value={compareProfile}
              onChange={(event) => setCompareProfile(event.target.value)}
              className="form-select"
            >
              <option value="">Выберите профиль...</option>
              {profiles
                .filter((profile) => profile.id !== selectedProfile?.id)
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.sampleName} {profile.sample_name ? `(${profile.sample_name})` : ''} (ID: {profile.id.substring(0, 8)}...)
                  </option>
                ))}
            </select>
          </div>
        );
      case 'duplicates':
        return (
          <p className="bayesian-option-note">
            Выполняется поиск вероятных дубликатов выбранного профиля в базе данных по заданному порогу совпадения.
          </p>
        );
      case 'contamination':
        return (
          <p className="bayesian-option-note">
            Профиль будет проверен на признаки контаминации с использованием статистических показателей и сравнения локусов.
          </p>
        );
      case 'degradation':
        return (
          <p className="bayesian-option-note">
            Будет оценено качество профиля и степень возможной деградации по информативности локусов.
          </p>
        );
      default:
        return null;
    }
  };

  const renderResults = () => {
    if (!results) {
      return null;
    }

    switch (analysisType) {
      case 'compare':
        return <LRResultsDisplay results={results} />;
      case 'contamination':
        return <ContaminationIndicator results={results} />;
      case 'degradation':
        return <DegradationIndicator results={results} />;
      case 'duplicates':
        return (
          <div className="bayesian-results-card">
            <h4>Результаты поиска дубликатов</h4>
            {results.duplicates && results.duplicates.length > 0 ? (
              <div className="bayesian-results-stack">
                {results.duplicates.map((duplicate, index) => (
                  <div key={`${duplicate.matchedProfile.id}-${index}`} className="bayesian-result-row">
                    <div>
                      <div className="bayesian-result-title">
                        {duplicate.matchedProfile.sampleName} {duplicate.matchedProfile.sample_name ? `(${duplicate.matchedProfile.sample_name})` : ''}
                      </div>
                      <div className="bayesian-result-meta">
                        ID: {duplicate.matchedProfile.id.substring(0, 16)}...
                      </div>
                    </div>

                    <div className="bayesian-result-score">
                      <div className={`bayesian-result-badge ${duplicate.probability > 0.95 ? 'is-high' : 'is-medium'}`}>
                        {(duplicate.probability * 100).toFixed(1)}% совпадение
                      </div>
                      <div className="bayesian-result-lr">
                        LR: {duplicate.lrScore?.toExponential(2) || 'Нет данных'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="bayesian-option-note">Совпадений выше выбранного порога не найдено.</p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  if (featureCheckLoading) {
    return (
      <div className="card bayesian-panel">
        <div className="table-loading">Проверка доступности байесовского анализа...</div>
      </div>
    );
  }

  if (!isBayesianEnabled) {
    return (
      <div className="card bayesian-panel">
        <h3 className="population-section-title">Байесовский анализ</h3>
        <div className="alert alert-warning">
          <div className="alert-content">
            <div className="alert-title">Функция недоступна</div>
            <p className="alert-message">
              Байесовский анализ сейчас отключен. Обратитесь к администратору для включения этой возможности.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card bayesian-panel">
      <h3 className="population-section-title">Байесовский анализ</h3>

      {!selectedProfile ? (
        <div className="table-empty">Выберите ДНК-профиль, чтобы начать байесовский анализ.</div>
      ) : (
        <>
          <div className="bayesian-selected-profile">
            <strong>
              Выбранный профиль: {selectedProfile.sampleName} {selectedProfile.sample_name ? `(${selectedProfile.sample_name})` : ''}
            </strong>
            <div className="bayesian-selected-meta">
              ID: {selectedProfile.id} | STR-локусы: {selectedProfile.strLociCount}/39
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Тип анализа</label>
            <select
              value={analysisType}
              onChange={(event) => {
                setAnalysisType(event.target.value);
                setResults(null);
                setError(null);
              }}
              className="form-select"
            >
              <option value="compare">Сравнение профилей (расчет LR)</option>
              <option value="contamination">Проверка на контаминацию</option>
              <option value="degradation">Оценка деградации</option>
              <option value="duplicates">Поиск дубликатов</option>
            </select>
          </div>

          {renderAnalysisOptions()}

          {analysisType !== 'degradation' && (
            <div className="form-group">
              <label className="form-label">Популяционный справочник</label>
              <select
                value={populationId}
                onChange={(event) => setPopulationId(event.target.value)}
                className="form-select"
              >
                <option value="">Выберите популяцию...</option>
                {populations.map((population) => (
                  <option key={population.populationId} value={population.populationId}>
                    {population.name} (выборка: {population.sampleSize})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={handleAnalysis}
            disabled={isAnalyzing || !selectedProfile || (!populationId && analysisType !== 'degradation')}
          >
            {isAnalyzing ? 'Анализ выполняется...' : `Запустить ${getAnalysisLabel()} анализ`}
          </button>

          {isAnalyzing && (
            <ProgressIndicator progress={analysisProgress} message={`Выполняется ${getAnalysisLabel()} анализ...`} />
          )}

          {error && (
            <div className="alert alert-danger">
              <div className="alert-content">
                <div className="alert-title">Ошибка</div>
                <p className="alert-message">{error}</p>
              </div>
            </div>
          )}

          {renderResults()}

          {results && (
            <div className="bayesian-export">
              <ExportButton results={results} analysisType={analysisType} size="medium" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BayesianAnalysisPanel;
