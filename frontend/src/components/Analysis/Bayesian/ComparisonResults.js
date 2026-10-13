/**
 * Comparison Results Component
 *
 * Displays genotype comparison results with detailed locus-by-locus tables
 * Requirements: 9.3 - Detailed comparison tables by locus
 */

import React, { useState, useCallback } from 'react';

const ComparisonResults = ({ results, onShowHelp }) => {
    const [showDetailedTable, setShowDetailedTable] = useState(false);
    const [sortBy, setSortBy] = useState('locusName');
    const [sortOrder, setSortOrder] = useState('asc');

    // Get color for match type
    const getMatchColor = (matchType) => {
        switch (matchType) {
            case 'полное совпадение': return '#2d8f2d'; // green
            case 'частичное совпадение': return '#f39c12'; // yellow
            case 'несовпадение': return '#e74c3c'; // red
            default: return '#95a5a6'; // gray
        }
    };

    // Get color for significance level
    const getSignificanceColor = (significance) => {
        switch (significance) {
            case 'VERY_STRONG': return '#2d8f2d'; // green
            case 'STRONG': return '#27ae60'; // light green
            case 'MODERATE': return '#f39c12'; // yellow
            case 'WEAK': return '#e67e22'; // orange
            case 'VERY_WEAK': return '#e74c3c'; // red
            default: return '#95a5a6'; // gray
        }
    };

    // Format scientific notation
    const formatScientific = useCallback((value) => {
        if (value === undefined || value === null || isNaN(value)) {
            return 'N/A';
        }
        const numValue = Number(value);
        if (numValue >= 1e6) {
            return numValue.toExponential(2);
        }
        return numValue.toLocaleString('ru-RU');
    }, []);

    // Format percentage
    const formatPercentage = useCallback((value) => {
        if (value === undefined || value === null || isNaN(value)) {
            return 'N/A';
        }
        return `${Number(value).toFixed(2)}%`;
    }, []);

    // Sort locus comparisons
    const sortedComparisons = React.useMemo(() => {
        if (!results.locusComparisons || !Array.isArray(results.locusComparisons)) {
            return [];
        }
        const sorted = [...results.locusComparisons].sort((a, b) => {
            let aValue = a[sortBy];
            let bValue = b[sortBy];

            if (sortBy === 'locusLR') {
                aValue = parseFloat(aValue) || 0;
                bValue = parseFloat(bValue) || 0;
            }

            if (sortOrder === 'asc') {
                return aValue > bValue ? 1 : -1;
            } else {
                return aValue < bValue ? 1 : -1;
            }
        });
        return sorted;
    }, [results.locusComparisons, sortBy, sortOrder]);

    // Handle sort change
    const handleSort = useCallback((column) => {
        if (sortBy === column) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortOrder('asc');
        }
    }, [sortBy, sortOrder]);

    // Toggle detailed table
    const toggleDetailedTable = useCallback(() => {
        setShowDetailedTable(prev => !prev);
    }, []);

    // Get comparison type display name
    const getComparisonTypeDisplay = (type) => {
        switch (type) {
            case 'sample-vs-sample': return 'Образец vs Образец';
            case 'sample-vs-reference': return 'Образец vs Эталон';
            case 'database-search': return 'Поиск в базе данных';
            default: return type;
        }
    };

    return (
        <div className="comparison-results">
            <div className="results-header">
                <h3>Результаты сравнения генотипов</h3>
                <div className="comparison-info">
                    <span className="comparison-type">
                        Тип: {getComparisonTypeDisplay(results.comparisonType)}
                    </span>
                    <span className="comparison-samples">
                        {results.sample1Id || 'N/A'} vs {results.sample2Id || 'N/A'}
                    </span>
                    <span className="analysis-date">
                        {results.calculationMetadata?.timestamp
                            ? new Date(results.calculationMetadata.timestamp).toLocaleString('ru-RU')
                            : 'N/A'}
                    </span>
                </div>
            </div>

            <div className="results-summary">
                {/* Overall Match Statistics */}
                <div className="summary-card">
                    <div className="card-header">
                        <h4>Общая статистика совпадений</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('match-statistics')}
                            title="Справка по статистике"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="card-content">
                        <div className="match-overview">
                            <div className="match-percentage">
                                <span className="percentage-value">
                                    {formatPercentage(results.overallMatch?.matchPercentage)}
                                </span>
                                <span className="percentage-label">общее совпадение</span>
                            </div>
                            <div className="match-breakdown">
                                <div className="match-item">
                                    <span className="match-count" style={{ color: '#2d8f2d' }}>
                                        {results.overallMatch?.fullMatches || 0}
                                    </span>
                                    <span className="match-label">полных</span>
                                </div>
                                <div className="match-item">
                                    <span className="match-count" style={{ color: '#f39c12' }}>
                                        {results.overallMatch?.partialMatches || 0}
                                    </span>
                                    <span className="match-label">частичных</span>
                                </div>
                                <div className="match-item">
                                    <span className="match-count" style={{ color: '#e74c3c' }}>
                                        {results.overallMatch?.noMatches || 0}
                                    </span>
                                    <span className="match-label">несовпадений</span>
                                </div>
                            </div>
                        </div>
                        <div className="loci-info">
                            <span>Всего локусов: {results.overallMatch?.totalLoci || 0}</span>
                        </div>
                    </div>
                </div>

                {/* Statistical Significance */}
                <div className="summary-card">
                    <div className="card-header">
                        <h4>Статистическая значимость</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('likelihood-ratio')}
                            title="Справка по LR"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="card-content">
                        <div className="lr-section">
                            <div className="lr-value">
                                <span className="metric-label">Likelihood Ratio:</span>
                                <span className="metric-value">
                                    {formatScientific(results.likelihoodRatio)}
                                </span>
                            </div>
                            <div className="match-probability">
                                <span className="metric-label">Вероятность совпадения:</span>
                                <span className="metric-value">
                                    {formatPercentage(results.matchProbability)}
                                </span>
                            </div>
                            <div className="significance-level">
                                <span className="metric-label">Уровень значимости:</span>
                                <span
                                    className="metric-value"
                                    style={{ color: getSignificanceColor(results.significance) }}
                                >
                                    {results.significance}
                                </span>
                            </div>
                        </div>
                        {results.confidenceInterval && (
                            <div className="confidence-interval">
                                <span className="metric-label">95% доверительный интервал:</span>
                                <span className="metric-value">
                                    [{formatScientific(results.confidenceInterval[0])} - {formatScientific(results.confidenceInterval[1])}]
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Calculation Metadata */}
                <div className="summary-card">
                    <div className="card-header">
                        <h4>Метаданные расчета</h4>
                    </div>
                    <div className="card-content">
                        <div className="metadata-grid">
                            <div className="metadata-item">
                                <span className="metadata-label">Метод:</span>
                                <span className="metadata-value">{results.calculationMetadata?.method || 'N/A'}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Популяция:</span>
                                <span className="metadata-value">{results.populationUsed || 'N/A'}</span>
                            </div>
                            <div className="metadata-item">
                                <span className="metadata-label">Общие локусы:</span>
                                <span className="metadata-value">{results.calculationMetadata?.commonLoci || 0}</span>
                            </div>
                        </div>
                        {results.calculationMetadata?.warnings && results.calculationMetadata.warnings.length > 0 && (
                            <div className="warnings-section">
                                <h5>Предупреждения:</h5>
                                <ul>
                                    {results.calculationMetadata.warnings.map((warning, index) => (
                                        <li key={index} className="warning-item">{warning}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Detailed Locus Comparison Table */}
            <div className="detailed-comparison-section">
                <div className="section-header">
                    <h4>Детальное сравнение по локусам</h4>
                    <button
                        className="toggle-button btn btn-secondary"
                        onClick={toggleDetailedTable}
                    >
                        {showDetailedTable ? 'Скрыть таблицу' : 'Показать таблицу'}
                    </button>
                </div>

                {showDetailedTable && (
                    <div className="comparison-table-container">
                        <table className="comparison-table">
                            <thead>
                                <tr>
                                    <th
                                        className={`sortable ${sortBy === 'locusName' ? sortOrder : ''}`}
                                        onClick={() => handleSort('locusName')}
                                    >
                                        Локус
                                    </th>
                                    <th>Образец 1</th>
                                    <th>Образец 2</th>
                                    <th
                                        className={`sortable ${sortBy === 'matchType' ? sortOrder : ''}`}
                                        onClick={() => handleSort('matchType')}
                                    >
                                        Тип совпадения
                                    </th>
                                    <th
                                        className={`sortable ${sortBy === 'locusLR' ? sortOrder : ''}`}
                                        onClick={() => handleSort('locusLR')}
                                    >
                                        LR локуса
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedComparisons.map((comparison, index) => (
                                    <tr key={index}>
                                        <td className="locus-name">{comparison.locusName || 'N/A'}</td>
                                        <td className="alleles">
                                            {comparison.sample1Alleles?.join('/') || 'N/A'}
                                        </td>
                                        <td className="alleles">
                                            {comparison.sample2Alleles?.join('/') || 'N/A'}
                                        </td>
                                        <td
                                            className="match-type"
                                            style={{ color: getMatchColor(comparison.matchType) }}
                                        >
                                            {comparison.matchType || 'N/A'}
                                        </td>
                                        <td className="lr-value">
                                            {comparison.locusLR && comparison.locusLR > 0 ?
                                                formatScientific(comparison.locusLR) :
                                                '—'
                                            }
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Database Search Results (if applicable) */}
            {results.comparisonType === 'database-search' && results.searchResults && (
                <div className="search-results-section">
                    <div className="section-header">
                        <h4>Результаты поиска в базе данных</h4>
                        <button
                            className="help-button btn btn-secondary btn-icon"
                            onClick={() => onShowHelp('database-search')}
                            title="Справка по поиску в БД"
                        >
                            ❓
                        </button>
                    </div>
                    <div className="search-results-list">
                        {results.searchResults && results.searchResults.length > 0 ? (
                            results.searchResults.map((result, index) => (
                                <div key={index} className="search-result-item">
                                    <div className="result-header">
                                        <span className="result-sample" title={result.targetSampleId}>
                                            {result.targetSampleId || 'N/A'}
                                        </span>
                                        <span
                                            className="result-match"
                                            style={{ color: (result.matchPercentage || 0) > 90 ? '#2d8f2d' :
                                                           (result.matchPercentage || 0) > 70 ? '#f39c12' : '#e74c3c' }}
                                        >
                                            {formatPercentage(result.matchPercentage)}
                                        </span>
                                    </div>
                                    <div className="result-details">
                                        <span>LR: {formatScientific(result.likelihoodRatio)}</span>
                                        {result.matchingLoci && result.totalLoci && (
                                            <span style={{ marginLeft: '15px' }}>
                                                Совпадений: {result.matchingLoci}/{result.totalLoci}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="no-results">Совпадений не найдено</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ComparisonResults;