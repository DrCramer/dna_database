/**
 * Quality Reports Component
 * 
 * Provides interface for generating and downloading quality analysis reports
 * Requirements: 10.1, 10.2, 10.3 - PDF and Excel report generation
 */

import React, { useState, useCallback } from 'react';
import './BayesianAnalysis.css';

const QualityReports = ({ results, analysisHistory, onShowHelp }) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [reportType, setReportType] = useState('pdf');

    // Generate PDF report
    const generatePDFReport = useCallback(async () => {
        setIsGenerating(true);
        try {
            // Simulate PDF generation
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // In real implementation, would call ReportGenerator service
            const reportData = {
                sampleId: results.sampleId,
                analysisDate: results.analysisDate,
                pci: results.pci,
                heterozygosity: results.heterozygosity,
                degradation: results.degradation,
                contamination: results.contamination,
                duplicates: results.duplicates,
                perspectiveCategory: results.perspectiveCategory
            };
            
            // Mock download
            const blob = new Blob([JSON.stringify(reportData, null, 2)], { 
                type: 'application/pdf' 
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quality_report_${results.sampleId}_${new Date().toISOString().split('T')[0]}.pdf`;
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
    }, [results]);

    // Generate Excel report
    const generateExcelReport = useCallback(async () => {
        setIsGenerating(true);
        try {
            // Simulate Excel generation
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // In real implementation, would call ReportGenerator service
            const reportData = {
                sampleId: results.sampleId,
                analysisDate: results.analysisDate.toISOString(),
                pci_value: results.pci.pciValue,
                pci_classification: results.pci.classification,
                analyzed_loci: results.pci.analyzedLoci,
                total_loci: results.pci.totalLoci,
                observed_heterozygosity: results.heterozygosity.observedHeterozygosity,
                expected_heterozygosity: results.heterozygosity.expectedHeterozygosity,
                degradation_index: results.degradation.degradationValue,
                degradation_classification: results.degradation.classification,
                contamination_detected: results.contamination.isContaminated,
                suspected_staff: results.contamination.suspectedStaff || 'None',
                duplicates_found: results.duplicates.potentialDuplicates.length,
                perspective_category: results.perspectiveCategory.category
            };
            
            // Mock download
            const csvContent = Object.entries(reportData)
                .map(([key, value]) => `${key},${value}`)
                .join('\n');
            
            const blob = new Blob([csvContent], { 
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quality_report_${results.sampleId}_${new Date().toISOString().split('T')[0]}.xlsx`;
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
    }, [results]);

    // Generate report based on selected type
    const generateReport = useCallback(() => {
        if (reportType === 'pdf') {
            generatePDFReport();
        } else {
            generateExcelReport();
        }
    }, [reportType, generatePDFReport, generateExcelReport]);

    // Export analysis history
    const exportHistory = useCallback(async () => {
        setIsGenerating(true);
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const historyData = analysisHistory.map(analysis => ({
                sampleId: analysis.sampleId,
                analysisDate: analysis.analysisDate.toISOString(),
                pci: analysis.pci.pciValue,
                category: analysis.perspectiveCategory.category,
                contamination: analysis.contamination.isContaminated,
                duplicates: analysis.duplicates.potentialDuplicates.length
            }));
            
            const csvContent = [
                'Sample ID,Analysis Date,PCI,Category,Contamination,Duplicates',
                ...historyData.map(row => Object.values(row).join(','))
            ].join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quality_analysis_history_${new Date().toISOString().split('T')[0]}.csv`;
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
    }, [analysisHistory]);

    return (
        <div className="quality-reports">
            <div className="reports-header">
                <h3>Генерация отчетов</h3>
                <button 
                    className="help-button"
                    onClick={() => onShowHelp('quality-reports')}
                    title="Справка по отчетам"
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
                            <small>Полный отчет с графиками и интерпретацией</small>
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
                            <small>Данные в табличном формате для анализа</small>
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
                                <span className="info-label">Образец:</span>
                                <span className="info-value">{results.sampleId}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Дата анализа:</span>
                                <span className="info-value">
                                    {results.analysisDate.toLocaleString('ru-RU')}
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Категория:</span>
                                <span className="info-value">{results.perspectiveCategory.category}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* History Export */}
                {analysisHistory.length > 0 && (
                    <div className="history-export-section">
                        <h4>Экспорт истории анализов</h4>
                        <div className="export-controls">
                            <button 
                                className="export-button"
                                onClick={exportHistory}
                                disabled={isGenerating}
                            >
                                {isGenerating ? 'Экспорт...' : 'Экспортировать историю (CSV)'}
                            </button>
                            
                            <div className="export-info">
                                <span>Всего анализов: {analysisHistory.length}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Report Templates */}
                <div className="report-templates-section">
                    <h4>Шаблоны отчетов</h4>
                    <div className="templates-grid">
                        <div className="template-card">
                            <div className="template-icon">📄</div>
                            <div className="template-info">
                                <h5>Стандартный отчет</h5>
                                <p>Полный анализ качества с рекомендациями</p>
                            </div>
                        </div>
                        
                        <div className="template-card">
                            <div className="template-icon">📊</div>
                            <div className="template-info">
                                <h5>Сводный отчет</h5>
                                <p>Краткая сводка основных показателей</p>
                            </div>
                        </div>
                        
                        <div className="template-card">
                            <div className="template-icon">📈</div>
                            <div className="template-info">
                                <h5>Детальный анализ</h5>
                                <p>Подробный анализ с графиками и статистикой</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QualityReports;