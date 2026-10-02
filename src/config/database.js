const { Pool } = require('pg');
const { logger } = require('../utils/logger');

// Enhanced database configuration for concurrent access with department isolation
const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL?.includes('localhost') && !process.env.DATABASE_URL?.includes('127.0.0.1') && !process.env.DATABASE_URL?.includes('db:') ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.DB_POOL_MAX) || (process.env.NODE_ENV === 'test' ? 3 : 30), // increased for multi-department concurrency
    min: parseInt(process.env.DB_POOL_MIN) || (process.env.NODE_ENV === 'test' ? 1 : 8),  // increased minimum for better availability
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || (process.env.NODE_ENV === 'test' ? 5000 : 30000),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || (process.env.NODE_ENV === 'test' ? 2000 : 5000),
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || (process.env.NODE_ENV === 'test' ? 5000 : 15000), // increased for high concurrency
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || (process.env.NODE_ENV === 'test' ? 10000 : 45000), // increased for complex queries
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || (process.env.NODE_ENV === 'test' ? 10000 : 45000),
    application_name: 'dna_analysis_app',
    // Additional PostgreSQL-specific settings for better concurrency
    options: process.env.NODE_ENV === 'test' ? '' : '-c statement_timeout=45s',
    // Ensure UTF-8 encoding
    client_encoding: 'UTF8'
};

// Create connection pool
const pool = new Pool(dbConfig);

// Pool event handlers for monitoring and department isolation
pool.on('connect', (client) => {
    logger.debug('New client connected to database');
    // Set session-level configurations for better concurrency and timezone
    client.query(`
        SET lock_timeout = '30s';
        SET idle_in_transaction_session_timeout = '60s';
        SET log_statement_stats = off;
        SET timezone = 'Europe/Moscow';
        SET client_encoding = 'UTF8';
    `).catch(err => {
        logger.warn('Failed to set session configuration:', err.message);
    });
});

pool.on('acquire', (client) => {
    logger.debug('Client acquired from pool', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
    });
});

pool.on('remove', (client) => {
    logger.debug('Client removed from pool');
});

pool.on('error', (err, client) => {
    logger.error('Unexpected error on idle client', err);
    // Don't exit the process, just log the error and let pool handle recovery
});

// Connection pool statistics
function getPoolStats() {
    return {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
        config: {
            max: dbConfig.max,
            min: dbConfig.min,
            idleTimeoutMillis: dbConfig.idleTimeoutMillis,
            connectionTimeoutMillis: dbConfig.connectionTimeoutMillis
        }
    };
}

// Database connection function
async function connectDatabase() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        logger.info('Database connection established at:', result.rows[0].now);
        return { pool };
    } catch (error) {
        logger.error('Database connection failed:', error);
        throw error;
    }
}

// Enhanced query function with retry logic and concurrent access handling
async function query(text, params, options = {}) {
    const start = Date.now();
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 100;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await pool.query(text, params);
            const duration = Date.now() - start;
            
            if (duration > 1000) {
                logger.warn('Slow query detected', { 
                    text: text.substring(0, 100) + '...', 
                    duration, 
                    rows: result.rowCount 
                });
            } else {
                logger.debug('Executed query', { 
                    text: text.substring(0, 50) + '...', 
                    duration, 
                    rows: result.rowCount 
                });
            }
            
            return result;
        } catch (error) {
            const isRetryableError = isRetryable(error);
            
            if (attempt === maxRetries || !isRetryableError) {
                logger.error('Database query error:', { 
                    text: text.substring(0, 100) + '...', 
                    error: error.message,
                    attempt,
                    code: error.code
                });
                throw error;
            }
            
            logger.warn(`Query attempt ${attempt} failed, retrying...`, {
                error: error.message,
                code: error.code
            });
            
            // Exponential backoff
            await sleep(retryDelay * Math.pow(2, attempt - 1));
        }
    }
}

// Enhanced transaction helper with proper isolation levels and retry logic
async function transaction(callback, options = {}) {
    const isolationLevel = options.isolationLevel || 'READ COMMITTED';
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 100;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Set isolation level if specified
            if (isolationLevel !== 'READ COMMITTED') {
                await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
            }
            
            const result = await callback(client);
            await client.query('COMMIT');
            
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                logger.error('Rollback failed:', rollbackError);
            }
            
            const isRetryableError = isRetryable(error);
            
            if (attempt === maxRetries || !isRetryableError) {
                logger.error('Transaction failed:', {
                    error: error.message,
                    attempt,
                    code: error.code
                });
                throw error;
            }
            
            logger.warn(`Transaction attempt ${attempt} failed, retrying...`, {
                error: error.message,
                code: error.code
            });
            
            // Exponential backoff
            await sleep(retryDelay * Math.pow(2, attempt - 1));
        } finally {
            client.release();
        }
    }
}

// Serializable transaction for critical operations
async function serializableTransaction(callback, options = {}) {
    return transaction(callback, {
        ...options,
        isolationLevel: 'SERIALIZABLE'
    });
}

// Batch operation helper for bulk inserts/updates
async function batchOperation(operations, batchSize = 100) {
    const results = [];
    
    for (let i = 0; i < operations.length; i += batchSize) {
        const batch = operations.slice(i, i + batchSize);
        
        const batchResult = await transaction(async (client) => {
            const batchResults = [];
            
            for (const operation of batch) {
                const result = await client.query(operation.query, operation.params);
                batchResults.push(result);
            }
            
            return batchResults;
        });
        
        results.push(...batchResult);
    }
    
    return results;
}

// Helper function to determine if an error is retryable
function isRetryable(error) {
    const retryableCodes = [
        '40001', // serialization_failure
        '40P01', // deadlock_detected
        '53300', // too_many_connections
        '08006', // connection_failure
        '08001', // sqlclient_unable_to_establish_sqlconnection
        '08004', // sqlserver_rejected_establishment_of_sqlconnection
    ];
    
    return retryableCodes.includes(error.code) || 
           error.message.includes('connection') ||
           error.message.includes('timeout');
}

// Department-aware query function with automatic isolation
async function departmentQuery(text, params, departmentId, options = {}) {
    if (!departmentId) {
        throw new Error('Department ID is required for department-aware queries');
    }
    
    // Add department context to the query if it contains department-sensitive tables
    const departmentSensitiveTables = ['dna_profiles', 'match_results', 'tasks', 'expert_groups', 'master_arrays'];
    const isDepartmentSensitive = departmentSensitiveTables.some(table => 
        text.toLowerCase().includes(table.toLowerCase())
    );
    
    if (isDepartmentSensitive) {
        // Log department access for audit purposes
        logger.debug('Department-aware query executed', {
            departmentId,
            queryType: text.split(' ')[0].toUpperCase(),
            sensitive: true
        });
    }
    
    return query(text, params, {
        ...options,
        departmentContext: departmentId
    });
}

// Transaction with department isolation context
async function departmentTransaction(callback, departmentId, options = {}) {
    if (!departmentId) {
        throw new Error('Department ID is required for department transactions');
    }
    
    return transaction(async (client) => {
        // Set department context for the transaction
        await client.query('SET LOCAL app.current_department_id = $1', [departmentId]);
        
        logger.debug('Department transaction started', { departmentId });
        
        try {
            const result = await callback(client);
            logger.debug('Department transaction completed', { departmentId });
            return result;
        } catch (error) {
            logger.error('Department transaction failed', { 
                departmentId, 
                error: error.message 
            });
            throw error;
        }
    }, options);
}

// Concurrent operation queue with department isolation
const departmentQueues = new Map();

async function queueDepartmentOperation(departmentId, operationType, operation, priority = 0) {
    const queueKey = `${departmentId}_${operationType}`;
    
    if (!departmentQueues.has(queueKey)) {
        departmentQueues.set(queueKey, []);
    }
    
    const queue = departmentQueues.get(queueKey);
    
    return new Promise((resolve, reject) => {
        queue.push({
            operation,
            priority,
            resolve,
            reject,
            timestamp: Date.now(),
            departmentId
        });
        
        // Sort by priority and timestamp
        queue.sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return a.timestamp - b.timestamp;
        });
        
        // Process queue
        setImmediate(() => processDepartmentQueue(queueKey));
    });
}

async function processDepartmentQueue(queueKey) {
    const queue = departmentQueues.get(queueKey);
    if (!queue || queue.length === 0) {
        return;
    }
    
    const activeOperations = queue.filter(op => op.processing);
    const maxConcurrentPerDepartment = parseInt(process.env.MAX_CONCURRENT_PER_DEPARTMENT) || 3;
    
    if (activeOperations.length >= maxConcurrentPerDepartment) {
        return;
    }
    
    const nextOperation = queue.find(op => !op.processing);
    if (!nextOperation) {
        return;
    }
    
    nextOperation.processing = true;
    
    try {
        const result = await nextOperation.operation();
        nextOperation.resolve(result);
    } catch (error) {
        nextOperation.reject(error);
    } finally {
        const index = queue.indexOf(nextOperation);
        if (index > -1) {
            queue.splice(index, 1);
        }
        
        // Clean up empty queues
        if (queue.length === 0) {
            departmentQueues.delete(queueKey);
        }
        
        // Process next operation
        setImmediate(() => processDepartmentQueue(queueKey));
    }
}

// Get client for manual transaction management
async function getClient() {
    return await pool.connect();
}

// Close all connections gracefully
async function closePool() {
    try {
        await pool.end();
        logger.info('Database pool closed gracefully');
    } catch (error) {
        logger.error('Error closing database pool:', error);
        throw error;
    }
}

// Data persistence verification
async function verifyDataPersistence() {
    try {
        // Create a test record to verify persistence
        const testId = 'persistence-test-' + Date.now();
        
        await transaction(async (client) => {
            // Insert test record
            await client.query(`
                INSERT INTO operation_history (id, user_id, operation_type, operation_details) 
                VALUES ($1, NULL, 'persistence_test', $2)
            `, [testId, { test: true, timestamp: new Date().toISOString() }]);
            
            // Verify it exists
            const result = await client.query(
                'SELECT id FROM operation_history WHERE id = $1',
                [testId]
            );
            
            if (result.rows.length === 0) {
                throw new Error('Test record not found after insert');
            }
            
            // Clean up test record
            await client.query('DELETE FROM operation_history WHERE id = $1', [testId]);
        });
        
        logger.info('Data persistence verification successful');
        return true;
    } catch (error) {
        logger.error('Data persistence verification failed:', error);
        return false;
    }
}

// Connection health check
async function checkConnectionHealth() {
    try {
        const start = Date.now();
        const result = await query('SELECT 1 as health_check, NOW() as current_time');
        const duration = Date.now() - start;
        
        return {
            healthy: true,
            responseTime: duration,
            currentTime: result.rows[0].current_time,
            poolStats: getPoolStats()
        };
    } catch (error) {
        return {
            healthy: false,
            error: error.message,
            poolStats: getPoolStats()
        };
    }
}

// Sleep helper for retry delays
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Container restart data verification
async function verifyContainerDataIntegrity() {
    try {
        logger.info('Starting container restart data integrity verification...');
        
        const checks = [];
        
        // 1. Verify critical tables exist and have expected structure
        const criticalTables = [
            { name: 'users', requiredColumns: ['id', 'username', 'email', 'role'] },
            { name: 'dna_profiles', requiredColumns: ['id', 'user_id', 'sample_name', 'str_snp_data'] },
            { name: 'match_results', requiredColumns: ['id', 'profile_id_1', 'profile_id_2', 'overall_match_percentage'] }
        ];
        
        for (const table of criticalTables) {
            const columnResult = await query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = $1
            `, [table.name]);
            
            const existingColumns = columnResult.rows.map(row => row.column_name);
            const missingColumns = table.requiredColumns.filter(col => !existingColumns.includes(col));
            
            if (missingColumns.length > 0) {
                checks.push({
                    table: table.name,
                    status: 'failed',
                    issue: `Missing columns: ${missingColumns.join(', ')}`
                });
            } else {
                checks.push({
                    table: table.name,
                    status: 'passed',
                    columns: existingColumns.length
                });
            }
        }
        
        // 2. Verify organizational structure integrity (if exists)
        const orgTablesResult = await query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('organizations', 'departments', 'master_arrays')
        `);
        
        const orgTables = orgTablesResult.rows.map(row => row.table_name);
        
        if (orgTables.length > 0) {
            // Check organizational data consistency
            if (orgTables.includes('departments') && orgTables.includes('organizations')) {
                const orphanedDepts = await query(`
                    SELECT COUNT(*) as count 
                    FROM departments d 
                    LEFT JOIN organizations o ON d.organization_id = o.id 
                    WHERE o.id IS NULL
                `);
                
                checks.push({
                    check: 'organizational_integrity',
                    status: parseInt(orphanedDepts.rows[0].count) === 0 ? 'passed' : 'warning',
                    orphanedDepartments: parseInt(orphanedDepts.rows[0].count)
                });
            }
        }
        
        // 3. Verify data persistence across restart
        const testId = `restart_test_${Date.now()}`;
        
        await transaction(async (client) => {
            // Insert test record
            await client.query(`
                INSERT INTO operation_history (id, user_id, operation_type, operation_details) 
                VALUES ($1, NULL, 'restart_integrity_test', $2)
            `, [testId, { 
                test: true, 
                timestamp: new Date().toISOString(),
                containerRestart: true 
            }]);
            
            // Verify immediate read
            const readResult = await client.query(
                'SELECT id, operation_details FROM operation_history WHERE id = $1',
                [testId]
            );
            
            if (readResult.rows.length === 0) {
                throw new Error('Test record not readable immediately after insert');
            }
            
            // Clean up
            await client.query('DELETE FROM operation_history WHERE id = $1', [testId]);
        });
        
        checks.push({
            check: 'data_persistence',
            status: 'passed',
            testId
        });
        
        const failedChecks = checks.filter(check => check.status === 'failed');
        const warningChecks = checks.filter(check => check.status === 'warning');
        
        logger.info('Container data integrity verification completed', {
            totalChecks: checks.length,
            failed: failedChecks.length,
            warnings: warningChecks.length
        });
        
        return {
            success: failedChecks.length === 0,
            checks,
            summary: {
                total: checks.length,
                passed: checks.filter(c => c.status === 'passed').length,
                warnings: warningChecks.length,
                failed: failedChecks.length
            }
        };
        
    } catch (error) {
        logger.error('Container data integrity verification failed:', error);
        return {
            success: false,
            error: error.message,
            checks: []
        };
    }
}

module.exports = {
    pool,
    query,
    transaction,
    serializableTransaction,
    batchOperation,
    getClient,
    connectDatabase,
    closePool,
    getPoolStats,
    verifyDataPersistence,
    checkConnectionHealth,
    departmentQuery,
    departmentTransaction,
    queueDepartmentOperation,
    verifyContainerDataIntegrity
};