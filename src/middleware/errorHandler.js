const { logger } = require('../utils/logger');
const { getErrorStatus, normalizeApiErrorResponse, serializeApiError } = require('../utils/apiErrors');

function apiErrorResponses(req, res, next) {
    const originalJson = res.json;
    const originalSend = res.send;
    let serializing = false;
    res.json = function(body) {
        const failed = this.statusCode >= 400;
        const payload = failed ? normalizeApiErrorResponse(this.statusCode, body, {
            requestId: req.requestId, production: process.env.NODE_ENV === 'production'
        }) : body;
        if (failed) this.type('application/json');
        serializing = true;
        try { return originalJson.call(this, payload); }
        finally { serializing = false; }
    };
    // Rate-limit и sendStatus могут посылать строку вместо JSON.
    res.send = function(body) {
        if (!serializing && this.statusCode >= 400) return this.json(body);
        return originalSend.call(this, body);
    };
    next();
}

function errorHandler(err, req, res, next) {
    logger.error('Unhandled error:', { message: err.message, stack: err.stack,
        url: req.originalUrl || req.url, method: req.method, ip: req.ip, requestId: req.requestId });
    if (res.headersSent) return next(err);
    const status = getErrorStatus(err);
    res.status(status).json(serializeApiError(err, {
        requestId: req.requestId, production: process.env.NODE_ENV === 'production'
    }));
}

module.exports = { errorHandler, apiErrorResponses };
