const express = require('express');
const Joi = require('joi');
const { authenticate, adminOrAnalyst } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { 
  DNAAnalysisService, 
  EXTENDED_40_STR_SNP_LOCI, 
  COMPATIBILITY_MODES,
  DEFAULT_CONFIG 
} = require('../services/dnaAnalysisService');
const { createBayesianEngine } = require('../services/bayesian');
const { ResultFormattingService } = require('../services/resultFormattingService');
const DNAProfile = require('../models/DNAProfile');
const PermissionService = require('../services/permissionService');
const { logger } = require('../utils/logger');
const router = express.Router();

// Initialize services with enhanced configuration
const dnaAnalysisService = new DNAAnalysisService({
  mode: COMPATIBILITY_MODES.AUTO_DETECT,
  enableBayesianAnalysis: true,
  defaultPopulation: 'caucasian'
});

const resultFormattingService = new ResultFormattingService();

// Initialize Bayesian engine
let bayesianEngine = null;
createBayesianEngine().then(engine => {
  bayesianEngine = engine;
  dnaAnalysisService.setBayesianEngine(engine);
  logger.info('Bayesian engine integrated with DNA analysis routes');
}).catch(error => {
  logger.error('Failed to initialize Bayesian engine for analysis routes:', error);
});

// Enhanced validation schemas for 40 STR/SNP markers
const compareProfilesSchema = Joi.object({
  profile1Id: Joi.string().uuid().required(),
  profile2Id: Joi.string().uuid().required(),
  options: Joi.object({
    ignoredLoci: Joi.array().items(Joi.string().valid(...EXTENDED_40_STR_SNP_LOCI)).default([]),
    minNumericMatches: Joi.number().integer().min(1).max(40).default(15),
    enableBayesianAnalysis: Joi.boolean().default(true),
    populationId: Joi.string().default('caucasian'),
    analysisMode: Joi.string().valid(...Object.values(COMPATIBILITY_MODES)).default(COMPATIBILITY_MODES.AUTO_DETECT)
  }).default({})
});

const searchProfileSchema = Joi.object({
  targetProfileId: Joi.string().uuid().required(),
  options: Joi.object({
    ignoredLoci: Joi.array().items(Joi.string().valid(...EXTENDED_40_STR_SNP_LOCI)).default([]),
    minNumericMatches: Joi.number().integer().min(1).max(40).default(15),
    enableBayesianAnalysis: Joi.boolean().default(true),
    populationId: Joi.string().default('caucasian'),
    analysisMode: Joi.string().valid(...Object.values(COMPATIBILITY_MODES)).default(COMPATIBILITY_MODES.AUTO_DETECT),
    includeMasterArray: Joi.boolean().default(true),
    includeUserProfiles: Joi.boolean().default(true),
    limit: Joi.number().integer().min(1).max(1000).default(100),
    sortBy: Joi.string().valid('matchPercentage', 'sampleName', 'uploadDate', 'numericMatches', 'likelihoodRatio').default('matchPercentage'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    page: Joi.number().integer().min(1).default(1),
    includeLocusDetails: Joi.boolean().default(false),
    highlightThreshold: Joi.number().min(0).max(100).default(80)
  }).default({})
});

const bulkSearchSchema = Joi.object({
  options: Joi.object({
    ignoredLoci: Joi.array().items(Joi.string().valid(...EXTENDED_40_STR_SNP_LOCI)).default([]),
    minNumericMatches: Joi.number().integer().min(1).max(40).default(15),
    enableBayesianAnalysis: Joi.boolean().default(true),
    populationId: Joi.string().default('caucasian'),
    analysisMode: Joi.string().valid(...Object.values(COMPATIBILITY_MODES)).default(COMPATIBILITY_MODES.AUTO_DETECT),
    includeMasterArray: Joi.boolean().default(true),
    includeUserProfiles: Joi.boolean().default(true),
    limit: Joi.number().integer().min(1).max(1000).default(100),
    maxConcurrent: Joi.number().integer().min(1).max(10).default(5)
  }).default({})
});

const departmentSearchSchema = Joi.object({
  targetProfileId: Joi.string().uuid().required(),
  options: Joi.object({
    ignoredLoci: Joi.array().items(Joi.string().valid(...EXTENDED_40_STR_SNP_LOCI)).default([]),
    minNumericMatches: Joi.number().integer().min(1).max(40).default(15),
    enableBayesianAnalysis: Joi.boolean().default(true),
    populationId: Joi.string().default('caucasian'),
    includeMasterArray: Joi.boolean().default(true),
    includeUserProfiles: Joi.boolean().default(true)
  }).default({})
});

/**
 * Compare two specific DNA profiles with enhanced Bayesian analysis
 * POST /api/analysis/compare
 */
router.post('/compare', 
  authenticate, 
  adminOrAnalyst, 
  validate(compareProfilesSchema),
  async (req, res) => {
    try {
      const { profile1Id, profile2Id, options } = req.body;
      const userId = req.user.id;

      // Fetch profiles
      const profile1 = await DNAProfile.findById(profile1Id);
      const profile2 = await DNAProfile.findById(profile2Id);

      if (!profile1) {
        return res.status(404).json({
          error: 'Profile not found',
          message: `Profile with ID ${profile1Id} not found`
        });
      }

      if (!profile2) {
        return res.status(404).json({
          error: 'Profile not found',
          message: `Profile with ID ${profile2Id} not found`
        });
      }

      // Check permissions with organizational context
      const hasAccessProfile1 = await PermissionService.validateDataAccess(req.user.id, 'dna_profile', profile1Id);
      const hasAccessProfile2 = await PermissionService.validateDataAccess(req.user.id, 'dna_profile', profile2Id);

      if (!hasAccessProfile1 || !hasAccessProfile2) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to one or both profiles'
        });
      }

      // Perform enhanced comparison with Bayesian analysis
      const result = await dnaAnalysisService.compareProfiles(profile1, profile2, {
        ignoredLoci: options.ignoredLoci,
        minNumericMatches: options.minNumericMatches,
        enableBayesianAnalysis: options.enableBayesianAnalysis,
        populationId: options.populationId
      });

      // Format result for display with enhanced information
      const formattedResult = resultFormattingService.formatComparisonResult({
        ...result,
        profile1: {
          id: profile1.id,
          sampleName: profile1.sampleName,
          uploadDate: profile1.uploadDate,
          userId: profile1.userId
        },
        profile2: {
          id: profile2.id,
          sampleName: profile2.sampleName,
          uploadDate: profile2.uploadDate,
          userId: profile2.userId
        }
      }, {
        includeLocusDetails: true,
        highlightMatches: true,
        includeBayesianAnalysis: options.enableBayesianAnalysis,
        colorCodeLR: true
      });

      // Log the operation
      logger.info('Enhanced DNA profile comparison performed', {
        userId,
        profile1Id,
        profile2Id,
        numericMatches: result.numericMatchCount,
        overallMatch: result.overallMatch,
        bayesianEnabled: options.enableBayesianAnalysis,
        likelihoodRatio: result.bayesianAnalysis?.likelihoodRatio,
        significance: result.bayesianAnalysis?.significanceLevel,
        supportedLoci: result.supportedLoci
      });

      res.json({
        success: true,
        data: {
          ...formattedResult,
          analysisCapabilities: {
            supportedLoci: EXTENDED_40_STR_SNP_LOCI.length,
            bayesianAnalysisAvailable: bayesianEngine !== null,
            analysisMode: result.analysisMode
          }
        }
      });

    } catch (error) {
      logger.error('Error in enhanced profile comparison', {
        error: error.message,
        userId: req.user.id,
        body: req.body
      });

      res.status(500).json({
        error: 'Comparison failed',
        message: error.message
      });
    }
  }
);

/**
 * Enhanced department-scoped search with Bayesian analysis
 * POST /api/analysis/department-search
 */
router.post('/department-search',
  authenticate,
  adminOrAnalyst,
  validate(departmentSearchSchema),
  async (req, res) => {
    try {
      const { targetProfileId, options } = req.body;
      const userId = req.user.id;

      // Fetch target profile
      const targetProfile = await DNAProfile.findById(targetProfileId);
      if (!targetProfile) {
        return res.status(404).json({
          error: 'Profile not found',
          message: `Target profile with ID ${targetProfileId} not found`
        });
      }

      // Check permissions with organizational context
      const hasAccess = await PermissionService.validateDataAccess(req.user.id, 'dna_profile', targetProfileId);
      
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to this profile'
        });
      }

      // Perform department-scoped search with enhanced analysis
      const searchResult = await dnaAnalysisService.performDepartmentScopedSearch(
        targetProfile,
        userId,
        options
      );

      // Format results for display with Bayesian analysis
      const formattedResults = resultFormattingService.formatEnhancedSearchResults(
        searchResult.results,
        {
          includeLocusDetails: true,
          includeBayesianAnalysis: options.enableBayesianAnalysis,
          highlightThreshold: 80,
          colorCodeLR: true
        }
      );

      // Log the operation
      logger.info('Enhanced department-scoped DNA search performed', {
        userId,
        targetProfileId,
        department: searchResult.departmentInfo?.department_name,
        searchScope: searchResult.summary.searchScope,
        matchesFound: searchResult.results.length,
        bayesianEnabled: options.enableBayesianAnalysis,
        populationUsed: options.populationId
      });

      res.json({
        success: true,
        data: {
          targetProfile: {
            id: targetProfile.id,
            sampleName: targetProfile.sampleName,
            uploadDate: targetProfile.uploadDate
          },
          results: formattedResults,
          summary: searchResult.summary,
          departmentInfo: searchResult.departmentInfo,
          searchOptions: options,
          analysisCapabilities: {
            supportedLoci: EXTENDED_40_STR_SNP_LOCI.length,
            bayesianAnalysisAvailable: bayesianEngine !== null,
            compatibilityModes: Object.values(COMPATIBILITY_MODES)
          }
        }
      });

    } catch (error) {
      logger.error('Error in enhanced department search', {
        error: error.message,
        userId: req.user.id,
        body: req.body
      });

      res.status(500).json({
        error: 'Enhanced search failed',
        message: error.message
      });
    }
  }
);

/**
 * Batch department-scoped search for multiple profiles
 * POST /api/analysis/batch-department-search
 */
router.post('/batch-department-search',
  authenticate,
  adminOrAnalyst,
  async (req, res) => {
    try {
      const { targetProfileIds, options = {} } = req.body;
      const userId = req.user.id;

      if (!targetProfileIds || !Array.isArray(targetProfileIds) || targetProfileIds.length === 0) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Array of target profile IDs is required'
        });
      }

      if (targetProfileIds.length > 10) {
        return res.status(400).json({
          error: 'Too many profiles',
          message: 'Maximum 10 profiles allowed for batch search'
        });
      }

      // Fetch target profiles
      const targetProfiles = [];
      for (const profileId of targetProfileIds) {
        const profile = await DNAProfile.findById(profileId);
        if (profile) {
          // Check permissions
          const hasAccess = await PermissionService.validateDataAccess(req.user.id, 'dna_profile', profileId);
          if (hasAccess) {
            targetProfiles.push(profile);
          }
        }
      }

      if (targetProfiles.length === 0) {
        return res.status(404).json({
          error: 'No accessible profiles',
          message: 'No accessible profiles found from the provided IDs'
        });
      }

      // Perform batch department search
      const batchResult = await dnaAnalysisService.performBatchDepartmentSearch(
        targetProfiles,
        userId,
        options
      );

      // Format results
      const formattedResults = batchResult.results.map(result => ({
        targetProfile: result.targetProfile,
        matches: resultFormattingService.formatEnhancedSearchResults(
          result.matches,
          {
            includeLocusDetails: false,
            includeBayesianAnalysis: options.enableBayesianAnalysis,
            colorCodeLR: true
          }
        ),
        matchCount: result.matchCount
      }));

      // Log the operation
      logger.info('Batch department search completed', {
        userId,
        requestedProfiles: targetProfileIds.length,
        processedProfiles: targetProfiles.length,
        totalMatches: batchResult.summary.batchInfo.totalMatches,
        bayesianEnabled: options.enableBayesianAnalysis
      });

      res.json({
        success: true,
        data: {
          results: formattedResults,
          errors: batchResult.errors,
          summary: batchResult.summary,
          departmentInfo: batchResult.departmentInfo
        }
      });

    } catch (error) {
      logger.error('Error in batch department search', {
        error: error.message,
        userId: req.user.id,
        body: req.body
      });

      res.status(500).json({
        error: 'Batch search failed',
        message: error.message
      });
    }
  }
);

/**
 * Get department search statistics
 * GET /api/analysis/department-stats
 */
router.get('/department-stats',
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user.id;

      // Get department search statistics
      const stats = await dnaAnalysisService.getDepartmentSearchStats(userId);

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Error getting department search stats', {
        error: error.message,
        userId: req.user.id
      });

      res.status(500).json({
        error: 'Failed to get department stats',
        message: error.message
      });
    }
  }
);

/**
 * Get supported loci information
 * GET /api/analysis/supported-loci
 */
router.get('/supported-loci',
  authenticate,
  async (req, res) => {
    try {
      const { mode } = req.query;

      let supportedLoci;
      switch (mode) {
        case COMPATIBILITY_MODES.ORIGINAL_39:
          supportedLoci = require('../services/dnaAnalysisService').ORIGINAL_39_STR_LOCI;
          break;
        case COMPATIBILITY_MODES.EXTENDED_40:
          supportedLoci = EXTENDED_40_STR_SNP_LOCI;
          break;
        default:
          supportedLoci = EXTENDED_40_STR_SNP_LOCI;
      }

      // Categorize loci by type
      const lociByType = {
        STR: [],
        SNP: [],
        Y_CHROMOSOME: [],
        X_CHROMOSOME: [],
        AMELOGENIN: [],
        OTHER: []
      };

      supportedLoci.forEach(locus => {
        if (locus.startsWith('DYS') || locus === 'SRY' || locus === 'Yindel') {
          lociByType.Y_CHROMOSOME.push(locus);
        } else if (locus.startsWith('rs') || locus.toLowerCase().startsWith('rs')) {
          lociByType.SNP.push(locus);
        } else if (locus.startsWith('DXS')) {
          lociByType.X_CHROMOSOME.push(locus);
        } else if (locus === 'AMEL' || locus === 'Amelogenin') {
          lociByType.AMELOGENIN.push(locus);
        } else if (EXTENDED_40_STR_SNP_LOCI.includes(locus)) {
          lociByType.STR.push(locus);
        } else {
          lociByType.OTHER.push(locus);
        }
      });

      res.json({
        success: true,
        data: {
          mode: mode || COMPATIBILITY_MODES.AUTO_DETECT,
          totalLoci: supportedLoci.length,
          supportedLoci,
          lociByType,
          compatibilityModes: Object.values(COMPATIBILITY_MODES),
          bayesianAnalysisAvailable: bayesianEngine !== null
        }
      });

    } catch (error) {
      logger.error('Error getting supported loci', {
        error: error.message,
        userId: req.user.id
      });

      res.status(500).json({
        error: 'Failed to get supported loci',
        message: error.message
      });
    }
  }
);
/**
 * Search for matches against a target profile (enhanced with department scope)
 * POST /api/analysis/search
 */
router.post('/search',
  authenticate,
  adminOrAnalyst,
  validate(searchProfileSchema),
  async (req, res) => {
    try {
      const { targetProfileId, options } = req.body;
      const userId = req.user.id;

      // Fetch target profile
      const targetProfile = await DNAProfile.findById(targetProfileId);
      if (!targetProfile) {
        return res.status(404).json({
          error: 'Profile not found',
          message: `Target profile with ID ${targetProfileId} not found`
        });
      }

      // Check permissions with organizational context
      const hasAccess = await PermissionService.validateDataAccess(req.user.id, 'dna_profile', targetProfileId);
      
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to this profile'
        });
      }

      // Use enhanced department-scoped search
      const searchResult = await dnaAnalysisService.performDepartmentScopedSearch(
        targetProfile,
        userId,
        {
          ignoredLoci: options.ignoredLoci,
          minNumericMatches: options.minNumericMatches,
          enableBayesianAnalysis: options.enableBayesianAnalysis,
          populationId: options.populationId,
          includeMasterArray: options.includeMasterArray,
          includeUserProfiles: options.includeUserProfiles
        }
      );

      // Format results for display with pagination and sorting
      const formattedResults = resultFormattingService.formatSearchResults(
        searchResult.results, 
        {
          page: options.page,
          limit: options.limit,
          sortBy: options.sortBy,
          sortOrder: options.sortOrder,
          includeLocusDetails: options.includeLocusDetails,
          highlightThreshold: options.highlightThreshold,
          includeBayesianAnalysis: options.enableBayesianAnalysis
        }
      );

      // Log the operation
      logger.info('Enhanced DNA profile search performed', {
        userId,
        targetProfileId,
        department: searchResult.departmentInfo?.department_name,
        searchScope: searchResult.summary.searchScope,
        matchesFound: searchResult.results.length,
        returnedResults: formattedResults.results.length,
        minThreshold: options.minNumericMatches,
        bayesianEnabled: options.enableBayesianAnalysis
      });

      res.json({
        success: true,
        data: {
          targetProfile: {
            id: targetProfile.id,
            sampleName: targetProfile.sampleName,
            uploadDate: targetProfile.uploadDate
          },
          ...formattedResults,
          summary: searchResult.summary,
          departmentInfo: searchResult.departmentInfo,
          searchOptions: options
        }
      });

    } catch (error) {
      logger.error('Error in enhanced profile search', {
        error: error.message,
        userId: req.user.id,
        body: req.body
      });

      res.status(500).json({
        error: 'Search failed',
        message: error.message
      });
    }
  }
);

/**
 * Perform bulk search - compare all profiles against each other
 * POST /api/analysis/bulk-search
 */
router.post('/bulk-search',
  authenticate,
  adminOrAnalyst,
  validate(bulkSearchSchema),
  async (req, res) => {
    try {
      const { options } = req.body;
      const userId = req.user.id;

      // Get profiles to analyze with organizational scope
      let profiles;
      if (req.user.role === 'system_administrator' && !options.userProfilesOnly) {
        // System admin can analyze all profiles
        profiles = await DNAProfile.findAll({ limit: 10000 });
      } else if (req.user.role === 'department_head' && !options.userProfilesOnly) {
        // Department head can analyze department profiles
        profiles = await DNAProfile.findByDepartmentWithMasterArray(req.user.department_id, { limit: 10000 });
      } else {
        // Regular users or when userProfilesOnly is specified
        profiles = await DNAProfile.findByUserWithDepartmentAccess(userId, req.user.department_id, { limit: 10000 });
      }

      if (profiles.length < 2) {
        return res.status(400).json({
          error: 'Insufficient data',
          message: 'At least 2 profiles are required for bulk search'
        });
      }

      const allResults = [];
      let processedCount = 0;
      const totalComparisons = profiles.length;

      // Process each profile as target
      for (const targetProfile of profiles) {
        try {
          const searchResults = await dnaAnalysisService.bulkSearch(
            targetProfile,
            profiles,
            options
          );

          if (searchResults.length > 0) {
            allResults.push({
              targetProfile: {
                id: targetProfile.id,
                sampleName: targetProfile.sampleName,
                uploadDate: targetProfile.uploadDate,
                userId: targetProfile.userId
              },
              matches: searchResults.slice(0, options.limit || 100)
            });
          }

          processedCount++;
        } catch (error) {
          logger.warn('Error processing profile in bulk search', {
            targetProfileId: targetProfile.id,
            error: error.message
          });
          // Continue with other profiles
        }
      }

      // Format bulk results for display
      const formattedResults = resultFormattingService.formatBulkSearchResults(allResults, {
        includeEmptyResults: false,
        sortBy: 'matchCount',
        sortOrder: 'desc',
        limit: options.limit || 100
      });

      // Log the operation
      logger.info('Bulk DNA search completed', {
        userId,
        totalProfiles: profiles.length,
        processedProfiles: processedCount,
        profilesWithMatches: allResults.length,
        minThreshold: options.minNumericMatches
      });

      res.json({
        success: true,
        data: formattedResults
      });

    } catch (error) {
      logger.error('Error in bulk search', {
        error: error.message,
        userId: req.user.id,
        body: req.body
      });

      res.status(500).json({
        error: 'Bulk search failed',
        message: error.message
      });
    }
  }
);

/**
 * Get analysis results by ID (placeholder for future implementation)
 * GET /api/analysis/results/:id
 */
router.get('/results/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // This would typically fetch stored analysis results
    // For now, return a placeholder response
    res.json({
      success: true,
      message: 'Analysis results retrieval not yet implemented',
      data: {
        id,
        note: 'This endpoint will be implemented when result storage is added'
      }
    });

  } catch (error) {
    logger.error('Error retrieving analysis results', {
      error: error.message,
      userId: req.user.id,
      resultId: req.params.id
    });

    res.status(500).json({
      error: 'Failed to retrieve results',
      message: error.message
    });
  }
});

/**
 * Get formatted export data for results
 * POST /api/analysis/export-data
 */
router.post('/export-data',
  authenticate,
  adminOrAnalyst,
  async (req, res) => {
    try {
      const { results, searchInfo } = req.body;
      
      if (!results || !Array.isArray(results)) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Results array is required'
        });
      }

      // Format data for export
      const exportData = resultFormattingService.formatForExport(results, searchInfo);
      
      // Generate summary statistics
      const summaryStats = resultFormattingService.generateSummaryStats(results);

      logger.info('Export data generated', {
        userId: req.user.id,
        resultsCount: results.length,
        searchInfo: searchInfo?.targetProfile?.sampleName
      });

      res.json({
        success: true,
        data: {
          exportData,
          summaryStats,
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error generating export data', {
        error: error.message,
        userId: req.user.id
      });

      res.status(500).json({
        error: 'Export data generation failed',
        message: error.message
      });
    }
  }
);

/**
 * Get summary statistics for a set of results
 * POST /api/analysis/summary-stats
 */
router.post('/summary-stats',
  authenticate,
  async (req, res) => {
    try {
      const { results } = req.body;
      
      if (!results || !Array.isArray(results)) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Results array is required'
        });
      }

      // Generate summary statistics
      const summaryStats = resultFormattingService.generateSummaryStats(results);

      res.json({
        success: true,
        data: summaryStats
      });

    } catch (error) {
      logger.error('Error generating summary statistics', {
        error: error.message,
        userId: req.user.id
      });

      res.status(500).json({
        error: 'Summary statistics generation failed',
        message: error.message
      });
    }
  }
);

/**
 * Clear analysis cache (admin only)
 * POST /api/analysis/clear-cache
 */
router.post('/clear-cache',
  authenticate,
  async (req, res) => {
    try {
      // Only admin can clear cache
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only administrators can clear the analysis cache'
        });
      }

      const cacheStats = dnaAnalysisService.getCacheStats();
      dnaAnalysisService.clearCache();

      logger.info('Analysis cache cleared', {
        userId: req.user.id,
        previousCacheSize: cacheStats.size
      });

      res.json({
        success: true,
        message: 'Analysis cache cleared successfully',
        data: {
          previousCacheSize: cacheStats.size
        }
      });

    } catch (error) {
      logger.error('Error clearing analysis cache', {
        error: error.message,
        userId: req.user.id
      });

      res.status(500).json({
        error: 'Failed to clear cache',
        message: error.message
      });
    }
  }
);

module.exports = router;