const { query, transaction } = require('../config/database');
const { securityConfig } = require('../config/security');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

/**
 * Database Encryption Service for Sensitive Genetic Data
 * Implements task 13.1 requirement for database encryption
 * Provides comprehensive encryption for genetic data at rest
 */
class DatabaseEncryptionService {
    constructor() {
        this.encryptionConfig = securityConfig;
        
        // Encryption algorithms and settings
        this.algorithms = {
            'aes-256-cbc': {
                keyLength: 32,
                ivLength: 16,
                algorithm: 'aes-256-cbc'
            },
            'aes-256-gcm': {
                keyLength: 32,
                ivLength: 12,
                algorithm: 'aes-256-gcm'
            }
        };
        
        // Tables and columns that require encryption
        this.encryptionMap = {
            'dna_profiles': ['str_data', 'sample_name', 'notes'],
            'master_array_profiles': ['str_data', 'sample_name', 'metadata'],
            'match_results': ['locus_matches'],
            'tasks': ['target_sample'],
            'task_results': ['result_data', 'analysis_metadata'],
            'users': ['email', 'personal_info'],
            'task_comments': ['comment']
        };
        
        // Initialize encryption monitoring
        this.initializeEncryptionMonitoring();
    }

    /**
     * Initialize encryption monitoring and key rotation
     */
    async initializeEncryptionMonitoring() {
        try {
            // Check for key rotation needs every hour
            setInterval(async () => {
                await this.checkKeyRotationNeeds();
            }, 60 * 60 * 1000);

            logger.info('Database encryption monitoring initialized');
        } catch (error) {
            logger.error('Failed to initialize encryption monitoring:', error);
        }
    }

    /**
     * Encrypt sensitive data for database storage
     * @param {string} plaintext - Data to encrypt
     * @param {string} algorithm - Encryption algorithm to use
     * @returns {string} Encrypted data with metadata
     */
    encryptData(plaintext, algorithm = 'aes-256-cbc') {
        try {
            if (!plaintext || plaintext.trim() === '') {
                return null;
            }

            const config = this.algorithms[algorithm];
            if (!config) {
                throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
            }

            const key = this.encryptionConfig.encryptionKey;
            const iv = crypto.randomBytes(config.ivLength);
            
            let encrypted;
            let authTag = null;

            if (algorithm === 'aes-256-gcm') {
                const cipher = crypto.createCipheriv(algorithm, key, iv);
                encrypted = Buffer.concat([
                    cipher.update(plaintext, 'utf8'),
                    cipher.final()
                ]);
                authTag = cipher.getAuthTag();
            } else {
                const cipher = crypto.createCipheriv(algorithm, key, iv);
                encrypted = Buffer.concat([
                    cipher.update(plaintext, 'utf8'),
                    cipher.final()
                ]);
            }

            // Create encrypted data package with metadata
            const encryptedPackage = {
                algorithm,
                iv: iv.toString('base64'),
                data: encrypted.toString('base64'),
                authTag: authTag ? authTag.toString('base64') : null,
                version: 1,
                timestamp: new Date().toISOString()
            };

            return JSON.stringify(encryptedPackage);
        } catch (error) {
            logger.error('Data encryption failed:', error);
            throw new Error('Database encryption failed');
        }
    }

    /**
     * Decrypt sensitive data from database
     * @param {string} encryptedData - Encrypted data package
     * @returns {string} Decrypted plaintext
     */
    decryptData(encryptedData) {
        try {
            if (!encryptedData) {
                return null;
            }

            const encryptedPackage = JSON.parse(encryptedData);
            const { algorithm, iv, data, authTag, version } = encryptedPackage;

            const config = this.algorithms[algorithm];
            if (!config) {
                throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
            }

            const key = this.encryptionConfig.encryptionKey;
            const ivBuffer = Buffer.from(iv, 'base64');
            const encryptedBuffer = Buffer.from(data, 'base64');

            let decrypted;

            if (algorithm === 'aes-256-gcm') {
                const decipher = crypto.createDecipheriv(algorithm, key, ivBuffer);
                if (authTag) {
                    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
                }
                decrypted = Buffer.concat([
                    decipher.update(encryptedBuffer),
                    decipher.final()
                ]);
            } else {
                const decipher = crypto.createDecipheriv(algorithm, key, ivBuffer);
                decrypted = Buffer.concat([
                    decipher.update(encryptedBuffer),
                    decipher.final()
                ]);
            }

            return decrypted.toString('utf8');
        } catch (error) {
            logger.error('Data decryption failed:', error);
            throw new Error('Database decryption failed');
        }
    }

    /**
     * Encrypt genetic profile data
     * @param {Object} profileData - DNA profile data
     * @param {string} userId - User performing the operation
     * @returns {Object} Encrypted profile data
     */
    async encryptGeneticProfile(profileData, userId = null) {
        try {
            if (!profileData) {
                return null;
            }

            const encryptedProfile = { ...profileData };
            const recordId = profileData.id || crypto.randomUUID();

            // Encrypt STR data (most sensitive)
            if (profileData.str_data) {
                encryptedProfile.str_data_encrypted = this.encryptData(
                    JSON.stringify(profileData.str_data),
                    'aes-256-gcm' // Use GCM for genetic data for additional integrity
                );
                encryptedProfile.str_data = null; // Clear plaintext
            }

            // Encrypt sample name
            if (profileData.sample_name && profileData.sample_name.trim()) {
                encryptedProfile.sample_name_encrypted = this.encryptData(
                    profileData.sample_name
                );
                encryptedProfile.sample_name = null; // Clear plaintext
            }

            // Encrypt notes if present
            if (profileData.notes && profileData.notes.trim()) {
                encryptedProfile.notes_encrypted = this.encryptData(
                    profileData.notes
                );
                encryptedProfile.notes = null; // Clear plaintext
            }

            // Set encryption metadata
            encryptedProfile.encryption_version = 1;
            encryptedProfile.encrypted_at = new Date();

            // Log encryption operation
            await this.logEncryptionOperation(
                'dna_profiles',
                recordId,
                'encrypt',
                1,
                userId,
                true
            );

            logger.debug('Genetic profile encrypted successfully', { recordId });
            return encryptedProfile;
        } catch (error) {
            logger.error('Failed to encrypt genetic profile:', error);
            
            // Log failed encryption
            if (profileData.id) {
                await this.logEncryptionOperation(
                    'dna_profiles',
                    profileData.id,
                    'encrypt',
                    1,
                    userId,
                    false,
                    error.message
                );
            }
            
            throw error;
        }
    }

    /**
     * Decrypt genetic profile data
     * @param {Object} encryptedProfile - Encrypted DNA profile data
     * @param {string} userId - User performing the operation
     * @returns {Object} Decrypted profile data
     */
    async decryptGeneticProfile(encryptedProfile, userId = null) {
        try {
            if (!encryptedProfile) {
                return null;
            }

            const decryptedProfile = { ...encryptedProfile };

            // Decrypt STR data
            if (encryptedProfile.str_data_encrypted) {
                const decryptedStrData = this.decryptData(encryptedProfile.str_data_encrypted);
                decryptedProfile.str_data = JSON.parse(decryptedStrData);
                delete decryptedProfile.str_data_encrypted;
            }

            // Decrypt sample name
            if (encryptedProfile.sample_name_encrypted) {
                decryptedProfile.sample_name = this.decryptData(
                    encryptedProfile.sample_name_encrypted
                );
                delete decryptedProfile.sample_name_encrypted;
            }

            // Decrypt notes
            if (encryptedProfile.notes_encrypted) {
                decryptedProfile.notes = this.decryptData(
                    encryptedProfile.notes_encrypted
                );
                delete decryptedProfile.notes_encrypted;
            }

            // Log decryption operation
            await this.logEncryptionOperation(
                'dna_profiles',
                encryptedProfile.id,
                'decrypt',
                encryptedProfile.encryption_version || 1,
                userId,
                true
            );

            logger.debug('Genetic profile decrypted successfully', { 
                recordId: encryptedProfile.id 
            });
            return decryptedProfile;
        } catch (error) {
            logger.error('Failed to decrypt genetic profile:', error);
            
            // Log failed decryption
            if (encryptedProfile.id) {
                await this.logEncryptionOperation(
                    'dna_profiles',
                    encryptedProfile.id,
                    'decrypt',
                    encryptedProfile.encryption_version || 1,
                    userId,
                    false,
                    error.message
                );
            }
            
            throw error;
        }
    }

    /**
     * Encrypt master array profile data
     * @param {Object} profileData - Master array profile data
     * @param {string} userId - User performing the operation
     * @returns {Object} Encrypted profile data
     */
    async encryptMasterArrayProfile(profileData, userId = null) {
        try {
            if (!profileData) {
                return null;
            }

            const encryptedProfile = { ...profileData };
            const recordId = profileData.id || crypto.randomUUID();

            // Encrypt STR data
            if (profileData.str_data) {
                encryptedProfile.str_data_encrypted = this.encryptData(
                    JSON.stringify(profileData.str_data),
                    'aes-256-gcm'
                );
                encryptedProfile.str_data = null;
            }

            // Encrypt sample name
            if (profileData.sample_name && profileData.sample_name.trim()) {
                encryptedProfile.sample_name_encrypted = this.encryptData(
                    profileData.sample_name
                );
                encryptedProfile.sample_name = null;
            }

            // Encrypt metadata
            if (profileData.metadata && Object.keys(profileData.metadata).length > 0) {
                encryptedProfile.metadata_encrypted = this.encryptData(
                    JSON.stringify(profileData.metadata)
                );
                encryptedProfile.metadata = null;
            }

            // Set encryption metadata
            encryptedProfile.encryption_version = 1;
            encryptedProfile.encrypted_at = new Date();

            // Log encryption operation
            await this.logEncryptionOperation(
                'master_array_profiles',
                recordId,
                'encrypt',
                1,
                userId,
                true
            );

            logger.debug('Master array profile encrypted successfully', { recordId });
            return encryptedProfile;
        } catch (error) {
            logger.error('Failed to encrypt master array profile:', error);
            
            if (profileData.id) {
                await this.logEncryptionOperation(
                    'master_array_profiles',
                    profileData.id,
                    'encrypt',
                    1,
                    userId,
                    false,
                    error.message
                );
            }
            
            throw error;
        }
    }

    /**
     * Decrypt master array profile data
     * @param {Object} encryptedProfile - Encrypted master array profile data
     * @param {string} userId - User performing the operation
     * @returns {Object} Decrypted profile data
     */
    async decryptMasterArrayProfile(encryptedProfile, userId = null) {
        try {
            if (!encryptedProfile) {
                return null;
            }

            const decryptedProfile = { ...encryptedProfile };

            // Decrypt STR data
            if (encryptedProfile.str_data_encrypted) {
                const decryptedStrData = this.decryptData(encryptedProfile.str_data_encrypted);
                decryptedProfile.str_data = JSON.parse(decryptedStrData);
                delete decryptedProfile.str_data_encrypted;
            }

            // Decrypt sample name
            if (encryptedProfile.sample_name_encrypted) {
                decryptedProfile.sample_name = this.decryptData(
                    encryptedProfile.sample_name_encrypted
                );
                delete decryptedProfile.sample_name_encrypted;
            }

            // Decrypt metadata
            if (encryptedProfile.metadata_encrypted) {
                const decryptedMetadata = this.decryptData(encryptedProfile.metadata_encrypted);
                decryptedProfile.metadata = JSON.parse(decryptedMetadata);
                delete decryptedProfile.metadata_encrypted;
            }

            // Log decryption operation
            await this.logEncryptionOperation(
                'master_array_profiles',
                encryptedProfile.id,
                'decrypt',
                encryptedProfile.encryption_version || 1,
                userId,
                true
            );

            logger.debug('Master array profile decrypted successfully', { 
                recordId: encryptedProfile.id 
            });
            return decryptedProfile;
        } catch (error) {
            logger.error('Failed to decrypt master array profile:', error);
            
            if (encryptedProfile.id) {
                await this.logEncryptionOperation(
                    'master_array_profiles',
                    encryptedProfile.id,
                    'decrypt',
                    encryptedProfile.encryption_version || 1,
                    userId,
                    false,
                    error.message
                );
            }
            
            throw error;
        }
    }

    /**
     * Encrypt match results data
     * @param {Object} matchData - Match results data
     * @param {string} userId - User performing the operation
     * @returns {Object} Encrypted match data
     */
    async encryptMatchResults(matchData, userId = null) {
        try {
            if (!matchData) {
                return null;
            }

            const encryptedMatch = { ...matchData };
            const recordId = matchData.id || crypto.randomUUID();

            // Encrypt locus matches (detailed genetic comparison data)
            if (matchData.locus_matches) {
                encryptedMatch.locus_matches_encrypted = this.encryptData(
                    JSON.stringify(matchData.locus_matches),
                    'aes-256-gcm'
                );
                encryptedMatch.locus_matches = null;
            }

            // Set encryption metadata
            encryptedMatch.encryption_version = 1;
            encryptedMatch.encrypted_at = new Date();

            // Log encryption operation
            await this.logEncryptionOperation(
                'match_results',
                recordId,
                'encrypt',
                1,
                userId,
                true
            );

            logger.debug('Match results encrypted successfully', { recordId });
            return encryptedMatch;
        } catch (error) {
            logger.error('Failed to encrypt match results:', error);
            
            if (matchData.id) {
                await this.logEncryptionOperation(
                    'match_results',
                    matchData.id,
                    'encrypt',
                    1,
                    userId,
                    false,
                    error.message
                );
            }
            
            throw error;
        }
    }

    /**
     * Decrypt match results data
     * @param {Object} encryptedMatch - Encrypted match results data
     * @param {string} userId - User performing the operation
     * @returns {Object} Decrypted match data
     */
    async decryptMatchResults(encryptedMatch, userId = null) {
        try {
            if (!encryptedMatch) {
                return null;
            }

            const decryptedMatch = { ...encryptedMatch };

            // Decrypt locus matches
            if (encryptedMatch.locus_matches_encrypted) {
                const decryptedLocusMatches = this.decryptData(encryptedMatch.locus_matches_encrypted);
                decryptedMatch.locus_matches = JSON.parse(decryptedLocusMatches);
                delete decryptedMatch.locus_matches_encrypted;
            }

            // Log decryption operation
            await this.logEncryptionOperation(
                'match_results',
                encryptedMatch.id,
                'decrypt',
                encryptedMatch.encryption_version || 1,
                userId,
                true
            );

            logger.debug('Match results decrypted successfully', { 
                recordId: encryptedMatch.id 
            });
            return decryptedMatch;
        } catch (error) {
            logger.error('Failed to decrypt match results:', error);
            
            if (encryptedMatch.id) {
                await this.logEncryptionOperation(
                    'match_results',
                    encryptedMatch.id,
                    'decrypt',
                    encryptedMatch.encryption_version || 1,
                    userId,
                    false,
                    error.message
                );
            }
            
            throw error;
        }
    }

    /**
     * Log encryption operation for audit trail
     * @param {string} tableName - Table name
     * @param {string} recordId - Record ID
     * @param {string} operation - Operation type
     * @param {number} encryptionVersion - Encryption version
     * @param {string} performedBy - User ID
     * @param {boolean} success - Operation success
     * @param {string} errorMessage - Error message if failed
     * @param {Object} metadata - Additional metadata
     */
    async logEncryptionOperation(tableName, recordId, operation, encryptionVersion, 
                                performedBy = null, success = true, errorMessage = null, metadata = {}) {
        try {
            await query(`
                SELECT log_encryption_operation($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                tableName,
                recordId,
                operation,
                encryptionVersion,
                performedBy,
                success,
                errorMessage,
                JSON.stringify(metadata)
            ]);
        } catch (error) {
            logger.error('Failed to log encryption operation:', error);
            // Don't throw - logging failure shouldn't break the main operation
        }
    }

    /**
     * Check if key rotation is needed for any tables
     */
    async checkKeyRotationNeeds() {
        try {
            const result = await query(`
                SELECT table_name, column_name, last_key_rotation, key_rotation_interval
                FROM encryption_config 
                WHERE is_active = true 
                AND needs_key_rotation(table_name, column_name) = true
            `);

            if (result.rows.length > 0) {
                logger.warn('Encryption key rotation needed', {
                    tablesNeedingRotation: result.rows.map(row => ({
                        table: row.table_name,
                        column: row.column_name,
                        lastRotation: row.last_key_rotation,
                        interval: row.key_rotation_interval
                    }))
                });

                // Notify administrators about key rotation needs
                for (const row of result.rows) {
                    await this.logEncryptionOperation(
                        row.table_name,
                        'system',
                        'key_rotation_needed',
                        1,
                        null,
                        true,
                        null,
                        {
                            lastRotation: row.last_key_rotation,
                            interval: row.key_rotation_interval
                        }
                    );
                }
            }
        } catch (error) {
            logger.error('Failed to check key rotation needs:', error);
        }
    }

    /**
     * Get encryption compliance report
     * @returns {Object} Compliance report
     */
    async getEncryptionComplianceReport() {
        try {
            const result = await query('SELECT * FROM get_encryption_compliance_report()');
            
            const report = {
                generatedAt: new Date(),
                tables: result.rows,
                summary: {
                    totalTables: result.rows.length,
                    compliantTables: result.rows.filter(row => row.compliance_status === 'COMPLIANT').length,
                    partialTables: result.rows.filter(row => row.compliance_status === 'PARTIAL').length,
                    nonCompliantTables: result.rows.filter(row => row.compliance_status === 'NON_COMPLIANT').length,
                    tablesNeedingRotation: result.rows.filter(row => row.needs_rotation).length
                }
            };

            logger.info('Encryption compliance report generated', {
                compliant: report.summary.compliantTables,
                partial: report.summary.partialTables,
                nonCompliant: report.summary.nonCompliantTables,
                needingRotation: report.summary.tablesNeedingRotation
            });

            return report;
        } catch (error) {
            logger.error('Failed to generate encryption compliance report:', error);
            throw error;
        }
    }

    /**
     * Validate encryption integrity for a record
     * @param {string} tableName - Table name
     * @param {string} recordId - Record ID
     * @returns {Object} Integrity validation result
     */
    async validateEncryptionIntegrity(tableName, recordId) {
        try {
            const result = await query(
                'SELECT validate_encryption_integrity($1, $2) as integrity_result',
                [tableName, recordId]
            );

            const integrityResult = result.rows[0].integrity_result;
            
            logger.debug('Encryption integrity validated', {
                tableName,
                recordId,
                valid: integrityResult.integrity_valid
            });

            return integrityResult;
        } catch (error) {
            logger.error('Failed to validate encryption integrity:', error);
            throw error;
        }
    }

    /**
     * Perform bulk encryption of existing data
     * @param {string} tableName - Table to encrypt
     * @param {string} userId - User performing the operation
     * @param {number} batchSize - Batch size for processing
     * @returns {Object} Encryption results
     */
    async bulkEncryptTable(tableName, userId, batchSize = 100) {
        try {
            if (!this.encryptionMap[tableName]) {
                throw new Error(`Table ${tableName} is not configured for encryption`);
            }

            logger.info(`Starting bulk encryption for table: ${tableName}`);

            const result = await transaction(async (client) => {
                // Get total count
                const countResult = await client.query(
                    `SELECT COUNT(*) as total FROM ${tableName} WHERE is_active = true`
                );
                const totalRecords = parseInt(countResult.rows[0].total);

                let processedRecords = 0;
                let encryptedRecords = 0;
                let errors = [];

                // Process in batches
                for (let offset = 0; offset < totalRecords; offset += batchSize) {
                    const batchResult = await client.query(
                        `SELECT * FROM ${tableName} WHERE is_active = true 
                         ORDER BY created_at LIMIT $1 OFFSET $2`,
                        [batchSize, offset]
                    );

                    for (const record of batchResult.rows) {
                        try {
                            let encryptedRecord;
                            
                            switch (tableName) {
                                case 'dna_profiles':
                                    encryptedRecord = await this.encryptGeneticProfile(record, userId);
                                    break;
                                case 'master_array_profiles':
                                    encryptedRecord = await this.encryptMasterArrayProfile(record, userId);
                                    break;
                                case 'match_results':
                                    encryptedRecord = await this.encryptMatchResults(record, userId);
                                    break;
                                default:
                                    throw new Error(`Bulk encryption not implemented for ${tableName}`);
                            }

                            // Update record with encrypted data
                            const updateFields = [];
                            const updateValues = [];
                            let paramIndex = 1;

                            for (const column of this.encryptionMap[tableName]) {
                                const encryptedColumn = `${column}_encrypted`;
                                if (encryptedRecord[encryptedColumn]) {
                                    updateFields.push(`${encryptedColumn} = $${paramIndex++}`);
                                    updateValues.push(encryptedRecord[encryptedColumn]);
                                }
                            }

                            if (updateFields.length > 0) {
                                updateFields.push(`encryption_version = $${paramIndex++}`);
                                updateFields.push(`encrypted_at = $${paramIndex++}`);
                                updateValues.push(1, new Date());
                                updateValues.push(record.id);

                                await client.query(
                                    `UPDATE ${tableName} SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
                                    updateValues
                                );

                                encryptedRecords++;
                            }

                            processedRecords++;
                        } catch (error) {
                            errors.push({
                                recordId: record.id,
                                error: error.message
                            });
                            logger.error(`Failed to encrypt record ${record.id}:`, error);
                        }
                    }

                    // Log progress
                    if (offset % (batchSize * 10) === 0) {
                        logger.info(`Bulk encryption progress: ${processedRecords}/${totalRecords} records processed`);
                    }
                }

                return {
                    tableName,
                    totalRecords,
                    processedRecords,
                    encryptedRecords,
                    errors: errors.length,
                    errorDetails: errors.slice(0, 10) // Limit error details
                };
            });

            logger.info('Bulk encryption completed', result);
            return result;
        } catch (error) {
            logger.error('Bulk encryption failed:', error);
            throw error;
        }
    }
}

module.exports = new DatabaseEncryptionService();