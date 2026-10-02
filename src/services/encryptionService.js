const { securityConfig } = require('../config/security');
const { logger } = require('../utils/logger');
const databaseEncryptionService = require('./databaseEncryptionService');

class EncryptionService {
    constructor() {
        this.security = securityConfig;
        this.dbEncryption = databaseEncryptionService;
    }

    // Encrypt DNA profile data before storing in database
    async encryptDNAProfile(profileData, userId = null) {
        try {
            if (!profileData || !profileData.str_data) {
                return profileData;
            }

            // Use the new database encryption service for genetic data
            const encryptedProfile = await this.dbEncryption.encryptGeneticProfile(profileData, userId);

            logger.debug('DNA profile encrypted successfully');
            return encryptedProfile;
        } catch (error) {
            logger.error('Failed to encrypt DNA profile:', error);
            throw new Error('Profile encryption failed');
        }
    }

    // Decrypt DNA profile data after retrieving from database
    async decryptDNAProfile(encryptedProfile, userId = null) {
        try {
            if (!encryptedProfile) {
                return null;
            }

            // Use the new database encryption service for genetic data
            const decryptedProfile = await this.dbEncryption.decryptGeneticProfile(encryptedProfile, userId);

            logger.debug('DNA profile decrypted successfully');
            return decryptedProfile;
        } catch (error) {
            logger.error('Failed to decrypt DNA profile:', error);
            throw new Error('Profile decryption failed');
        }
    }

    // Encrypt master array profile data
    async encryptMasterArrayProfile(profileData, userId = null) {
        try {
            if (!profileData) {
                return null;
            }

            // Use the new database encryption service for master array data
            const encryptedProfile = await this.dbEncryption.encryptMasterArrayProfile(profileData, userId);

            logger.debug('Master array profile encrypted successfully');
            return encryptedProfile;
        } catch (error) {
            logger.error('Failed to encrypt master array profile:', error);
            throw new Error('Master array profile encryption failed');
        }
    }

    // Decrypt master array profile data
    async decryptMasterArrayProfile(encryptedProfile, userId = null) {
        try {
            if (!encryptedProfile) {
                return null;
            }

            // Use the new database encryption service for master array data
            const decryptedProfile = await this.dbEncryption.decryptMasterArrayProfile(encryptedProfile, userId);

            logger.debug('Master array profile decrypted successfully');
            return decryptedProfile;
        } catch (error) {
            logger.error('Failed to decrypt master array profile:', error);
            throw new Error('Master array profile decryption failed');
        }
    }

    // Encrypt user sensitive data
    encryptUserData(userData) {
        try {
            const encryptedData = { ...userData };

            // Encrypt email if needed for additional security and it's meaningful
            if (userData.email && userData.email.trim() && process.env.ENCRYPT_USER_EMAIL === 'true') {
                encryptedData.email_encrypted = this.security.encryptData(userData.email);
                delete encryptedData.email;
            }

            // Encrypt personal information if present and meaningful
            if (userData.personal_info && Object.keys(userData.personal_info).length > 0) {
                // Check if personal_info has meaningful data
                const hasData = Object.values(userData.personal_info).some(value => 
                    value && typeof value === 'string' && value.trim()
                );
                
                if (hasData) {
                    encryptedData.personal_info_encrypted = this.security.encryptData(
                        JSON.stringify(userData.personal_info)
                    );
                    delete encryptedData.personal_info;
                }
            }

            return encryptedData;
        } catch (error) {
            logger.error('Failed to encrypt user data:', error);
            throw new Error('User data encryption failed');
        }
    }

    // Decrypt user sensitive data
    decryptUserData(encryptedUserData) {
        try {
            if (!encryptedUserData) {
                return null;
            }

            const decryptedData = { ...encryptedUserData };

            // Decrypt email if encrypted
            if (encryptedUserData.email_encrypted) {
                decryptedData.email = this.security.decryptData(
                    encryptedUserData.email_encrypted
                );
                delete decryptedData.email_encrypted;
            }

            // Decrypt personal information if encrypted
            if (encryptedUserData.personal_info_encrypted) {
                decryptedData.personal_info = JSON.parse(
                    this.security.decryptData(encryptedUserData.personal_info_encrypted)
                );
                delete decryptedData.personal_info_encrypted;
            }

            return decryptedData;
        } catch (error) {
            logger.error('Failed to decrypt user data:', error);
            throw new Error('User data decryption failed');
        }
    }

    // Encrypt match results for storage
    async encryptMatchResults(matchData, userId = null) {
        try {
            if (!matchData) {
                return null;
            }

            // Use the new database encryption service for match results
            const encryptedMatch = await this.dbEncryption.encryptMatchResults(matchData, userId);

            logger.debug('Match results encrypted successfully');
            return encryptedMatch;
        } catch (error) {
            logger.error('Failed to encrypt match results:', error);
            throw new Error('Match results encryption failed');
        }
    }

    // Decrypt match results
    async decryptMatchResults(encryptedMatch, userId = null) {
        try {
            if (!encryptedMatch) {
                return null;
            }

            // Use the new database encryption service for match results
            const decryptedMatch = await this.dbEncryption.decryptMatchResults(encryptedMatch, userId);

            logger.debug('Match results decrypted successfully');
            return decryptedMatch;
        } catch (error) {
            logger.error('Failed to decrypt match results:', error);
            throw new Error('Match results decryption failed');
        }
    }

    // Secure data deletion - overwrite sensitive data before deletion
    secureDelete(data) {
        try {
            if (typeof data === 'object' && data !== null) {
                // Overwrite object properties with random data
                for (const key in data) {
                    if (data.hasOwnProperty(key)) {
                        if (typeof data[key] === 'string') {
                            data[key] = this.security.generateSecureToken(data[key].length);
                        } else if (typeof data[key] === 'object') {
                            this.secureDelete(data[key]);
                        }
                    }
                }
            }
            
            logger.debug('Secure deletion completed');
            return true;
        } catch (error) {
            logger.error('Secure deletion failed:', error);
            return false;
        }
    }
}

module.exports = new EncryptionService();