const { transaction, serializableTransaction, query } = require('../config/database');
const { logger } = require('../utils/logger');

class ConcurrencyService {
    constructor() {
        this.lockRegistry = new Map();
        this.operationQueue = new Map();
        this.maxConcurrentOperations = parseInt(process.env.MAX_CONCURRENT_OPERATIONS) || 10;
        this.lockTimeout = parseInt(process.env.LOCK_TIMEOUT) || 30000; // 30 seconds
    }

    // Distributed lock implementation using PostgreSQL advisory locks
    async acquireDistributedLock(lockKey, timeout = this.lockTimeout) {
        const lockId = this.hashString(lockKey);
        
        try {
            logger.debug(`Attempting to acquire lock: ${lockKey} (${lockId})`);
            
            const result = await query(
                'SELECT pg_try_advisory_lock($1) as acquired',
                [lockId]
            );
            
            if (result.rows[0].acquired) {
                logger.debug(`Lock acquired: ${lockKey}`);
                
                // Set timeout to automatically release lock
                setTimeout(async () => {
                    try {
                        await this.releaseDistributedLock(lockKey);
                        logger.warn(`Lock auto-released due to timeout: ${lockKey}`);
                    } catch (error) {
                        logger.error(`Failed to auto-release lock ${lockKey}:`, error);
                    }
                }, timeout);
                
                return true;
            } else {
                logger.debug(`Lock not available: ${lockKey}`);
                return false;
            }
        } catch (error) {
            logger.error(`Failed to acquire lock ${lockKey}:`, error);
            throw error;
        }
    }

    async releaseDistributedLock(lockKey) {
        const lockId = this.hashString(lockKey);
        
        try {
            await query('SELECT pg_advisory_unlock($1)', [lockId]);
            logger.debug(`Lock released: ${lockKey}`);
        } catch (error) {
            logger.error(`Failed to release lock ${lockKey}:`, error);
            throw error;
        }
    }

    // Execute operation with distributed lock
    async withDistributedLock(lockKey, operation, timeout = this.lockTimeout) {
        const acquired = await this.acquireDistributedLock(lockKey, timeout);
        
        if (!acquired) {
            throw new Error(`Could not acquire lock: ${lockKey}`);
        }
        
        try {
            return await operation();
        } finally {
            await this.releaseDistributedLock(lockKey);
        }
    }

    // Concurrent DNA profile comparison with proper locking and department isolation
    async concurrentProfileComparison(profileId1, profileId2, comparisonFunction, departmentId = null) {
        // Create a consistent lock key regardless of parameter order
        const lockKey = `profile_comparison_${[profileId1, profileId2].sort().join('_')}`;
        
        return this.withDistributedLock(lockKey, async () => {
            // Check if comparison already exists
            let existingQuery = `
                SELECT id, overall_match_percentage, locus_matches, analysis_date
                FROM match_results 
                WHERE (profile_id_1 = $1 AND profile_id_2 = $2) 
                   OR (profile_id_1 = $2 AND profile_id_2 = $1)
            `;
            
            let queryParams = [profileId1, profileId2];
            
            // Add department isolation if specified
            if (departmentId) {
                existingQuery += `
                    AND EXISTS (
                        SELECT 1 FROM dna_profiles dp1 
                        WHERE dp1.id = match_results.profile_id_1 
                        AND dp1.department_id = $3
                    )
                    AND EXISTS (
                        SELECT 1 FROM dna_profiles dp2 
                        WHERE dp2.id = match_results.profile_id_2 
                        AND dp2.department_id = $3
                    )
                `;
                queryParams.push(departmentId);
            }
            
            const existingResult = await query(existingQuery, queryParams);
            
            if (existingResult.rows.length > 0) {
                logger.debug(`Using cached comparison result for profiles ${profileId1} and ${profileId2}`);
                return existingResult.rows[0];
            }
            
            // Perform comparison
            logger.debug(`Performing new comparison for profiles ${profileId1} and ${profileId2}`);
            return await comparisonFunction();
        });
    }

    // Concurrent master array operations with department isolation
    async concurrentMasterArrayOperation(departmentId, operationType, operation) {
        const lockKey = `master_array_${departmentId}_${operationType}`;
        
        return this.withDistributedLock(lockKey, async () => {
            // Verify department access before operation
            const deptResult = await query(
                'SELECT id, master_array_id FROM departments WHERE id = $1 AND is_active = true',
                [departmentId]
            );
            
            if (deptResult.rows.length === 0) {
                throw new Error(`Department ${departmentId} not found or inactive`);
            }
            
            return await operation(deptResult.rows[0]);
        });
    }

    // Concurrent task assignment with expert group coordination
    async concurrentTaskAssignment(taskId, assigneeType, assigneeId, assignerId) {
        const lockKey = `task_assignment_${taskId}`;
        
        return this.withDistributedLock(lockKey, async () => {
            // Check current task status
            const taskResult = await query(`
                SELECT id, status, assigned_to_user, assigned_to_group, department_id
                FROM tasks 
                WHERE id = $1 AND is_active = true
            `, [taskId]);
            
            if (taskResult.rows.length === 0) {
                throw new Error(`Task ${taskId} not found or inactive`);
            }
            
            const task = taskResult.rows[0];
            
            if (task.status !== 'assigned' && task.assigned_to_user && task.assigned_to_group) {
                throw new Error(`Task ${taskId} is already assigned and in progress`);
            }
            
            // Verify assigner has permission for this department
            const assignerResult = await query(`
                SELECT role, department_id 
                FROM users 
                WHERE id = $1 AND is_active = true
            `, [assignerId]);
            
            if (assignerResult.rows.length === 0) {
                throw new Error('Assigner not found or inactive');
            }
            
            const assigner = assignerResult.rows[0];
            
            if (assigner.role !== 'system_administrator' && 
                assigner.role !== 'department_head' && 
                assigner.department_id !== task.department_id) {
                throw new Error('Insufficient permissions to assign this task');
            }
            
            // Perform the assignment
            if (assigneeType === 'user') {
                await query(`
                    UPDATE tasks 
                    SET assigned_to_user = $1, assigned_to_group = NULL, started_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                `, [assigneeId, taskId]);
            } else if (assigneeType === 'group') {
                await query(`
                    UPDATE tasks 
                    SET assigned_to_group = $1, assigned_to_user = NULL, started_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                `, [assigneeId, taskId]);
            }
            
            return { taskId, assigneeType, assigneeId, status: 'assigned' };
        });
    }

    // Concurrent file upload handling
    async concurrentFileUpload(userId, filename, uploadFunction) {
        const lockKey = `file_upload_${userId}_${filename}`;
        
        return this.withDistributedLock(lockKey, async () => {
            // Check for duplicate upload
            const existingUpload = await query(`
                SELECT id, processing_status 
                FROM file_uploads 
                WHERE user_id = $1 AND original_filename = $2 
                AND processing_status IN ('pending', 'processing')
            `, [userId, filename]);
            
            if (existingUpload.rows.length > 0) {
                throw new Error(`File ${filename} is already being processed`);
            }
            
            return await uploadFunction();
        });
    }

    // Bulk operation with concurrency control
    async bulkOperationWithConcurrency(operations, concurrencyLimit = 5) {
        const results = [];
        const executing = [];
        
        for (const operation of operations) {
            // Wait if we've reached the concurrency limit
            if (executing.length >= concurrencyLimit) {
                const completed = await Promise.race(executing);
                const index = executing.indexOf(completed);
                executing.splice(index, 1);
                results.push(await completed);
            }
            
            // Start new operation
            const promise = this.executeWithRetry(operation);
            executing.push(promise);
        }
        
        // Wait for remaining operations
        const remaining = await Promise.all(executing);
        results.push(...remaining);
        
        return results;
    }

    // Execute operation with retry logic for concurrent access conflicts
    async executeWithRetry(operation, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                if (this.isConcurrencyError(error) && attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    logger.warn(`Concurrency conflict, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
                    await this.sleep(delay);
                    continue;
                }
                throw error;
            }
        }
    }

    // Transaction with optimistic locking
    async optimisticTransaction(callback, versionColumn = 'updated_at') {
        return serializableTransaction(async (client) => {
            try {
                return await callback(client);
            } catch (error) {
                if (error.code === '40001') { // serialization_failure
                    logger.warn('Optimistic locking conflict detected, transaction will be retried');
                }
                throw error;
            }
        });
    }

    // Queue management for resource-intensive operations
    async queueOperation(queueName, operation, priority = 0) {
        if (!this.operationQueue.has(queueName)) {
            this.operationQueue.set(queueName, []);
        }
        
        const queue = this.operationQueue.get(queueName);
        
        return new Promise((resolve, reject) => {
            queue.push({
                operation,
                priority,
                resolve,
                reject,
                timestamp: Date.now()
            });
            
            // Sort by priority (higher first) and timestamp (older first)
            queue.sort((a, b) => {
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                return a.timestamp - b.timestamp;
            });
            
            this.processQueue(queueName);
        });
    }

    async processQueue(queueName) {
        const queue = this.operationQueue.get(queueName);
        if (!queue || queue.length === 0) {
            return;
        }
        
        const activeOperations = queue.filter(op => op.processing);
        if (activeOperations.length >= this.maxConcurrentOperations) {
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
            
            // Process next operation
            setImmediate(() => this.processQueue(queueName));
        }
    }

    // Utility methods
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    isConcurrencyError(error) {
        const concurrencyErrorCodes = [
            '40001', // serialization_failure
            '40P01', // deadlock_detected
            '23505', // unique_violation (in some concurrent scenarios)
        ];
        
        return concurrencyErrorCodes.includes(error.code) ||
               error.message.includes('deadlock') ||
               error.message.includes('serialization failure');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Get concurrency statistics
    getConcurrencyStats() {
        const queueStats = {};
        
        for (const [queueName, queue] of this.operationQueue) {
            queueStats[queueName] = {
                total: queue.length,
                processing: queue.filter(op => op.processing).length,
                waiting: queue.filter(op => !op.processing).length
            };
        }
        
        return {
            activeQueues: this.operationQueue.size,
            queueStats,
            maxConcurrentOperations: this.maxConcurrentOperations,
            lockTimeout: this.lockTimeout
        };
    }

    // Cleanup expired operations
    cleanup() {
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5 minutes
        
        for (const [queueName, queue] of this.operationQueue) {
            const expiredOperations = queue.filter(op => 
                !op.processing && (now - op.timestamp) > maxAge
            );
            
            expiredOperations.forEach(op => {
                op.reject(new Error('Operation expired'));
                const index = queue.indexOf(op);
                if (index > -1) {
                    queue.splice(index, 1);
                }
            });
            
            if (queue.length === 0) {
                this.operationQueue.delete(queueName);
            }
        }
    }
}

module.exports = new ConcurrencyService();