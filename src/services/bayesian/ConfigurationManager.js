/**
 * Configuration Manager - System configuration and settings management
 * 
 * Manages system-wide configuration including:
 * - Threshold values for analysis
 * - Algorithm parameters
 * - Population databases
 * - System settings
 * 
 * Requirements: 11.3, 11.4 - Configuration management and parameter settings
 */

import { ValidationError } from './ErrorHandler.js';

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
    // PCI (Profile Completeness Index) thresholds
    pciThresholds: {
        complete: 0.80,              // >= 80% = complete profile
        moderatelyIncomplete: 0.60,  // 60-79% = moderately incomplete
        severelyIncomplete: 0.40,    // 40-59% = severely incomplete
        criticallyIncomplete: 0.00   // < 40% = critically incomplete
    },

    // Degradation index thresholds
    degradationThresholds: {
        minimal: 0.20,     // < 20% = minimal degradation
        moderate: 0.40,    // 20-39% = moderate degradation
        severe: 1.00       // >= 40% = severe degradation
    },

    // Contamination detection settings
    contamination: {
        minimumMatchingLoci: 3,      // Minimum loci matches for contamination flag
        triAllelicThreshold: 3,      // Minimum alleles for triallelic flag
        enableStaffDatabase: true,   // Check against staff database
        staffDatabasePath: null      // Path to staff database
    },

    // Duplicate detection settings
    duplicates: {
        matchThreshold: 0.95,        // >= 95% match = potential duplicate
        minimumCommonLoci: 10,       // Minimum common loci for comparison
        enableAutoMerge: false,      // Automatically merge confirmed duplicates
        requireManualReview: true    // Require manual review before merging
    },

    // Likelihood Ratio calculation settings
    likelihoodRatio: {
        significanceThreshold: 1000000,  // LR > 1M = very strong evidence
        strongThreshold: 10000,          // LR > 10K = strong evidence
        moderateThreshold: 100,          // LR > 100 = moderate evidence
        weakThreshold: 1,                // LR > 1 = weak evidence
        enableBrennerCorrection: true,   // Apply Brenner correction for incomplete profiles
        conservativeEstimation: true,    // Use conservative estimates for missing data
        minAlleleFrequency: 0.0001      // Minimum allele frequency (1 in 10,000)
    },

    // Population genetics settings
    populationGenetics: {
        defaultPopulation: 'Russian',    // Default population database
        enableMultiplePopulations: true, // Allow multiple population comparisons
        thetaCorrection: 0.01,           // Population structure correction (FST)
        enableHardyWeinberg: true,       // Apply Hardy-Weinberg equilibrium
        enableLinkageEquilibrium: true   // Assume linkage equilibrium
    },

    // Heterozygosity analysis settings
    heterozygosity: {
        expectedCalculationMethod: 'hardy_weinberg', // 'hardy_weinberg' or 'observed'
        enablePopulationCorrection: true,            // Apply population-specific corrections
        minimumSampleSize: 100,                      // Minimum sample size for reliable estimates
        confidenceLevel: 0.95                        // Confidence level for estimates
    },

    // Quality analysis settings
    qualityAnalysis: {
        enableAllAnalyses: true,         // Enable all quality checks
        enablePCI: true,                 // Enable PCI calculation
        enableHeterozygosity: true,      // Enable heterozygosity analysis
        enableDegradation: true,         // Enable degradation assessment
        enableContamination: true,       // Enable contamination detection
        enableDuplicateSearch: true,     // Enable duplicate search
        enablePerspectiveCategory: true, // Enable perspective categorization
        parallelProcessing: true         // Enable parallel processing where possible
    },

    // Comparison settings
    comparison: {
        enablePartialMatches: true,      // Count partial matches in statistics
        weightPartialMatches: 0.5,       // Weight for partial matches (0-1)
        minimumCommonLoci: 8,            // Minimum common loci for valid comparison
        enableConfidenceIntervals: true, // Calculate confidence intervals for LR
        confidenceLevel: 0.95,           // Confidence level for intervals
        maxDatabaseSearchResults: 100    // Maximum results to return from database search
    },

    // Report generation settings
    reports: {
        includeMethodology: true,        // Include methodology section in reports
        includeStatistics: true,         // Include detailed statistics
        includeGraphics: true,           // Include charts and graphs
        includeRawData: false,           // Include raw data tables
        defaultFormat: 'pdf',            // Default report format ('pdf' or 'excel')
        enableWatermark: true,           // Add watermark to reports
        watermarkText: 'Bayesian Genotype Analysis System'
    },

    // System performance settings
    performance: {
        enableCaching: true,             // Enable result caching
        maxCacheSize: 1000,              // Maximum cache entries
        cacheExpirationHours: 24,        // Cache expiration time
        enableParallelProcessing: true,  // Enable parallel processing
        maxConcurrentOperations: 4,      // Maximum concurrent operations
        timeoutSeconds: 300              // Operation timeout in seconds
    },

    // Logging and monitoring settings
    logging: {
        enableLogging: true,             // Enable system logging
        logLevel: 'INFO',                // Log level: DEBUG, INFO, WARN, ERROR, CRITICAL
        enableErrorReporting: true,      // Enable error reporting
        enablePerformanceMonitoring: true, // Enable performance monitoring
        maxLogSize: 1000,                // Maximum log entries
        enableAuditTrail: true           // Enable audit trail for operations
    },

    // Security settings
    security: {
        enableDataEncryption: false,     // Enable data encryption at rest
        enableTransmissionEncryption: true, // Enable data encryption in transit
        enableAccessControl: false,      // Enable access control (requires authentication)
        enableAuditLogging: true,        // Enable security audit logging
        sessionTimeoutMinutes: 60       // Session timeout in minutes
    },

    // Data validation settings
    validation: {
        strictMode: false,               // Enable strict validation mode
        allowMissingAlleles: true,       // Allow missing alleles in samples
        allowUnknownLoci: false,         // Allow unknown loci in samples
        maxAllelesPerLocus: 4,           // Maximum alleles per locus
        enableDataSanitization: true,    // Enable automatic data sanitization
        enableFormatValidation: true     // Enable format validation
    },

    // Integration settings
    integration: {
        enableDatabaseIntegration: false, // Enable external database integration
        databaseConnectionString: null,   // Database connection string
        enableAPIAccess: false,           // Enable REST API access
        apiPort: 3000,                   // API server port
        enableWebInterface: true,        // Enable web interface
        webInterfacePort: 8080          // Web interface port
    }
};

/**
 * Configuration schema for validation
 */
export const CONFIG_SCHEMA = {
    pciThresholds: {
        type: 'object',
        required: ['complete', 'moderatelyIncomplete', 'severelyIncomplete'],
        properties: {
            complete: { type: 'number', min: 0, max: 1 },
            moderatelyIncomplete: { type: 'number', min: 0, max: 1 },
            severelyIncomplete: { type: 'number', min: 0, max: 1 },
            criticallyIncomplete: { type: 'number', min: 0, max: 1 }
        }
    },
    degradationThresholds: {
        type: 'object',
        required: ['minimal', 'moderate'],
        properties: {
            minimal: { type: 'number', min: 0, max: 1 },
            moderate: { type: 'number', min: 0, max: 1 },
            severe: { type: 'number', min: 0, max: 2 }
        }
    },
    contamination: {
        type: 'object',
        properties: {
            minimumMatchingLoci: { type: 'integer', min: 1, max: 50 },
            triAllelicThreshold: { type: 'integer', min: 3, max: 10 },
            enableStaffDatabase: { type: 'boolean' }
        }
    }
    // Additional schema definitions would continue here...
};

/**
 * Configuration Manager class
 */
class ConfigurationManager {
    constructor(initialConfig = {}) {
        this.config = this._mergeConfig(DEFAULT_CONFIG, initialConfig);
        this.configHistory = [];
        this.listeners = new Map();
        this.validationEnabled = true;

        // Validate initial configuration
        this._validateConfiguration(this.config);
        
        // Record initial configuration
        this._recordConfigChange('initialization', null, this.config);
    }

    /**
     * Get configuration value
     * @param {string} path - Configuration path (e.g., 'pciThresholds.complete')
     * @returns {*} Configuration value
     */
    get(path) {
        return this._getNestedValue(this.config, path);
    }

    /**
     * Set configuration value
     * @param {string} path - Configuration path
     * @param {*} value - New value
     * @param {Object} options - Set options
     */
    set(path, value, options = {}) {
        const oldValue = this.get(path);
        
        // Validate new value if validation is enabled
        if (this.validationEnabled && !options.skipValidation) {
            this._validateConfigValue(path, value);
        }

        // Set the value
        this._setNestedValue(this.config, path, value);

        // Record change
        this._recordConfigChange('set', { path, oldValue, newValue: value });

        // Notify listeners
        this._notifyListeners(path, value, oldValue);

        return this;
    }

    /**
     * Update multiple configuration values
     * @param {Object} updates - Object with configuration updates
     * @param {Object} options - Update options
     */
    update(updates, options = {}) {
        const changes = [];

        Object.entries(updates).forEach(([path, value]) => {
            const oldValue = this.get(path);
            
            if (this.validationEnabled && !options.skipValidation) {
                this._validateConfigValue(path, value);
            }

            this._setNestedValue(this.config, path, value);
            changes.push({ path, oldValue, newValue: value });
        });

        // Record batch change
        this._recordConfigChange('batch_update', changes);

        // Notify listeners for all changes
        changes.forEach(({ path, newValue, oldValue }) => {
            this._notifyListeners(path, newValue, oldValue);
        });

        return this;
    }

    /**
     * Reset configuration to defaults
     * @param {Array<string>} paths - Specific paths to reset (optional)
     */
    reset(paths = null) {
        const oldConfig = { ...this.config };

        if (paths) {
            // Reset specific paths
            paths.forEach(path => {
                const defaultValue = this._getNestedValue(DEFAULT_CONFIG, path);
                this._setNestedValue(this.config, path, defaultValue);
            });
        } else {
            // Reset entire configuration
            this.config = { ...DEFAULT_CONFIG };
        }

        this._recordConfigChange('reset', { paths, oldConfig, newConfig: this.config });
        
        // Notify all listeners
        this._notifyAllListeners();

        return this;
    }

    /**
     * Load configuration from object
     * @param {Object} configData - Configuration data
     * @param {Object} options - Load options
     */
    load(configData, options = {}) {
        const oldConfig = { ...this.config };

        if (options.merge !== false) {
            this.config = this._mergeConfig(this.config, configData);
        } else {
            this.config = this._mergeConfig(DEFAULT_CONFIG, configData);
        }

        if (this.validationEnabled && !options.skipValidation) {
            this._validateConfiguration(this.config);
        }

        this._recordConfigChange('load', { oldConfig, newConfig: this.config, options });
        this._notifyAllListeners();

        return this;
    }

    /**
     * Export current configuration
     * @param {Object} options - Export options
     * @returns {Object} Configuration data
     */
    export(options = {}) {
        const config = options.includeDefaults ? 
            this.config : 
            this._getDifferencesFromDefault(this.config, DEFAULT_CONFIG);

        if (options.format === 'json') {
            return JSON.stringify(config, null, 2);
        }

        return config;
    }

    /**
     * Add configuration change listener
     * @param {string} path - Configuration path to watch
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    addListener(path, callback) {
        if (!this.listeners.has(path)) {
            this.listeners.set(path, new Set());
        }
        
        this.listeners.get(path).add(callback);

        // Return unsubscribe function
        return () => {
            const pathListeners = this.listeners.get(path);
            if (pathListeners) {
                pathListeners.delete(callback);
                if (pathListeners.size === 0) {
                    this.listeners.delete(path);
                }
            }
        };
    }

    /**
     * Get configuration history
     * @param {number} limit - Maximum number of entries to return
     * @returns {Array} Configuration history
     */
    getHistory(limit = 50) {
        return this.configHistory.slice(-limit);
    }

    /**
     * Validate current configuration
     * @returns {Object} Validation result
     */
    validate() {
        try {
            this._validateConfiguration(this.config);
            return { valid: true, errors: [] };
        } catch (error) {
            return { valid: false, errors: [error.message] };
        }
    }

    /**
     * Get configuration summary
     * @returns {Object} Configuration summary
     */
    getSummary() {
        return {
            totalSettings: this._countSettings(this.config),
            modifiedFromDefaults: this._countModifiedSettings(),
            lastModified: this.configHistory.length > 0 ? 
                this.configHistory[this.configHistory.length - 1].timestamp : null,
            validationEnabled: this.validationEnabled,
            activeListeners: this.listeners.size
        };
    }

    // Private methods

    /**
     * Merge configuration objects
     * @private
     */
    _mergeConfig(base, override) {
        const result = { ...base };
        
        Object.keys(override).forEach(key => {
            if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
                result[key] = this._mergeConfig(base[key] || {}, override[key]);
            } else {
                result[key] = override[key];
            }
        });

        return result;
    }

    /**
     * Get nested value from object
     * @private
     */
    _getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    /**
     * Set nested value in object
     * @private
     */
    _setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        
        const target = keys.reduce((current, key) => {
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            return current[key];
        }, obj);

        target[lastKey] = value;
    }

    /**
     * Validate configuration value
     * @private
     */
    _validateConfigValue(path, value) {
        const pathParts = path.split('.');
        const section = pathParts[0];
        const property = pathParts[1];

        // Basic type validation
        if (path.includes('Threshold') && typeof value !== 'number') {
            throw new ValidationError(`Threshold values must be numbers: ${path}`);
        }

        if (path.includes('enable') && typeof value !== 'boolean') {
            throw new ValidationError(`Enable flags must be boolean: ${path}`);
        }

        // Range validation for thresholds
        if (path.includes('pciThresholds') || path.includes('degradationThresholds')) {
            if (value < 0 || value > 1) {
                throw new ValidationError(`Threshold values must be between 0 and 1: ${path} = ${value}`);
            }
        }

        // Specific validations
        if (path === 'contamination.minimumMatchingLoci') {
            if (!Number.isInteger(value) || value < 1 || value > 50) {
                throw new ValidationError('Minimum matching loci must be an integer between 1 and 50');
            }
        }

        if (path === 'likelihoodRatio.minAlleleFrequency') {
            if (value <= 0 || value > 0.1) {
                throw new ValidationError('Minimum allele frequency must be between 0 and 0.1');
            }
        }
    }

    /**
     * Validate entire configuration
     * @private
     */
    _validateConfiguration(config) {
        // Validate PCI thresholds are in correct order
        const pci = config.pciThresholds;
        if (pci.complete <= pci.moderatelyIncomplete || 
            pci.moderatelyIncomplete <= pci.severelyIncomplete) {
            throw new ValidationError('PCI thresholds must be in descending order');
        }

        // Validate degradation thresholds
        const deg = config.degradationThresholds;
        if (deg.minimal >= deg.moderate) {
            throw new ValidationError('Degradation thresholds must be in ascending order');
        }

        // Validate LR thresholds
        const lr = config.likelihoodRatio;
        if (lr.significanceThreshold <= lr.strongThreshold ||
            lr.strongThreshold <= lr.moderateThreshold ||
            lr.moderateThreshold <= lr.weakThreshold) {
            throw new ValidationError('LR thresholds must be in descending order');
        }
    }

    /**
     * Record configuration change
     * @private
     */
    _recordConfigChange(type, details) {
        this.configHistory.push({
            timestamp: new Date(),
            type,
            details
        });

        // Keep history size manageable
        if (this.configHistory.length > 1000) {
            this.configHistory = this.configHistory.slice(-500);
        }
    }

    /**
     * Notify configuration listeners
     * @private
     */
    _notifyListeners(path, newValue, oldValue) {
        // Notify exact path listeners
        const pathListeners = this.listeners.get(path);
        if (pathListeners) {
            pathListeners.forEach(callback => {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    console.error('Error in configuration listener:', error);
                }
            });
        }

        // Notify wildcard listeners (e.g., 'pciThresholds.*')
        const pathParts = path.split('.');
        for (let i = 1; i <= pathParts.length; i++) {
            const wildcardPath = pathParts.slice(0, i).join('.') + '.*';
            const wildcardListeners = this.listeners.get(wildcardPath);
            if (wildcardListeners) {
                wildcardListeners.forEach(callback => {
                    try {
                        callback(newValue, oldValue, path);
                    } catch (error) {
                        console.error('Error in configuration wildcard listener:', error);
                    }
                });
            }
        }
    }

    /**
     * Notify all listeners
     * @private
     */
    _notifyAllListeners() {
        this.listeners.forEach((callbacks, path) => {
            const value = this.get(path.replace('.*', ''));
            callbacks.forEach(callback => {
                try {
                    callback(value, undefined, path);
                } catch (error) {
                    console.error('Error in configuration listener:', error);
                }
            });
        });
    }

    /**
     * Count total settings
     * @private
     */
    _countSettings(obj, count = 0) {
        Object.values(obj).forEach(value => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                count = this._countSettings(value, count);
            } else {
                count++;
            }
        });
        return count;
    }

    /**
     * Count settings modified from defaults
     * @private
     */
    _countModifiedSettings() {
        return this._countDifferences(this.config, DEFAULT_CONFIG);
    }

    /**
     * Count differences between objects
     * @private
     */
    _countDifferences(obj1, obj2, count = 0) {
        Object.keys(obj1).forEach(key => {
            if (obj1[key] && typeof obj1[key] === 'object' && !Array.isArray(obj1[key])) {
                if (obj2[key]) {
                    count = this._countDifferences(obj1[key], obj2[key], count);
                } else {
                    count++;
                }
            } else if (obj1[key] !== obj2[key]) {
                count++;
            }
        });
        return count;
    }

    /**
     * Get differences from default configuration
     * @private
     */
    _getDifferencesFromDefault(current, defaults) {
        const differences = {};
        
        Object.keys(current).forEach(key => {
            if (current[key] && typeof current[key] === 'object' && !Array.isArray(current[key])) {
                if (defaults[key]) {
                    const nestedDiff = this._getDifferencesFromDefault(current[key], defaults[key]);
                    if (Object.keys(nestedDiff).length > 0) {
                        differences[key] = nestedDiff;
                    }
                } else {
                    differences[key] = current[key];
                }
            } else if (current[key] !== defaults[key]) {
                differences[key] = current[key];
            }
        });

        return differences;
    }
}

export default ConfigurationManager;