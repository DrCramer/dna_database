/**
 * Error Handler - Centralized error handling and logging system
 * 
 * Provides comprehensive error handling for the Bayesian analysis system:
 * - Error classification and categorization
 * - Logging and reporting
 * - Recovery strategies
 * - User-friendly error messages
 * 
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5 - Error handling and validation
 */

/**
 * Error types for classification
 */
export const ErrorTypes = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    DATA_ERROR: 'DATA_ERROR',
    CALCULATION_ERROR: 'CALCULATION_ERROR',
    SYSTEM_ERROR: 'SYSTEM_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    PERMISSION_ERROR: 'PERMISSION_ERROR',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
};

/**
 * Error severity levels
 */
export const ErrorSeverity = {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
};

/**
 * Custom error classes
 */
export class BayesianAnalysisError extends Error {
    constructor(message, type = ErrorTypes.SYSTEM_ERROR, severity = ErrorSeverity.MEDIUM, context = {}) {
        super(message);
        this.name = 'BayesianAnalysisError';
        this.type = type;
        this.severity = severity;
        this.context = context;
        this.timestamp = new Date();
        this.id = this._generateErrorId();
    }

    _generateErrorId() {
        return `err_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            message: this.message,
            type: this.type,
            severity: this.severity,
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

export class ValidationError extends BayesianAnalysisError {
    constructor(message, field = null, value = null, context = {}) {
        super(message, ErrorTypes.VALIDATION_ERROR, ErrorSeverity.MEDIUM, {
            field,
            value,
            ...context
        });
        this.name = 'ValidationError';
    }
}

export class DataError extends BayesianAnalysisError {
    constructor(message, dataType = null, context = {}) {
        super(message, ErrorTypes.DATA_ERROR, ErrorSeverity.HIGH, {
            dataType,
            ...context
        });
        this.name = 'DataError';
    }
}

export class CalculationError extends BayesianAnalysisError {
    constructor(message, calculation = null, context = {}) {
        super(message, ErrorTypes.CALCULATION_ERROR, ErrorSeverity.HIGH, {
            calculation,
            ...context
        });
        this.name = 'CalculationError';
    }
}

/**
 * Main error handler class
 */
class ErrorHandler {
    constructor(config = {}) {
        this.config = {
            enableLogging: true,
            enableReporting: true,
            maxLogSize: 1000,
            logLevel: 'INFO', // DEBUG, INFO, WARN, ERROR, CRITICAL
            enableRecovery: true,
            enableUserNotification: true,
            ...config
        };

        this.errorLog = [];
        this.errorStats = {
            total: 0,
            byType: {},
            bySeverity: {},
            recent: []
        };

        // Bind methods
        this.handleError = this.handleError.bind(this);
        this.validateSample = this.validateSample.bind(this);
        this.validatePopulationFrequencies = this.validatePopulationFrequencies.bind(this);
    }

    /**
     * Main error handling method
     * @param {Error} error - The error to handle
     * @param {Object} context - Additional context information
     * @returns {Object} Error handling result
     */
    handleError(error, context = {}) {
        try {
            // Classify error if not already classified
            const classifiedError = this._classifyError(error, context);
            
            // Log error
            this._logError(classifiedError, context);
            
            // Update statistics
            this._updateStats(classifiedError);
            
            // Attempt recovery if enabled
            const recoveryResult = this.config.enableRecovery ? 
                this._attemptRecovery(classifiedError, context) : null;
            
            // Generate user-friendly message
            const userMessage = this._generateUserMessage(classifiedError, context);
            
            // Report error if enabled
            if (this.config.enableReporting) {
                this._reportError(classifiedError, context);
            }

            return {
                error: classifiedError,
                userMessage,
                recovery: recoveryResult,
                handled: true,
                timestamp: new Date()
            };

        } catch (handlingError) {
            // Fallback error handling
            console.error('Error in error handler:', handlingError);
            return {
                error: error,
                userMessage: 'Произошла системная ошибка. Пожалуйста, попробуйте позже.',
                recovery: null,
                handled: false,
                timestamp: new Date()
            };
        }
    }

    /**
     * Validate genetic sample data
     * @param {Object} sample - Sample to validate
     * @throws {ValidationError} If validation fails
     */
    validateSample(sample) {
        if (!sample) {
            throw new ValidationError('Образец не может быть пустым', 'sample', null);
        }

        if (!sample.id || typeof sample.id !== 'string') {
            throw new ValidationError('Образец должен иметь корректный идентификатор', 'sample.id', sample.id);
        }

        if (!Array.isArray(sample.loci)) {
            throw new ValidationError('Образец должен содержать массив локусов', 'sample.loci', sample.loci);
        }

        if (sample.loci.length === 0) {
            throw new ValidationError('Образец должен содержать хотя бы один локус', 'sample.loci.length', sample.loci.length);
        }

        // Validate each locus
        sample.loci.forEach((locus, index) => {
            this._validateLocus(locus, `sample.loci[${index}]`);
        });

        // Validate metadata if present
        if (sample.metadata) {
            this._validateSampleMetadata(sample.metadata);
        }
    }

    /**
     * Validate population frequencies data
     * @param {Object} frequencies - Population frequencies to validate
     * @throws {ValidationError} If validation fails
     */
    validatePopulationFrequencies(frequencies) {
        if (!frequencies) {
            throw new ValidationError('Популяционные частоты не могут быть пустыми', 'frequencies', null);
        }

        if (typeof frequencies !== 'object') {
            throw new ValidationError('Популяционные частоты должны быть объектом', 'frequencies', frequencies);
        }

        // Validate each locus frequencies
        Object.entries(frequencies).forEach(([locusName, locusFreqs]) => {
            if (!locusFreqs || typeof locusFreqs !== 'object') {
                throw new ValidationError(
                    `Частоты для локуса ${locusName} должны быть объектом`,
                    `frequencies.${locusName}`,
                    locusFreqs
                );
            }

            // Validate allele frequencies
            Object.entries(locusFreqs).forEach(([allele, frequency]) => {
                if (typeof frequency !== 'number' || frequency < 0 || frequency > 1) {
                    throw new ValidationError(
                        `Частота аллеля ${allele} в локусе ${locusName} должна быть числом от 0 до 1`,
                        `frequencies.${locusName}.${allele}`,
                        frequency
                    );
                }
            });

            // Check if frequencies sum to approximately 1
            const sum = Object.values(locusFreqs).reduce((acc, freq) => acc + freq, 0);
            if (Math.abs(sum - 1.0) > 0.01) {
                throw new ValidationError(
                    `Сумма частот для локуса ${locusName} должна быть равна 1.0 (текущая: ${sum.toFixed(3)})`,
                    `frequencies.${locusName}`,
                    sum
                );
            }
        });
    }

    /**
     * Validate calculation parameters
     * @param {Object} params - Parameters to validate
     * @throws {ValidationError} If validation fails
     */
    validateCalculationParameters(params) {
        if (!params || typeof params !== 'object') {
            throw new ValidationError('Параметры расчета должны быть объектом', 'params', params);
        }

        // Validate theta (population structure parameter)
        if (params.theta !== undefined) {
            if (typeof params.theta !== 'number' || params.theta < 0 || params.theta > 1) {
                throw new ValidationError(
                    'Параметр theta должен быть числом от 0 до 1',
                    'params.theta',
                    params.theta
                );
            }
        }

        // Validate dropout probability
        if (params.dropoutProbability !== undefined) {
            if (typeof params.dropoutProbability !== 'number' || 
                params.dropoutProbability < 0 || params.dropoutProbability > 1) {
                throw new ValidationError(
                    'Вероятность выпадения должна быть числом от 0 до 1',
                    'params.dropoutProbability',
                    params.dropoutProbability
                );
            }
        }

        // Validate minimum allele frequency
        if (params.minAlleleFreq !== undefined) {
            if (typeof params.minAlleleFreq !== 'number' || 
                params.minAlleleFreq < 0 || params.minAlleleFreq > 0.1) {
                throw new ValidationError(
                    'Минимальная частота аллеля должна быть числом от 0 до 0.1',
                    'params.minAlleleFreq',
                    params.minAlleleFreq
                );
            }
        }
    }

    /**
     * Get error statistics
     * @returns {Object} Error statistics
     */
    getErrorStats() {
        return {
            ...this.errorStats,
            recentErrors: this.errorLog.slice(-10),
            logSize: this.errorLog.length
        };
    }

    /**
     * Clear error log
     */
    clearErrorLog() {
        this.errorLog = [];
        this.errorStats = {
            total: 0,
            byType: {},
            bySeverity: {},
            recent: []
        };
    }

    // Private methods

    /**
     * Classify error type and severity
     * @private
     */
    _classifyError(error, context) {
        if (error instanceof BayesianAnalysisError) {
            return error;
        }

        // Classify based on error message and context
        let type = ErrorTypes.SYSTEM_ERROR;
        let severity = ErrorSeverity.MEDIUM;

        const message = error.message.toLowerCase();

        if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
            type = ErrorTypes.VALIDATION_ERROR;
            severity = ErrorSeverity.LOW;
        } else if (message.includes('data') || message.includes('missing') || message.includes('empty')) {
            type = ErrorTypes.DATA_ERROR;
            severity = ErrorSeverity.MEDIUM;
        } else if (message.includes('calculation') || message.includes('math') || message.includes('divide')) {
            type = ErrorTypes.CALCULATION_ERROR;
            severity = ErrorSeverity.HIGH;
        } else if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
            type = ErrorTypes.NETWORK_ERROR;
            severity = ErrorSeverity.MEDIUM;
        } else if (message.includes('permission') || message.includes('access') || message.includes('unauthorized')) {
            type = ErrorTypes.PERMISSION_ERROR;
            severity = ErrorSeverity.HIGH;
        } else if (message.includes('config') || message.includes('setting')) {
            type = ErrorTypes.CONFIGURATION_ERROR;
            severity = ErrorSeverity.HIGH;
        }

        return new BayesianAnalysisError(error.message, type, severity, context);
    }

    /**
     * Log error to internal log
     * @private
     */
    _logError(error, context) {
        const logEntry = {
            ...error.toJSON(),
            context,
            handledAt: new Date()
        };

        this.errorLog.push(logEntry);

        // Maintain log size
        if (this.errorLog.length > this.config.maxLogSize) {
            this.errorLog = this.errorLog.slice(-Math.floor(this.config.maxLogSize * 0.8));
        }

        // Console logging based on severity
        if (this.config.enableLogging) {
            const logLevel = this._getLogLevel(error.severity);
            if (this._shouldLog(logLevel)) {
                console[logLevel.toLowerCase()](`[${error.id}] ${error.type}: ${error.message}`, context);
            }
        }
    }

    /**
     * Update error statistics
     * @private
     */
    _updateStats(error) {
        this.errorStats.total++;
        
        // Update by type
        this.errorStats.byType[error.type] = (this.errorStats.byType[error.type] || 0) + 1;
        
        // Update by severity
        this.errorStats.bySeverity[error.severity] = (this.errorStats.bySeverity[error.severity] || 0) + 1;
        
        // Update recent errors
        this.errorStats.recent.push({
            id: error.id,
            type: error.type,
            severity: error.severity,
            timestamp: error.timestamp
        });

        // Keep only recent 20 errors in stats
        if (this.errorStats.recent.length > 20) {
            this.errorStats.recent = this.errorStats.recent.slice(-20);
        }
    }

    /**
     * Attempt error recovery
     * @private
     */
    _attemptRecovery(error, context) {
        switch (error.type) {
            case ErrorTypes.DATA_ERROR:
                return this._recoverFromDataError(error, context);
            case ErrorTypes.CALCULATION_ERROR:
                return this._recoverFromCalculationError(error, context);
            case ErrorTypes.VALIDATION_ERROR:
                return this._recoverFromValidationError(error, context);
            default:
                return null;
        }
    }

    /**
     * Generate user-friendly error message
     * @private
     */
    _generateUserMessage(error, context) {
        const baseMessages = {
            [ErrorTypes.VALIDATION_ERROR]: 'Проверьте правильность введенных данных',
            [ErrorTypes.DATA_ERROR]: 'Проблема с данными образца',
            [ErrorTypes.CALCULATION_ERROR]: 'Ошибка при выполнении расчетов',
            [ErrorTypes.SYSTEM_ERROR]: 'Системная ошибка',
            [ErrorTypes.NETWORK_ERROR]: 'Проблема с сетевым соединением',
            [ErrorTypes.PERMISSION_ERROR]: 'Недостаточно прав доступа',
            [ErrorTypes.CONFIGURATION_ERROR]: 'Ошибка конфигурации системы'
        };

        const baseMessage = baseMessages[error.type] || 'Произошла неизвестная ошибка';
        
        // Add specific guidance based on error type
        let guidance = '';
        switch (error.type) {
            case ErrorTypes.VALIDATION_ERROR:
                guidance = ' Убедитесь, что все обязательные поля заполнены корректно.';
                break;
            case ErrorTypes.DATA_ERROR:
                guidance = ' Проверьте качество и формат данных образца.';
                break;
            case ErrorTypes.CALCULATION_ERROR:
                guidance = ' Попробуйте изменить параметры анализа или обратитесь к администратору.';
                break;
            case ErrorTypes.NETWORK_ERROR:
                guidance = ' Проверьте подключение к интернету и повторите попытку.';
                break;
        }

        return `${baseMessage}.${guidance}`;
    }

    /**
     * Report error to external systems
     * @private
     */
    _reportError(error, context) {
        // In a real application, this would send errors to monitoring systems
        // like Sentry, LogRocket, or custom error tracking
        if (error.severity === ErrorSeverity.CRITICAL || error.severity === ErrorSeverity.HIGH) {
            console.warn('High severity error reported:', error.toJSON());
        }
    }

    /**
     * Validate individual locus
     * @private
     */
    _validateLocus(locus, fieldPath) {
        if (!locus || typeof locus !== 'object') {
            throw new ValidationError(`Локус должен быть объектом`, fieldPath, locus);
        }

        if (!locus.name || typeof locus.name !== 'string') {
            throw new ValidationError(`Локус должен иметь название`, `${fieldPath}.name`, locus.name);
        }

        if (!Array.isArray(locus.alleles)) {
            throw new ValidationError(`Локус должен содержать массив аллелей`, `${fieldPath}.alleles`, locus.alleles);
        }

        if (locus.alleles.length === 0 || locus.alleles.length > 4) {
            throw new ValidationError(
                `Локус должен содержать от 1 до 4 аллелей`,
                `${fieldPath}.alleles.length`,
                locus.alleles.length
            );
        }

        // Validate alleles
        locus.alleles.forEach((allele, index) => {
            if (allele === null || allele === undefined) {
                return; // Allow null/undefined for missing alleles
            }
            if (typeof allele !== 'string' && typeof allele !== 'number') {
                throw new ValidationError(
                    `Аллель должен быть строкой или числом`,
                    `${fieldPath}.alleles[${index}]`,
                    allele
                );
            }
        });
    }

    /**
     * Validate sample metadata
     * @private
     */
    _validateSampleMetadata(metadata) {
        if (typeof metadata !== 'object') {
            throw new ValidationError('Метаданные образца должны быть объектом', 'metadata', metadata);
        }

        // Validate collection date if present
        if (metadata.collectionDate && !(metadata.collectionDate instanceof Date) && 
            typeof metadata.collectionDate !== 'string') {
            throw new ValidationError(
                'Дата сбора должна быть объектом Date или строкой',
                'metadata.collectionDate',
                metadata.collectionDate
            );
        }

        // Validate quality score if present
        if (metadata.qualityScore !== undefined) {
            if (typeof metadata.qualityScore !== 'number' || 
                metadata.qualityScore < 0 || metadata.qualityScore > 1) {
                throw new ValidationError(
                    'Оценка качества должна быть числом от 0 до 1',
                    'metadata.qualityScore',
                    metadata.qualityScore
                );
            }
        }
    }

    /**
     * Recovery strategies for different error types
     * @private
     */
    _recoverFromDataError(error, context) {
        return {
            strategy: 'data_cleanup',
            suggestions: [
                'Проверить формат данных',
                'Удалить некорректные записи',
                'Использовать значения по умолчанию'
            ]
        };
    }

    _recoverFromCalculationError(error, context) {
        return {
            strategy: 'calculation_fallback',
            suggestions: [
                'Использовать альтернативный метод расчета',
                'Применить консервативные оценки',
                'Исключить проблемные локусы'
            ]
        };
    }

    _recoverFromValidationError(error, context) {
        return {
            strategy: 'validation_guidance',
            suggestions: [
                'Проверить обязательные поля',
                'Исправить формат данных',
                'Использовать примеры корректных данных'
            ]
        };
    }

    /**
     * Get log level for severity
     * @private
     */
    _getLogLevel(severity) {
        switch (severity) {
            case ErrorSeverity.LOW: return 'INFO';
            case ErrorSeverity.MEDIUM: return 'WARN';
            case ErrorSeverity.HIGH: return 'ERROR';
            case ErrorSeverity.CRITICAL: return 'ERROR';
            default: return 'INFO';
        }
    }

    /**
     * Check if should log based on configuration
     * @private
     */
    _shouldLog(level) {
        const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];
        const configLevel = levels.indexOf(this.config.logLevel);
        const messageLevel = levels.indexOf(level);
        return messageLevel >= configLevel;
    }
}

export default ErrorHandler;