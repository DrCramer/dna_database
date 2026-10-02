const { logger } = require('../utils/logger');
const User = require('../models/User');

/**
 * Middleware to check if user can access another user's history
 * Only admins can access other users' history
 */
function checkHistoryAccess(req, res, next) {
    try {
        const requestingUserId = req.user.id;
        const targetUserId = req.params.userId;
        
        // If accessing own history, allow
        if (requestingUserId === targetUserId) {
            return next();
        }
        
        // Only admins can access other users' history
        if (req.user.role !== 'admin') {
            logger.warn('Unauthorized history access attempt', {
                requestingUserId,
                targetUserId,
                userRole: req.user.role
            });
            
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You can only access your own operation history'
            });
        }
        
        next();
    } catch (error) {
        logger.error('Error checking history access permissions', {
            error: error.message,
            requestingUserId: req.user?.id,
            targetUserId: req.params?.userId
        });
        
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to verify permissions'
        });
    }
}

/**
 * Middleware to validate target user exists (for admin operations)
 */
async function validateTargetUser(req, res, next) {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'User ID is required'
            });
        }
        
        // Check if target user exists
        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({
                error: 'User not found',
                message: 'The specified user does not exist'
            });
        }
        
        // Attach target user to request for use in route handlers
        req.targetUser = targetUser;
        next();
    } catch (error) {
        logger.error('Error validating target user', {
            error: error.message,
            targetUserId: req.params?.userId,
            requestingUserId: req.user?.id
        });
        
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to validate user'
        });
    }
}

/**
 * Middleware to log admin access to user histories
 */
function logAdminHistoryAccess(req, res, next) {
    // Store original res.json to intercept response
    const originalJson = res.json;
    
    res.json = function(data) {
        // Call original json method
        const result = originalJson.call(this, data);
        
        // Log admin access asynchronously
        if (req.user.role === 'admin' && req.params.userId && req.params.userId !== req.user.id) {
            setImmediate(async () => {
                try {
                    const OperationHistory = require('../models/OperationHistory');
                    await OperationHistory.logOperation({
                        userId: req.user.id,
                        operationType: 'admin_history_access',
                        operationDetails: {
                            targetUserId: req.params.userId,
                            targetUsername: req.targetUser?.username,
                            endpoint: req.path,
                            method: req.method
                        },
                        ipAddress: req.ip || req.connection.remoteAddress,
                        userAgent: req.get('User-Agent'),
                        success: res.statusCode < 400
                    });
                } catch (error) {
                    logger.error('Failed to log admin history access', {
                        error: error.message,
                        adminUserId: req.user.id,
                        targetUserId: req.params.userId
                    });
                }
            });
        }
        
        return result;
    };
    
    next();
}

/**
 * Middleware to filter sensitive information based on user role
 */
function filterSensitiveData(req, res, next) {
    // Store original res.json to intercept and filter response
    const originalJson = res.json;
    
    res.json = function(data) {
        // If not admin and accessing other user's data, filter sensitive info
        if (req.user.role !== 'admin' && req.params.userId && req.params.userId !== req.user.id) {
            // This should not happen due to earlier permission checks, but as a safety net
            return originalJson.call(this, {
                error: 'Forbidden',
                message: 'Access denied'
            });
        }
        
        // For viewers, filter out some sensitive operation details
        if (req.user.role === 'viewer' && data.operations) {
            data.operations = data.operations.map(op => {
                const filtered = { ...op };
                // Remove sensitive details for viewers
                if (filtered.operationDetails) {
                    delete filtered.operationDetails.ipAddress;
                    delete filtered.operationDetails.userAgent;
                }
                return filtered;
            });
        }
        
        return originalJson.call(this, data);
    };
    
    next();
}

/**
 * Check if user has permission to view operation statistics
 */
function checkStatsPermission(req, res, next) {
    try {
        const requestingUserId = req.user.id;
        const targetUserId = req.params.userId;
        
        // Users can view their own stats
        if (requestingUserId === targetUserId) {
            return next();
        }
        
        // Only admins and analysts can view other users' stats
        if (!['admin', 'analyst'].includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Insufficient permissions to view operation statistics'
            });
        }
        
        next();
    } catch (error) {
        logger.error('Error checking stats permission', {
            error: error.message,
            requestingUserId: req.user?.id,
            targetUserId: req.params?.userId
        });
        
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to verify permissions'
        });
    }
}

module.exports = {
    checkHistoryAccess,
    validateTargetUser,
    logAdminHistoryAccess,
    filterSensitiveData,
    checkStatsPermission
};