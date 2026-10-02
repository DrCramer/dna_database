const { query, transaction } = require('../config/database');
const { logger } = require('../utils/logger');
const auditService = require('../services/auditService');

class Organization {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.settings = data.settings;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.is_active = data.is_active;
        // Additional computed fields from queries
        if (data.department_count !== undefined) {
            this.department_count = parseInt(data.department_count) || 0;
        }
    }

    /**
     * Create a new organization
     * @param {Object} organizationData - Organization data
     * @param {string} organizationData.name - Organization name (required)
     * @param {string} organizationData.description - Organization description
     * @param {Object} organizationData.settings - Organization settings (JSON)
     * @returns {Promise<Organization>} Created organization
     */
    static async create(organizationData) {
        const { name, description, settings = {} } = organizationData;

        // Validate required fields
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            throw new Error('Organization name is required and must be a non-empty string');
        }

        if (name.length > 255) {
            throw new Error('Organization name must be 255 characters or less');
        }

        // Validate settings if provided
        if (settings && typeof settings !== 'object') {
            throw new Error('Organization settings must be an object');
        }

        const queryText = `
            INSERT INTO organizations (name, description, settings)
            VALUES ($1, $2, $3)
            RETURNING *
        `;

        try {
            const result = await query(queryText, [
                name.trim(),
                description || null,
                JSON.stringify(settings)
            ]);

            const organization = new Organization(result.rows[0]);
            
            // Log audit event for organization creation
            await auditService.logOrganizationalOperation({
                userId: null, // System operation during creation
                operationType: auditService.operationTypes.ORGANIZATION_CREATE,
                resourceType: 'organization',
                resourceId: organization.id,
                resourceName: organization.name,
                organizationId: organization.id,
                details: {
                    name: organization.name,
                    description: organization.description,
                    settings: organization.settings
                }
            }).catch(error => {
                logger.error('Failed to log organization creation audit:', error);
            });
            
            logger.info('Organization created', {
                organizationId: organization.id,
                name: organization.name
            });

            return organization;
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error(`Organization with name '${name}' already exists`);
            }
            logger.error('Error creating organization', { 
                error: error.message, 
                organizationData 
            });
            throw error;
        }
    }

    /**
     * Find organization by ID
     * @param {string} id - Organization ID
     * @returns {Promise<Organization|null>} Organization or null if not found
     */
    static async findById(id) {
        if (!id) {
            throw new Error('Organization ID is required');
        }

        const queryText = `
            SELECT * FROM organizations 
            WHERE id = $1 AND is_active = true
        `;

        try {
            const result = await query(queryText, [id]);
            return result.rows.length > 0 ? new Organization(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding organization by ID', { 
                error: error.message, 
                id 
            });
            throw error;
        }
    }

    /**
     * Find organization by name
     * @param {string} name - Organization name
     * @returns {Promise<Organization|null>} Organization or null if not found
     */
    static async findByName(name) {
        if (!name) {
            throw new Error('Organization name is required');
        }

        const queryText = `
            SELECT * FROM organizations 
            WHERE name = $1 AND is_active = true
        `;

        try {
            const result = await query(queryText, [name]);
            return result.rows.length > 0 ? new Organization(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding organization by name', { 
                error: error.message, 
                name 
            });
            throw error;
        }
    }

    /**
     * Get all active organizations
     * @param {Object} options - Query options
     * @param {number} options.limit - Limit results (default: 100)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @param {string} options.orderBy - Order by field (default: 'created_at')
     * @param {string} options.orderDirection - Order direction (default: 'DESC')
     * @returns {Promise<Array<Organization>>} Array of organizations
     */
    static async findAll(options = {}) {
        const { 
            limit = 100, 
            offset = 0, 
            orderBy = 'created_at', 
            orderDirection = 'DESC' 
        } = options;

        // Validate orderBy field to prevent SQL injection
        const allowedOrderFields = ['name', 'created_at', 'updated_at'];
        const safeOrderBy = allowedOrderFields.includes(orderBy) ? orderBy : 'created_at';
        const safeOrderDirection = ['ASC', 'DESC'].includes(orderDirection.toUpperCase()) 
            ? orderDirection.toUpperCase() 
            : 'DESC';

        const queryText = `
            SELECT * FROM organizations 
            WHERE is_active = true
            ORDER BY ${safeOrderBy} ${safeOrderDirection}
            LIMIT $1 OFFSET $2
        `;

        try {
            const result = await query(queryText, [limit, offset]);
            return result.rows.map(row => new Organization(row));
        } catch (error) {
            logger.error('Error finding all organizations', { 
                error: error.message, 
                options 
            });
            throw error;
        }
    }

    /**
     * Update organization
     * @param {Object} updates - Fields to update
     * @param {string} updates.name - Organization name
     * @param {string} updates.description - Organization description
     * @param {Object} updates.settings - Organization settings
     * @param {string} userId - ID of user performing the update (for audit)
     * @returns {Promise<Organization>} Updated organization
     */
    async update(updates, userId = null) {
        const allowedFields = ['name', 'description', 'settings'];
        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                if (key === 'name') {
                    if (!value || typeof value !== 'string' || value.trim().length === 0) {
                        throw new Error('Organization name is required and must be a non-empty string');
                    }
                    if (value.length > 255) {
                        throw new Error('Organization name must be 255 characters or less');
                    }
                    updateFields.push(`name = $${paramIndex}`);
                    values.push(value.trim());
                } else if (key === 'settings') {
                    if (value && typeof value !== 'object') {
                        throw new Error('Organization settings must be an object');
                    }
                    updateFields.push(`settings = $${paramIndex}`);
                    values.push(JSON.stringify(value || {}));
                } else {
                    updateFields.push(`${key} = $${paramIndex}`);
                    values.push(value);
                }
                paramIndex++;
            }
        }

        if (updateFields.length === 0) {
            throw new Error('No valid fields to update');
        }

        values.push(this.id);
        const queryText = `
            UPDATE organizations 
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex} AND is_active = true
            RETURNING *
        `;

        try {
            const result = await query(queryText, values);
            
            if (result.rows.length === 0) {
                throw new Error('Organization not found or inactive');
            }

            // Store old values for audit
            const oldValues = {
                name: this.name,
                description: this.description,
                settings: this.settings
            };

            // Update instance properties
            const updatedData = result.rows[0];
            Object.assign(this, updatedData);

            // Log audit event for organization update
            await auditService.logOrganizationalOperation({
                userId,
                operationType: auditService.operationTypes.ORGANIZATION_UPDATE,
                resourceType: 'organization',
                resourceId: this.id,
                resourceName: this.name,
                organizationId: this.id,
                details: {
                    oldValues,
                    newValues: updates
                }
            }).catch(error => {
                logger.error('Failed to log organization update audit:', error);
            });

            logger.info('Organization updated', {
                organizationId: this.id,
                updates
            });

            return this;
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error(`Organization with name '${updates.name}' already exists`);
            }
            logger.error('Error updating organization', { 
                error: error.message, 
                organizationId: this.id, 
                updates 
            });
            throw error;
        }
    }

    /**
     * Deactivate organization (soft delete)
     * This will also deactivate all associated departments and users
     * @param {string} userId - ID of user performing the deactivation (for audit)
     * @returns {Promise<void>}
     */
    async deactivate(userId = null) {
        try {
            await transaction(async (client) => {
                // Deactivate the organization
                await client.query(
                    'UPDATE organizations SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                    [this.id]
                );

                // Deactivate all departments in this organization
                await client.query(
                    'UPDATE departments SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $1',
                    [this.id]
                );

                // Deactivate all users in this organization
                await client.query(
                    'UPDATE users SET is_active = false WHERE organization_id = $1',
                    [this.id]
                );

                // Deactivate all expert groups in departments of this organization
                await client.query(`
                    UPDATE expert_groups SET is_active = false, updated_at = CURRENT_TIMESTAMP 
                    WHERE department_id IN (
                        SELECT id FROM departments WHERE organization_id = $1
                    )
                `, [this.id]);

                // Deactivate all tasks in departments of this organization
                await client.query(`
                    UPDATE tasks SET is_active = false, updated_at = CURRENT_TIMESTAMP 
                    WHERE department_id IN (
                        SELECT id FROM departments WHERE organization_id = $1
                    )
                `, [this.id]);
            });

            this.is_active = false;
            
            // Log audit event for organization deactivation
            await auditService.logOrganizationalOperation({
                userId,
                operationType: auditService.operationTypes.ORGANIZATION_DELETE,
                resourceType: 'organization',
                resourceId: this.id,
                resourceName: this.name,
                organizationId: this.id,
                details: {
                    action: 'deactivate',
                    cascadeEffect: 'departments, users, expert_groups, tasks'
                }
            }).catch(error => {
                logger.error('Failed to log organization deactivation audit:', error);
            });
            
            logger.info('Organization deactivated with cascade', {
                organizationId: this.id,
                name: this.name
            });
        } catch (error) {
            logger.error('Error deactivating organization', { 
                error: error.message, 
                organizationId: this.id 
            });
            throw error;
        }
    }

    /**
     * Reactivate organization
     * Note: This only reactivates the organization itself, not associated entities
     * @returns {Promise<void>}
     */
    async reactivate() {
        try {
            const result = await query(
                'UPDATE organizations SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
                [this.id]
            );

            if (result.rows.length === 0) {
                throw new Error('Organization not found');
            }

            this.is_active = true;
            this.updated_at = result.rows[0].updated_at;

            logger.info('Organization reactivated', {
                organizationId: this.id,
                name: this.name
            });
        } catch (error) {
            logger.error('Error reactivating organization', { 
                error: error.message, 
                organizationId: this.id 
            });
            throw error;
        }
    }

    /**
     * Get departments belonging to this organization
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive departments (default: false)
     * @returns {Promise<Array>} Array of departments
     */
    async getDepartments(options = {}) {
        const { includeInactive = false } = options;
        
        let queryText = `
            SELECT * FROM departments 
            WHERE organization_id = $1
        `;
        
        if (!includeInactive) {
            queryText += ' AND is_active = true';
        }
        
        queryText += ' ORDER BY created_at ASC';

        try {
            const result = await query(queryText, [this.id]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting organization departments', { 
                error: error.message, 
                organizationId: this.id 
            });
            throw error;
        }
    }

    /**
     * Get users belonging to this organization
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive users (default: false)
     * @returns {Promise<Array>} Array of users
     */
    async getUsers(options = {}) {
        const { includeInactive = false } = options;
        
        let queryText = `
            SELECT id, username, email, role, department_id, created_at, last_login, is_active 
            FROM users 
            WHERE organization_id = $1
        `;
        
        if (!includeInactive) {
            queryText += ' AND is_active = true';
        }
        
        queryText += ' ORDER BY created_at ASC';

        try {
            const result = await query(queryText, [this.id]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting organization users', { 
                error: error.message, 
                organizationId: this.id 
            });
            throw error;
        }
    }

    /**
     * Count total entities in organization
     * @returns {Promise<Object>} Counts of departments, users, expert groups, tasks
     */
    async getEntityCounts() {
        try {
            const result = await query(`
                SELECT 
                    (SELECT COUNT(*) FROM departments WHERE organization_id = $1 AND is_active = true) as departments,
                    (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND is_active = true) as users,
                    (SELECT COUNT(*) FROM expert_groups eg 
                     JOIN departments d ON eg.department_id = d.id 
                     WHERE d.organization_id = $1 AND eg.is_active = true AND d.is_active = true) as expert_groups,
                    (SELECT COUNT(*) FROM tasks t 
                     JOIN departments d ON t.department_id = d.id 
                     WHERE d.organization_id = $1 AND t.is_active = true AND d.is_active = true) as tasks
            `, [this.id]);

            return {
                departments: parseInt(result.rows[0].departments),
                users: parseInt(result.rows[0].users),
                expertGroups: parseInt(result.rows[0].expert_groups),
                tasks: parseInt(result.rows[0].tasks)
            };
        } catch (error) {
            logger.error('Error getting organization entity counts', { 
                error: error.message, 
                organizationId: this.id 
            });
            throw error;
        }
    }

    /**
     * Convert organization to JSON
     * @returns {Object} Organization as plain object
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            settings: this.settings,
            created_at: this.created_at,
            updated_at: this.updated_at,
            is_active: this.is_active
        };
    }
}

module.exports = Organization;