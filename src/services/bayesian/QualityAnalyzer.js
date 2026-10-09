/**
 * Quality Analyzer - Comprehensive quality assessment for genetic samples
 * 
 * This class implements all quality control metrics including:
 * - Profile Completeness Index (PCI)
 * - Heterozygosity analysis
 * - Degradation index calculation
 * - Contamination detection
 * - Duplicate search
 * - Perspective category assignment
 */

const { logger } = require('../../utils/logger');
const { LociTypeDetector, LOCI_TYPES } = require('../../utils/lociTypeDetector');
const { ValidationUtils, Classifications, Thresholds } = require('./types');
const { GeneticSample, PopulationFrequencies } = require('./models');
const { query } = require('../../config/database');
const locusTypeDetector = new LociTypeDetector();

class QualityAnalyzer {
    constructor(populationManager, systemParameters) {
        this.populationManager = populationManager || new PopulationFrequencies();
        this.systemParameters = systemParameters || {};
        
        // Инициализация пороговых значений из types.js
        this.thresholds = Thresholds;
        
        // Классификации из types.js
        this.classifications = Classifications;
        
        logger.info('QualityAnalyzer инициализирован');
    }

    /**
     * Calculate Profile Completeness Index (PCI)
     * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
     * 
     * @param {GeneticSample} sample - Genetic sample to analyze
     * @returns {Promise<Object>} PCI analysis result
     */
    async calculatePCI(sample) {
        try {
            // Валидация входного образца
            if (!sample || !sample.id) {
                throw new Error('Некорректный образец для анализа PCI');
            }

            // Стандартные локусы CODIS/ESS для расчета PCI
            const STANDARD_LOCI = [
                'D3S1358', 'vWA', 'FGA', 'D8S1179', 'D21S11', 'D18S51', 'D5S818', 'D13S317',
                'D7S820', 'D16S539', 'TH01', 'TPOX', 'CSF1PO', 'D19S433', 'D2S1338', 'D12S391',
                'D1S1656', 'D22S1045', 'D10S1248', 'SE33', 'DYS391', 'AMEL', 'D6S1043', 'D9S1122',
                'D17S1301', 'D20S482', 'D14S1434', 'D15S1515', 'D11S4463', 'D4S2408', 'D2S441'
            ];

            const totalLoci = STANDARD_LOCI.length; // Всегда 31 стандартный локус
            let analyzedLoci = 0;

            // Получаем STR данные образца
            let strData = null;
            if (sample.str_data && Object.keys(sample.str_data).length > 0) {
                strData = sample.str_data;
            } else if (sample.rawData && sample.rawData.str_data) {
                try {
                    strData = typeof sample.rawData.str_data === 'string' 
                        ? JSON.parse(sample.rawData.str_data) 
                        : sample.rawData.str_data;
                } catch (parseError) {
                    logger.warn(`Ошибка парсинга STR данных для образца ${sample.id}:`, parseError);
                }
            } else if (sample.loci && sample.loci.size > 0) {
                // Преобразуем Map в объект
                strData = {};
                for (const [locusName, locusData] of sample.loci) {
                    // Сохраняем в новом формате (массив)
                    if (locusData.alleles) {
                        strData[locusName] = locusData.alleles;
                    } else if (locusData.allele1 || locusData.allele2) {
                        // Старый формат
                        strData[locusName] = [locusData.allele1, locusData.allele2].filter(a => a);
                    }
                }
            }

            if (!strData) {
                // Если нет данных, возвращаем 0 проанализированных локусов
                analyzedLoci = 0;
            } else {
                // Подсчитываем только стандартные локусы с качественными данными
                for (const locusName of STANDARD_LOCI) {
                    const locusData = strData[locusName];
                    
                    // Проверка для нового формата (массив)
                    if (Array.isArray(locusData)) {
                        const validAlleles = locusData.filter(a => 
                            a && a !== '' && a !== '0' && a !== 'null' && a !== '**'
                        );
                        if (validAlleles.length > 0) {
                            analyzedLoci++;
                        }
                    } 
                    // Проверка для старого формата (объект)
                    else if (locusData && locusData.allele1 && locusData.allele2 && 
                        locusData.allele1 !== '0' && locusData.allele2 !== '0' &&
                        locusData.allele1 !== '' && locusData.allele2 !== '' &&
                        locusData.allele1 !== 'null' && locusData.allele2 !== 'null' &&
                        locusData.allele1 !== '**' && locusData.allele2 !== '**') {
                        analyzedLoci++;
                    }
                }
            }

            // Расчет PCI только по стандартным локусам
            const pciValue = totalLoci > 0 ? analyzedLoci / totalLoci : 0;

            // Валидация PCI
            if (pciValue < 0 || pciValue > 1) {
                throw new Error(`Некорректное значение PCI: ${pciValue}`);
            }

            // Классификация PCI с пороговыми значениями из types.js
            let classification, colorCode, recommendation;
            if (pciValue >= this.thresholds.PCI.FULL) {
                classification = this.classifications.PCI.FULL;
                colorCode = '#2d8f2d'; // Green
                recommendation = 'Образец пригоден для всех видов анализа';
            } else if (pciValue >= this.thresholds.PCI.MODERATELY_INCOMPLETE) {
                classification = this.classifications.PCI.MODERATELY_INCOMPLETE;
                colorCode = '#5cb85c'; // Light green
                recommendation = 'Образец пригоден для большинства анализов';
            } else if (pciValue >= this.thresholds.PCI.SEVERELY_INCOMPLETE) {
                classification = this.classifications.PCI.SEVERELY_INCOMPLETE;
                colorCode = '#f0ad4e'; // Orange
                recommendation = 'Образец пригоден для ограниченного анализа';
            } else {
                classification = this.classifications.PCI.CRITICALLY_INCOMPLETE;
                colorCode = '#d9534f'; // Red
                recommendation = 'Образец не рекомендуется для анализа';
            }

            const result = {
                totalLoci,
                analyzedLoci,
                pciValue,
                classification,
                colorCode,
                recommendation,
                percentage: Math.round(pciValue * 100),
                timestamp: new Date(),
                details: {
                    missingLoci: totalLoci - analyzedLoci,
                    completenessLevel: pciValue >= 0.8 ? 'high' : pciValue >= 0.6 ? 'medium' : 'low',
                    standardLociUsed: STANDARD_LOCI.length,
                    note: 'PCI рассчитан только по стандартным локусам CODIS/ESS'
                }
            };

            logger.info(`PCI рассчитан для образца ${sample.id}: ${pciValue ? pciValue.toFixed(3) : '0.000'} (${classification})`);
            return result;

        } catch (error) {
            logger.error(`Ошибка расчета PCI для образца ${sample?.id || 'неизвестен'}:`, error);
            throw new Error(`Ошибка расчета PCI: ${error.message}`);
        }
    }
    /**
     * Calculate heterozygosity analysis
     * Requirements: 2.1, 2.2, 2.3, 2.4
     * 
     * @param {GeneticSample} sample - Genetic sample to analyze
     * @returns {Promise<Object>} Heterozygosity analysis result
     */
    async calculateHeterozygosity(sample) {
        try {
            // Валидация входного образца
            if (!sample || !sample.id) {
                throw new Error('Некорректный образец для анализа гетерозиготности');
            }

            let heterozygousLoci = 0;
            let analyzedLoci = 0;
            const heterozygosityByLocus = new Map();

            // Обработка реальных данных из базы
            if (sample.rawData && sample.rawData.str_data) {
                try {
                    const strData = typeof sample.rawData.str_data === 'string' 
                        ? JSON.parse(sample.rawData.str_data) 
                        : sample.rawData.str_data;
                    
                    for (const [locusName, locusData] of Object.entries(strData)) {
                        if (locusTypeDetector.detectLocusType(locusName) === LOCI_TYPES.Y_INDEL) continue;
                        // Новый формат: массив
                        if (Array.isArray(locusData)) {
                            const validAlleles = locusData.filter(a => 
                                a && a !== '' && a !== '0' && a !== 'null'
                            );
                            
                            if (validAlleles.length > 0) {
                                analyzedLoci++;
                                
                                // Проверяем гетерозиготность (разные аллели)
                                const uniqueAlleles = [...new Set(validAlleles)];
                                const isHeterozygous = uniqueAlleles.length > 1;
                                if (isHeterozygous) {
                                    heterozygousLoci++;
                                }
                                
                                heterozygosityByLocus.set(locusName, isHeterozygous ? 1 : 0);
                            }
                        }
                        // Старый формат: объект
                        else if (locusData && locusData.allele1 && locusData.allele2 && 
                            locusData.allele1 !== '0' && locusData.allele2 !== '0' &&
                            locusData.allele1 !== '' && locusData.allele2 !== '' &&
                            locusData.allele1 !== 'null' && locusData.allele2 !== 'null') {
                            
                            analyzedLoci++;
                            
                            // Проверяем гетерозиготность (allele1 ≠ allele2)
                            const isHeterozygous = locusData.allele1 !== locusData.allele2;
                            if (isHeterozygous) {
                                heterozygousLoci++;
                            }
                            
                            heterozygosityByLocus.set(locusName, isHeterozygous ? 1 : 0);
                        }
                    }
                } catch (parseError) {
                    logger.warn(`Ошибка парсинга STR данных для анализа гетерозиготности образца ${sample.id}:`, parseError);
                }
            } else if (sample.str_data && Object.keys(sample.str_data).length > 0) {
                // Используем str_data напрямую из GeneticSample
                for (const [locusName, locusData] of Object.entries(sample.str_data)) {
                    if (locusTypeDetector.detectLocusType(locusName) === LOCI_TYPES.Y_INDEL) continue;
                    // Новый формат: массив
                    if (Array.isArray(locusData)) {
                        const validAlleles = locusData.filter(a => 
                            a && a !== '' && a !== '0' && a !== 'null'
                        );
                        
                        if (validAlleles.length > 0) {
                            analyzedLoci++;
                            
                            // Проверяем гетерозиготность (разные аллели)
                            const uniqueAlleles = [...new Set(validAlleles)];
                            const isHeterozygous = uniqueAlleles.length > 1;
                            if (isHeterozygous) {
                                heterozygousLoci++;
                            }
                            
                            heterozygosityByLocus.set(locusName, isHeterozygous ? 1 : 0);
                        }
                    }
                    // Старый формат: объект
                    else if (locusData && locusData.allele1 && locusData.allele2 && 
                        locusData.allele1 !== '0' && locusData.allele2 !== '0' &&
                        locusData.allele1 !== '' && locusData.allele2 !== '' &&
                        locusData.allele1 !== 'null' && locusData.allele2 !== 'null') {
                        
                        analyzedLoci++;
                        
                        // Проверяем гетерозиготность (allele1 ≠ allele2)
                        const isHeterozygous = locusData.allele1 !== locusData.allele2;
                        if (isHeterozygous) {
                            heterozygousLoci++;
                        }
                        
                        heterozygosityByLocus.set(locusName, isHeterozygous ? 1 : 0);
                    }
                }
            } else if (sample.loci && sample.loci.size > 0) {
                // Используем новую модель LocusData
                for (const [locusName, locusData] of sample.loci) {
                    if (locusTypeDetector.detectLocusType(locusName) === LOCI_TYPES.Y_INDEL) continue;
                    if (locusData.isAnalyzed()) {
                        analyzedLoci++;
                        
                        // Проверяем гетерозиготность (allele1 ≠ allele2)
                        const isHeterozygous = locusData.isHeterozygous();
                        if (isHeterozygous) {
                            heterozygousLoci++;
                        }
                        
                        heterozygosityByLocus.set(locusName, isHeterozygous ? 1 : 0);
                    }
                }
            } else {
                // Если нет данных, возвращаем нулевые значения
                analyzedLoci = 0;
                heterozygousLoci = 0;
            }

            // Расчет коэффициентов
            const observedHeterozygosity = analyzedLoci > 0 ? heterozygousLoci / analyzedLoci : 0;
            
            // Расчет ожидаемой гетерозиготности на основе популяционных частот
            let expectedHeterozygosity = 0;
            if (analyzedLoci > 0 && this.populationManager) {
                let totalExpectedHe = 0;
                let validLoci = 0;
                
                for (const [locusName, hetValue] of heterozygosityByLocus) {
                    try {
                        // Для гомозиготных локусов ожидаемая гетерозиготность = 0
                        if (hetValue === 0) {
                            totalExpectedHe += 0;
                        } else {
                            // Для гетерозиготных локусов рассчитываем на основе частот
                            // Упрощенный расчет: He = 2pq где p и q - частоты аллелей
                            const freq1 = await this.populationManager.getFrequency(locusName, 'allele1');
                            const freq2 = await this.populationManager.getFrequency(locusName, 'allele2');
                            const he = 2 * freq1 * freq2;
                            totalExpectedHe += he;
                        }
                        validLoci++;
                    } catch (error) {
                        // Если не удается получить частоты, используем среднее значение
                        totalExpectedHe += 0.7;
                        validLoci++;
                    }
                }
                
                expectedHeterozygosity = validLoci > 0 ? totalExpectedHe / validLoci : 0;
            } else {
                expectedHeterozygosity = 0;
            }
            
            // Коэффициент инбридинга
            const inbreedingCoefficient = expectedHeterozygosity > 0 ? 
                Math.max(-1, Math.min(1, (expectedHeterozygosity - observedHeterozygosity) / expectedHeterozygosity)) : 0;

            // Классификация результатов
            let classification, colorCode, interpretation;
            if (observedHeterozygosity >= 0.65) {
                classification = 'Нормальная гетерозиготность';
                colorCode = '#2d8f2d';
                interpretation = 'Образец показывает нормальный уровень генетического разнообразия';
            } else if (observedHeterozygosity >= 0.50) {
                classification = 'Умеренно сниженная гетерозиготность';
                colorCode = '#f0ad4e';
                interpretation = 'Образец показывает умеренное снижение генетического разнообразия';
            } else if (observedHeterozygosity >= 0.30) {
                classification = 'Низкая гетерозиготность';
                colorCode = '#d9534f';
                interpretation = 'Образец показывает значительное снижение генетического разнообразия';
            } else {
                classification = 'Критически низкая гетерозиготность';
                colorCode = '#8b0000';
                interpretation = 'Образец показывает критически низкий уровень генетического разнообразия';
            }

            const result = {
                analyzedLoci,
                heterozygousLoci,
                homozygousLoci: analyzedLoci - heterozygousLoci,
                observedHeterozygosity,
                expectedHeterozygosity,
                inbreedingCoefficient,
                classification,
                colorCode,
                interpretation,
                heterozygosityByLocus,
                percentage: Math.round(observedHeterozygosity * 100),
                timestamp: new Date()
            };

            logger.info(`Гетерозиготность рассчитана для образца ${sample.id}: наблюдаемая=${observedHeterozygosity ? observedHeterozygosity.toFixed(3) : '0.000'} (${classification})`);
            return result;

        } catch (error) {
            logger.error(`Ошибка расчета гетерозиготности для образца ${sample?.id || 'неизвестен'}:`, error);
            throw new Error(`Ошибка расчета гетерозиготности: ${error.message}`);
        }
    }

    /**
     * Calculate degradation index
     * Requirements: 3.1, 3.2, 3.3, 3.4
     * 
     * @param {GeneticSample} sample - Genetic sample to analyze
     * @returns {Promise<Object>} Degradation analysis result
     */
    async calculateDegradationIndex(sample) {
        try {
            // Валидация входного образца
            if (!sample || !sample.id) {
                throw new Error('Некорректный образец для анализа деградации');
            }

            // Получаем анализ гетерозиготности
            const hetAnalysis = await this.calculateHeterozygosity(sample);
            
            // Расчет индекса деградации на основе гетерозиготности
            const degradationValue = Math.max(0, 1 - hetAnalysis.observedHeterozygosity);

            // Классификация деградации с использованием констант из types.js
            let classification, colorCode, interpretation;
            if (degradationValue < this.thresholds.DEGRADATION.MINIMAL) {
                classification = this.classifications.DEGRADATION.MINIMAL;
                colorCode = '#2d8f2d';
                interpretation = 'Образец хорошо сохранился';
            } else if (degradationValue < this.thresholds.DEGRADATION.MODERATE) {
                classification = this.classifications.DEGRADATION.MODERATE;
                colorCode = '#f0ad4e';
                interpretation = 'Образец частично деградирован';
            } else {
                classification = this.classifications.DEGRADATION.SEVERE;
                colorCode = '#d9534f';
                interpretation = 'Образец сильно деградирован';
            }

            const result = {
                degradationValue,
                classification,
                colorCode,
                interpretation,
                affectedLoci: degradationValue > 0.3 ? ['D3S1358', 'vWA'] : [],
                recommendations: degradationValue < 0.3 ? 
                    ['Образец пригоден для всех видов анализа'] : 
                    ['Рекомендуется дополнительная очистка', 'Ограниченное использование в анализе'],
                timestamp: new Date()
            };

            logger.info(`Деградация рассчитана для образца ${sample.id}: ${degradationValue ? degradationValue.toFixed(3) : '0.000'} (${classification})`);
            return result;

        } catch (error) {
            logger.error(`Ошибка расчета деградации для образца ${sample?.id || 'неизвестен'}:`, error);
            throw new Error(`Ошибка расчета деградации: ${error.message}`);
        }
    }

    /**
     * Detect contamination
     * Requirements: 4.1, 4.2, 4.3, 4.4
     */
    async detectContamination(sample) {
        try {
            // Валидация входного образца
            if (!sample || !sample.id) {
                throw new Error('Некорректный образец для анализа контаминации');
            }

            // Получаем профили сотрудников из базы данных
            const staffProfiles = await this.getStaffProfiles();
            
            let maxMatchingLoci = 0;
            let suspectedStaff = null;
            const triAllelicLoci = [];
            
            // Получаем STR данные образца
            const sampleStrData = this.extractStrData(sample);
            
            // Проверяем триаллельные локусы (Property 8)
            for (const [locusName, locusData] of Object.entries(sampleStrData)) {
                if (this.hasTripleAlleles(locusData)) {
                    triAllelicLoci.push(locusName);
                }
            }
            
            // Сравниваем с каждым сотрудником (Property 7)
            for (const staffMember of staffProfiles) {
                const matchingLoci = this.countMatchingLoci(sampleStrData, staffMember.str_data);
                
                if (matchingLoci > maxMatchingLoci) {
                    maxMatchingLoci = matchingLoci;
                    suspectedStaff = {
                        id: staffMember.id,
                        name: staffMember.internal_number || staffMember.sample_name || 'Неизвестный сотрудник',
                        sampleName: staffMember.sample_name,
                        geneticProfile: staffMember.str_data,
                        userId: staffMember.user_id
                    };
                }
            }
            
            // Определяем контаминацию (>= 2 локуса с лишними аллелями)
            const isContaminated = maxMatchingLoci >= 2;
            const mixtureSuspicion = triAllelicLoci.length > 0;
            
            const result = {
                isContaminated,
                suspectedStaff: isContaminated ? suspectedStaff : null,
                matchingLoci: maxMatchingLoci,
                mixtureSuspicion,
                triAllelicLoci,
                colorCode: isContaminated ? '#d9534f' : '#2d8f2d',
                interpretation: isContaminated ? 
                    `Обнаружена возможная контаминация с профилем ${suspectedStaff?.name}` :
                    'Контаминация не обнаружена',
                timestamp: new Date()
            };

            logger.info(`Контаминация проанализирована для образца ${sample.id}: ${isContaminated ? 'ОБНАРУЖЕНА' : 'НЕ ОБНАРУЖЕНА'} (${maxMatchingLoci} совпадений)`);
            return result;

        } catch (error) {
            logger.error(`Ошибка поиска контаминации для образца ${sample?.id || 'неизвестен'}:`, error);
            throw new Error(`Contamination detection failed: ${error.message}`);
        }
    }

    /**
     * Get staff profiles from database
     * @returns {Promise<Array>} Array of staff genetic profiles
     */
    async getStaffProfiles() {
        const result = await query(`
            SELECT id, sample_name, internal_number, str_data, user_id
            FROM dna_profiles 
            WHERE profile_type = 'staff' AND is_active = true
            ORDER BY upload_date
        `);
        
        return result.rows || [];
    }

    /**
     * Extract STR data from sample in consistent format
     * @param {GeneticSample} sample - Genetic sample
     * @returns {Object} STR data object
     */
    extractStrData(sample) {
        if (sample.str_data && typeof sample.str_data === 'object') {
            return sample.str_data;
        } else if (sample.rawData && sample.rawData.str_data) {
            try {
                return typeof sample.rawData.str_data === 'string' 
                    ? JSON.parse(sample.rawData.str_data) 
                    : sample.rawData.str_data;
            } catch (error) {
                logger.warn(`Error parsing STR data for sample ${sample.id}:`, error);
                return {};
            }
        } else if (sample.loci && sample.loci.size > 0) {
            const strData = {};
            for (const [locusName, locusData] of sample.loci) {
                if (locusData.isAnalyzed()) {
                    strData[locusName] = {
                        allele1: locusData.allele1,
                        allele2: locusData.allele2
                    };
                }
            }
            return strData;
        }
        return {};
    }

    /**
     * Check if locus has triple alleles (mixture indication)
     * @param {Object} locusData - Locus data with allele1 and allele2
     * @returns {boolean} True if triple alleles detected
     */
    hasTripleAlleles(locusData) {
        if (!locusData || !locusData.allele1 || !locusData.allele2) {
            return false;
        }
        
        // Проверяем наличие запятых в аллелях (указывает на множественные аллели)
        const allele1Parts = locusData.allele1.toString().split(',');
        const allele2Parts = locusData.allele2.toString().split(',');
        
        // Если в любом из аллелей больше одного значения, это триаллельный локус
        return allele1Parts.length > 1 || allele2Parts.length > 1;
    }

    /**
     * Detect contamination by looking for extra alleles that match staff profile
     * @param {Object} sampleProfile - Sample genetic profile (potentially contaminated)
     * @param {Object} staffProfile - Staff genetic profile (potential contaminant)
     * @returns {number} Number of loci showing contamination evidence
     */
    countMatchingLoci(sampleProfile, staffProfile) {
        let contaminatedLoci = 0;
        
        // Handle case where staffProfile might be a JSON string
        let parsedStaffProfile = staffProfile;
        if (typeof staffProfile === 'string') {
            try {
                parsedStaffProfile = JSON.parse(staffProfile);
            } catch (error) {
                logger.warn('Error parsing staff profile JSON:', error);
                return 0;
            }
        }
        
        if (!sampleProfile || !parsedStaffProfile || typeof sampleProfile !== 'object' || typeof parsedStaffProfile !== 'object') {
            return 0;
        }
        
        for (const [locusName, sampleLocusData] of Object.entries(sampleProfile)) {
            const staffLocusData = parsedStaffProfile[locusName];
            
            if (!staffLocusData || !sampleLocusData) {
                continue;
            }
            
            // Получаем аллели образца и сотрудника
            const sampleAlleles = this.getAlleles(sampleLocusData);
            const staffAlleles = this.getAlleles(staffLocusData);
            
        // Проверяем контаминацию: есть ли в образце >2 аллелей?
        if (sampleAlleles.length > 2) {
            // Есть лишние аллели - проверяем, есть ли среди них аллели сотрудника
            const staffAllelesInSample = sampleAlleles.filter(sampleAllele => 
                staffAlleles.includes(sampleAllele)
            );
            
            // Если в образце есть аллели сотрудника И общее количество аллелей > 2,
            // это признак контаминации
            if (staffAllelesInSample.length > 0) {
                contaminatedLoci++;
            }
        } else if (sampleAlleles.length === 2) {
            // НЕ считаем полные совпадения отдельных локусов контаминацией
            // Полное совпадение 2-3 локусов статистически возможно между неродственными людьми
            // Контаминация проявляется через ЛИШНИЕ аллели, а не через совпадения
        }
        }
        
        return contaminatedLoci;
    }

    /**
     * Extract all alleles from locus data
     * @param {Object} locusData - Locus data with allele1 and allele2
     * @returns {Array<string>} Array of alleles
     */
    getAlleles(locusData) {
        const alleles = [];
        
        if (locusData.allele1) {
            const allele1Parts = locusData.allele1.toString().split(',');
            alleles.push(...allele1Parts.map(a => a.trim()));
        }
        
        if (locusData.allele2) {
            const allele2Parts = locusData.allele2.toString().split(',');
            alleles.push(...allele2Parts.map(a => a.trim()));
        }
        
        // Удаляем дубликаты и пустые значения
        return [...new Set(alleles.filter(a => a && a !== ''))];
    }

    /**
     * Find duplicates
     * Requirements: 5.1, 5.2, 5.3, 5.4
     */
    async findDuplicates(sample) {
        try {
            // Получаем информацию о департаменте образца для правильной изоляции
            let departmentId = null;
            if (sample.userId || sample.user_id) {
                const userResult = await query(`
                    SELECT department_id FROM users 
                    WHERE id = $1 AND is_active = true
                `, [sample.userId || sample.user_id]);
                
                if (userResult.rows.length > 0) {
                    departmentId = userResult.rows[0].department_id;
                }
            }

            // Получаем все образцы из базы данных для сравнения с учетом департаментной изоляции
            let queryText, queryParams;
            
            if (departmentId) {
                // Поиск только в пределах департамента (правильная изоляция)
                queryText = `
                    SELECT dp.id, dp.sample_name, dp.str_data 
                    FROM dna_profiles dp
                    JOIN users u ON dp.user_id = u.id
                    WHERE dp.id != $1 AND dp.str_data IS NOT NULL 
                    AND u.department_id = $2 AND dp.is_active = true AND u.is_active = true
                    ORDER BY dp.id
                `;
                queryParams = [sample.id, departmentId];
            } else {
                // Fallback: поиск среди всех профилей (для случаев без департамента)
                queryText = `
                    SELECT id, sample_name, str_data 
                    FROM dna_profiles 
                    WHERE id != $1 AND str_data IS NOT NULL AND is_active = true
                    ORDER BY id
                `;
                queryParams = [sample.id];
            }

            const result = await query(queryText, queryParams);
            const potentialDuplicates = [];
            const searchedSamples = result.rows.length;

            logger.info(`Поиск дубликатов для образца ${sample.id}: проверяется ${searchedSamples} образцов${departmentId ? ` в департаменте ${departmentId}` : ' (без департаментной изоляции)'}`);

            // Сравниваем с каждым образцом в базе
            for (const dbSample of result.rows) {
                // Дополнительная проверка на исключение текущего образца
                if (dbSample.id === sample.id) {
                    continue;
                }

                const matchResult = this.calculateMatchPercentage(sample, dbSample);
                
                // Включаем только образцы с высоким процентом совпадения (>= 95%)
                if (matchResult.matchPercentage >= 95) {
                    potentialDuplicates.push({
                        sampleId: dbSample.id,
                        sampleName: dbSample.sample_name,
                        matchPercentage: matchResult.matchPercentage,
                        matchingLoci: matchResult.matchingLoci,
                        totalCommonLoci: matchResult.totalCommonLoci,
                        recommendMerge: matchResult.matchPercentage >= 95,
                        details: matchResult.details
                    });
                }
            }

            // Сортируем по убыванию процента совпадения
            potentialDuplicates.sort((a, b) => b.matchPercentage - a.matchPercentage);

            return {
                potentialDuplicates,
                searchedSamples,
                departmentId, // Добавляем информацию о департаменте для отладки
                colorCode: potentialDuplicates.length > 0 ? '#f0ad4e' : '#2d8f2d',
                timestamp: new Date()
            };
        } catch (error) {
            logger.error(`Ошибка поиска дубликатов для образца ${sample?.id || 'неизвестен'}:`, error);
            throw new Error('Duplicate search failed');
        }
    }

    /**
     * Calculate match percentage between two samples
     * Requirements: 5.2
     */
    calculateMatchPercentage(sample1, sample2) {
        let matchingLoci = 0;
        let totalCommonLoci = 0;
        const details = [];

        // Получаем STR данные из образцов
        const str1 = sample1.str_data || sample1.loci || {};
        const str2 = sample2.str_data || {};

        // Преобразуем Map в объект если необходимо
        const strData1 = str1 instanceof Map ? Object.fromEntries(str1) : str1;
        const strData2 = str2 instanceof Map ? Object.fromEntries(str2) : str2;

        // Находим общие локусы
        const commonLoci = Object.keys(strData1).filter(locus => 
            strData2.hasOwnProperty(locus) && 
            strData1[locus] && 
            strData2[locus]
        );

        for (const locus of commonLoci) {
            const locus1 = strData1[locus];
            const locus2 = strData2[locus];

            // Проверяем, что оба локуса имеют данные
            if (locus1 && locus2 && 
                locus1.allele1 && locus1.allele2 && 
                locus2.allele1 && locus2.allele2) {
                
                totalCommonLoci++;

                // Проверяем полное совпадение аллелей
                const alleles1 = [locus1.allele1, locus1.allele2].sort();
                const alleles2 = [locus2.allele1, locus2.allele2].sort();

                const isMatch = alleles1[0] === alleles2[0] && alleles1[1] === alleles2[1];
                
                if (isMatch) {
                    matchingLoci++;
                }

                details.push({
                    locus,
                    sample1Alleles: alleles1,
                    sample2Alleles: alleles2,
                    match: isMatch
                });
            }
        }

        // Расчет процента совпадения
        const matchPercentage = totalCommonLoci > 0 ? 
            (matchingLoci / totalCommonLoci) * 100 : 0;

        return {
            matchPercentage: Math.round(matchPercentage * 100) / 100, // Округляем до 2 знаков
            matchingLoci,
            totalCommonLoci,
            details
        };
    }

    /**
     * Assign perspective category
     * Requirements: 6.1, 6.2, 6.3
     */
    async assignPerspectiveCategory(sample) {
        try {
            // Get all analysis results
            const pci = await this.calculatePCI(sample);
            const heterozygosity = await this.calculateHeterozygosity(sample);
            const contamination = await this.detectContamination(sample);
            const duplicates = await this.findDuplicates(sample);
            
            // Calculate overall category using thresholds from types.js
            let category, colorCode;
            const pciScore = pci.pciValue;
            const hetScore = heterozygosity.observedHeterozygosity;
            const isContaminated = contamination.isContaminated;
            const hasDuplicates = duplicates.potentialDuplicates.length > 0;
            
            if (isContaminated) {
                category = this.classifications.PERSPECTIVE.CONTAMINATED;
                colorCode = '#8b0000';
            } else if (pciScore >= this.thresholds.PERSPECTIVE.HIGH_PCI && hetScore >= 0.6 && !hasDuplicates) {
                category = this.classifications.PERSPECTIVE.HIGH;
                colorCode = '#2d8f2d';
            } else if (pciScore >= this.thresholds.PERSPECTIVE.MEDIUM_PCI_MIN && hetScore >= 0.4) {
                category = this.classifications.PERSPECTIVE.MEDIUM;
                colorCode = '#f0ad4e';
            } else {
                category = this.classifications.PERSPECTIVE.LOW;
                colorCode = '#d9534f';
            }
            
            return {
                category,
                colorCode,
                reasoning: [
                    `Высокий индекс полноты профиля: ${pciScore ? Math.round(pciScore * 100).toFixed(1) : '0.0'}%`,
                    `Гетерозиготность: ${hetScore ? Math.round(hetScore * 100) : 0}%`,
                    isContaminated ? 'Обнаружена контаминация' : 'Отсутствие контаминации',
                    hasDuplicates ? 'Найдены потенциальные дубликаты' : 'Дубликаты не найдены'
                ],
                recommendations: pciScore >= this.thresholds.PERSPECTIVE.HIGH_PCI ? 
                    ['Образец пригоден для всех видов анализа', 'Рекомендуется для сравнительного анализа'] :
                    ['Ограниченное использование', 'Требуется дополнительная проверка'],
                timestamp: new Date()
            };
        } catch (error) {
            logger.error(`Ошибка присвоения категории для образца ${sample?.id || 'неизвестен'}:`, error);
            throw new Error(`Ошибка присвоения категории: ${error.message}`);
        }
    }

    /**
     * Perform comprehensive quality analysis on a genetic sample
     * This method runs all quality analysis components and returns a complete result
     * 
     * @param {GeneticSample} sample - Genetic sample to analyze
     * @returns {Promise<Object>} Complete quality analysis result
     */
    async performQualityAnalysis(sample) {
        try {
            logger.info(`Starting comprehensive quality analysis for sample ${sample?.id || 'unknown'}`);
            
            // Validate sample
            if (!sample || !sample.id) {
                throw new Error('Invalid sample for quality analysis');
            }

            // Run all quality analysis components
            const [
                pci,
                heterozygosity,
                degradation,
                contamination,
                duplicates
            ] = await Promise.all([
                this.calculatePCI(sample),
                this.calculateHeterozygosity(sample),
                this.calculateDegradationIndex(sample),
                this.detectContamination(sample),
                this.findDuplicates(sample)
            ]);

            // Assign perspective category based on all results
            const perspectiveCategory = await this.assignPerspectiveCategory(sample);

            const result = {
                sampleId: sample.id,
                pci,
                heterozygosity,
                degradation,
                contamination,
                duplicates,
                perspectiveCategory,
                analysisDate: new Date(),
                analysisVersion: '1.0.0'
            };

            logger.info(`Quality analysis completed for sample ${sample.id}`);
            return result;

        } catch (error) {
            logger.error(`Quality analysis failed for sample ${sample?.id || 'unknown'}:`, error);
            throw new Error(`Quality analysis failed: ${error.message}`);
        }
    }
}

module.exports = QualityAnalyzer;
