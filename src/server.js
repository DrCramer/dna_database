const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Load configuration first
const config = require('./config/environment');
const { connectDatabase } = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const { logger } = require('./utils/logger');
const { securityConfig, sessionManager } = require('./config/security');
const { auditApiOperation, setUserContext } = require('./middleware/auditLogger');
const { conditionalRoute, getFeatureStatus } = require('./middleware/featureToggle');
const scheduledJobService = require('./services/scheduledJobService');
const healthCheckService = require('./services/healthCheckService');
const databaseInitService = require('./services/databaseInitService');
const concurrencyService = require('./services/concurrencyService');
const dataPersistenceService = require('./services/dataPersistenceService');
const websocketService = require('./services/websocketService');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const profileRoutes = require('./routes/profiles');
const analysisRoutes = require('./routes/analysis');
const exportRoutes = require('./routes/export');
const historyRoutes = require('./routes/history');
const settingsRoutes = require('./routes/settings');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');
const auditRoutes = require('./routes/audit');
const complianceRoutes = require('./routes/compliance');
const bayesianRoutes = require('./routes/bayesian');
const organizationRoutes = require('./routes/organizations');
const taskRoutes = require('./routes/tasks');
const masterArrayRoutes = require('./routes/masterArrays');
const databaseEncryptionRoutes = require('./routes/databaseEncryption');
const staffProfileRoutes = require('./routes/staffProfiles');
const genotypeAnalysisRoutes = require('./routes/genotypeAnalysisRoutes');
const staffContaminationRoutes = require('./routes/staffContaminationRoutes');
const contaminationStatsRoutes = require('./routes/contaminationStatsRoutes');
const analyticsRoutes = require('./routes/analytics');

const app = express();
app.use(require('./middleware/requestContext').requestContext);
const PORT = config.get('app.port');

// Сделать app доступным глобально для SSE уведомлений
global.app = app;

// Log startup configuration (safe version without secrets)
logger.info('Starting DNA Analysis Web Application');
logger.info('Configuration loaded:', config.getSafeConfig());

// Security middleware (HTTP only for internal network)
app.use(helmet({
    contentSecurityPolicy: config.isProduction() ? {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-eval'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: null, // Explicitly disable for HTTP-only
        },
    } : false, // Отключаем CSP в development
    hsts: false, // Disabled for HTTP-only internal network
    crossOriginOpenerPolicy: false, // Disabled for HTTP-only
    crossOriginResourcePolicy: false, // Disabled for HTTP-only
    originAgentCluster: false, // Disabled for HTTP-only
}));

app.use(cors(config.getCorsConfig()));

// Force HTTPS in production
// HTTPS redirect disabled for internal network deployment
// All traffic uses HTTP only

// Rate limiting with configuration (DISABLED for development)
const rateLimitConfig = config.getRateLimitConfig();
const limiter = rateLimit({
    windowMs: rateLimitConfig.windowMs,
    max: 999999, // Effectively unlimited for development
    message: 'Слишком много запросов с этого IP, попробуйте позже.',
    skipSuccessfulRequests: rateLimitConfig.skipSuccessfulRequests,
    skipFailedRequests: rateLimitConfig.skipFailedRequests
});
// app.use(limiter); // DISABLED for development

// Body parsing middleware with configuration
const uploadConfig = config.getUploadConfig();
app.use(compression());
app.use(express.json({ limit: uploadConfig.maxFileSize }));
app.use(express.urlencoded({ extended: true, limit: uploadConfig.maxFileSize }));

// Logging middleware
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Audit middleware for API operations (temporarily disabled)
// app.use(auditApiOperation);
app.use(setUserContext);

// Health check endpoints
app.get('/health', async (req, res) => {
    try {
        const healthStatus = await healthCheckService.runAllChecks();
        const statusCode = healthStatus.status === 'healthy' ? 200 : 
                          healthStatus.status === 'degraded' ? 200 : 503;
        
        res.status(statusCode).json(healthStatus);
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: 'Health check service unavailable'
        });
    }
});

// Readiness probe for Kubernetes/Docker
app.get('/health/ready', async (req, res) => {
    try {
        const readinessStatus = await healthCheckService.getReadinessCheck();
        const statusCode = readinessStatus.status === 'ready' ? 200 : 503;
        
        res.status(statusCode).json(readinessStatus);
    } catch (error) {
        logger.error('Readiness check failed:', error);
        res.status(503).json({
            status: 'not_ready',
            timestamp: new Date().toISOString(),
            error: 'Readiness check service unavailable'
        });
    }
});

// Liveness probe for Kubernetes/Docker
app.get('/health/live', async (req, res) => {
    try {
        const livenessStatus = await healthCheckService.getLivenessCheck();
        res.status(200).json(livenessStatus);
    } catch (error) {
        logger.error('Liveness check failed:', error);
        res.status(503).json({
            status: 'not_alive',
            timestamp: new Date().toISOString(),
            error: 'Liveness check service unavailable'
        });
    }
});

// Database initialization status endpoint
app.get('/health/init', async (req, res) => {
    try {
        const initStatus = await databaseInitService.getInitializationStatus();
        const statusCode = initStatus.status === 'initialized' ? 200 : 
                          initStatus.status === 'partial' ? 202 : 503;
        
        res.status(statusCode).json(initStatus);
    } catch (error) {
        logger.error('Initialization status check failed:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Initialization status service unavailable'
        });
    }
});

// Concurrency monitoring endpoint
app.get('/health/concurrency', async (req, res) => {
    try {
        const concurrencyStats = concurrencyService.getConcurrencyStats();
        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            ...concurrencyStats
        });
    } catch (error) {
        logger.error('Concurrency status check failed:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Concurrency monitoring service unavailable'
        });
    }
});

// Data persistence monitoring endpoint
app.get('/health/persistence', async (req, res) => {
    try {
        const persistenceStatus = dataPersistenceService.getVerificationStatus();
        const statusCode = persistenceStatus.lastVerification?.overall === 'success' ? 200 :
                          persistenceStatus.lastVerification?.overall === 'warning' ? 200 : 503;
        
        res.status(statusCode).json({
            timestamp: new Date().toISOString(),
            ...persistenceStatus
        });
    } catch (error) {
        logger.error('Persistence status check failed:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Persistence monitoring service unavailable'
        });
    }
});

// Trigger manual persistence verification
app.post('/health/persistence/verify', async (req, res) => {
    try {
        const verificationResult = await dataPersistenceService.triggerVerification();
        const statusCode = verificationResult.overall === 'success' ? 200 :
                          verificationResult.overall === 'warning' ? 200 : 503;
        
        res.status(statusCode).json(verificationResult);
    } catch (error) {
        logger.error('Manual persistence verification failed:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Manual verification failed'
        });
    }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/master-arrays', masterArrayRoutes);
app.use('/api/database-encryption', databaseEncryptionRoutes);
app.use('/api/staff-profiles', staffProfileRoutes);
app.use('/api/genotype-analysis', genotypeAnalysisRoutes);
app.use('/api/genotype-panels', require('./routes/genotypePanels'));
app.use('/api/staff-contamination', staffContaminationRoutes);
app.use('/api/contamination-stats', contaminationStatsRoutes);
app.use('/api/analytics', analyticsRoutes);

// Feature status endpoint
app.get('/api/features', getFeatureStatus);

// Conditionally register Bayesian routes based on feature toggle
conditionalRoute(app, () => config.isBayesianAnalysisEnabled(), '/api/bayesian', bayesianRoutes);

// Serve static files with no-cache headers for development
app.use(express.static('public', {
    setHeaders: (res, path) => {
        // Отключаем кеширование для JS и HTML файлов
        if (path.endsWith('.js') || path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Catch all handler for SPA (serve index.html for all non-API routes)
app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
        return next();
    }
    
    // Serve React app for all other routes with no-cache headers
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`
    });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    
    try {
        // Stop periodic services
        if (!config.isTest()) {
            dataPersistenceService.stopPeriodicVerification();
        }
        
        // Close database connections
        const { closePool } = require('./config/database');
        await closePool();
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    
    try {
        // Stop periodic services
        if (!config.isTest()) {
            dataPersistenceService.stopPeriodicVerification();
        }
        
        // Close database connections
        const { closePool } = require('./config/database');
        await closePool();
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
});

// Start server
async function startServer() {
    try {
        // Initialize database connection and schema
        logger.info('Initializing database...');
        const initResult = await databaseInitService.initialize();
        
        if (initResult.status === 'error') {
            logger.error('Database initialization failed:', initResult.error);
            process.exit(1);
        }
        
        logger.info('Database initialized successfully');
        
        // Verify database connection
        const { pool } = await connectDatabase();
        app.locals.pool = pool;
        logger.info('Database connected successfully');
        
        // Initialize scheduled jobs for compliance and data retention
        if (!config.isTest()) {
            scheduledJobService.initialize();
            
            // Start data persistence monitoring
            dataPersistenceService.startPeriodicVerification();
            
            // Setup concurrency service cleanup
            setInterval(() => {
                concurrencyService.cleanup();
            }, 60000); // Cleanup every minute
        }
        
        // Always use HTTP server (internal network deployment)
        const httpServer = http.createServer(app);
        
        // Initialize WebSocket
        websocketService.initialize(httpServer);
        logger.info('WebSocket service initialized');
        
        httpServer.listen(PORT, '0.0.0.0', () => {
            logger.info(`DNA Analysis Server (HTTP) running on port ${PORT}`);
            logger.info(`Environment: ${config.get('app.environment')}`);
            logger.info(`Health check available at: http://localhost:${PORT}/health`);
            logger.info(`Readiness check available at: http://localhost:${PORT}/health/ready`);
            logger.info(`Liveness check available at: http://localhost:${PORT}/health/live`);
            logger.info(`WebSocket available at: ws://localhost:${PORT}/socket.io/`);
        });
        
    } catch (error) {
        logger.error('Failed to start server:', error.message);
        logger.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Only start server if not in test environment
if (!config.isTest()) {
    startServer();
}

module.exports = app;