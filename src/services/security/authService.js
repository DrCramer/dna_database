const jwt = require('jsonwebtoken');
const { query, transaction } = require("../../config/database");
const User = require("../../models/User");
const { logger } = require("../../utils/logger");
const { sessionManager, securityConfig } = require("../../config/security");

const { EventEmitter } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const tokenHash = token => createHash('sha256').update(token).digest('hex');

class AuthService extends EventEmitter {
    constructor() {
        super();
        this.jwtSecret = process.env.JWT_SECRET || 'dna-analysis-secret-key-change-in-production';
        this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
        this.refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
    }

    // Generate JWT token
    generateToken(user, sid = randomUUID()) {
        const payload = {
            id: user.id, type: 'access', sid,
            username: user.username,
            email: user.email,
            role: user.role,
            organization_id: user.organization_id,
            department_id: user.department_id
        };

        return jwt.sign(payload, this.jwtSecret, {
            expiresIn: this.jwtExpiresIn, jwtid: randomUUID(),
            issuer: 'dna-analysis-app',
            audience: 'dna-analysis-users'
        });
    }

    // Generate refresh token
    generateRefreshToken(user, sid = randomUUID()) {
        const payload = {
            id: user.id,
            type: 'refresh', sid
        };

        return jwt.sign(payload, this.jwtSecret, {
            expiresIn: this.refreshTokenExpiresIn, jwtid: randomUUID(),
            issuer: 'dna-analysis-app',
            audience: 'dna-analysis-users'
        });
    }

    // Verify JWT token
    verifyToken(token) {
        try {
            return jwt.verify(token, this.jwtSecret, {
                issuer: 'dna-analysis-app',
                audience: 'dna-analysis-users'
            });
        } catch (error) {
            logger.error('Token verification failed:', error.message);
            throw new Error('Invalid or expired token');
        }
    }

    verifyAccessToken(token) {
        const decoded = this.verifyToken(token);
        if (decoded.type !== 'access' || !decoded.sid) throw new Error('Access token is required');
        return decoded;
    }

    // Store session in database and memory
    async createSession(userId, token, ipAddress, userAgent, refreshToken = null) {
        try {
            // Hash the token for storage
            const crypto = require('crypto');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

            // Calculate expiration time
            const decoded = this.verifyToken(token);
            const expiresAt = new Date(decoded.exp * 1000);

            // Store in database
            await query(
                `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,ip_address,user_agent,refresh_token_hash,refresh_expires_at,session_family_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$1)`,
                [decoded.sid, userId, tokenHash, expiresAt, ipAddress, userAgent,
                    refreshToken ? createHash('sha256').update(refreshToken).digest('hex') : null,
                    refreshToken ? new Date(this.verifyToken(refreshToken).exp * 1000) : null]
            );

            // Store in memory session manager
            sessionManager.createSession(userId, token, {
                ipAddress,
                userAgent
            });

            logger.info(`Session created for user: ${userId}`);
        } catch (error) {
            logger.error('Error creating session:', error);
            throw error;
        }
    }

    // Validate session exists and is active
    async validateSession(token) {
        try {
            // The database is authoritative, including after a process restart.
            // Then validate against database
            const crypto = require('crypto');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

            const result = await query(
                `SELECT us.*, u.username, u.role, u.is_active as user_active,
                        u.organization_id, u.department_id
                 FROM user_sessions us
                 JOIN users u ON us.user_id = u.id
                 WHERE us.token_hash = $1 
                 AND us.is_active = true 
                 AND us.expires_at > CURRENT_TIMESTAMP
                 AND u.is_active = true`,
                [tokenHash]
            );

            if (result.rows.length === 0) {
                // Remove from memory if not in database
                sessionManager.destroySession(token);
                return null;
            }

            const session = result.rows[0];

            // Validate organizational access if user has department/organization
            if (session.department_id) {
                const deptResult = await query(
                    'SELECT is_active FROM departments WHERE id = $1',
                    [session.department_id]
                );
                
                if (deptResult.rows.length === 0 || !deptResult.rows[0].is_active) {
                    logger.warn(`User ${session.username} session invalid: department ${session.department_id} is inactive`);
                    await this.invalidateSession(token);
                    return null;
                }
            }

            if (session.organization_id) {
                const orgResult = await query(
                    'SELECT is_active FROM organizations WHERE id = $1',
                    [session.organization_id]
                );
                
                if (orgResult.rows.length === 0 || !orgResult.rows[0].is_active) {
                    logger.warn(`User ${session.username} session invalid: organization ${session.organization_id} is inactive`);
                    await this.invalidateSession(token);
                    return null;
                }
            }

            return session;
        } catch (error) {
            logger.error('Error validating session:', error);
            throw error;
        }
    }

    // Invalidate session (logout)
    async invalidateSession(token) {
        try {
            const crypto = require('crypto');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

            // Remove from database
            const familyId = await transaction(async client => {
                const { rows } = await client.query('SELECT user_id,session_family_id FROM user_sessions WHERE token_hash=$1', [tokenHash]);
                if (!rows.length) return;
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [rows[0].user_id]);
                // Logout also revokes any refresh token rotated concurrently in this family.
                await client.query(`UPDATE user_sessions SET is_active=false WHERE session_family_id IN
                    (SELECT session_family_id FROM user_sessions WHERE token_hash=$1)
                    OR token_hash=$1`, [tokenHash]);
                return rows[0].session_family_id;
            });

            // Remove from memory
            sessionManager.destroySession(token);
            this.emit('sessionRevoked', { tokenHash, familyId });

            logger.info('Session invalidated');
        } catch (error) {
            logger.error('Error invalidating session:', error);
            throw error;
        }
    }

    // Invalidate all sessions for a user
    async invalidateAllUserSessions(userId) {
        try {
            // Remove from database
            await transaction(async client => {
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [userId]);
                await client.query('UPDATE user_sessions SET is_active=false WHERE user_id=$1', [userId]);
            });

            // Remove from memory
            sessionManager.destroyAllUserSessions(userId);
            this.emit('sessionRevoked', { userId });

            logger.info(`All sessions invalidated for user: ${userId}`);
        } catch (error) {
            logger.error('Error invalidating all user sessions:', error);
            throw error;
        }
    }

    // Clean up expired sessions
    async cleanupExpiredSessions() {
        try {
            const result = await query(
                'DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP AND COALESCE(refresh_expires_at, expires_at) < CURRENT_TIMESTAMP'
            );

            logger.info(`Cleaned up ${result.rowCount} expired sessions`);
            return result.rowCount;
        } catch (error) {
            logger.error('Error cleaning up expired sessions:', error);
            throw error;
        }
    }

    // Login user
    async login(username, password, ipAddress, userAgent) {
        try {
            // Normal database login flow
            // Find user by username or email
            let user = await User.findByUsername(username);
            if (!user) {
                user = await User.findByEmail(username);
            }

            if (!user) {
                throw new Error('Invalid credentials');
            }

            // Verify password
            const isValidPassword = await user.verifyPassword(password);
            if (!isValidPassword) {
                throw new Error('Invalid credentials');
            }

            // Update last login
            await user.updateLastLogin();

            const accessibleDepartments = await user.getAccessibleDepartments();

            // Generate tokens
            const sid = randomUUID();
            const accessToken = this.generateToken(user, sid);
            const refreshToken = this.generateRefreshToken(user, sid);

            // Create session
            await this.createSession(user.id, accessToken, ipAddress, userAgent, refreshToken);

            // Log operation
            await this.logOperation(user.id, 'LOGIN', { ipAddress, userAgent });

            logger.info(`User logged in: ${user.username}`);

            return {
                user: {
                    ...user.toJSON(),
                    accessible_departments: accessibleDepartments
                },
                accessToken,
                refreshToken,
                expiresIn: this.jwtExpiresIn
            };
        } catch (error) {
            logger.error('Login failed:', error.message);
            throw error;
        }
    }

    // Register new user with organizational context
    async register(userData, ipAddress, userAgent) {
        try {
            const { 
                username, 
                email,
                display_name,
                password, 
                role = 'user_analyst',
                organization_id = null,
                department_id = null,
                can_upload_with_task = true,
                can_upload_without_task = false
            } = userData;

            // Check if user already exists
            const existingUser = await User.findByUsername(username) || (email ? await User.findByEmail(email) : null);
            if (existingUser) {
                throw new Error('User already exists');
            }

            // Create user with organizational context
            const user = await User.create({ 
                username, 
                email,
                display_name,
                password, 
                role,
                organization_id,
                department_id,
                can_upload_with_task,
                can_upload_without_task
            });

            await user.getAccessibleDepartments();

            // Generate tokens with organizational context
            const sid = randomUUID();
            const accessToken = this.generateToken(user, sid);
            const refreshToken = this.generateRefreshToken(user, sid);

            // Create session
            await this.createSession(user.id, accessToken, ipAddress, userAgent, refreshToken);

            // Log operation
            await this.logOperation(user.id, 'REGISTER', { 
                ipAddress, 
                userAgent,
                organization_id,
                department_id
            });

            logger.info(`User registered: ${user.username} with role: ${role}, department: ${department_id}`);

            return {
                user: {
                    ...user.toJSON(),
                    accessible_departments: user.accessible_departments
                },
                accessToken,
                refreshToken,
                expiresIn: this.jwtExpiresIn
            };
        } catch (error) {
            logger.error('Registration failed:', error.message);
            throw error;
        }
    }

    // Logout user
    async logout(token, ipAddress, userAgent) {
        try {
            // Get user info from token before invalidating
            const decoded = this.verifyToken(token);
            
            // Invalidate session
            await this.invalidateSession(token);

            // Log operation
            await this.logOperation(decoded.id, 'LOGOUT', { ipAddress, userAgent });

            logger.info(`User logged out: ${decoded.username}`);
        } catch (error) {
            logger.error('Logout failed:', error.message);
            throw error;
        }
    }

    // Refresh token
    async refreshToken(refreshToken, ipAddress, userAgent) {
        const decoded = this.verifyToken(refreshToken);
        if (decoded.type !== 'refresh' || !decoded.sid) throw new Error('Invalid refresh token');
        const user = await User.findById(decoded.id);
        if (!user) throw new Error('User not found');
        await user.getAccessibleDepartments();
        const outcome = await transaction(async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user.id]);
            const active = await client.query(`SELECT u.id FROM users u
                LEFT JOIN departments d ON d.id=u.department_id
                LEFT JOIN organizations o ON o.id=u.organization_id
                WHERE u.id=$1 AND u.is_active=true
                AND (u.department_id IS NULL OR d.is_active=true)
                AND (u.organization_id IS NULL OR o.is_active=true)`, [user.id]);
            if (!active.rows.length) return { rejected: true };
            const { rows } = await client.query(`SELECT * FROM user_sessions
                WHERE refresh_token_hash=$1 AND user_id=$2 FOR UPDATE`, [tokenHash(refreshToken), user.id]);
            const old = rows[0];
            if (!old || old.id !== decoded.sid || !old.is_active || !old.refresh_expires_at || new Date(old.refresh_expires_at) <= new Date()) {
                if (old?.session_family_id) await client.query('UPDATE user_sessions SET is_active=false WHERE session_family_id=$1', [old.session_family_id]);
                return { rejected: true, familyId: old?.session_family_id };
            }
            const sid = randomUUID(), accessToken = this.generateToken(user, sid), nextRefresh = this.generateRefreshToken(user, sid);
            const access = this.verifyAccessToken(accessToken), refresh = this.verifyToken(nextRefresh);
            await client.query('UPDATE user_sessions SET is_active=false WHERE id=$1', [old.id]);
            await client.query(`INSERT INTO user_sessions (id,user_id,token_hash,expires_at,ip_address,user_agent,
                refresh_token_hash,refresh_expires_at,session_family_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [sid,user.id,tokenHash(accessToken),new Date(access.exp*1000),ipAddress,userAgent,
                    tokenHash(nextRefresh),new Date(refresh.exp*1000),old.session_family_id]);
            return { accessToken, refreshToken: nextRefresh, revokedHash: old.token_hash };
        });
        if (outcome.rejected) {
            if (outcome.familyId) {
                this.emit('sessionRevoked', { familyId: outcome.familyId });
            }
            throw new Error('Invalid or expired refresh token');
        }
        this.emit('sessionRevoked', { tokenHash: outcome.revokedHash });
        sessionManager.createSession(user.id, outcome.accessToken, { ipAddress, userAgent });
        return { user: { ...user.toJSON(), accessible_departments: user.accessible_departments },
            accessToken: outcome.accessToken, refreshToken: outcome.refreshToken, expiresIn: this.jwtExpiresIn };
    }

    // Log operation for audit trail
    async logOperation(userId, operationType, details) {
        try {
            await query(
                `INSERT INTO operation_history (user_id, operation_type, operation_details, ip_address, user_agent) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    userId,
                    operationType,
                    JSON.stringify(details),
                    details.ipAddress || null,
                    details.userAgent || null
                ]
            );
        } catch (error) {
            logger.error('Error logging operation:', error);
            // Don't throw error for logging failures
        }
    }
}

module.exports = new AuthService();
