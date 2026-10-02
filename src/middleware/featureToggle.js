const config = require('../config/environment');

const conditionalRoute = (app, condition, path, router) => {
    if (typeof condition === 'function' ? condition() : condition) {
        app.use(path, router);
    }
};

const getFeatureStatus = (req, res) => {
    res.json({
        bayesianAnalysis: config.isBayesianAnalysisEnabled(),
        multiUser: true,
        encryption: true,
        audit: true
    });
};

module.exports = {
    conditionalRoute,
    getFeatureStatus
};