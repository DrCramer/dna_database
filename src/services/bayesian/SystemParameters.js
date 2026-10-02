/**
 * System Parameters - Manages Bayesian model parameters and validation
 * 
 * This service handles configuration, validation, and persistence of
 * system parameters used in Bayesian calculations.
 */

const { logger } = require('../../utils/logger');
const { query, transaction } = require('../../config/database');

class SystemParameters {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 10 * 60 * 1000; // 10 minutes
        
        // Parameter definitions with validation rules
        this.parameterDefinitions = {
            drop_out_probability: {
                type: 'number',
                description: 'Probability of allele drop-out during PCR amplification',
                minValue: 0.001,
                maxValue: 0.1,
                defaultValue: 0.01
            },
            false_allele_probability: {
                type: 'number', 
                description: 'Probability of false allele detection',
                minValue: 0.001,
                maxValue: 0.05,
                defaultValue: 0.005
            },
            inbreeding_coefficient: {
                type: 'number',
                description: 'Population inbreeding coefficient for Hardy-Weinberg calculations',
                minValue: 0.0,
                maxValue: 0.3,
                defaultValue: 0.0
            },
            contamination_threshold: {
                type: 'number',
                description: 'Threshold for flagging potential contamination',
                minValue: 0.01,
                maxValue: 0.5,
                defaultValue: 0.1
            },
            degradation_threshold: {
                type: 'number',
                description: 'Threshold for flagging potential degradation',
                minValue: 0.5,
                maxValue: 0.9,
                defaultValue: 0.7
            },
            duplicate_probability_threshold: {
                type: 'number',
                description: 'Threshold for flagging potential duplicates',
                minValue: 0.8,
                maxValue: 0.999,
                defaultValue: 0.95
            }
        };
    }

    /**
     * Get all system parameters
     * @returns {Promise<Object>} Object with parameter names as keys and values
     */
    async getAllParameters() {
        try {
            // Check cache first
            const cacheKey = 'all_parameters';
            const cached = this.cache.get(cacheKey);
            
            if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
                logger.debug('System parameters cache hit');
                return cached.data;
            }

            // Load from database
            const result = await query(`
                SELECT parameter_name, parameter_value, parameter_type, description
                FROM system_parameters
                ORDER BY parameter_name
            `);

            const parameters = {};
            result.rows.forEach(row => {
                parameters[row.parameter_name] = {
                    value: parseFloat(row.parameter_value),
                    type: row.parameter_type,
                    description: row.description
                };
            });

            // Cache the result
            this.cache.set(cacheKey, {
                data: parameters,
                timestamp: Date.now()
            });

            logger.debug(`Loaded ${Object.keys(parameters).length} system parameters`);
            return parameters;

        } catch (error) {
            logger.error('Failed to get system parameters:', error);
            throw error;
        }
    }

    /**
     * Get a specific parameter value
     * @param {string} parameterName - Name of the parameter
     * @returns {Promise<number>} Parameter value
     */
    async getParameter(parameterName) {
        try {
            const parameters = await this.getAllParameters();
            
            if (!parameters[parameterName]) {
                throw new Error(`Parameter not found: ${parameterName}`);
            }
            
            return parameters[parameterName].value;

        } catch (error) {
            logger.error(`Failed to get parameter ${parameterName}:`, error);
            throw error;
        }
    }

    /**
     * Set a parameter value with validation
     * @param {string} parameterName - Name of the parameter
     * @param {number} value - New parameter value
     * @param {string} updatedBy - User ID who updated the parameter
     * @returns {Promise<void>}
     */
    async setParameter(parameterName, value, updatedBy = null) {
        try {
            // Validate parameter exists and value is within range
            const validation = this.validateParameter(parameterName, value);
            if (!validation.isValid) {
                throw new Error(`Parameter validation failed: ${validation.errors.join('; ')}`);
            }

            await transaction(async (client) => {
                // Update parameter in database
                const result = await client.query(`
                    UPDATE system_parameters 
                    SET parameter_value = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2
                    WHERE parameter_name = $3
                    RETURNING id
                `, [value, updatedBy, parameterName]);

                if (result.rows.length === 0) {
                    throw new Error(`Parameter not found: ${parameterName}`);
                }

                logger.info(`Parameter ${parameterName} updated to ${value} by ${updatedBy || 'system'}`);
            });

            // Invalidate cache
            this.invalidateCache();

        } catch (error) {
            logger.error(`Failed to set parameter ${parameterName}:`, error);
            throw error;
        }
    }

    /**
     * Set multiple parameters at once
     * @param {Object} parameters - Object with parameter names as keys and values
     * @param {string} updatedBy - User ID who updated the parameters
     * @returns {Promise<void>}
     */
    async setParameters(parameters, updatedBy = null) {
        try {
            // Validate all parameters first
            const validationErrors = [];
            
            for (const [parameterName, value] of Object.entries(parameters)) {
                const validation = this.validateParameter(parameterName, value);
                if (!validation.isValid) {
                    validationErrors.push(`${parameterName}: ${validation.errors.join(', ')}`);
                }
            }

            if (validationErrors.length > 0) {
                throw new Error(`Parameter validation failed: ${validationErrors.join('; ')}`);
            }

            await transaction(async (client) => {
                // Update all parameters
                for (const [parameterName, value] of Object.entries(parameters)) {
                    const result = await client.query(`
                        UPDATE system_parameters 
                        SET parameter_value = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2
                        WHERE parameter_name = $3
                        RETURNING id
                    `, [value, updatedBy, parameterName]);

                    if (result.rows.length === 0) {
                        throw new Error(`Parameter not found: ${parameterName}`);
                    }
                }

                logger.info(`Updated ${Object.keys(parameters).length} parameters by ${updatedBy || 'system'}`);
            });

            // Invalidate cache
            this.invalidateCache();

        } catch (error) {
            logger.error('Failed to set multiple parameters:', error);
            throw error;
        }
    }

    /**
     * Validate a parameter value
     * @param {string} parameterName - Name of the parameter
     * @param {number} value - Value to validate
     * @returns {Object} Validation result
     */
    validateParameter(parameterName, value) {
        const result = {
            isValid: true,
            errors: [],
            warnings: []
        };

        // Check if parameter is defined
        const definition = this.parameterDefinitions[parameterName];
        if (!definition) {
            result.isValid = false;
            result.errors.push(`Unknown parameter: ${parameterName}`);
            return result;
        }

        // Check if value is a number
        if (typeof value !== 'number' || isNaN(value)) {
            result.isValid = false;
            result.errors.push(`Value must be a number, got: ${typeof value}`);
            return result;
        }

        // Check range
        if (value < definition.minValue || value > definition.maxValue) {
            result.isValid = false;
            result.errors.push(`Value ${value} is outside valid range [${definition.minValue}, ${definition.maxValue}]`);
        }

        // Type-specific validations
        if (definition.type === 'probability' && (value < 0 || value > 1)) {
            result.isValid = false;
            result.errors.push(`Probability must be between 0 and 1, got: ${value}`);
        }

        // Warnings for extreme values
        if (definition.type === 'probability' && value < 0.001) {
            result.warnings.push(`Very low probability value: ${value}`);
        }

        if (definition.type === 'threshold' && (value < 0.1 || value > 0.9)) {
            result.warnings.push(`Extreme threshold value: ${value}`);
        }

        return result;
    }

    /**
     * Reset parameter to default value
     * @param {string} parameterName - Name of the parameter
     * @param {string} updatedBy - User ID who reset the parameter
     * @returns {Promise<void>}
     */
    async resetParameter(parameterName, updatedBy = null) {
        try {
            const definition = this.parameterDefinitions[parameterName];
            if (!definition) {
                throw new Error(`Unknown parameter: ${parameterName}`);
            }

            await this.setParameter(parameterName, definition.defaultValue, updatedBy);
            logger.info(`Parameter ${parameterName} reset to default value ${definition.defaultValue}`);

        } catch (error) {
            logger.error(`Failed to reset parameter ${parameterName}:`, error);
            throw error;
        }
    }

    /**
     * Reset all parameters to default values
     * @param {string} updatedBy - User ID who reset the parameters
     * @returns {Promise<void>}
     */
    async resetAllParameters(updatedBy = null) {
        try {
            const defaultParameters = {};
            
            for (const [parameterName, definition] of Object.entries(this.parameterDefinitions)) {
                defaultParameters[parameterName] = definition.defaultValue;
            }

            await this.setParameters(defaultParameters, updatedBy);
            logger.info('All parameters reset to default values');

        } catch (error) {
            logger.error('Failed to reset all parameters:', error);
            throw error;
        }
    }

    /**
     * Get parameter definitions and current values
     * @returns {Promise<Object>} Parameter definitions with current values
     */
    async getParameterDefinitions() {
        try {
            const currentParameters = await this.getAllParameters();
            const definitions = {};

            for (const [parameterName, definition] of Object.entries(this.parameterDefinitions)) {
                definitions[parameterName] = {
                    ...definition,
                    currentValue: currentParameters[parameterName]?.value || definition.defaultValue
                };
            }

            return definitions;

        } catch (error) {
            logger.error('Failed to get parameter definitions:', error);
            throw error;
        }
    }

    /**
     * Get parameter update history
     * @param {string} parameterName - Name of the parameter (optional)
     * @param {number} limit - Maximum number of records to return
     * @returns {Promise<Array>} Parameter update history
     */
    async getParameterHistory(parameterName = null, limit = 100) {
        try {
            let whereClause = '';
            let params = [limit];
            
            if (parameterName) {
                whereClause = 'WHERE parameter_name = $2';
                params.push(parameterName);
            }

            const result = await query(`
                SELECT 
                    parameter_name,
                    parameter_value,
                    updated_at,
                    updated_by,
                    u.username
                FROM system_parameters sp
                LEFT JOIN users u ON sp.updated_by = u.id
                ${whereClause}
                ORDER BY updated_at DESC
                LIMIT $1
            `, params);

            return result.rows.map(row => ({
                parameterName: row.parameter_name,
                value: parseFloat(row.parameter_value),
                updatedAt: row.updated_at,
                updatedBy: row.updated_by,
                updatedByUsername: row.username
            }));

        } catch (error) {
            logger.error('Failed to get parameter history:', error);
            throw error;
        }
    }

    /**
     * Invalidate parameter cache
     */
    invalidateCache() {
        this.cache.clear();
        logger.debug('System parameters cache invalidated');
    }

    /**
     * Initialize default parameters in the database
     * @returns {Promise<void>}
     */
    async initializeDefaults() {
        try {
            await transaction(async (client) => {
                for (const [parameterName, definition] of Object.entries(this.parameterDefinitions)) {
                    // Check if parameter already exists
                    const existingResult = await client.query(
                        'SELECT id FROM system_parameters WHERE parameter_name = $1',
                        [parameterName]
                    );

                    if (existingResult.rows.length === 0) {
                        // Insert default parameter
                        await client.query(`
                            INSERT INTO system_parameters (
                                parameter_key,
                                parameter_name, 
                                parameter_value, 
                                parameter_type, 
                                description,
                                valid_range_min,
                                valid_range_max,
                                updated_by
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        `, [
                            parameterName,
                            parameterName,
                            definition.defaultValue,
                            definition.type,
                            definition.description,
                            definition.minValue,
                            definition.maxValue,
                            null
                        ]);

                        logger.debug(`Initialized default parameter: ${parameterName} = ${definition.defaultValue}`);
                    }
                }
            });

            logger.info('System parameters initialized with defaults');
            this.invalidateCache();

        } catch (error) {
            logger.error('Failed to initialize default parameters:', error);
            throw error;
        }
    }

    /**
     * Get parameters formatted for Bayesian calculations
     * @returns {Promise<Object>} Parameters object for calculations
     */
    async getBayesianParameters() {
        try {
            const parameters = await this.getAllParameters();
            
            return {
                dropOutProbability: parameters.drop_out_probability?.value || 0.01,
                falseAlleleProbability: parameters.false_allele_probability?.value || 0.005,
                inbreedingCoefficient: parameters.inbreeding_coefficient?.value || 0.0,
                contaminationThreshold: parameters.contamination_threshold?.value || 0.1,
                degradationThreshold: parameters.degradation_threshold?.value || 0.7,
                duplicateProbabilityThreshold: parameters.duplicate_probability_threshold?.value || 0.95
            };

        } catch (error) {
            logger.error('Failed to get Bayesian parameters:', error);
            throw error;
        }
    }
}

module.exports = SystemParameters;