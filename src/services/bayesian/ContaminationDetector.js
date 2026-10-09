/**
 * Contamination Detector - Identify statistical anomalies indicating sample contamination
 * 
 * This service detects contamination using STR multi-allele detection,
 * SNP heterozygosity excess, and population frequency analysis.
 */

const { logger } = require('../../utils/logger');
const { LociTypeDetector, LOCI_TYPES } = require('../../utils/lociTypeDetector');
const locusTypeDetector = new LociTypeDetector();

class ContaminationDetector {
    constructor(populationManager, systemParameters) {
        this.populationManager = populationManager;
        this.systemParameters = systemParameters;
    }

    /**
     * Analyze genetic profile for contamination indicators
     * @param {Object} profile - Genetic profile to analyze
     * @param {Object} populationData - Population allele frequency data
     * @returns {Promise<Object>} Contamination analysis result
     */
    async analyzeProfile(profile, populationData) {
        try {
            logger.info(`Contamination analysis for profile ${profile.id}`);
            
            // Validate inputs
            const validation = this.validateProfile(profile);
            if (!validation.isValid) {
                throw new Error(`Invalid profile: ${validation.errors.join(', ')}`);
            }

            // Detect contamination using multiple methods
            const multiAlleles = this.detectSTRMultiAlleles(profile);
            const heteroExcess = this.detectSNPHeterozygosityExcess(profile, populationData);
            const freqAnomalies = this.analyzeAlleleFrequencyAnomalies(profile, populationData);

            // Calculate contamination probability
            const contaminationProbability = this.calculateContaminationScore(
                multiAlleles, heteroExcess, freqAnomalies
            );

            // Determine contamination status
            const parameters = await this.systemParameters.getBayesianParameters();
            const threshold = parameters.contaminationThreshold || 0.1;
            const isContaminated = contaminationProbability > threshold;

            // Collect all flagged loci
            const flaggedLoci = [
                ...multiAlleles.map(locus => ({ ...locus, method: 'STR_MULTI_ALLELE' })),
                ...heteroExcess.map(locus => ({ ...locus, method: 'SNP_HETEROZYGOSITY_EXCESS' })),
                ...freqAnomalies.map(locus => ({ ...locus, method: 'FREQUENCY_ANOMALY' }))
            ];

            // Determine detection methods used
            const detectionMethods = [];
            if (multiAlleles.length > 0) detectionMethods.push('STR_MULTI_ALLELE');
            if (heteroExcess.length > 0) detectionMethods.push('SNP_HETEROZYGOSITY_EXCESS');
            if (freqAnomalies.length > 0) detectionMethods.push('FREQUENCY_ANOMALY');

            // Calculate confidence based on number of indicators
            const confidence = Math.min(1.0, (flaggedLoci.length * 0.2) + 0.6);

            return {
                isContaminated,
                contaminationProbability,
                flaggedLoci,
                detectionMethod: detectionMethods,
                confidence,
                analysisMetadata: {
                    timestamp: new Date(),
                    populationUsed: populationData.populationId,
                    parametersUsed: parameters,
                    thresholdUsed: threshold,
                    totalLociAnalyzed: this.getTotalLociCount(profile),
                    flaggedLociCount: flaggedLoci.length
                }
            };
        } catch (error) {
            logger.error('Failed to analyze profile for contamination:', error);
            throw error;
        }
    }

    /**
     * Calculate contamination probability for a profile
     * @param {Object} profile - Genetic profile
     * @returns {Promise<number>} Contamination probability (0-1)
     */
    async calculateContaminationProbability(profile) {
        try {
            logger.debug(`Contamination probability calculation for profile ${profile.id}`);
            
            // For standalone probability calculation, use a simple approach
            // without requiring full population data
            const multiAlleles = this.detectSTRMultiAlleles(profile);
            const contaminationScore = this.calculateContaminationScore(multiAlleles, [], []);
            
            return contaminationScore;
        } catch (error) {
            logger.error('Failed to calculate contamination probability:', error);
            throw error;
        }
    }

    /**
     * Detect STR loci with more than 2 alleles (multi-allele detection)
     * @param {Object} profile - Genetic profile
     * @returns {Array} Array of flagged STR loci
     */
    detectSTRMultiAlleles(profile) {
        try {
            logger.debug('STR multi-allele detection');
            const flaggedLoci = [];

            // Check both str_data and loci formats for compatibility
            const strData = profile.str_data || {};
            const lociMap = profile.loci || new Map();

            // Process str_data format (legacy)
            for (const [locusName, alleles] of Object.entries(strData)) {
                const type = locusTypeDetector.detectLocusType(locusName);
                if (type === LOCI_TYPES.Y_INDEL && Array.isArray(alleles) && alleles.length > 1) {
                    flaggedLoci.push({ locusName, locusType: LOCI_TYPES.Y_INDEL, alleleCount: alleles.length, alleles: [...alleles], reason: 'Multiple alleles at a haploid Y-InDel marker; possible mixture or anomaly', severity: 'MEDIUM' });
                } else if (type === LOCI_TYPES.STR && Array.isArray(alleles) && alleles.length > 2) {
                    // Filter out non-numeric alleles (like 'X', 'Y', null, undefined)
                    const numericAlleles = alleles.filter(allele => 
                        allele !== null && 
                        allele !== undefined && 
                        allele !== '' &&
                        !['X', 'Y'].includes(allele)
                    );

                    if (numericAlleles.length > 2) {
                        flaggedLoci.push({
                            locusName,
                            locusType: 'STR',
                            alleleCount: numericAlleles.length,
                            alleles: numericAlleles,
                            reason: 'More than 2 alleles detected in STR locus',
                            severity: 'HIGH'
                        });
                    }
                }
            }

            // Process loci Map format (new format)
            if (lociMap instanceof Map) {
                for (const [locusName, locusData] of lociMap) {
                    if (locusData.locusType === LOCI_TYPES.Y_INDEL && Array.isArray(locusData.alleles) && locusData.alleles.length > 1) {
                        flaggedLoci.push({ locusName, locusType: LOCI_TYPES.Y_INDEL, alleleCount: locusData.alleles.length, alleles: [...locusData.alleles], reason: 'Multiple alleles at a haploid Y-InDel marker; possible mixture or anomaly', severity: 'MEDIUM' });
                    } else if (locusData.locusType === LOCI_TYPES.STR && Array.isArray(locusData.alleles)) {
                        // Filter out non-numeric alleles
                        const numericAlleles = locusData.alleles.filter(allele => 
                            allele !== null && 
                            allele !== undefined && 
                            allele !== '' &&
                            !['X', 'Y'].includes(allele)
                        );

                        if (numericAlleles.length > 2) {
                            flaggedLoci.push({
                                locusName,
                                locusType: 'STR',
                                alleleCount: numericAlleles.length,
                                alleles: numericAlleles,
                                reason: 'More than 2 alleles detected in STR locus',
                                severity: 'HIGH'
                            });
                        }
                    }
                }
            }

            logger.debug(`STR multi-allele detection found ${flaggedLoci.length} flagged loci`);
            return flaggedLoci;
        } catch (error) {
            logger.error('Failed to detect STR multi-alleles:', error);
            throw error;
        }
    }

    /**
     * Detect excess heterozygosity in SNP loci
     * @param {Object} profile - Genetic profile
     * @param {Object} populationData - Population data for expected frequencies
     * @returns {Array} Array of flagged SNP loci
     */
    detectSNPHeterozygosityExcess(profile, populationData) {
        try {
            logger.debug('SNP heterozygosity excess detection');
            const flaggedLoci = [];

            if (!populationData || !populationData.locusFrequencies) {
                logger.warn('No population data available for SNP heterozygosity analysis');
                return flaggedLoci;
            }

            // Process loci Map format
            const lociMap = profile.loci || new Map();
            
            if (lociMap instanceof Map) {
                for (const [locusName, locusData] of lociMap) {
                    if (locusData.locusType === 'SNP' && Array.isArray(locusData.alleles)) {
                        const populationFreqs = populationData.locusFrequencies.get(locusName);
                        
                        if (populationFreqs && populationFreqs.frequencies) {
                            const isHeterozygous = locusData.alleles.length === 2 && 
                                                 locusData.alleles[0] !== locusData.alleles[1];
                            
                            if (isHeterozygous) {
                                // Calculate expected heterozygosity using Hardy-Weinberg
                                const allele1Freq = populationFreqs.frequencies.get(locusData.alleles[0]) || 0.001;
                                const allele2Freq = populationFreqs.frequencies.get(locusData.alleles[1]) || 0.001;
                                
                                // Expected heterozygosity = 2pq (for different alleles)
                                const expectedHetero = 2 * allele1Freq * allele2Freq;
                                
                                // Flag if observed heterozygosity is much higher than expected
                                // Using a threshold of 3x expected frequency as indicator of excess
                                if (expectedHetero < 0.1) { // Low expected heterozygosity
                                    flaggedLoci.push({
                                        locusName,
                                        locusType: 'SNP',
                                        alleles: locusData.alleles,
                                        expectedHeterozygosity: expectedHetero,
                                        observedHeterozygosity: 1.0, // This sample is heterozygous
                                        reason: 'Heterozygosity excess detected in SNP locus',
                                        severity: 'MEDIUM'
                                    });
                                }
                            }
                        }
                    }
                }
            }

            logger.debug(`SNP heterozygosity excess detection found ${flaggedLoci.length} flagged loci`);
            return flaggedLoci;
        } catch (error) {
            logger.error('Failed to detect SNP heterozygosity excess:', error);
            throw error;
        }
    }

    /**
     * Analyze allele combinations for population frequency anomalies
     * @param {Object} profile - Genetic profile
     * @param {Object} populationData - Population allele frequency data
     * @returns {Array} Array of improbable allele combinations
     */
    analyzeAlleleFrequencyAnomalies(profile, populationData) {
        try {
            logger.debug('Allele frequency anomaly analysis');
            const flaggedLoci = [];

            if (!populationData || !populationData.locusFrequencies) {
                logger.warn('No population data available for frequency anomaly analysis');
                return flaggedLoci;
            }

            // Process both str_data and loci formats
            const strData = profile.str_data || {};
            const lociMap = profile.loci || new Map();

            // Check str_data format
            for (const [locusName, alleles] of Object.entries(strData)) {
                if (locusTypeDetector.detectLocusType(locusName) === LOCI_TYPES.Y_INDEL) continue;
                if (Array.isArray(alleles) && alleles.length > 0) {
                    const populationFreqs = populationData.locusFrequencies.get(locusName);
                    
                    if (populationFreqs && populationFreqs.frequencies) {
                        const anomalies = this.checkAlleleFrequencyAnomalies(
                            locusName, alleles, populationFreqs.frequencies, 'STR'
                        );
                        flaggedLoci.push(...anomalies);
                    }
                }
            }

            // Check loci Map format
            if (lociMap instanceof Map) {
                for (const [locusName, locusData] of lociMap) {
                    if (locusData.locusType === LOCI_TYPES.Y_INDEL) continue;
                    if (Array.isArray(locusData.alleles) && locusData.alleles.length > 0) {
                        const populationFreqs = populationData.locusFrequencies.get(locusName);
                        
                        if (populationFreqs && populationFreqs.frequencies) {
                            const anomalies = this.checkAlleleFrequencyAnomalies(
                                locusName, locusData.alleles, populationFreqs.frequencies, locusData.locusType
                            );
                            flaggedLoci.push(...anomalies);
                        }
                    }
                }
            }

            logger.debug(`Allele frequency anomaly analysis found ${flaggedLoci.length} flagged loci`);
            return flaggedLoci;
        } catch (error) {
            logger.error('Failed to analyze allele frequency anomalies:', error);
            throw error;
        }
    }

    /**
     * Calculate contamination score based on multiple indicators
     * @param {Array} multiAlleles - STR multi-allele flags
     * @param {Array} heteroExcess - SNP heterozygosity excess flags
     * @param {Array} freqAnomalies - Frequency anomaly flags
     * @returns {number} Combined contamination score (0-1)
     */
    calculateContaminationScore(multiAlleles, heteroExcess, freqAnomalies) {
        try {
            logger.debug('Contamination score calculation');
            
            // Weight different types of contamination indicators
            const weights = {
                multiAllele: 0.6,    // STR multi-alleles are strong indicators
                heteroExcess: 0.3,   // SNP heterozygosity excess is moderate
                freqAnomaly: 0.1     // Frequency anomalies are weaker indicators
            };

            let totalScore = 0;
            let maxPossibleScore = 0;

            // Score STR multi-allele indicators
            if (multiAlleles.length > 0) {
                // Higher score for more flagged loci and higher allele counts
                const multiAlleleScore = Math.min(1.0, multiAlleles.length * 0.3 + 
                    multiAlleles.reduce((sum, locus) => sum + (locus.alleleCount - 2) * 0.1, 0));
                totalScore += multiAlleleScore * weights.multiAllele;
            }
            maxPossibleScore += weights.multiAllele;

            // Score SNP heterozygosity excess
            if (heteroExcess.length > 0) {
                const heteroScore = Math.min(1.0, heteroExcess.length * 0.2);
                totalScore += heteroScore * weights.heteroExcess;
            }
            maxPossibleScore += weights.heteroExcess;

            // Score frequency anomalies
            if (freqAnomalies.length > 0) {
                const freqScore = Math.min(1.0, freqAnomalies.length * 0.15);
                totalScore += freqScore * weights.freqAnomaly;
            }
            maxPossibleScore += weights.freqAnomaly;

            // Normalize score to 0-1 range
            const normalizedScore = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;
            
            // Apply sigmoid function to make score more interpretable
            const finalScore = 1 / (1 + Math.exp(-5 * (normalizedScore - 0.5)));
            
            logger.debug(`Contamination score: ${finalScore} (from ${multiAlleles.length} multi-alleles, ${heteroExcess.length} hetero excess, ${freqAnomalies.length} freq anomalies)`);
            
            return Math.min(1.0, Math.max(0.0, finalScore));
        } catch (error) {
            logger.error('Failed to calculate contamination score:', error);
            throw error;
        }
    }

    /**
     * Validate profile for contamination analysis
     * @param {Object} profile - Profile to validate
     * @returns {Object} Validation result
     */
    validateProfile(profile) {
        const result = {
            isValid: true,
            errors: []
        };

        if (!profile) {
            result.isValid = false;
            result.errors.push('Profile is required');
            return result;
        }

        if (!profile.id) {
            result.isValid = false;
            result.errors.push('Profile ID is required');
        }

        if (!profile.str_data && !profile.loci) {
            result.isValid = false;
            result.errors.push('Profile must contain genetic data');
        }

        return result;
    }

    /**
     * Check allele frequency anomalies for a specific locus
     * @param {string} locusName - Name of the locus
     * @param {Array} alleles - Alleles observed in the sample
     * @param {Map} populationFreqs - Population frequency data
     * @param {string} locusType - Type of locus (STR, SNP, etc.)
     * @returns {Array} Array of anomaly flags
     */
    checkAlleleFrequencyAnomalies(locusName, alleles, populationFreqs, locusType) {
        const anomalies = [];
        const veryRareThreshold = 0.001; // Alleles with frequency < 0.1%

        for (const allele of alleles) {
            if (allele === null || allele === undefined || allele === '') {
                continue;
            }

            const frequency = populationFreqs.get(allele);
            
            if (frequency === undefined) {
                // Allele not found in population data
                anomalies.push({
                    locusName,
                    locusType,
                    allele,
                    frequency: 0,
                    reason: 'Allele not found in population database',
                    severity: 'HIGH'
                });
            } else if (frequency < veryRareThreshold) {
                // Very rare allele
                anomalies.push({
                    locusName,
                    locusType,
                    allele,
                    frequency,
                    reason: `Very rare allele (frequency: ${frequency})`,
                    severity: 'MEDIUM'
                });
            }
        }

        return anomalies;
    }

    /**
     * Get total count of loci in a profile
     * @param {Object} profile - Genetic profile
     * @returns {number} Total number of loci
     */
    getTotalLociCount(profile) {
        let count = 0;
        
        if (profile.str_data) {
            count += Object.keys(profile.str_data).length;
        }
        
        if (profile.loci instanceof Map) {
            count += profile.loci.size;
        }
        
        return count;
    }
}

module.exports = ContaminationDetector;
