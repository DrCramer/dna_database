const { informativeAlleles, isSpecialAllele } = require('../utils/alleleTokens');
const { logger } = require('../utils/logger');
const DNAProfile = require('../models/DNAProfile');
const User = require('../models/User');
const { ALL_LOCI, LOCI_TYPES, LociTypeDetector } = require('../utils/lociTypeDetector');
const locusTypeDetector = new LociTypeDetector();

// Define STR/SNP loci configuration with backward compatibility
// Original 39 STR loci from FM_DNA 1.0.0.html for backward compatibility
const ORIGINAL_39_STR_LOCI = [
  'D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'D8S1179', 'D21S11', 'D18S51',
  'D2S441', 'D19S433', 'TH01', 'FGA', 'D22S1045', 'D5S818', 'D13S317', 'D7S820',
  'D6S1043', 'D10S1248', 'D1S1656', 'D12S391', 'D2S1338', 'AMEL', 'D9S1122',
  'D18S853', 'D17S906', 'D4S2408', 'D8S1132', 'D1S1677', 'D20S482', 'D14S1434',
  'D11S4463', 'D15S659', 'D3S4529', 'D16S753', 'D17S1301', 'D18S1364', 'D2S1776',
  'D4S2366', 'D1S1627'
];

// Extended 40 STR/SNP loci configuration (includes original 39 + 1 SNP marker)
const EXTENDED_40_STR_SNP_LOCI = [
  ...ORIGINAL_39_STR_LOCI,
  'rs2032678' // Additional SNP marker for extended analysis
];

// Full 80 loci configuration (all supported genetic markers)
const FULL_80_LOCI = ALL_LOCI;

// Compatibility modes
const COMPATIBILITY_MODES = {
  ORIGINAL_39: 'original_39_str',
  EXTENDED_40: 'extended_40_str_snp',
  FULL_80: 'full_80_genetic',
  AUTO_DETECT: 'auto_detect'
};

// Default configuration
const DEFAULT_CONFIG = {
  mode: COMPATIBILITY_MODES.FULL_80, // Default to full 80 loci support
  minimumMatchThreshold: 15,
  enableBayesianAnalysis: true,
  defaultPopulation: 'caucasian',
  thetaCorrection: 0.01
};

class DNAAnalysisError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'DNAAnalysisError';
    this.code = code;
    this.details = details;
  }
}

const DNA_ERROR_CODES = {
  INVALID_STR_FORMAT: 'INVALID_STR_FORMAT',
  MISSING_LOCI: 'MISSING_LOCI',
  INVALID_ALLELE_VALUE: 'INVALID_ALLELE_VALUE',
  COMPARISON_FAILED: 'COMPARISON_FAILED',
  EXPORT_FAILED: 'EXPORT_FAILED'
};

class DNAAnalysisService {
  constructor(options = {}) {
    // Configuration options
    this.config = {
      ...DEFAULT_CONFIG,
      ...options
    };
    
    // Set STR/SNP loci based on configuration mode
    this.strLoci = this.initializeLociConfiguration();
    this.comparisonCache = new Map();
    
    // Bayesian analysis integration
    this.bayesianEngine = null;
    this.enableBayesianAnalysis = this.config.enableBayesianAnalysis;
  }

  /**
   * Initialize loci configuration based on mode
   * @returns {Array} Array of supported loci
   */
  initializeLociConfiguration() {
    switch (this.config.mode) {
      case COMPATIBILITY_MODES.ORIGINAL_39:
        return ORIGINAL_39_STR_LOCI;
      case COMPATIBILITY_MODES.EXTENDED_40:
        return EXTENDED_40_STR_SNP_LOCI;
      case COMPATIBILITY_MODES.FULL_80:
        return FULL_80_LOCI;
      case COMPATIBILITY_MODES.AUTO_DETECT:
      default:
        return FULL_80_LOCI; // Default to full 80 loci set
    }
  }

  /**
   * Set Bayesian engine for LR calculations
   * @param {Object} bayesianEngine - Bayesian engine instance
   */
  setBayesianEngine(bayesianEngine) {
    this.bayesianEngine = bayesianEngine;
    logger.info('Bayesian engine integrated with DNA Analysis Service');
  }

  /**
   * Auto-detect profile format and adjust loci configuration
   * @param {Object} profile - DNA profile to analyze
   * @returns {string} Detected format
   */
  autoDetectProfileFormat(profile) {
    if (!profile || !profile.strData) {
      return COMPATIBILITY_MODES.EXTENDED_40;
    }

    const presentLoci = Object.keys(profile.strData);
    const originalLociCount = presentLoci.filter(locus => ORIGINAL_39_STR_LOCI.includes(locus)).length;
    const extendedLociCount = presentLoci.filter(locus => EXTENDED_40_STR_SNP_LOCI.includes(locus)).length;

    // If profile has mostly original loci, use original mode for compatibility
    if (originalLociCount >= 30 && extendedLociCount === originalLociCount) {
      return COMPATIBILITY_MODES.ORIGINAL_39;
    }

    // Otherwise use extended mode
    return COMPATIBILITY_MODES.EXTENDED_40;
  }

  /**
   * Perform department-scoped search - search within user's array plus department master array
   * @param {Object} targetProfile - Profile to search for matches
   * @param {string} userId - User ID performing the search
   * @param {Object} options - Search options
   * @param {Array} options.ignoredLoci - Loci to ignore in comparison
   * @param {number} options.minNumericMatches - Minimum numeric matches required
   * @param {boolean} options.includeMasterArray - Include department master array in search
   * @param {boolean} options.includeUserProfiles - Include user's own profiles in search
   * @returns {Object} Search results with department isolation
   */
  async performDepartmentScopedSearch(targetProfile, userId, options = {}) {
    try {
      const {
        ignoredLoci = [],
        minNumericMatches = 15,
        includeMasterArray = true,
        includeUserProfiles = true
      } = options || {};

      // Ensure ignoredLoci is always an array
      const safeIgnoredLoci = Array.isArray(ignoredLoci) ? ignoredLoci : [];

      // Validate user and get department context
      const user = await User.findById(userId);
      if (!user) {
        throw new DNAAnalysisError(
          'Invalid user ID provided',
          DNA_ERROR_CODES.COMPARISON_FAILED,
          { userId }
        );
      }

      // Get accessible profiles for this user (respects department boundaries)
      const accessibleProfiles = await DNAProfile.getAccessibleProfiles(userId, {
        includeMasterArray,
        limit: 10000 // Large limit to get all accessible profiles
      });

      // Combine user profiles and master array profiles based on options
      let searchProfiles = [];
      
      if (includeUserProfiles) {
        searchProfiles = [...accessibleProfiles.userProfiles];
      }
      
      if (includeMasterArray) {
        searchProfiles = [...searchProfiles, ...accessibleProfiles.masterArrayProfiles];
      }

      // Perform bulk search within department scope
      const searchResults = await this.bulkSearch(targetProfile, searchProfiles, {
        minNumericMatches,
        ignoredLoci: safeIgnoredLoci
      });

      // Enhance results with department context
      const enhancedResults = await this.enhanceResultsWithDepartmentContext(
        searchResults,
        user,
        accessibleProfiles.departmentInfo
      );

      const searchSummary = {
        searchedBy: {
          userId: user.id,
          username: user.username,
          department: accessibleProfiles.departmentInfo?.department_name || 'No Department',
          role: user.role
        },
        searchScope: {
          userProfiles: includeUserProfiles ? accessibleProfiles.userProfiles.length : 0,
          masterArrayProfiles: includeMasterArray ? accessibleProfiles.masterArrayProfiles.length : 0,
          totalSearched: searchProfiles.length
        },
        searchParameters: {
          minNumericMatches,
          ignoredLoci: safeIgnoredLoci,
          includeMasterArray,
          includeUserProfiles
        },
        results: {
          totalMatches: enhancedResults.length,
          highMatches: enhancedResults.filter(r => r.overallMatch >= 80).length,
          perfectMatches: enhancedResults.filter(r => r.overallMatch === 100).length
        },
        searchDate: new Date().toISOString()
      };

      logger.info('Department-scoped search completed', {
        userId,
        targetSample: targetProfile.sampleName,
        searchScope: searchSummary.searchScope,
        resultsCount: enhancedResults.length
      });

      return {
        results: enhancedResults,
        summary: searchSummary,
        departmentInfo: accessibleProfiles.departmentInfo
      };
    } catch (error) {
      logger.error('Error in department-scoped search', {
        error: error.message,
        userId,
        targetProfile: targetProfile?.sampleName
      });
      throw new DNAAnalysisError(
        `Department-scoped search failed: ${error.message}`,
        DNA_ERROR_CODES.COMPARISON_FAILED,
        { userId, targetProfile: targetProfile?.sampleName }
      );
    }
  }

  /**
   * Perform batch search operations with department access control
   * @param {Array} targetProfiles - Array of profiles to search for
   * @param {string} userId - User ID performing the search
   * @param {Object} options - Search options
   * @returns {Object} Batch search results
   */
  async performBatchDepartmentSearch(targetProfiles, userId, options = {}) {
    try {
      const {
        minNumericMatches = 15,
        ignoredLoci = [],
        includeMasterArray = true,
        includeUserProfiles = true,
        maxConcurrent = 5
      } = options || {};

      // Ensure ignoredLoci is always an array
      const safeIgnoredLoci = Array.isArray(ignoredLoci) ? ignoredLoci : [];

      // Validate user
      const user = await User.findById(userId);
      if (!user) {
        throw new DNAAnalysisError(
          'Invalid user ID provided',
          DNA_ERROR_CODES.COMPARISON_FAILED,
          { userId }
        );
      }

      // Get accessible profiles once for all searches
      const accessibleProfiles = await DNAProfile.getAccessibleProfiles(userId, {
        includeMasterArray,
        limit: 10000
      });

      let searchProfiles = [];
      if (includeUserProfiles) {
        searchProfiles = [...accessibleProfiles.userProfiles];
      }
      if (includeMasterArray) {
        searchProfiles = [...searchProfiles, ...accessibleProfiles.masterArrayProfiles];
      }

      // Process searches in batches to avoid overwhelming the system
      const batchResults = [];
      const errors = [];

      for (let i = 0; i < targetProfiles.length; i += maxConcurrent) {
        const batch = targetProfiles.slice(i, i + maxConcurrent);
        
        const batchPromises = batch.map(async (targetProfile, index) => {
          try {
            const searchResults = await this.bulkSearch(targetProfile, searchProfiles, {
              minNumericMatches,
              ignoredLoci: safeIgnoredLoci
            });

            const enhancedResults = await this.enhanceResultsWithDepartmentContext(
              searchResults,
              user,
              accessibleProfiles.departmentInfo
            );

            return {
              targetProfile: {
                index: i + index,
                sampleName: targetProfile.sampleName,
                id: targetProfile.id
              },
              matches: enhancedResults,
              matchCount: enhancedResults.length
            };
          } catch (error) {
            errors.push({
              targetProfile: {
                index: i + index,
                sampleName: targetProfile.sampleName,
                id: targetProfile.id
              },
              error: error.message
            });
            return null;
          }
        });

        const batchResult = await Promise.all(batchPromises);
        batchResults.push(...batchResult.filter(result => result !== null));
      }

      const summary = {
        searchedBy: {
          userId: user.id,
          username: user.username,
          department: accessibleProfiles.departmentInfo?.department_name || 'No Department',
          role: user.role
        },
        batchInfo: {
          totalTargets: targetProfiles.length,
          successfulSearches: batchResults.length,
          failedSearches: errors.length,
          totalMatches: batchResults.reduce((sum, result) => sum + result.matchCount, 0)
        },
        searchScope: {
          userProfiles: includeUserProfiles ? accessibleProfiles.userProfiles.length : 0,
          masterArrayProfiles: includeMasterArray ? accessibleProfiles.masterArrayProfiles.length : 0,
          totalSearched: searchProfiles.length
        },
        searchParameters: {
          minNumericMatches,
          ignoredLoci: safeIgnoredLoci,
          includeMasterArray,
          includeUserProfiles,
          maxConcurrent
        },
        searchDate: new Date().toISOString()
      };

      logger.info('Batch department search completed', {
        userId,
        batchInfo: summary.batchInfo,
        searchScope: summary.searchScope
      });

      return {
        results: batchResults,
        errors,
        summary,
        departmentInfo: accessibleProfiles.departmentInfo
      };
    } catch (error) {
      logger.error('Error in batch department search', {
        error: error.message,
        userId,
        targetCount: targetProfiles?.length
      });
      throw new DNAAnalysisError(
        `Batch department search failed: ${error.message}`,
        DNA_ERROR_CODES.COMPARISON_FAILED,
        { userId, targetCount: targetProfiles?.length }
      );
    }
  }

  /**
   * Enhance search results with department context information
   * @param {Array} searchResults - Raw search results
   * @param {Object} user - User performing the search
   * @param {Object} departmentInfo - Department information
   * @returns {Array} Enhanced results with department context
   */
  async enhanceResultsWithDepartmentContext(searchResults, user, departmentInfo) {
    try {
      const enhancedResults = [];

      for (const result of searchResults) {
        const matchedProfile = result.matchedProfile;
        
        // Determine the source of the matched profile
        let profileSource = 'unknown';
        let sourceInfo = {};

        if (matchedProfile.profileType === 'master') {
          profileSource = 'master_array';
          sourceInfo = {
            masterArrayId: matchedProfile.masterArrayId,
            masterArrayName: departmentInfo?.master_array_name || 'Department Master Array',
            departmentName: departmentInfo?.department_name || 'Unknown Department'
          };
        } else if (matchedProfile.userId === user.id) {
          profileSource = 'own_profile';
          sourceInfo = {
            uploadDate: matchedProfile.uploadDate,
            fileSource: matchedProfile.fileSource
          };
        } else {
          profileSource = 'department_colleague';
          // Get colleague information if needed
          try {
            const colleague = await User.findById(matchedProfile.userId);
            sourceInfo = {
              colleagueUsername: colleague?.username || 'Unknown User',
              uploadDate: matchedProfile.uploadDate,
              fileSource: matchedProfile.fileSource
            };
          } catch (error) {
            logger.warn('Could not get colleague information', {
              userId: matchedProfile.userId,
              error: error.message
            });
            sourceInfo = {
              colleagueUsername: 'Unknown User',
              uploadDate: matchedProfile.uploadDate,
              fileSource: matchedProfile.fileSource
            };
          }
        }

        enhancedResults.push({
          ...result,
          profileSource,
          sourceInfo,
          departmentContext: {
            searcherDepartment: departmentInfo?.department_name || 'No Department',
            matchedInSameDepartment: true, // Always true due to department isolation
            accessLevel: this.determineAccessLevel(user.role, profileSource)
          }
        });
      }

      return enhancedResults;
    } catch (error) {
      logger.error('Error enhancing results with department context', {
        error: error.message,
        resultCount: searchResults.length
      });
      // Return original results if enhancement fails
      return searchResults;
    }
  }

  /**
   * Determine access level based on user role and profile source
   * @param {string} userRole - User's role
   * @param {string} profileSource - Source of the matched profile
   * @returns {string} Access level
   */
  determineAccessLevel(userRole, profileSource) {
    if (userRole === 'system_administrator') {
      return 'full_access';
    }
    
    if (userRole === 'department_head') {
      return 'department_access';
    }
    
    if (profileSource === 'own_profile') {
      return 'own_profile_access';
    }
    
    if (profileSource === 'master_array') {
      return 'master_array_access';
    }
    
    return 'colleague_profile_access';
  }

  /**
   * Validate user access to perform search operations
   * @param {string} userId - User ID
   * @param {Object} searchOptions - Search options
   * @returns {Promise<boolean>} True if user has access
   */
  async validateSearchAccess(userId, searchOptions = {}) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.is_active) {
        return false;
      }

      // All active users can perform searches within their department scope
      // Department isolation is enforced by the getAccessibleProfiles method
      return true;
    } catch (error) {
      logger.error('Error validating search access', {
        error: error.message,
        userId
      });
      return false;
    }
  }

  /**
   * Get search statistics for a user's department
   * @param {string} userId - User ID
   * @returns {Object} Search statistics
   */
  async getDepartmentSearchStats(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new DNAAnalysisError(
          'Invalid user ID provided',
          DNA_ERROR_CODES.COMPARISON_FAILED,
          { userId }
        );
      }

      const accessibleProfiles = await DNAProfile.getAccessibleProfiles(userId, {
        includeMasterArray: true,
        limit: 10000
      });

      const stats = {
        department: {
          name: accessibleProfiles.departmentInfo?.department_name || 'No Department',
          id: accessibleProfiles.departmentInfo?.department_id || null
        },
        profileCounts: {
          userProfiles: accessibleProfiles.userProfiles.length,
          masterArrayProfiles: accessibleProfiles.masterArrayProfiles.length,
          totalAccessible: accessibleProfiles.summary.totalAccessibleProfiles
        },
        searchCapabilities: {
          canSearchUserProfiles: true,
          canSearchMasterArray: accessibleProfiles.masterArrayProfiles.length > 0,
          canPerformBatchSearch: user.role !== 'user_analyst' || accessibleProfiles.summary.totalAccessibleProfiles <= 1000
        },
        userInfo: {
          role: user.role,
          canManageMasterArray: user.role === 'department_head' || user.role === 'system_administrator'
        }
      };

      return stats;
    } catch (error) {
      logger.error('Error getting department search stats', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Compare two DNA profiles and calculate match percentage with optional Bayesian analysis
   * Implements identical logic from FM_DNA 1.0.0.html with Bayesian LR enhancement
   * @param {Object} profile1 - First DNA profile
   * @param {Object} profile2 - Second DNA profile
   * @param {Object} options - Comparison options
   * @param {Array} options.ignoredLoci - Loci to ignore in comparison
   * @param {number} options.minNumericMatches - Minimum numeric matches required
   * @param {boolean} options.enableBayesianAnalysis - Enable LR calculations
   * @param {string} options.populationId - Population dataset for Bayesian analysis
   * @returns {Object} Enhanced comparison result with optional LR values
   */
  async compareProfiles(profile1, profile2, options = {}) {
    try {
      const { 
        ignoredLoci = [], 
        minNumericMatches = 15,
        enableBayesianAnalysis = this.enableBayesianAnalysis,
        populationId = this.config.defaultPopulation
      } = options || {};

      // Ensure ignoredLoci is always an array
      const safeIgnoredLoci = Array.isArray(ignoredLoci) ? ignoredLoci : [];

      // Validate profiles
      this.validateProfile(profile1);
      this.validateProfile(profile2);

      // Auto-detect profile format if in auto-detect mode
      if (this.config.mode === COMPATIBILITY_MODES.AUTO_DETECT) {
        const format1 = this.autoDetectProfileFormat(profile1);
        const format2 = this.autoDetectProfileFormat(profile2);
        
        // Use the most comprehensive format available
        if (format1 === COMPATIBILITY_MODES.FULL_80 || format2 === COMPATIBILITY_MODES.FULL_80) {
          this.strLoci = FULL_80_LOCI;
        } else if (format1 === COMPATIBILITY_MODES.EXTENDED_40 || format2 === COMPATIBILITY_MODES.EXTENDED_40) {
          this.strLoci = EXTENDED_40_STR_SNP_LOCI;
        } else {
          this.strLoci = ORIGINAL_39_STR_LOCI;
        }
      }

      // Generate cache key
      const cacheKey = this.generateCacheKey(profile1, profile2, { 
        ignoredLoci: safeIgnoredLoci, 
        minNumericMatches,
        enableBayesianAnalysis,
        populationId
      });
      
      if (this.comparisonCache.has(cacheKey)) {
        return this.comparisonCache.get(cacheKey);
      }

      const result = {
        profile1Id: profile1.id,
        profile2Id: profile2.id,
        overallMatch: 0,
        numericMatchCount: 0,
        numericMatches: 0, // Backward compatibility alias
        totalComparisons: 0,
        locusMatches: {},
        analysisDate: new Date().toISOString(),
        passesThreshold: false,
        // Enhanced fields
        analysisMode: this.config.mode,
        supportedLoci: this.strLoci.length,
        bayesianAnalysis: null
      };

      // Compare each STR/SNP locus - process all loci present in profiles
      const allLoci = new Set([
        ...Object.keys(profile1.strData || {}),
        ...Object.keys(profile2.strData || {})
      ]);
      
      for (const locus of allLoci) {
        if (safeIgnoredLoci.includes(locus)) {
          continue;
        }

        // Process all loci - don't filter by strLoci configuration for full compatibility
        const locus1 = profile1.strData[locus];
        const locus2 = profile2.strData[locus];

        if (!locus1 || !locus2) {
          result.locusMatches[locus] = {
            match: false,
            isNumeric: false,
            profile1Value: this.formatAlleleValue(locus1),
            profile2Value: this.formatAlleleValue(locus2),
            reason: 'missing_data',
            locusType: this.determineLocusType(locus, locus1 || locus2)
          };
          continue;
        }

        const locusComparison = this.compareSTRLocus(locus1, locus2, locus);
        result.locusMatches[locus] = locusComparison;

        if (locusComparison.isNumeric) {
          result.totalComparisons++;
          if (locusComparison.match) {
            result.numericMatchCount++;
            result.numericMatches++; // Backward compatibility alias
          }
        }
      }

      // Calculate overall match percentage
      if (result.totalComparisons > 0) {
        result.overallMatch = (result.numericMatchCount / result.totalComparisons) * 100;
      }

      // Check if passes threshold
      result.passesThreshold = result.numericMatchCount >= minNumericMatches;

      // Perform Bayesian analysis if enabled and profiles match
      if (enableBayesianAnalysis && this.bayesianEngine && result.passesThreshold) {
        try {
          const bayesianResult = await this.performBayesianAnalysis(
            profile1, 
            profile2, 
            populationId,
            result
          );
          result.bayesianAnalysis = bayesianResult;
        } catch (bayesianError) {
          logger.warn('Bayesian analysis failed, continuing with standard analysis', {
            error: bayesianError.message,
            profile1Id: profile1.id,
            profile2Id: profile2.id
          });
          result.bayesianAnalysis = {
            error: bayesianError.message,
            fallbackToStandard: true
          };
        }
      }

      // Cache result
      this.comparisonCache.set(cacheKey, result);

      logger.debug('Enhanced DNA profile comparison completed', {
        profile1Id: profile1.id,
        profile2Id: profile2.id,
        numericMatches: result.numericMatchCount,
        totalComparisons: result.totalComparisons,
        overallMatch: result.overallMatch,
        bayesianEnabled: enableBayesianAnalysis,
        supportedLoci: result.supportedLoci
      });

      return result;
    } catch (error) {
      logger.error('Error comparing DNA profiles', {
        error: error.message,
        profile1Id: profile1?.id,
        profile2Id: profile2?.id
      });
      throw new DNAAnalysisError(
        `Profile comparison failed: ${error.message}`,
        DNA_ERROR_CODES.COMPARISON_FAILED,
        { profile1Id: profile1?.id, profile2Id: profile2?.id }
      );
    }
  }

  /**
   * Perform Bayesian analysis on matching profiles
   * @param {Object} profile1 - First profile
   * @param {Object} profile2 - Second profile
   * @param {string} populationId - Population dataset ID
   * @param {Object} standardResult - Standard comparison result
   * @returns {Object} Bayesian analysis result
   */
  async performBayesianAnalysis(profile1, profile2, populationId, standardResult) {
    if (!this.bayesianEngine) {
      throw new Error('Bayesian engine not available');
    }

    try {
      // Convert profiles to format expected by Bayesian engine
      const bayesianProfile1 = this.convertToBayesianFormat(profile1);
      const bayesianProfile2 = this.convertToBayesianFormat(profile2);

      // Calculate Likelihood Ratio
      const lrResult = await this.bayesianEngine.calculateLR(
        bayesianProfile1,
        bayesianProfile2,
        populationId
      );

      // Enhance with color coding based on LR significance
      const significanceLevel = this.determineLRSignificance(lrResult.overallLR);

      return {
        likelihoodRatio: lrResult.overallLR,
        logLR: Math.log10(lrResult.overallLR),
        confidenceInterval: lrResult.confidenceInterval,
        locusLRs: lrResult.locusLRs,
        significanceLevel,
        colorCode: this.getLRColorCode(significanceLevel),
        populationUsed: populationId,
        calculationMethod: 'Hardy-Weinberg',
        metadata: lrResult.calculationMetadata
      };
    } catch (error) {
      logger.error('Bayesian analysis failed', {
        error: error.message,
        profile1Id: profile1.id,
        profile2Id: profile2.id,
        populationId
      });
      throw error;
    }
  }

  /**
   * Convert DNA profile to Bayesian engine format
   * @param {Object} profile - DNA profile
   * @returns {Object} Bayesian format profile
   */
  convertToBayesianFormat(profile) {
    const lociMap = new Map();
    
    Object.entries(profile.strData).forEach(([locusName, alleleData]) => {
      const locusType = this.determineLocusType(locusName, alleleData);
      const alleles = this.extractAllelesArray(alleleData);
      
      lociMap.set(locusName, {
        locusName,
        locusType,
        alleles: informativeAlleles(alleles).length === alleles.length ? informativeAlleles(alleles) : []
      });
    });

    return {
      id: profile.id,
      sampleName: profile.sampleName,
      loci: lociMap,
      str_data: profile.strData // Keep original format for compatibility
    };
  }

  /**
   * Extract alleles array from allele data
   * @param {Object} alleleData - Allele data object
   * @returns {Array} Array of alleles
   */
  extractAllelesArray(alleleData) {
    if (!alleleData) return [];
    
    // Новый формат: массив аллелей
    if (Array.isArray(alleleData)) {
      return alleleData.filter(a => a && a !== '');
    }
    
    // Старый формат: объект с allele1/allele2 (для обратной совместимости)
    if (typeof alleleData === 'object' && (alleleData.allele1 || alleleData.allele2)) {
      const alleles = [];
      if (alleleData.allele1 && alleleData.allele1 !== '') alleles.push(alleleData.allele1);
      if (alleleData.allele2 && alleleData.allele2 !== '' && alleleData.allele2 !== alleleData.allele1) {
        alleles.push(alleleData.allele2);
      }
      return alleles;
    }
    
    return [];
  }

  /**
   * Determine LR significance level
   * @param {number} lr - Likelihood ratio
   * @returns {string} Significance level
   */
  determineLRSignificance(lr) {
    if (lr >= 1e6) return 'extremely_strong';
    if (lr >= 1e4) return 'very_strong';
    if (lr >= 1e2) return 'strong';
    if (lr >= 10) return 'moderate';
    if (lr >= 1) return 'weak';
    return 'exclusion';
  }

  /**
   * Get color code for LR significance level
   * @param {string} significanceLevel - Significance level
   * @returns {string} Color code
   */
  getLRColorCode(significanceLevel) {
    const colorMap = {
      'extremely_strong': '#1a5f1a', // Dark green
      'very_strong': '#2d8f2d',      // Green
      'strong': '#4caf50',           // Light green
      'moderate': '#ff9800',         // Orange
      'weak': '#f44336',             // Red
      'exclusion': '#9c27b0'         // Purple
    };
    
    return colorMap[significanceLevel] || '#757575'; // Default gray
  }

  /**
   * Compare STR locus values using original HTML application logic
   * @param {Object} locus1 - First locus data
   * @param {Object} locus2 - Second locus data
   * @param {string} locusName - Name of the locus
   * @returns {Object} Locus comparison result
   */
  compareSTRLocus(locus1, locus2, locusName) {
    const value1 = this.formatAlleleValue(locus1);
    const value2 = this.formatAlleleValue(locus2);

    const result = {
      match: false,
      isNumeric: false,
      profile1Value: value1,
      profile2Value: value2,
      locusName
    };

    // Check if both values are numeric (not *, F, ?)
    const isValue1Numeric = this.isNumericAlleleValue(value1);
    const isValue2Numeric = this.isNumericAlleleValue(value2);

    if (isValue1Numeric && isValue2Numeric) {
      result.isNumeric = true;
      if (locusType === LOCI_TYPES.Y_INDEL) {
        const alleles1 = value1.split(',').map(value => value.trim()).sort();
        const alleles2 = value2.split(',').map(value => value.trim()).sort();
        result.match = alleles1.length === alleles2.length && alleles1.every((allele, index) => allele === alleles2[index]);
        result.yIndelInfo = { isHaploid: true, possibleMixture: alleles1.length > 1 || alleles2.length > 1 };
      } else {
        result.match = this.isSTRMatch(value1, value2);
      }
    } else {
      // Handle special symbols (*, F, ?) - these match with anything but are not numeric
      if (this.isSpecialSymbol(value1) || this.isSpecialSymbol(value2)) {
        result.match = true;
        result.reason = 'special_symbol_match';
      } else {
        result.match = false;
        result.reason = 'non_numeric_values';
      }
    }

    return result;
  }

  /**
   * Check if STR values match using original HTML logic
   * Implements the exact matching algorithm from FM_DNA 1.0.0.html
   * @param {string} value1 - First STR value
   * @param {string} value2 - Second STR value
   * @returns {boolean} True if values match
   */
  isSTRMatch(value1, value2) {
    if (!value1 || !value2) return false;

    const inputStr = value1.trim().toUpperCase();
    const cellStr = value2.trim().toUpperCase();

    // Handle special symbols - exact logic from original HTML app
    if (inputStr === '*' || inputStr === 'F' || inputStr === '?') return true;
    if (cellStr === '*' || cellStr === 'F' || cellStr === '?') return true;

    // Parse alleles - exact logic from original HTML app
    const inputParts = inputStr.split(',').map(p => p.trim());
    const cellParts = cellStr.split(',').map(p => p.trim());
    const cellSet = new Set(cellParts);

    // Check if input is homozygous (two identical alleles or single value representing homozygous)
    const isInputHomozygous = (inputParts.length === 2 && inputParts[0] === inputParts[1]) ||
                              (inputParts.length === 1);

    if (isInputHomozygous) {
      // For homozygous input, cell must also be homozygous with same allele
      const inputAllele = inputParts[0];
      const isCellHomozygous = (cellParts.length === 2 && cellParts[0] === cellParts[1]) ||
                               (cellParts.length === 1);
      
      if (isCellHomozygous) {
        const cellAllele = cellParts[0];
        return inputAllele === cellAllele;
      } else {
        // Input is homozygous but cell is heterozygous - no match
        return false;
      }
    } else {
      // For heterozygous input, all input alleles must be present in cell
      // and cell must have exactly the same alleles (no more, no less)
      if (inputParts.length !== cellParts.length) {
        return false;
      }
      
      for (const part of inputParts) {
        if (!cellSet.has(part)) {
          return false;
        }
      }
      return true;
    }
  }

  /**
   * Determine locus type based on locus name and allele values
   * @param {string} locusName - Name of the locus
   * @param {Object} alleleData - Allele data
   * @returns {string} Locus type (STR, SNP, Y_CHROMOSOME, etc.)
   */
  determineLocusType(locusName, alleleData) {
    const canonical = locusTypeDetector.getCanonicalLocusName(locusName);
    // Исторический Yindel остаётся гаплоидным спецмаркером; новые Y-InDel
    // получают собственный тип по реестру, а не только по префиксу rs.
    if (canonical === 'Yindel') return LOCI_TYPES.Y_CHROMOSOME;
    return locusTypeDetector.detectLocusType(canonical || locusName);
  }

  /**
   * Enhanced STR locus comparison with support for different marker types
   * @param {Object} locus1 - First locus data
   * @param {Object} locus2 - Second locus data
   * @param {string} locusName - Name of the locus
   * @returns {Object} Enhanced locus comparison result
   */
  compareSTRLocus(locus1, locus2, locusName) {
    const value1 = this.formatAlleleValue(locus1);
    const value2 = this.formatAlleleValue(locus2);
    
    // Determine locus type for enhanced analysis
    const locusType = this.determineLocusType(locusName, locus1);

    const result = {
      match: false,
      isNumeric: false,
      profile1Value: value1,
      profile2Value: value2,
      locusName,
      locusType
    };

    // Check if both values are numeric (not *, F, ?)
    const isValue1Numeric = this.isNumericAlleleValue(value1);
    const isValue2Numeric = this.isNumericAlleleValue(value2);

    if (isValue1Numeric && isValue2Numeric) {
      result.isNumeric = true;
      result.match = this.isSTRMatch(value1, value2);
    } else {
      // Handle special symbols (*, F, ?) - these match with anything but are not numeric
      if (this.isSpecialSymbol(value1) || this.isSpecialSymbol(value2)) {
        result.match = true;
        result.reason = 'special_symbol_match';
      } else {
        result.match = false;
        result.reason = 'non_numeric_values';
      }
    }

    // Add enhanced information for different locus types
    if (locusType === 'SNP') {
      result.snpInfo = this.analyzeSNPLocus(value1, value2);
    } else if (locusType === 'Y_CHROMOSOME') {
      result.yChromosomeInfo = this.analyzeYChromosomeLocus(value1, value2);
    } else if (locusType === LOCI_TYPES.Y_INDEL) {
      result.yIndelInfo = { isHaploid: true, possibleMixture: value1.includes(',') || value2.includes(',') };
    } else if (locusType === 'AMELOGENIN') {
      result.amelogeninInfo = this.analyzeAmelogeninLocus(value1, value2);
    }

    return result;
  }

  /**
   * Analyze SNP locus for enhanced reporting
   * @param {string} value1 - First SNP value
   * @param {string} value2 - Second SNP value
   * @returns {Object} SNP analysis information
   */
  analyzeSNPLocus(value1, value2) {
    return {
      allele1_profile1: value1.split(',')[0] || '',
      allele2_profile1: value1.split(',')[1] || value1.split(',')[0] || '',
      allele1_profile2: value2.split(',')[0] || '',
      allele2_profile2: value2.split(',')[1] || value2.split(',')[0] || '',
      isHomozygous1: !value1.includes(',') || value1.split(',')[0] === value1.split(',')[1],
      isHomozygous2: !value2.includes(',') || value2.split(',')[0] === value2.split(',')[1]
    };
  }

  /**
   * Analyze Y-chromosome locus for enhanced reporting
   * @param {string} value1 - First Y-chromosome value
   * @param {string} value2 - Second Y-chromosome value
   * @returns {Object} Y-chromosome analysis information
   */
  analyzeYChromosomeLocus(value1, value2) {
    return {
      haplotype1: value1,
      haplotype2: value2,
      isHaploid: true,
      matchType: value1 === value2 ? 'identical' : 'different'
    };
  }

  /**
   * Analyze Amelogenin locus for sex determination
   * @param {string} value1 - First Amelogenin value
   * @param {string} value2 - Second Amelogenin value
   * @returns {Object} Amelogenin analysis information
   */
  analyzeAmelogeninLocus(value1, value2) {
    const determineSex = (value) => {
      if (!value) return 'unknown';
      const val = value.toUpperCase();
      if (val.includes('X') && val.includes('Y')) return 'male';
      if (val.includes('X') && !val.includes('Y')) return 'female';
      return 'unknown';
    };

    return {
      sex1: determineSex(value1),
      sex2: determineSex(value2),
      sexMatch: determineSex(value1) === determineSex(value2),
      value1: value1,
      value2: value2
    };
  }

  /**
   * Format allele value for display and comparison
   * @param {Object|Array} alleleData - Allele data (array or object)
   * @returns {string} Formatted allele value
   */
  formatAlleleValue(alleleData) {
    if (!alleleData) return '';
    
    // Новый формат: массив аллелей
    if (Array.isArray(alleleData)) {
      const validAlleles = alleleData.filter(a => a && a !== '');
      if (validAlleles.length === 0) return '';
      
      // Убираем дубликаты для гомозигот
      const uniqueAlleles = [...new Set(validAlleles)];
      return uniqueAlleles.join(',');
    }
    
    // Старый формат: объект с allele1/allele2 (для обратной совместимости)
    if (typeof alleleData === 'object' && (alleleData.allele1 || alleleData.allele2)) {
      const { allele1, allele2 } = alleleData;
      
      if (!allele1 && !allele2) return '';
      if (!allele1) return allele2;
      if (!allele2) return allele1;
      
      // If both alleles are the same, return single value (homozygous)
      if (allele1 === allele2) {
        return allele1;
      }
      
      // Return comma-separated values (heterozygous)
      return `${allele1},${allele2}`;
    }
    
    return '';
  }

  /**
   * Check if allele value is numeric (not special symbol)
   * @param {string} value - Allele value
   * @returns {boolean} True if numeric
   */
  isNumericAlleleValue(value) {
    if (!value || value === '') return false;
    
    // Check for special symbols
    if (/^[*?F]$/i.test(value)) return false;
    
    // Check if all parts are numeric (including decimals like 9.3)
    const parts = value.split(',').map(p => p.trim());
    return parts.every(part => /^\d+(\.\d+)?$/.test(part));
  }

  /**
   * Check if value is a special symbol (*, F, ?)
   * @param {string} value - Value to check
   * @returns {boolean} True if special symbol
   */
  isSpecialSymbol(value) { return isSpecialAllele(value); }

  /**
   * Perform bulk search - compare target profile against database
   * @param {Object} targetProfile - Profile to search for matches
   * @param {Array} databaseProfiles - Array of profiles to search against
   * @param {Object} options - Search options
   * @returns {Array} Array of match results above threshold
   */
  async bulkSearch(targetProfile, databaseProfiles, options = {}) {
    try {
      const { minNumericMatches = 15, ignoredLoci = [] } = options || {};
      
      // Ensure ignoredLoci is always an array
      const safeIgnoredLoci = Array.isArray(ignoredLoci) ? ignoredLoci : [];
      
      this.validateProfile(targetProfile);
      
      const results = [];
      
      for (const dbProfile of databaseProfiles) {
        // Skip comparing profile with itself
        if (dbProfile.id === targetProfile.id) {
          continue;
        }
        
        try {
          const comparison = await this.compareProfiles(
            targetProfile, 
            dbProfile, 
            { ignoredLoci: safeIgnoredLoci, minNumericMatches }
          );
          
          // Only include results that pass the threshold
          if (comparison.passesThreshold) {
            results.push({
              ...comparison,
              matchedProfile: {
                id: dbProfile.id,
                sampleName: dbProfile.sampleName,
                uploadDate: dbProfile.uploadDate,
                userId: dbProfile.userId
              }
            });
          }
        } catch (error) {
          logger.warn('Error comparing profile in bulk search', {
            targetProfileId: targetProfile.id,
            dbProfileId: dbProfile.id,
            error: error.message
          });
          // Continue with other profiles
        }
      }
      
      // Sort results by match percentage (descending)
      results.sort((a, b) => b.overallMatch - a.overallMatch);
      
      logger.info('Bulk search completed', {
        targetProfileId: targetProfile.id,
        searchedProfiles: databaseProfiles.length,
        matchesFound: results.length,
        minThreshold: minNumericMatches
      });
      
      return results;
    } catch (error) {
      logger.error('Error in bulk search', {
        error: error.message,
        targetProfileId: targetProfile?.id
      });
      throw new DNAAnalysisError(
        `Bulk search failed: ${error.message}`,
        DNA_ERROR_CODES.COMPARISON_FAILED,
        { targetProfileId: targetProfile?.id }
      );
    }
  }

  /**
   * Validate DNA profile structure
   * @param {Object} profile - Profile to validate
   * @throws {DNAAnalysisError} If validation fails
   */
  validateProfile(profile) {
    if (!profile) {
      throw new DNAAnalysisError(
        'Profile is required',
        DNA_ERROR_CODES.INVALID_STR_FORMAT
      );
    }

    if (!profile.strData || typeof profile.strData !== 'object') {
      throw new DNAAnalysisError(
        'Profile must have valid STR data',
        DNA_ERROR_CODES.INVALID_STR_FORMAT,
        { profileId: profile.id }
      );
    }

    // Backward compatibility: Only require minimum loci for basic functionality
    const presentLoci = Object.keys(profile.strData);
    if (presentLoci.length < 3) {
      throw new DNAAnalysisError(
        `Profile must have at least 3 STR loci, found ${presentLoci.length}`,
        DNA_ERROR_CODES.MISSING_LOCI,
        { profileId: profile.id, presentLoci: presentLoci.length }
      );
    }

    // Validate that present loci are recognized
    const unrecognizedLoci = presentLoci.filter(locus => this.strLoci && !this.strLoci.includes(locus));
    if (unrecognizedLoci.length > 0) {
      console.warn(`Profile ${profile.id} contains unrecognized loci: ${unrecognizedLoci.join(', ')}`);
    }
  }

  /**
   * Generate cache key for comparison results
   * @param {Object} profile1 - First profile
   * @param {Object} profile2 - Second profile
   * @param {Object} options - Comparison options
   * @returns {string} Cache key
   */
  generateCacheKey(profile1, profile2, options) {
    const { 
      ignoredLoci = [], 
      minNumericMatches = 15,
      enableBayesianAnalysis = false,
      populationId = 'default'
    } = options || {};
    
    const sortedIds = [profile1.id, profile2.id].sort();
    const safeIgnoredLoci = Array.isArray(ignoredLoci) ? ignoredLoci : [];
    const ignoredStr = safeIgnoredLoci.sort().join(',');
    const bayesianStr = enableBayesianAnalysis ? `_bayesian_${populationId}` : '';
    
    return `${sortedIds[0]}_${sortedIds[1]}_${ignoredStr}_${minNumericMatches}${bayesianStr}`;
  }

  /**
   * Clear comparison cache
   */
  clearCache() {
    this.comparisonCache.clear();
    logger.debug('DNA analysis cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      size: this.comparisonCache.size,
      maxSize: 1000 // Could be configurable
    };
  }
}

module.exports = {
  DNAAnalysisService,
  DNAAnalysisError,
  DNA_ERROR_CODES,
  ORIGINAL_39_STR_LOCI,
  EXTENDED_40_STR_SNP_LOCI,
  COMPATIBILITY_MODES,
  DEFAULT_CONFIG
};
