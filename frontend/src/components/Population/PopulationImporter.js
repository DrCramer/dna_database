import React, { useState } from 'react';
import { bayesianService } from '../../services/bayesianService';

const PopulationImporter = ({ onImportComplete, onCancel, onError }) => {
  const [importMethod, setImportMethod] = useState('json');
  const [fileData, setFileData] = useState(null);
  const [jsonData, setJsonData] = useState('');
  const [importing, setImporting] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [previewData, setPreviewData] = useState(null);

  const validateImportData = (data) => {
    const validation = bayesianService.validatePopulationData(data);
    setValidationResult(validation);
  };

  const parseCSVData = (csvContent) => {
    try {
      const lines = csvContent.split('\n').filter((line) => line.trim());
      if (lines.length < 2) {
        onError('CSV-файл должен содержать строку заголовков и хотя бы одну строку данных.');
        return;
      }

      const headers = lines[0].split(',').map((header) => header.trim());
      const requiredHeaders = ['PopulationID', 'PopulationName', 'SampleSize', 'Locus', 'Allele', 'Frequency'];
      const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

      if (missingHeaders.length > 0) {
        onError(`В CSV отсутствуют обязательные колонки: ${missingHeaders.join(', ')}`);
        return;
      }

      const populationMap = new Map();

      for (let i = 1; i < lines.length; i += 1) {
        const values = lines[i].split(',').map((value) => value.trim());
        if (values.length !== headers.length) {
          continue;
        }

        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index];
        });

        const populationId = row.PopulationID;
        if (!populationMap.has(populationId)) {
          populationMap.set(populationId, {
            populationId,
            name: row.PopulationName,
            sampleSize: parseInt(row.SampleSize, 10) || 1000,
            inbreedingCoefficient: parseFloat(row.InbreedingCoeff || '0.0'),
            loci: []
          });
        }

        const population = populationMap.get(populationId);
        let locus = population.loci.find((item) => item.locusName === row.Locus);

        if (!locus) {
          locus = {
            locusName: row.Locus,
            frequencies: {},
            sampleSize: parseInt(row.SampleSize, 10) || population.sampleSize
          };
          population.loci.push(locus);
        }

        locus.frequencies[row.Allele] = parseFloat(row.Frequency) || 0;
      }

      const populations = Array.from(populationMap.values());
      setPreviewData(populations);
      if (populations.length > 0) {
        validateImportData(populations[0]);
      }
    } catch (error) {
      onError(`Ошибка разбора CSV: ${error.message}`);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const content = loadEvent.target.result;
      setFileData({ name: file.name, content, type: file.type });

      if (file.type === 'application/json' || file.name.endsWith('.json')) {
        setJsonData(content);
        setImportMethod('json');
        try {
          const parsed = JSON.parse(content);
          setPreviewData(parsed);
          validateImportData(parsed);
        } catch (error) {
          onError(`Некорректный JSON: ${error.message}`);
        }
      } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        setImportMethod('csv');
        parseCSVData(content);
      }
    };
    reader.readAsText(file);
  };

  const handleJsonChange = (value) => {
    setJsonData(value);
    try {
      const parsed = JSON.parse(value);
      setPreviewData(parsed);
      validateImportData(parsed);
    } catch (error) {
      setValidationResult({ isValid: false, errors: ['Некорректный JSON-формат'] });
      setPreviewData(null);
    }
  };

  const handleImport = async () => {
    if (!previewData) {
      onError('Нет данных для импорта.');
      return;
    }

    if (validationResult && !validationResult.isValid) {
      onError('Перед импортом исправьте ошибки валидации.');
      return;
    }

    setImporting(true);
    try {
      if (Array.isArray(previewData)) {
        for (const populationData of previewData) {
          await bayesianService.updatePopulation(populationData);
        }
        onImportComplete({ message: `загружено справочников: ${previewData.length}` });
      } else {
        await bayesianService.updatePopulation(previewData);
        onImportComplete({ message: `загружен справочник "${previewData.name}"` });
      }
    } catch (error) {
      onError(`Импорт завершился с ошибкой: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const populations = Array.isArray(previewData) ? previewData : previewData ? [previewData] : [];

  return (
    <div className="population-section">
      <h3 className="population-section-title">Импорт популяционных данных</h3>

      <section className="card">
        <div className="card-header">
          <h4>Источник данных</h4>
        </div>

        <div className="population-import-methods">
          <label className="population-import-radio">
            <input type="radio" value="json" checked={importMethod === 'json'} onChange={(event) => setImportMethod(event.target.value)} />
            JSON
          </label>
          <label className="population-import-radio">
            <input type="radio" value="csv" checked={importMethod === 'csv'} onChange={(event) => setImportMethod(event.target.value)} />
            CSV
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">Файл импорта</label>
          <input type="file" accept={importMethod === 'json' ? '.json' : '.csv'} onChange={handleFileUpload} className="form-input" />
          <div className="form-hint">
            {importMethod === 'json'
              ? 'Загрузите JSON-файл с описанием одной или нескольких популяций.'
              : 'Загрузите CSV с колонками PopulationID, PopulationName, SampleSize, InbreedingCoeff, Locus, Allele, Frequency.'}
          </div>
          {fileData && (
            <div className="population-editor-help">
              Выбран файл: <strong>{fileData.name}</strong>
            </div>
          )}
        </div>
      </section>

      {importMethod === 'json' && (
        <section className="card">
          <div className="card-header">
            <h4>Вставка JSON вручную</h4>
          </div>
          <div className="form-group">
            <label className="form-label">Содержимое JSON</label>
            <textarea
              value={jsonData}
              onChange={(event) => handleJsonChange(event.target.value)}
              className="form-textarea"
              placeholder={`{
  "populationId": "EUR_1000G",
  "name": "Европейская популяция",
  "sampleSize": 1000,
  "inbreedingCoefficient": 0.0,
  "loci": []
}`}
            />
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h4>Требования к формату</h4>
        </div>
        <div className="population-format-note">
          {importMethod === 'json' ? (
            <ul>
              <li>`populationId` должен быть уникальным идентификатором.</li>
              <li>`name` содержит понятное название популяции.</li>
              <li>`sampleSize` задает объем выборки.</li>
              <li>`inbreedingCoefficient` допускает значения от `0.0` до `0.3`.</li>
              <li>Для каждого локуса частоты аллелей должны суммироваться к `1.0`.</li>
            </ul>
          ) : (
            <ul>
              <li>Обязательные колонки: `PopulationID`, `PopulationName`, `SampleSize`, `Locus`, `Allele`, `Frequency`.</li>
              <li>`InbreedingCoeff` необязателен и по умолчанию равен `0.0`.</li>
              <li>Каждая строка CSV описывает одну частоту одного аллеля.</li>
              <li>В одном файле можно загрузить несколько популяций.</li>
            </ul>
          )}
        </div>
      </section>

      {populations.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h4>Предпросмотр импорта</h4>
          </div>
          <div className="population-preview-list">
            {populations.map((population, index) => (
              <div key={`${population.populationId || 'population'}-${index}`} className="population-preview-card">
                <div className="population-preview-header">
                  <strong>{population.name}</strong>
                  <span className="population-badge">{population.populationId}</span>
                </div>
                <div className="population-preview-meta">
                  Выборка: {(population.sampleSize || 0).toLocaleString('ru-RU')} | Инбридинг: {((population.inbreedingCoefficient || 0) * 100).toFixed(1)}% | Локусы: {population.loci?.length || 0}
                </div>
                {population.loci?.length > 0 && (
                  <div className="population-preview-loci">
                    Локусы: {population.loci.slice(0, 5).map((locus) => locus.locusName).join(', ')}
                    {population.loci.length > 5 ? ` и еще ${population.loci.length - 5}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {validationResult && !validationResult.isValid && (
        <div className="alert alert-danger">
          <div className="alert-content">
            <div className="alert-title">Ошибки валидации</div>
            <ul className="alert-message">
              {validationResult.errors.map((error, index) => (
                <li key={`validation-${index}`}>{error}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn-success"
          onClick={handleImport}
          disabled={importing || !previewData || (validationResult && !validationResult.isValid)}
        >
          {importing ? 'Импорт выполняется...' : 'Импортировать данные'}
        </button>
      </div>
    </div>
  );
};

export default PopulationImporter;
