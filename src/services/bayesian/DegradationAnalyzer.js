/**
 * Degradation Analyzer - Assess sample degradation using indirect statistical indicators
 * 
 * This service calculates degradation indices using STR homozygosity ratios
 * and provides quality assessments for genetic profiles.
 */

const { logger } = require('../../utils/logger');
const { LociTypeDetector, LOCI_TYPES } = require('../../utils/lociTypeDetector');
const locusTypeDetector = new LociTypeDetector();

class DegradationAnalyzer {
    constructor(systemParameters) {
        this.systemParameters = systemParameters;
    }

    /**
     * Calculate degradation index for a genetic profile
     * @param {Object} profile - Genetic profile to analyze
     * @returns {Promise<Object>} Degradation analysis result
     */
    async calculateDegradationIndex(profile) {
        try {
            logger.info(`Degradation analysis for profile ${profile.id || profile.sample_name}`);
            
            // Validate profile
            const validation = this.validateProfile(profile);
            if (!validation.isValid) {
                throw new Error(`Profile validation failed: ${validation.errors.join(', ')}`);
            }

            // Check if sufficient STR data is available
            if (!this.hasSufficientSTRData(profile)) {
                throw new Error('Insufficient STR data available for degradation analysis');
            }

            // Calculate STR homozygosity ratio
            const degradationIndex = this.calculateSTRHomozygosityRatio(profile);
            
            // Get STR loci counts for confidence interval calculation
            const strCounts = this.countSTRLoci(profile);
            
            // Calculate confidence interval
            const confidenceInterval = this.calculateConfidenceInterval(degradationIndex, strCounts.totalSTR);
            
            // Calculate quality score (inverse of degradation index)
            const qualityScore = Math.max(0, 1 - degradationIndex);
            
            // Check if degradation is flagged
            const isDegraded = await this.isDegradationFlagged(degradationIndex);
            
            // Generate recommendation
            const recommendation = this.generateQualityRecommendation(degradationIndex, qualityScore, isDegraded);
            
            const result = {
                degradationIndex,
                qualityScore,
                confidenceInterval,
                recommendation,
                isDegraded,
                strLociAnalyzed: strCounts.totalSTR,
                homozygousLoci: strCounts.homozygousSTR,
                heterozygousLoci: strCounts.heterozygousSTR,
                analysisMetadata: {
                    timestamp: new Date(),
                    method: 'STR_homozygosity_ratio',
                    parametersUsed: await this.systemParameters.getBayesianParameters()
                }
            };

            logger.debug(`Degradation analysis complete: index=${degradationIndex}, quality=${qualityScore}`);
            return result;
        } catch (error) {
            logger.error('Failed to calculate degradation index:', error);
            throw error;
        }
    }

    /**
     * Assess overall quality of a genetic profile
     * @param {Object} profile - Genetic profile
     * @returns {Promise<Object>} Quality assessment result
     */
    async assessQuality(profile) {
        try {
            logger.debug(`Quality assessment for profile ${profile.id || profile.sample_name}`);
            
            // Get degradation analysis
            const degradationResult = await this.calculateDegradationIndex(profile);
            
            // Determine overall quality based on degradation index
            let overallQuality = 'HIGH';
            if (degradationResult.degradationIndex > 0.7) {
                overallQuality = 'LOW';
            } else if (degradationResult.degradationIndex > 0.5) {
                overallQuality = 'MEDIUM';
            }
            
            // Generate recommendations
            const recommendations = this.generateRecommendations(degradationResult);
            
            return {
                overallQuality,
                qualityScore: degradationResult.qualityScore,
                degradationIndex: degradationResult.degradationIndex,
                isDegraded: degradationResult.isDegraded,
                recommendations,
                strLociAnalyzed: degradationResult.strLociAnalyzed,
                analysisDate: new Date()
            };
        } catch (error) {
            logger.error('Failed to assess profile quality:', error);
            throw error;
        }
    }

    /**
     * Calculate STR homozygosity ratio (indirect degradation indicator)
     * @param {Object} profile - Genetic profile
     * @returns {number} Homozygosity ratio (0-1)
     */
    calculateSTRHomozygosityRatio(profile) {
        try {
            logger.debug('STR homozygosity ratio calculation');
            
            const strCounts = this.countSTRLoci(profile);
            
            if (strCounts.totalSTR === 0) {
                throw new Error('No STR loci found in profile');
            }
            
            // Calculate degradation index as homozygous STR loci / total STR loci
            const degradationIndex = strCounts.homozygousSTR / strCounts.totalSTR;
            
            logger.debug(`STR homozygosity ratio: ${strCounts.homozygousSTR}/${strCounts.totalSTR} = ${degradationIndex}`);
            
            return degradationIndex;
        } catch (error) {
            logger.error('Failed to calculate STR homozygosity ratio:', error);
            throw error;
        }
    }

    /**
     * Check if degradation index exceeds threshold
     * @param {number} degradationIndex - Calculated degradation index
     * @returns {Promise<boolean>} True if degradation is flagged
     */
    async isDegradationFlagged(degradationIndex) {
        try {
            const threshold = await this.systemParameters.getParameter('degradation_threshold');
            return degradationIndex > threshold;
        } catch (error) {
            logger.error('Failed to check degradation threshold:', error);
            throw error;
        }
    }

    /**
     * Calculate confidence intervals for degradation assessment
     * @param {number} degradationIndex - Base degradation index
     * @param {number} sampleSize - Number of STR loci analyzed
     * @returns {Array} Confidence interval [lower, upper]
     */
    calculateConfidenceInterval(degradationIndex, sampleSize) {
        try {
            logger.debug('Degradation confidence interval calculation');
            
            if (sampleSize <= 0) {
                return [degradationIndex, degradationIndex];
            }
            
            // Calculate standard error for proportion
            // SE = sqrt(p * (1-p) / n) where p is the proportion and n is sample size
            const standardError = Math.sqrt((degradationIndex * (1 - degradationIndex)) / sampleSize);
            
            // 95% confidence interval using normal approximation
            // CI = p ± 1.96 * SE
            const margin = 1.96 * standardError;
            
            const lowerBound = Math.max(0, degradationIndex - margin);
            const upperBound = Math.min(1, degradationIndex + margin);
            
            logger.debug(`Confidence interval: [${lowerBound}, ${upperBound}] (SE=${standardError})`);
            
            return [lowerBound, upperBound];
        } catch (error) {
            logger.error('Failed to calculate confidence interval:', error);
            throw error;
        }
    }

    /**
     * Generate quality recommendations based on degradation analysis
     * @param {Object} degradationResult - Degradation analysis result
     * @returns {Array} Array of recommendation strings
     */
    generateRecommendations(degradationResult) {
        try {
            const recommendations = [];
            
            if (degradationResult.degradationIndex > 0.7) {
                recommendations.push('Sample shows signs of degradation - consider re-analysis');
                recommendations.push('High degradation index may affect analysis reliability');
            } else if (degradationResult.degradationIndex > 0.5) {
                recommendations.push('Moderate degradation detected - results should be interpreted with caution');
            }
            
            if (degradationResult.qualityScore < 0.5) {
                recommendations.push('Low quality sample - results may be unreliable');
            }
            
            if (degradationResult.strLociAnalyzed < 15) {
                recommendations.push('Limited STR data available - consider additional analysis');
            }
            
            if (recommendations.length === 0) {
                recommendations.push('Sample quality is acceptable for analysis');
            }
            
            return recommendations;
        } catch (error) {
            logger.error('Failed to generate recommendations:', error);
            throw error;
        }
    }

    /**
     * Generate quality recommendation based on degradation metrics
     * @param {number} degradationIndex - Degradation index
     * @param {number} qualityScore - Quality score
     * @param {boolean} isDegraded - Whether sample is flagged as degraded
     * @returns {string} Quality recommendation
     */
    generateQualityRecommendation(degradationIndex, qualityScore, isDegraded) {
        if (isDegraded || degradationIndex > 0.7) {
            return 'POOR';
        } else if (degradationIndex > 0.5) {
            return 'FAIR';
        } else if (degradationIndex > 0.3) {
            return 'GOOD';
        } else {
            return 'EXCELLENT';
        }
    }

    /**
     * Count STR loci in profile
     * @param {Object} profile - Genetic profile
     * @returns {Object} STR loci counts
     */
    countSTRLoci(profile) {
        try {
            logger.debug('STR loci counting');
            
            let totalSTR = 0;
            let homozygousSTR = 0;
            let heterozygousSTR = 0;
            let missingSTR = 0;
            
            // Get genetic data from profile (support both str_data and strData formats)
            const geneticData = profile.str_data || profile.strData || profile.loci || {};
            
            // List of STR loci (excluding AMEL which is not STR)
            const strLociList = ['D3S1358', 'D1S1656', 'D2S441', 'D10S1248', 'D13S317', 'Penta E', 'D16S539', 
                                'D18S51', 'D2S1338', 'CSF1PO', 'Penta D', 'TH01', 'vWA', 'D21S11', 'D7S820', 
                                'D5S818', 'TPOX', 'D8S1179', 'D12S391', 'D19S433', 'SE33', 'D22S1045', 'FGA',
                                'D6S1043', 'D6S477', 'D18S535', 'D19S253', 'D15S659', 'D11S2368', 'D20S470',
                                'D22-GATA198B05', 'D7S3048', 'D8S1132', 'D4S2366', 'D21S1270', 'D13S325',
                                'D9S925', 'D3S3045', 'D14S608', 'D10S1435', 'D17S1290', 'D5S2500', 'D7S1517',
                                'D3S1744', 'D2S1360', 'D6S474', 'D21S2055', 'D10S2325', 'Penta C', 'D18S1364',
                                'D5S2800', 'D9S1122', 'D20S482', 'D17S1301', 'D14S1434', 'D12ATA63', 'D1S1677',
                                'D11S4463', 'D1S1627', 'D3S4529', 'D6S1017', 'D4S2408', 'D1GATA113', 'D18S853', 'D2S1776'];
            
            // Check all loci in the genetic data, not just the predefined list
            for (const [locus, locusData] of Object.entries(geneticData)) {
                // Skip non-STR loci like AMEL
                if (locus === 'AMEL' || locus === 'Amelogenin' || locusTypeDetector.detectLocusType(locus) !== LOCI_TYPES.STR) {
                    continue;
                }
                
                if (!locusData) {
                    missingSTR++;
                    continue;
                }
                
                totalSTR++;
                
                // Check if locus is homozygous or heterozygous
                const allele1 = locusData.allele1 || locusData.alleles?.[0];
                const allele2 = locusData.allele2 || locusData.alleles?.[1];
                
                if (allele1 && allele2 && allele1 !== '0' && allele2 !== '0' && 
                    allele1 !== '' && allele2 !== '' && allele1 !== 'null' && allele2 !== 'null') {
                    if (allele1 === allele2) {
                        homozygousSTR++;
                    } else {
                        heterozygousSTR++;
                    }
                } else {
                    // Single allele or missing data - count as missing
                    totalSTR--;
                    missingSTR++;
                }
            }
            
            const result = {
                totalSTR,
                homozygousSTR,
                heterozygousSTR,
                missingSTR
            };
            
            logger.debug(`STR loci counts: ${JSON.stringify(result)}`);
            return result;
        } catch (error) {
            logger.error('Failed to count STR loci:', error);
            throw error;
        }
    }

    /**
     * Validate profile for degradation analysis
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

        if (!profile.id && !profile.sample_name) {
            result.isValid = false;
            result.errors.push('Profile ID or sample name is required');
        }

        if (!profile.str_data && !profile.strData && !profile.loci) {
            result.isValid = false;
            result.errors.push('Profile must contain genetic data (str_data, strData, or loci)');
        }

        return result;
    }

    /**
     * Check if sufficient STR data is available for analysis
     * @param {Object} profile - Genetic profile
     * @returns {boolean} True if sufficient data available
     */
    hasSufficientSTRData(profile) {
        try {
            const strCounts = this.countSTRLoci(profile);
            // Reduce minimum threshold from 10 to 3 for more lenient analysis
            return strCounts.totalSTR >= 3; // Minimum 3 STR loci for basic analysis
        } catch (error) {
            logger.error('Failed to check STR data sufficiency:', error);
            return false;
        }
    }
}

module.exports = DegradationAnalyzer;
