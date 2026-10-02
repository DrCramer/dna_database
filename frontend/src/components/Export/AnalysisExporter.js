import React, { useState } from 'react';
import { exportService } from '../../services/exportService';

const AnalysisExporter = ({ results, analysisType, onClose }) => {
  const [exportFormat, setExportFormat] = useState('excel');
  const [exportOptions, setExportOptions] = useState({
    includeMetadata: true,
    includeLocusDetails: true,
    includeConfidenceIntervals: true,
    includeRecommendations: true,
    includeTimestamp: true
  });
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const prepareExportData = () => {
    const baseData = {
      analysisType,
      exportTimestamp: new Date().toISOString(),
      results: { ...results }
    };

    baseData.exportOptions = {
      includeMetadata: exportOptions.includeMetadata,
      includeLocusDetails: exportOptions.includeLocusDetails,
      includeConfidenceIntervals: exportOptions.includeConfidenceIntervals,
      includeRecommendations: exportOptions.includeRecommendations,
      includeTimestamp: exportOptions.includeTimestamp
    };

    if (results.analysisTimestamp) {
      baseData.analysisTimestamp = results.analysisTimestamp;
    }

    if (results.populationUsed) {
      baseData.populationUsed = results.populationUsed;
    }

    return baseData;
  };

  const handleExport = async () => {
    if (!results) {
      setError('Нет данных для экспорта');
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const exportData = prepareExportData();

      switch (exportFormat) {
        case 'excel':
          await exportService.exportToExcel(exportData, `${analysisType}_analysis_${Date.now()}.xlsx`);
          break;
        case 'csv':
          await exportService.exportToCSV(exportData, `${analysisType}_analysis_${Date.now()}.csv`);
          break;
        case 'json':
          await exportService.exportToJSON(exportData, `${analysisType}_analysis_${Date.now()}.json`);
          break;
        case 'pdf':
          await exportService.exportToPDF(exportData, `${analysisType}_analysis_${Date.now()}.pdf`);
          break;
        default:
          throw new Error('Неподдерживаемый формат экспорта');
      }

      if (onClose) {
        onClose();
      }
    } catch (err) {
      setError(`Не удалось выполнить экспорт: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const getFormatDescription = (format) => {
    const descriptions = {
      excel: 'Таблица Excel с отдельными листами для разных типов данных.',
      csv: 'CSV-файл для последующего анализа и импорта в сторонние системы.',
      json: 'JSON-формат для интеграции и программной обработки.',
      pdf: 'Готовый PDF-отчет с оформленными результатами.'
    };
    return descriptions[format] || '';
  };

  const getAnalysisTypeLabel = (type) => {
    const labels = {
      compare: 'Сравнение профилей (LR)',
      contamination: 'Проверка на контаминацию',
      degradation: 'Оценка деградации',
      duplicates: 'Поиск дубликатов'
    };
    return labels[type] || type;
  };

  const estimateFileSize = () => {
    const jsonSize = JSON.stringify(prepareExportData()).length;
    const multipliers = {
      json: 1,
      csv: 0.8,
      excel: 1.5,
      pdf: 2.0
    };
    return Math.round((jsonSize * (multipliers[exportFormat] || 1)) / 1024);
  };

  const renderExportPreview = () => {
    if (!results) {
      return null;
    }

    return (
      <div className="analysis-detail-card">
        <div className="analysis-mini-label">Предпросмотр экспорта</div>
        <ul className="analysis-list">
          <li><strong>Тип анализа:</strong> {getAnalysisTypeLabel(analysisType)}</li>
          {results.profiles && (
            <li>
              <strong>Профили:</strong>{' '}
              {results.profiles.profile1
                ? `${results.profiles.profile1.sampleName} vs ${results.profiles.profile2.sampleName}`
                : results.profile
                  ? results.profile.sampleName
                  : 'Нет данных'}
            </li>
          )}
          {results.analysis && (
            <li>
              <strong>Ключевой результат:</strong>{' '}
              {results.analysis.overallLR
                ? `LR: ${results.analysis.overallLR.toExponential(2)}`
                : results.analysis.isContaminated !== undefined
                  ? `Контаминация: ${results.analysis.isContaminated ? 'да' : 'нет'}`
                  : results.analysis.degradationIndex
                    ? `Деградация: ${(results.analysis.degradationIndex * 100).toFixed(1)}%`
                    : results.duplicates
                      ? `Найдено возможных дубликатов: ${results.duplicates.length}`
                      : 'Анализ завершен'}
            </li>
          )}
          <li><strong>Формат файла:</strong> {exportFormat.toUpperCase()}</li>
          <li><strong>Оценочный размер:</strong> {estimateFileSize()} КБ</li>
        </ul>
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content modal-md">
        <div className="modal-header">
          <h3>Экспорт результатов анализа</h3>
          <button type="button" className="close-button" onClick={onClose} aria-label="Закрыть окно">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="population-section">
            <section className="card">
              <div className="card-header">
                <h4>Формат файла</h4>
              </div>
              <div className="population-preview-list">
                {['excel', 'csv', 'json', 'pdf'].map((format) => (
                  <label
                    key={format}
                    className={`population-preview-card export-format-card ${exportFormat === format ? 'is-selected' : ''}`}
                  >
                    <div className="population-import-radio">
                      <input
                        type="radio"
                        value={format}
                        checked={exportFormat === format}
                        onChange={(event) => setExportFormat(event.target.value)}
                      />
                      <strong>{format.toUpperCase()}</strong>
                    </div>
                    <div className="population-preview-meta">{getFormatDescription(format)}</div>
                  </label>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h4>Параметры экспорта</h4>
              </div>
              <div className="population-section">
                {Object.entries({
                  includeMetadata: 'Включить метаданные анализа',
                  includeLocusDetails: 'Включить детализацию по локусам',
                  includeConfidenceIntervals: 'Включить доверительные интервалы и статистику',
                  includeRecommendations: 'Включить рекомендации',
                  includeTimestamp: 'Добавить время экспорта'
                }).map(([key, label]) => (
                  <label key={key} className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={exportOptions[key]}
                      onChange={(event) =>
                        setExportOptions((prev) => ({
                          ...prev,
                          [key]: event.target.checked
                        }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </section>

            {renderExportPreview()}

            {error && (
              <div className="alert alert-danger">
                <div className="alert-content">
                  <div className="alert-title">Ошибка</div>
                  <p className="alert-message">{error}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={exporting}>
            Отмена
          </button>
          <button type="button" className="btn btn-success" onClick={handleExport} disabled={exporting || !results}>
            {exporting ? 'Экспорт...' : `Экспорт в ${exportFormat.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnalysisExporter;
