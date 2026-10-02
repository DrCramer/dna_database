import React, { useEffect, useState } from 'react';
import { bayesianService } from '../../services/bayesianService';

const PopulationEditor = ({ population, onSave, onCancel, onError }) => {
  const [formData, setFormData] = useState({
    populationId: '',
    name: '',
    sampleSize: '',
    inbreedingCoefficient: '0.0',
    loci: []
  });
  const [validationErrors, setValidationErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [currentLocus, setCurrentLocus] = useState({
    locusName: '',
    frequencies: {},
    sampleSize: ''
  });
  const [showAddLocus, setShowAddLocus] = useState(false);
  const [editingLocusIndex, setEditingLocusIndex] = useState(-1);

  const isEditing = Boolean(population);

  useEffect(() => {
    if (!population) {
      return;
    }

    const loci = population.locusFrequencies
      ? Object.entries(population.locusFrequencies).map(([locusName, data]) => ({
          locusName,
          frequencies: data.frequencies instanceof Map ? Object.fromEntries(data.frequencies) : data.frequencies,
          sampleSize: data.sampleSize || population.sampleSize
        }))
      : [];

    setFormData({
      populationId: population.populationId || '',
      name: population.name || '',
      sampleSize: population.sampleSize?.toString() || '',
      inbreedingCoefficient: population.inbreedingCoefficient?.toString() || '0.0',
      loci
    });
  }, [population]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value
    }));
    setValidationErrors([]);
  };

  const handleAddLocus = () => {
    setCurrentLocus({
      locusName: '',
      frequencies: {},
      sampleSize: formData.sampleSize
    });
    setEditingLocusIndex(-1);
    setShowAddLocus(true);
  };

  const handleEditLocus = (index) => {
    setCurrentLocus({ ...formData.loci[index] });
    setEditingLocusIndex(index);
    setShowAddLocus(true);
  };

  const handleDeleteLocus = (index) => {
    if (!window.confirm('Удалить этот локус из справочника?')) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      loci: prev.loci.filter((_, locusIndex) => locusIndex !== index)
    }));
  };

  const handleLocusChange = (field, value) => {
    setCurrentLocus((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const handleFrequencyChange = (allele, frequency) => {
    const parsedFrequency = parseFloat(frequency) || 0;
    setCurrentLocus((prev) => ({
      ...prev,
      frequencies: {
        ...prev.frequencies,
        [allele]: parsedFrequency
      }
    }));
  };

  const handleAddAllele = () => {
    const allele = window.prompt('Введите название аллеля:');
    if (allele && allele.trim()) {
      handleFrequencyChange(allele.trim(), '0.0');
    }
  };

  const handleDeleteAllele = (allele) => {
    setCurrentLocus((prev) => {
      const frequencies = { ...prev.frequencies };
      delete frequencies[allele];
      return {
        ...prev,
        frequencies
      };
    });
  };

  const calculateFrequencySum = (frequencies) =>
    Object.values(frequencies).reduce((sum, frequency) => sum + frequency, 0);

  const handleSaveLocus = () => {
    const errors = [];

    if (!currentLocus.locusName.trim()) {
      errors.push('Не указано имя локуса');
    }

    if (Object.keys(currentLocus.frequencies).length === 0) {
      errors.push('Добавьте хотя бы одну частоту аллеля');
    }

    const frequencySum = calculateFrequencySum(currentLocus.frequencies);
    if (Math.abs(frequencySum - 1.0) > 0.01) {
      errors.push(`Сумма частот должна быть равна 1.0 (сейчас: ${frequencySum.toFixed(3)})`);
    }

    if (errors.length > 0) {
      window.alert(`Ошибки валидации:\n${errors.join('\n')}`);
      return;
    }

    if (editingLocusIndex >= 0) {
      setFormData((prev) => ({
        ...prev,
        loci: prev.loci.map((locus, index) => (index === editingLocusIndex ? currentLocus : locus))
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        loci: [...prev.loci, currentLocus]
      }));
    }

    setShowAddLocus(false);
    setCurrentLocus({
      locusName: '',
      frequencies: {},
      sampleSize: formData.sampleSize
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validation = bayesianService.validatePopulationData(formData);
    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      return;
    }

    setSaving(true);
    try {
      await onSave(formData);
    } catch (error) {
      onError(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="population-section">
      <h3 className="population-section-title">
        {isEditing ? 'Редактирование популяционного справочника' : 'Создание популяционного справочника'}
      </h3>

      <form onSubmit={handleSubmit} className="population-section">
        <section className="card">
          <div className="card-header">
            <h4>Основная информация</h4>
          </div>

          <div className="population-form-grid">
            <div className="form-group">
              <label className="form-label required">Идентификатор популяции</label>
              <input
                type="text"
                value={formData.populationId}
                onChange={(event) => handleInputChange('populationId', event.target.value)}
                placeholder="Например: EUR_1000G, AFR_HAPMAP"
                className="form-input"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label required">Название популяции</label>
              <input
                type="text"
                value={formData.name}
                onChange={(event) => handleInputChange('name', event.target.value)}
                placeholder="Например: Европейская (1000 Genomes)"
                className="form-input"
                required
              />
            </div>
          </div>

          <div className="population-form-grid">
            <div className="form-group">
              <label className="form-label required">Объем выборки</label>
              <input
                type="number"
                min="1"
                value={formData.sampleSize}
                onChange={(event) => handleInputChange('sampleSize', event.target.value)}
                placeholder="Например: 1000"
                className="form-input"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Коэффициент инбридинга (0.0 - 0.3)</label>
              <input
                type="number"
                min="0"
                max="0.3"
                step="0.001"
                value={formData.inbreedingCoefficient}
                onChange={(event) => handleInputChange('inbreedingCoefficient', event.target.value)}
                className="form-input"
              />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="population-loci-header">
            <h4 className="population-section-title">Локусы ({formData.loci.length})</h4>
            <button type="button" className="btn btn-success btn-sm" onClick={handleAddLocus}>
              Добавить локус
            </button>
          </div>

          {formData.loci.length === 0 ? (
            <div className="table-empty">Пока локусы не добавлены. Нажмите «Добавить локус» для начала работы.</div>
          ) : (
            <div className="population-loci-list">
              {formData.loci.map((locus, index) => {
                const frequencySum = calculateFrequencySum(locus.frequencies);
                const isValidSum = Math.abs(frequencySum - 1.0) <= 0.01;

                return (
                  <div
                    key={`${locus.locusName}-${index}`}
                    className={`population-locus-row ${isValidSum ? '' : 'is-invalid'}`}
                  >
                    <div className="population-locus-row-header">
                      <div>
                        <strong>{locus.locusName}</strong>
                        <div className="population-locus-row-meta">
                          <span>Аллелей: {Object.keys(locus.frequencies).length}</span>
                          <span className={`population-frequency-sum ${isValidSum ? 'is-valid' : 'is-invalid'}`}>
                            Сумма: {frequencySum.toFixed(3)}
                          </span>
                        </div>
                      </div>

                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleEditLocus(index)}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteLocus(index)}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>

                    <div className="population-alleles-grid">
                      {Object.entries(locus.frequencies).map(([allele, frequency]) => (
                        <span key={allele} className="population-allele-chip">
                          {allele}: {frequency.toFixed(3)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {validationErrors.length > 0 && (
          <div className="alert alert-danger">
            <div className="alert-content">
              <div className="alert-title">Ошибки валидации</div>
              <ul className="alert-message">
                {validationErrors.map((error, index) => (
                  <li key={`error-${index}`}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || formData.loci.length === 0}>
            {saving ? 'Сохранение...' : isEditing ? 'Сохранить изменения' : 'Создать справочник'}
          </button>
        </div>
      </form>

      {showAddLocus && (
        <div className="modal-overlay">
          <div className="modal-content modal-md">
            <div className="modal-header">
              <h3>{editingLocusIndex >= 0 ? 'Редактирование локуса' : 'Добавление локуса'}</h3>
              <button
                type="button"
                className="close-button"
                onClick={() => setShowAddLocus(false)}
                aria-label="Закрыть окно"
              >
                ×
              </button>
            </div>

            <div className="modal-body population-editor-modal">
              <div className="form-group">
                <label className="form-label required">Имя локуса</label>
                <input
                  type="text"
                  value={currentLocus.locusName}
                  onChange={(event) => handleLocusChange('locusName', event.target.value)}
                  placeholder="Например: D3S1358, vWA, FGA"
                  className="form-input"
                />
              </div>

              <div className="population-loci-header">
                <label className="form-label">Частоты аллелей</label>
                <button type="button" className="btn btn-success btn-sm" onClick={handleAddAllele}>
                  Добавить аллель
                </button>
              </div>

              <div className="population-editor-frequency-list">
                {Object.keys(currentLocus.frequencies).length === 0 ? (
                  <div className="table-empty">Пока не добавлено ни одного аллеля. Нажмите «Добавить аллель».</div>
                ) : (
                  Object.entries(currentLocus.frequencies).map(([allele, frequency]) => (
                    <div key={allele} className="population-editor-frequency-row">
                      <strong>{allele}</strong>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.001"
                        value={frequency}
                        onChange={(event) => handleFrequencyChange(allele, event.target.value)}
                        className="form-input"
                      />
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteAllele(allele)}
                      >
                        Удалить
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div
                className={`population-frequency-sum ${
                  Math.abs(calculateFrequencySum(currentLocus.frequencies) - 1.0) <= 0.01 ? 'is-valid' : 'is-invalid'
                }`}
              >
                Сумма: {calculateFrequencySum(currentLocus.frequencies).toFixed(3)}
              </div>
              <div className="population-editor-help">
                Для корректного локуса сумма частот всех аллелей должна быть равна 1.0.
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAddLocus(false)}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSaveLocus}>
                {editingLocusIndex >= 0 ? 'Сохранить локус' : 'Добавить локус'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PopulationEditor;
