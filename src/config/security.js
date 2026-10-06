const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

// Encryption configuration
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits

class SecurityConfig {
    constructor() {
        this.encryptionKey = this.getOrCreateEncryptionKey();
        this.httpsOptions = this.getHTTPSOptions();
    }

    // Get or create encryption key for database encryption
    getOrCreateEncryptionKey() {
        const keyPath = process.env.ENCRYPTION_KEY_PATH || './config/encryption.key';
        
        try {
            // Try to read existing key
            if (fs.existsSync(keyPath)) {
                const key = fs.readFileSync(keyPath);
                if (key.length === KEY_LENGTH) {
                    logger.info('Loaded existing encryption key');
                    return key;
                }
                throw new Error('Encryption key must be exactly 32 bytes; the existing file was not changed');
            }

            if (process.env.NODE_ENV === 'production') {
                throw new Error('Persistent encryption key is missing');
            }
            
            // Generate new key if not exists or invalid
            const newKey = crypto.randomBytes(KEY_LENGTH);
            
            // Ensure directory exists
            const keyDir = path.dirname(keyPath);
            if (!fs.existsSync(keyDir)) {
                fs.mkdirSync(keyDir, { recursive: true });
            }
            
            // Save key securely
            fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
            logger.info('Generated new encryption key');
            
            return newKey;
        } catch (error) {
            logger.error('Failed to handle encryption key:', error);
            // Fallback to environment variable or generate temporary key
            const envKey = process.env.ENCRYPTION_KEY;
            if (envKey && /^[0-9a-f]{64}$/i.test(envKey)) {
                return Buffer.from(envKey, 'hex');
            }

            if (process.env.NODE_ENV === 'production') {
                throw new Error(`Cannot load persistent encryption key: ${error.message}`);
            }
            
            // Generate temporary key (not persistent)
            logger.warn('Using temporary encryption key - data will not be recoverable after restart');
            return crypto.randomBytes(KEY_LENGTH);
        }
    }

    // Get HTTPS options for secure communication
    getHTTPSOptions() {
        const certPath = process.env.SSL_CERT_PATH || './config/ssl/cert.pem';
        const keyPath = process.env.SSL_KEY_PATH || './config/ssl/key.pem';
        
        try {
            if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
                return {
                    cert: fs.readFileSync(certPath),
                    key: fs.readFileSync(keyPath)
                };
            }
        } catch (error) {
            logger.warn('SSL certificates not found, using HTTP:', error.message);
        }
        
        return null;
    }

    // Encrypt sensitive data for database storage
    encryptData(plaintext) {
        try {
            if (!plaintext || plaintext.trim() === '') {
                // Handle empty or whitespace-only strings
                return null;
            }
            
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
            
            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            // Combine IV and encrypted data
            return iv.toString('hex') + ':' + encrypted;
        } catch (error) {
            logger.error('Encryption failed:', error);
            throw new Error('Data encryption failed');
        }
    }

    // Decrypt sensitive data from database
    decryptData(encryptedData) {
        try {
            if (!encryptedData) return null;
            
            const parts = encryptedData.split(':');
            if (parts.length !== 2) {
                throw new Error('Invalid encrypted data format');
            }
            
            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = parts[1];
            
            const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
            
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
        } catch (error) {
            logger.error('Decryption failed:', error);
            throw new Error('Data decryption failed');
        }
    }

    // Hash sensitive data (one-way)
    hashData(data, salt = null) {
        try {
            if (!salt) {
                salt = crypto.randomBytes(16).toString('hex');
            }
            
            const hash = crypto.pbkdf2Sync(data, salt, 10000, 64, 'sha512');
            return salt + ':' + hash.toString('hex');
        } catch (error) {
            logger.error('Hashing failed:', error);
            throw new Error('Data hashing failed');
        }
    }

    // Verify hashed data
    verifyHash(data, hashedData) {
        try {
            const parts = hashedData.split(':');
            if (parts.length !== 2) {
                return false;
            }
            
            const salt = parts[0];
            const originalHash = parts[1];
            
            const hash = crypto.pbkdf2Sync(data, salt, 10000, 64, 'sha512');
            return originalHash === hash.toString('hex');
        } catch (error) {
            logger.error('Hash verification failed:', error);
            return false;
        }
    }

    // Generate secure random tokens
    generateSecureToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    // Validate token format
    isValidToken(token) {
        return typeof token === 'string' && 
               token.length >= 32 && 
               /^[a-f0-9]+$/i.test(token);
    }
}

// Session management with expiration
class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.sessionTimeout = this.parseTimeout(process.env.SESSION_TIMEOUT || '24h');
        
        // Clean up expired sessions every hour
        setInterval(() => this.cleanupExpiredSessions(), 60 * 60 * 1000);
    }

    parseTimeout(timeoutStr) {
        const match = timeoutStr.match(/^(\d+)([smhd])$/);
        if (!match) return 24 * 60 * 60 * 1000; // Default 24 hours
        
        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
            case 's': return value * 1000;
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return 24 * 60 * 60 * 1000;
        }
    }

    createSession(userId, token, metadata = {}) {
        const session = {
            userId,
            token,
            createdAt: new Date(),
            lastActivity: new Date(),
            expiresAt: new Date(Date.now() + this.sessionTimeout),
            metadata: {
                userAgent: metadata.userAgent,
                ipAddress: metadata.ipAddress,
                ...metadata
            }
        };
        
        this.sessions.set(token, session);
        logger.info(`Session created for user ${userId}, expires at ${session.expiresAt}`);
        
        return session;
    }

    validateSession(token) {
        const session = this.sessions.get(token);
        
        if (!session) {
            return null;
        }
        
        // Check if session has expired
        if (new Date() > session.expiresAt) {
            this.sessions.delete(token);
            logger.info(`Session expired for user ${session.userId}`);
            return null;
        }
        
        // Update last activity
        session.lastActivity = new Date();
        
        return session;
    }

    extendSession(token, additionalTime = null) {
        const session = this.sessions.get(token);
        
        if (!session) {
            return false;
        }
        
        const extension = additionalTime || this.sessionTimeout;
        session.expiresAt = new Date(Date.now() + extension);
        session.lastActivity = new Date();
        
        logger.debug(`Session extended for user ${session.userId}`);
        return true;
    }

    destroySession(token) {
        const session = this.sessions.get(token);
        
        if (session) {
            this.sessions.delete(token);
            logger.info(`Session destroyed for user ${session.userId}`);
            return true;
        }
        
        return false;
    }

    destroyAllUserSessions(userId) {
        let count = 0;
        
        for (const [token, session] of this.sessions.entries()) {
            if (session.userId === userId) {
                this.sessions.delete(token);
                count++;
            }
        }
        
        if (count > 0) {
            logger.info(`Destroyed ${count} sessions for user ${userId}`);
        }
        
        return count;
    }

    cleanupExpiredSessions() {
        const now = new Date();
        let cleanedCount = 0;
        
        for (const [token, session] of this.sessions.entries()) {
            if (now > session.expiresAt) {
                this.sessions.delete(token);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            logger.info(`Cleaned up ${cleanedCount} expired sessions`);
        }
    }

    getActiveSessions(userId = null) {
        const sessions = [];
        
        for (const [token, session] of this.sessions.entries()) {
            if (!userId || session.userId === userId) {
                sessions.push({
                    token: token.substring(0, 8) + '...', // Partial token for security
                    userId: session.userId,
                    createdAt: session.createdAt,
                    lastActivity: session.lastActivity,
                    expiresAt: session.expiresAt,
                    metadata: session.metadata
                });
            }
        }
        
        return sessions;
    }
}

// Create singleton instances
const securityConfig = new SecurityConfig();
const sessionManager = new SessionManager();

module.exports = {
    SecurityConfig,
    SessionManager,
    securityConfig,
    sessionManager
};
