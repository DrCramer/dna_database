const { randomUUID } = require('node:crypto');

function requestContext(req, res, next) {
    req.requestId ||= randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
}

module.exports = { requestContext };
