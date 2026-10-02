/**
 * Comparison Reports Component
 * 
 * Provides interface for generating and downloading comparison analysis reports
 * Requirements: 10.1, 10.2, 10.4 - PDF and Excel report generation for comparisons
 */

import React, { useState, useCallback } from 'react';
import './BayesianAnalysis.css';

const ComparisonReports = ({ results, comparisonHistory, onShowHelp }) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [reportType, setReportType] = useState('pdf');
    const [includeDetails, setIncludeDetails] = useState(true);

    // Generate PDF report
    const generatePDFReport = useCallback(async () => {
        setIsGenerating(true);
        try {
            // Simulate PDF generation
            await new Promise(resolve => setTimeout(resolve, 2500));
            
            // In real implementation, would call ReportGenerator service
            const reportData = {
                comparisonType: results.comparisonType,
                sample1Id: results.sample1Id,
                sample2Id: results.sample2Id,
                overallMatch: results.overallMatch,
                likelihoodRatio: results.likelihoodRatio,
                matchProbability: results.matchProbability,
                significance: results.significance,
                locusComparisons: includeDetails ? results.locusComparisons : [],
                calculationMetadata: results.calculationMetadata,
                populationUsed: results.populationUsed
            };
            
            // Mock download
            const blob = new Blob([JSON.stringify(reportData, null, 2)], { 
                type: 'application/pdf' 
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `comparison_report_${results.sample1Id}_vs_${results.sample2Id}_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('Failed to generate PDF report:', error);
            alert('Ошибка при генерации PDF отчета: ' + error.message);
        } finally {
            setIsGenerating(false);
        }
    }, [results, includeDetails]);

    // Generate Excel report
    const generateExcelReport = useCallback(async () => {
        setIsGenerating(true);
        try {
            // Simulate Excel generation
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Prepare main comparison data
            const mainData = {
                comparison_type: results.comparisonType,
                sample_1: results.sample1Id,
                sample_2: results.sample2Id,
                total_loci: results.overallMatch.totalLoci,
                full_matches: results.overallMatch.fullMatches,
                partial_matches: results.overallMatch.partialMatches,
                no_matches: results.overallMatch.noMatches,
                match_percentage: results.overallMatch.matchPercentage,
                likelihood_ratio: results.likelihoodRatio,
                match_probability: results.matchProbability,
                significance: results.significance,
                population: results.populationUsed,
                analysis_date: results.calculationMetadata.timestamp.toISOString()
            };
            
            // Prepare locus details if requested
            let csvContent = 'Comparison Summary\n';
            csvContent += Object.entries(mainData)
                .map(([key, value]) => `${key.replace(/_/g, ' ')},${value}`)
                .join('\n');
            
            if (includeDetails && results.locusComparisons.length > 0) {
                csvContent += '\n\nLocus Details\n';
                csvContent += 'Locus,Sample 1 Alleles,Sample 2 Alleles,Match Type,Locus LR\n';
                csvContent += results.locusComparisons
                    .map(locus => `${locus.locusName},"${locus.sample1Alleles.join('/')}","${locus.sample2Alleles.join('/')}",${locus.matchType},${locus.locusLR}`)
                    .join('\n');
            }
            
            const blob = new Blob([csvContent], { 
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `comparison_report_${results.sample1Id}_vs_${results.sample2Id}_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('Failed to generate Excel report:', error);
            alert('Ошибка при генерации Excel отчета: ' + error.message);
        } finally {
            setIsGenerating(false);
        }
    }, [results, includeDetails]);

    // Generate report based on selected type
    const generateReport = useCallback(() => {
        if (reportType === 'pdf') {
            generatePDFReport();
        } else {
            generateExcelReport();
        }
    }, [reportType, generatePDFReport, generateExcelReport]);

    // Export comparison history
    const exportHistory = useCallback(async () => {
        setIsGenerating(true);
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const historyData = comparisonHistory.map(comparison => ({
                comparisonType: comparison.comparisonType,
                sample1Id: comparison.sample1Id,
                sample2Id: comparison.sample2Id,
                matchPercentage: comparison.overallMatch.matchPercentage,
                likelihoodRatio: comparison.likelihoodRatio,
                matchProbability: comparison.matchProbability,
                significance: comparison.significance,
                analysisDate: comparison.timestamp.toISOString()
            }));
            
            const csvContent = [
                'Comparison Type,Sample 1,Sample 2,Match %,LR,Match Probability %,Significance,Analysis Date',
                ...historyData.map(row => Object.values(row).join(','))
            ].join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `comparison_history_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('Failed to export history:', error);
            alert('Ошибка при экспорте истории: ' + error.message);
        } finally {
            setIsGenerating(false);
        }
    }, [comparisonHistory]);

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
        <div className="comparison-reports">
            <div className="reports-header">
                <h3>Генерация отчетов сравнения</h3>
                <button 
                    className="help-button"
                    onClick={() => onShowHelp('comparison-reports')}
                    title="Справка по отчетам сравнения"
                >
                    ❓
                </button>
            </div>

            <div className="reports-content">
                {/* Report Type Selection */}
                <div className="report-type-section">
                    <h4>Тип отчета</h4>
                    <div className="report-type-selector">
                        <label className="radio-option">
                            <input
                                type="radio"
                                name="reportType"
                                value="pdf"
                                checked={reportType === 'pdf'}
                                onChange={(e) => setReportType(e.target.value)}
                                disabled={isGenerating}
                            />
                            <span>PDF отчет</span>
                            <small>Полный отчет с графиками и статистикой</small>
                        </label>
                        
                        <label className="radio-option">
                            <input
                                type="radio"
                                name="reportType"
                                value="excel"
                                checked={reportType === 'excel'}
                                onChange={(e) => setReportType(e.target.value)}
                                disabled={isGenerating}
                            />
                            <span>Excel таблица</span>
                            <small>Данные в табличном формате</small>
                        </label>
                    </div>
                </div>

                {/* Report Options */}
                <div className="report-options-section">
                    <h4>Параметры отчета</h4>
                    <div className="options-list">
                        <label className="checkbox-option">
                            <input
                                type="checkbox"
                                checked={includeDetails}
                                onChange={(e) => setIncludeDetails(e.target.checked)}
                                disabled={isGenerating}
                            />
                            <span>Включить детальное сравнение по локусам</span>
                        </label>
                    </div>
                </div>

                {/* Report Generation */}
                <div className="report-generation-section">
                    <h4>Генерация отчета</h4>
                    <div className="generation-controls">
                        <button 
                            className="generate-button"
                            onClick={generateReport}
                            disabled={isGenerating}
                        >
                            {isGenerating ? 'Генерация...' : `Создать ${reportType.toUpperCase()} отчет`}
                        </button>
                        
                        <div className="report-info">
                            <div className="info-item">
                                <span className="info-label">Тип сравнения:</span>
                                <span className="info-value">
                                    {getComparisonTypeDisplay(results.comparisonType)}
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Образцы:</span>
                                <span className="info-value">
                                    {results.sample1Id} vs {results.sample2Id}
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Совпадение:</span>
                                <span className="info-value">
                                    {results.overallMatch.matchPercentage.toFixed(1)}%
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">LR:</span>
                                <span className="info-value">
                                    {results.likelihoodRatio.toExponential(2)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Database Search Results Export */}
                {results.comparisonType === 'database-search' && results.searchResults && (
                    <div className="search-export-section">
                        <h4>Экспорт результатов поиска</h4>
                        <div className="export-controls">
                            <button 
                                className="export-button"
                                onClick={() => {
                                    // Export search results
                                    const searchData = results.searchResults.map(result => ({
                                        targetSample: result.targetSampleId,
                                        matchPercentage: result.matchPercentage,
                                        likelihoodRatio: result.likelihoodRatio
                                    }));
                                    
                                    const csvContent = [
                                        'Target Sample,Match %,LR',
                                        ...searchData.map(row => Object.values(row).join(','))
                                    ].join('\n');
                                    
                                    const blob = new Blob([csvContent], { type: 'text/csv' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `database_search_results_${results.sample1Id}_${new Date().toISOString().split('T')[0]}.csv`;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                }}
                                disabled={isGenerating}
                            >
                                Экспортировать результаты поиска (CSV)
                            </button>
                            
                            <div className="export-info">
                                <span>Найдено совпадений: {results.searchResults.length}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* History Export */}
                {comparisonHistory.length > 0 && (
                    <div className="history-export-section">
                        <h4>Экспорт истории сравнений</h4>
                        <div className="export-controls">
                            <button 
                                className="export-button"
                                onClick={exportHistory}
                                disabled={isGenerating}
                            >
                                {isGenerating ? 'Экспорт...' : 'Экспортировать историю (CSV)'}
                            </button>
                            
                            <div className="export-info">
                                <span>Всего сравнений: {comparisonHistory.length}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Report Templates */}
                <div className="report-templates-section">
                    <h4>Шаблоны отчетов</h4>
                    <div className="templates-grid">
                        <div className="template-card">
                            <div className="template-icon">📊</div>
                            <div className="template-info">
                                <h5>Стандартный отчет</h5>
                                <p>Полный анализ сравнения с интерпретацией</p>
                            </div>
                        </div>
                        
                        <div className="template-card">
                            <div className="template-icon">📈</div>
                            <div className="template-info">
                                <h5>Статистический отчет</h5>
                                <p>Детальная статистика и LR расчеты</p>
                            </div>
                        </div>
                        
                        <div className="template-card">
                            <div className="template-icon">🔍</div>
                            <div className="template-info">
                                <h5>Судебный отчет</h5>
                                <p>Отчет для судебно-медицинской экспертизы</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ComparisonReports;