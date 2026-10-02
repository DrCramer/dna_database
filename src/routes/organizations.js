const express = require('express');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const ExpertGroup = require('../models/ExpertGroup');
const { authenticate, adminOnly, departmentHeadOrAdmin } = require('../middleware/auth');
const { 
    validateUUID,
    validateOrgParams,
    validateOrgDeptParams,
    validatePagination,
    validateCreateOrganization,
    validateUpdateOrganization,
    validateCreateDepartment,
    validateUpdateDepartment,
    validateCreateExpertGroup,
    validateUpdateExpertGroup
} = require('../middleware/validation');
const { logger } = require('../utils/logger');
const authService = require('../services/authService');

const router = express.Router();

// Helper function to get client info
function getClientInfo(req) {
    return {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || 'Unknown'
    };
}

// ============================================================================
// ORGANIZATION ROUTES
// ============================================================================

// GET /api/organizations - Get all organizations (department head or admin)
router.get('/', authenticate, departmentHeadOrAdmin, validatePagination, async (req, res) => {
    try {
        const { page = 1, limit = 10, orderBy = 'created_at', orderDirection = 'DESC' } = req.query;
        const offset = (page - 1) * limit;

        // Validate orderBy field to prevent SQL injection
        const allowedOrderFields = ['name', 'created_at', 'updated_at'];
        const safeOrderBy = allowedOrderFields.includes(orderBy) ? orderBy : 'created_at';
        const safeOrderDirection = ['ASC', 'DESC'].includes(orderDirection.toUpperCase()) 
            ? orderDirection.toUpperCase() 
            : 'DESC';

        const { query } = require('../config/database');
        
        // Get organizations with department count
        const result = await query(`
            SELECT 
                o.*,
                COALESCE(COUNT(DISTINCT d.id), 0)::integer as department_count
            FROM organizations o
            LEFT JOIN departments d ON o.id = d.organization_id AND d.is_active = true
            WHERE o.is_active = true
            GROUP BY o.id
            ORDER BY o.${safeOrderBy} ${safeOrderDirection}
            LIMIT $1 OFFSET $2
        `, [parseInt(limit), parseInt(offset)]);

        const organizations = result.rows.map(row => new Organization(row));

        // Get total count for pagination
        const countResult = await query('SELECT COUNT(*) FROM organizations WHERE is_active = true');
        const total = parseInt(countResult.rows[0].count);

        res.status(200).json({
            success: true,
            data: {
                organizations: organizations.map(org => ({
                    ...org.toJSON(),
                    department_count: org.department_count || 0
                })),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get organizations failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve organizations'
        });
    }
});

// GET /api/organizations/departments - Get all departments (department head or admin)
router.get('/departments', authenticate, departmentHeadOrAdmin, async (req, res) => {
    try {
        const { query } = require('../config/database');
        
        const result = await query(`
            SELECT 
                d.id, 
                d.name, 
                d.description, 
                d.organization_id, 
                d.is_active,
                d.created_at,
                d.master_array_id,
                o.name as organization_name,
                COALESCE(COUNT(DISTINCT u.id), 0)::integer as user_count,
                COALESCE(
                    (SELECT COUNT(*) FROM master_array_profiles WHERE master_array_id = d.master_array_id AND is_active = true),
                    0
                )::integer as profile_count
            FROM departments d
            LEFT JOIN organizations o ON d.organization_id = o.id
            LEFT JOIN users u ON d.id = u.department_id AND u.is_active = true
            WHERE d.is_active = true
            GROUP BY d.id, d.name, d.description, d.organization_id, d.is_active, d.created_at, d.master_array_id, o.name
            ORDER BY o.name, d.name
        `);

        res.status(200).json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        logger.error('Get all departments failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve departments'
        });
    }
});

// GET /api/organizations/:id - Get specific organization (admin only)
router.get('/:id', authenticate, adminOnly, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;
        
        const organization = await Organization.findById(id);
        if (!organization) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Organization not found'
            });
        }

        // Get additional details
        const [departments, users, entityCounts] = await Promise.all([
            organization.getDepartments(),
            organization.getUsers(),
            organization.getEntityCounts()
        ]);

        res.status(200).json({
            success: true,
            data: {
                organization: organization.toJSON(),
                departments,
                users,
                stats: entityCounts
            }
        });

    } catch (error) {
        logger.error('Get organization failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve organization'
        });
    }
});

// POST /api/organizations - Create new organization (admin only)
router.post('/', authenticate, adminOnly, validateCreateOrganization, async (req, res) => {
    try {
        const { name, description, settings } = req.body;
        const clientInfo = getClientInfo(req);

        const organization = await Organization.create({
            name,
            description,
            settings
        });

        // Log admin action
        await authService.logOperation(req.user.id, 'ORGANIZATION_CREATE', {
            ...clientInfo,
            organizationId: organization.id,
            organizationName: organization.name
        });

        res.status(201).json({
            success: true,
            message: 'Organization created successfully',
            data: {
                organization: organization.toJSON()
            }
        });

    } catch (error) {
        logger.error('Create organization failed:', error.message);
        
        if (error.message.includes('already exists')) {
            return res.status(409).json({
                error: 'Conflict',
                message: error.message
            });
        }

        res.status(400).json({
            error: 'Organization Creation Failed',
            message: error.message || 'Failed to create organization'
        });
    }
});

// PUT /api/organizations/:id - Update organization (admin only)
router.put('/:id', authenticate, adminOnly, validateUUID, validateUpdateOrganization, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const clientInfo = getClientInfo(req);

        const organization = await Organization.findById(id);
        if (!organization) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Organization not found'
            });
        }

        await organization.update(updates);

        // Log admin action
        await authService.logOperation(req.user.id, 'ORGANIZATION_UPDATE', {
            ...clientInfo,
            organizationId: organization.id,
            organizationName: organization.name,
            updates
        });

        res.status(200).json({
            success: true,
            message: 'Organization updated successfully',
            data: {
                organization: organization.toJSON()
            }
        });

    } catch (error) {
        logger.error('Update organization failed:', error.message);
        
        if (error.message.includes('already exists')) {
            return res.status(409).json({
                error: 'Conflict',
                message: error.message
            });
        }

        res.status(400).json({
            error: 'Organization Update Failed',
            message: error.message || 'Failed to update organization'
        });
    }
});

// DELETE /api/organizations/:id - Deactivate organization (admin only)
router.delete('/:id', authenticate, adminOnly, validateUUID, async (req, res) => {
    try {
        const { id } = req.params;
        const clientInfo = getClientInfo(req);

        const organization = await Organization.findById(id);
        if (!organization) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Organization not found'
            });
        }

        await organization.deactivate();

        // Log admin action
        await authService.logOperation(req.user.id, 'ORGANIZATION_DEACTIVATE', {
            ...clientInfo,
            organizationId: organization.id,
            organizationName: organization.name
        });

        res.status(200).json({
            success: true,
            message: 'Organization deactivated successfully'
        });

    } catch (error) {
        logger.error('Deactivate organization failed:', error.message);
        
        res.status(500).json({
            error: 'Organization Deactivation Failed',
            message: 'Failed to deactivate organization'
        });
    }
});

// ============================================================================
// DEPARTMENT ROUTES
// ============================================================================

// GET /api/organizations/:orgId/departments - Get departments in organization
router.get('/:orgId/departments', authenticate, departmentHeadOrAdmin, validateOrgParams, validatePagination, async (req, res) => {
    try {
        const { orgId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        // Verify organization exists and user has access
        const organization = await Organization.findById(orgId);
        if (!organization) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Organization not found'
            });
        }

        // Check if user has access to this organization
        if (req.user.role !== 'system_administrator' && req.user.organization_id !== orgId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied to this organization'
            });
        }

        const { query } = require('../config/database');
        
        // Get total count
        const countResult = await query(
            'SELECT COUNT(*) FROM departments WHERE organization_id = $1 AND is_active = true',
            [orgId]
        );
        const total = parseInt(countResult.rows[0].count);

        // Get paginated departments
        const result = await query(`
            SELECT d.*, ma.id as master_array_id, ma.name as master_array_name
            FROM departments d
            LEFT JOIN master_arrays ma ON d.id = ma.department_id AND ma.is_active = true
            WHERE d.organization_id = $1 AND d.is_active = true
            ORDER BY d.created_at DESC
            LIMIT $2 OFFSET $3
        `, [orgId, limit, offset]);

        const departments = result.rows.map(row => new Department(row));

        res.status(200).json({
            success: true,
            data: {
                organization: organization.toJSON(),
                departments: departments.map(dept => dept.toJSON()),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get departments failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve departments'
        });
    }
});

// POST /api/organizations/:orgId/departments - Create department in organization
router.post('/:orgId/departments', authenticate, adminOnly, validateOrgParams, validateCreateDepartment, async (req, res) => {
    try {
        const { orgId } = req.params;
        const { name, description, settings } = req.body;
        const clientInfo = getClientInfo(req);

        // Verify organization exists
        const organization = await Organization.findById(orgId);
        if (!organization) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Organization not found'
            });
        }

        const department = await Department.create({
            organization_id: orgId,
            name,
            description,
            settings
        });

        // Log admin action
        await authService.logOperation(req.user.id, 'DEPARTMENT_CREATE', {
            ...clientInfo,
            organizationId: orgId,
            departmentId: department.id,
            departmentName: department.name
        });

        res.status(201).json({
            success: true,
            message: 'Department created successfully',
            data: {
                department: department.toJSON()
            }
        });

    } catch (error) {
        logger.error('Create department failed:', error.message);
        
        if (error.message.includes('already exists')) {
            return res.status(409).json({
                error: 'Conflict',
                message: error.message
            });
        }

        res.status(400).json({
            error: 'Department Creation Failed',
            message: error.message || 'Failed to create department'
        });
    }
});

// PUT /api/organizations/:orgId/departments/:deptId - Update department
router.put('/:orgId/departments/:deptId', authenticate, adminOnly, validateOrgDeptParams, validateUpdateDepartment, async (req, res) => {
    try {
        const { orgId, deptId } = req.params;
        const updates = req.body;
        const clientInfo = getClientInfo(req);

        // Verify department exists and belongs to organization
        const department = await Department.findById(deptId);
        if (!department || department.organization_id !== orgId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Department not found in this organization'
            });
        }

        await department.update(updates);

        // Log admin action
        await authService.logOperation(req.user.id, 'DEPARTMENT_UPDATE', {
            ...clientInfo,
            organizationId: orgId,
            departmentId: department.id,
            departmentName: department.name,
            updates
        });

        res.status(200).json({
            success: true,
            message: 'Department updated successfully',
            data: {
                department: department.toJSON()
            }
        });

    } catch (error) {
        logger.error('Update department failed:', error.message);
        
        if (error.message.includes('already exists')) {
            return res.status(409).json({
                error: 'Conflict',
                message: error.message
            });
        }

        res.status(400).json({
            error: 'Department Update Failed',
            message: error.message || 'Failed to update department'
        });
    }
});

// DELETE /api/organizations/:orgId/departments/:deptId - Deactivate department
router.delete('/:orgId/departments/:deptId', authenticate, adminOnly, validateOrgDeptParams, async (req, res) => {
    try {
        const { orgId, deptId } = req.params;
        const clientInfo = getClientInfo(req);

        // Verify department exists and belongs to organization
        const department = await Department.findById(deptId);
        if (!department || department.organization_id !== orgId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Department not found in this organization'
            });
        }

        await department.deactivate();

        // Log admin action
        await authService.logOperation(req.user.id, 'DEPARTMENT_DEACTIVATE', {
            ...clientInfo,
            organizationId: orgId,
            departmentId: department.id,
            departmentName: department.name
        });

        res.status(200).json({
            success: true,
            message: 'Department deactivated successfully'
        });

    } catch (error) {
        logger.error('Deactivate department failed:', error.message);
        
        res.status(500).json({
            error: 'Department Deactivation Failed',
            message: 'Failed to deactivate department'
        });
    }
});

// ============================================================================
// EXPERT GROUP ROUTES
// ============================================================================

// GET /api/organizations/:orgId/departments/:deptId/expert-groups - Get expert groups in department
router.get('/:orgId/departments/:deptId/expert-groups', authenticate, departmentHeadOrAdmin, validateOrgDeptParams, validatePagination, async (req, res) => {
    try {
        const { orgId, deptId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        // Verify department exists and belongs to organization
        const department = await Department.findById(deptId);
        if (!department || department.organization_id !== orgId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Department not found in this organization'
            });
        }

        // Check if user has access to this department
        if (req.user.role !== 'system_administrator' && 
            (req.user.organization_id !== orgId || req.user.department_id !== deptId)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied to this department'
            });
        }

        const { query } = require('../config/database');
        
        // Get total count
        const countResult = await query(
            'SELECT COUNT(*) FROM expert_groups WHERE department_id = $1 AND is_active = true',
            [deptId]
        );
        const total = parseInt(countResult.rows[0].count);

        // Get paginated expert groups with member counts
        const result = await query(`
            SELECT eg.*, 
                   COUNT(egm.user_id) as member_count,
                   u.username as created_by_username
            FROM expert_groups eg
            LEFT JOIN expert_group_members egm ON eg.id = egm.group_id AND egm.is_active = true
            LEFT JOIN users u ON eg.created_by = u.id
            WHERE eg.department_id = $1 AND eg.is_active = true
            GROUP BY eg.id, u.username
            ORDER BY eg.created_at DESC
            LIMIT $2 OFFSET $3
        `, [deptId, limit, offset]);

        const expertGroups = result.rows.map(row => new ExpertGroup(row));

        res.status(200).json({
            success: true,
            data: {
                department: department.toJSON(),
                expertGroups: expertGroups.map(group => ({
                    ...group.toJSON(),
                    member_count: parseInt(row.member_count),
                    created_by_username: row.created_by_username
                })),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get expert groups failed:', error.message);
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve expert groups'
        });
    }
});

// POST /api/organizations/:orgId/departments/:deptId/expert-groups - Create expert group
router.post('/:orgId/departments/:deptId/expert-groups', authenticate, departmentHeadOrAdmin, validateOrgDeptParams, validateCreateExpertGroup, async (req, res) => {
    try {
        const { orgId, deptId } = req.params;
        const { name, description } = req.body;
        const clientInfo = getClientInfo(req);

        // Verify department exists and belongs to organization
        const department = await Department.findById(deptId);
        if (!department || department.organization_id !== orgId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Department not found in this organization'
            });
        }

        // Check if user has access to create expert groups in this department
        if (req.user.role !== 'system_administrator' && 
            (req.user.organization_id !== orgId || req.user.department_id !== deptId)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied to create expert groups in this department'
            });
        }

        const expertGroup = await ExpertGroup.create({
            department_id: deptId,
            name,
            description,
            created_by: req.user.id
        });

        // Log action
        await authService.logOperation(req.user.id, 'EXPERT_GROUP_CREATE', {
            ...clientInfo,
            organizationId: orgId,
            departmentId: deptId,
            expertGroupId: expertGroup.id,
            expertGroupName: expertGroup.name
        });

        res.status(201).json({
            success: true,
            message: 'Expert group created successfully',
            data: {
                expertGroup: expertGroup.toJSON()
            }
        });

    } catch (error) {
        logger.error('Create expert group failed:', error.message);
        
        if (error.message.includes('already exists')) {
            return res.status(409).json({
                error: 'Conflict',
                message: error.message
            });
        }

        res.status(400).json({
            error: 'Expert Group Creation Failed',
            message: error.message || 'Failed to create expert group'
        });
    }
});

module.exports = router;