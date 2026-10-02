import React, { useEffect, useState } from 'react';
import { bayesianService } from '../../services/bayesianService';
import PopulationList from './PopulationList';
import PopulationEditor from './PopulationEditor';
import PopulationImporter from './PopulationImporter';

const PopulationManager = ({ userRole }) => {
  const [populations, setPopulations] = useState([]);
  const [selectedPopulation, setSelectedPopulation] = useState(null);
  const [currentView, setCurrentView] = useState('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const isAdmin = userRole === 'admin';

  useEffect(() => {
    loadPopulations();
  }, []);

  const loadPopulations = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await bayesianService.getPopulations();
      setPopulations(response.data.populations);
    } catch (err) {
      setError(`Не удалось загрузить справочники популяций: ${err.message}`);
      console.error('Error loading populations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (populationData) => {
    try {
      setError(null);
      await bayesianService.updatePopulation(populationData);
      setSuccessMessage(`Справочник "${populationData.name}" успешно сохранен`);
      await loadPopulations();
      setCurrentView('list');
      setSelectedPopulation(null);
    } catch (err) {
      setError(`Не удалось сохранить справочник: ${err.message}`);
    }
  };

  const handleDelete = async (populationId) => {
    if (!window.confirm('Удалить этот справочник популяции без возможности восстановления?')) {
      return;
    }

    try {
      setError(null);
      await bayesianService.deletePopulation(populationId);
      setSuccessMessage('Справочник популяции удален');
      await loadPopulations();
    } catch (err) {
      setError(`Не удалось удалить справочник: ${err.message}`);
    }
  };

  const handleExport = async (populationId, format = 'json') => {
    try {
      setError(null);
      await bayesianService.exportPopulation(populationId, format);
      setSuccessMessage('Экспорт справочника популяции завершен');
    } catch (err) {
      setError(`Не удалось выгрузить справочник: ${err.message}`);
    }
  };

  const handleImportComplete = async (importResult) => {
    setSuccessMessage(`Импорт завершен: ${importResult.message}`);
    await loadPopulations();
    setCurrentView('list');
  };

  const handleCancel = () => {
    setCurrentView('list');
    setSelectedPopulation(null);
    setError(null);
    setSuccessMessage(null);
  };

  const clearMessages = () => {
    setError(null);
    setSuccessMessage(null);
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case 'edit':
        return (
          <PopulationEditor
            population={selectedPopulation}
            onSave={handleSave}
            onCancel={handleCancel}
            onError={setError}
          />
        );
      case 'import':
        return (
          <PopulationImporter
            onImportComplete={handleImportComplete}
            onCancel={handleCancel}
            onError={setError}
          />
        );
      default:
        return (
          <PopulationList
            populations={populations}
            loading={loading}
            isAdmin={isAdmin}
            onEdit={(population) => {
              setSelectedPopulation(population);
              setCurrentView('edit');
              clearMessages();
            }}
            onDelete={handleDelete}
            onExport={handleExport}
            onRefresh={loadPopulations}
          />
        );
    }
  };

  return (
    <div className="population-page">
      <section className="card population-shell">
        <div className="population-toolbar">
          <div className="page-header">
            <h2 className="page-title">Управление популяционными справочниками</h2>
            <p className="population-subtitle">
              Здесь хранятся частоты аллелей для байесовского анализа и экспертных расчетов.
            </p>
          </div>

          {currentView === 'list' && isAdmin && (
            <div className="population-toolbar-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setCurrentView('import');
                  clearMessages();
                }}
              >
                Импортировать данные
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={() => {
                  setSelectedPopulation(null);
                  setCurrentView('edit');
                  clearMessages();
                }}
              >
                Создать справочник
              </button>
            </div>
          )}

          {currentView !== 'list' && (
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>
              Вернуться к списку
            </button>
          )}
        </div>

        {error && (
          <div className="alert alert-danger alert-dismissible">
            <div className="alert-content">
              <div className="alert-title">Ошибка</div>
              <p className="alert-message">{error}</p>
            </div>
            <button type="button" className="alert-close" onClick={clearMessages} aria-label="Закрыть сообщение">
              ×
            </button>
          </div>
        )}

        {successMessage && (
          <div className="alert alert-success alert-dismissible">
            <div className="alert-content">
              <div className="alert-title">Готово</div>
              <p className="alert-message">{successMessage}</p>
            </div>
            <button type="button" className="alert-close" onClick={clearMessages} aria-label="Закрыть сообщение">
              ×
            </button>
          </div>
        )}

        {!isAdmin && currentView === 'list' && (
          <div className="alert alert-warning">
            <div className="alert-content">
              <div className="alert-title">Только просмотр</div>
              <p className="alert-message population-readonly-note">
                У вас есть доступ только к просмотру справочников популяций. Для изменений обратитесь к администратору.
              </p>
            </div>
          </div>
        )}

        {renderCurrentView()}
      </section>
    </div>
  );
};

export default PopulationManager;
