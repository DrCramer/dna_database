/**
 * Quality Results Component
 *
 * Displays quality analysis results with color coding
 * Requirements: 9.2 - Color coding for results (green/yellow/red/gray)
 */

import React, { useCallback } from 'react';

const QualityResults = ({ results, onShowHelp }) => {
    // Get color from results or fallback to classification-based color
    const getResultColor = (result, fallbackClassification, colorGetter) => {
        if (result && result.colorCode) {
            return result.colorCode;
        }
        return colorGetter(fallbackClassification);
    };

    // Get color for PCI classification
    const getPCIColor = (classification) => {
        const lowerClass = classification?.toLowerCase() || '';
        if (lowerClass.includes('полный') || lowerClass.includes('complete')) return '#2d8f2d'; // green
        if (lowerClass.includes('умеренно') || lowerClass.includes('moderate')) return '#f39c12'; // yellow
        if (lowerClass.includes('сильно') || lowerClass.includes('severe')) return '#e67e22'; // orange
        if (lowerClass.includes('критически') || lowerClass.includes('critical')) return '#e74c3c'; // red
        return '#95a5a6'; // gray
    };

    // Get color for degradation classification
    const getDegradationColor = (classification) => {
        const lowerClass = classification?.toLowerCase() || '';
        if (lowerClass.includes('минимальная') || lowerClass.includes('minimal')) return '#2d8f2d'; // green
        if (lowerClass.includes('умеренная') || lowerClass.includes('moderate')) return '#f39c12'; // yellow
        if (lowerClass.includes('сильная') || lowerClass.includes('severe')) return '#e74c3c'; // red
        return '#95a5a6'; // gray
    };

    // Get color for perspective category
    const getPerspectiveColor = (category) => {
        const lowerCat = category?.toLowerCase() || '';
        if (lowerCat.includes('высокая') || lowerCat.includes('high')) return '#2d8f2d'; // green
        if (lowerCat.includes('средняя') || lowerCat.includes('medium')) return '#f39c12'; // yellow
        if (lowerCat.includes('низкая') || lowerCat.includes('low')) return '#e67e22'; // orange
        if (lowerCat.includes('загрязненный') || lowerCat.includes('contaminated')) return '#e74c3c'; // red
        return '#95a5a6'; // gray
    };

    // Get contamination status color
    const getContaminationColor = (isContaminated) => {
        return isContaminated ? '#e74c3c' : '#2d8f2d'; // red : green
    };

    // Format percentage
    const formatPercentage = useCallback((value) => {
        if (value === null || value === undefined || isNaN(value)) {
            return '0.0%';
        }
        return `${(value * 100).toFixed(1)}%`;
    }, []);

    // Format number with precision
    const formatNumber = useCallback((value, precision = 3) => {
        if (value === null || value === undefined || isNaN(value)) {
            return '0.000';
        }
        return value.toFixed(precision);
    }, []);

    return (
        <div className="quality-results">
            <div className="results-header">
                <h3>Результаты анализа качества</h3>
                <div className="sample-info">
                    <div className="sample-identifiers">
                        <span className="sample-item primary">
                            <span className="sample-icon">🧬</span>
                            <span className="sample-value">{results.sampleId}</span>
                        </span>
                        {results.sampleName && results.sampleName !== results.sampleId && (
                            <>
                                <span className="sample-separator">•</span>
                                <span className="sample-item secondary">
                                    <span className="sample-icon">📋</span>
                                    <span className="sample-value">{results.sampleName}</span>
                                </span>
                            </>
                        )}
                        {results.import_number && (
                            <>
                                <span className="sample-separator">•</span>
                                <span className="sample-item batch">
                                    <span className="sample-icon">🚚</span>
                                    <span className="sample-value">{results.import_number}</span>
                                </span>
                            </>
                        )}
                    </div>
                    <div className="analysis-metadata">
                        <span className="analysis-date">
                            Дата анализа: {results.analysisDate.toLocaleString('ru-RU')}
                        </span>
                    </div>
                </div>
            </div>

            <div className="results-grid">
                {/* PCI Results */}
                <div className="result-card">
                    <div className="card-header">
                        <h4>Индекс полноты профиля (PCI)</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('pci')}
                            title="Справка по PCI"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="card-content">
                        <div className="main-metric">
                            <span
                                className="metric-value"
                                style={{ color: getResultColor(results.pci, results.pci.classification, getPCIColor) }}
                            >
                                {results.pci.percentage}%
                            </span>
                            <span
                                className="metric-label"
                                style={{ color: getResultColor(results.pci, results.pci.classification, getPCIColor) }}
                            >
                                {results.pci.classification}
                            </span>
                        </div>
                        <div className="metric-details">
                            <div className="detail-row">
                                <span>Проанализированные локусы:</span>
                                <span>{results.pci.analyzedLoci}</span>
                            </div>
                            <div className="detail-row">
                                <span>Общее количество локусов:</span>
                                <span>{results.pci.totalLoci}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Heterozygosity Results */}
                <div className="result-card">
                    <div className="card-header">
                        <h4>Анализ гетерозиготности</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('heterozygosity')}
                            title="Справка по гетерозиготности"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="card-content">
                        <div className="metric-pair">
                            <div className="metric-item">
                                <span className="metric-value">
                                    {formatPercentage(results.heterozygosity.observedHeterozygosity)}
                                </span>
                                <span className="metric-label">Наблюдаемая</span>
                            </div>
                            <div className="metric-item">
                                <span className="metric-value">
                                    {formatPercentage(results.heterozygosity.expectedHeterozygosity)}
                                </span>
                                <span className="metric-label">Ожидаемая</span>
                            </div>
                        </div>
                        <div className="metric-details">
                            <div className="detail-row">
                                <span>Гетерозиготные локусы:</span>
                                <span>{results.heterozygosity.heterozygousLoci}</span>
                            </div>
                            <div className="detail-row">
                                <span>Проанализированные локусы:</span>
                                <span>{results.heterozygosity.analyzedLoci}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Degradation Results */}
                <div className="result-card">
                    <div className="card-header">
                        <h4>Индекс деградации</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('degradation')}
                            title="Справка по деградации"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="card-content">
                        <div className="main-metric">
                            <span className="metric-value">
                                {formatNumber(results.degradation.degradationValue)}
                            </span>
                            <span
                                className="metric-label"
                                style={{ color: getDegradationColor(results.degradation.classification) }}
                            >
                                {results.degradation.classification}
                            </span>
                        </div>
                        {results.degradation.affectedLoci.length > 0 && (
                            <div className="metric-details">
                                <div className="detail-row">
                                    <span>Затронутые локусы:</span>
                                    <span>{results.degradation.affectedLoci.join(', ')}</span>
                                </div>
                            </div>
                        )}
                        <div className="recommendations">
                            {results.degradation.recommendations.map((rec, index) => (
                                <div key={index} className="recommendation">
                                    {rec}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Contamination Results */}
                <div className="result-card">
                    <div className="card-header">
                        <h4>Контаминация сотрудников</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('contamination')}
                            title="Справка по контаминации"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="card-content">
                        <div className="main-metric">
                            <span
                                className="metric-value"
                                style={{ color: getContaminationColor(results.contamination.isContaminated) }}
                            >
                                {results.contamination.isContaminated ? 'ОБНАРУЖЕНА' : 'НЕ ОБНАРУЖЕНА'}
                            </span>
                        </div>
                        {results.contamination.isContaminated && (
                            <div className="metric-details">
                                <div className="detail-row">
                                    <span>Подозреваемый сотрудник:</span>
                                    <span>{results.contamination.suspectedStaff}</span>
                                </div>
                                <div className="detail-row">
                                    <span>Совпадающие локусы:</span>
                                    <span>{results.contamination.matchingLoci}</span>
                                </div>
                            </div>
                        )}
                        {results.contamination.mixtureSuspicion && (
                            <div className="warning-message">
                                <span>⚠️ Подозрение на смесь</span>
                                {results.contamination.triAllelicLoci.length > 0 && (
                                    <div className="detail-row">
                                        <span>Триаллельные локусы:</span>
                                        <span>{results.contamination.triAllelicLoci.join(', ')}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Duplicates Results */}
                <div className="result-card">
                    <div className="card-header">
                        <h4>Поиск дубликатов</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('duplicates')}
                            title="Справка по дубликатам"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="card-content">
                        <div className="main-metric">
                            <span className="metric-value">
                                {results.duplicates.potentialDuplicates.length}
                            </span>
                            <span className="metric-label">потенциальных дубликатов</span>
                        </div>
                        <div className="metric-details">
                            <div className="detail-row">
                                <span>Проверено образцов:</span>
                                <span>{results.duplicates.searchedSamples}</span>
                            </div>
                        </div>
                        {results.duplicates.potentialDuplicates.length > 0 && (
                            <div className="duplicates-list">
                                {results.duplicates.potentialDuplicates.map((duplicate, index) => (
                                    <div key={index} className="duplicate-item">
                                        <span className="duplicate-id">{duplicate.sampleId}</span>
                                        <span className="duplicate-match">
                                            {duplicate.matchPercentage ? duplicate.matchPercentage.toFixed(1) : '0.0'}%
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Perspective Category Results */}
                <div className="result-card perspective-card">
                    <div className="card-header">
                        <h4>Категория перспективности</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('perspective')}
                            title="Справка по категориям"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="card-content">
                        <div className="main-metric">
                            <span
                                className="metric-value large"
                                style={{ color: getPerspectiveColor(results.perspectiveCategory.category) }}
                            >
                                {results.perspectiveCategory.category}
                            </span>
                        </div>
                        <div className="reasoning-section">
                            <h5>Обоснование:</h5>
                            <ul className="reasoning-list">
                                {results.perspectiveCategory.reasoning.map((reason, index) => (
                                    <li key={index}>{reason}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="recommendations-section">
                            <h5>Рекомендации:</h5>
                            <ul className="recommendations-list">
                                {results.perspectiveCategory.recommendations.map((rec, index) => (
                                    <li key={index}>{rec}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QualityResults;