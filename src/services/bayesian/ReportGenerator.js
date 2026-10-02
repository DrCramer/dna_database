/**
 * Report Generator - Generate PDF and Excel reports for Bayesian analysis
 * 
 * This class creates professional reports including:
 * - Quality assessment reports
 * - Comparison analysis reports
 * - Excel exports with detailed tables
 * - Metadata and methodology explanations
 */

const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const { logger } = require('../../utils/logger');
const { Classifications } = require('./types');

class ReportGenerator {
    constructor() {
        this.systemVersion = process.env.SYSTEM_VERSION || '1.0.0';
    }

    /**
     * Generate quality assessment report
     * Requirements: 10.1, 10.4
     * 
     * @param {QualityAnalysisResult} analysis - Quality analysis result
     * @returns {Promise<PDFReport>} PDF report
     */
    async generateQualityReport(analysis) {
        try {
            // Validate input data
            if (!analysis || !analysis.sampleId) {
                throw new Error('Quality report generation failed: Invalid analysis data');
            }

            const doc = new PDFDocument();
            const chunks = [];
            
            doc.on('data', chunk => chunks.push(chunk));
            
            return new Promise((resolve, reject) => {
                doc.on('end', () => {
                    const content = Buffer.concat(chunks);
                    const metadata = this.createReportMetadata('quality_assessment');
                    const filename = `quality_report_${analysis.sampleId}_${new Date().toISOString().split('T')[0]}.pdf`;
                    
                    resolve({
                        content,
                        metadata,
                        filename
                    });
                });

                doc.on('error', reject);

                // Generate PDF content
                this.generateQualityReportContent(doc, analysis);
                doc.end();
            });

        } catch (error) {
            logger.error(`Quality report generation failed for sample ${analysis?.sampleId}:`, error);
            throw new Error(`Quality report generation failed: ${error.message}`);
        }
    }

    /**
     * Generate comparison analysis report
     * Requirements: 10.2, 10.4
     * 
     * @param {ComparisonResult} comparison - Comparison result
     * @param {string} sample1Id - First sample ID
     * @param {string} sample2Id - Second sample ID
     * @returns {Promise<PDFReport>} PDF report
     */
    async generateComparisonReport(comparison, sample1Id, sample2Id) {
        try {
            const doc = new PDFDocument();
            const chunks = [];
            
            doc.on('data', chunk => chunks.push(chunk));
            
            return new Promise((resolve, reject) => {
                doc.on('end', () => {
                    const content = Buffer.concat(chunks);
                    const metadata = this.createReportMetadata('comparison_analysis');
                    const filename = `comparison_report_${sample1Id}_vs_${sample2Id}_${new Date().toISOString().split('T')[0]}.pdf`;
                    
                    resolve({
                        content,
                        metadata,
                        filename
                    });
                });

                doc.on('error', reject);

                // Generate PDF content
                this.generateComparisonReportContent(doc, comparison, sample1Id, sample2Id);
                doc.end();
            });

        } catch (error) {
            logger.error(`Comparison report generation failed for ${sample1Id} vs ${sample2Id}:`, error);
            throw new Error(`Comparison report generation failed: ${error.message}`);
        }
    }

    /**
     * Export analysis data to Excel
     * Requirements: 10.3
     * 
     * @param {Object} data - Analysis data to export
     * @returns {Promise<Buffer>} Excel file buffer
     */
    async exportToExcel(data) {
        try {
            // Validate input data
            if (!data) {
                throw new Error('Excel export failed: No data provided');
            }

            const workbook = XLSX.utils.book_new();

            // Create worksheets based on data type
            if (data.qualityAnalysis) {
                this.addQualityAnalysisSheet(workbook, data.qualityAnalysis);
            }

            if (data.comparisonResults) {
                this.addComparisonResultsSheet(workbook, data.comparisonResults);
            }

            if (data.locusDetails) {
                this.addLocusDetailsSheet(workbook, data.locusDetails);
            }

            // Add metadata sheet
            this.addMetadataSheet(workbook, data);

            // Generate Excel buffer
            const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            
            logger.info('Excel export completed successfully');
            return buffer;

        } catch (error) {
            logger.error('Excel export failed:', error);
            throw new Error(`Excel export failed: ${error.message}`);
        }
    }

    /**
     * Generate summary report for multiple analyses
     * @param {Array<Object>} results - Array of analysis results
     * @returns {Promise<PDFReport>} Summary PDF report
     */
    async generateSummaryReport(results) {
        try {
            const doc = new PDFDocument();
            const chunks = [];
            
            doc.on('data', chunk => chunks.push(chunk));
            
            return new Promise((resolve, reject) => {
                doc.on('end', () => {
                    const content = Buffer.concat(chunks);
                    const metadata = this.createReportMetadata('summary_report');
                    const filename = `summary_report_${new Date().toISOString().split('T')[0]}.pdf`;
                    
                    resolve({
                        content,
                        metadata,
                        filename
                    });
                });

                doc.on('error', reject);

                // Generate PDF content
                this.generateSummaryReportContent(doc, results);
                doc.end();
            });

        } catch (error) {
            logger.error('Summary report generation failed:', error);
            throw new Error(`Summary report generation failed: ${error.message}`);
        }
    }

    // Private methods for PDF content generation

    /**
     * Generate quality report PDF content
     * @param {PDFDocument} doc - PDF document
     * @param {QualityAnalysisResult} analysis - Quality analysis result
     */
    generateQualityReportContent(doc, analysis) {
        // Header
        doc.fontSize(20).text('Отчет о качестве генетического образца', 50, 50);
        doc.fontSize(12).text(`Дата формирования: ${new Date().toLocaleDateString('ru-RU')}`, 50, 80);
        doc.text(`Образец: ${analysis.sampleId}`, 50, 100);
        
        let yPos = 140;

        // Profile Completeness Index
        doc.fontSize(14).text('Индекс полноты профиля (PCI)', 50, yPos);
        yPos += 25;
        if (analysis.pci) {
            doc.fontSize(12)
               .text(`Значение: ${(analysis.pci.pciValue * 100).toFixed(1)}%`, 70, yPos)
               .text(`Классификация: ${analysis.pci.classification}`, 70, yPos + 20)
               .text(`Проанализированных локусов: ${analysis.pci.analyzedLoci}`, 70, yPos + 40)
               .text(`Всего локусов в базе: ${analysis.pci.totalLoci}`, 70, yPos + 60);
        } else {
            doc.fontSize(12).text('Данные PCI недоступны', 70, yPos);
        }
        
        yPos += 100;

        // Heterozygosity Analysis
        doc.fontSize(14).text('Анализ гетерозиготности', 50, yPos);
        yPos += 25;
        if (analysis.heterozygosity) {
            doc.fontSize(12)
               .text(`Наблюдаемая гетерозиготность: ${(analysis.heterozygosity.observedHeterozygosity * 100).toFixed(1)}%`, 70, yPos)
               .text(`Ожидаемая гетерозиготность: ${(analysis.heterozygosity.expectedHeterozygosity * 100).toFixed(1)}%`, 70, yPos + 20)
               .text(`Гетерозиготных локусов: ${analysis.heterozygosity.heterozygousLoci}`, 70, yPos + 40);
        } else {
            doc.fontSize(12).text('Данные гетерозиготности недоступны', 70, yPos);
        }
        
        yPos += 80;

        // Degradation Index
        doc.fontSize(14).text('Индекс деградации', 50, yPos);
        yPos += 25;
        if (analysis.degradation) {
            doc.fontSize(12)
               .text(`Значение: ${(analysis.degradation.degradationValue * 100).toFixed(1)}%`, 70, yPos)
               .text(`Классификация: ${analysis.degradation.classification}`, 70, yPos + 20);
            
            if (analysis.degradation.affectedLoci && analysis.degradation.affectedLoci.length > 0) {
                doc.text(`Затронутые локусы: ${analysis.degradation.affectedLoci.join(', ')}`, 70, yPos + 40);
                yPos += 60;
            } else {
                yPos += 40;
            }
        } else {
            doc.fontSize(12).text('Данные деградации недоступны', 70, yPos);
            yPos += 40;
        }

        yPos += 20;

        // Contamination Status
        doc.fontSize(14).text('Статус контаминации', 50, yPos);
        yPos += 25;
        if (analysis.contamination) {
            if (analysis.contamination.isContaminated) {
                doc.fontSize(12)
                   .text('Статус: ЗАГРЯЗНЕННЫЙ', 70, yPos)
                   .text(`Подозреваемый сотрудник: ${analysis.contamination.suspectedStaff?.name || 'неизвестен'}`, 70, yPos + 20)
                   .text(`Совпадающих локусов: ${analysis.contamination.matchingLoci}`, 70, yPos + 40);
                yPos += 60;
            } else {
                doc.fontSize(12).text('Статус: ЧИСТЫЙ', 70, yPos);
                yPos += 20;
            }

            if (analysis.contamination.mixtureSuspicion) {
                doc.text(`Подозрение на смесь: ${analysis.contamination.triAllelicLoci.join(', ')}`, 70, yPos);
                yPos += 20;
            }
        } else {
            doc.fontSize(12).text('Данные контаминации недоступны', 70, yPos);
            yPos += 20;
        }

        yPos += 20;

        // Duplicates
        doc.fontSize(14).text('Поиск дубликатов', 50, yPos);
        yPos += 25;
        if (analysis.duplicates) {
            if (analysis.duplicates.potentialDuplicates.length > 0) {
                doc.fontSize(12).text('Найдены потенциальные дубликаты:', 70, yPos);
                yPos += 20;
                
                analysis.duplicates.potentialDuplicates.forEach(dup => {
                    doc.text(`- Образец ${dup.sampleId}: ${dup.matchPercentage.toFixed(1)}% совпадение`, 90, yPos);
                    yPos += 15;
                });
            } else {
                doc.fontSize(12).text('Дубликаты не найдены', 70, yPos);
                yPos += 20;
            }
        } else {
            doc.fontSize(12).text('Данные дубликатов недоступны', 70, yPos);
            yPos += 20;
        }

        yPos += 20;

        // Perspective Category
        doc.fontSize(14).text('Итоговая категория перспективности', 50, yPos);
        yPos += 25;
        if (analysis.perspectiveCategory) {
            doc.fontSize(12).text(`Категория: ${analysis.perspectiveCategory.category}`, 70, yPos);
            yPos += 25;

            if (analysis.perspectiveCategory.reasoning) {
                doc.text('Обоснование:', 70, yPos);
                yPos += 15;
                analysis.perspectiveCategory.reasoning.forEach(reason => {
                    doc.text(`• ${reason}`, 90, yPos);
                    yPos += 15;
                });
            }

            yPos += 10;
            if (analysis.perspectiveCategory.recommendations) {
                doc.text('Рекомендации:', 70, yPos);
                yPos += 15;
                analysis.perspectiveCategory.recommendations.forEach(rec => {
                    doc.text(`• ${rec}`, 90, yPos);
                    yPos += 15;
                });
            }
        } else {
            doc.fontSize(12).text('Данные категории недоступны', 70, yPos);
        }

        // Add methodology explanation
        this.addMethodologySection(doc, 'quality');
    }

    /**
     * Generate comparison report PDF content
     * @param {PDFDocument} doc - PDF document
     * @param {ComparisonResult} comparison - Comparison result
     * @param {string} sample1Id - First sample ID
     * @param {string} sample2Id - Second sample ID
     */
    generateComparisonReportContent(doc, comparison, sample1Id, sample2Id) {
        // Header
        doc.fontSize(20).text('Отчет о сравнении генетических образцов', 50, 50);
        doc.fontSize(12).text(`Дата формирования: ${new Date().toLocaleDateString('ru-RU')}`, 50, 80);
        doc.text(`Образец 1: ${sample1Id}`, 50, 100);
        doc.text(`Образец 2: ${sample2Id}`, 50, 120);
        doc.text(`Тип сравнения: ${comparison.comparisonType}`, 50, 140);
        
        let yPos = 180;

        // Overall Statistics
        doc.fontSize(14).text('Общая статистика сравнения', 50, yPos);
        yPos += 25;
        doc.fontSize(12)
           .text(`Общих локусов: ${comparison.overallMatch.totalLoci}`, 70, yPos)
           .text(`Полных совпадений: ${comparison.overallMatch.fullMatches}`, 70, yPos + 20)
           .text(`Частичных совпадений: ${comparison.overallMatch.partialMatches}`, 70, yPos + 40)
           .text(`Несовпадений: ${comparison.overallMatch.noMatches}`, 70, yPos + 60)
           .text(`Процент совпадения: ${comparison.overallMatch.matchPercentage.toFixed(1)}%`, 70, yPos + 80);
        
        yPos += 120;

        // Statistical Analysis
        doc.fontSize(14).text('Статистический анализ', 50, yPos);
        yPos += 25;
        doc.fontSize(12)
           .text(`Likelihood Ratio: ${comparison.likelihoodRatio.toExponential(2)}`, 70, yPos)
           .text(`Вероятность совпадения: ${comparison.matchProbability.toFixed(2)}%`, 70, yPos + 20);
        
        yPos += 60;

        // Locus-by-locus comparison table
        doc.fontSize(14).text('Детальное сравнение по локусам', 50, yPos);
        yPos += 25;

        // Table header
        doc.fontSize(10)
           .text('Локус', 50, yPos)
           .text('Образец 1', 150, yPos)
           .text('Образец 2', 250, yPos)
           .text('Совпадение', 350, yPos)
           .text('LR', 450, yPos);
        
        yPos += 20;
        doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
        yPos += 10;

        // Table rows
        comparison.locusComparisons.forEach(lc => {
            if (yPos > 700) { // New page if needed
                doc.addPage();
                yPos = 50;
            }

            const matchColor = this.getMatchColor(lc.matchType);
            doc.fontSize(9)
               .text(lc.locusName, 50, yPos)
               .text(lc.sample1Alleles.join('/'), 150, yPos)
               .text(lc.sample2Alleles.join('/'), 250, yPos)
               .fillColor(matchColor)
               .text(lc.matchType, 350, yPos)
               .fillColor('black')
               .text(lc.locusLR.toFixed(2), 450, yPos);
            
            yPos += 15;
        });

        // Add methodology explanation
        this.addMethodologySection(doc, 'comparison');
    }

    /**
     * Generate summary report PDF content
     * @param {PDFDocument} doc - PDF document
     * @param {Array<Object>} results - Array of analysis results
     */
    generateSummaryReportContent(doc, results) {
        // Header
        doc.fontSize(20).text('Сводный отчет по анализу образцов', 50, 50);
        doc.fontSize(12).text(`Дата формирования: ${new Date().toLocaleDateString('ru-RU')}`, 50, 80);
        doc.text(`Количество образцов: ${results.length}`, 50, 100);
        
        let yPos = 140;

        // Summary statistics
        const stats = this.calculateSummaryStatistics(results);
        
        doc.fontSize(14).text('Сводная статистика', 50, yPos);
        yPos += 25;
        doc.fontSize(12)
           .text(`Средний PCI: ${(stats.averagePCI * 100).toFixed(1)}%`, 70, yPos)
           .text(`Высокая перспективность: ${stats.highPerspective} образцов`, 70, yPos + 20)
           .text(`Средняя перспективность: ${stats.mediumPerspective} образцов`, 70, yPos + 40)
           .text(`Низкая перспективность: ${stats.lowPerspective} образцов`, 70, yPos + 60)
           .text(`Загрязненных: ${stats.contaminated} образцов`, 70, yPos + 80);
        
        yPos += 120;

        // Individual sample summaries
        doc.fontSize(14).text('Детали по образцам', 50, yPos);
        yPos += 25;

        results.forEach(result => {
            if (yPos > 650) { // New page if needed
                doc.addPage();
                yPos = 50;
            }

            doc.fontSize(12)
               .text(`Образец: ${result.sampleId}`, 70, yPos)
               .text(`PCI: ${(result.pci.pciValue * 100).toFixed(1)}%`, 200, yPos)
               .text(`Категория: ${result.perspectiveCategory.category}`, 300, yPos);
            
            yPos += 20;
        });
    }

    /**
     * Add methodology explanation section
     * @param {PDFDocument} doc - PDF document
     * @param {string} type - Type of analysis ('quality' or 'comparison')
     */
    addMethodologySection(doc, type) {
        doc.addPage();
        doc.fontSize(16).text('Методология расчетов', 50, 50);
        
        let yPos = 80;
        doc.fontSize(10);

        if (type === 'quality') {
            doc.text('Индекс полноты профиля (PCI):', 50, yPos);
            yPos += 15;
            doc.text('PCI = Количество_проанализированных_локусов / Количество_всех_локусов', 70, yPos);
            yPos += 15;
            doc.text('Классификация: ≥0.80 (полный), 0.60-0.80 (умеренно неполный), 0.40-0.60 (сильно неполный), <0.40 (критически неполный)', 70, yPos);
            
            yPos += 30;
            doc.text('Индекс деградации:', 50, yPos);
            yPos += 15;
            doc.text('Индекс = (Ожидаемая_гетерозиготность - Наблюдаемая_гетерозиготность) / Ожидаемая_гетерозиготность', 70, yPos);
            yPos += 15;
            doc.text('Классификация: <0.20 (минимальная), 0.20-0.40 (умеренная), ≥0.40 (сильная)', 70, yPos);
        } else if (type === 'comparison') {
            doc.text('Likelihood Ratio (LR):', 50, yPos);
            yPos += 15;
            doc.text('LR = Вероятность_данных_при_гипотезе_совпадения / Вероятность_данных_при_гипотезе_различия', 70, yPos);
            yPos += 15;
            doc.text('Применяется консервативная поправка Бреннера для неполных профилей', 70, yPos);
            
            yPos += 30;
            doc.text('Вероятность совпадения:', 50, yPos);
            yPos += 15;
            doc.text('Вероятность = (LR / (1 + LR)) * 100%', 70, yPos);
        }
    }

    /**
     * Add quality analysis sheet to Excel workbook
     * @param {Object} workbook - Excel workbook
     * @param {QualityAnalysisResult} analysis - Quality analysis result
     */
    addQualityAnalysisSheet(workbook, analysis) {
        const data = [
            ['Параметр', 'Значение', 'Классификация'],
            ['Образец', analysis.sampleId, ''],
            ['PCI', `${(analysis.pci.pciValue * 100).toFixed(1)}%`, analysis.pci.classification],
            ['Наблюдаемая гетерозиготность', `${(analysis.heterozygosity.observedHeterozygosity * 100).toFixed(1)}%`, ''],
            ['Ожидаемая гетерозиготность', `${(analysis.heterozygosity.expectedHeterozygosity * 100).toFixed(1)}%`, ''],
            ['Индекс деградации', `${(analysis.degradation.degradationValue * 100).toFixed(1)}%`, analysis.degradation.classification],
            ['Контаминация', analysis.contamination.isContaminated ? 'Да' : 'Нет', ''],
            ['Категория', analysis.perspectiveCategory.category, '']
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Анализ качества');
    }

    /**
     * Add comparison results sheet to Excel workbook
     * @param {Object} workbook - Excel workbook
     * @param {ComparisonResult} comparison - Comparison result
     */
    addComparisonResultsSheet(workbook, comparison) {
        const data = [
            ['Параметр', 'Значение'],
            ['Тип сравнения', comparison.comparisonType],
            ['Общих локусов', comparison.overallMatch.totalLoci],
            ['Полных совпадений', comparison.overallMatch.fullMatches],
            ['Частичных совпадений', comparison.overallMatch.partialMatches],
            ['Несовпадений', comparison.overallMatch.noMatches],
            ['Процент совпадения', `${comparison.overallMatch.matchPercentage.toFixed(1)}%`],
            ['Likelihood Ratio', comparison.likelihoodRatio.toExponential(2)],
            ['Вероятность совпадения', `${comparison.matchProbability.toFixed(2)}%`]
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Результаты сравнения');
    }

    /**
     * Add locus details sheet to Excel workbook
     * @param {Object} workbook - Excel workbook
     * @param {Array<LocusComparison>} locusDetails - Locus comparison details
     */
    addLocusDetailsSheet(workbook, locusDetails) {
        const data = [
            ['Локус', 'Образец 1', 'Образец 2', 'Тип совпадения', 'LR']
        ];

        locusDetails.forEach(lc => {
            data.push([
                lc.locusName,
                lc.sample1Alleles.join('/'),
                lc.sample2Alleles.join('/'),
                lc.matchType,
                lc.locusLR.toFixed(2)
            ]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Детали по локусам');
    }

    /**
     * Add metadata sheet to Excel workbook
     * @param {Object} workbook - Excel workbook
     * @param {Object} data - Analysis data
     */
    addMetadataSheet(workbook, data) {
        const metadata = [
            ['Параметр', 'Значение'],
            ['Дата создания', new Date().toLocaleDateString('ru-RU')],
            ['Версия системы', this.systemVersion],
            ['Тип анализа', data.analysisType || 'Комплексный'],
            ['Методология', 'Байесовский анализ с популяционными частотами']
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(metadata);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Метаданные');
    }

    /**
     * Create report metadata
     * @param {string} analysisType - Type of analysis
     * @returns {ReportMetadata} Report metadata
     */
    createReportMetadata(analysisType) {
        return {
            createdAt: new Date(),
            systemVersion: this.systemVersion,
            analysisParameters: {
                contaminationThreshold: 3,
                duplicateThreshold: 0.95,
                lrThreshold: 1000000,
                degradationThresholds: {
                    minimal: 0.20,
                    moderate: 0.40,
                    severe: 0.40
                }
            },
            methodology: 'Байесовский анализ с использованием популяционных частот аллелей и консервативной поправки Бреннера для неполных профилей'
        };
    }

    /**
     * Get color for match type
     * @param {string} matchType - Type of match
     * @returns {string} Color code
     */
    getMatchColor(matchType) {
        switch (matchType) {
            case Classifications.MATCH.FULL:
                return '#90EE90'; // Light green
            case Classifications.MATCH.PARTIAL:
                return '#FFFFE0'; // Light yellow
            case Classifications.MATCH.NO_MATCH:
                return '#FFB6C1'; // Light red
            default:
                return '#D3D3D3'; // Light gray
        }
    }

    /**
     * Calculate summary statistics for multiple results
     * @param {Array<Object>} results - Array of analysis results
     * @returns {Object} Summary statistics
     */
    calculateSummaryStatistics(results) {
        const stats = {
            averagePCI: 0,
            highPerspective: 0,
            mediumPerspective: 0,
            lowPerspective: 0,
            contaminated: 0
        };

        if (results.length === 0) return stats;

        let totalPCI = 0;
        let validPCICount = 0;
        
        results.forEach(result => {
            // Проверяем валидность PCI перед добавлением
            if (result.pci && typeof result.pci.pciValue === 'number' && 
                isFinite(result.pci.pciValue) && !isNaN(result.pci.pciValue)) {
                totalPCI += result.pci.pciValue;
                validPCICount++;
            }
            
            // Подсчитываем категории
            if (result.perspectiveCategory && result.perspectiveCategory.category) {
                switch (result.perspectiveCategory.category) {
                    case Classifications.PERSPECTIVE.HIGH:
                        stats.highPerspective++;
                        break;
                    case Classifications.PERSPECTIVE.MEDIUM:
                        stats.mediumPerspective++;
                        break;
                    case Classifications.PERSPECTIVE.LOW:
                        stats.lowPerspective++;
                        break;
                    case Classifications.PERSPECTIVE.CONTAMINATED:
                        stats.contaminated++;
                        break;
                }
            }
        });

        // Рассчитываем средний PCI только для валидных значений
        stats.averagePCI = validPCICount > 0 ? totalPCI / validPCICount : 0;
        return stats;
    }
}

module.exports = ReportGenerator;