const { query, transaction } = require('../config/database');
const { logger } = require('../utils/logger');
const auditService = require('../services/auditService');

class ExpertGroup {
    constructor(data) {
        this.id = data.id;
        this.department_id = data.department_id;
        this.name = data.name;
        this.description = data.description;
        this.created_by = data.created_by;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.is_active = data.is_active;
    }

    /**
     * Create a new expert group
     * @param {Object} groupData - Expert group data
     * @param {string} groupData.department_id - Department ID (required)
     * @param {string} groupData.name - Group name (required)
     * @param {string} groupData.description - Group description
     * @param {string} groupData.created_by - Creator user ID (required)
     * @returns {Promise<ExpertGroup>} Created expert group
     */
    static async create(groupData) {
        const { department_id, name, description, created_by } = groupData;

        // Validate required fields
        if (!department_id) {
            throw new Error('Department ID is required');
        }

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            throw new Error('Expert group name is required and must be a non-empty string');
        }

        if (name.length > 255) {
            throw new Error('Expert group name must be 255 characters or less');
        }

        if (!created_by) {
            throw new Error('Creator user ID is required');
        }

        try {
            const result = await transaction(async (client) => {
                // Verify department exists and is active
                const deptResult = await client.query(
                    'SELECT id FROM departments WHERE id = $1 AND is_active = true',
                    [department_id]
                );

                if (deptResult.rows.length === 0) {
                    throw new Error('Department not found or inactive');
                }

                // Verify creator exists and belongs to the department
                const userResult = await client.query(
                    'SELECT id, role, department_id FROM users WHERE id = $1 AND is_active = true',
                    [created_by]
                );

                if (userResult.rows.length === 0) {
                    throw new Error('Creator user not found or inactive');
                }

                const user = userResult.rows[0];
                
                // Only department heads and system administrators can create expert groups
                if (!['department_head', 'system_administrator'].includes(user.role)) {
                    throw new Error('Only department heads and system administrators can create expert groups');
                }

                // Verify user belongs to the same department (unless system admin)
                if (user.role !== 'system_administrator' && user.department_id !== department_id) {
                    throw new Error('Creator must belong to the same department');
                }

                // Create expert group
                const groupResult = await client.query(`
                    INSERT INTO expert_groups (department_id, name, description, created_by)
                    VALUES ($1, $2, $3, $4)
                    RETURNING *
                `, [
                    department_id,
                    name.trim(),
                    description || null,
                    created_by
                ]);

                return groupResult.rows[0];
            });

            const expertGroup = new ExpertGroup(result);
            
            // Log audit event for expert group creation
            await auditService.logExpertGroupOperation({
                userId: expertGroup.created_by,
                groupId: expertGroup.id,
                operationType: auditService.operationTypes.EXPERT_GROUP_CREATE,
                departmentId: expertGroup.department_id,
                details: {
                    name: expertGroup.name,
                    description: expertGroup.description
                }
            }).catch(error => {
                logger.error('Failed to log expert group creation audit:', error);
            });
            
            logger.info('Expert group created', {
                groupId: expertGroup.id,
                name: expertGroup.name,
                departmentId: expertGroup.department_id,
                createdBy: expertGroup.created_by
            });

            return expertGroup;
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error(`Expert group with name '${name}' already exists in this department`);
            }
            logger.error('Error creating expert group', { 
                error: error.message, 
                groupData 
            });
            throw error;
        }
    }

    /**
     * Find expert group by ID
     * @param {string} id - Expert group ID
     * @returns {Promise<ExpertGroup|null>} Expert group or null if not found
     */
    static async findById(id) {
        if (!id) {
            throw new Error('Expert group ID is required');
        }

        const queryText = `
            SELECT * FROM expert_groups 
            WHERE id = $1 AND is_active = true
        `;

        try {
            const result = await query(queryText, [id]);
            return result.rows.length > 0 ? new ExpertGroup(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding expert group by ID', { 
                error: error.message, 
                id 
            });
            throw error;
        }
    }

    /**
     * Find expert groups by department ID
     * @param {string} departmentId - Department ID
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive groups (default: false)
     * @returns {Promise<Array<ExpertGroup>>} Array of expert groups
     */
    static async findByDepartment(departmentId, options = {}) {
        if (!departmentId) {
            throw new Error('Department ID is required');
        }

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
            const result = await query(queryText, [departmentId]);
            return result.rows.map(row => new ExpertGroup(row));
        } catch (error) {
            logger.error('Error finding expert groups by department', { 
                error: error.message, 
                departmentId 
            });
            throw error;
        }
    }

    /**
     * Find expert group by name within department
     * @param {string} departmentId - Department ID
     * @param {string} name - Expert group name
     * @returns {Promise<ExpertGroup|null>} Expert group or null if not found
     */
    static async findByName(departmentId, name) {
        if (!departmentId || !name) {
            throw new Error('Department ID and expert group name are required');
        }

        const queryText = `
            SELECT * FROM expert_groups 
            WHERE department_id = $1 AND name = $2 AND is_active = true
        `;

        try {
            const result = await query(queryText, [departmentId, name]);
            return result.rows.length > 0 ? new ExpertGroup(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding expert group by name', { 
                error: error.message, 
                departmentId, 
                name 
            });
            throw error;
        }
    }

    /**
     * Find expert groups that a user belongs to
     * @param {string} userId - User ID
     * @returns {Promise<Array<ExpertGroup>>} Array of expert groups
     */
    static async findByUser(userId) {
        if (!userId) {
            throw new Error('User ID is required');
        }

        const queryText = `
            SELECT eg.* FROM expert_groups eg
            JOIN expert_group_members egm ON eg.id = egm.group_id
            WHERE egm.user_id = $1 AND eg.is_active = true
            ORDER BY eg.created_at ASC
        `;

        try {
            const result = await query(queryText, [userId]);
            return result.rows.map(row => new ExpertGroup(row));
        } catch (error) {
            logger.error('Error finding expert groups by user', { 
                error: error.message, 
                userId 
            });
            throw error;
        }
    }

    /**
     * Update expert group
     * @param {Object} updates - Fields to update
     * @param {string} updates.name - Group name
     * @param {string} updates.description - Group description
     * @param {string} userId - ID of user performing the update (for audit)
     * @returns {Promise<ExpertGroup>} Updated expert group
     */
    async update(updates, userId = null) {
        const allowedFields = ['name', 'description'];
        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                if (key === 'name') {
                    if (!value || typeof value !== 'string' || value.trim().length === 0) {
                        throw new Error('Expert group name is required and must be a non-empty string');
                    }
                    if (value.length > 255) {
                        throw new Error('Expert group name must be 255 characters or less');
                    }
                    updateFields.push(`name = $${paramIndex}`);
                    values.push(value.trim());
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
            UPDATE expert_groups 
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex} AND is_active = true
            RETURNING *
        `;

        try {
            const result = await query(queryText, values);
            
            if (result.rows.length === 0) {
                throw new Error('Expert group not found or inactive');
            }

            // Store old values for audit
            const oldValues = {
                name: this.name,
                description: this.description
            };

            // Update instance properties
            const updatedData = result.rows[0];
            Object.assign(this, updatedData);

            // Log audit event for expert group update
            await auditService.logExpertGroupOperation({
                userId,
                groupId: this.id,
                operationType: auditService.operationTypes.EXPERT_GROUP_UPDATE,
                departmentId: this.department_id,
                details: {
                    oldValues,
                    newValues: updates
                }
            }).catch(error => {
                logger.error('Failed to log expert group update audit:', error);
            });

            logger.info('Expert group updated', {
                groupId: this.id,
                updates
            });

            return this;
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error(`Expert group with name '${updates.name}' already exists in this department`);
            }
            logger.error('Error updating expert group', { 
                error: error.message, 
                groupId: this.id, 
                updates 
            });
            throw error;
        }
    }

    /**
     * Deactivate expert group (soft delete)
     * This will also deactivate group memberships and reassign tasks
     * @param {string} userId - ID of user performing the deactivation (for audit)
     * @returns {Promise<void>}
     */
    async deactivate(userId = null) {
        try {
            await transaction(async (client) => {
                // Deactivate the expert group
                await client.query(
                    'UPDATE expert_groups SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                    [this.id]
                );

                // Deactivate all group memberships
                await client.query(
                    'DELETE FROM expert_group_members WHERE group_id = $1',
                    [this.id]
                );

                // Update tasks assigned to this group to be unassigned
                await client.query(
                    'UPDATE tasks SET assigned_to_group = NULL, updated_at = CURRENT_TIMESTAMP WHERE assigned_to_group = $1 AND is_active = true',
                    [this.id]
                );
            });

            this.is_active = false;
            
            // Log audit event for expert group deactivation
            await auditService.logExpertGroupOperation({
                userId,
                groupId: this.id,
                operationType: auditService.operationTypes.EXPERT_GROUP_DELETE,
                departmentId: this.department_id,
                details: {
                    action: 'deactivate',
                    cascadeEffect: 'group_memberships, task_reassignments'
                }
            }).catch(error => {
                logger.error('Failed to log expert group deactivation audit:', error);
            });
            
            logger.info('Expert group deactivated with cascade', {
                groupId: this.id,
                name: this.name
            });
        } catch (error) {
            logger.error('Error deactivating expert group', { 
                error: error.message, 
                groupId: this.id 
            });
            throw error;
        }
    }

    /**
     * Add member to expert group
     * @param {string} userId - User ID to add
     * @param {string} addedBy - User ID of the person adding the member
     * @returns {Promise<void>}
     */
    async addMember(userId, addedBy) {
        if (!userId) {
            throw new Error('User ID is required');
        }

        if (!addedBy) {
            throw new Error('Added by user ID is required');
        }

        try {
            await transaction(async (client) => {
                // Verify user exists and belongs to the same department
                const userResult = await client.query(`
                    SELECT u.id, u.department_id, u.role, d.organization_id
                    FROM users u
                    JOIN departments d ON u.department_id = d.id
                    WHERE u.id = $1 AND u.is_active = true
                `, [userId]);

                if (userResult.rows.length === 0) {
                    throw new Error('User not found or inactive');
                }

                const user = userResult.rows[0];

                // Verify user belongs to the same department as the expert group
                if (user.department_id !== this.department_id) {
                    throw new Error('User must belong to the same department as the expert group');
                }

                // Verify the person adding the member has permission
                const adderResult = await client.query(
                    'SELECT id, role, department_id FROM users WHERE id = $1 AND is_active = true',
                    [addedBy]
                );

                if (adderResult.rows.length === 0) {
                    throw new Error('Adding user not found or inactive');
                }

                const adder = adderResult.rows[0];

                // Only department heads, system administrators, or group creator can add members
                if (!['department_head', 'system_administrator'].includes(adder.role) && 
                    adder.id !== this.created_by) {
                    throw new Error('Only department heads, system administrators, or group creator can add members');
                }

                // Check if user is already a member
                const memberResult = await client.query(
                    'SELECT id FROM expert_group_members WHERE group_id = $1 AND user_id = $2',
                    [this.id, userId]
                );

                if (memberResult.rows.length > 0) {
                    throw new Error('User is already a member of this expert group');
                }

                // Add member
                await client.query(`
                    INSERT INTO expert_group_members (group_id, user_id, added_by)
                    VALUES ($1, $2, $3)
                `, [this.id, userId, addedBy]);
            });

            // Log audit event for member addition
            await auditService.logExpertGroupOperation({
                userId: addedBy,
                groupId: this.id,
                operationType: auditService.operationTypes.EXPERT_GROUP_MEMBER_ADD,
                memberUserId: userId,
                departmentId: this.department_id,
                details: {
                    memberUserId: userId,
                    addedBy: addedBy
                }
            }).catch(error => {
                logger.error('Failed to log expert group member addition audit:', error);
            });

            logger.info('Member added to expert group', {
                groupId: this.id,
                userId,
                addedBy
            });
        } catch (error) {
            logger.error('Error adding member to expert group', { 
                error: error.message, 
                groupId: this.id,
                userId,
                addedBy
            });
            throw error;
        }
    }

    /**
     * Remove member from expert group
     * @param {string} userId - User ID to remove
     * @param {string} removedBy - ID of user performing the removal (for audit)
     * @returns {Promise<void>}
     */
    async removeMember(userId, removedBy = null) {
        if (!userId) {
            throw new Error('User ID is required');
        }

        try {
            const result = await query(
                'DELETE FROM expert_group_members WHERE group_id = $1 AND user_id = $2',
                [this.id, userId]
            );

            if (result.rowCount === 0) {
                throw new Error('User is not a member of this expert group');
            }

            // Log audit event for member removal
            await auditService.logExpertGroupOperation({
                userId: removedBy,
                groupId: this.id,
                operationType: auditService.operationTypes.EXPERT_GROUP_MEMBER_REMOVE,
                memberUserId: userId,
                departmentId: this.department_id,
                details: {
                    memberUserId: userId,
                    removedBy: removedBy
                }
            }).catch(error => {
                logger.error('Failed to log expert group member removal audit:', error);
            });

            logger.info('Member removed from expert group', {
                groupId: this.id,
                userId
            });
        } catch (error) {
            logger.error('Error removing member from expert group', { 
                error: error.message, 
                groupId: this.id,
                userId
            });
            throw error;
        }
    }

    /**
     * Get all members of the expert group
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive members (default: false)
     * @returns {Promise<Array>} Array of group members with user details
     */
    async getMembers(options = {}) {
        const { includeInactive = false } = options;
        
        let queryText = `
            SELECT 
                u.id, u.username, u.email, u.role, u.department_id,
                egm.added_at
            FROM expert_group_members egm
            JOIN users u ON egm.user_id = u.id
            WHERE egm.group_id = $1
        `;
        
        queryText += ' AND u.is_active = true';
        
        queryText += ' ORDER BY egm.added_at ASC';

        try {
            const result = await query(queryText, [this.id]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting expert group members', { 
                error: error.message, 
                groupId: this.id 
            });
            throw error;
        }
    }

    /**
     * Get tasks assigned to this expert group
     * @param {Object} options - Query options
     * @param {boolean} options.includeInactive - Include inactive tasks (default: false)
     * @param {string} options.status - Filter by task status
     * @returns {Promise<Array>} Array of tasks
     */
    async getTasks(options = {}) {
        const { includeInactive = false, status } = options;
        
        let queryText = `
            SELECT * FROM tasks 
            WHERE assigned_to_group = $1
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
            logger.error('Error getting expert group tasks', { 
                error: error.message, 
                groupId: this.id 
            });
            throw error;
        }
    }

    /**
     * Get activity history for the expert group
     * @param {Object} options - Query options
     * @param {number} options.limit - Limit results (default: 50)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @returns {Promise<Array>} Array of activity records
     */
    async getActivityHistory(options = {}) {
        const { limit = 50, offset = 0 } = options;

        const queryText = `
            SELECT 
                'member_added' as activity_type,
                egm.added_at as activity_date,
                u.username as subject_user,
                adder.username as actor_user,
                'Member added to group' as description
            FROM expert_group_members egm
            JOIN users u ON egm.user_id = u.id
            JOIN users adder ON egm.added_by = adder.id
            WHERE egm.group_id = $1
            
            UNION ALL
            
            SELECT 
                'task_assigned' as activity_type,
                t.created_at as activity_date,
                creator.username as subject_user,
                creator.username as actor_user,
                'Task assigned to group: ' || t.title as description
            FROM tasks t
            JOIN users creator ON t.created_by = creator.id
            WHERE t.assigned_to_group = $1 AND t.is_active = true
            
            UNION ALL
            
            SELECT 
                'task_status_changed' as activity_type,
                t.updated_at as activity_date,
                NULL as subject_user,
                NULL as actor_user,
                'Task status changed: ' || t.title || ' -> ' || t.status as description
            FROM tasks t
            WHERE t.assigned_to_group = $1 AND t.is_active = true
            
            ORDER BY activity_date DESC
            LIMIT $2 OFFSET $3
        `;

        try {
            const result = await query(queryText, [this.id, limit, offset]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting expert group activity history', { 
                error: error.message, 
                groupId: this.id 
            });
            throw error;
        }
    }

    /**
     * Check if user is a member of this expert group
     * @param {string} userId - User ID to check
     * @returns {Promise<boolean>} True if user is a member, false otherwise
     */
    async isMember(userId) {
        if (!userId) {
            return false;
        }

        try {
            const result = await query(
                'SELECT id FROM expert_group_members WHERE group_id = $1 AND user_id = $2',
                [this.id, userId]
            );

            return result.rows.length > 0;
        } catch (error) {
            logger.error('Error checking expert group membership', { 
                error: error.message, 
                groupId: this.id,
                userId 
            });
            return false;
        }
    }

    /**
     * Get expert group statistics
     * @returns {Promise<Object>} Expert group statistics
     */
    async getStatistics() {
        try {
            const result = await query(`
                SELECT 
                    (SELECT COUNT(*) FROM expert_group_members WHERE group_id = $1) as active_members,
                    (SELECT COUNT(*) FROM tasks WHERE assigned_to_group = $1 AND is_active = true) as total_tasks,
                    (SELECT COUNT(*) FROM tasks WHERE assigned_to_group = $1 AND status = 'assigned' AND is_active = true) as assigned_tasks,
                    (SELECT COUNT(*) FROM tasks WHERE assigned_to_group = $1 AND status = 'in_progress' AND is_active = true) as in_progress_tasks,
                    (SELECT COUNT(*) FROM tasks WHERE assigned_to_group = $1 AND status = 'completed' AND is_active = true) as completed_tasks,
                    (SELECT COUNT(*) FROM task_comments tc 
                     JOIN tasks t ON tc.task_id = t.id 
                     WHERE t.assigned_to_group = $1 AND t.is_active = true) as total_comments
            `, [this.id]);

            const stats = result.rows[0];
            return {
                activeMembers: parseInt(stats.active_members),
                totalTasks: parseInt(stats.total_tasks),
                assignedTasks: parseInt(stats.assigned_tasks),
                inProgressTasks: parseInt(stats.in_progress_tasks),
                completedTasks: parseInt(stats.completed_tasks),
                totalComments: parseInt(stats.total_comments)
            };
        } catch (error) {
            logger.error('Error getting expert group statistics', { 
                error: error.message, 
                groupId: this.id 
            });
            throw error;
        }
    }

    /**
     * Validate user access to this expert group
     * @param {string} userId - User ID to validate
     * @returns {Promise<boolean>} True if user has access, false otherwise
     */
    async validateUserAccess(userId) {
        if (!userId) {
            return false;
        }

        try {
            const result = await query(`
                SELECT u.id, u.role, u.department_id
                FROM users u
                WHERE u.id = $1 AND u.is_active = true
            `, [userId]);

            if (result.rows.length === 0) {
                return false;
            }

            const user = result.rows[0];

            // System administrators can access any expert group
            if (user.role === 'system_administrator') {
                return true;
            }

            // Department heads can access groups in their department
            if (user.role === 'department_head' && user.department_id === this.department_id) {
                return true;
            }

            // Group creator can access their group
            if (user.id === this.created_by) {
                return true;
            }

            // Group members can access their group
            return await this.isMember(userId);
        } catch (error) {
            logger.error('Error validating user access to expert group', { 
                error: error.message, 
                groupId: this.id,
                userId 
            });
            return false;
        }
    }

    /**
     * Convert expert group to JSON
     * @returns {Object} Expert group as plain object
     */
    toJSON() {
        return {
            id: this.id,
            department_id: this.department_id,
            name: this.name,
            description: this.description,
            created_by: this.created_by,
            created_at: this.created_at,
            updated_at: this.updated_at,
            is_active: this.is_active
        };
    }
}

module.exports = ExpertGroup;