const path = require('path');
const fs = require('fs');
require('dotenv').config();

/**
 * Environment Configuration Manager
 * Handles loading and validation of environment variables
 */
class EnvironmentConfig {
    constructor() {
        this.config = this.loadConfiguration();
        this.validateConfiguration();
    }

    loadConfiguration() {
        // Build database URL from environment variables
        const dbUrl = process.env.DATABASE_URL || this.buildDatabaseUrl();
        
        return {
            // Application Configuration
            app: {
                name: 'DNA Analysis Web Application',
                version: process.env.npm_package_version || '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                port: parseInt(process.env.PORT) || 3000,
                frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
                logLevel: process.env.LOG_LEVEL || 'INFO'
            },

            // Database Configuration
            database: {
                url: dbUrl,
                maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
                idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
                connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000
            },

            // JWT Configuration
            jwt: {
                secret: process.env.JWT_SECRET || 'dev-jwt-secret-not-for-production',
                expiresIn: process.env.JWT_EXPIRES_IN || '24h',
                algorithm: 'HS256'
            },

            // File Upload Configuration
            upload: {
                maxFileSize: this.parseFileSize(process.env.MAX_FILE_SIZE || '50MB'),
                uploadPath: process.env.UPLOAD_PATH || './uploads',
                exportPath: process.env.EXPORT_PATH || './exports',
                allowedMimeTypes: [
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.ms-excel'
                ]
            },

            // Security Configuration
            security: {
                bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
                sessionTimeout: process.env.SESSION_TIMEOUT || '24h',
                encryptionKeyPath: process.env.ENCRYPTION_KEY_PATH || './config/encryption.key',
                encryptUserEmail: process.env.ENCRYPT_USER_EMAIL === 'true',
                sslCertPath: process.env.SSL_CERT_PATH,
                sslKeyPath: process.env.SSL_KEY_PATH
            },

            // Rate Limiting Configuration
            rateLimit: {
                windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
                maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10000, // Increased from 100 to 10000
                skipSuccessfulRequests: false,
                skipFailedRequests: false
            },

            // CORS Configuration
            cors: {
                origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
                credentials: true,
                optionsSuccessStatus: 200
            },

            // Audit and Compliance Configuration
            audit: {
                retentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS) || 2555,
                enableTriggers: process.env.ENABLE_AUDIT_TRIGGERS === 'true',
                complianceMode: process.env.COMPLIANCE_MODE || 'standard'
            },

            // Redis Configuration (optional)
            redis: {
                url: process.env.REDIS_URL,
                port: parseInt(process.env.REDIS_PORT) || 6379,
                host: process.env.REDIS_HOST || 'localhost',
                password: process.env.REDIS_PASSWORD,
                db: parseInt(process.env.REDIS_DB) || 0
            },

            // Monitoring Configuration
            monitoring: {
                healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
                persistenceCheckInterval: parseInt(process.env.PERSISTENCE_CHECK_INTERVAL) || 300000,
                enableMetrics: process.env.ENABLE_METRICS === 'true'
            },

            // Backup Configuration
            backup: {
                enabled: process.env.BACKUP_ENABLED === 'true',
                schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *', // Daily at 2 AM
                retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
                path: process.env.BACKUP_PATH || './backups'
            },

            // Feature Toggles
            features: {
                bayesianAnalysis: process.env.ENABLE_BAYESIAN_ANALYSIS !== 'false', // Default enabled
                multiUser: process.env.ENABLE_MULTI_USER !== 'false', // Default enabled
                organizationalStructure: process.env.ENABLE_ORGANIZATIONAL_STRUCTURE !== 'false', // Default enabled
                taskManagement: process.env.ENABLE_TASK_MANAGEMENT !== 'false', // Default enabled
                expertGroups: process.env.ENABLE_EXPERT_GROUPS !== 'false', // Default enabled
                debugRoutes: process.env.ENABLE_DEBUG_ROUTES === 'true', // Default disabled
                testData: process.env.ENABLE_TEST_DATA === 'true' // Default disabled
            },

            // STR/SNP Analysis Configuration
            analysis: {
                strSnpLociCount: parseInt(process.env.STR_SNP_LOCI_COUNT) || 40,
                backwardCompatibilityMode: process.env.BACKWARD_COMPATIBILITY_MODE || 'auto_detect',
                minimumMatchThreshold: parseInt(process.env.MINIMUM_MATCH_THRESHOLD) || 15,
                defaultPopulation: process.env.DEFAULT_POPULATION || 'caucasian',
                thetaCorrection: parseFloat(process.env.THETA_CORRECTION) || 0.01,
                supportedModes: ['original_39_str', 'extended_40_str_snp', 'auto_detect']
            },

            // Organizational Configuration
            organization: {
                maxDepartmentsPerOrganization: parseInt(process.env.MAX_DEPARTMENTS_PER_ORG) || 50,
                maxUsersPerDepartment: parseInt(process.env.MAX_USERS_PER_DEPT) || 100,
                maxExpertGroupsPerDepartment: parseInt(process.env.MAX_EXPERT_GROUPS_PER_DEPT) || 20,
                maxMembersPerExpertGroup: parseInt(process.env.MAX_MEMBERS_PER_GROUP) || 10,
                autoCreateMasterArray: process.env.AUTO_CREATE_MASTER_ARRAY !== 'false' // Default enabled
            }
        };
    }

    buildDatabaseUrl() {
        const host = process.env.DB_HOST || 'localhost';
        const port = process.env.DB_PORT || 5432;
        const user = process.env.DB_USER || 'dna_user';
        const password = process.env.DB_PASSWORD;
        if (!password) {
            throw new Error('Set DATABASE_URL or DB_PASSWORD before starting the application');
        }
        const database = process.env.DB_NAME || 'dna_analysis';
        return `postgresql://${user}:${password}@${host}:${port}/${database}`;
    }

    validateConfiguration() {
        const errors = [];

        // Validate required environment variables
        if (this.config.app.environment === 'production') {
            if (this.config.jwt.secret === 'dev-jwt-secret-not-for-production') {
                errors.push('JWT_SECRET must be set to a secure value in production');
            }

            if (this.config.jwt.secret.length < 32) {
                errors.push('JWT_SECRET must be at least 32 characters long');
            }

            if (this.config.security.sslCertPath && !fs.existsSync(this.config.security.sslCertPath)) {
                errors.push(`SSL certificate file not found: ${this.config.security.sslCertPath}`);
            }

            if (this.config.security.sslKeyPath && !fs.existsSync(this.config.security.sslKeyPath)) {
                errors.push(`SSL key file not found: ${this.config.security.sslKeyPath}`);
            }
        }

        // Validate paths exist
        const requiredPaths = [
            this.config.upload.uploadPath,
            this.config.upload.exportPath
        ];

        requiredPaths.forEach(dirPath => {
            if (!fs.existsSync(dirPath)) {
                try {
                    fs.mkdirSync(dirPath, { recursive: true });
                } catch (error) {
                    errors.push(`Cannot create required directory: ${dirPath}`);
                }
            }
        });

        // Validate encryption key
        if (this.config.security.encryptionKeyPath && 
            !fs.existsSync(this.config.security.encryptionKeyPath)) {
            errors.push(`Encryption key file not found: ${this.config.security.encryptionKeyPath}`);
        }

        if (errors.length > 0) {
            console.error('Configuration validation errors:');
            errors.forEach(error => console.error(`  - ${error}`));
            
            if (this.config.app.environment === 'production') {
                throw new Error('Configuration validation failed in production environment');
            } else {
                console.warn('Configuration warnings detected. Application will continue in development mode.');
            }
        }
    }

    parseFileSize(sizeStr) {
        const units = {
            'B': 1,
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024
        };

        const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
        if (!match) {
            throw new Error(`Invalid file size format: ${sizeStr}`);
        }

        const [, size, unit] = match;
        return parseFloat(size) * units[unit.toUpperCase()];
    }

    get(path) {
        return path.split('.').reduce((obj, key) => obj && obj[key], this.config);
    }

    isDevelopment() {
        return this.config.app.environment === 'development';
    }

    isProduction() {
        return this.config.app.environment === 'production';
    }

    isTest() {
        return this.config.app.environment === 'test';
    }

    getConnectionString() {
        return this.config.database.url;
    }

    getJWTConfig() {
        return this.config.jwt;
    }

    getSecurityConfig() {
        return this.config.security;
    }

    getUploadConfig() {
        return this.config.upload;
    }

    getRateLimitConfig() {
        return this.config.rateLimit;
    }

    getCorsConfig() {
        return this.config.cors;
    }

    getAuditConfig() {
        return this.config.audit;
    }

    getMonitoringConfig() {
        return this.config.monitoring;
    }

    getBackupConfig() {
        return this.config.backup;
    }

    getFeatureConfig() {
        return {
            bayesianAnalysis: this.isBayesianAnalysisEnabled(),
            multiUser: this.isMultiUserEnabled(),
            organizationalStructure: this.isOrganizationalStructureEnabled(),
            taskManagement: this.isTaskManagementEnabled(),
            expertGroups: this.isExpertGroupsEnabled(),
            debugRoutes: this.isDebugRoutesEnabled(),
            testData: this.isTestDataEnabled()
        };
    }

    isBayesianAnalysisEnabled() {
        return this.config && this.config.features ? this.config.features.bayesianAnalysis : true;
    }

    isMultiUserEnabled() {
        return this.config && this.config.features ? this.config.features.multiUser : true;
    }

    isOrganizationalStructureEnabled() {
        return this.config && this.config.features ? this.config.features.organizationalStructure : true;
    }

    isTaskManagementEnabled() {
        return this.config && this.config.features ? this.config.features.taskManagement : true;
    }

    isExpertGroupsEnabled() {
        return this.config && this.config.features ? this.config.features.expertGroups : true;
    }

    isDebugRoutesEnabled() {
        return this.config && this.config.features ? this.config.features.debugRoutes : false;
    }

    isTestDataEnabled() {
        return this.config && this.config.features ? this.config.features.testData : false;
    }

    getAnalysisConfig() {
        return this.config.analysis;
    }

    getOrganizationConfig() {
        return this.config.organization;
    }

    // Method for testing - allows temporary override of feature flags
    setFeatureToggle(featureName, enabled) {
        if (!this.config.features) {
            this.config.features = {};
        }
        this.config.features[featureName] = enabled;
    }

    // Method for testing - resets feature flags to environment defaults
    resetFeatureToggles() {
        this.config.features = {
            bayesianAnalysis: process.env.ENABLE_BAYESIAN_ANALYSIS !== 'false',
            multiUser: process.env.ENABLE_MULTI_USER !== 'false',
            organizationalStructure: process.env.ENABLE_ORGANIZATIONAL_STRUCTURE !== 'false',
            taskManagement: process.env.ENABLE_TASK_MANAGEMENT !== 'false',
            expertGroups: process.env.ENABLE_EXPERT_GROUPS !== 'false',
            debugRoutes: process.env.ENABLE_DEBUG_ROUTES === 'true',
            testData: process.env.ENABLE_TEST_DATA === 'true'
        };
    }

    // Export configuration for debugging (without sensitive data)
    getSafeConfig() {
        const safeConfig = JSON.parse(JSON.stringify(this.config));
        
        // Remove sensitive information
        if (safeConfig.jwt) {
            safeConfig.jwt.secret = '***HIDDEN***';
        }
        
        if (safeConfig.database) {
            safeConfig.database.url = safeConfig.database.url.replace(/:([^:@]+)@/, ':***@');
        }

        if (safeConfig.redis && safeConfig.redis.password) {
            safeConfig.redis.password = '***HIDDEN***';
        }

        return safeConfig;
    }
}

// Create singleton instance
const environmentConfig = new EnvironmentConfig();

module.exports = environmentConfig;
