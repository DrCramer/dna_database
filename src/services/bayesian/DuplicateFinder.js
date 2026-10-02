/**
 * Duplicate Finder - Identify potential duplicate profiles using Bayesian probability
 * 
 * This service searches for duplicate profiles in the database using
 * Bayesian probability calculations and likelihood ratios.
 */

const { logger } = require('../../utils/logger');

class DuplicateFinder {
    constructor(lrCalculator, systemParameters, populationManager = null) {
        this.lrCalculator = lrCalculator;
        this.systemParameters = systemParameters;
        this.populationManager = populationManager;
    }

    /**
     * Search for duplicate profiles in database
     * @param {Object} target - Target profile to search for duplicates
     * @param {Array} database - Array of profiles to search within
     * @param {number} threshold - Probability threshold for flagging duplicates
     * @returns {Promise<Array>} Array of potential duplicate results
     */
    async searchDuplicates(target, database, threshold = null) {
        try {
            // Validate input
            const validation = this.validateSearchInput(target, database);
            if (!validation.isValid) {
                throw new Error(`Invalid search input: ${validation.errors.join(', ')}`);
            }

            // Get threshold from system parameters if not provided
            if (threshold === null) {
                threshold = await this.systemParameters.getParameter('duplicate_probability_threshold') || 0.95;
            }

            logger.info(`Duplicate search for profile ${target.id} in database of ${database.length} profiles with threshold ${threshold}`);
            
            const duplicateResults = [];
            let comparisonCount = 0;
            let aboveThresholdCount = 0;
            
            // Последовательная обработка для избежания перегрузки БД
            const MAX_RESULTS = 20; // Максимум результатов (ранний выход)
            
            for (const candidateProfile of database) {
                // Ранний выход если уже нашли достаточно совпадений
                if (duplicateResults.length >= MAX_RESULTS) {
                    logger.info(`Early exit: found ${duplicateResults.length} matches, stopping search`);
                    break;
                }
                
                // Skip self-comparison
                if (candidateProfile.id === target.id) {
                    continue;
                }
                
                try {
                    // Perform pairwise comparison
                    const comparisonResult = await this.comparePairwise(target, candidateProfile);
                    
                    comparisonCount++;
                    
                    // Add only if above threshold
                    if (comparisonResult.probability >= threshold) {
                        logger.debug(`✅ Match found: ${candidateProfile.id} with probability ${comparisonResult.probability}`);
                        duplicateResults.push(comparisonResult);
                        aboveThresholdCount++;
                    }
                    
                    // Логируем прогресс
                    if (comparisonCount % 500 === 0) {
                        logger.info(`Progress: ${comparisonCount}/${database.length} comparisons, ${aboveThresholdCount} matches found`);
                    }
                    
                } catch (comparisonError) {
                    logger.warn(`Failed to compare profiles ${target.id} and ${candidateProfile.id}:`, comparisonError);
                }
            }
            
            // Rank results by probability (highest first)
            const rankedResults = this.rankResults(duplicateResults);
            
            logger.info(`Duplicate search completed: ${comparisonCount} comparisons, ${aboveThresholdCount} above threshold, ${rankedResults.length} results returned`);
            
            return rankedResults;
            
        } catch (error) {
            logger.error('Failed to search for duplicates:', error);
            throw error;
        }
    }

    /**
     * Compare two profiles for duplicate probability
     * @param {Object} profile1 - First profile
     * @param {Object} profile2 - Second profile
     * @returns {Promise<Object>} Duplicate comparison result
     */
    async comparePairwise(profile1, profile2) {
        try {
            logger.debug(`Pairwise comparison: ${profile1.id} vs ${profile2.id}`);
            
            // Get population data for calculation (use default population if not specified)
            const populationId = 'default'; // Could be made configurable
            const populationData = await this.getPopulationData(populationId);
            
            // Calculate Bayesian match probability
            const matchProbability = await this.calculateMatchProbability(profile1, profile2, populationData);
            
            // Count matching loci
            const lociStats = this.countMatchingLoci(profile1, profile2);
            
            // Calculate LR score using the LR calculator
            let lrScore = 1.0;
            try {
                const lrResult = await this.lrCalculator.calculateProfileLR(profile1, profile2, populationData);
                lrScore = lrResult.overallLR;
            } catch (lrError) {
                logger.warn(`Failed to calculate LR for profiles ${profile1.id} and ${profile2.id}:`, lrError);
                // Continue with default LR score
            }
            
            const result = {
                matchedProfile: profile2,
                probability: matchProbability,
                lrScore: lrScore,
                matchingLoci: lociStats.matchingLoci,
                totalLoci: lociStats.totalLoci,
                comparisonMetadata: {
                    timestamp: new Date(),
                    method: 'Bayesian_probability',
                    populationUsed: populationId,
                    matchPercentage: lociStats.matchPercentage,
                    partialMatches: lociStats.partialMatches,
                    missingLoci: lociStats.missingLoci
                }
            };
            
            logger.debug(`Pairwise comparison result: probability=${matchProbability}, LR=${lrScore}, matching=${lociStats.matchingLoci}/${lociStats.totalLoci}`);
            
            return result;
            
        } catch (error) {
            logger.error('Failed to compare profiles pairwise:', error);
            throw error;
        }
    }

    /**
     * Calculate Bayesian probability for profile match
     * @param {Object} profile1 - First profile
     * @param {Object} profile2 - Second profile
     * @param {Object} populationData - Population allele frequency data
     * @returns {Promise<number>} Match probability (0-1)
     */
    async calculateMatchProbability(profile1, profile2, populationData) {
        try {
            logger.debug('Bayesian match probability calculation');
            
            // Extract loci data from both profiles
            const loci1 = this.extractLociData(profile1);
            const loci2 = this.extractLociData(profile2);
            
            // Find common loci
            const commonLoci = this.findCommonLoci(loci1, loci2);
            
            if (commonLoci.length === 0) {
                logger.warn('No common loci found between profiles');
                return 0.0;
            }
            
            let matchingLoci = 0;
            let totalComparisons = 0;
            
            // Compare each common locus
            for (const locusName of commonLoci) {
                const locus1 = loci1.get(locusName);
                const locus2 = loci2.get(locusName);
                
                totalComparisons++;
                
                // Check if alleles match exactly
                if (this.compareAlleles(locus1.alleles, locus2.alleles)) {
                    matchingLoci++;
                }
            }
            
            // Calculate match probability based on proportion of matching loci
            const matchProportion = matchingLoci / totalComparisons;
            
            // Apply Bayesian correction based on population frequencies
            let bayesianProbability = matchProportion;
            
            if (matchProportion === 1.0) {
                // All loci match - calculate probability based on profile rarity
                // For identical profiles, we want high probability
                const rarityScore = await this.calculateProfileRarityProbability(profile1, populationData);
                
                // For identical profiles, combine match proportion with rarity
                // Higher rarity should increase match confidence
                bayesianProbability = 0.7 + (rarityScore * 0.3); // Ensure minimum 0.7 for perfect matches
                
            } else if (matchProportion > 0.8) {
                // High match rate - apply partial match probability
                bayesianProbability = matchProportion * 0.9; // Conservative adjustment
            } else if (matchProportion > 0.5) {
                // Medium match rate
                bayesianProbability = matchProportion * 0.7;
            } else {
                // Low match rate
                bayesianProbability = matchProportion * 0.5;
            }
            
            // Ensure probability is within valid range
            bayesianProbability = Math.max(0.0, Math.min(1.0, bayesianProbability));
            
            logger.debug(`Bayesian match probability: ${bayesianProbability} (${matchingLoci}/${totalComparisons} loci matched, proportion: ${matchProportion})`);
            
            return bayesianProbability;
            
        } catch (error) {
            logger.error('Failed to calculate match probability:', error);
            throw error;
        }
    }

    /**
     * Count matching loci between two profiles
     * @param {Object} profile1 - First profile
     * @param {Object} profile2 - Second profile
     * @returns {Object} Loci matching statistics
     */
    countMatchingLoci(profile1, profile2) {
        try {
            logger.debug('Loci matching count');
            
            // Extract loci data from both profiles
            const loci1 = this.extractLociData(profile1);
            const loci2 = this.extractLociData(profile2);
            
            // Find common loci
            const commonLoci = this.findCommonLoci(loci1, loci2);
            
            let matchingLoci = 0;
            let partialMatches = 0;
            
            // Count exact and partial matches
            for (const locusName of commonLoci) {
                const locus1 = loci1.get(locusName);
                const locus2 = loci2.get(locusName);
                
                if (this.compareAlleles(locus1.alleles, locus2.alleles)) {
                    matchingLoci++;
                } else if (this.hasPartialMatch(locus1.alleles, locus2.alleles)) {
                    partialMatches++;
                }
            }
            
            // Calculate missing loci (loci present in one profile but not the other)
            const totalLoci1 = loci1.size;
            const totalLoci2 = loci2.size;
            const totalUniqueLoci = new Set([...loci1.keys(), ...loci2.keys()]).size;
            const missingLoci = totalUniqueLoci - commonLoci.length;
            
            const matchPercentage = commonLoci.length > 0 ? (matchingLoci / commonLoci.length) * 100 : 0;
            
            const result = {
                totalLoci: commonLoci.length,
                matchingLoci: matchingLoci,
                partialMatches: partialMatches,
                missingLoci: missingLoci,
                matchPercentage: matchPercentage,
                profile1Loci: totalLoci1,
                profile2Loci: totalLoci2,
                totalUniqueLoci: totalUniqueLoci
            };
            
            logger.debug(`Loci matching: ${matchingLoci}/${commonLoci.length} exact matches, ${partialMatches} partial matches`);
            
            return result;
            
        } catch (error) {
            logger.error('Failed to count matching loci:', error);
            throw error;
        }
    }

    /**
     * Rank duplicate results by probability score
     * @param {Array} duplicateResults - Array of duplicate comparison results
     * @returns {Array} Sorted array of results (highest probability first)
     */
    rankResults(duplicateResults) {
        try {
            return duplicateResults.sort((a, b) => b.probability - a.probability);
        } catch (error) {
            logger.error('Failed to rank duplicate results:', error);
            throw error;
        }
    }

    /**
     * Filter results by probability threshold
     * @param {Array} duplicateResults - Array of duplicate comparison results
     * @param {number} threshold - Minimum probability threshold
     * @returns {Array} Filtered results above threshold
     */
    filterByThreshold(duplicateResults, threshold) {
        try {
            return duplicateResults.filter(result => result.probability >= threshold);
        } catch (error) {
            logger.error('Failed to filter results by threshold:', error);
            throw error;
        }
    }

    /**
     * Perform batch duplicate search for multiple targets
     * @param {Array} targets - Array of target profiles
     * @param {Array} database - Database of profiles to search
     * @param {number} threshold - Probability threshold
     * @returns {Promise<Object>} Batch search results
     */
    async batchDuplicateSearch(targets, database, threshold = null) {
        try {
            // Get threshold from system parameters if not provided
            if (threshold === null) {
                threshold = await this.systemParameters.getParameter('duplicate_probability_threshold');
            }

            const results = {};
            
            for (const target of targets) {
                try {
                    results[target.id] = await this.searchDuplicates(target, database, threshold);
                } catch (error) {
                    logger.error(`Failed to search duplicates for profile ${target.id}:`, error);
                    results[target.id] = { error: error.message };
                }
            }

            logger.info(`Batch duplicate search completed for ${targets.length} targets`);
            return results;

        } catch (error) {
            logger.error('Failed to perform batch duplicate search:', error);
            throw error;
        }
    }

    /**
     * Generate duplicate search summary statistics
     * @param {Array} duplicateResults - Array of duplicate search results
     * @returns {Object} Summary statistics
     */
    generateSearchSummary(duplicateResults) {
        try {
            const summary = {
                totalComparisons: duplicateResults.length,
                duplicatesFound: duplicateResults.filter(r => r.probability >= 0.95).length,
                highProbabilityMatches: duplicateResults.filter(r => r.probability >= 0.8).length,
                averageProbability: 0.0,
                maxProbability: 0.0,
                minProbability: 1.0
            };

            if (duplicateResults.length > 0) {
                const probabilities = duplicateResults.map(r => r.probability);
                summary.averageProbability = probabilities.reduce((a, b) => a + b, 0) / probabilities.length;
                summary.maxProbability = Math.max(...probabilities);
                summary.minProbability = Math.min(...probabilities);
            }

            return summary;

        } catch (error) {
            logger.error('Failed to generate search summary:', error);
            throw error;
        }
    }

    /**
     * Extract loci data from a genetic profile
     * @param {Object} profile - Genetic profile
     * @returns {Map} Map of locus name to locus data
     */
    extractLociData(profile) {
        const lociMap = new Map();
        
        // Handle different profile formats
        if (profile.loci && profile.loci instanceof Map) {
            // Already in Map format
            return profile.loci;
        } else if (profile.loci && typeof profile.loci === 'object') {
            // Convert object to Map
            Object.entries(profile.loci).forEach(([locusName, locusData]) => {
                lociMap.set(locusName, locusData);
            });
        } else if (profile.str_data) {
            // Convert STR data format
            Object.entries(profile.str_data).forEach(([locusName, locusData]) => {
                if (Array.isArray(locusData)) {
                    // Handle array format (новый формат БД)
                    lociMap.set(locusName, {
                        locusName: locusName,
                        locusType: 'STR',
                        alleles: locusData.filter(a => a && a !== '')
                    });
                } else if (locusData && (locusData.allele1 || locusData.allele2)) {
                    // Handle format with allele1/allele2 properties (старый формат)
                    const alleles = [];
                    if (locusData.allele1) alleles.push(locusData.allele1);
                    if (locusData.allele2) alleles.push(locusData.allele2);
                    
                    lociMap.set(locusName, {
                        locusName: locusName,
                        locusType: 'STR',
                        alleles: alleles
                    });
                } else if (typeof locusData === 'string') {
                    // Handle single allele as string
                    lociMap.set(locusName, {
                        locusName: locusName,
                        locusType: 'STR',
                        alleles: [locusData]
                    });
                }
            });
        } else if (profile.strData) {
            // Handle strData format (camelCase)
            Object.entries(profile.strData).forEach(([locusName, locusData]) => {
                if (Array.isArray(locusData)) {
                    // Handle array format (новый формат БД)
                    lociMap.set(locusName, {
                        locusName: locusName,
                        locusType: 'STR',
                        alleles: locusData.filter(a => a && a !== '')
                    });
                } else if (locusData && (locusData.allele1 || locusData.allele2)) {
                    // Handle format with allele1/allele2 properties (старый формат)
                    const alleles = [];
                    if (locusData.allele1) alleles.push(locusData.allele1);
                    if (locusData.allele2) alleles.push(locusData.allele2);
                    
                    lociMap.set(locusName, {
                        locusName: locusName,
                        locusType: 'STR',
                        alleles: alleles
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
     * Compare alleles between two loci
     * @param {Array} alleles1 - First set of alleles
     * @param {Array} alleles2 - Second set of alleles
     * @returns {boolean} True if alleles match exactly
     */
    compareAlleles(alleles1, alleles2) {
        if (!alleles1 || !alleles2) {
            return false;
        }
        
        // Sort both arrays for comparison
        const sorted1 = [...alleles1].sort();
        const sorted2 = [...alleles2].sort();
        
        if (sorted1.length !== sorted2.length) {
            return false;
        }
        
        return sorted1.every((allele, index) => allele === sorted2[index]);
    }

    /**
     * Check for partial match between alleles (at least one allele in common)
     * @param {Array} alleles1 - First set of alleles
     * @param {Array} alleles2 - Second set of alleles
     * @returns {boolean} True if there's at least one common allele
     */
    hasPartialMatch(alleles1, alleles2) {
        if (!alleles1 || !alleles2) {
            return false;
        }
        
        const set1 = new Set(alleles1);
        const set2 = new Set(alleles2);
        
        for (const allele of set1) {
            if (set2.has(allele)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Calculate profile rarity probability based on population frequencies
     * @param {Object} profile - Genetic profile
     * @param {Object} populationData - Population allele frequency data
     * @returns {Promise<number>} Profile rarity probability
     */
    async calculateProfileRarityProbability(profile, populationData) {
        try {
            // This is a simplified calculation - in practice, this would use
            // more sophisticated population genetic models
            const loci = this.extractLociData(profile);
            let combinedProbability = 1.0;
            let validLoci = 0;
            
            for (const [locusName, locusData] of loci) {
                const alleleFreqs = populationData.locusFrequencies.get(locusName);
                
                if (alleleFreqs && alleleFreqs.frequencies) {
                    // Calculate genotype probability for this locus
                    const { alleles } = locusData;
                    let locusProbability = 1.0;
                    
                    if (alleles.length === 1) {
                        // Homozygote: P = p²
                        const freq = alleleFreqs.frequencies.get(alleles[0]);
                        if (freq) {
                            locusProbability = freq * freq;
                        }
                    } else if (alleles.length === 2) {
                        if (alleles[0] === alleles[1]) {
                            // Homozygote: P = p²
                            const freq = alleleFreqs.frequencies.get(alleles[0]);
                            if (freq) {
                                locusProbability = freq * freq;
                            }
                        } else {
                            // Heterozygote: P = 2pq
                            const freq1 = alleleFreqs.frequencies.get(alleles[0]);
                            const freq2 = alleleFreqs.frequencies.get(alleles[1]);
                            if (freq1 && freq2) {
                                locusProbability = 2 * freq1 * freq2;
                            }
                        }
                    }
                    
                    combinedProbability *= locusProbability;
                    validLoci++;
                }
            }
            
            // Convert to match probability (higher rarity = higher match confidence when profiles are identical)
            // For identical profiles, rarer profiles should have higher match probability
            let rarityScore = 0.5; // Default moderate probability
            
            if (validLoci > 0 && combinedProbability > 0) {
                // Use negative log to convert small probabilities to larger scores
                // More rare profiles (smaller probability) get higher scores
                const logProb = -Math.log10(combinedProbability);
                
                // Normalize to 0-1 range, with higher values for rarer profiles
                // Typical range for genetic profiles might be 1e-10 to 1e-20
                rarityScore = Math.max(0.1, Math.min(0.99, logProb / 20));
            }
            
            logger.debug(`Profile rarity probability: ${rarityScore} (based on ${validLoci} loci, combined prob: ${combinedProbability})`);
            
            return rarityScore;
            
        } catch (error) {
            logger.error('Failed to calculate profile rarity probability:', error);
            return 0.5; // Default moderate probability
        }
    }

    /**
     * Get population data using PopulationManager
     * @param {string} populationId - Population dataset identifier
     * @returns {Promise<Object>} Population data
     */
    async getPopulationData(populationId) {
        try {
            // Use PopulationManager if available
            if (this.populationManager) {
                return await this.populationManager.loadPopulationData(populationId);
            }
            
            // Fallback to mock population data for testing
            logger.warn('PopulationManager not available, using mock data');
            return {
                populationId: populationId,
                locusFrequencies: new Map([
                    ['D3S1358', {
                        locusName: 'D3S1358',
                        frequencies: new Map([
                            ['14', 0.1],
                            ['15', 0.3],
                            ['16', 0.4],
                            ['17', 0.2]
                        ]),
                        sampleSize: 1000,
                        populationId: populationId
                    }],
                    ['vWA', {
                        locusName: 'vWA',
                        frequencies: new Map([
                            ['16', 0.2],
                            ['17', 0.25],
                            ['18', 0.35],
                            ['19', 0.2]
                        ]),
                        sampleSize: 1000,
                        populationId: populationId
                    }],
                    ['D16S539', {
                        locusName: 'D16S539',
                        frequencies: new Map([
                            ['10', 0.15],
                            ['11', 0.2],
                            ['12', 0.3],
                            ['13', 0.25],
                            ['14', 0.1]
                        ]),
                        sampleSize: 1000,
                        populationId: populationId
                    }],
                    ['CSF1PO', {
                        locusName: 'CSF1PO',
                        frequencies: new Map([
                            ['9', 0.1],
                            ['10', 0.3],
                            ['11', 0.4],
                            ['12', 0.2]
                        ]),
                        sampleSize: 1000,
                        populationId: populationId
                    }],
                    ['TPOX', {
                        locusName: 'TPOX',
                        frequencies: new Map([
                            ['7', 0.1],
                            ['8', 0.3],
                            ['9', 0.4],
                            ['10', 0.2]
                        ]),
                        sampleSize: 1000,
                        populationId: populationId
                    }]
                ])
            };
        } catch (error) {
            logger.error('Failed to get population data:', error);
            throw error;
        }
    }

    /**
     * Validate profiles for duplicate search
     * @param {Object} target - Target profile
     * @param {Array} database - Database profiles
     * @returns {Object} Validation result
     */
    validateSearchInput(target, database) {
        const result = {
            isValid: true,
            errors: []
        };

        if (!target) {
            result.isValid = false;
            result.errors.push('Target profile is required');
        }

        if (!database || !Array.isArray(database)) {
            result.isValid = false;
            result.errors.push('Database must be an array of profiles');
        }

        if (database && database.length === 0) {
            result.isValid = false;
            result.errors.push('Database cannot be empty');
        }

        return result;
    }
}

module.exports = DuplicateFinder;