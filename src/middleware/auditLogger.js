const auditService = require('../services/auditService');
const { logger } = require('../utils/logger');

// Middleware to log data access for sensitive operations
function auditDataAccess(resourceType, accessType, dataClassification = 'sensitive') {
    return async (req, res, next) => {
        try {
            const originalSend = res.send;
            let accessGranted = true;
            let denialReason = null;

            // Override res.send to capture response status
            res.send = function(data) {
                // Check if access was denied based on status code
                if (res.statusCode >= 400) {
                    accessGranted = false;
                    if (typeof data === 'string') {
                        try {
                            const errorData = JSON.parse(data);
                            denialReason = errorData.message || errorData.error;
                        } catch (e) {
                            denialReason = data;
                        }
                    } else if (data && data.message) {
                        denialReason = data.message;
                    }
                }

                // Log the data access
                auditService.logDataAccess({
                    userId: req.user ? req.user.id : null,
                    resourceType,
                    resourceId: req.params.id || req.params.profileId || req.params.userId || null,
                    accessType,
                    accessGranted,
                    denialReason,
                    ipAddress: req.ip || req.connection.remoteAddress,
                    userAgent: req.get('User-Agent'),
                    sessionId: req.token ? req.token.substring(0, 8) : null,
                    dataClassification
                }).catch(error => {
                    logger.error('Failed to log data access:', error);
                });

                // Call original send
                return originalSend.call(this, data);
            };

            next();
        } catch (error) {
            logger.error('Audit middleware error:', error);
            next();
        }
    };
}

// Middleware to log all API operations
function auditApiOperation(req, res, next) {
    try {
        const startTime = Date.now();
        const originalSend = res.send;

        // Override res.send to log after response
        res.send = function(data) {
            const duration = Date.now() - startTime;
            
            // Log operation in operation_history table
            const operationDetails = {
                method: req.method,
                url: req.originalUrl,
                statusCode: res.statusCode,
                duration,
                userAgent: req.get('User-Agent'),
                body: req.method !== 'GET' ? req.body : undefined,
                query: req.query
            };

            // Determine operation type based on route and method
            let operationType = 'API_REQUEST';
            if (req.originalUrl.includes('/profiles')) {
                if (req.method === 'POST') operationType = 'PROFILE_UPLOAD';
                else if (req.method === 'DELETE') operationType = 'PROFILE_DELETE';
                else if (req.method === 'GET') operationType = 'PROFILE_VIEW';
            } else if (req.originalUrl.includes('/analysis')) {
                operationType = 'DNA_ANALYSIS';
            } else if (req.originalUrl.includes('/export')) {
                operationType = 'DATA_EXPORT';
            } else if (req.originalUrl.includes('/auth')) {
                if (req.originalUrl.includes('/login')) operationType = 'LOGIN';
                else if (req.originalUrl.includes('/logout')) operationType = 'LOGOUT';
            }

            // Log to operation_history table (existing functionality)
            if (req.user) {
                const { query } = require('../config/database');
                query(
                    `INSERT INTO operation_history (user_id, operation_type, operation_details, ip_address, user_agent) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        req.user.id,
                        operationType,
                        JSON.stringify(operationDetails),
                        req.ip || req.connection.remoteAddress,
                        req.get('User-Agent')
                    ]
                ).catch(error => {
                    logger.error('Failed to log operation history:', error);
                });
            }

            return originalSend.call(this, data);
        };

        next();
    } catch (error) {
        logger.error('API audit middleware error:', error);
        next();
    }
}

// Middleware to log compliance-sensitive operations
function auditComplianceOperation(eventType, severity = 'info') {
    return async (req, res, next) => {
        try {
            const originalSend = res.send;

            res.send = function(data) {
                // Log compliance event if operation was successful
                if (res.statusCode < 400) {
                    auditService.logComplianceEvent({
                        eventType,
                        severity,
                        description: `${eventType} operation performed by user ${req.user ? req.user.username : 'anonymous'}`,
                        affectedTable: null,
                        affectedRecordId: req.params.id || null,
                        userId: req.user ? req.user.id : null
                    }).catch(error => {
                        logger.error('Failed to log compliance event:', error);
                    });
                }

                return originalSend.call(this, data);
            };

            next();
        } catch (error) {
            logger.error('Compliance audit middleware error:', error);
            next();
        }
    };
}

// Middleware to set user context for database triggers
function setUserContext(req, res, next) {
    try {
        if (req.user) {
            // Set user ID in database session for audit triggers
            const { query } = require('../config/database');
            query(`SELECT set_config('app.current_user_id', $1, true)`, [req.user.id])
                .catch(error => {
                    logger.error('Failed to set user context:', error);
                });
        }
        next();
    } catch (error) {
        logger.error('User context middleware error:', error);
        next();
    }
}

module.exports = {
    auditDataAccess,
    auditApiOperation,
    auditComplianceOperation,
    setUserContext
};