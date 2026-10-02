/**
 * Сервис для анализа контаминации с профилями сотрудников
 * Обеспечивает связь между образцами и профилями сотрудников для выявления контаминации
 */

const StaffProfile = require('../models/StaffProfile');
const ContaminationAnalysis = require('../models/ContaminationAnalysis');
const { logger } = require('../utils/logger');

class StaffContaminationService {
    constructor(pool, bayesianEngine) {
        this.pool = pool;
        this.bayesianEngine = bayesianEngine;
        this.staffProfile = new StaffProfile(pool);
        this.contaminationAnalysis = new ContaminationAnalysis(pool);
    }

    /**
     * Анализ образца на контаминацию с профилями сотрудников
     * @param {string} sampleProfileId - ID образца для анализа
     * @param {string} analyzedBy - ID пользователя, проводящего анализ
     * @param {Object} options - Дополнительные параметры анализа
     * @returns {Promise<Object>} Результаты анализа контаминации
     */
    async analyzeSampleContamination(sampleProfileId, analyzedBy, options = {}) {
        try {
            logger.info(`Начало анализа контаминации для образца ${sampleProfileId}`);

            // Получаем образец для анализа
            const sampleProfile = await this.getSampleProfile(sampleProfileId);
            if (!sampleProfile) {
                throw new Error(`Образец с ID ${sampleProfileId} не найден`);
            }

            // Получаем все активные профили сотрудников
            const staffProfiles = await this.staffProfile.getForContaminationAnalysis();
            logger.info(`Найдено ${staffProfiles.length} профилей сотрудников для анализа`);

            const results = [];
            const threshold = options.threshold || 5.0; // Минимальный порог контаминации для сохранения

            // Анализируем каждый профиль сотрудника
            for (const staffProfile of staffProfiles) {
                try {
                    const contaminationResult = await this.compareProfiles(
                        sampleProfile, 
                        staffProfile, 
                        options
                    );

                    // Сохраняем результат, если превышен порог
                    if (contaminationResult.contamination_percentage >= threshold) {
                        const analysisRecord = await this.contaminationAnalysis.create({
                            sample_profile_id: sampleProfileId,
                            staff_profile_id: staffProfile.id,
                            contamination_percentage: contaminationResult.contamination_percentage,
                            locus_matches: contaminationResult.locus_matches,
                            analyzed_by: analyzedBy,
                            analysis_method: contaminationResult.analysis_method,
                            confidence_level: contaminationResult.confidence_level,
                            notes: contaminationResult.notes
                        });

                        results.push({
                            ...analysisRecord,
                            staff_name: staffProfile.full_name,
                            staff_id: staffProfile.staff_id,
                            department: staffProfile.department
                        });
                    }
                } catch (error) {
                    logger.error(`Ошибка при анализе профиля сотрудника ${staffProfile.staff_id}:`, error);
                    // Продолжаем анализ других профилей
                }
            }

            // Сортируем результаты по уровню контаминации
            results.sort((a, b) => b.contamination_percentage - a.contamination_percentage);

            logger.info(`Анализ завершен. Найдено ${results.length} случаев потенциальной контаминации`);

            return {
                sample_profile_id: sampleProfileId,
                sample_name: sampleProfile.sample_name,
                total_staff_analyzed: staffProfiles.length,
                contamination_cases: results.length,
                results: results,
                analysis_summary: this.generateAnalysisSummary(results),
                timestamp: new Date()
            };

        } catch (error) {
            logger.error('Ошибка при анализе контаминации:', error);
            throw error;
        }
    }

    /**
     * Сравнение двух генетических профилей
     * @param {Object} sampleProfile - Профиль образца
     * @param {Object} staffProfile - Профиль сотрудника
     * @param {Object} options - Параметры сравнения
     * @returns {Promise<Object>} Результат сравнения
     */
    async compareProfiles(sampleProfile, staffProfile, options = {}) {
        try {
            const sampleData = sampleProfile.str_data;
            const staffData = staffProfile.str_data;

            if (!sampleData || !staffData) {
                throw new Error('Отсутствуют генетические данные для сравнения');
            }

            const locusMatches = {};
            let totalLoci = 0;
            let matchingLoci = 0;
            let partialMatches = 0;
            let totalAlleleMatches = 0;
            let totalAlleles = 0;

            // Получаем все локусы для анализа
            const allLoci = new Set([...Object.keys(sampleData), ...Object.keys(staffData)]);

            for (const locus of allLoci) {
                const sampleAlleles = this.normalizeAlleles(sampleData[locus]);
                const staffAlleles = this.normalizeAlleles(staffData[locus]);

                if (sampleAlleles.length === 0 || staffAlleles.length === 0) {
                    continue; // Пропускаем локусы без данных
                }

                totalLoci++;
                totalAlleles += sampleAlleles.length;

                const matchResult = this.compareAlleles(sampleAlleles, staffAlleles);
                locusMatches[locus] = matchResult;

                if (matchResult.full_match) {
                    matchingLoci++;
                    totalAlleleMatches += sampleAlleles.length;
                } else if (matchResult.partial_match) {
                    partialMatches++;
                    totalAlleleMatches += matchResult.matching_alleles;
                }
            }

            // Расчет процента контаминации
            const contaminationPercentage = totalLoci > 0 ? 
                ((matchingLoci + (partialMatches * 0.5)) / totalLoci) * 100 : 0;

            // Расчет уровня достоверности
            const confidenceLevel = this.calculateConfidenceLevel(
                totalLoci, matchingLoci, partialMatches, totalAlleleMatches, totalAlleles
            );

            // Определение метода анализа
            const analysisMethod = options.method || 'direct_comparison';

            // Генерация заметок
            const notes = this.generateAnalysisNotes(
                totalLoci, matchingLoci, partialMatches, contaminationPercentage
            );

            return {
                contamination_percentage: Math.round(contaminationPercentage * 100) / 100,
                locus_matches: locusMatches,
                analysis_method: analysisMethod,
                confidence_level: Math.round(confidenceLevel * 100) / 100,
                notes: notes,
                statistics: {
                    total_loci: totalLoci,
                    matching_loci: matchingLoci,
                    partial_matches: partialMatches,
                    total_allele_matches: totalAlleleMatches,
                    total_alleles: totalAlleles
                }
            };

        } catch (error) {
            logger.error('Ошибка при сравнении профилей:', error);
            throw error;
        }
    }

    /**
     * Нормализация аллелей для сравнения
     * @param {Array|string|null} alleles - Аллели для нормализации
     * @returns {Array} Нормализованный массив аллелей
     */
    normalizeAlleles(alleles) {
        if (!alleles) return [];
        
        let normalizedAlleles = [];
        
        if (Array.isArray(alleles)) {
            normalizedAlleles = alleles;
        } else if (typeof alleles === 'string') {
            // Разделяем строку по запятым или пробелам
            normalizedAlleles = alleles.split(/[,\s]+/);
        } else {
            normalizedAlleles = [alleles];
        }

        // Фильтруем и нормализуем
        return normalizedAlleles
            .filter(allele => allele !== null && allele !== undefined && allele !== '')
            .map(allele => String(allele).trim())
            .filter(allele => allele.length > 0)
            .sort(); // Сортируем для консистентного сравнения
    }

    /**
     * Сравнение аллелей двух локусов
     * @param {Array} alleles1 - Аллели первого профиля
     * @param {Array} alleles2 - Аллели второго профиля
     * @returns {Object} Результат сравнения
     */
    compareAlleles(alleles1, alleles2) {
        const set1 = new Set(alleles1);
        const set2 = new Set(alleles2);
        
        // Находим пересечение
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const matchingAlleles = intersection.size;
        
        // Определяем тип совпадения
        const fullMatch = matchingAlleles > 0 && 
            (matchingAlleles === set1.size || matchingAlleles === set2.size);
        const partialMatch = matchingAlleles > 0 && !fullMatch;

        return {
            alleles1: alleles1,
            alleles2: alleles2,
            matching_alleles: matchingAlleles,
            full_match: fullMatch,
            partial_match: partialMatch,
            match_percentage: Math.max(set1.size, set2.size) > 0 ? 
                (matchingAlleles / Math.max(set1.size, set2.size)) * 100 : 0
        };
    }

    /**
     * Расчет уровня достоверности анализа
     * @param {number} totalLoci - Общее количество локусов
     * @param {number} matchingLoci - Количество полностью совпадающих локусов
     * @param {number} partialMatches - Количество частично совпадающих локусов
     * @param {number} totalAlleleMatches - Общее количество совпадающих аллелей
     * @param {number} totalAlleles - Общее количество аллелей
     * @returns {number} Уровень достоверности (0-100)
     */
    calculateConfidenceLevel(totalLoci, matchingLoci, partialMatches, totalAlleleMatches, totalAlleles) {
        if (totalLoci === 0) return 0;

        // Базовая достоверность на основе количества проанализированных локусов
        let confidence = Math.min(totalLoci / 20, 1.0) * 60; // До 60% за количество локусов

        // Дополнительная достоверность за качество совпадений
        const matchQuality = (matchingLoci + partialMatches * 0.5) / totalLoci;
        confidence += matchQuality * 30; // До 30% за качество совпадений

        // Дополнительная достоверность за точность на уровне аллелей
        const alleleAccuracy = totalAlleles > 0 ? totalAlleleMatches / totalAlleles : 0;
        confidence += alleleAccuracy * 10; // До 10% за точность аллелей

        return Math.min(confidence, 100);
    }

    /**
     * Генерация заметок к анализу
     * @param {number} totalLoci - Общее количество локусов
     * @param {number} matchingLoci - Количество совпадающих локусов
     * @param {number} partialMatches - Количество частичных совпадений
     * @param {number} contaminationPercentage - Процент контаминации
     * @returns {string} Текст заметок
     */
    generateAnalysisNotes(totalLoci, matchingLoci, partialMatches, contaminationPercentage) {
        const notes = [];

        notes.push(`Проанализировано ${totalLoci} локусов`);
        notes.push(`Полных совпадений: ${matchingLoci}`);
        
        if (partialMatches > 0) {
            notes.push(`Частичных совпадений: ${partialMatches}`);
        }

        if (contaminationPercentage >= 20) {
            notes.push('ВЫСОКИЙ уровень потенциальной контаминации');
        } else if (contaminationPercentage >= 10) {
            notes.push('СРЕДНИЙ уровень потенциальной контаминации');
        } else if (contaminationPercentage >= 5) {
            notes.push('НИЗКИЙ уровень потенциальной контаминации');
        }

        return notes.join('. ');
    }

    /**
     * Генерация сводки анализа
     * @param {Array} results - Результаты анализа
     * @returns {Object} Сводка анализа
     */
    generateAnalysisSummary(results) {
        if (results.length === 0) {
            return {
                status: 'clean',
                message: 'Контаминация не обнаружена',
                highest_contamination: 0,
                risk_level: 'low'
            };
        }

        const highestContamination = Math.max(...results.map(r => r.contamination_percentage));
        const highRiskCount = results.filter(r => r.contamination_percentage >= 20).length;
        const mediumRiskCount = results.filter(r => r.contamination_percentage >= 10 && r.contamination_percentage < 20).length;

        let riskLevel = 'low';
        let status = 'potential_contamination';
        let message = 'Обнаружена потенциальная контаминация';

        if (highestContamination >= 20) {
            riskLevel = 'high';
            status = 'contaminated';
            message = 'Обнаружена значительная контаминация';
        } else if (highestContamination >= 10) {
            riskLevel = 'medium';
            message = 'Обнаружена умеренная контаминация';
        }

        return {
            status,
            message,
            highest_contamination: highestContamination,
            risk_level: riskLevel,
            high_risk_matches: highRiskCount,
            medium_risk_matches: mediumRiskCount,
            total_matches: results.length
        };
    }

    /**
     * Получение профиля образца
     * @param {string} sampleProfileId - ID образца
     * @returns {Promise<Object>} Профиль образца
     */
    async getSampleProfile(sampleProfileId) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT * FROM dna_profiles 
                WHERE id = $1 AND is_active = true
            `, [sampleProfileId]);

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Получение истории анализов контаминации для образца
     * @param {string} sampleProfileId - ID образца
     * @returns {Promise<Array>} История анализов
     */
    async getContaminationHistory(sampleProfileId) {
        return await this.contaminationAnalysis.getBySampleId(sampleProfileId);
    }

    /**
     * Получение статистики контаминации
     * @param {Object} filters - Фильтры для статистики
     * @returns {Promise<Object>} Статистика контаминации
     */
    async getContaminationStatistics(filters = {}) {
        return await this.contaminationAnalysis.getStatistics(
            filters.dateFrom, 
            filters.dateTo
        );
    }

    /**
     * Поиск источников контаминации для образца
     * @param {string} sampleProfileId - ID образца
     * @param {number} threshold - Минимальный порог контаминации
     * @returns {Promise<Array>} Потенциальные источники контаминации
     */
    async findContaminationSources(sampleProfileId, threshold = 5.0) {
        return await this.contaminationAnalysis.findContaminationSources(
            sampleProfileId, 
            threshold
        );
    }

    /**
     * Массовый анализ контаминации для нескольких образцов
     * @param {Array} sampleProfileIds - Массив ID образцов
     * @param {string} analyzedBy - ID пользователя
     * @param {Object} options - Параметры анализа
     * @returns {Promise<Object>} Результаты массового анализа
     */
    async bulkAnalyzeContamination(sampleProfileIds, analyzedBy, options = {}) {
        try {
            logger.info(`Начало массового анализа контаминации для ${sampleProfileIds.length} образцов`);

            const results = [];
            const errors = [];

            for (const sampleId of sampleProfileIds) {
                try {
                    const result = await this.analyzeSampleContamination(sampleId, analyzedBy, options);
                    results.push(result);
                } catch (error) {
                    logger.error(`Ошибка при анализе образца ${sampleId}:`, error);
                    errors.push({
                        sample_id: sampleId,
                        error: error.message
                    });
                }
            }

            return {
                total_samples: sampleProfileIds.length,
                successful_analyses: results.length,
                failed_analyses: errors.length,
                results: results,
                errors: errors,
                timestamp: new Date()
            };

        } catch (error) {
            logger.error('Ошибка при массовом анализе контаминации:', error);
            throw error;
        }
    }
}

module.exports = StaffContaminationService;