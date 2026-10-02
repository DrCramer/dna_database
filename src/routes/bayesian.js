const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { authenticate, adminOrAnalyst } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const BayesianEngine = require('../services/bayesian/BayesianEngine');
const LRCalculator = require('../services/bayesian/LRCalculator');
const ContaminationDetector = require('../services/bayesian/ContaminationDetector');
const DegradationAnalyzer = require('../services/bayesian/DegradationAnalyzer');
const DuplicateFinder = require('../services/bayesian/DuplicateFinder');
const PopulationManager = require('../services/bayesian/PopulationManager');
const SystemParameters = require('../services/bayesian/SystemParameters');
const QualityMetrics = require('../services/bayesian/QualityMetrics');
const DNAProfile = require('../models/DNAProfile');
const { logger } = require('../utils/logger');

const router = express.Router();

// Custom validation middleware that returns 400 for validation errors
const validateRequest = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                message: error.details[0].message,
                details: error.details
            });
        }
        next();
    };
};

// Initialize Bayesian services with proper dependencies
const populationManager = new PopulationManager();
const systemParameters = new SystemParameters();
const qualityMetrics = new QualityMetrics();

const bayesianEngine = new BayesianEngine();
const lrCalculator = new LRCalculator(populationManager, systemParameters);
const contaminationDetector = new ContaminationDetector(populationManager, systemParameters);
const degradationAnalyzer = new DegradationAnalyzer(systemParameters);
const duplicateFinder = new DuplicateFinder(lrCalculator, systemParameters, populationManager);

// Inject dependencies into Bayesian Engine
bayesianEngine.lrCalculator = lrCalculator;
bayesianEngine.contaminationDetector = contaminationDetector;
bayesianEngine.degradationAnalyzer = degradationAnalyzer;
bayesianEngine.duplicateFinder = duplicateFinder;
bayesianEngine.populationManager = populationManager;
bayesianEngine.systemParameters = systemParameters;
bayesianEngine.qualityMetrics = qualityMetrics;

// Initialize the engine
bayesianEngine.initialize().catch(error => {
    logger.error('Failed to initialize Bayesian Engine:', error);
});

// Rate limiting for Bayesian endpoints (DISABLED for development)
const bayesianRateLimit = (req, res, next) => next(); // Disabled

const intensiveRateLimit = (req, res, next) => next(); // Disabled

// Validation schemas
const compareProfilesSchema = Joi.object({
    profile1Id: Joi.string().uuid().required(),
    profile2Id: Joi.string().uuid().required(),
    populationId: Joi.string().required(),
    options: Joi.object({
        includeLocusDetails: Joi.boolean().default(true),
        includeConfidenceInterval: Joi.boolean().default(true)
    }).default({})
});

const contaminationAnalysisSchema = Joi.object({
    profileId: Joi.string().uuid().required(),
    populationId: Joi.string().required(),
    options: Joi.object({
        includeLocusDetails: Joi.boolean().default(true),
        detectionMethods: Joi.array().items(
            Joi.string().valid('str_multi_allele', 'snp_heterozygosity', 'population_frequency')
        ).default(['str_multi_allele', 'snp_heterozygosity'])
    }).default({})
});

const duplicateSearchSchema = Joi.object({
    targetProfileId: Joi.string().uuid().required(),
    populationId: Joi.string().required(),
    options: Joi.object({
        threshold: Joi.number().min(0).max(1).default(0.95),
        limit: Joi.number().integer().min(1).max(1000).default(100),
        includeScores: Joi.boolean().default(true),
        searchScope: Joi.string().valid('all', 'user_only').default('user_only')
    }).default({})
});

const populationDataSchema = Joi.object({
    populationId: Joi.string().required(),
    name: Joi.string().required(),
    sampleSize: Joi.number().integer().min(1).required(),
    inbreedingCoefficient: Joi.number().min(0).max(0.3).default(0.0),
    loci: Joi.array().items(
        Joi.object({
            locusName: Joi.string().required(),
            frequencies: Joi.object().pattern(
                Joi.string(), // allele name
                Joi.number().min(0).max(1) // frequency
            ).required(),
            sampleSize: Joi.number().integer().min(1).optional()
        })
    ).min(1).required()
});

const degradationAnalysisSchema = Joi.object({
    profileId: Joi.string().uuid().required()
});

/**
 * Compare two genetic profiles using Bayesian analysis
 * POST /api/bayesian/compare
 */
router.post('/compare',
    bayesianRateLimit,
    authenticate,
    adminOrAnalyst,
    validateRequest(compareProfilesSchema),
    async (req, res) => {
        try {
            const { profile1Id, profile2Id, populationId, options } = req.body;
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

            // Convert profiles to format expected by Bayesian modules
            const bayesianProfile1 = {
                ...profile1,
                str_data: profile1.strData
            };
            const bayesianProfile2 = {
                ...profile2,
                str_data: profile2.strData
            };

            // Check permissions
            if (req.user.role !== 'admin') {
                if (profile1.userId !== userId && profile2.userId !== userId) {
                    return res.status(403).json({
                        error: 'Forbidden',
                        message: 'You can only compare profiles you own'
                    });
                }
            }

            // Perform Bayesian LR calculation
            const result = await bayesianEngine.calculateLR(bayesianProfile1, bayesianProfile2, populationId);

            // Log the operation
            logger.info('Bayesian profile comparison performed', {
                userId,
                profile1Id,
                profile2Id,
                populationId,
                overallLR: result.overallLR
            });

            res.json({
                success: true,
                data: {
                    profiles: {
                        profile1: {
                            id: profile1.id,
                            sampleName: profile1.sampleName,
                            uploadDate: profile1.uploadDate
                        },
                        profile2: {
                            id: profile2.id,
                            sampleName: profile2.sampleName,
                            uploadDate: profile2.uploadDate
                        }
                    },
                    analysis: result,
                    populationUsed: populationId,
                    analysisTimestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in Bayesian profile comparison', {
                error: error.message,
                userId: req.user.id,
                body: req.body
            });

            res.status(500).json({
                error: 'Bayesian comparison failed',
                message: error.message
            });
        }
    }
);

/**
 * Detect contamination in a genetic profile
 * POST /api/bayesian/contamination
 */
router.post('/contamination',
    bayesianRateLimit,
    authenticate,
    adminOrAnalyst,
    validateRequest(contaminationAnalysisSchema),
    async (req, res) => {
        try {
            const { profileId, populationId, options } = req.body;
            const userId = req.user.id;

            // Fetch profile
            const profile = await DNAProfile.findById(profileId);
            if (!profile) {
                return res.status(404).json({
                    error: 'Profile not found',
                    message: `Profile with ID ${profileId} not found`
                });
            }

            // DEBUG: Log profile structure
            console.log('🔍 DEBUG Profile structure:', {
                id: profile.id,
                sampleName: profile.sampleName,
                hasStrData: !!profile.strData,
                strDataType: typeof profile.strData,
                strDataKeys: profile.strData ? Object.keys(profile.strData).length : 0,
                hasStr_data: !!profile.str_data,
                hasLoci: !!profile.loci
            });

            // Convert profile to format expected by Bayesian modules
            const bayesianProfile = {
                ...profile,
                str_data: profile.strData
            };

            // DEBUG: Log bayesian profile structure
            console.log('🔍 DEBUG Bayesian profile structure:', {
                id: bayesianProfile.id,
                hasStr_data: !!bayesianProfile.str_data,
                str_dataType: typeof bayesianProfile.str_data,
                str_dataKeys: bayesianProfile.str_data ? Object.keys(bayesianProfile.str_data).length : 0,
                hasLoci: !!bayesianProfile.loci
            });

            // Check permissions
            if (req.user.role !== 'admin' && profile.userId !== userId) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You can only analyze profiles you own'
                });
            }

            // Perform contamination detection
            const result = await bayesianEngine.detectContamination(bayesianProfile, populationId);

            // Log the operation
            logger.info('Bayesian contamination detection performed', {
                userId,
                profileId,
                populationId,
                isContaminated: result.isContaminated,
                contaminationProbability: result.contaminationProbability
            });

            res.json({
                success: true,
                data: {
                    profile: {
                        id: profile.id,
                        sampleName: profile.sampleName,
                        uploadDate: profile.uploadDate
                    },
                    analysis: result,
                    populationUsed: populationId,
                    analysisTimestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in Bayesian contamination detection', {
                error: error.message,
                userId: req.user.id,
                body: req.body
            });

            res.status(500).json({
                error: 'Contamination detection failed',
                message: error.message
            });
        }
    }
);

/**
 * Search for duplicate profiles using Bayesian analysis
 * POST /api/bayesian/duplicates
 */
router.post('/duplicates',
    intensiveRateLimit,
    authenticate,
    adminOrAnalyst,
    validateRequest(duplicateSearchSchema),
    async (req, res) => {
        try {
            const { targetProfileId, populationId, options = {} } = req.body;
            const userId = req.user.id;

            // Fetch target profile
            const targetProfile = await DNAProfile.findById(targetProfileId);
            if (!targetProfile) {
                return res.status(404).json({
                    error: 'Profile not found',
                    message: `Target profile with ID ${targetProfileId} not found`
                });
            }

            // Convert profile to format expected by Bayesian modules
            const bayesianTargetProfile = {
                ...targetProfile,
                str_data: targetProfile.strData
            };

            // Check permissions
            if (req.user.role !== 'admin' && targetProfile.userId !== userId) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You can only search with profiles you own'
                });
            }

            // Get search space based on permissions and options
            let searchSpace;
            if (req.user.role === 'admin' && options.searchScope === 'all') {
                logger.debug(`Admin user searching in all profiles`);
                searchSpace = await DNAProfile.findAll({ limit: 10000 });
            } else if (req.user.role === 'admin') {
                // Админ по умолчанию ищет во всех профилях, если не указано иное
                logger.debug(`Admin user searching in all profiles (default)`);
                searchSpace = await DNAProfile.findAll({ limit: 10000 });
            } else {
                logger.debug(`Regular user searching in own profiles only`);
                searchSpace = await DNAProfile.findByUserId(userId, { limit: 10000 });
            }

            logger.debug(`Initial search space size: ${searchSpace.length}`);

            // Remove target profile from search space
            searchSpace = searchSpace.filter(profile => profile.id !== targetProfileId);
            
            logger.debug(`Search space size after filtering target profile: ${searchSpace.length}`);

            // Проверяем, что база поиска не пустая
            if (searchSpace.length === 0) {
                return res.status(400).json({
                    error: 'Empty search space',
                    message: 'No profiles available for duplicate search. Database search requires at least one other profile.'
                });
            }

            // Convert search space profiles to format expected by Bayesian modules
            const bayesianSearchSpace = searchSpace.map(profile => ({
                ...profile,
                str_data: profile.strData
            }));

            // Perform duplicate search
            const results = await bayesianEngine.findDuplicates(bayesianTargetProfile, bayesianSearchSpace, populationId);

            // Apply limit
            const limitedResults = results.slice(0, options.limit || 10);

            // Log the operation
            logger.info('Bayesian duplicate search performed', {
                userId,
                targetProfileId,
                populationId,
                searchSpaceSize: searchSpace.length,
                duplicatesFound: results.length,
                threshold: options.threshold || 0.95
            });

            res.json({
                success: true,
                data: {
                    targetProfile: {
                        id: targetProfile.id,
                        sampleName: targetProfile.sampleName,
                        uploadDate: targetProfile.uploadDate
                    },
                    duplicates: limitedResults,
                    searchStatistics: {
                        searchSpaceSize: searchSpace.length,
                        totalMatches: results.length,
                        returnedMatches: limitedResults.length,
                        threshold: options.threshold || 0.95
                    },
                    populationUsed: populationId,
                    analysisTimestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in Bayesian duplicate search', {
                error: error.message,
                userId: req.user.id,
                body: req.body
            });

            res.status(500).json({
                error: 'Duplicate search failed',
                message: error.message
            });
        }
    }
);

/**
 * Get available populations
 * GET /api/bayesian/population
 */
router.get('/population',
    bayesianRateLimit,
    authenticate,
    async (req, res) => {
        try {
            const populations = await populationManager.listAvailablePopulations();

            res.json({
                success: true,
                data: {
                    populations,
                    count: populations.length
                }
            });

        } catch (error) {
            logger.error('Error listing populations', {
                error: error.message,
                userId: req.user.id
            });

            res.status(500).json({
                error: 'Failed to list populations',
                message: error.message
            });
        }
    }
);

/**
 * Get specific population data
 * GET /api/bayesian/population/:populationId
 */
router.get('/population/:populationId',
    bayesianRateLimit,
    authenticate,
    async (req, res) => {
        try {
            const { populationId } = req.params;
            const { format = 'json' } = req.query;

            if (format === 'export') {
                // Export format
                const exportData = await populationManager.exportPopulationData(populationId, 'json');
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="population_${populationId}.json"`);
                res.send(exportData);
                return;
            }

            // Regular format
            const populationData = await populationManager.loadPopulationData(populationId);

            // Convert Map to Object for JSON serialization
            const serializedData = {
                ...populationData,
                locusFrequencies: Object.fromEntries(
                    Array.from(populationData.locusFrequencies.entries()).map(([locus, data]) => [
                        locus,
                        {
                            ...data,
                            frequencies: Object.fromEntries(data.frequencies)
                        }
                    ])
                )
            };

            res.json({
                success: true,
                data: serializedData
            });

        } catch (error) {
            logger.error('Error retrieving population data', {
                error: error.message,
                userId: req.user.id,
                populationId: req.params.populationId
            });

            if (error.message.includes('not found')) {
                res.status(404).json({
                    error: 'Population not found',
                    message: error.message
                });
            } else {
                res.status(500).json({
                    error: 'Failed to retrieve population data',
                    message: error.message
                });
            }
        }
    }
);

/**
 * Create or update population data (admin only)
 * POST /api/bayesian/population
 */
router.post('/population',
    bayesianRateLimit,
    authenticate,
    validateRequest(populationDataSchema),
    async (req, res) => {
        try {
            // Only admin can manage population data
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Only administrators can manage population data'
                });
            }

            const { populationId, name, sampleSize, inbreedingCoefficient, loci } = req.body;

            // Convert loci array to Map structure expected by PopulationManager
            const locusFrequencies = new Map();
            
            for (const locus of loci) {
                const frequencies = new Map(Object.entries(locus.frequencies));
                locusFrequencies.set(locus.locusName, {
                    locusName: locus.locusName,
                    frequencies,
                    sampleSize: locus.sampleSize || sampleSize,
                    populationId
                });
            }

            const populationData = {
                populationId,
                name,
                sampleSize,
                inbreedingCoefficient,
                locusFrequencies
            };

            // Update population data
            await populationManager.updatePopulation(populationId, populationData);

            // Log the operation
            logger.info('Population data updated', {
                userId: req.user.id,
                populationId,
                lociCount: loci.length
            });

            res.json({
                success: true,
                message: 'Population data updated successfully',
                data: {
                    populationId,
                    name,
                    lociCount: loci.length,
                    sampleSize,
                    inbreedingCoefficient
                }
            });

        } catch (error) {
            logger.error('Error updating population data', {
                error: error.message,
                userId: req.user.id,
                body: req.body
            });

            res.status(500).json({
                error: 'Failed to update population data',
                message: error.message
            });
        }
    }
);

/**
 * Delete population data (admin only)
 * DELETE /api/bayesian/population/:populationId
 */
router.delete('/population/:populationId',
    bayesianRateLimit,
    authenticate,
    async (req, res) => {
        try {
            // Only admin can delete population data
            if (req.user.role !== 'admin') {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Only administrators can delete population data'
                });
            }

            const { populationId } = req.params;

            // Check if population exists
            try {
                await populationManager.loadPopulationData(populationId);
            } catch (error) {
                if (error.message.includes('not found')) {
                    return res.status(404).json({
                        error: 'Population not found',
                        message: `Population with ID ${populationId} not found`
                    });
                }
                throw error;
            }

            // Delete population data
            const { query } = require('../config/database');
            await query('DELETE FROM population_data WHERE population_id = $1', [populationId]);

            // Invalidate cache
            populationManager.invalidateCache(populationId);

            // Log the operation
            logger.info('Population data deleted', {
                userId: req.user.id,
                populationId
            });

            res.json({
                success: true,
                message: 'Population data deleted successfully',
                data: {
                    populationId
                }
            });

        } catch (error) {
            logger.error('Error deleting population data', {
                error: error.message,
                userId: req.user.id,
                populationId: req.params.populationId
            });

            res.status(500).json({
                error: 'Failed to delete population data',
                message: error.message
            });
        }
    }
);

/**
 * Perform comprehensive quality analysis on a genetic profile
 * POST /api/bayesian/quality-analysis
 */
router.post('/quality-analysis',
    intensiveRateLimit,
    authenticate,
    adminOrAnalyst,
    validateRequest(Joi.object({
        profileId: Joi.string().uuid().required()
    })),
    async (req, res) => {
        try {
            const { profileId } = req.body;
            const userId = req.user.id;

            // Fetch target profile
            const profile = await DNAProfile.findById(profileId);
            if (!profile) {
                return res.status(404).json({
                    error: 'Profile not found',
                    message: `Profile with ID ${profileId} not found`
                });
            }

            // Check permissions
            if (req.user.role !== 'admin' && profile.userId !== userId) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You can only analyze profiles you own'
                });
            }

            // Convert profile to format expected by QualityAnalyzer
            const sample = {
                id: profile.id,
                userId: profile.userId,
                user_id: profile.userId, // Добавляем для совместимости
                sampleName: profile.sampleName,
                str_data: profile.strData,
                rawData: {
                    str_data: profile.strData
                }
            };

            // Initialize QualityAnalyzer
            const QualityAnalyzer = require('../services/bayesian/QualityAnalyzer');
            const qualityAnalyzer = new QualityAnalyzer();

            // Perform comprehensive quality analysis
            const analysisResult = await qualityAnalyzer.performQualityAnalysis(sample);

            // Log the operation
            logger.info('Quality analysis performed', {
                userId,
                profileId,
                pciValue: analysisResult.pci?.pciValue,
                searchedSamples: analysisResult.duplicates?.searchedSamples,
                departmentId: analysisResult.duplicates?.departmentId
            });

            res.json({
                success: true,
                data: {
                    profile: {
                        id: profile.id,
                        sampleName: profile.sampleName,
                        uploadDate: profile.uploadDate
                    },
                    analysis: analysisResult,
                    analysisTimestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in quality analysis', {
                error: error.message,
                userId: req.user.id,
                body: req.body,
                stack: error.stack
            });

            res.status(500).json({
                error: 'Quality analysis failed',
                message: error.message
            });
        }
    }
);

/**
 * Assess degradation in a genetic profile
 * POST /api/bayesian/degradation
 */
router.post('/degradation',
    bayesianRateLimit,
    authenticate,
    adminOrAnalyst,
    validateRequest(degradationAnalysisSchema),
    async (req, res) => {
        try {
            const { profileId } = req.body;
            const userId = req.user.id;

            // Fetch profile
            const profile = await DNAProfile.findById(profileId);
            if (!profile) {
                return res.status(404).json({
                    error: 'Profile not found',
                    message: `Profile with ID ${profileId} not found`
                });
            }

            // Convert profile to format expected by Bayesian modules
            const bayesianProfile = {
                ...profile,
                str_data: profile.strData
            };

            // Check permissions
            if (req.user.role !== 'admin' && profile.userId !== userId) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You can only analyze profiles you own'
                });
            }

            // Perform degradation assessment
            const result = await bayesianEngine.assessDegradation(bayesianProfile);

            // Log the operation
            logger.info('Bayesian degradation assessment performed', {
                userId,
                profileId,
                degradationIndex: result.degradationIndex,
                qualityScore: result.qualityScore
            });

            res.json({
                success: true,
                data: {
                    profile: {
                        id: profile.id,
                        sampleName: profile.sampleName,
                        uploadDate: profile.uploadDate
                    },
                    analysis: result,
                    analysisTimestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error('Error in Bayesian degradation assessment', {
                error: error.message,
                userId: req.user.id,
                body: req.body
            });

            res.status(500).json({
                error: 'Degradation assessment failed',
                message: error.message
            });
        }
    }
);

module.exports = router;