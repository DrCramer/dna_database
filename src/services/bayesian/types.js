/**
 * TypeScript-like interfaces and type definitions for Bayesian Analysis Module
 * 
 * This file defines the core data structures and interfaces used throughout
 * the Bayesian genotype analysis system.
 */

/**
 * @typedef {Object} GeneticSample
 * @property {string} id - Unique sample identifier
 * @property {string} name - Sample name/registration number
 * @property {Date} collectionDate - Date when sample was collected
 * @property {Map<string, LocusData>} loci - Map of locus name to locus data
 * @property {SampleMetadata} metadata - Additional sample metadata
 * @property {Object} str_data - Legacy STR data format (for compatibility)
 */

/**
 * @typedef {Object} LocusData
 * @property {string} locusName - Name of the genetic locus
 * @property {string} allele1 - First allele value
 * @property {string} allele2 - Second allele value
 * @property {'определено'|'не определено'|'частично определено'} status - Analysis status
 * @property {number} quality - Quality score (0-1)
 */

/**
 * @typedef {Object} SampleMetadata
 * @property {string} sampleType - Type of sample (blood, saliva, etc.)
 * @property {string} laboratory - Laboratory that processed the sample
 * @property {string} analyst - Analyst who processed the sample
 * @property {Date} processingDate - Date when sample was processed
 * @property {string} [notes] - Optional notes
 */

/**
 * @typedef {Object} StaffMember
 * @property {string} id - Staff member ID
 * @property {string} name - Full name
 * @property {GeneticSample} geneticProfile - Staff member's genetic profile
 * @property {string} department - Department name
 */

/**
 * @typedef {Object} ProfileCompletenessIndex
 * @property {number} totalLoci - Total number of loci in database
 * @property {number} analyzedLoci - Number of analyzed loci
 * @property {number} pciValue - PCI value (0-1)
 * @property {'полный'|'умеренно неполный'|'сильно неполный'|'критически неполный'} classification - PCI classification
 */

/**
 * @typedef {Object} HeterozygosityAnalysis
 * @property {number} heterozygousLoci - Number of heterozygous loci
 * @property {number} observedHeterozygosity - Observed heterozygosity ratio
 * @property {number} expectedHeterozygosity - Expected heterozygosity ratio
 * @property {Map<string, number>} heterozygosityByLocus - Heterozygosity per locus
 */

/**
 * @typedef {Object} DegradationIndex
 * @property {number} degradationValue - Degradation index value
 * @property {'минимальная'|'умеренная'|'сильная'} classification - Degradation classification
 * @property {string[]} affectedLoci - List of affected loci
 */

/**
 * @typedef {Object} ContaminationResult
 * @property {boolean} isContaminated - Whether sample is contaminated
 * @property {StaffMember} [suspectedStaff] - Suspected staff member
 * @property {number} matchingLoci - Number of matching loci
 * @property {boolean} mixtureSuspicion - Whether mixture is suspected
 * @property {string[]} triAllelicLoci - Loci with 3+ alleles
 */

/**
 * @typedef {Object} DuplicateSearchResult
 * @property {DuplicateMatch[]} potentialDuplicates - Array of potential duplicates
 * @property {number} searchedSamples - Number of samples searched
 */

/**
 * @typedef {Object} DuplicateMatch
 * @property {string} sampleId - Sample ID of potential duplicate
 * @property {number} matchPercentage - Match percentage (0-100)
 * @property {number} matchingLoci - Number of matching loci
 * @property {number} totalCommonLoci - Total common loci
 * @property {boolean} recommendMerge - Whether to recommend merging
 */

/**
 * @typedef {Object} PerspectiveCategory
 * @property {'ВЫСОКАЯ ПЕРСПЕКТИВНОСТЬ'|'СРЕДНЯЯ ПЕРСПЕКТИВНОСТЬ'|'НИЗКАЯ ПЕРСПЕКТИВНОСТЬ'|'ЗАГРЯЗНЕННЫЙ'} category - Category
 * @property {string[]} reasoning - Reasoning for the category
 * @property {string[]} recommendations - Recommendations
 */

/**
 * @typedef {Object} ComparisonResult
 * @property {'sample-vs-sample'|'sample-vs-reference'|'database-search'} comparisonType - Type of comparison
 * @property {LocusComparison[]} locusComparisons - Detailed locus comparisons
 * @property {MatchStatistics} overallMatch - Overall match statistics
 * @property {number} likelihoodRatio - Likelihood ratio
 * @property {number} matchProbability - Match probability percentage
 */

/**
 * @typedef {Object} LocusComparison
 * @property {string} locusName - Name of the locus
 * @property {[string, string]} sample1Alleles - Alleles from first sample
 * @property {[string, string]} sample2Alleles - Alleles from second sample
 * @property {'полное совпадение'|'частичное совпадение'|'несовпадение'} matchType - Type of match
 * @property {number} locusLR - Likelihood ratio for this locus
 */

/**
 * @typedef {Object} MatchStatistics
 * @property {number} totalLoci - Total number of loci compared
 * @property {number} fullMatches - Number of full matches
 * @property {number} partialMatches - Number of partial matches
 * @property {number} noMatches - Number of non-matches
 * @property {number} matchPercentage - Overall match percentage
 */

/**
 * @typedef {Object} QualityAnalysisResult
 * @property {string} sampleId - Sample identifier
 * @property {ProfileCompletenessIndex} pci - Profile completeness index
 * @property {HeterozygosityAnalysis} heterozygosity - Heterozygosity analysis
 * @property {DegradationIndex} degradation - Degradation analysis
 * @property {ContaminationResult} contamination - Contamination analysis
 * @property {DuplicateSearchResult} duplicates - Duplicate search results
 * @property {PerspectiveCategory} perspectiveCategory - Overall category
 * @property {Date} analysisDate - Date of analysis
 */

/**
 * @typedef {Object} AnalysisParameters
 * @property {number} contaminationThreshold - Contamination detection threshold
 * @property {number} duplicateThreshold - Duplicate detection threshold
 * @property {number} lrThreshold - LR threshold for direct match
 * @property {Object} degradationThresholds - Degradation classification thresholds
 * @property {number} degradationThresholds.minimal - Minimal degradation threshold
 * @property {number} degradationThresholds.moderate - Moderate degradation threshold
 * @property {number} degradationThresholds.severe - Severe degradation threshold
 */

/**
 * @typedef {Object} PDFReport
 * @property {Buffer} content - PDF content as buffer
 * @property {ReportMetadata} metadata - Report metadata
 * @property {string} filename - Suggested filename
 */

/**
 * @typedef {Object} ReportMetadata
 * @property {Date} createdAt - Report creation date
 * @property {string} systemVersion - System version
 * @property {AnalysisParameters} analysisParameters - Parameters used
 * @property {string} methodology - Methodology description
 */

/**
 * @typedef {Object} PopulationFrequencies
 * @property {function(string, string): number} getFrequency - Get allele frequency
 * @property {function(string): Map<string, number>} getAlleleFrequencies - Get all frequencies for locus
 * @property {function(string, string): boolean} isFrequencyAvailable - Check if frequency is available
 */

// Export validation functions
const ValidationUtils = {
    /**
     * Validate genetic sample structure
     * @param {GeneticSample} sample - Sample to validate
     * @throws {Error} If sample is invalid
     */
    validateGeneticSample(sample) {
        if (!sample) {
            throw new Error('Sample is required');
        }
        
        if (!sample.id) {
            throw new Error('Sample ID is required');
        }
        
        if (!sample.name) {
            throw new Error('Sample name is required');
        }
        
        if (!sample.loci && !sample.str_data) {
            throw new Error('Sample must contain genetic data (loci or str_data)');
        }
        
        if (sample.loci && !(sample.loci instanceof Map) && typeof sample.loci !== 'object') {
            throw new Error('Sample loci must be a Map or object');
        }
    },

    /**
     * Validate locus data structure
     * @param {LocusData} locus - Locus to validate
     * @throws {Error} If locus is invalid
     */
    validateLocusData(locus) {
        if (!locus) {
            throw new Error('Locus data is required');
        }
        
        if (!locus.locusName) {
            throw new Error('Locus name is required');
        }
        
        // Проверка наличия аллелей (новый и старый формат)
        const hasAlleles = (locus.alleles && Array.isArray(locus.alleles) && locus.alleles.length > 0) ||
                          (locus.allele1 || locus.allele2);
        
        if (!hasAlleles) {
            throw new Error('At least one allele must be present');
        }
        
        const validStatuses = ['определено', 'не определено', 'частично определено'];
        if (locus.status && !validStatuses.includes(locus.status)) {
            throw new Error(`Invalid locus status: ${locus.status}`);
        }
    },

    /**
     * Validate PCI value
     * @param {number} pci - PCI value to validate
     * @throws {Error} If PCI is invalid
     */
    validatePCI(pci) {
        if (typeof pci !== 'number') {
            throw new Error('PCI must be a number');
        }
        
        if (pci < 0 || pci > 1) {
            throw new Error('PCI must be between 0 and 1');
        }
    },

    /**
     * Validate likelihood ratio
     * @param {number} lr - LR value to validate
     * @throws {Error} If LR is invalid
     */
    validateLR(lr) {
        if (typeof lr !== 'number') {
            throw new Error('LR must be a number');
        }
        
        if (lr < 0) {
            throw new Error('LR must be non-negative');
        }
        
        if (!isFinite(lr)) {
            throw new Error('LR must be finite');
        }
    },

    /**
     * Validate match percentage
     * @param {number} percentage - Percentage to validate
     * @throws {Error} If percentage is invalid
     */
    validatePercentage(percentage) {
        if (typeof percentage !== 'number') {
            throw new Error('Percentage must be a number');
        }
        
        if (percentage < 0 || percentage > 100) {
            throw new Error('Percentage must be between 0 and 100');
        }
    }
};

// Classification constants
const Classifications = {
    PCI: {
        FULL: 'полный',
        MODERATELY_INCOMPLETE: 'умеренно неполный',
        SEVERELY_INCOMPLETE: 'сильно неполный',
        CRITICALLY_INCOMPLETE: 'критически неполный'
    },
    
    DEGRADATION: {
        MINIMAL: 'минимальная',
        MODERATE: 'умеренная',
        SEVERE: 'сильная'
    },
    
    PERSPECTIVE: {
        HIGH: 'ВЫСОКАЯ ПЕРСПЕКТИВНОСТЬ',
        MEDIUM: 'СРЕДНЯЯ ПЕРСПЕКТИВНОСТЬ',
        LOW: 'НИЗКАЯ ПЕРСПЕКТИВНОСТЬ',
        CONTAMINATED: 'ЗАГРЯЗНЕННЫЙ'
    },
    
    MATCH: {
        FULL: 'полное совпадение',
        PARTIAL: 'частичное совпадение',
        NO_MATCH: 'несовпадение'
    }
};

// Threshold constants
const Thresholds = {
    PCI: {
        FULL: 0.80,
        MODERATELY_INCOMPLETE: 0.60,
        SEVERELY_INCOMPLETE: 0.40,
        CRITICALLY_INCOMPLETE: 0.20
    },
    
    DEGRADATION: {
        MINIMAL: 0.20,
        MODERATE: 0.40
    },
    
    CONTAMINATION: {
        MATCHING_LOCI: 3
    },
    
    DUPLICATE: {
        MERGE_THRESHOLD: 0.95
    },
    
    LR: {
        DIRECT_MATCH: 1000000
    },
    
    PERSPECTIVE: {
        HIGH_PCI: 0.60,
        MEDIUM_PCI_MIN: 0.40,
        MEDIUM_PCI_MAX: 0.59,
        MEDIUM_DEGRADATION: 0.50
    }
};

module.exports = {
    ValidationUtils,
    Classifications,
    Thresholds
};