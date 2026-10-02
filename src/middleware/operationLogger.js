const OperationHistory = require('../models/OperationHistory');
const { logger } = require('../utils/logger');

/**
 * Middleware to log operations automatically
 * @param {string} operationType - Type of operation to log
 * @param {Function} detailsExtractor - Function to extract operation details from req/res
 * @returns {Function} Express middleware function
 */
function logOperation(operationType, detailsExtractor = null) {
    return async (req, res, next) => {
        // Store original res.json to intercept response
        const originalJson = res.json;
        
        res.json = function(data) {
            // Call original json method
            const result = originalJson.call(this, data);
            
            // Log operation asynchronously (don't block response)
            setImmediate(async () => {
                try {
                    if (req.user && req.user.id) {
                        let operationDetails = {};
                        let affectedResources = {};
                        
                        // Extract details if extractor function provided
                        if (detailsExtractor && typeof detailsExtractor === 'function') {
                            const extracted = detailsExtractor(req, res, data);
                            operationDetails = extracted.operationDetails || extracted;
                            affectedResources = extracted.affectedResources || {};
                        }
                        
                        // Add basic request info
                        operationDetails = {
                            ...operationDetails,
                            method: req.method,
                            path: req.path,
                            statusCode: res.statusCode
                        };
                        
                        await OperationHistory.logOperation({
                            userId: req.user.id,
                            departmentId: req.user.departmentId || req.user.department_id,
                            operationType,
                            operationDetails,
                            affectedResources,
                            ipAddress: req.ip || req.connection.remoteAddress,
                            userAgent: req.get('User-Agent'),
                            success: res.statusCode < 400
                        });
                    }
                } catch (error) {
                    logger.error('Failed to log operation', {
                        error: error.message,
                        operationType,
                        userId: req.user?.id
                    });
                }
            });
            
            return result;
        };
        
        next();
    };
}

/**
 * Middleware to log authentication operations
 */
function logAuthOperation(operationType) {
    return logOperation(operationType, (req, res, data) => {
        const details = {
            username: req.body?.username || req.user?.username
        };
        
        if (operationType === OperationHistory.OPERATION_TYPES.LOGIN) {
            details.loginSuccess = res.statusCode === 200;
        }
        
        return details;
    });
}

/**
 * Middleware to log profile operations
 */
function logProfileOperation(operationType) {
    return logOperation(operationType, (req, res, data) => {
        const operationDetails = {};
        const affectedResources = {};
        
        switch (operationType) {
            case OperationHistory.OPERATION_TYPES.PROFILE_UPLOAD:
                operationDetails.filename = req.file?.originalname;
                operationDetails.fileSize = req.file?.size;
                operationDetails.profilesCreated = data?.results?.created || 0;
                operationDetails.duplicatesFound = data?.results?.duplicates || 0;
                operationDetails.errors = data?.results?.errors || 0;
                
                affectedResources.profiles = data?.results?.profileIds || [];
                affectedResources.masterArray = req.user?.departmentId ? `master_array_${req.user.departmentId}` : null;
                break;
                
            case OperationHistory.OPERATION_TYPES.PROFILE_DELETE:
                operationDetails.profileId = req.params?.id;
                operationDetails.cascadeDelete = true;
                
                affectedResources.profiles = [req.params?.id];
                affectedResources.matchResults = data?.deletedMatches || [];
                break;
                
            case OperationHistory.OPERATION_TYPES.PROFILE_UPDATE:
                operationDetails.profileId = req.params?.id;
                operationDetails.updatedFields = Object.keys(req.body || {});
                
                affectedResources.profiles = [req.params?.id];
                break;
        }
        
        return { operationDetails, affectedResources };
    });
}

/**
 * Middleware to log DNA analysis operations
 */
function logAnalysisOperation(operationType) {
    return logOperation(operationType, (req, res, data) => {
        const operationDetails = {};
        const affectedResources = {};
        
        switch (operationType) {
            case OperationHistory.OPERATION_TYPES.DNA_ANALYSIS:
                operationDetails.profileId1 = req.body?.profileId1;
                operationDetails.profileId2 = req.body?.profileId2;
                operationDetails.matchPercentage = data?.overallMatch;
                operationDetails.likelihoodRatio = data?.likelihoodRatio;
                
                affectedResources.profiles = [req.body?.profileId1, req.body?.profileId2].filter(Boolean);
                affectedResources.matchResults = data?.matchResultId ? [data.matchResultId] : [];
                break;
                
            case OperationHistory.OPERATION_TYPES.BULK_SEARCH:
                operationDetails.targetProfileId = req.body?.targetProfileId;
                operationDetails.threshold = req.body?.threshold;
                operationDetails.resultsCount = data?.matches?.length || 0;
                operationDetails.searchScope = req.body?.searchScope || 'department';
                
                affectedResources.profiles = [req.body?.targetProfileId];
                affectedResources.searchDatabase = req.user?.departmentId ? `department_${req.user.departmentId}` : 'unknown';
                affectedResources.matchResults = data?.matches?.map(m => m.id) || [];
                break;
        }
        
        return { operationDetails, affectedResources };
    });
}

/**
 * Middleware to log export operations
 */
function logExportOperation() {
    return logOperation(OperationHistory.OPERATION_TYPES.EXPORT_RESULTS, (req, res, data) => {
        return {
            exportType: req.body?.exportType || 'excel',
            profilesCount: req.body?.profileIds?.length || 0,
            includeDetails: req.body?.includeDetails || false
        };
    });
}

/**
 * Middleware to log user management operations
 */
function logUserManagementOperation() {
    return logOperation(OperationHistory.OPERATION_TYPES.USER_MANAGEMENT, (req, res, data) => {
        const details = {
            action: req.method,
            targetUserId: req.params?.id
        };
        
        if (req.body?.role) {
            details.newRole = req.body.role;
        }
        
        if (req.body?.isActive !== undefined) {
            details.activationChange = req.body.isActive;
        }
        
        return details;
    });
}

/**
 * Manual operation logging function for complex scenarios
 * @param {Object} req - Express request object
 * @param {string} operationType - Type of operation
 * @param {Object} operationDetails - Details about the operation
 * @param {Object} affectedResources - Resources affected by the operation
 * @param {boolean} success - Whether operation was successful
 */
async function manualLogOperation(req, operationType, operationDetails = {}, affectedResources = {}, success = true) {
    try {
        if (req.user && req.user.id) {
            await OperationHistory.logOperation({
                userId: req.user.id,
                departmentId: req.user.departmentId || req.user.department_id,
                operationType,
                operationDetails: {
                    ...operationDetails,
                    method: req.method,
                    path: req.path
                },
                affectedResources,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent'),
                success
            });
        }
    } catch (error) {
        logger.error('Failed to manually log operation', {
            error: error.message,
            operationType,
            userId: req.user?.id
        });
    }
}

module.exports = {
    logOperation,
    logAuthOperation,
    logProfileOperation,
    logAnalysisOperation,
    logExportOperation,
    logUserManagementOperation,
    manualLogOperation
};