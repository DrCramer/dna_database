/**
 * Backward compatibility middleware for DNA Analysis system
 * Handles field name mapping and API compatibility for legacy clients
 */

const { logger } = require('../utils/logger');

/**
 * Middleware to handle backward compatibility for profile data field names
 * Maps old field names to new ones for seamless migration
 */
const mapProfileDataFields = (req, res, next) => {
    try {
        if (req.body) {
            // Map old profile_data field to new str_data field
            if (req.body.profile_data && !req.body.strData && !req.body.str_data) {
                req.body.strData = req.body.profile_data;
                req.body.str_data = req.body.profile_data;
                
                logger.debug('Mapped legacy profile_data field to strData', {
                    endpoint: req.path,
                    method: req.method,
                    userId: req.user?.id
                });
            }

            // Map old sample_name to sampleName if needed
            if (req.body.sample_name && !req.body.sampleName) {
                req.body.sampleName = req.body.sample_name;
            }

            // Map old user_id to userId if needed
            if (req.body.user_id && !req.body.userId) {
                req.body.userId = req.body.user_id;
            }

            // Map old file_source to fileSource if needed
            if (req.body.file_source && !req.body.fileSource) {
                req.body.fileSource = req.body.file_source;
            }

            // Map old upload_date to uploadDate if needed
            if (req.body.upload_date && !req.body.uploadDate) {
                req.body.uploadDate = req.body.upload_date;
            }

            // Map old is_active to isActive if needed
            if (req.body.is_active !== undefined && req.body.isActive === undefined) {
                req.body.isActive = req.body.is_active;
            }

            // Map old master_array_id to masterArrayId if needed
            if (req.body.master_array_id && !req.body.masterArrayId) {
                req.body.masterArrayId = req.body.master_array_id;
            }

            // Map old profile_type to profileType if needed
            if (req.body.profile_type && !req.body.profileType) {
                req.body.profileType = req.body.profile_type;
            }
        }

        // Handle query parameters as well
        if (req.query) {
            // Map old query parameter names
            if (req.query.sample_name && !req.query.sampleName) {
                req.query.sampleName = req.query.sample_name;
            }

            if (req.query.user_id && !req.query.userId) {
                req.query.userId = req.query.user_id;
            }

            if (req.query.profile_type && !req.query.profileType) {
                req.query.profileType = req.query.profile_type;
            }

            if (req.query.master_array_id && !req.query.masterArrayId) {
                req.query.masterArrayId = req.query.master_array_id;
            }
        }

        next();

    } catch (error) {
        logger.error('Error in backward compatibility middleware', {
            error: error.message,
            endpoint: req.path,
            method: req.method,
            userId: req.user?.id
        });

        // Don't fail the request due to compatibility mapping errors
        next();
    }
};

/**
 * Middleware to handle backward compatibility for response data
 * Adds legacy field names to responses for old clients
 */
const addLegacyResponseFields = (req, res, next) => {
    // Store original json method
    const originalJson = res.json;

    // Override json method to add legacy fields
    res.json = function(data) {
        try {
            if (data && typeof data === 'object') {
                // Add legacy fields to profile objects
                if (data.profiles && Array.isArray(data.profiles)) {
                    data.profiles = data.profiles.map(addLegacyFieldsToProfile);
                } else if (data.strData || data.str_data) {
                    // Single profile object
                    data = addLegacyFieldsToProfile(data);
                } else if (data.data && data.data.createdProfiles) {
                    // Bulk creation response
                    data.data.createdProfiles = data.data.createdProfiles.map(addLegacyFieldsToProfile);
                }
            }
        } catch (error) {
            logger.warn('Error adding legacy response fields', {
                error: error.message,
                endpoint: req.path,
                method: req.method
            });
        }

        // Call original json method
        return originalJson.call(this, data);
    };

    next();
};

/**
 * Helper function to add legacy field names to a profile object
 */
function addLegacyFieldsToProfile(profile) {
    if (!profile || typeof profile !== 'object') {
        return profile;
    }

    const enhanced = { ...profile };

    // Add legacy field mappings
    if (enhanced.strData && !enhanced.profile_data) {
        enhanced.profile_data = enhanced.strData;
    }

    if (enhanced.str_data && !enhanced.profile_data) {
        enhanced.profile_data = enhanced.str_data;
    }

    if (enhanced.sampleName && !enhanced.sample_name) {
        enhanced.sample_name = enhanced.sampleName;
    }

    if (enhanced.userId && !enhanced.user_id) {
        enhanced.user_id = enhanced.userId;
    }

    if (enhanced.fileSource && !enhanced.file_source) {
        enhanced.file_source = enhanced.fileSource;
    }

    if (enhanced.uploadDate && !enhanced.upload_date) {
        enhanced.upload_date = enhanced.uploadDate;
    }

    if (enhanced.isActive !== undefined && enhanced.is_active === undefined) {
        enhanced.is_active = enhanced.isActive;
    }

    if (enhanced.masterArrayId && !enhanced.master_array_id) {
        enhanced.master_array_id = enhanced.masterArrayId;
    }

    if (enhanced.profileType && !enhanced.profile_type) {
        enhanced.profile_type = enhanced.profileType;
    }

    return enhanced;
}

/**
 * Middleware to handle legacy role names
 * Maps old role names to new multi-user role names
 */
const mapLegacyRoles = (req, res, next) => {
    try {
        if (req.body && req.body.role) {
            const roleMapping = {
                'admin': 'system_administrator',
                'analyst': 'user_analyst',
                'viewer': 'viewer'
            };

            if (roleMapping[req.body.role]) {
                req.body.role = roleMapping[req.body.role];
                
                logger.debug('Mapped legacy role', {
                    originalRole: req.body.role,
                    newRole: roleMapping[req.body.role],
                    endpoint: req.path,
                    userId: req.user?.id
                });
            }
        }

        next();

    } catch (error) {
        logger.error('Error in legacy role mapping middleware', {
            error: error.message,
            endpoint: req.path,
            method: req.method
        });

        // Don't fail the request
        next();
    }
};

/**
 * Comprehensive backward compatibility middleware
 * Combines all compatibility features
 */
const backwardCompatibility = [
    mapProfileDataFields,
    mapLegacyRoles,
    addLegacyResponseFields
];

module.exports = {
    mapProfileDataFields,
    addLegacyResponseFields,
    mapLegacyRoles,
    backwardCompatibility
};