/**
 * Bayesian Analysis Controller - Main System Controller
 * 
 * Integrates all components into a unified system:
 * - QualityAnalyzer
 * - GenotypeComparator  
 * - LRCalculator
 * - ReportGenerator
 * 
 * Requirements: 11.1, 11.2 - System integration and error handling
 */

const QualityAnalyzer = require('./QualityAnalyzer');
const GenotypeComparator = require('./GenotypeComparator');
const LRCalculator = require('./LRCalculator');
const ReportGenerator = require('./ReportGenerator');
const { GeneticSample, LocusData, SampleMetadata } = require('./models/GeneticSample');
const { PopulationFrequencies } = require('./models/PopulationFrequencies');

/**
 * Main controller for Bayesian genotype analysis system
 */
class BayesianAnalysisController {
    constructor(config = {}) {
        this.config = {
            // Default configuration
            pciThresholds: {
                complete: 0.80,
                moderatelyIncomplete: 0.60,
                severelyIncomplete: 0.40
            },
            degradationThresholds: {
                minimal: 0.20,
                moderate: 0.40
            },
            contaminationThreshold: 3,
            duplicateThreshold: 0.95,
            lrThreshold: 1000000,
            populationDatabase: 'Russian',
            enableLogging: true,
            enableCaching: true,
            maxCacheSize: 1000,
            ...config
        };

        // Initialize components
        this.qualityAnalyzer = new QualityAnalyzer(this.config);
        this.genotypeComparator = new GenotypeComparator(this.config);
        this.lrCalculator = new LRCalculator(this.config);
        this.reportGenerator = new ReportGenerator(this.config);

        // Initialize cache and logging
        this.cache = new Map();
        this.operationHistory = [];
        this.errorLog = [];

        // Bind methods
        this.analyzeQuality = this.analyzeQuality.bind(this);
        this.compareGenotypes = this.compareGenotypes.bind(this);
        this.searchDatabase = this.searchDatabase.bind(this);
        this.generateReport = this.generateReport.bind(this);
    }

    /**
     * Perform comprehensive quality analysis of a genetic sample
     * @param {GeneticSample} sample - The genetic sample to analyze
     * @param {Object} options - Analysis options
     * @returns {Promise<Object>} Quality analysis results
     */
    async analyzeQuality(sample, options = {}) {
        const operationId = this._generateOperationId();
        const startTime = Date.now();

        try {
            this._log('info', `Starting quality analysis for sample ${sample.id}`, { operationId });

            // Validate input
            this._validateSample(sample);

            // Check cache
            const cacheKey = `quality_${sample.id}_${JSON.stringify(options)}`;
            if (this.config.enableCaching && this.cache.has(cacheKey)) {
                this._log('info', `Returning cached quality results for sample ${sample.id}`, { operationId });
                return this.cache.get(cacheKey);
            }

            // Perform quality analysis
            const results = {
                sampleId: sample.id,
                operationId,
                analysisDate: new Date(),
                
                // PCI Analysis
                pci: await this.qualityAnalyzer.calculatePCI(sample),
                
                // Heterozygosity Analysis
                heterozygosity: await this.qualityAnalyzer.calculateHeterozygosity(sample),
                
                // Degradation Analysis
                degradation: await this.qualityAnalyzer.calculateDegradationIndex(sample),
                
                // Contamination Detection
                contamination: await this.qualityAnalyzer.detectContamination(sample),
                
                // Duplicate Search
                duplicates: await this.qualityAnalyzer.findDuplicates(sample),
                
                // Perspective Category
                perspectiveCategory: await this.qualityAnalyzer.assignPerspectiveCategory(sample)
            };

            // Add processing metadata
            results.processingTime = Date.now() - startTime;
            results.config = {
                pciThresholds: this.config.pciThresholds,
                degradationThresholds: this.config.degradationThresholds,
                contaminationThreshold: this.config.contaminationThreshold
            };

            // Cache results
            if (this.config.enableCaching) {
                this._addToCache(cacheKey, results);
            }

            // Log operation
            this._logOperation('quality_analysis', {
                operationId,
                sampleId: sample.id,
                processingTime: results.processingTime,
                category: results.perspectiveCategory.category
            });

            this._log('info', `Quality analysis completed for sample ${sample.id}`, { 
                operationId, 
                processingTime: results.processingTime 
            });

            return results;

        } catch (error) {
            this._handleError('Quality Analysis', error, { operationId, sampleId: sample.id });
            throw error;
        }
    }

    /**
     * Compare two genetic samples
     * @param {GeneticSample} sample1 - First sample
     * @param {GeneticSample} sample2 - Second sample
     * @param {Object} options - Comparison options
     * @returns {Promise<Object>} Comparison results
     */
    async compareGenotypes(sample1, sample2, options = {}) {
        const operationId = this._generateOperationId();
        const startTime = Date.now();

        try {
            this._log('info', `Starting genotype comparison: ${sample1.id} vs ${sample2.id}`, { operationId });

            // Validate inputs
            this._validateSample(sample1);
            this._validateSample(sample2);

            // Check cache
            const cacheKey = `comparison_${sample1.id}_${sample2.id}_${JSON.stringify(options)}`;
            if (this.config.enableCaching && this.cache.has(cacheKey)) {
                this._log('info', `Returning cached comparison results`, { operationId });
                return this.cache.get(cacheKey);
            }

            // Perform comparison
            const comparisonResults = await this.genotypeComparator.compareSamples(sample1, sample2, options);
            
            // Calculate statistical significance
            const lrResults = await this.lrCalculator.calculateLikelihoodRatio(
                comparisonResults.locusComparisons,
                options
            );

            // Combine results
            const results = {
                operationId,
                comparisonType: 'sample-vs-sample',
                sample1Id: sample1.id,
                sample2Id: sample2.id,
                analysisDate: new Date(),
                
                // Comparison results
                overallMatch: comparisonResults.overallMatch,
                locusComparisons: comparisonResults.locusComparisons,
                
                // Statistical results
                likelihoodRatio: lrResults.likelihoodRatio,
                correctedLR: lrResults.correctedLR,
                matchProbability: lrResults.matchProbability,
                significance: lrResults.significance,
                confidenceInterval: lrResults.confidenceInterval,
                
                // Metadata
                populationUsed: this.config.populationDatabase,
                calculationMetadata: {
                    timestamp: new Date(),
                    method: 'Enhanced Hardy-Weinberg',
                    commonLoci: comparisonResults.commonLoci,
                    totalLoci1: sample1.loci.length,
                    totalLoci2: sample2.loci.length,
                    processingTime: Date.now() - startTime,
                    errors: [],
                    warnings: lrResults.warnings || []
                }
            };

            // Cache results
            if (this.config.enableCaching) {
                this._addToCache(cacheKey, results);
            }

            // Log operation
            this._logOperation('genotype_comparison', {
                operationId,
                sample1Id: sample1.id,
                sample2Id: sample2.id,
                matchPercentage: results.overallMatch.matchPercentage,
                likelihoodRatio: results.likelihoodRatio,
                processingTime: results.calculationMetadata.processingTime
            });

            this._log('info', `Genotype comparison completed`, { 
                operationId, 
                processingTime: results.calculationMetadata.processingTime 
            });

            return results;

        } catch (error) {
            this._handleError('Genotype Comparison', error, { 
                operationId, 
                sample1Id: sample1.id, 
                sample2Id: sample2.id 
            });
            throw error;
        }
    }

    /**
     * Search for matches in the database
     * @param {GeneticSample} sample - Sample to search for
     * @param {Array<GeneticSample>} database - Database to search in
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Search results
     */
    async searchDatabase(sample, database, options = {}) {
        const operationId = this._generateOperationId();
        const startTime = Date.now();

        try {
            this._log('info', `Starting database search for sample ${sample.id}`, { 
                operationId, 
                databaseSize: database.length 
            });

            // Validate inputs
            this._validateSample(sample);
            if (!Array.isArray(database) || database.length === 0) {
                throw new Error('Database must be a non-empty array of genetic samples');
            }

            // Perform database search
            const searchResults = await this.genotypeComparator.searchInDatabase(sample, database, options);

            // Calculate LR for top matches
            const enhancedResults = await Promise.all(
                searchResults.slice(0, options.maxResults || 10).map(async (result) => {
                    try {
                        const lrResults = await this.lrCalculator.calculateLikelihoodRatio(
                            result.locusComparisons,
                            options
                        );
                        
                        return {
                            ...result,
                            likelihoodRatio: lrResults.likelihoodRatio,
                            matchProbability: lrResults.matchProbability,
                            significance: lrResults.significance
                        };
                    } catch (error) {
                        this._log('warning', `Failed to calculate LR for match ${result.targetSampleId}`, { 
                            operationId, 
                            error: error.message 
                        });
                        return result;
                    }
                })
            );

            const results = {
                operationId,
                comparisonType: 'database-search',
                sample1Id: sample.id,
                sample2Id: 'database',
                analysisDate: new Date(),
                
                // Search results
                searchResults: enhancedResults,
                totalSearched: database.length,
                matchesFound: enhancedResults.length,
                
                // Best match (if any)
                bestMatch: enhancedResults.length > 0 ? enhancedResults[0] : null,
                
                // Metadata
                populationUsed: this.config.populationDatabase,
                calculationMetadata: {
                    timestamp: new Date(),
                    method: 'Database Search with LR',
                    processingTime: Date.now() - startTime,
                    searchOptions: options,
                    errors: [],
                    warnings: []
                }
            };

            // Log operation
            this._logOperation('database_search', {
                operationId,
                sampleId: sample.id,
                databaseSize: database.length,
                matchesFound: results.matchesFound,
                processingTime: results.calculationMetadata.processingTime
            });

            this._log('info', `Database search completed`, { 
                operationId, 
                matchesFound: results.matchesFound,
                processingTime: results.calculationMetadata.processingTime 
            });

            return results;

        } catch (error) {
            this._handleError('Database Search', error, { operationId, sampleId: sample.id });
            throw error;
        }
    }

    /**
     * Generate comprehensive report
     * @param {Object} analysisResults - Results from analysis or comparison
     * @param {string} reportType - Type of report ('quality', 'comparison', 'search')
     * @param {Object} options - Report options
     * @returns {Promise<Object>} Generated report
     */
    async generateReport(analysisResults, reportType, options = {}) {
        const operationId = this._generateOperationId();
        const startTime = Date.now();

        try {
            this._log('info', `Generating ${reportType} report`, { operationId });

            let report;
            switch (reportType) {
                case 'quality':
                    report = await this.reportGenerator.generateQualityReport(analysisResults, options);
                    break;
                case 'comparison':
                    report = await this.reportGenerator.generateComparisonReport(analysisResults, options);
                    break;
                case 'search':
                    report = await this.reportGenerator.generateSearchReport(analysisResults, options);
                    break;
                default:
                    throw new Error(`Unknown report type: ${reportType}`);
            }

            // Add metadata
            report.generationMetadata = {
                operationId,
                reportType,
                generatedAt: new Date(),
                processingTime: Date.now() - startTime,
                options
            };

            // Log operation
            this._logOperation('report_generation', {
                operationId,
                reportType,
                processingTime: report.generationMetadata.processingTime
            });

            this._log('info', `Report generation completed`, { 
                operationId, 
                reportType,
                processingTime: report.generationMetadata.processingTime 
            });

            return report;

        } catch (error) {
            this._handleError('Report Generation', error, { operationId, reportType });
            throw error;
        }
    }

    /**
     * Get system status and statistics
     * @returns {Object} System status
     */
    getSystemStatus() {
        return {
            timestamp: new Date(),
            config: this.config,
            cache: {
                size: this.cache.size,
                maxSize: this.config.maxCacheSize,
                hitRate: this._calculateCacheHitRate()
            },
            operations: {
                total: this.operationHistory.length,
                recent: this.operationHistory.slice(-10)
            },
            errors: {
                total: this.errorLog.length,
                recent: this.errorLog.slice(-5)
            },
            components: {
                qualityAnalyzer: 'active',
                genotypeComparator: 'active',
                lrCalculator: 'active',
                reportGenerator: 'active'
            }
        };
    }

    /**
     * Clear cache and reset system
     */
    reset() {
        this.cache.clear();
        this.operationHistory = [];
        this.errorLog = [];
        this._log('info', 'System reset completed');
    }

    // Private methods

    /**
     * Validate genetic sample
     * @private
     */
    _validateSample(sample) {
        if (!sample || typeof sample !== 'object') {
            throw new Error('Sample must be a valid object');
        }
        if (!sample.id) {
            throw new Error('Sample must have an ID');
        }
        if (!Array.isArray(sample.loci) || sample.loci.length === 0) {
            throw new Error('Sample must have loci data');
        }
    }

    /**
     * Generate unique operation ID
     * @private
     */
    _generateOperationId() {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Add result to cache
     * @private
     */
    _addToCache(key, value) {
        if (this.cache.size >= this.config.maxCacheSize) {
            // Remove oldest entry
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    /**
     * Calculate cache hit rate
     * @private
     */
    _calculateCacheHitRate() {
        const recentOps = this.operationHistory.slice(-100);
        const cacheHits = recentOps.filter(op => op.cacheHit).length;
        return recentOps.length > 0 ? (cacheHits / recentOps.length) * 100 : 0;
    }

    /**
     * Log operation to history
     * @private
     */
    _logOperation(type, data) {
        this.operationHistory.push({
            timestamp: new Date(),
            type,
            ...data
        });

        // Keep only recent operations
        if (this.operationHistory.length > 1000) {
            this.operationHistory = this.operationHistory.slice(-500);
        }
    }

    /**
     * Handle and log errors
     * @private
     */
    _handleError(operation, error, context = {}) {
        const errorEntry = {
            timestamp: new Date(),
            operation,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            context
        };

        this.errorLog.push(errorEntry);
        
        // Keep only recent errors
        if (this.errorLog.length > 100) {
            this.errorLog = this.errorLog.slice(-50);
        }

        this._log('error', `${operation} failed: ${error.message}`, context);
    }

    /**
     * Internal logging
     * @private
     */
    _log(level, message, context = {}) {
        if (!this.config.enableLogging) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            message,
            context
        };

        // In a real application, this would use a proper logging library
        console.log(`[${logEntry.timestamp}] ${logEntry.level}: ${logEntry.message}`, 
                   Object.keys(logEntry.context).length > 0 ? logEntry.context : '');
    }
}

module.exports = BayesianAnalysisController;