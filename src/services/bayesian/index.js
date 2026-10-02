/**
 * Bayesian Analysis Services Index
 * 
 * This module exports all Bayesian analysis services and provides
 * a factory function to create a fully configured Bayesian Engine.
 */

const BayesianEngine = require('./BayesianEngine');
const LRCalculator = require('./LRCalculator');
const ContaminationDetector = require('./ContaminationDetector');
const DegradationAnalyzer = require('./DegradationAnalyzer');
const DuplicateFinder = require('./DuplicateFinder');
const PopulationManager = require('./PopulationManager');
const SystemParameters = require('./SystemParameters');
const QualityMetrics = require('./QualityMetrics');
const QualityAnalyzer = require('./QualityAnalyzer');
const GenotypeComparator = require('./GenotypeComparator');
const ReportGenerator = require('./ReportGenerator');
const { ValidationUtils, Classifications, Thresholds } = require('./types');
const { GeneticSample, SampleMetadata, LocusData, PopulationFrequencies } = require('./models');

/**
 * Create a fully configured Bayesian Engine with all dependencies
 * @returns {Promise<BayesianEngine>} Configured Bayesian Engine instance
 */
async function createBayesianEngine() {
    try {
        // Create core services
        const populationManager = new PopulationManager();
        const systemParameters = new SystemParameters();
        const qualityMetrics = new QualityMetrics();

        // Create analysis services with dependencies
        const lrCalculator = new LRCalculator(populationManager, systemParameters);
        const contaminationDetector = new ContaminationDetector(populationManager, systemParameters);
        const degradationAnalyzer = new DegradationAnalyzer(systemParameters);
        const duplicateFinder = new DuplicateFinder(lrCalculator, systemParameters);
        
        // Create new comprehensive services
        const qualityAnalyzer = new QualityAnalyzer(populationManager, systemParameters);
        const genotypeComparator = new GenotypeComparator(lrCalculator, populationManager);
        const reportGenerator = new ReportGenerator();

        // Create and configure Bayesian Engine
        const bayesianEngine = new BayesianEngine();
        
        // Inject dependencies
        bayesianEngine.lrCalculator = lrCalculator;
        bayesianEngine.contaminationDetector = contaminationDetector;
        bayesianEngine.degradationAnalyzer = degradationAnalyzer;
        bayesianEngine.duplicateFinder = duplicateFinder;
        bayesianEngine.populationManager = populationManager;
        bayesianEngine.systemParameters = systemParameters;
        bayesianEngine.qualityMetrics = qualityMetrics;
        bayesianEngine.qualityAnalyzer = qualityAnalyzer;
        bayesianEngine.genotypeComparator = genotypeComparator;
        bayesianEngine.reportGenerator = reportGenerator;

        // Initialize the engine
        await bayesianEngine.initialize();

        return bayesianEngine;

    } catch (error) {
        throw new Error(`Failed to create Bayesian Engine: ${error.message}`);
    }
}

/**
 * Create individual service instances
 */
function createPopulationManager() {
    return new PopulationManager();
}

function createSystemParameters() {
    return new SystemParameters();
}

function createQualityMetrics() {
    return new QualityMetrics();
}

function createLRCalculator(populationManager, systemParameters) {
    return new LRCalculator(populationManager, systemParameters);
}

function createContaminationDetector(populationManager, systemParameters) {
    return new ContaminationDetector(populationManager, systemParameters);
}

function createDegradationAnalyzer(systemParameters) {
    return new DegradationAnalyzer(systemParameters);
}

function createDuplicateFinder(lrCalculator, systemParameters) {
    return new DuplicateFinder(lrCalculator, systemParameters);
}

function createQualityAnalyzer(populationManager, systemParameters) {
    return new QualityAnalyzer(populationManager, systemParameters);
}

function createGenotypeComparator(lrCalculator, populationManager) {
    return new GenotypeComparator(lrCalculator, populationManager);
}

function createReportGenerator() {
    return new ReportGenerator();
}

module.exports = {
    // Main factory function
    createBayesianEngine,
    
    // Individual service factories
    createPopulationManager,
    createSystemParameters,
    createQualityMetrics,
    createLRCalculator,
    createContaminationDetector,
    createDegradationAnalyzer,
    createDuplicateFinder,
    createQualityAnalyzer,
    createGenotypeComparator,
    createReportGenerator,
    
    // Service classes for direct instantiation
    BayesianEngine,
    LRCalculator,
    ContaminationDetector,
    DegradationAnalyzer,
    DuplicateFinder,
    PopulationManager,
    SystemParameters,
    QualityMetrics,
    QualityAnalyzer,
    GenotypeComparator,
    ReportGenerator,
    
    // Data models
    GeneticSample,
    SampleMetadata,
    LocusData,
    PopulationFrequencies,
    
    // Utilities and constants
    ValidationUtils,
    Classifications,
    Thresholds
};