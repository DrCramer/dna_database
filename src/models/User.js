const { query, transaction } = require('../config/database');
const bcrypt = require('bcryptjs');
const { logger } = require('../utils/logger');

class User {
    constructor(userData) {
        this.id = userData.id;
        this.username = userData.username;
        this.email = userData.email;
        this.role = userData.role;
        this.created_at = userData.created_at;
        this.last_login = userData.last_login;
        this.is_active = userData.is_active;
        // Organizational fields
        this.organization_id = userData.organization_id;
        this.department_id = userData.department_id;
        this.accessible_departments = userData.accessible_departments || [];
    }

    // Create a new user
    static async create({ username, email, password, role = 'user_analyst', organization_id = null, department_id = null }) {
        try {
            // Hash password
            const saltRounds = 12;
            const password_hash = await bcrypt.hash(password, saltRounds);

            const result = await query(
                `INSERT INTO users (username, email, password_hash, role, organization_id, department_id) 
                 VALUES ($1, $2, $3, $4, $5, $6) 
                 RETURNING id, username, email, role, created_at, is_active, organization_id, department_id`,
                [username, email, password_hash, role, organization_id, department_id]
            );

            logger.info(`User created: ${username} with role: ${role}, department: ${department_id}`);
            return new User(result.rows[0]);
        } catch (error) {
            logger.error('Error creating user:', error);
            throw error;
        }
    }

    // Find user by username
    static async findByUsername(username) {
        try {
            const result = await query(
                'SELECT * FROM users WHERE username = $1 AND is_active = true',
                [username]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return new User(result.rows[0]);
        } catch (error) {
            logger.error('Error finding user by username:', error);
            throw error;
        }
    }

    // Find user by email
    static async findByEmail(email) {
        try {
            const result = await query(
                'SELECT * FROM users WHERE email = $1 AND is_active = true',
                [email]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return new User(result.rows[0]);
        } catch (error) {
            logger.error('Error finding user by email:', error);
            throw error;
        }
    }

    // Find user by ID
    static async findById(id) {
        try {
            const result = await query(
                'SELECT * FROM users WHERE id = $1 AND is_active = true',
                [id]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return new User(result.rows[0]);
        } catch (error) {
            logger.error('Error finding user by ID:', error);
            throw error;
        }
    }

    // Verify password
    async verifyPassword(password) {
        try {
            const result = await query(
                'SELECT password_hash FROM users WHERE id = $1',
                [this.id]
            );

            if (result.rows.length === 0) {
                return false;
            }

            return await bcrypt.compare(password, result.rows[0].password_hash);
        } catch (error) {
            logger.error('Error verifying password:', error);
            throw error;
        }
    }

    // Update last login timestamp
    async updateLastLogin() {
        try {
            await query(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
                [this.id]
            );
            this.last_login = new Date();
        } catch (error) {
            logger.error('Error updating last login:', error);
            throw error;
        }
    }

    // Get all users (admin only)
    static async findAll() {
        try {
            const result = await query(
                `SELECT id, username, email, role, created_at, last_login, is_active, 
                        organization_id, department_id 
                 FROM users ORDER BY created_at DESC`
            );

            return result.rows.map(row => new User(row));
        } catch (error) {
            logger.error('Error finding all users:', error);
            throw error;
        }
    }

    // Update user role (admin only)
    async updateRole(newRole) {
        try {
            const result = await query(
                'UPDATE users SET role = $1 WHERE id = $2 RETURNING role',
                [newRole, this.id]
            );

            if (result.rows.length > 0) {
                this.role = result.rows[0].role;
                logger.info(`User ${this.username} role updated to: ${newRole}`);
            }

            return this;
        } catch (error) {
            logger.error('Error updating user role:', error);
            throw error;
        }
    }

    // Deactivate user (admin only)
    async deactivate() {
        try {
            await query(
                'UPDATE users SET is_active = false WHERE id = $1',
                [this.id]
            );
            this.is_active = false;
            logger.info(`User ${this.username} deactivated`);
        } catch (error) {
            logger.error('Error deactivating user:', error);
            throw error;
        }
    }

    // Activate user (admin only)
    async activate() {
        try {
            await query(
                'UPDATE users SET is_active = true WHERE id = $1',
                [this.id]
            );
            this.is_active = true;
            logger.info(`User ${this.username} activated`);
        } catch (error) {
            logger.error('Error activating user:', error);
            throw error;
        }
    }

    // Change user password
    async changePassword(newPassword) {
        try {
            const saltRounds = 12;
            const password_hash = await bcrypt.hash(newPassword, saltRounds);

            await query(
                'UPDATE users SET password_hash = $1 WHERE id = $2',
                [password_hash, this.id]
            );

            logger.info(`Password changed for user: ${this.username}`);
        } catch (error) {
            logger.error('Error changing password:', error);
            throw error;
        }
    }

    // Convert to JSON (exclude sensitive data)
    toJSON() {
        return {
            id: this.id,
            username: this.username,
            email: this.email,
            role: this.role,
            created_at: this.created_at,
            last_login: this.last_login,
            is_active: this.is_active,
            organization_id: this.organization_id,
            department_id: this.department_id,
            accessible_departments: this.accessible_departments
        };
    }

    async getAccessibleDepartments() {
        try {
            const result = await query(
                `SELECT 
                    d.id,
                    d.name,
                    d.organization_id,
                    d.description,
                    ud.is_primary
                 FROM user_departments ud
                 JOIN departments d ON d.id = ud.department_id
                 WHERE ud.user_id = $1
                   AND d.is_active = true
                 ORDER BY ud.is_primary DESC, d.name ASC`,
                [this.id]
            );

            if (result.rows.length > 0) {
                this.accessible_departments = result.rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    organization_id: row.organization_id,
                    description: row.description,
                    is_primary: row.is_primary
                }));

                return this.accessible_departments;
            }

            if (!this.department_id) {
                this.accessible_departments = [];
                return [];
            }

            const fallbackResult = await query(
                `SELECT id, name, organization_id, description
                 FROM departments
                 WHERE id = $1 AND is_active = true`,
                [this.department_id]
            );

            this.accessible_departments = fallbackResult.rows.map((row) => ({
                id: row.id,
                name: row.name,
                organization_id: row.organization_id,
                description: row.description,
                is_primary: true
            }));

            return this.accessible_departments;
        } catch (error) {
            logger.error('Error getting accessible departments:', error);
            throw error;
        }
    }

    async syncAccessibleDepartments(departmentIds = [], organizationId = null) {
        try {
            const uniqueDepartmentIds = [...new Set((departmentIds || []).filter(Boolean))];

            if (uniqueDepartmentIds.length === 0) {
                await transaction(async (client) => {
                    await client.query('DELETE FROM user_departments WHERE user_id = $1', [this.id]);
                    await client.query(
                        `UPDATE users
                         SET department_id = NULL,
                             organization_id = COALESCE($1, organization_id)
                         WHERE id = $2`,
                        [organizationId, this.id]
                    );
                });

                this.department_id = null;
                if (organizationId !== null && organizationId !== undefined) {
                    this.organization_id = organizationId;
                }
                this.accessible_departments = [];
                return this;
            }

            const departmentsResult = await query(
                `SELECT id, organization_id, name, description
                 FROM departments
                 WHERE id = ANY($1::uuid[])
                   AND is_active = true`,
                [uniqueDepartmentIds]
            );

            if (departmentsResult.rows.length !== uniqueDepartmentIds.length) {
                throw new Error('One or more selected departments are invalid or inactive');
            }

            const actualOrganizationId = organizationId || departmentsResult.rows[0].organization_id;
            const primaryDepartmentId = uniqueDepartmentIds[0];

            await transaction(async (client) => {
                await client.query('DELETE FROM user_departments WHERE user_id = $1', [this.id]);

                for (const deptId of uniqueDepartmentIds) {
                    await client.query(
                        `INSERT INTO user_departments (user_id, department_id, is_primary)
                         VALUES ($1, $2, $3)`,
                        [this.id, deptId, deptId === primaryDepartmentId]
                    );
                }

                await client.query(
                    `UPDATE users
                     SET department_id = $1,
                         organization_id = $2
                     WHERE id = $3`,
                    [primaryDepartmentId, actualOrganizationId, this.id]
                );
            });

            this.department_id = primaryDepartmentId;
            this.organization_id = actualOrganizationId;
            this.accessible_departments = departmentsResult.rows
                .sort((a, b) => uniqueDepartmentIds.indexOf(a.id) - uniqueDepartmentIds.indexOf(b.id))
                .map((row) => ({
                    id: row.id,
                    name: row.name,
                    organization_id: row.organization_id,
                    description: row.description,
                    is_primary: row.id === primaryDepartmentId
                }));

            return this;
        } catch (error) {
            logger.error('Error syncing accessible departments:', error);
            throw error;
        }
    }

    // Get user's organization
    async getOrganization() {
        if (!this.organization_id) {
            return null;
        }

        try {
            const result = await query(
                'SELECT * FROM organizations WHERE id = $1 AND is_active = true',
                [this.organization_id]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const Organization = require('./Organization');
            return new Organization(result.rows[0]);
        } catch (error) {
            logger.error('Error getting user organization:', error);
            throw error;
        }
    }

    // Get user's department
    async getDepartment(departmentId = null) {
        const targetDepartmentId = departmentId || this.department_id;

        if (!targetDepartmentId) {
            return null;
        }

        try {
            const result = await query(
                'SELECT * FROM departments WHERE id = $1 AND is_active = true',
                [targetDepartmentId]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const Department = require('./Department');
            return new Department(result.rows[0]);
        } catch (error) {
            logger.error('Error getting user department:', error);
            throw error;
        }
    }

    // Get user's expert groups
    async getExpertGroups() {
        try {
            const result = await query(
                `SELECT eg.* FROM expert_groups eg
                 JOIN expert_group_members egm ON eg.id = egm.group_id
                 WHERE egm.user_id = $1 AND eg.is_active = true
                 ORDER BY eg.name`,
                [this.id]
            );

            const ExpertGroup = require('./ExpertGroup');
            return result.rows.map(row => new ExpertGroup(row));
        } catch (error) {
            logger.error('Error getting user expert groups:', error);
            throw error;
        }
    }

    // Get accessible master arrays for this user
    async getAccessibleMasterArrays() {
        try {
            const result = await query(
                'SELECT * FROM get_user_accessible_master_arrays($1)',
                [this.id]
            );

            return result.rows.map(row => ({
                master_array_id: row.master_array_id,
                department_name: row.department_name,
                array_name: row.array_name
            }));
        } catch (error) {
            logger.error('Error getting accessible master arrays:', error);
            throw error;
        }
    }

    // Get user's tasks
    async getTasks(status = null) {
        try {
            let query_text = `
                SELECT t.* FROM tasks t
                WHERE (t.assigned_to_user = $1 OR 
                       t.assigned_to_group IN (
                           SELECT egm.expert_group_id FROM expert_group_members egm 
                           WHERE egm.user_id = $1
                       ))
                AND t.is_active = true
            `;
            let params = [this.id];

            if (status) {
                query_text += ' AND t.status = $2';
                params.push(status);
            }

            query_text += ' ORDER BY t.created_at DESC';

            const result = await query(query_text, params);

            // Import Task model dynamically to avoid circular dependency
            const Task = require('./Task');
            return result.rows.map(row => new Task(row));
        } catch (error) {
            logger.error('Error getting user tasks:', error);
            throw error;
        }
    }

    // Assign user to department
    async assignToDepartment(departmentId) {
        try {
            const result = await query(
                `UPDATE users 
                 SET department_id = $1, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $2 
                 RETURNING department_id`,
                [departmentId, this.id]
            );

            if (result.rows.length > 0) {
                this.department_id = result.rows[0].department_id;
                logger.info(`User ${this.username} assigned to department: ${departmentId}`);
            }

            return this;
        } catch (error) {
            logger.error('Error assigning user to department:', error);
            throw error;
        }
    }

    // Assign user to organization
    async assignToOrganization(organizationId) {
        try {
            const result = await query(
                `UPDATE users 
                 SET organization_id = $1, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $2 
                 RETURNING organization_id`,
                [organizationId, this.id]
            );

            if (result.rows.length > 0) {
                this.organization_id = result.rows[0].organization_id;
                logger.info(`User ${this.username} assigned to organization: ${organizationId}`);
            }

            return this;
        } catch (error) {
            logger.error('Error assigning user to organization:', error);
            throw error;
        }
    }

    // Add user to expert group
    async addToExpertGroup(groupId, addedBy) {
        try {
            await query(
                `INSERT INTO expert_group_members (expert_group_id, user_id)
                 VALUES ($1, $2)
                 ON CONFLICT (expert_group_id, user_id) DO NOTHING`,
                [groupId, this.id]
            );

            logger.info(`User ${this.username} added to expert group: ${groupId}`);
            return this;
        } catch (error) {
            logger.error('Error adding user to expert group:', error);
            throw error;
        }
    }

    // Remove user from expert group
    async removeFromExpertGroup(groupId) {
        try {
            await query(
                `DELETE FROM expert_group_members 
                 WHERE expert_group_id = $1 AND user_id = $2`,
                [groupId, this.id]
            );

            logger.info(`User ${this.username} removed from expert group: ${groupId}`);
            return this;
        } catch (error) {
            logger.error('Error removing user from expert group:', error);
            throw error;
        }
    }

    // Find users by department
    static async findByDepartment(departmentId) {
        try {
            const result = await query(
                `SELECT * FROM users 
                 WHERE department_id = $1 AND is_active = true 
                 ORDER BY username`,
                [departmentId]
            );

            return result.rows.map(row => new User(row));
        } catch (error) {
            logger.error('Error finding users by department:', error);
            throw error;
        }
    }

    // Find users by expert group
    static async findByExpertGroup(groupId) {
        try {
            const result = await query(
                `SELECT u.* FROM users u
                 JOIN expert_group_members egm ON u.id = egm.user_id
                 WHERE egm.expert_group_id = $1 AND u.is_active = true
                 ORDER BY u.username`,
                [groupId]
            );

            return result.rows.map(row => new User(row));
        } catch (error) {
            logger.error('Error finding users by expert group:', error);
            throw error;
        }
    }
}

module.exports = User;
