const express = require('express');
const router = express.Router();
const MasterArrayService = require('../services/masterArrayService');
const PermissionService = require('../services/permissionService');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

// Get master array by department ID
router.get('/department/:departmentId', 
    authenticate,
    PermissionService.requireDepartmentAccess(),
    async (req, res) => {
        try {
            const { departmentId } = req.params;
            const userId = req.user.id;

            const masterArray = await MasterArrayService.getMasterArrayByDepartment(departmentId, userId);
            
            if (!masterArray) {
                return res.status(404).json({
                    success: false,
                    error: 'Master array not found for this department'
                });
            }

            res.json({
                success: true,
                data: masterArray
            });
        } catch (error) {
            logger.error('Error getting master array by department:', error);
            res.status(error.message.includes('Access denied') ? 403 : 500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Get master array profiles
router.get('/:masterArrayId/profiles',
    authenticate,
    async (req, res) => {
        try {
            const { masterArrayId } = req.params;
            const { limit = 100, offset = 0, includeInactive = false } = req.query;
            const userId = req.user.id;

            const options = {
                limit: parseInt(limit),
                offset: parseInt(offset),
                includeInactive: includeInactive === 'true'
            };

            const profiles = await MasterArrayService.getMasterArrayProfiles(masterArrayId, options, userId);

            res.json({
                success: true,
                data: profiles,
                pagination: {
                    limit: options.limit,
                    offset: options.offset,
                    total: profiles.length
                }
            });
        } catch (error) {
            logger.error('Error getting master array profiles:', error);
            res.status(error.message.includes('Access denied') ? 403 : 500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Add profile to master array
router.post('/:masterArrayId/profiles',
    authenticate,
    PermissionService.requirePermission('create', 'master_array'),
    async (req, res) => {
        try {
            const { masterArrayId } = req.params;
            const profileData = req.body;
            const userId = req.user.id;

            // Validate required fields
            if (!profileData.sample_name || !profileData.str_data) {
                return res.status(400).json({
                    success: false,
                    error: 'Sample name and STR data are required'
                });
            }

            const profile = await MasterArrayService.addProfileToMasterArray(
                masterArrayId,
                profileData,
                userId
            );

            res.status(201).json({
                success: true,
                data: profile,
                message: 'Profile added to master array successfully'
            });
        } catch (error) {
            logger.error('Error adding profile to master array:', error);
            res.status(error.message.includes('Access denied') ? 403 : 500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Remove profile from master array
router.delete('/:masterArrayId/profiles/:profileId',
    authenticate,
    PermissionService.requirePermission('delete', 'master_array'),
    async (req, res) => {
        try {
            const { masterArrayId, profileId } = req.params;
            const userId = req.user.id;

            const removed = await MasterArrayService.removeProfileFromMasterArray(
                masterArrayId,
                profileId,
                userId
            );

            if (!removed) {
                return res.status(404).json({
                    success: false,
                    error: 'Profile not found in master array'
                });
            }

            res.json({
                success: true,
                message: 'Profile removed from master array successfully'
            });
        } catch (error) {
            logger.error('Error removing profile from master array:', error);
            res.status(error.message.includes('Access denied') ? 403 : 500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Search profiles in master array
router.post('/:masterArrayId/search',
    authenticate,
    async (req, res) => {
        try {
            const { masterArrayId } = req.params;
            const searchCriteria = req.body;
            const userId = req.user.id;

            // Validate search criteria
            if (!searchCriteria.str_data) {
                return res.status(400).json({
                    success: false,
                    error: 'STR data is required for search'
                });
            }

            const matches = await MasterArrayService.searchInMasterArray(
                masterArrayId,
                searchCriteria,
                userId
            );

            res.json({
                success: true,
                data: matches,
                summary: {
                    totalMatches: matches.length,
                    searchCriteria: {
                        minMatches: searchCriteria.min_matches || 15,
                        ignoredLoci: searchCriteria.ignore_loci?.length || 0
                    }
                }
            });
        } catch (error) {
            logger.error('Error searching master array:', error);
            res.status(error.message.includes('Access denied') ? 403 : 500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Bulk import profiles to master array
router.post('/:masterArrayId/bulk-import',
    authenticate,
    PermissionService.requirePermission('create', 'master_array'),
    async (req, res) => {
        try {
            const { masterArrayId } = req.params;
            const { profiles } = req.body;
            const userId = req.user.id;

            if (!Array.isArray(profiles) || profiles.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Profiles array is required and must not be empty'
                });
            }

            const results = await MasterArrayService.bulkImportProfiles(
                masterArrayId,
                profiles,
                userId
            );

            res.json({
                success: true,
                data: results,
                message: `Bulk import completed: ${results.imported.length} imported, ${results.duplicates.length} duplicates, ${results.errors.length} errors`
            });
        } catch (error) {
            logger.error('Error in bulk import to master array:', error);
            res.status(error.message.includes('Access denied') ? 403 : 500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Get master array statistics
router.get('/:masterArrayId/statistics',
    authenticate,
    async (req, res) => {
        try {
            const { masterArrayId } = req.params;
            const userId = req.user.id;

            const statistics = await MasterArrayService.getMasterArrayStatistics(masterArrayId, userId);

            res.json({
                success: true,
                data: statistics
            });
        } catch (error) {
            logger.error('Error getting master array statistics:', error);
            res.status(error.message.includes('Access denied') ? 403 : 500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Compare user profiles with department master array
router.post('/compare-with-department',
    authenticate,
    async (req, res) => {
        try {
            const { departmentId, userProfiles, searchOptions = {} } = req.body;
            const userId = req.user.id;

            if (!departmentId || !Array.isArray(userProfiles)) {
                return res.status(400).json({
                    success: false,
                    error: 'Department ID and user profiles array are required'
                });
            }

            const results = await MasterArrayService.compareWithDepartmentMasterArray(
                departmentId,
                userProfiles,
                searchOptions,
                userId
            );

            res.json({
                success: true,
                data: results
            });
        } catch (error) {
            logger.error('Error comparing with department master array:', error);
            res.status(error.message.includes('Access denied') ? 403 : 500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Get user's accessible master arrays
router.get('/accessible',
    authenticate,
    async (req, res) => {
        try {
            const userId = req.user.id;

            const masterArrays = await MasterArrayService.getUserAccessibleMasterArrays(userId);

            res.json({
                success: true,
                data: masterArrays
            });
        } catch (error) {
            logger.error('Error getting user accessible master arrays:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// Validate master array access
router.get('/:masterArrayId/access-validation',
    authenticate,
    async (req, res) => {
        try {
            const { masterArrayId } = req.params;
            const userId = req.user.id;

            const accessValidation = await MasterArrayService.validateMasterArrayAccess(masterArrayId, userId);

            res.json({
                success: true,
                data: accessValidation
            });
        } catch (error) {
            logger.error('Error validating master array access:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

module.exports = router;