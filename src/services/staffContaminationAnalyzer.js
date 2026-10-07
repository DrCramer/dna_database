const { informativeAlleles, isSpecialAllele } = require('../utils/alleleTokens');
/**
 * Алгоритм выявления контаминации сотрудников через анализ STR-профилей
 * Адаптирован для интеграции с DNA Analysis Web Application
 * @version 2.0
 */

const { logger } = require('../utils/logger');
const { getAnalysisLoci } = require('../utils/analysisLoci');

class StaffContaminationAnalyzer {
    constructor(pool) {
        this.pool = pool;
        
        // Параметры по умолчанию
        this.defaultOptions = {
            minLociMatch: 8,           // Минимальное число совпадающих локусов
            criticalAlleleCount: 3,    // Количество аллелей для критического локуса
            weightCriticalLocus: 2,    // Вес критического локуса
            stutterThreshold: 0.15,    // Порог для фильтрации stutter-пиков
            threshold: 5.5,            // Минимальный порог v4.0/v5.0 для сохранения (было 50.0 для v1.5)
            useV4Algorithm: false,     // Использовать алгоритм v4.0
            useV5Algorithm: true       // Использовать алгоритм v5.0 (LCN + деградация) - ПО УМОЛЧАНИЮ
        };
        
        // Локусы, исключаемые из анализа количества аллелей
        this.skipLoci = ['gender']; // Служебное поле; реальные локусы включены по умолчанию.
        
        // Дефолтные веса локусов (v4.0) - обновлено 2026-02-16
        this.defaultLocusWeights = {
            'SE33': 2.5,
            'D1S1656': 2.0,
            'D12S391': 2.0,
            'D2S1338': 2.0,
            'D10S1248': 1.8,
            'D22S1045': 1.8,
            'D2S441': 1.8,
            'D18S51': 1.2,
            'FGA': 1.2,
            'D21S11': 1.2,
            'vWA': 1.0,
            'TH01': 1.0,
            'D8S1179': 1.0,
            'D3S1358': 1.0,
            'D19S433': 1.0,
            'D16S539': 1.0,
            'D7S820': 1.0,
            'D13S317': 1.0,
            'D5S818': 1.0,
            'CSF1PO': 0.6,
            'TPOX': 0.5,
            // Специальные локусы
            'Yindel': 0.8,
            'AMEL': 0.8,
            'DYS391': 0.8
        };
        
        // Дефолтные коэффициенты совпадения (v5.0)
        this.defaultMatchCoefficients = {
            fullMatch: 1.0,              // Full Match - полное совпадение
            inclusiveDropout: 0.85,      // Inclusive Drop-out - критично для LCN!
            overInclusiveMix: 0.7,       // Over-Inclusive Mix - смесь
            partialMatch: 0.4,           // Partial Mix - слабый сигнал
            penalty: -1.0                // Mismatch - штраф за несовпадение
        };
    }

    /**
     * Парсит аллели в массив
     * @param {string|Array} value - строка вида "15,16,17" или массив
     * @returns {string[]} массив аллелей
     * 
     * Обработка специальных символов:
     * - "*" и "**" - отсутствующие данные (фильтруются)
     * - "?" - неопределенное значение (может быть любым, фильтруется)
     * - "." - пустое значение (фильтруется)
     * - "14.2" - дробный аллель (обрабатывается как строка)
     * - "14,16,18" - многоаллельность (разделяется на массив)
     */
    parseAlleles(value) { return informativeAlleles(value); }

    /**
     * Вычисляет пересечение двух массивов
     * @param {string[]} arr1
     * @param {string[]} arr2
     * @returns {string[]}
     */
    /**
     * Вычисляет пересечение двух массивов с учетом количества повторений
     * Пример: intersect([29, 29], [29, 32.2]) => [29] (только одно совпадение!)
     * @param {string[]} arr1 - первый массив
     * @param {string[]} arr2 - второй массив
     * @returns {string[]} - массив совпадающих элементов
     */
    intersect(arr1, arr2) {
        const result = [];
        const arr2Copy = [...arr2]; // Копия для отслеживания использованных элементов
        
        for (const value of arr1) {
            const index = arr2Copy.indexOf(value);
            if (index !== -1) {
                result.push(value);
                arr2Copy.splice(index, 1); // Удаляем использованный элемент
            }
        }
        
        return result;
    }

    /**
     * Вычисляет разность двух массивов с учетом количества повторений
     * Пример: difference([29, 29], [29, 32.2]) => [29] (остается одна 29)
     * @param {string[]} arr1 - первый массив
     * @param {string[]} arr2 - второй массив
     * @returns {string[]} - элементы из arr1, которых нет в arr2
     */
    difference(arr1, arr2) {
        const result = [];
        const arr2Copy = [...arr2]; // Копия для отслеживания использованных элементов
        
        for (const value of arr1) {
            const index = arr2Copy.indexOf(value);
            if (index !== -1) {
                arr2Copy.splice(index, 1); // Удаляем совпавший элемент
            } else {
                result.push(value); // Добавляем несовпавший элемент
            }
        }
        
        return result;
    }

    /**
     * Определяет пол по маркерам AMEL и DYS391
     * @param {Object} strData - STR данные профиля
     * @returns {string} 'M' (мужской), 'F' (женский), 'U' (неизвестно)
     */
    determineGender(strData) {
        // Проверка по AMEL
        if (strData.AMEL) {
            const amel = this.parseAlleles(strData.AMEL);
            const amelStr = amel.join('');
            if (amelStr === 'XX' || amel.includes('XX')) return 'F';
            if (amelStr === 'XY' || amel.includes('XY')) return 'M';
        }
        
        // Проверка по Y-хромосомному маркеру DYS391
        if (strData.DYS391) {
            const dys391 = this.parseAlleles(strData.DYS391);
            if (dys391.length > 0 && dys391[0] !== '*' && dys391[0] !== '.') {
                return 'M';
            }
        }
        
        return 'U'; // Unknown
    }

    /**
     * Выявляет контаминацию сотрудника в образце (УЛУЧШЕННЫЙ АЛГОРИТМ v1.2)
     * С реконструкцией остаточного профиля
     * @param {Object} sampleProfile - профиль образца { id, sample_name, str_data }
     * @param {Array} staffProfiles - массив профилей сотрудников
     * @param {Object} options - опции алгоритма
     * @returns {Array} массив результатов для каждого сотрудника
     */
    async detectStaffContamination(sampleProfile, staffProfiles, options = {}) {
        try {
            const opts = { ...this.defaultOptions, ...options };
            const results = [];
            const sampleData = sampleProfile.str_data || {};
            const ignored = Array.isArray(opts.ignoredLoci) ? opts.ignoredLoci : [];
            const allLoci = getAnalysisLoci([sampleProfile, ...staffProfiles]).filter(locus =>
                !this.skipLoci.includes(locus) && !ignored.includes(locus)
            );

            logger.info('Начало анализа контаминации (v4.0 с нормализацией)', {
                sampleId: sampleProfile.id,
                sampleName: sampleProfile.sample_name,
                staffCount: staffProfiles.length,
                lociCount: allLoci.length,
                algorithm: opts.useV4Algorithm ? 'v4.0' : 'v1.5'
            });

            // Определяем пол образца
            const sampleGender = this.determineGender(sampleData);

            for (const staffProfile of staffProfiles) {
                const staffData = staffProfile.str_data || {};
                
                // === ШАГ 1: Проверка половой консистентности ===
                const staffGender = this.determineGender(staffData);
                
                // Женщина не может быть источником мужской ДНК
                if (staffGender === 'F' && sampleGender === 'M') {
                    const dys391 = this.parseAlleles(sampleData.DYS391);
                    if (dys391.length > 0 && dys391[0] !== '*' && dys391[0] !== '.') {
                        continue; // Исключаем из анализа
                    }
                }
                
                // === ШАГ 2: Выбор алгоритма ===
                let evidence;
                
                if (opts.useV5Algorithm) {
                    // Алгоритм v5.0 с поддержкой LCN и деградации
                    evidence = this.analyzeV50(sampleData, staffData, staffProfile, allLoci, {
                        locusWeights: opts.locusWeights,
                        matchCoefficients: opts.matchCoefficients
                    });
                } else if (opts.useV4Algorithm) {
                    // Передаем кастомные параметры в v4.0
                    evidence = this.analyzeV40(sampleData, staffData, staffProfile, allLoci, {
                        locusWeights: opts.locusWeights,
                        matchCoefficients: opts.matchCoefficients
                    });
                } else {
                    evidence = this.analyzeV15(sampleData, staffData, staffProfile, allLoci, opts);
                }
                
                // Добавляем результат если превышен порог
                if (evidence.finalScore >= opts.threshold) {
                    results.push(evidence);
                }
            }

            // Сортировка по finalScore (по убыванию)
            results.sort((a, b) => b.finalScore - a.finalScore);

            logger.info('Анализ контаминации завершен', {
                sampleId: sampleProfile.id,
                resultsCount: results.length,
                highRisk: results.filter(r => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH').length
            });

            return results;

        } catch (error) {
            logger.error('Ошибка при анализе контаминации', {
                sampleId: sampleProfile.id,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Алгоритм v4.0 с нормализацией и штрафами
     * @param {Object} sampleData - STR данные образца
     * @param {Object} staffData - STR данные сотрудника
     * @param {Object} staffProfile - Профиль сотрудника
     * @param {Array} allLoci - Список всех локусов
     * @param {Object} customParams - Кастомные параметры (опционально)
     * @returns {Object} Результаты анализа
     */
    analyzeV40(sampleData, staffData, staffProfile, allLoci, customParams = {}) {
        // Используем кастомные параметры или дефолтные
        const locusWeights = customParams.locusWeights || this.defaultLocusWeights;
        const matchCoeffs = customParams.matchCoefficients || this.defaultMatchCoefficients;
        
        let rawScore = 0;
        let markersEvaluated = 0;
        let fullMatches = 0;
        let partialMatches = 0;
        let penalties = 0;
        const detailedMatches = [];
        
        for (const locus of allLoci) {
            const sampleAlleles = this.parseAlleles(sampleData[locus]);
            const staffAlleles = this.parseAlleles(staffData[locus]);
            
            if (sampleAlleles.length === 0 || staffAlleles.length === 0) continue;
            
            // Вес локуса (кастомный или дефолтный)
            const locusWeight = locusWeights[locus] || 1.0;
            
            // Совпадения (с учетом повторений!)
            const explainedAlleles = this.intersect(sampleAlleles, staffAlleles);
            const explainedCount = explainedAlleles.length;
            const staffCount = staffAlleles.length;
            
            // Коэффициент совпадения (кастомный или дефолтный)
            let matchCoeff;
            if (explainedCount === staffCount && staffCount > 0) {
                matchCoeff = matchCoeffs.fullMatch; // Полное совпадение
                fullMatches++;
            } else if (explainedCount > 0) {
                matchCoeff = matchCoeffs.partialMatch; // Частичное совпадение
                partialMatches++;
            } else {
                matchCoeff = matchCoeffs.penalty; // ШТРАФ
                penalties++;
            }
            
            // Вклад локуса
            const locusScore = locusWeight * matchCoeff;
            rawScore += locusScore;
            markersEvaluated++;
            
            // Сохраняем детали
            detailedMatches.push({
                locus,
                sampleAlleles: [...sampleAlleles],
                staffAlleles: [...staffAlleles],
                explainedAlleles: [...explainedAlleles],
                remainingAlleles: [], // Для совместимости с UI
                locusWeight,
                matchCoeff,
                locusScore: locusScore.toFixed(2),
                isCritical: matchCoeff === matchCoeffs.fullMatch,
                isStrongCritical: matchCoeff === matchCoeffs.fullMatch,
                isFullMatch: matchCoeff === matchCoeffs.fullMatch,
                matchWeight: matchCoeff,
                extraCount: 0
            });
        }
        
        // НОРМАЛИЗАЦИЯ
        const finalScore = markersEvaluated > 0 ? (rawScore / markersEvaluated) * 10 : 0;
        
        // Уровень риска
        let riskLevel, confidence, recommendation;
        if (finalScore > 6) {
            riskLevel = 'CRITICAL';
            confidence = 'CRITICAL';
            recommendation = 'ОТБРАКОВАТЬ: критическая контаминация';
        } else if (finalScore > 4) {
            riskLevel = 'HIGH';
            confidence = 'HIGH';
            recommendation = 'ПОВТОРИТЬ АНАЛИЗ: высокий риск контаминации';
        } else if (finalScore > 3) {
            riskLevel = 'MEDIUM';
            confidence = 'MEDIUM';
            recommendation = 'ПРОВЕРИТЬ: средний риск контаминации';
        } else if (finalScore > 1) {
            riskLevel = 'LOW';
            confidence = 'LOW';
            recommendation = 'НАБЛЮДАТЬ: низкий риск контаминации';
        } else {
            riskLevel = 'CLEAR';
            confidence = 'NONE';
            recommendation = 'ПРИНЯТЬ: контаминация не выявлена';
        }
        
        // Конвертируем скор в проценты для UI (0-10 → 0-100)
        const percentageForUI = parseFloat((finalScore * 10).toFixed(1));
        
        return {
            staffId: staffProfile.id,
            staffName: staffProfile.full_name,
            staffIdentifier: staffProfile.staff_id,
            finalScore: parseFloat(finalScore.toFixed(2)),
            rawScore: parseFloat(rawScore.toFixed(2)),
            markersEvaluated,
            fullMatches,
            partialMatches,
            penalties,
            riskLevel,
            confidence,
            recommendation,
            percentage: percentageForUI, // Процент для UI (0-100)
            detailedMatches,
            // Для совместимости с v1.5 и UI
            matchingLoci: detailedMatches.filter(m => m.matchCoeff > 0).map(m => m.locus),
            criticalLoci: detailedMatches.filter(m => m.matchCoeff === matchCoeffs.fullMatch).map(m => m.locus),
            strongCriticalLoci: detailedMatches.filter(m => m.matchCoeff === matchCoeffs.fullMatch).map(m => m.locus),
            contaminationScore: finalScore / 10, // Нормализуем к 0-1 для совместимости
            // Дополнительные поля для UI
            totalExtraAlleles: 0,
            extraAllelesExplained: fullMatches + partialMatches,
            weightedMatchScore: fullMatches + (partialMatches * 0.5),
            diploidAfterSubtraction: true,
            totalViolationsBefore: 0,
            totalViolationsAfter: 0
        };
    }

    /**
     * Алгоритм v5.0 с поддержкой LCN и деградации
     * @param {Object} sampleData - STR данные образца
     * @param {Object} staffData - STR данные сотрудника
     * @param {Object} staffProfile - Профиль сотрудника
     * @param {Array} allLoci - Список всех локусов
     * @param {Object} customParams - Кастомные параметры (опционально)
     * @returns {Object} Результаты анализа
     */
    analyzeV50(sampleData, staffData, staffProfile, allLoci, customParams = {}) {
        const { calculateContaminationScoreV5 } = require('../utils/contaminationAlgorithmV5');
        
        // Преобразуем данные в формат для v5.0
        const sampleProfile = {};
        const staffProfileData = {};
        
        for (const locus of allLoci) {
            const sampleAlleles = this.parseAlleles(sampleData[locus]);
            const staffAlleles = this.parseAlleles(staffData[locus]);
            
            if (sampleAlleles.length > 0) {
                sampleProfile[locus] = sampleAlleles;
            }
            if (staffAlleles.length > 0) {
                staffProfileData[locus] = staffAlleles;
            }
        }
        
        // Вызываем алгоритм v5.0
        const result = calculateContaminationScoreV5(
            sampleProfile,
            staffProfileData,
            new Set() // Нет игнорируемых локусов
        );
        
        // Преобразуем результат в формат, совместимый с UI
        const detailedMatches = result.locusDetails.map(detail => ({
            locus: detail.locus,
            sampleAlleles: detail.sampleAlleles || [],
            staffAlleles: detail.staffAlleles || [],
            explainedAlleles: detail.explainedAlleles || [],  // Используем правильные совпавшие аллели
            remainingAlleles: [],
            locusWeight: detail.locusWeight,
            matchCoeff: detail.matchCoeff,
            locusScore: detail.score.toFixed(2),
            isCritical: detail.matchType === 'fullMatch' || detail.matchType === 'inclusiveDropout',
            isStrongCritical: detail.isRareCritical,
            isFullMatch: detail.matchType === 'fullMatch',
            matchWeight: detail.matchCoeff,
            extraCount: 0,
            matchType: detail.matchType,
            rarityBonus: detail.rarityBonus
        }));
        
        // Определяем уровень риска на основе level из v5.0
        let riskLevel, confidence, recommendation;
        if (result.level === 'STRONG_CRITICAL') {
            riskLevel = 'CRITICAL';
            confidence = 'CRITICAL';
            recommendation = 'ОТБРАКОВАТЬ: критическая контаминация (правило трех редких или высокий скор)';
        } else if (result.level === 'CRITICAL') {
            riskLevel = 'CRITICAL';
            confidence = 'HIGH';
            recommendation = 'ОТБРАКОВАТЬ: критическая контаминация';
        } else if (result.level === 'WARNING') {
            riskLevel = 'HIGH';
            confidence = 'MEDIUM';
            recommendation = 'ПОВТОРИТЬ АНАЛИЗ: высокий риск контаминации';
        } else {
            riskLevel = 'CLEAR';
            confidence = 'NONE';
            recommendation = 'ПРИНЯТЬ: контаминация не выявлена';
        }
        
        // Конвертируем скор в проценты для UI (0-20+ → 0-100)
        // v5.0 скор может быть > 10, поэтому нормализуем
        const percentageForUI = Math.min(100, parseFloat((result.score * 5).toFixed(1)));
        
        return {
            staffId: staffProfile.id,
            staffName: staffProfile.full_name,
            staffIdentifier: staffProfile.staff_id,
            finalScore: result.score,
            rawScore: result.score,
            markersEvaluated: result.matchedLoci,
            fullMatches: result.matchedLoci,
            partialMatches: 0,
            penalties: 0,
            riskLevel,
            confidence,
            recommendation,
            percentage: percentageForUI,
            detailedMatches,
            // Для совместимости с v1.5 и UI
            matchingLoci: result.matchedLociNames,
            criticalLoci: result.matchedLociNames.filter((_, idx) => 
                detailedMatches[idx]?.isCritical
            ),
            strongCriticalLoci: result.matchedLociNames.filter((_, idx) => 
                detailedMatches[idx]?.isStrongCritical
            ),
            contaminationScore: Math.min(1.0, result.score / 10),
            // Дополнительные поля для UI
            totalExtraAlleles: 0,
            extraAllelesExplained: result.matchedLoci,
            weightedMatchScore: result.matchedLoci,
            diploidAfterSubtraction: true,
            totalViolationsBefore: 0,
            totalViolationsAfter: 0,
            // Специфичные для v5.0
            algorithm: 'v5.0',
            level: result.level,
            severity: result.severity,
            rareCriticalMatches: result.rareCriticalMatches,
            rareRuleTriggered: result.rareRuleTriggered
        };
    }

    /**
     * Алгоритм v1.5 (старый, для совместимости)
     */
    analyzeV15(sampleData, staffData, staffProfile, allLoci, opts) {
        const reconstructedProfile = {};
        const evidence = {
            staffId: staffProfile.id,
            staffName: staffProfile.full_name,
            staffIdentifier: staffProfile.staff_id,
            matchingLoci: [],
            criticalLoci: [],
            strongCriticalLoci: [],
            totalViolationsBefore: 0,
            totalViolationsAfter: 0,
            totalExtraAlleles: 0,
            extraAllelesExplained: 0,
            weightedMatchScore: 0,
            diploidAfterSubtraction: false,
            detailedMatches: []
        };

        let totalLociAnalyzed = 0;
        let violationsBefore = 0;
        let violationsAfter = 0;

        for (const locus of allLoci) {
            const sampleAlleles = this.parseAlleles(sampleData[locus]);
            const staffAlleles = this.parseAlleles(staffData[locus]);
            
            if (sampleAlleles.length === 0) continue;
            totalLociAnalyzed++;

            if (sampleAlleles.length > 2) violationsBefore++;

            const explainedAlleles = this.intersect(sampleAlleles, staffAlleles);
            const explainedCount = explainedAlleles.length;

            const remainingAlleles = this.difference(sampleAlleles, staffAlleles);
            
            let finalAlleles;
            if (remainingAlleles.length === 0) {
                if (explainedCount === sampleAlleles.length && sampleAlleles.length <= 2) {
                    finalAlleles = sampleAlleles.length === 2 && sampleAlleles[0] === sampleAlleles[1]
                        ? [sampleAlleles[0]]
                        : sampleAlleles;
                } else {
                    finalAlleles = staffAlleles.length > 0 ? [staffAlleles[0]] : [];
                }
            } else {
                finalAlleles = remainingAlleles;
            }

            reconstructedProfile[locus] = finalAlleles;

            if (finalAlleles.length > 2) violationsAfter++;
            
            const matchWeight = explainedCount >= 2 ? 1.0 : 
                               explainedCount === 1 ? 0.5 : 
                               0;
            
            const isFullMatch = sampleAlleles.length > 0 && 
                               explainedCount === sampleAlleles.length;
            
            const isCritical = (sampleAlleles.length >= 3 && explainedCount > 0) || 
                              isFullMatch;
            
            const isStrongCritical = (sampleAlleles.length >= 3 && explainedCount >= 2) ||
                                    (isFullMatch && sampleAlleles.length >= 2);

            if (explainedCount > 0) {
                evidence.matchingLoci.push(locus);
                evidence.extraAllelesExplained += explainedCount;
                evidence.weightedMatchScore += matchWeight;
                
                if (isCritical) {
                    evidence.criticalLoci.push(locus);
                }
                
                if (isStrongCritical) {
                    evidence.strongCriticalLoci.push(locus);
                }
            }

            const extraCount = Math.max(0, sampleAlleles.length - 2);
            evidence.totalExtraAlleles += extraCount;

            evidence.detailedMatches.push({
                locus,
                sampleAlleles: [...sampleAlleles],
                staffAlleles: [...staffAlleles],
                remainingAlleles: [...finalAlleles],
                explainedAlleles: [...explainedAlleles],
                extraCount: extraCount,
                isCritical: isCritical,
                isStrongCritical: isStrongCritical,
                isFullMatch: isFullMatch,
                matchWeight: matchWeight
            });
        }

        evidence.totalViolationsBefore = violationsBefore;
        evidence.totalViolationsAfter = violationsAfter;
        evidence.diploidAfterSubtraction = (violationsAfter === 0);
        evidence.reconstructedProfile = reconstructedProfile;

        // Расчёт скора v1.5
        let contaminationScore = 0;

        if (evidence.matchingLoci.length >= opts.minLociMatch && totalLociAnalyzed > 0) {
            let diploidScore = 0;
            if (evidence.diploidAfterSubtraction) {
                diploidScore = 0.5;
            } else {
                const improvement = Math.max(0, evidence.totalViolationsBefore - evidence.totalViolationsAfter);
                const improvementRatio = improvement / Math.max(1, evidence.totalViolationsBefore);
                const remainingPenalty = evidence.totalViolationsAfter * 0.05;
                diploidScore = Math.max(0, improvementRatio * 0.5 - remainingPenalty);
            }

            const strongCriticalRatio = evidence.strongCriticalLoci.length / totalLociAnalyzed;
            const strongCriticalScore = Math.min(0.3, strongCriticalRatio * 1.2);

            const weightedRatio = evidence.weightedMatchScore / totalLociAnalyzed;
            const explainedScore = Math.min(0.15, weightedRatio * 0.4);

            const matchRatio = evidence.extraAllelesExplained / Math.max(1, evidence.totalExtraAlleles);
            const matchBonus = Math.min(0.05, matchRatio * 0.05);

            contaminationScore = Math.min(1.0, 
                diploidScore +
                strongCriticalScore +
                explainedScore +
                matchBonus
            );
            
            if (evidence.strongCriticalLoci.length >= 8 && evidence.diploidAfterSubtraction) {
                contaminationScore = Math.min(1.0, contaminationScore + 0.05);
            }
            
            if (evidence.strongCriticalLoci.length < 5) {
                contaminationScore *= 0.85;
            }
        }

        const confidence = 
            contaminationScore >= 0.85 ? 'CRITICAL' :
            contaminationScore >= 0.70 ? 'HIGH' :
            contaminationScore >= 0.50 ? 'MEDIUM' :
            contaminationScore >= 0.30 ? 'LOW' : 'NONE';

        const recommendation = 
            contaminationScore >= 0.80 ? 'ОТБРАКОВАТЬ: критическая контаминация' :
            contaminationScore >= 0.60 ? 'ПОВТОРИТЬ АНАЛИЗ: подозрение на контаминацию' :
            contaminationScore >= 0.40 ? 'ПРОВЕРИТЬ: возможна следовая примесь' :
            'ПРИНЯТЬ: контаминация не выявлена';

        const percentage = (contaminationScore * 100).toFixed(1);

        return {
            ...evidence,
            contaminationScore,
            confidence,
            recommendation,
            percentage: parseFloat(percentage),
            finalScore: parseFloat(percentage), // Для совместимости с v4.0
            riskLevel: confidence
        };
    }

    /**
     * Анализ образца на контаминацию с сохранением результатов в БД
     * @param {string} sampleProfileId - ID образца для анализа
     * @param {string} analyzedBy - ID пользователя, проводящего анализ
     * @param {Object} options - Дополнительные параметры анализа
     * @returns {Promise<Object>} Результаты анализа контаминации
     */
    async analyzeSample(sampleProfileId, analyzedBy, options = {}) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            // Получаем образец для анализа
            const sampleResult = await client.query(`
                SELECT id, sample_name, internal_number, str_data
                FROM dna_profiles 
                WHERE id = $1 AND is_active = true
            `, [sampleProfileId]);

            if (sampleResult.rows.length === 0) {
                throw new Error(`Образец с ID ${sampleProfileId} не найден`);
            }

            const sampleProfile = sampleResult.rows[0];

            // Получаем все активные профили сотрудников
            const staffResult = await client.query(`
                SELECT id, staff_id, full_name, str_data
                FROM staff_profiles
                WHERE is_active = true
                ORDER BY full_name
            `);

            const staffProfiles = staffResult.rows;

            logger.info('Загружены профили для анализа', {
                sampleId: sampleProfileId,
                staffCount: staffProfiles.length
            });

            // Выполняем анализ
            const results = await this.detectStaffContamination(
                sampleProfile,
                staffProfiles,
                options
            );

            // Сохраняем результаты в БД
            for (const result of results) {
                await client.query(`
                    INSERT INTO contamination_analysis (
                        sample_profile_id,
                        staff_profile_id,
                        contamination_percentage,
                        confidence_level,
                        locus_matches,
                        analyzed_by,
                        analysis_method,
                        notes
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    sampleProfileId,
                    result.staffId,
                    result.percentage,
                    result.contaminationScore * 100, // Сохраняем как число
                    JSON.stringify({
                        matchingLoci: result.matchingLoci,
                        criticalLoci: result.criticalLoci,
                        detailedMatches: result.detailedMatches,
                        confidence: result.confidence // Сохраняем текстовый уровень в JSON
                    }),
                    analyzedBy,
                    'str_contamination_v2',
                    result.recommendation
                ]);
            }

            await client.query('COMMIT');

            return {
                sample_profile_id: sampleProfileId,
                sample_name: sampleProfile.sample_name,
                internal_number: sampleProfile.internal_number,
                total_staff_analyzed: staffProfiles.length,
                contamination_cases: results.length,
                results: results,
                timestamp: new Date()
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Ошибка при анализе образца на контаминацию', {
                sampleId: sampleProfileId,
                error: error.message
            });
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Массовый анализ контаминации для нескольких образцов
     * @param {Array} sampleProfileIds - Массив ID образцов
     * @param {string} analyzedBy - ID пользователя
     * @param {Object} options - Параметры анализа
     * @returns {Promise<Object>} Результаты массового анализа
     */
    async bulkAnalyze(sampleProfileIds, analyzedBy, options = {}) {
        try {
            logger.info('Начало массового анализа контаминации', {
                samplesCount: sampleProfileIds.length,
                analyzedBy
            });

            const results = [];
            const errors = [];

            for (const sampleId of sampleProfileIds) {
                try {
                    const result = await this.analyzeSample(sampleId, analyzedBy, options);
                    results.push(result);
                } catch (error) {
                    logger.error('Ошибка при анализе образца', {
                        sampleId,
                        error: error.message
                    });
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
            logger.error('Ошибка при массовом анализе контаминации', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Получение истории анализов контаминации для образца
     * @param {string} sampleProfileId - ID образца
     * @returns {Promise<Array>} История анализов
     */
    async getHistory(sampleProfileId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    ca.*,
                    sp.full_name as staff_name,
                    sp.staff_id as staff_identifier,
                    u.username as analyzed_by_username
                FROM contamination_analysis ca
                LEFT JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                LEFT JOIN users u ON ca.analyzed_by = u.id
                WHERE ca.sample_profile_id = $1
                ORDER BY ca.analysis_date DESC
            `, [sampleProfileId]);

            return result.rows;
        } catch (error) {
            logger.error('Ошибка получения истории анализов', {
                sampleId: sampleProfileId,
                error: error.message
            });
            throw error;
        }
    }
}

module.exports = StaffContaminationAnalyzer;
