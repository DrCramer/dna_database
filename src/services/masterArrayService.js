const MasterArray = require('../models/MasterArray');
const Department = require('../models/Department');
const DNAProfile = require('../models/DNAProfile');
const { query, transaction } = require('../config/database');
const { logger } = require('../utils/logger');

class MasterArrayService {
    /**
     * Create a new master array for a department
     * @param {Object} masterArrayData - Master array data
     * @param {string} masterArrayData.department_id - Department ID
     * @param {string} masterArrayData.name - Master array name
     * @param {string} masterArrayData.description - Master array description
     * @param {string} userId - User ID creating the master array
     * @returns {Promise<MasterArray>} Created master array
     */
    static async createMasterArray(masterArrayData, userId) {
        // Validate user permissions
        await this.validateUserPermissions(userId, masterArrayData.department_id, 'create');

        try {
            const masterArray = await MasterArray.create(masterArrayData);
            
            logger.info('Master array created via service', {
                masterArrayId: masterArray.id,
                departmentId: masterArrayData.department_id,
                createdBy: userId
            });

            return masterArray;
        } catch (error) {
            logger.error('Error creating master array via service', {
                error: error.message,
                masterArrayData,
                userId
            });
            throw error;
        }
    }

    /**
     * Get master array by department ID with access validation
     * @param {string} departmentId - Department ID
     * @param {string} userId - User ID requesting access
     * @returns {Promise<MasterArray|null>} Master array or null if not found/no access
     */
    static async getMasterArrayByDepartment(departmentId, userId) {
        // Validate user access to department
        const hasAccess = await this.validateUserAccess(userId, departmentId);
        if (!hasAccess) {
            throw new Error('Access denied: User does not have permission to access this department\'s master array');
        }

        try {
            const masterArray = await MasterArray.findByDepartment(departmentId);
            
            if (masterArray) {
                logger.info('Master array retrieved by department', {
                    masterArrayId: masterArray.id,
                    departmentId,
                    userId
                });
            }

            return masterArray;
        } catch (error) {
            logger.error('Error getting master array by department', {
                error: error.message,
                departmentId,
                userId
            });
            throw error;
        }
    }

    /**
     * Add profile to master array with validation
     * @param {string} masterArrayId - Master array ID
     * @param {Object} profileData - Profile data
     * @param {string} profileData.sample_name - Sample name
     * @param {Object} profileData.str_data - STR loci data
     * @param {Object} profileData.metadata - Additional metadata
     * @param {string} userId - User ID adding the profile
     * @returns {Promise<Object>} Created profile
     */
    static async addProfileToMasterArray(masterArrayId, profileData, userId) {
        const masterArray = await MasterArray.findById(masterArrayId);
        if (!masterArray) {
            throw new Error('Master array not found');
        }

        // Validate user permissions
        await this.validateUserPermissions(userId, masterArray.department_id, 'write');

        try {
            const profile = await masterArray.addProfile({
                ...profileData,
                created_by: userId
            });

            logger.info('Profile added to master array via service', {
                masterArrayId,
                profileId: profile.id,
                sampleName: profile.sample_name,
                userId
            });

            return profile;
        } catch (error) {
            logger.error('Error adding profile to master array via service', {
                error: error.message,
                masterArrayId,
                profileData,
                userId
            });
            throw error;
        }
    }

    /**
     * Remove profile from master array with validation
     * @param {string} masterArrayId - Master array ID
     * @param {string} profileId - Profile ID to remove
     * @param {string} userId - User ID removing the profile
     * @returns {Promise<boolean>} True if removed, false if not found
     */
    static async removeProfileFromMasterArray(masterArrayId, profileId, userId) {
        const masterArray = await MasterArray.findById(masterArrayId);
        if (!masterArray) {
            throw new Error('Master array not found');
        }

        // Validate user permissions
        await this.validateUserPermissions(userId, masterArray.department_id, 'write');

        try {
            const removed = await masterArray.removeProfile(profileId);

            if (removed) {
                logger.info('Profile removed from master array via service', {
                    masterArrayId,
                    profileId,
                    userId
                });
            }

            return removed;
        } catch (error) {
            logger.error('Error removing profile from master array via service', {
                error: error.message,
                masterArrayId,
                profileId,
                userId
            });
            throw error;
        }
    }

    /**
     * Search profiles in master array with access validation
     * @param {string} masterArrayId - Master array ID
     * @param {Object} searchCriteria - Search criteria
     * @param {Object} searchCriteria.str_data - STR data to match against
     * @param {number} searchCriteria.min_matches - Minimum number of loci matches
     * @param {Array} searchCriteria.ignore_loci - Loci to ignore in comparison
     * @param {string} userId - User ID performing the search
     * @returns {Promise<Array>} Array of matching profiles
     */
    static async searchInMasterArray(masterArrayId, searchCriteria, userId) {
        const masterArray = await MasterArray.findById(masterArrayId);
        if (!masterArray) {
            throw new Error('Master array not found');
        }

        // Validate user access
        const hasAccess = await this.validateUserAccess(userId, masterArray.department_id);
        if (!hasAccess) {
            throw new Error('Access denied: User does not have permission to search this master array');
        }

        try {
            const matches = await masterArray.searchProfiles(searchCriteria);

            logger.info('Master array search performed via service', {
                masterArrayId,
                userId,
                matches: matches.length,
                searchCriteria: {
                    min_matches: searchCriteria.min_matches,
                    ignore_loci: searchCriteria.ignore_loci?.length || 0
                }
            });

            return matches;
        } catch (error) {
            logger.error('Error searching master array via service', {
                error: error.message,
                masterArrayId,
                searchCriteria,
                userId
            });
            throw error;
        }
    }

    /**
     * Get profiles from master array with access validation
     * @param {string} masterArrayId - Master array ID
     * @param {Object} options - Query options
     * @param {string} userId - User ID requesting profiles
     * @returns {Promise<Array>} Array of profiles
     */
    static async getMasterArrayProfiles(masterArrayId, options, userId) {
        const masterArray = await MasterArray.findById(masterArrayId);
        if (!masterArray) {
            throw new Error('Master array not found');
        }

        // Validate user access
        const hasAccess = await this.validateUserAccess(userId, masterArray.department_id);
        if (!hasAccess) {
            throw new Error('Access denied: User does not have permission to access this master array');
        }

        try {
            const profiles = await masterArray.getProfiles(options);

            logger.info('Master array profiles retrieved via service', {
                masterArrayId,
                userId,
                profileCount: profiles.length
            });

            return profiles;
        } catch (error) {
            logger.error('Error getting master array profiles via service', {
                error: error.message,
                masterArrayId,
                options,
                userId
            });
            throw error;
        }
    }

    /**
     * Compare user upload against department master array
     * @param {string} departmentId - Department ID
     * @param {Array} userProfiles - Array of user profile data
     * @param {Object} searchOptions - Search options
     * @param {number} searchOptions.min_matches - Minimum matches threshold
     * @param {Array} searchOptions.ignore_loci - Loci to ignore
     * @param {string} userId - User ID performing the comparison
     * @returns {Promise<Object>} Comparison results
     */
    static async compareWithDepartmentMasterArray(departmentId, userProfiles, searchOptions, userId) {
        // Validate user access to department
        const hasAccess = await this.validateUserAccess(userId, departmentId);
        if (!hasAccess) {
            throw new Error('Access denied: User does not have permission to access this department');
        }

        try {
            const masterArray = await MasterArray.findByDepartment(departmentId);
            if (!masterArray) {
                return {
                    masterArrayExists: false,
                    comparisons: [],
                    summary: {
                        totalUserProfiles: userProfiles.length,
                        profilesWithMatches: 0,
                        totalMatches: 0
                    }
                };
            }

            const comparisons = [];
            let profilesWithMatches = 0;
            let totalMatches = 0;

            for (const userProfile of userProfiles) {
                const matches = await masterArray.searchProfiles({
                    str_data: userProfile.str_data,
                    min_matches: searchOptions.min_matches || 15,
                    ignore_loci: searchOptions.ignore_loci || []
                });

                if (matches.length > 0) {
                    profilesWithMatches++;
                    totalMatches += matches.length;
                }

                comparisons.push({
                    userProfile: {
                        sample_name: userProfile.sample_name,
                        id: userProfile.id
                    },
                    matches: matches.map(match => ({
                        master_profile_id: match.id,
                        master_sample_name: match.sample_name,
                        match_score: match.match_score,
                        match_percentage: match.match_percentage,
                        total_compared: match.total_compared
                    }))
                });
            }

            const result = {
                masterArrayExists: true,
                masterArrayId: masterArray.id,
                comparisons,
                summary: {
                    totalUserProfiles: userProfiles.length,
                    profilesWithMatches,
                    totalMatches,
                    searchOptions
                }
            };

            logger.info('User profiles compared with department master array', {
                departmentId,
                masterArrayId: masterArray.id,
                userId,
                summary: result.summary
            });

            return result;
        } catch (error) {
            logger.error('Error comparing with department master array', {
                error: error.message,
                departmentId,
                userId,
                userProfilesCount: userProfiles.length
            });
            throw error;
        }
    }

    /**
     * Bulk import profiles to master array
     * @param {string} masterArrayId - Master array ID
     * @param {Array} profilesData - Array of profile data
     * @param {string} userId - User ID performing the import
     * @returns {Promise<Object>} Import results
     */
    static async bulkImportProfiles(masterArrayId, profilesData, userId) {
        const masterArray = await MasterArray.findById(masterArrayId);
        if (!masterArray) {
            throw new Error('Master array not found');
        }

        // Validate user permissions
        await this.validateUserPermissions(userId, masterArray.department_id, 'write');

        const results = {
            imported: [],
            duplicates: [],
            errors: []
        };

        try {
            await transaction(async (client) => {
                for (let i = 0; i < profilesData.length; i++) {
                    const profileData = profilesData[i];
                    
                    try {
                        // УДАЛЕНО: Проверка по sample_name убрана, так как sample_name может повторяться
                        // при разных internal_number (это нормально и не является дубликатом)
                        // Дубликаты проверяются по year + internal_number в addProfilesBatch

                        // Add profile to master array
                        const profile = await masterArray.addProfile({
                            ...profileData,
                            created_by: userId
                        });

                        results.imported.push({
                            profile_id: profile.id,
                            sample_name: profile.sample_name
                        });

                    } catch (error) {
                        results.errors.push({
                            sample_name: profileData.sample_name,
                            error: error.message
                        });
                    }
                }
            });

            logger.info('Bulk import to master array completed', {
                masterArrayId,
                userId,
                imported: results.imported.length,
                duplicates: results.duplicates.length,
                errors: results.errors.length
            });

            return results;
        } catch (error) {
            logger.error('Error in bulk import to master array', {
                error: error.message,
                masterArrayId,
                userId,
                profilesCount: profilesData.length
            });
            throw error;
        }
    }

    /**
     * Get master array statistics with access validation
     * @param {string} masterArrayId - Master array ID
     * @param {string} userId - User ID requesting statistics
     * @returns {Promise<Object>} Master array statistics
     */
    static async getMasterArrayStatistics(masterArrayId, userId) {
        const masterArray = await MasterArray.findById(masterArrayId);
        if (!masterArray) {
            throw new Error('Master array not found');
        }

        // Validate user access
        const hasAccess = await this.validateUserAccess(userId, masterArray.department_id);
        if (!hasAccess) {
            throw new Error('Access denied: User does not have permission to access this master array');
        }

        try {
            const statistics = await masterArray.getStatistics();

            logger.info('Master array statistics retrieved', {
                masterArrayId,
                userId,
                totalProfiles: statistics.totalProfiles
            });

            return statistics;
        } catch (error) {
            logger.error('Error getting master array statistics', {
                error: error.message,
                masterArrayId,
                userId
            });
            throw error;
        }
    }

    /**
     * Validate user permissions for master array operations
     * @param {string} userId - User ID
     * @param {string} departmentId - Department ID
     * @param {string} operation - Operation type ('read', 'write', 'create')
     * @returns {Promise<void>} Throws error if no permission
     */
    static async validateUserPermissions(userId, departmentId, operation = 'read') {
        if (!userId) {
            throw new Error('User ID is required');
        }

        if (!departmentId) {
            throw new Error('Department ID is required');
        }

        try {
            const result = await query(`
                SELECT u.id, u.role, u.department_id, u.organization_id
                FROM users u
                WHERE u.id = $1 AND u.is_active = true
            `, [userId]);

            if (result.rows.length === 0) {
                throw new Error('User not found or inactive');
            }

            const user = result.rows[0];

            // System administrators have full access
            if (user.role === 'system_administrator') {
                return;
            }

            // Department heads have full access to their department
            if (user.role === 'department_head' && user.department_id === departmentId) {
                return;
            }

            // For write/create operations, only department heads and system admins are allowed
            if (operation === 'write' || operation === 'create') {
                throw new Error('Access denied: Only department heads and system administrators can modify master arrays');
            }

            // For read operations, users can access their own department
            if (user.department_id === departmentId) {
                return;
            }

            throw new Error('Access denied: User does not have permission for this operation');
        } catch (error) {
            logger.error('Error validating user permissions for master array', {
                error: error.message,
                userId,
                departmentId,
                operation
            });
            throw error;
        }
    }

    /**
     * Validate user access to department
     * @param {string} userId - User ID
     * @param {string} departmentId - Department ID
     * @returns {Promise<boolean>} True if user has access
     */
    static async validateUserAccess(userId, departmentId) {
        if (!userId || !departmentId) {
            return false;
        }

        try {
            const result = await query(`
                SELECT u.id, u.role, u.department_id
                FROM users u
                WHERE u.id = $1 AND u.is_active = true
            `, [userId]);

            if (result.rows.length === 0) {
                return false;
            }

            const user = result.rows[0];

            // System administrators can access any department
            if (user.role === 'system_administrator') {
                return true;
            }

            // Users can access their own department
            return user.department_id === departmentId;
        } catch (error) {
            logger.error('Error validating user access to department', {
                error: error.message,
                userId,
                departmentId
            });
            return false;
        }
    }

    /**
     * Get user's accessible master arrays
     * @param {string} userId - User ID
     * @returns {Promise<Array>} Array of accessible master arrays
     */
    static async getUserAccessibleMasterArrays(userId) {
        if (!userId) {
            throw new Error('User ID is required');
        }

        try {
            const result = await query(`
                SELECT 
                    ma.id,
                    ma.name,
                    ma.description,
                    ma.created_at,
                    d.id as department_id,
                    d.name as department_name,
                    o.id as organization_id,
                    o.name as organization_name,
                    (SELECT COUNT(*) FROM master_array_profiles WHERE master_array_id = ma.id AND is_active = true) as profile_count
                FROM master_arrays ma
                JOIN departments d ON ma.department_id = d.id
                JOIN organizations o ON d.organization_id = o.id
                JOIN users u ON (u.department_id = d.id OR u.role = 'system_administrator')
                WHERE u.id = $1 AND u.is_active = true AND ma.is_active = true AND d.is_active = true AND o.is_active = true
                ORDER BY ma.created_at DESC
            `, [userId]);

            logger.info('User accessible master arrays retrieved', {
                userId,
                masterArrayCount: result.rows.length
            });

            return result.rows;
        } catch (error) {
            logger.error('Error getting user accessible master arrays', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Validate master array access control
     * @param {string} masterArrayId - Master array ID
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Access validation result
     */
    static async validateMasterArrayAccess(masterArrayId, userId) {
        if (!masterArrayId || !userId) {
            return {
                hasAccess: false,
                reason: 'Missing master array ID or user ID'
            };
        }

        try {
            const masterArray = await MasterArray.findById(masterArrayId);
            if (!masterArray) {
                return {
                    hasAccess: false,
                    reason: 'Master array not found'
                };
            }

            const hasAccess = await masterArray.validateUserAccess(userId);
            
            if (!hasAccess) {
                return {
                    hasAccess: false,
                    reason: 'User does not have access to this master array'
                };
            }

            // Get user role for permission details
            const userResult = await query(
                'SELECT role, department_id FROM users WHERE id = $1 AND is_active = true',
                [userId]
            );

            const user = userResult.rows[0];
            const canWrite = user.role === 'system_administrator' || 
                           (user.role === 'department_head' && user.department_id === masterArray.department_id);

            return {
                hasAccess: true,
                canRead: true,
                canWrite,
                userRole: user.role,
                departmentId: masterArray.department_id
            };
        } catch (error) {
            logger.error('Error validating master array access', {
                error: error.message,
                masterArrayId,
                userId
            });
            return {
                hasAccess: false,
                reason: 'Error validating access'
            };
        }
    }
}

module.exports = MasterArrayService;