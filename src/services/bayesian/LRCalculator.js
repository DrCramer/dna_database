const { informativeAlleles, alleleTokens, isSpecialAllele, isMissingAllele } = require('../../utils/alleleTokens');
/**
 * LR Calculator - Compute Likelihood Ratios using Bayesian inference
 * 
 * This service calculates likelihood ratios for genetic profile comparisons
 * using Hardy-Weinberg equilibrium and population allele frequencies.
 * Enhanced to support 40 STR/SNP markers with color-coded significance levels.
 */

const { logger } = require('../../utils/logger');
const { LociTypeDetector, LOCI_TYPES } = require('../../utils/lociTypeDetector');
const locusTypeDetector = new LociTypeDetector();

// Import STR/SNP loci configuration
const { 
  EXTENDED_40_STR_SNP_LOCI, 
  ORIGINAL_39_STR_LOCI,
  COMPATIBILITY_MODES 
} = require('../dnaAnalysisService');

class LRCalculator {
    constructor(populationManager, systemParameters) {
        this.populationManager = populationManager;
        this.systemParameters = systemParameters;
        
        // LR significance thresholds for color coding
        this.significanceThresholds = {
          EXTREMELY_STRONG: 1e6,    // >= 1,000,000
          VERY_STRONG: 1e4,         // >= 10,000
          STRONG: 1e2,              // >= 100
          MODERATE: 10,             // >= 10
          WEAK: 1,                  // >= 1
          EXCLUSION: 0              // < 1 (exclusion)
        };
        
        // Color codes for different significance levels
        this.colorCodes = {
          EXTREMELY_STRONG: '#1a5f1a', // Dark green
          VERY_STRONG: '#2d8f2d',      // Green  
          STRONG: '#4caf50',           // Light green
          MODERATE: '#ff9800',         // Orange
          WEAK: '#f44336',             // Red
          EXCLUSION: '#9c27b0'         // Purple
        };
    }

    /**
     * Calculate likelihood ratio for a single locus
     * @param {Object} locusData - Locus genotype data
     * @param {Object} alleleFreqs - Allele frequencies for the locus
     * @param {Object} params - Bayesian parameters
     * @returns {number} Likelihood ratio for the locus
     */
    calculateLocusLR(locusData, alleleFreqs, params) {
        try {
            const validation = this.validateLocusData(locusData);
            if (!validation.isValid) {
                throw new Error(`Invalid locus data: ${validation.errors.join(', ')}`);
            }

            if (!alleleFreqs || !alleleFreqs.frequencies) {
                throw new Error(`Missing allele frequencies for locus ${locusData.locusName}`);
            }

            const { alleles, locusType } = locusData;
            const { frequencies } = alleleFreqs;
            
            // Calculate probability based on locus type
            let probability;
            
            switch (locusType) {
                case 'STR':
                    probability = this.calculateHardyWeinbergProbability(
                        alleles, 
                        frequencies, 
                        params.inbreedingCoefficient || 0.0
                    );
                    break;
                    
                case 'SNP':
                    probability = this.calculateSNPProbability(alleles, frequencies);
                    break;
                    
                case 'Y_CHROMOSOME':
                    if (alleles.length !== 1) {
                        throw new Error('Y-chromosome loci should have exactly one allele');
                    }
                    probability = this.calculateYChromosomeProbability(alleles[0], frequencies);
                    break;

                case 'Y_INDEL':
                    throw new Error('Для Y-InDel не применяется аутосомная модель LR.');
                    
                default:
                    throw new Error(`Unsupported locus type: ${locusType}`);
            }

            // Apply drop-out and false allele corrections if specified
            if (params.dropOutProbability && params.dropOutProbability > 0) {
                probability *= (1 - params.dropOutProbability);
            }
            
            if (params.falseAlleleProbability && params.falseAlleleProbability > 0) {
                probability *= (1 - params.falseAlleleProbability);
            }

            // LR is the probability (assuming it's compared against random match probability)
            const lr = Math.max(probability, 1e-10); // Prevent zero/negative LR
            
            logger.debug(`LR calculation for locus ${locusData.locusName}: ${lr}`);
            return lr;
            
        } catch (error) {
            logger.error(`Failed to calculate locus LR for ${locusData.locusName}:`, error);
            throw error;
        }
    }

    /**
     * Calculate likelihood ratio for complete genetic profiles with enhanced analysis
     * @param {Object} profile1 - First genetic profile
     * @param {Object} profile2 - Second genetic profile
     * @param {Object} populationData - Population allele frequency data
     * @param {Object} options - Calculation options
     * @returns {Promise<Object>} Enhanced LR calculation result with color coding
     */
    async calculateProfileLR(profile1, profile2, populationData, options = {}) {
        try {
            logger.info(`Enhanced profile LR calculation for ${profile1.id} vs ${profile2.id}`);
            
            const parameters = await this.systemParameters.getBayesianParameters();
            const locusLRs = new Map();
            let overallLR = 1.0;
            const errors = [];
            const warnings = [];
            
            // Get loci data from both profiles
            const profile1Loci = this.extractLociData(profile1);
            const profile2Loci = this.extractLociData(profile2);
            
            // Find common loci between profiles
            const commonLoci = this.findCommonLoci(profile1Loci, profile2Loci);
            
            if (commonLoci.length === 0) {
                // Return default result for no common loci instead of throwing error
                logger.warn('No common loci found between profiles, returning default LR result');
                return {
                    overallLR: 1.0, // Neutral likelihood ratio
                    locusLRs: new Map(),
                    analysisDetails: {
                        totalLoci: 0,
                        analyzedLoci: 0,
                        skippedLoci: 0,
                        warnings: ['No common loci found between profiles']
                    }
                };
            }
            
            // Separate loci by type for enhanced analysis
            const lociByType = this.categorizeLoci(commonLoci);
            
            // Calculate LR for each common locus
            logger.info(`Starting LR calculation for ${commonLoci.length} common loci`);
            for (const locusName of commonLoci) {
                try {
                    logger.debug(`Processing locus: ${locusName}`);
                    const locus1 = profile1Loci.get(locusName);
                    const locus2 = profile2Loci.get(locusName);
                    
                    if (!locus1 || !locus2) {
                        logger.warn(`Missing locus data for ${locusName}`);
                        continue;
                    }

                    if (locus1.locusType === LOCI_TYPES.Y_INDEL || locus2.locusType === LOCI_TYPES.Y_INDEL) {
                        warnings.push(`Y-InDel ${locusName} сравнивается как гаплоидный маркер и не включается в расчёт аутосомного LR.`);
                        continue;
                    }
                    
                    // Check if alleles match
                    const allelesMatch = this.compareAlleles(locus1.alleles, locus2.alleles);
                    logger.debug(`Locus ${locusName}: alleles match = ${allelesMatch}`);
                    
                    if (allelesMatch) {
                        // Get population frequencies for this locus
                        // Нормализуем имя локуса (убираем лишние пробелы)
                        const normalizedLocusName = locusName.trim();
                        const alleleFreqs = populationData.locusFrequencies.get(normalizedLocusName);
                        
                        // ДИАГНОСТИЧЕСКОЕ ЛОГИРОВАНИЕ для отладки проблемы
                        logger.debug(`🔍 LRCalculator: Поиск данных для локуса "${locusName}" (нормализовано: "${normalizedLocusName}")`);
                        logger.debug(`🔍 LRCalculator: populationData.locusFrequencies тип: ${typeof populationData.locusFrequencies}`);
                        logger.debug(`🔍 LRCalculator: populationData.locusFrequencies размер: ${populationData.locusFrequencies.size || 'не Map'}`);
                        
                        if (populationData.locusFrequencies instanceof Map) {
                            const availableKeys = Array.from(populationData.locusFrequencies.keys());
                            logger.debug(`🔍 LRCalculator: Доступные ключи в Map (первые 10): ${availableKeys.slice(0, 10).join(', ')}`);
                            
                            // Проверяем точное соответствие
                            const exactMatch = populationData.locusFrequencies.has(normalizedLocusName);
                            logger.debug(`🔍 LRCalculator: Точное соответствие для "${normalizedLocusName}": ${exactMatch}`);
                            
                            // Ищем похожие ключи
                            const similarKeys = availableKeys.filter(key => 
                                key.toLowerCase().trim() === normalizedLocusName.toLowerCase().trim() ||
                                key.includes(normalizedLocusName) || 
                                normalizedLocusName.includes(key)
                            );
                            if (similarKeys.length > 0) {
                                logger.debug(`🔍 LRCalculator: Похожие ключи для "${normalizedLocusName}": ${similarKeys.join(', ')}`);
                            }
                        } else {
                            logger.debug(`🔍 LRCalculator: populationData.locusFrequencies НЕ является Map!`);
                            if (typeof populationData.locusFrequencies === 'object') {
                                const keys = Object.keys(populationData.locusFrequencies);
                                logger.debug(`🔍 LRCalculator: Ключи объекта (первые 10): ${keys.slice(0, 10).join(', ')}`);
                            }
                        }
                        
                        if (!alleleFreqs) {
                            warnings.push(`Missing population data for locus ${locusName}`);
                            logger.warn(`❌ Missing population data for locus "${locusName}" (нормализовано: "${normalizedLocusName}")`);
                            continue;
                        } else {
                            logger.debug(`✅ LRCalculator: Найдены данные для локуса "${locusName}"`);
                        }
                        
                        // Calculate LR for this locus with enhanced analysis
                        const locusLR = await this.calculateEnhancedLocusLR(
                            locus1, 
                            alleleFreqs, 
                            parameters,
                            lociByType
                        );
                        
                        locusLRs.set(locusName, {
                            lr: locusLR,
                            locusType: locus1.locusType,
                            alleles: locus1.alleles,
                            significance: this.determineLRSignificance(locusLR),
                            colorCode: this.getLRColorCode(locusLR)
                        });
                        
                        // Multiply into overall LR
                        overallLR *= locusLR;
                        logger.debug(`Locus ${locusName}: LR = ${locusLR}, overall LR = ${overallLR}`);
                        
                    } else {
                        // Non-matching alleles contribute LR of 0 (exclusion)
                        logger.debug(`Locus ${locusName}: exclusion (alleles don't match)`);
                        locusLRs.set(locusName, {
                            lr: 0,
                            locusType: locus1.locusType,
                            alleles1: locus1.alleles,
                            alleles2: locus2.alleles,
                            significance: 'EXCLUSION',
                            colorCode: this.colorCodes.EXCLUSION,
                            reason: 'allele_mismatch'
                        });
                        overallLR = 0;
                        // Continue processing all loci for detailed display instead of early termination
                    }
                    
                } catch (locusError) {
                    logger.error(`Error calculating LR for locus ${locusName}:`, locusError);
                    errors.push(`Locus ${locusName}: ${locusError.message}`);
                }
            }
            
            logger.info(`LR calculation completed. LocusLRs size: ${locusLRs.size}, overall LR: ${overallLR}`);
            
            // Calculate confidence interval (enhanced approach)
            const confidenceInterval = this.calculateEnhancedConfidenceInterval(
                overallLR, 
                commonLoci.length,
                lociByType
            );
            
            // Determine overall significance and color coding
            const overallSignificance = this.determineLRSignificance(overallLR);
            const overallColorCode = this.getLRColorCode(overallLR);
            
            const result = {
                overallLR: overallLR,
                logLR: overallLR > 0 ? Math.log10(overallLR) : -Infinity,
                locusLRs: Object.fromEntries(locusLRs), // Convert Map to Object for JSON serialization
                confidenceInterval: confidenceInterval,
                significance: overallSignificance,
                colorCode: overallColorCode,
                populationUsed: populationData.populationId,
                calculationMetadata: {
                    timestamp: new Date(),
                    method: 'Enhanced Hardy-Weinberg',
                    parametersUsed: parameters,
                    commonLoci: commonLoci.length,
                    totalLoci1: profile1Loci.size,
                    totalLoci2: profile2Loci.size,
                    lociByType: Object.fromEntries(
                        Object.entries(lociByType).map(([type, loci]) => [type, loci.length])
                    ),
                    errors: errors,
                    warnings: warnings,
                    supportedLoci: EXTENDED_40_STR_SNP_LOCI.length
                }
            };
            
            logger.info(`Enhanced profile LR calculation completed: LR=${overallLR}, significance=${overallSignificance}, loci=${commonLoci.length}`);
            return result;
            
        } catch (error) {
            logger.error('Failed to calculate enhanced profile LR:', error);
            throw error;
        }
    }

    /**
     * Calculate enhanced locus LR with type-specific analysis
     * @param {Object} locusData - Locus genotype data
     * @param {Object} alleleFreqs - Allele frequencies for the locus
     * @param {Object} params - Bayesian parameters
     * @param {Object} lociByType - Loci categorized by type
     * @returns {Promise<number>} Enhanced likelihood ratio for the locus
     */
    async calculateEnhancedLocusLR(locusData, alleleFreqs, params, lociByType) {
        try {
            const validation = this.validateLocusData(locusData);
            if (!validation.isValid) {
                throw new Error(`Invalid locus data: ${validation.errors.join(', ')}`);
            }

            if (!alleleFreqs || !alleleFreqs.frequencies) {
                throw new Error(`Missing allele frequencies for locus ${locusData.locusName}`);
            }

            const { alleles, locusType } = locusData;
            const { frequencies } = alleleFreqs;
            
            // Calculate probability based on locus type with enhanced parameters
            let probability;
            
            switch (locusType) {
                case 'STR':
                    probability = this.calculateEnhancedHardyWeinbergProbability(
                        alleles, 
                        frequencies, 
                        params.inbreedingCoefficient || 0.0,
                        params.thetaCorrection || 0.01
                    );
                    break;
                    
                case 'SNP':
                    probability = this.calculateEnhancedSNPProbability(
                        alleles, 
                        frequencies,
                        params.thetaCorrection || 0.01
                    );
                    break;
                    
                case 'Y_CHROMOSOME':
                    if (alleles.length !== 1) {
                        throw new Error('Y-chromosome loci should have exactly one allele');
                    }
                    probability = this.calculateYChromosomeProbability(alleles[0], frequencies);
                    break;

                case 'AMELOGENIN':
                    probability = this.calculateAmelogeninProbability(alleles, frequencies);
                    break;

                case 'Y_INDEL':
                    throw new Error('Для Y-InDel не применяется диплоидная модель LR.');
                    
                default:
                    // Default to STR analysis for unknown types
                    probability = this.calculateEnhancedHardyWeinbergProbability(
                        alleles, 
                        frequencies, 
                        params.inbreedingCoefficient || 0.0,
                        params.thetaCorrection || 0.01
                    );
            }

            // Apply enhanced corrections based on locus type and quality
            probability = this.applyEnhancedCorrections(
                probability, 
                locusData, 
                params,
                lociByType
            );

            // LR is the probability (assuming it's compared against random match probability)
            const lr = Math.max(probability, 1e-10); // Prevent zero/negative LR
            
            logger.debug(`Enhanced LR calculation for locus ${locusData.locusName}: ${lr} (type: ${locusType})`);
            return lr;
            
        } catch (error) {
            logger.error(`Failed to calculate enhanced locus LR for ${locusData.locusName}:`, error);
            throw error;
        }
    }

    /**
     * Categorize loci by type for enhanced analysis
     * @param {Array} loci - Array of locus names
     * @returns {Object} Loci categorized by type
     */
    categorizeLoci(loci) {
        const categories = {
            STR: [],
            SNP: [],
            Y_CHROMOSOME: [],
            Y_INDEL: [],
            X_CHROMOSOME: [],
            AMELOGENIN: [],
            INDEL: [],
            OTHER: []
        };
        
        loci.forEach(locusName => {
            const canonical = locusTypeDetector.getCanonicalLocusName(locusName);
            const type = canonical === 'Yindel' ? LOCI_TYPES.Y_CHROMOSOME : locusTypeDetector.detectLocusType(canonical || locusName);
            (categories[type] || categories.OTHER).push(locusName);
        });
        
        return categories;
    }

    /**
     * Apply enhanced Hardy-Weinberg equilibrium with theta correction and special allele handling
     * @param {Array} alleles - Alleles at the locus
     * @param {Map} frequencies - Allele frequencies
     * @param {number} inbreedingCoeff - Inbreeding coefficient
     * @param {number} thetaCorrection - Theta correction for population substructure
     * @returns {number} Enhanced genotype probability
     */
    calculateEnhancedHardyWeinbergProbability(alleles, frequencies, inbreedingCoeff = 0.0, thetaCorrection = 0.01) {
        try {
            if (!alleles || alleles.length === 0) {
                throw new Error('Alleles array is required');
            }
            
            if (!frequencies || frequencies.size === 0) {
                throw new Error('Allele frequencies are required');
            }
            
            // Обработка специальных аллелей
            const processedAlleles = this.processSpecialAlleles(alleles, frequencies);
            
            // Remove duplicates and sort alleles
            const uniqueAlleles = [...new Set(processedAlleles)].sort();
            
            if (uniqueAlleles.length === 1) {
                // Homozygote with theta correction: P = [θ + (1-θ)p]²
                const allele = uniqueAlleles[0];
                const p = this.getAlleleFrequency(allele, frequencies);
                
                if (p === null) {
                    logger.warn(`Frequency not found for allele ${allele}, using default frequency`);
                    const minFreq = this.getMinimumFrequency(frequencies);
                    const correctedP = thetaCorrection + (1 - thetaCorrection) * minFreq;
                    const probability = correctedP * correctedP * (1 - inbreedingCoeff) + correctedP * inbreedingCoeff;
                    logger.debug(`Enhanced Hardy-Weinberg homozygote probability for ${allele} (default freq): ${probability} (θ=${thetaCorrection})`);
                    return probability;
                }
                
                const correctedP = thetaCorrection + (1 - thetaCorrection) * p;
                const probability = correctedP * correctedP * (1 - inbreedingCoeff) + correctedP * inbreedingCoeff;
                
                logger.debug(`Enhanced Hardy-Weinberg homozygote probability for ${allele}: ${probability} (θ=${thetaCorrection})`);
                return probability;
                
            } else if (uniqueAlleles.length === 2) {
                // Heterozygote with theta correction: P = 2[θ + (1-θ)p][θ + (1-θ)q](1-f)
                const [allele1, allele2] = uniqueAlleles;
                const p = this.getAlleleFrequency(allele1, frequencies);
                const q = this.getAlleleFrequency(allele2, frequencies);
                
                // Обработка случаев с отсутствующими частотами
                const minFreq = this.getMinimumFrequency(frequencies);
                const finalP = p !== null ? p : minFreq;
                const finalQ = q !== null ? q : minFreq;
                
                if (p === null) {
                    logger.warn(`Frequency not found for allele ${allele1}, using minimum frequency ${minFreq}`);
                }
                if (q === null) {
                    logger.warn(`Frequency not found for allele ${allele2}, using minimum frequency ${minFreq}`);
                }
                
                const correctedP = thetaCorrection + (1 - thetaCorrection) * finalP;
                const correctedQ = thetaCorrection + (1 - thetaCorrection) * finalQ;
                const probability = 2 * correctedP * correctedQ * (1 - inbreedingCoeff);
                
                logger.debug(`Enhanced Hardy-Weinberg heterozygote probability for ${allele1}/${allele2}: ${probability} (θ=${thetaCorrection})`);
                return probability;
                
            } else {
                // More than 2 alleles indicates potential contamination or error
                throw new Error(`Invalid genotype: more than 2 unique alleles (${uniqueAlleles.length})`);
            }
            
        } catch (error) {
            logger.error('Failed to calculate enhanced Hardy-Weinberg probability:', error);
            throw error;
        }
    }

    /**
     * Calculate enhanced SNP probability with theta correction
     * @param {Array} alleles - Alleles at the SNP locus
     * @param {Map} frequencies - Allele frequencies
     * @param {number} thetaCorrection - Theta correction
     * @returns {number} Enhanced SNP genotype probability
     */
    calculateEnhancedSNPProbability(alleles, frequencies, thetaCorrection = 0.01) {
        try {
            if (!alleles || alleles.length === 0) {
                throw new Error('Alleles array is required for SNP');
            }
            
            if (!frequencies || frequencies.size === 0) {
                throw new Error('Allele frequencies are required for SNP');
            }
            
            // SNPs typically have 2 alleles maximum
            const uniqueAlleles = [...new Set(alleles)].sort();
            
            if (uniqueAlleles.length === 1) {
                // Homozygous SNP with theta correction
                const allele = uniqueAlleles[0];
                const p = frequencies.get(allele);
                
                if (p === undefined) {
                    throw new Error(`Frequency not found for SNP allele ${allele}`);
                }
                
                const correctedP = thetaCorrection + (1 - thetaCorrection) * p;
                const probability = correctedP * correctedP;
                
                logger.debug(`Enhanced SNP homozygote probability for ${allele}: ${probability} (θ=${thetaCorrection})`);
                return probability;
                
            } else if (uniqueAlleles.length === 2) {
                // Heterozygous SNP with theta correction
                const [allele1, allele2] = uniqueAlleles;
                const p = frequencies.get(allele1);
                const q = frequencies.get(allele2);
                
                if (p === undefined) {
                    throw new Error(`Frequency not found for SNP allele ${allele1}`);
                }
                if (q === undefined) {
                    throw new Error(`Frequency not found for SNP allele ${allele2}`);
                }
                
                const correctedP = thetaCorrection + (1 - thetaCorrection) * p;
                const correctedQ = thetaCorrection + (1 - thetaCorrection) * q;
                const probability = 2 * correctedP * correctedQ;
                
                logger.debug(`Enhanced SNP heterozygote probability for ${allele1}/${allele2}: ${probability} (θ=${thetaCorrection})`);
                return probability;
                
            } else {
                throw new Error(`Invalid SNP genotype: more than 2 unique alleles (${uniqueAlleles.length})`);
            }
            
        } catch (error) {
            logger.error('Failed to calculate enhanced SNP probability:', error);
            throw error;
        }
    }

    /**
     * Calculate Amelogenin probability for sex determination
     * @param {Array} alleles - Amelogenin alleles
     * @param {Map} frequencies - Allele frequencies
     * @returns {number} Amelogenin probability
     */
    calculateAmelogeninProbability(alleles, frequencies) {
        try {
            if (!alleles || alleles.length === 0) {
                throw new Error('Alleles array is required for Amelogenin');
            }
            
            // Amelogenin has specific patterns: X, Y, or X,Y
            const uniqueAlleles = [...new Set(alleles)].sort();
            
            if (uniqueAlleles.length === 1) {
                // Homozygous (XX for female)
                const allele = uniqueAlleles[0];
                const p = frequencies.get(allele) || 0.5; // Default to 0.5 if not found
                return p * p;
            } else if (uniqueAlleles.length === 2) {
                // Heterozygous (XY for male)
                const p1 = frequencies.get(uniqueAlleles[0]) || 0.5;
                const p2 = frequencies.get(uniqueAlleles[1]) || 0.5;
                return 2 * p1 * p2;
            }
            
            throw new Error(`Invalid Amelogenin genotype: ${uniqueAlleles.length} alleles`);
            
        } catch (error) {
            logger.error('Failed to calculate Amelogenin probability:', error);
            throw error;
        }
    }

    /**
     * Apply enhanced corrections based on locus quality and type
     * @param {number} probability - Base probability
     * @param {Object} locusData - Locus data
     * @param {Object} params - Parameters
     * @param {Object} lociByType - Loci by type
     * @returns {number} Corrected probability
     */
    applyEnhancedCorrections(probability, locusData, params, lociByType) {
        let correctedProbability = probability;
        
        // Apply drop-out correction if specified
        if (params.dropOutProbability && params.dropOutProbability > 0) {
            correctedProbability *= (1 - params.dropOutProbability);
        }
        
        // Apply false allele correction if specified
        if (params.falseAlleleProbability && params.falseAlleleProbability > 0) {
            correctedProbability *= (1 - params.falseAlleleProbability);
        }
        
        // Apply locus-type specific corrections
        if (locusData.locusType === 'SNP') {
            // SNPs are generally more reliable, apply slight boost
            correctedProbability *= 1.05;
        } else if (locusData.locusType === 'Y_CHROMOSOME') {
            // Y-chromosome markers are haploid, different calculation
            // Already handled in calculateYChromosomeProbability
        }
        
        return Math.max(correctedProbability, 1e-10);
    }

    /**
     * Calculate enhanced confidence interval
     * @param {number} lr - Likelihood ratio
     * @param {number} numLoci - Number of loci used
     * @param {Object} lociByType - Loci categorized by type
     * @returns {Array} Enhanced confidence interval [lower, upper]
     */
    calculateEnhancedConfidenceInterval(lr, numLoci, lociByType) {
        if (lr === 0) {
            return [0, 0];
        }
        
        // Enhanced confidence interval calculation considering locus types
        const logLR = Math.log10(lr);
        
        // Calculate weighted standard error based on locus types
        let weightedSE = 0;
        let totalWeight = 0;
        
        Object.entries(lociByType).forEach(([type, loci]) => {
            if (loci.length > 0) {
                let typeWeight = 1.0;
                let typeSE = 1 / Math.sqrt(loci.length);
                
                // Adjust weights based on locus type reliability
                switch (type) {
                    case 'STR':
                        typeWeight = 1.0;
                        break;
                    case 'SNP':
                        typeWeight = 1.1; // SNPs are slightly more reliable
                        break;
                    case 'Y_CHROMOSOME':
                        typeWeight = 0.8; // Y-chromosome has less discrimination
                        break;
                    case 'AMELOGENIN':
                        typeWeight = 0.5; // Amelogenin is mainly for sex determination
                        break;
                    default:
                        typeWeight = 0.9;
                }
                
                weightedSE += typeWeight * typeSE * loci.length;
                totalWeight += typeWeight * loci.length;
            }
        });
        
        const standardError = totalWeight > 0 ? weightedSE / totalWeight : 1 / Math.sqrt(numLoci);
        const margin = 1.96 * standardError; // 95% confidence interval
        
        const lowerLog = logLR - margin;
        const upperLog = logLR + margin;
        
        return [Math.pow(10, lowerLog), Math.pow(10, upperLog)];
    }

    /**
     * Determine LR significance level for color coding
     * @param {number} lr - Likelihood ratio
     * @returns {string} Significance level
     */
    determineLRSignificance(lr) {
        if (lr >= this.significanceThresholds.EXTREMELY_STRONG) return 'EXTREMELY_STRONG';
        if (lr >= this.significanceThresholds.VERY_STRONG) return 'VERY_STRONG';
        if (lr >= this.significanceThresholds.STRONG) return 'STRONG';
        if (lr >= this.significanceThresholds.MODERATE) return 'MODERATE';
        if (lr >= this.significanceThresholds.WEAK) return 'WEAK';
        return 'EXCLUSION';
    }

    /**
     * Get color code for LR value
     * @param {number} lr - Likelihood ratio
     * @returns {string} Color code
     */
    getLRColorCode(lr) {
        const significance = this.determineLRSignificance(lr);
        return this.colorCodes[significance] || '#757575'; // Default gray
    }

    /**
     * Get human-readable interpretation of LR value
     * @param {number} lr - Likelihood ratio
     * @returns {string} Human-readable interpretation
     */
    interpretLR(lr) {
        const significance = this.determineLRSignificance(lr);
        
        const interpretations = {
            EXTREMELY_STRONG: 'Extremely strong evidence supporting the hypothesis',
            VERY_STRONG: 'Very strong evidence supporting the hypothesis',
            STRONG: 'Strong evidence supporting the hypothesis',
            MODERATE: 'Moderate evidence supporting the hypothesis',
            WEAK: 'Weak evidence supporting the hypothesis',
            EXCLUSION: 'Evidence excludes the hypothesis'
        };
        
        return interpretations[significance] || 'Insufficient evidence';
    }

    /**
     * Extract loci data from a genetic profile
     * @param {Object} profile - Genetic profile
     * @returns {Map} Map of locus name to locus data
     */
    extractLociData(profile) {
        const lociMap = new Map();
        const typeOf = locusName => {
            const canonical = locusTypeDetector.getCanonicalLocusName(locusName);
            return canonical === 'Yindel' ? LOCI_TYPES.Y_CHROMOSOME : locusTypeDetector.detectLocusType(canonical || locusName);
        };
        const normalizedData = (locusName, data, alleles) => ({ ...data, locusName, locusType: typeOf(locusName), alleles });
        
        // Handle different profile formats
        if (profile.loci && profile.loci instanceof Map) {
            // Already in Map format
            return new Map([...profile.loci].map(([name, data]) => [locusTypeDetector.getCanonicalLocusName(name) || name, normalizedData(name, data, informativeAlleles(data.alleles).length === alleleTokens(data.alleles).length ? informativeAlleles(data.alleles) : [])]));
        } else if (profile.loci && typeof profile.loci === 'object') {
            // Convert object to Map
            Object.entries(profile.loci).forEach(([locusName, locusData]) => {
                lociMap.set(locusTypeDetector.getCanonicalLocusName(locusName) || locusName, normalizedData(locusName, locusData, informativeAlleles(locusData.alleles).length === alleleTokens(locusData.alleles).length ? informativeAlleles(locusData.alleles) : []));
            });
        } else if (profile.str_data) {
            // Convert STR data format
            Object.entries(profile.str_data).forEach(([locusName, locusData]) => {
                if (Array.isArray(locusData)) {
                    // Handle array format (новый формат БД)
                    lociMap.set(locusTypeDetector.getCanonicalLocusName(locusName) || locusName, {
                        locusName: locusName,
                        locusType: typeOf(locusName),
                        alleles: informativeAlleles(locusData).length === locusData.length ? informativeAlleles(locusData) : []
                    });
                } else if (locusData && locusData.allele1 && locusData.allele2) {
                    // Handle object format (старый формат)
                    lociMap.set(locusTypeDetector.getCanonicalLocusName(locusName) || locusName, {
                        locusName: locusName,
                        locusType: typeOf(locusName),
                        alleles: informativeAlleles(locusData).length === 2 ? informativeAlleles(locusData) : []
                    });
                }
            });
        }
        
        return lociMap;
    }

    /**
     * Find common loci between two profiles
     * @param {Map} loci1 - First profile loci
     * @param {Map} loci2 - Second profile loci
     * @returns {Array} Array of common locus names
     */
    findCommonLoci(loci1, loci2) {
        const common = [];
        
        for (const locusName of loci1.keys()) {
            if (loci2.has(locusName)) {
                common.push(locusName);
            }
        }
        
        return common;
    }

    /**
     * Compare alleles between two loci with proper null allele handling
     * @param {Array} alleles1 - First set of alleles
     * @param {Array} alleles2 - Second set of alleles
     * @returns {boolean} True if alleles match (excluding null alleles)
     */
    compareAlleles(alleles1, alleles2) {
        if (informativeAlleles(alleles1).length !== alleleTokens(alleles1).length || informativeAlleles(alleles2).length !== alleleTokens(alleles2).length) return false;
        if (!alleles1 || !alleles2) {
            return false;
        }
        
        // Фильтруем null аллели (*) из обеих наборов
        const filtered1 = informativeAlleles(alleles1);
        const filtered2 = informativeAlleles(alleles2);
        
        // Если один из профилей имеет только null аллели, это не совпадение
        if (filtered1.length === 0 || filtered2.length === 0) {
            logger.debug(`Null allele comparison: filtered1=[${filtered1.join(',')}], filtered2=[${filtered2.join(',')}] → no match`);
            return false;
        }
        
        // Sort both arrays for comparison
        const sorted1 = [...filtered1].sort();
        const sorted2 = [...filtered2].sort();
        
        if (sorted1.length !== sorted2.length) {
            logger.debug(`Length mismatch: ${sorted1.length} vs ${sorted2.length} → no match`);
            return false;
        }
        
        const match = sorted1.every((allele, index) => allele === sorted2[index]);
        logger.debug(`Allele comparison: [${sorted1.join(',')}] vs [${sorted2.join(',')}] → ${match ? 'match' : 'no match'}`);
        
        return match;
    }

    /**
     * Calculate confidence interval for LR
     * @param {number} lr - Likelihood ratio
     * @param {number} numLoci - Number of loci used
     * @returns {Array} Confidence interval [lower, upper]
     */
    calculateConfidenceInterval(lr, numLoci) {
        if (lr === 0) {
            return [0, 0];
        }
        
        // Simplified confidence interval calculation
        // In practice, this would use more sophisticated statistical methods
        const logLR = Math.log10(lr);
        const standardError = 1 / Math.sqrt(numLoci); // Simplified SE calculation
        const margin = 1.96 * standardError; // 95% confidence interval
        
        const lowerLog = logLR - margin;
        const upperLog = logLR + margin;
        
        return [Math.pow(10, lowerLog), Math.pow(10, upperLog)];
    }

    /**
     * Apply Hardy-Weinberg equilibrium for STR loci with special allele handling
     * @param {Array} alleles - Alleles at the locus
     * @param {Map} frequencies - Allele frequencies
     * @param {number} inbreedingCoeff - Inbreeding coefficient
     * @returns {number} Genotype probability
     */
    calculateHardyWeinbergProbability(alleles, frequencies, inbreedingCoeff = 0.0) {
        if (informativeAlleles(alleles).length !== alleleTokens(alleles).length) throw new Error('Incomplete genotype is excluded from LR');
        try {
            if (!alleles || alleles.length === 0) {
                throw new Error('Alleles array is required');
            }
            
            if (!frequencies || frequencies.size === 0) {
                throw new Error('Allele frequencies are required');
            }
            
            // Обработка специальных аллелей
            const processedAlleles = this.processSpecialAlleles(alleles, frequencies);
            
            // Remove duplicates and sort alleles
            const uniqueAlleles = [...new Set(processedAlleles)].sort();
            
            if (uniqueAlleles.length === 1) {
                // Homozygote: P = p²(1-f) + pf
                const allele = uniqueAlleles[0];
                const p = this.getAlleleFrequency(allele, frequencies);
                
                if (p === null) {
                    logger.warn(`Frequency not found for allele ${allele}, using default frequency`);
                    // Используем минимальную частоту для неизвестных аллелей
                    const minFreq = this.getMinimumFrequency(frequencies);
                    const probability = (minFreq * minFreq * (1 - inbreedingCoeff)) + (minFreq * inbreedingCoeff);
                    logger.debug(`Hardy-Weinberg homozygote probability for ${allele} (default freq): ${probability}`);
                    return probability;
                }
                
                const probability = (p * p * (1 - inbreedingCoeff)) + (p * inbreedingCoeff);
                logger.debug(`Hardy-Weinberg homozygote probability for ${allele}: ${probability}`);
                return probability;
                
            } else if (uniqueAlleles.length === 2) {
                // Heterozygote: P = 2pq(1-f)
                const [allele1, allele2] = uniqueAlleles;
                const p = this.getAlleleFrequency(allele1, frequencies);
                const q = this.getAlleleFrequency(allele2, frequencies);
                
                // Обработка случаев с отсутствующими частотами
                const minFreq = this.getMinimumFrequency(frequencies);
                const finalP = p !== null ? p : minFreq;
                const finalQ = q !== null ? q : minFreq;
                
                if (p === null) {
                    logger.warn(`Frequency not found for allele ${allele1}, using minimum frequency ${minFreq}`);
                }
                if (q === null) {
                    logger.warn(`Frequency not found for allele ${allele2}, using minimum frequency ${minFreq}`);
                }
                
                const probability = 2 * finalP * finalQ * (1 - inbreedingCoeff);
                logger.debug(`Hardy-Weinberg heterozygote probability for ${allele1}/${allele2}: ${probability}`);
                return probability;
                
            } else {
                // More than 2 alleles indicates potential contamination or error
                throw new Error(`Invalid genotype: more than 2 unique alleles (${uniqueAlleles.length})`);
            }
            
        } catch (error) {
            logger.error('Failed to calculate Hardy-Weinberg probability:', error);
            throw error;
        }
    }

    /**
     * Process special alleles (* and **) for Hardy-Weinberg calculations
     * @param {Array} alleles - Original alleles array
     * @param {Map} frequencies - Allele frequencies
     * @returns {Array} Processed alleles array
     */
    processSpecialAlleles(alleles, frequencies) {
        return informativeAlleles(alleles).map(allele => {
            const alleleStr = String(allele).trim();
            
            // Обработка специальных аллелей
            if (alleleStr === '*') {
                // Одинарная звездочка - null allele (отсутствие аллеля)
                // Возвращаем как есть для дальнейшей обработки
                return '*';
            } else if (alleleStr === '**') {
                // Двойная звездочка - множественные аллели или деградированный образец
                // Возвращаем как есть для дальнейшей обработки
                return '**';
            } else if (alleleStr.includes('.')) {
                // Десятичные значения (микровариации) - нормализуем
                const normalized = parseFloat(alleleStr);
                if (!isNaN(normalized)) {
                    return normalized.toString();
                }
                return alleleStr;
            }
            
            return alleleStr;
        });
    }

    /**
     * Get allele frequency with special allele handling
     * @param {string} allele - Allele value
     * @param {Map} frequencies - Allele frequencies
     * @returns {number|null} Frequency or null if not found
     */
    getAlleleFrequency(allele, frequencies) {
        if (isSpecialAllele(allele) || isMissingAllele(allele) || String(allele).includes('?')) return null;
        const alleleStr = String(allele).trim();
        
        // Прямой поиск частоты
        if (frequencies.has(alleleStr)) {
            return frequencies.get(alleleStr);
        }
        
        // Обработка специальных аллелей
        if (alleleStr === '*') {
            // Null allele - используем типичную частоту null аллелей (обычно 0.001-0.01)
            logger.debug(`Using null allele frequency for '*': 0.005`);
            return 0.005;
        } else if (alleleStr === '**') {
            // Множественные аллели - используем среднюю частоту редких аллелей
            logger.debug(`Using multiple allele frequency for '**': 0.001`);
            return 0.001;
        }
        
        // Поиск с нормализацией (убираем лишние пробелы, приводим к числу)
        const normalizedAllele = alleleStr.replace(/\s+/g, '');
        if (frequencies.has(normalizedAllele)) {
            return frequencies.get(normalizedAllele);
        }
        
        // Поиск числового значения
        const numericValue = parseFloat(alleleStr);
        if (!isNaN(numericValue)) {
            const numericStr = numericValue.toString();
            if (frequencies.has(numericStr)) {
                return frequencies.get(numericStr);
            }
            
            // Поиск ближайшего целого числа для десятичных значений
            const roundedValue = Math.round(numericValue).toString();
            if (frequencies.has(roundedValue)) {
                logger.debug(`Using rounded allele frequency for ${alleleStr} -> ${roundedValue}`);
                return frequencies.get(roundedValue);
            }
        }
        
        // Частота не найдена
        return null;
    }

    /**
     * Get minimum frequency from the frequency map for unknown alleles
     * @param {Map} frequencies - Allele frequencies
     * @returns {number} Minimum frequency
     */
    getMinimumFrequency(frequencies) {
        if (!frequencies || frequencies.size === 0) {
            return 0.001; // Дефолтная минимальная частота
        }
        
        const values = Array.from(frequencies.values()).filter(v => v > 0);
        if (values.length === 0) {
            return 0.001;
        }
        
        const minFreq = Math.min(...values);
        // Используем минимальную частоту, но не меньше 0.0001
        return Math.max(minFreq, 0.0001);
    }

    /**
     * Calculate SNP locus probability using population genetic models
     * @param {Array} alleles - Alleles at the SNP locus
     * @param {Map} frequencies - Allele frequencies
     * @returns {number} SNP genotype probability
     */
    calculateSNPProbability(alleles, frequencies) {
        try {
            if (!alleles || alleles.length === 0) {
                throw new Error('Alleles array is required for SNP');
            }
            
            if (!frequencies || frequencies.size === 0) {
                throw new Error('Allele frequencies are required for SNP');
            }
            
            // SNPs typically have 2 alleles maximum
            const uniqueAlleles = [...new Set(alleles)].sort();
            
            if (uniqueAlleles.length === 1) {
                // Homozygous SNP: P = p²
                const allele = uniqueAlleles[0];
                const p = frequencies.get(allele);
                
                if (p === undefined) {
                    throw new Error(`Frequency not found for SNP allele ${allele}`);
                }
                
                const probability = p * p;
                logger.debug(`SNP homozygote probability for ${allele}: ${probability}`);
                return probability;
                
            } else if (uniqueAlleles.length === 2) {
                // Heterozygous SNP: P = 2pq
                const [allele1, allele2] = uniqueAlleles;
                const p = frequencies.get(allele1);
                const q = frequencies.get(allele2);
                
                if (p === undefined) {
                    throw new Error(`Frequency not found for SNP allele ${allele1}`);
                }
                if (q === undefined) {
                    throw new Error(`Frequency not found for SNP allele ${allele2}`);
                }
                
                const probability = 2 * p * q;
                logger.debug(`SNP heterozygote probability for ${allele1}/${allele2}: ${probability}`);
                return probability;
                
            } else {
                throw new Error(`Invalid SNP genotype: more than 2 unique alleles (${uniqueAlleles.length})`);
            }
            
        } catch (error) {
            logger.error('Failed to calculate SNP probability:', error);
            throw error;
        }
    }

    /**
     * Calculate Y-chromosome locus probability using haploid inheritance
     * @param {string} allele - Y-chromosome allele
     * @param {Map} frequencies - Allele frequencies
     * @returns {number} Y-chromosome probability
     */
    calculateYChromosomeProbability(allele, frequencies) {
        try {
            if (!allele) {
                throw new Error('Allele is required for Y-chromosome calculation');
            }
            
            if (!frequencies || frequencies.size === 0) {
                throw new Error('Allele frequencies are required for Y-chromosome');
            }
            
            // Y-chromosome is haploid: P = p
            const p = frequencies.get(allele);
            
            if (p === undefined) {
                throw new Error(`Frequency not found for Y-chromosome allele ${allele}`);
            }
            
            logger.debug(`Y-chromosome probability for ${allele}: ${p}`);
            return p;
            
        } catch (error) {
            logger.error('Failed to calculate Y-chromosome probability:', error);
            throw error;
        }
    }

    /**
     * Calculate match probability from likelihood ratio
     * Requirements: 8.4
     * 
     * @param {number} likelihoodRatio - Likelihood ratio
     * @returns {number} Match probability as percentage
     */
    calculateMatchProbability(likelihoodRatio) {
        try {
            if (typeof likelihoodRatio !== 'number' || 
                likelihoodRatio < 0 || 
                !isFinite(likelihoodRatio) || 
                isNaN(likelihoodRatio)) {
                logger.warn(`Invalid likelihood ratio: ${likelihoodRatio}, returning 0%`);
                return 0;
            }
            
            // Байесовская формула: P(H|E) = LR / (1 + LR)
            // где H - гипотеза совпадения, E - доказательства
            const probability = likelihoodRatio / (1 + likelihoodRatio);
            
            // Конвертируем в проценты
            const percentage = probability * 100;
            
            // Проверяем результат
            if (!isFinite(percentage) || isNaN(percentage)) {
                logger.warn(`Invalid probability result: ${percentage}, returning 0%`);
                return 0;
            }
            
            logger.debug(`Match probability calculated: LR=${likelihoodRatio}, P=${percentage.toFixed(2)}%`);
            return percentage;
            
        } catch (error) {
            logger.error(`Failed to calculate match probability for LR ${likelihoodRatio}:`, error);
            return 0; // Возвращаем 0% при ошибке
        }
    }

    /**
     * Apply Brenner correction for incomplete profiles
     * Requirements: 8.2
     * 
     * @param {number} baseLR - Base likelihood ratio
     * @param {number} analyzedLoci - Number of analyzed loci
     * @param {number} totalLoci - Total number of loci in system
     * @param {Object} options - Additional options
     * @returns {number} Corrected likelihood ratio
     */
    applyBrennerCorrection(baseLR, analyzedLoci, totalLoci, options = {}) {
        try {
            if (typeof baseLR !== 'number' || baseLR < 0) {
                throw new Error('Invalid base likelihood ratio');
            }
            
            if (analyzedLoci <= 0 || totalLoci <= 0 || analyzedLoci > totalLoci) {
                throw new Error('Invalid loci counts');
            }
            
            // Если профиль полный, коррекция не нужна
            if (analyzedLoci === totalLoci) {
                logger.debug('Profile is complete, no Brenner correction needed');
                return baseLR;
            }
            
            // Поправка Бреннера для неполных профилей
            // Формула: LR_corrected = LR_base * (N_total / N_analyzed)^k
            // где k - коэффициент коррекции (обычно 1-2)
            const correctionFactor = options.correctionFactor || 1.5;
            const completenessRatio = analyzedLoci / totalLoci;
            
            // Применяем консервативную коррекцию
            const correction = Math.pow(completenessRatio, correctionFactor);
            const correctedLR = baseLR * correction;
            
            // Логируем коррекцию
            const reductionPercentage = ((baseLR - correctedLR) / baseLR) * 100;
            
            logger.info(`Brenner correction applied: base_LR=${baseLR}, corrected_LR=${correctedLR.toFixed(2)}, reduction=${reductionPercentage.toFixed(1)}%`);
            logger.debug(`Correction parameters: analyzed=${analyzedLoci}, total=${totalLoci}, factor=${correctionFactor}`);
            
            return Math.max(correctedLR, 1e-10); // Предотвращаем нулевые значения
            
        } catch (error) {
            logger.error(`Failed to apply Brenner correction:`, error);
            return baseLR; // Возвращаем исходное значение при ошибке
        }
    }

    /**
     * Calculate statistical significance of LR value
     * @param {number} lr - Likelihood ratio
     * @returns {Object} Significance assessment
     */
    assessLRSignificance(lr) {
        const significance = this.determineLRSignificance(lr);
        const interpretation = this.interpretLR(lr);
        const colorCode = this.getLRColorCode(lr);
        
        return {
            significance,
            interpretation,
            colorCode,
            logLR: lr > 0 ? Math.log10(lr) : -Infinity,
            isExclusion: lr < 1,
            isInclusion: lr >= 1,
            isStrongEvidence: lr >= this.significanceThresholds.STRONG
        };
    }

    /**
     * Generate LR calculation report
     * @param {Object} lrResult - LR calculation result
     * @returns {Object} Formatted report
     */
    generateLRReport(lrResult) {
        const report = {
            summary: {
                overallLR: lrResult.overallLR,
                logLR: lrResult.logLR,
                significance: lrResult.significance,
                interpretation: this.interpretLR(lrResult.overallLR),
                colorCode: lrResult.colorCode
            },
            statistics: {
                commonLoci: lrResult.calculationMetadata.commonLoci,
                totalLoci1: lrResult.calculationMetadata.totalLoci1,
                totalLoci2: lrResult.calculationMetadata.totalLoci2,
                completenessRatio: lrResult.calculationMetadata.commonLoci / 
                    Math.max(lrResult.calculationMetadata.totalLoci1, lrResult.calculationMetadata.totalLoci2)
            },
            locusDetails: [],
            confidenceInterval: lrResult.confidenceInterval,
            methodology: {
                method: lrResult.calculationMetadata.method,
                population: lrResult.populationUsed,
                parameters: lrResult.calculationMetadata.parametersUsed
            },
            warnings: lrResult.calculationMetadata.warnings || [],
            errors: lrResult.calculationMetadata.errors || []
        };

        // Добавляем детали по локусам
        if (lrResult.locusLRs) {
            for (const [locusName, locusData] of lrResult.locusLRs) {
                report.locusDetails.push({
                    locus: locusName,
                    lr: locusData.lr,
                    logLR: locusData.lr > 0 ? Math.log10(locusData.lr) : -Infinity,
                    significance: locusData.significance,
                    colorCode: locusData.colorCode,
                    alleles: locusData.alleles,
                    type: locusData.locusType
                });
            }
        }

        return report;
    }

    /**
     * Validate locus data for LR calculation
     * @param {Object} locusData - Locus data to validate
     * @returns {Object} Validation result
     */
    validateLocusData(locusData) {
        const result = {
            isValid: true,
            errors: []
        };

        if (!locusData) {
            result.isValid = false;
            result.errors.push('Locus data is required');
            return result;
        }

        if (!locusData.locusName) {
            result.isValid = false;
            result.errors.push('Locus name is required');
        }

        if (!locusData.alleles || !Array.isArray(locusData.alleles)) {
            result.isValid = false;
            result.errors.push('Alleles array is required');
        }

        if (!locusData.locusType) {
            result.isValid = false;
            result.errors.push('Locus type is required');
        }

        return result;
    }
}

module.exports = LRCalculator;
