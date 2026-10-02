const { query, transaction } = require('../config/database');
const { logger } = require('../utils/logger');
const auditService = require('../services/auditService');

class Department {
    constructor(data) {
        this.id = data.id;
        this.organization_id = data.organization_id;
        this.name = data.name;
        this.description = data.description;
        this.master_array_id = data.master_array_id;
        this.settings = data.settings;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.is_active = data.is_active;
    }

    /**
     * Create a new department with automatic master array creation
     * @param {Object} departmentData - Department data
     * @param {string} departmentData.organization_id - Organization ID (required)
     * @param {string} departmentData.name - Department name (required)
     * @param {string} departmentData.description - Department description
     * @param {Object} departmentData.settings - Department settings (JSON)
     * @returns {Promise<Department>} Created department with master array
     */
    static async create(departmentData) {
        const { organization_id, name, description, settings = {} } = departmentData;

        // Validate required fields
        if (!organization_id) {
            throw new Error('Organization ID is required');
        }

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            throw new Error('Department name is required and must be a non-empty string');
        }

        if (name.length > 255) {
            throw new Error('Department name must be 255 characters or less');
        }

        // Validate settings if provided
        if (settings && typeof settings !== 'object') {
            throw new Error('Department settings must be an object');
        }

        try {
            const result = await transaction(async (client) => {
                // Verify organization exists and is active
                const orgResult = await client.query(
                    'SELECT id FROM organizations WHERE id = $1 AND is_active = true',
                    [organization_id]
                );

                if (orgResult.rows.length === 0) {
                    throw new Error('Organization not found or inactive');
                }

                // Create department
                const deptResult = await client.query(`
                    INSERT INTO departments (organization_id, name, description, settings)
                    VALUES ($1, $2, $3, $4)
                    RETURNING *
                `, [
                    organization_id,
                    name.trim(),
                    description || null,
                    JSON.stringify(settings)
                ]);

                const department = deptResult.rows[0];

                // Master array will be created automatically by the database trigger
                // The trigger runs AFTER INSERT, so we need to commit the transaction first
                // and then fetch the updated department
                return department;
            });

            // After transaction commits, fetch the updated department with master_array_id
            // The trigger should have run by now
            let attempts = 0;
            const maxAttempts = 10;
            let finalDepartment = result;
            
            while (attempts < maxAttempts && !finalDepartment.master_array_id) {
                if (attempts > 0) {
                    // Wait a bit before retrying
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                
                const updatedResult = await query(
                    'SELECT * FROM departments WHERE id = $1',
                    [result.id]
                );
                
                if (updatedResult.rows.length > 0) {
                    finalDepartment = updatedResult.rows[0];
                }
                attempts++;
            }

            const department = new Department(finalDepartment);
            
            // Log audit event for department creation
            await auditService.logOrganizationalOperation({
                userId: null, // System operation during creation
                operationType: auditService.operationTypes.DEPARTMENT_CREATE,
                resourceType: 'department',
                resourceId: department.id,
                resourceName: department.name,
                departmentId: department.id,
                organizationId: department.organization_id,
                details: {
                    name: department.name,
                    description: department.description,
                    settings: department.settings,
                    masterArrayId: department.master_array_id
                }
            }).catch(error => {
                logger.error('Failed to log department creation audit:', error);
            });
            
            logger.info('Department created with master array', {
                departmentId: department.id,
                name: department.name,
                organizationId: department.organization_id,
                masterArrayId: department.master_array_id
            });

            return department;
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error(`Department with name '${name}' already exists in this organization`);
            }
            logger.error('Error creating department', { 
                error: error.message, 
                departmentData 
            });
            throw error;
        }
    }

    /**
     * Find department by ID
     * @param {string} id - Department ID
     * @returns {Promise<Department|null>} Department or null if not found
     */
    static async findById(id) {
        if (!id) {
            throw new Error('Department ID is required');
        }

        const queryText = `
            SELECT * FROM departments 
            WHERE id = $1 AND is_active = true
        `;

        try {
            const result = await query(queryText, [id]);
            return result.rows.length > 0 ? new Department(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding department by ID', { 
                error: error.message, 
                id 
            });
            throw error;
        }
    }

    /**
     * Find departments by organization ID
     * @param {string} organizationId - Organization ID
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive departments (default: false)
     * @returns {Promise<Array<Department>>} Array of departments
     */
    static async findByOrganization(organizationId, options = {}) {
        if (!organizationId) {
            throw new Error('Organization ID is required');
        }

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
            const result = await query(queryText, [organizationId]);
            return result.rows.map(row => new Department(row));
        } catch (error) {
            logger.error('Error finding departments by organization', { 
                error: error.message, 
                organizationId 
            });
            throw error;
        }
    }

    /**
     * Find department by name within organization
     * @param {string} organizationId - Organization ID
     * @param {string} name - Department name
     * @returns {Promise<Department|null>} Department or null if not found
     */
    static async findByName(organizationId, name) {
        if (!organizationId || !name) {
            throw new Error('Organization ID and department name are required');
        }

        const queryText = `
            SELECT * FROM departments 
            WHERE organization_id = $1 AND name = $2 AND is_active = true
        `;

        try {
            const result = await query(queryText, [organizationId, name]);
            return result.rows.length > 0 ? new Department(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding department by name', { 
                error: error.message, 
                organizationId, 
                name 
            });
            throw error;
        }
    }

    /**
     * Get all active departments
     * @param {Object} options - Query options
     * @param {number} options.limit - Limit results (default: 100)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @returns {Promise<Array<Department>>} Array of departments
     */
    static async findAll(options = {}) {
        const { limit = 100, offset = 0 } = options;

        const queryText = `
            SELECT d.*, o.name as organization_name 
            FROM departments d
            JOIN organizations o ON d.organization_id = o.id
            WHERE d.is_active = true AND o.is_active = true
            ORDER BY d.created_at DESC
            LIMIT $1 OFFSET $2
        `;

        try {
            const result = await query(queryText, [limit, offset]);
            return result.rows.map(row => new Department(row));
        } catch (error) {
            logger.error('Error finding all departments', { 
                error: error.message, 
                options 
            });
            throw error;
        }
    }

    /**
     * Update department
     * @param {Object} updates - Fields to update
     * @param {string} updates.name - Department name
     * @param {string} updates.description - Department description
     * @param {Object} updates.settings - Department settings
     * @param {string} userId - ID of user performing the update (for audit)
     * @returns {Promise<Department>} Updated department
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
                        throw new Error('Department name is required and must be a non-empty string');
                    }
                    if (value.length > 255) {
                        throw new Error('Department name must be 255 characters or less');
                    }
                    updateFields.push(`name = $${paramIndex}`);
                    values.push(value.trim());
                } else if (key === 'settings') {
                    if (value && typeof value !== 'object') {
                        throw new Error('Department settings must be an object');
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
            UPDATE departments 
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex} AND is_active = true
            RETURNING *
        `;

        try {
            const result = await query(queryText, values);
            
            if (result.rows.length === 0) {
                throw new Error('Department not found or inactive');
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

            // Log audit event for department update
            await auditService.logOrganizationalOperation({
                userId,
                operationType: auditService.operationTypes.DEPARTMENT_UPDATE,
                resourceType: 'department',
                resourceId: this.id,
                resourceName: this.name,
                departmentId: this.id,
                organizationId: this.organization_id,
                details: {
                    oldValues,
                    newValues: updates
                }
            }).catch(error => {
                logger.error('Failed to log department update audit:', error);
            });

            logger.info('Department updated', {
                departmentId: this.id,
                updates
            });

            return this;
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error(`Department with name '${updates.name}' already exists in this organization`);
            }
            logger.error('Error updating department', { 
                error: error.message, 
                departmentId: this.id, 
                updates 
            });
            throw error;
        }
    }

    /**
     * Deactivate department (soft delete)
     * This will also deactivate associated users, expert groups, and tasks
     * @param {string} userId - ID of user performing the deactivation (for audit)
     * @returns {Promise<void>}
     */
    async deactivate(userId = null) {
        try {
            await transaction(async (client) => {
                // Deactivate the department
                await client.query(
                    'UPDATE departments SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                    [this.id]
                );

                // Deactivate all users in this department
                await client.query(
                    'UPDATE users SET is_active = false WHERE department_id = $1',
                    [this.id]
                );

                // Deactivate all expert groups in this department
                await client.query(
                    'UPDATE expert_groups SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE department_id = $1',
                    [this.id]
                );

                // Deactivate all tasks in this department
                await client.query(
                    'UPDATE tasks SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE department_id = $1',
                    [this.id]
                );

                // Deactivate master array
                if (this.master_array_id) {
                    await client.query(
                        'UPDATE master_arrays SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                        [this.master_array_id]
                    );
                }
            });

            this.is_active = false;
            
            // Log audit event for department deactivation
            await auditService.logOrganizationalOperation({
                userId,
                operationType: auditService.operationTypes.DEPARTMENT_DELETE,
                resourceType: 'department',
                resourceId: this.id,
                resourceName: this.name,
                departmentId: this.id,
                organizationId: this.organization_id,
                details: {
                    action: 'deactivate',
                    cascadeEffect: 'users, expert_groups, tasks, master_array'
                }
            }).catch(error => {
                logger.error('Failed to log department deactivation audit:', error);
            });
            
            logger.info('Department deactivated with cascade', {
                departmentId: this.id,
                name: this.name
            });
        } catch (error) {
            logger.error('Error deactivating department', { 
                error: error.message, 
                departmentId: this.id 
            });
            throw error;
        }
    }

    /**
     * Get master array for this department
     * @returns {Promise<Object|null>} Master array data or null if not found
     */
    async getMasterArray() {
        if (!this.master_array_id) {
            return null;
        }

        const queryText = `
            SELECT * FROM master_arrays 
            WHERE id = $1 AND is_active = true
        `;

        try {
            const result = await query(queryText, [this.master_array_id]);
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            logger.error('Error getting department master array', { 
                error: error.message, 
                departmentId: this.id,
                masterArrayId: this.master_array_id
            });
            throw error;
        }
    }

    /**
     * Get users belonging to this department
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive users (default: false)
     * @returns {Promise<Array>} Array of users
     */
    async getUsers(options = {}) {
        const { includeInactive = false } = options;
        
        let queryText = `
            SELECT id, username, email, role, organization_id, department_id, created_at, last_login, is_active 
            FROM users 
            WHERE department_id = $1
        `;
        
        if (!includeInactive) {
            queryText += ' AND is_active = true';
        }
        
        queryText += ' ORDER BY created_at ASC';

        try {
            const result = await query(queryText, [this.id]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting department users', { 
                error: error.message, 
                departmentId: this.id 
            });
            throw error;
        }
    }

    /**
     * Get expert groups belonging to this department
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive groups (default: false)
     * @returns {Promise<Array>} Array of expert groups
     */
    async getExpertGroups(options = {}) {
        const { includeInactive = false } = options;
        
        let queryText = `
            SELECT * FROM expert_groups 
            WHERE department_id = $1
        `;
        
        if (!includeInactive) {
            queryText += ' AND is_active = true';
        }
        
        queryText += ' ORDER BY created_at ASC';

        try {
            const result = await query(queryText, [this.id]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting department expert groups', { 
                error: error.message, 
                departmentId: this.id 
            });
            throw error;
        }
    }

    /**
     * Get tasks assigned to this department
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive tasks (default: false)
     * @param {string} options.status - Filter by task status
     * @returns {Promise<Array>} Array of tasks
     */
    async getTasks(options = {}) {
        const { includeInactive = false, status } = options;
        
        let queryText = `
            SELECT * FROM tasks 
            WHERE department_id = $1
        `;
        const params = [this.id];
        let paramIndex = 2;
        
        if (!includeInactive) {
            queryText += ' AND is_active = true';
        }
        
        if (status) {
            queryText += ` AND status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        queryText += ' ORDER BY created_at DESC';

        try {
            const result = await query(queryText, params);
            return result.rows;
        } catch (error) {
            logger.error('Error getting department tasks', { 
                error: error.message, 
                departmentId: this.id 
            });
            throw error;
        }
    }

    /**
     * Validate user access to this department
     * @param {string} userId - User ID to validate
     * @returns {Promise<boolean>} True if user has access, false otherwise
     */
    async validateUserAccess(userId) {
        if (!userId) {
            return false;
        }

        try {
            const result = await query(`
                SELECT u.id, u.role, u.department_id, u.organization_id
                FROM users u
                WHERE u.id = $1 AND u.is_active = true
            `, [userId]);

            if (result.rows.length === 0) {
                return false;
            }

            const user = result.rows[0];

            // System administrators can access any department
            if (user.role === 'system_administrator') {
                return true;
            }

            // Users can only access their own department
            return user.department_id === this.id;
        } catch (error) {
            logger.error('Error validating user access to department', { 
                error: error.message, 
                departmentId: this.id,
                userId 
            });
            return false;
        }
    }

    /**
     * Check if department data is isolated from other departments
     * @param {string} targetDepartmentId - Target department ID to check isolation against
     * @returns {Promise<boolean>} True if properly isolated, false otherwise
     */
    async validateIsolation(targetDepartmentId) {
        if (!targetDepartmentId || targetDepartmentId === this.id) {
            return true; // Same department or no target
        }

        try {
            // Check if departments belong to the same organization
            const result = await query(`
                SELECT 
                    d1.organization_id as org1,
                    d2.organization_id as org2
                FROM departments d1, departments d2
                WHERE d1.id = $1 AND d2.id = $2
            `, [this.id, targetDepartmentId]);

            if (result.rows.length === 0) {
                return false; // One or both departments don't exist
            }

            const { org1, org2 } = result.rows[0];
            
            // Departments in different organizations are always isolated
            if (org1 !== org2) {
                return true;
            }

            // Departments in the same organization are isolated unless explicitly shared
            // Check for shared access configuration in settings
            const sharedAccess = this.settings?.shared_access?.departments || [];
            return !sharedAccess.includes(targetDepartmentId);
        } catch (error) {
            logger.error('Error validating department isolation', { 
                error: error.message, 
                departmentId: this.id,
                targetDepartmentId 
            });
            return false;
        }
    }

    /**
     * Add user to department
     * @param {string} userId - User ID to add
     * @returns {Promise<void>}
     */
    async addUser(userId) {
        if (!userId) {
            throw new Error('User ID is required');
        }

        try {
            await transaction(async (client) => {
                // Verify user exists and get current department
                const userResult = await client.query(
                    'SELECT id, department_id, organization_id FROM users WHERE id = $1 AND is_active = true',
                    [userId]
                );

                if (userResult.rows.length === 0) {
                    throw new Error('User not found or inactive');
                }

                const user = userResult.rows[0];

                // Verify user belongs to the same organization
                if (user.organization_id !== this.organization_id) {
                    throw new Error('User must belong to the same organization as the department');
                }

                // Update user's department
                await client.query(
                    'UPDATE users SET department_id = $1 WHERE id = $2',
                    [this.id, userId]
                );
            });

            logger.info('User added to department', {
                departmentId: this.id,
                userId
            });
        } catch (error) {
            logger.error('Error adding user to department', { 
                error: error.message, 
                departmentId: this.id,
                userId 
            });
            throw error;
        }
    }

    /**
     * Remove user from department
     * @param {string} userId - User ID to remove
     * @returns {Promise<void>}
     */
    async removeUser(userId) {
        if (!userId) {
            throw new Error('User ID is required');
        }

        try {
            const result = await query(
                'UPDATE users SET department_id = NULL WHERE id = $1 AND department_id = $2',
                [userId, this.id]
            );

            if (result.rowCount === 0) {
                throw new Error('User not found in this department');
            }

            logger.info('User removed from department', {
                departmentId: this.id,
                userId
            });
        } catch (error) {
            logger.error('Error removing user from department', { 
                error: error.message, 
                departmentId: this.id,
                userId 
            });
            throw error;
        }
    }

    /**
     * Get department statistics
     * @returns {Promise<Object>} Department statistics
     */
    async getStatistics() {
        try {
            const result = await query(`
                SELECT 
                    (SELECT COUNT(*) FROM users WHERE department_id = $1 AND is_active = true) as active_users,
                    (SELECT COUNT(*) FROM expert_groups WHERE department_id = $1 AND is_active = true) as expert_groups,
                    (SELECT COUNT(*) FROM tasks WHERE department_id = $1 AND is_active = true) as total_tasks,
                    (SELECT COUNT(*) FROM tasks WHERE department_id = $1 AND status = 'assigned' AND is_active = true) as assigned_tasks,
                    (SELECT COUNT(*) FROM tasks WHERE department_id = $1 AND status = 'in_progress' AND is_active = true) as in_progress_tasks,
                    (SELECT COUNT(*) FROM tasks WHERE department_id = $1 AND status = 'completed' AND is_active = true) as completed_tasks,
                    (SELECT COUNT(*) FROM master_array_profiles map 
                     JOIN master_arrays ma ON map.master_array_id = ma.id 
                     WHERE ma.department_id = $1 AND map.is_active = true AND ma.is_active = true) as master_array_profiles
            `, [this.id]);

            const stats = result.rows[0];
            return {
                activeUsers: parseInt(stats.active_users),
                expertGroups: parseInt(stats.expert_groups),
                totalTasks: parseInt(stats.total_tasks),
                assignedTasks: parseInt(stats.assigned_tasks),
                inProgressTasks: parseInt(stats.in_progress_tasks),
                completedTasks: parseInt(stats.completed_tasks),
                masterArrayProfiles: parseInt(stats.master_array_profiles)
            };
        } catch (error) {
            logger.error('Error getting department statistics', { 
                error: error.message, 
                departmentId: this.id 
            });
            throw error;
        }
    }

    /**
     * Convert department to JSON
     * @returns {Object} Department as plain object
     */
    toJSON() {
        return {
            id: this.id,
            organization_id: this.organization_id,
            name: this.name,
            description: this.description,
            master_array_id: this.master_array_id,
            settings: this.settings,
            created_at: this.created_at,
            updated_at: this.updated_at,
            is_active: this.is_active
        };
    }
}

module.exports = Department;