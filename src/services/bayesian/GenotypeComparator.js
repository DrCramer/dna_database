/**
 * Genotype Comparator - Statistical comparison of genetic profiles
 * 
 * This class implements genotype comparison functionality including:
 * - Sample vs Sample comparison
 * - Sample vs Reference comparison
 * - Database search comparison
 * - Locus-level match classification
 * - Statistical significance calculation
 */

const { logger } = require('../../utils/logger');
const { ValidationUtils, Classifications, Thresholds } = require('./types');
const { query } = require('../../config/database');

class GenotypeComparator {
    constructor(lrCalculator, populationManager) {
        this.lrCalculator = lrCalculator;
        this.populationManager = populationManager;
    }

    /**
     * Compare two genetic samples directly
     * Requirements: 7.1, 7.4, 7.5, 7.6, 7.7
     * 
     * @param {GeneticSample} sample1 - First genetic sample
     * @param {GeneticSample} sample2 - Second genetic sample
     * @returns {Promise<ComparisonResult>} Comparison result
     */
    async compareSamples(sample1, sample2) {
        try {
            ValidationUtils.validateGeneticSample(sample1);
            ValidationUtils.validateGeneticSample(sample2);

            if (sample1.id === sample2.id) {
                throw new Error('Cannot compare sample with itself');
            }

            const loci1 = sample1.loci || this.convertStrDataToLoci(sample1.str_data);
            const loci2 = sample2.loci || this.convertStrDataToLoci(sample2.str_data);

            // Find common analyzed loci
            const commonLoci = this.findCommonLoci(loci1, loci2);
            
            // Perform locus-by-locus comparison
            const locusComparisons = [];
            let fullMatches = 0;
            let partialMatches = 0;
            let noMatches = 0;

            for (const locusName of commonLoci) {
                const locus1 = loci1[locusName];
                const locus2 = loci2[locusName];
                
                const comparison = await this.compareLocusPair(locusName, locus1, locus2);
                locusComparisons.push(comparison);

                // Count match types
                switch (comparison.matchType) {
                    case Classifications.MATCH.FULL:
                        fullMatches++;
                        break;
                    case Classifications.MATCH.PARTIAL:
                        partialMatches++;
                        break;
                    case Classifications.MATCH.NO_MATCH:
                        noMatches++;
                        break;
                }
            }

            // Calculate overall statistics
            const overallMatch = {
                totalLoci: commonLoci.length,
                fullMatches,
                partialMatches,
                noMatches,
                matchPercentage: commonLoci.length > 0 ? (fullMatches / commonLoci.length) * 100 : 0
            };

            // Calculate likelihood ratio and match probability
            const populationData = await this.populationManager.getPopulationData();
            const lrResult = await this.lrCalculator.calculateProfileLR(sample1, sample2, populationData);
            const likelihoodRatio = lrResult.overallLR;
            const matchProbability = this.calculateMatchProbability(likelihoodRatio);

            const result = {
                comparisonType: 'sample-vs-sample',
                locusComparisons,
                overallMatch,
                likelihoodRatio,
                matchProbability
            };

            logger.info(`Sample comparison completed: ${sample1.id} vs ${sample2.id}, LR=${likelihoodRatio}, match=${matchProbability.toFixed(2)}%`);
            return result;

        } catch (error) {
            logger.error(`Sample comparison failed: ${sample1?.id} vs ${sample2?.id}:`, error);
            throw new Error(`Sample comparison failed: ${error.message}`);
        }
    }

    /**
     * Compare sample with reference sample
     * Requirements: 7.2
     * 
     * @param {GeneticSample} sample - Sample to compare
     * @param {GeneticSample} reference - Reference sample
     * @returns {Promise<ComparisonResult>} Comparison result
     */
    async compareWithReference(sample, reference) {
        try {
            ValidationUtils.validateGeneticSample(sample);
            ValidationUtils.validateGeneticSample(reference);

            // Use the same comparison logic as sample vs sample
            const result = await this.compareSamples(sample, reference);
            result.comparisonType = 'sample-vs-reference';

            logger.info(`Reference comparison completed: ${sample.id} vs reference ${reference.id}`);
            return result;

        } catch (error) {
            logger.error(`Reference comparison failed: ${sample?.id} vs ${reference?.id}:`, error);
            throw new Error(`Reference comparison failed: ${error.message}`);
        }
    }

    /**
     * Search for matches in database
     * Requirements: 7.3
     * 
     * @param {GeneticSample} sample - Sample to search for
     * @returns {Promise<Array<ComparisonResult>>} Array of comparison results
     */
    async searchInDatabase(sample) {
        try {
            ValidationUtils.validateGeneticSample(sample);

            // Get all samples from database (excluding the current sample and staff profiles)
            const dbSamples = await query(`
                SELECT id, sample_name, str_data, created_at
                FROM dna_profiles
                WHERE id != $1
                AND str_data IS NOT NULL
                AND profile_type != 'staff'
                ORDER BY created_at DESC
            `, [sample.id]);

            const searchResults = [];

            for (const dbSample of dbSamples.rows) {
                try {
                    const dbGeneticSample = {
                        id: dbSample.id,
                        name: dbSample.sample_name,
                        str_data: dbSample.str_data,
                        collectionDate: dbSample.created_at
                    };

                    const comparison = await this.compareSamples(sample, dbGeneticSample);
                    comparison.comparisonType = 'database-search';
                    comparison.targetSampleId = dbSample.id;
                    comparison.targetSampleName = dbSample.sample_name;

                    // Only include results with some level of match
                    if (comparison.overallMatch.matchPercentage > 0) {
                        searchResults.push(comparison);
                    }

                } catch (compError) {
                    logger.warn(`Failed to compare with database sample ${dbSample.id}: ${compError.message}`);
                    // Continue with other samples
                }
            }

            // Sort by likelihood ratio (descending)
            searchResults.sort((a, b) => b.likelihoodRatio - a.likelihoodRatio);

            logger.info(`Database search completed for sample ${sample.id}: ${searchResults.length} matches found`);
            return searchResults;

        } catch (error) {
            logger.error(`Database search failed for sample ${sample?.id}:`, error);
            throw new Error(`Database search failed: ${error.message}`);
        }
    }

    /**
     * Compare a pair of loci and determine match type
     * Requirements: 7.4, 7.5, 7.6, 7.7
     * 
     * @param {string} locusName - Name of the locus
     * @param {LocusData} locus1 - First locus data
     * @param {LocusData} locus2 - Second locus data
     * @returns {Promise<LocusComparison>} Locus comparison result
     */
    async compareLocusPair(locusName, locus1, locus2) {
        try {
            const sample1Alleles = [locus1.allele1, locus1.allele2];
            const sample2Alleles = [locus2.allele1, locus2.allele2];

            // Determine match type
            let matchType;
            
            // Filter out uninformative alleles (null, undefined, '0', '**', '*', empty strings)
            const uninformativeValues = ['0', '**', '*', '', 'null', 'undefined', 'N/A'];
            const alleles1Set = new Set(sample1Alleles.filter(a => 
                a && !uninformativeValues.includes(a.toString().trim())
            ));
            const alleles2Set = new Set(sample2Alleles.filter(a => 
                a && !uninformativeValues.includes(a.toString().trim())
            ));
            
            // If either locus has no informative alleles, it's not comparable
            if (alleles1Set.size === 0 || alleles2Set.size === 0) {
                matchType = Classifications.MATCH.NO_MATCH;
            } else {
                // Find intersection
                const intersection = new Set([...alleles1Set].filter(x => alleles2Set.has(x)));
                
                // Check for full match: all alleles from both sets must be in the intersection
                if (intersection.size === alleles1Set.size && intersection.size === alleles2Set.size && alleles1Set.size > 0 && alleles2Set.size > 0) {
                    // All alleles match between the two loci
                    matchType = Classifications.MATCH.FULL;
                } else if (intersection.size > 0) {
                    // At least one allele matches
                    matchType = Classifications.MATCH.PARTIAL;
                } else {
                    // No alleles match
                    matchType = Classifications.MATCH.NO_MATCH;
                }
            }

            // Calculate locus-specific LR
            let locusLR = 0;
            if (matchType === Classifications.MATCH.FULL) {
                try {
                    locusLR = await this.lrCalculator.calculateLocusLR(sample1Alleles, sample2Alleles, locusName);
                } catch (lrError) {
                    logger.warn(`Could not calculate LR for locus ${locusName}: ${lrError.message}`);
                    locusLR = 1; // Neutral LR
                }
            }

            const result = {
                locusName,
                sample1Alleles,
                sample2Alleles,
                matchType,
                locusLR
            };

            return result;

        } catch (error) {
            logger.error(`Locus comparison failed for ${locusName}:`, error);
            throw new Error(`Locus comparison failed: ${error.message}`);
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
            ValidationUtils.validateLR(likelihoodRatio);
            
            // Formula: (LR / (1 + LR)) * 100
            const probability = (likelihoodRatio / (1 + likelihoodRatio)) * 100;
            
            ValidationUtils.validatePercentage(probability);
            return probability;

        } catch (error) {
            logger.error(`Match probability calculation failed for LR ${likelihoodRatio}:`, error);
            return 0; // Return 0% if calculation fails
        }
    }

    /**
     * Classify comparison result based on LR threshold
     * Requirements: 8.3
     * 
     * @param {number} likelihoodRatio - Likelihood ratio
     * @returns {string} Classification result
     */
    classifyComparisonResult(likelihoodRatio) {
        try {
            ValidationUtils.validateLR(likelihoodRatio);

            if (likelihoodRatio > Thresholds.LR.DIRECT_MATCH) {
                return 'Высокая вероятность';
            } else if (likelihoodRatio > 1000) {
                return 'Средняя вероятность';
            } else {
                return 'Недостаточно данных';
            }

        } catch (error) {
            logger.error(`Comparison result classification failed for LR ${likelihoodRatio}:`, error);
            return 'Недостаточно данных';
        }
    }

    /**
     * Find common analyzed loci between two samples
     * @param {Object} loci1 - First sample loci
     * @param {Object} loci2 - Second sample loci
     * @returns {Array<string>} Array of common locus names
     */
    findCommonLoci(loci1, loci2) {
        const commonLoci = [];
        
        for (const locusName of Object.keys(loci1)) {
            const locus1 = loci1[locusName];
            const locus2 = loci2[locusName];
            
            // Check if both loci are analyzed
            if (locus2 && 
                this.isLocusAnalyzed(locus1) && 
                this.isLocusAnalyzed(locus2)) {
                commonLoci.push(locusName);
            }
        }
        
        return commonLoci;
    }

    /**
     * Check if a locus is properly analyzed
     * @param {LocusData} locus - Locus data to check
     * @returns {boolean} True if locus is analyzed
     */
    isLocusAnalyzed(locus) {
        if (!locus || !locus.allele1 || !locus.allele2) {
            return false;
        }
        
        // List of uninformative values
        const uninformativeValues = ['0', '**', '*', '', 'null', 'undefined', 'N/A'];
        
        const allele1 = locus.allele1.toString().trim();
        const allele2 = locus.allele2.toString().trim();
        
        // Check if both alleles are informative
        const isAllele1Informative = !uninformativeValues.includes(allele1);
        const isAllele2Informative = !uninformativeValues.includes(allele2);
        
        return locus.status === 'определено' || (isAllele1Informative && isAllele2Informative);
    }

    /**
     * Convert legacy STR data format to loci format
     * @param {Object} strData - Legacy STR data
     * @returns {Object} Converted loci data
     */
    convertStrDataToLoci(strData) {
        if (!strData) return {};
        
        const loci = {};
        for (const [locusName, locusData] of Object.entries(strData)) {
            if (locusData && typeof locusData === 'object') {
                loci[locusName] = {
                    locusName,
                    allele1: locusData.allele1 || locusData.a1 || '0',
                    allele2: locusData.allele2 || locusData.a2 || '0',
                    status: (locusData.allele1 && locusData.allele2 && 
                            locusData.allele1 !== '0' && locusData.allele2 !== '0') ? 
                            'определено' : 'не определено',
                    quality: locusData.quality || 1.0
                };
            }
        }
        return loci;
    }

    /**
     * Generate comparison summary report
     * @param {ComparisonResult} comparisonResult - Comparison result
     * @returns {Object} Summary report
     */
    generateComparisonSummary(comparisonResult) {
        const summary = {
            comparisonType: comparisonResult.comparisonType,
            totalLoci: comparisonResult.overallMatch.totalLoci,
            matchStatistics: {
                fullMatches: comparisonResult.overallMatch.fullMatches,
                partialMatches: comparisonResult.overallMatch.partialMatches,
                noMatches: comparisonResult.overallMatch.noMatches,
                matchPercentage: comparisonResult.overallMatch.matchPercentage.toFixed(2)
            },
            statisticalAnalysis: {
                likelihoodRatio: comparisonResult.likelihoodRatio,
                matchProbability: comparisonResult.matchProbability.toFixed(2),
                classification: this.classifyComparisonResult(comparisonResult.likelihoodRatio)
            },
            locusDetails: comparisonResult.locusComparisons.map(lc => ({
                locus: lc.locusName,
                sample1: lc.sample1Alleles.join('/'),
                sample2: lc.sample2Alleles.join('/'),
                match: lc.matchType,
                lr: lc.locusLR
            }))
        };

        return summary;
    }
}

module.exports = GenotypeComparator;