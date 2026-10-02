const Joi = require('joi');
const { logger } = require('../utils/logger');

// Validation middleware factory
function validate(schema, property = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[property], {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errorDetails = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value
            }));

            logger.warn('Validation failed:', errorDetails);

            return res.status(400).json({
                error: 'Validation Error',
                message: 'Неверные данные',
                details: errorDetails
            });
        }

        // Replace request property with validated and sanitized value
        req[property] = value;
        next();
    };
}

// Authentication validation schemas
const authSchemas = {
    login: Joi.object({
        username: Joi.string()
            .min(3)
            .max(50)
            .required()
            .messages({
                'string.min': 'Username must be at least 3 characters long',
                'string.max': 'Username must not exceed 50 characters',
                'any.required': 'Username is required'
            }),
        password: Joi.string()
            .min(6)
            .required()
            .messages({
                'string.min': 'Password must be at least 6 characters long',
                'any.required': 'Password is required'
            })
    }),

    register: Joi.object({
        username: Joi.string()
            .min(3)
            .max(50)
            .pattern(/^[a-zA-Z0-9_-]+$/)
            .required()
            .messages({
                'string.min': 'Username must be at least 3 characters long',
                'string.max': 'Username must not exceed 50 characters',
                'string.pattern.base': 'Username can only contain letters, numbers, underscores, and hyphens',
                'any.required': 'Username is required'
            }),
        email: Joi.string()
            .email()
            .max(100)
            .required()
            .messages({
                'string.email': 'Please provide a valid email address',
                'string.max': 'Email must not exceed 100 characters',
                'any.required': 'Email is required'
            }),
        password: Joi.string()
            .min(8)
            .max(128)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .required()
            .messages({
                'string.min': 'Password must be at least 8 characters long',
                'string.max': 'Password must not exceed 128 characters',
                'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
                'any.required': 'Password is required'
            }),
        confirmPassword: Joi.string()
            .valid(Joi.ref('password'))
            .required()
            .messages({
                'any.only': 'Password confirmation does not match',
                'any.required': 'Password confirmation is required'
            }),
        role: Joi.string()
            .valid('user_analyst', 'department_head', 'system_administrator', 'viewer')
            .default('user_analyst')
            .messages({
                'any.only': 'Role must be one of: user_analyst, department_head, system_administrator, viewer'
            }),
        organization_id: Joi.string()
            .uuid()
            .allow(null)
            .messages({
                'string.guid': 'Invalid organization ID format'
            }),
        department_id: Joi.string()
            .uuid()
            .when('role', {
                is: Joi.valid('user_analyst', 'department_head'),
                then: Joi.required(),
                otherwise: Joi.allow(null)
            })
            .messages({
                'string.guid': 'Invalid department ID format',
                'any.required': 'Department ID is required for user analysts and department heads'
            })
    }),

    refreshToken: Joi.object({
        refreshToken: Joi.string()
            .required()
            .messages({
                'any.required': 'Refresh token is required'
            })
    }),

    changePassword: Joi.object({
        currentPassword: Joi.string()
            .required()
            .messages({
                'any.required': 'Current password is required'
            }),
        newPassword: Joi.string()
            .min(8)
            .max(128)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .required()
            .messages({
                'string.min': 'New password must be at least 8 characters long',
                'string.max': 'New password must not exceed 128 characters',
                'string.pattern.base': 'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
                'any.required': 'New password is required'
            }),
        confirmNewPassword: Joi.string()
            .valid(Joi.ref('newPassword'))
            .required()
            .messages({
                'any.only': 'New password confirmation does not match',
                'any.required': 'New password confirmation is required'
            })
    })
};

// User management validation schemas
const userSchemas = {
    updateRole: Joi.object({
        role: Joi.string()
            .valid('user_analyst', 'department_head', 'system_administrator', 'viewer')
            .required()
            .messages({
                'any.only': 'Role must be one of: user_analyst, department_head, system_administrator, viewer',
                'any.required': 'Role is required'
            })
    }),

    updateProfile: Joi.object({
        email: Joi.string()
            .email()
            .max(100)
            .messages({
                'string.email': 'Please provide a valid email address',
                'string.max': 'Email must not exceed 100 characters'
            })
    }),

    resetPassword: Joi.object({
        newPassword: Joi.string()
            .min(8)
            .max(128)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .required()
            .messages({
                'string.min': 'New password must be at least 8 characters long',
                'string.max': 'New password must not exceed 128 characters',
                'string.pattern.base': 'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
                'any.required': 'New password is required'
            })
    }),

    updateStatus: Joi.object({
        is_active: Joi.boolean()
            .required()
            .messages({
                'any.required': 'Status is required',
                'boolean.base': 'Status must be true or false'
            })
    }),

    searchUsers: Joi.object({
        q: Joi.string()
            .min(1)
            .max(100)
            .messages({
                'string.min': 'Search query must not be empty',
                'string.max': 'Search query must not exceed 100 characters'
            }),
        role: Joi.string()
            .valid('user_analyst', 'department_head', 'system_administrator', 'viewer')
            .messages({
                'any.only': 'Role filter must be one of: user_analyst, department_head, system_administrator, viewer'
            }),
        status: Joi.string()
            .valid('active', 'inactive')
            .messages({
                'any.only': 'Status filter must be one of: active, inactive'
            }),
        page: Joi.number()
            .integer()
            .min(1)
            .default(1),
        limit: Joi.number()
            .integer()
            .min(1)
            .max(100)
            .default(10)
    }),

    // New organizational user management schemas
    registerWithDepartment: Joi.object({
        username: Joi.string()
            .min(3)
            .max(50)
            .pattern(/^[a-zA-Z0-9_-]+$/)
            .required()
            .messages({
                'string.min': 'Username must be at least 3 characters long',
                'string.max': 'Username must not exceed 50 characters',
                'string.pattern.base': 'Username can only contain letters, numbers, underscores, and hyphens',
                'any.required': 'Username is required'
            }),
        email: Joi.string()
            .email()
            .max(100)
            .required()
            .messages({
                'string.email': 'Please provide a valid email address',
                'string.max': 'Email must not exceed 100 characters',
                'any.required': 'Email is required'
            }),
        password: Joi.string()
            .min(8)
            .max(128)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .required()
            .messages({
                'string.min': 'Password must be at least 8 characters long',
                'string.max': 'Password must not exceed 128 characters',
                'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
                'any.required': 'Password is required'
            }),
        role: Joi.string()
            .valid('user_analyst', 'department_head', 'system_administrator', 'viewer')
            .required()
            .messages({
                'any.only': 'Role must be one of: user_analyst, department_head, system_administrator, viewer',
                'any.required': 'Role is required'
            }),
        organization_id: Joi.string()
            .uuid()
            .allow(null)
            .messages({
                'string.guid': 'Invalid organization ID format'
            }),
        department_id: Joi.string()
            .uuid()
            .when('role', {
                is: Joi.valid('user_analyst', 'department_head'),
                then: Joi.required(),
                otherwise: Joi.allow(null)
            })
            .messages({
                'string.guid': 'Invalid department ID format',
                'any.required': 'Department ID is required for user analysts and department heads'
            })
    }),

    assignDepartment: Joi.object({
        user_id: Joi.string()
            .uuid()
            .required()
            .messages({
                'string.guid': 'Invalid user ID format',
                'any.required': 'User ID is required'
            }),
        department_id: Joi.string()
            .uuid()
            .required()
            .messages({
                'string.guid': 'Invalid department ID format',
                'any.required': 'Department ID is required'
            })
    })
};

// Organization validation schemas
const organizationSchemas = {
    createOrganization: Joi.object({
        name: Joi.string()
            .min(1)
            .max(255)
            .required()
            .messages({
                'string.min': 'Organization name cannot be empty',
                'string.max': 'Organization name must not exceed 255 characters',
                'any.required': 'Organization name is required'
            }),
        description: Joi.string()
            .max(1000)
            .allow('')
            .messages({
                'string.max': 'Description must not exceed 1000 characters'
            }),
        settings: Joi.object()
            .default({})
            .messages({
                'object.base': 'Settings must be an object'
            })
    }),

    updateOrganization: Joi.object({
        name: Joi.string()
            .min(1)
            .max(255)
            .messages({
                'string.min': 'Organization name cannot be empty',
                'string.max': 'Organization name must not exceed 255 characters'
            }),
        description: Joi.string()
            .max(1000)
            .allow('')
            .messages({
                'string.max': 'Description must not exceed 1000 characters'
            }),
        settings: Joi.object()
            .messages({
                'object.base': 'Settings must be an object'
            })
    }).min(1),

    createDepartment: Joi.object({
        name: Joi.string()
            .min(1)
            .max(255)
            .required()
            .messages({
                'string.min': 'Department name cannot be empty',
                'string.max': 'Department name must not exceed 255 characters',
                'any.required': 'Department name is required'
            }),
        description: Joi.string()
            .max(1000)
            .allow('')
            .messages({
                'string.max': 'Description must not exceed 1000 characters'
            }),
        settings: Joi.object()
            .default({})
            .messages({
                'object.base': 'Settings must be an object'
            })
    }),

    updateDepartment: Joi.object({
        name: Joi.string()
            .min(1)
            .max(255)
            .messages({
                'string.min': 'Department name cannot be empty',
                'string.max': 'Department name must not exceed 255 characters'
            }),
        description: Joi.string()
            .max(1000)
            .allow('')
            .messages({
                'string.max': 'Description must not exceed 1000 characters'
            }),
        settings: Joi.object()
            .messages({
                'object.base': 'Settings must be an object'
            })
    }).min(1),

    createExpertGroup: Joi.object({
        name: Joi.string()
            .min(1)
            .max(255)
            .required()
            .messages({
                'string.min': 'Expert group name cannot be empty',
                'string.max': 'Expert group name must not exceed 255 characters',
                'any.required': 'Expert group name is required'
            }),
        description: Joi.string()
            .max(1000)
            .allow('')
            .messages({
                'string.max': 'Description must not exceed 1000 characters'
            })
    }),

    updateExpertGroup: Joi.object({
        name: Joi.string()
            .min(1)
            .max(255)
            .messages({
                'string.min': 'Expert group name cannot be empty',
                'string.max': 'Expert group name must not exceed 255 characters'
            }),
        description: Joi.string()
            .max(1000)
            .allow('')
            .messages({
                'string.max': 'Description must not exceed 1000 characters'
            })
    }).min(1)
};

// Task validation schemas
const taskSchemas = {
    createTask: Joi.object({
        title: Joi.string()
            .min(1)
            .max(255)
            .required()
            .messages({
                'string.min': 'Task title cannot be empty',
                'string.max': 'Task title must not exceed 255 characters',
                'any.required': 'Task title is required'
            }),
        description: Joi.string()
            .max(2000)
            .allow('')
            .messages({
                'string.max': 'Description must not exceed 2000 characters'
            }),
        target_sample: Joi.object()
            .required()
            .messages({
                'any.required': 'Target sample data is required',
                'object.base': 'Target sample must be an object'
            }),
        data_source: Joi.string()
            .valid('master_array', 'user_array', 'new_array')
            .required()
            .messages({
                'any.only': 'Data source must be one of: master_array, user_array, new_array',
                'any.required': 'Data source is required'
            }),
        data_source_id: Joi.string()
            .uuid()
            .when('data_source', {
                is: Joi.valid('master_array', 'user_array'),
                then: Joi.required(),
                otherwise: Joi.optional()
            })
            .messages({
                'string.guid': 'Invalid data source ID format',
                'any.required': 'Data source ID is required for master_array and user_array sources'
            }),
        assigned_to_user: Joi.string()
            .uuid()
            .messages({
                'string.guid': 'Invalid user ID format'
            }),
        assigned_to_group: Joi.string()
            .uuid()
            .messages({
                'string.guid': 'Invalid group ID format'
            }),
        priority: Joi.string()
            .valid('low', 'medium', 'high', 'urgent')
            .default('medium')
            .messages({
                'any.only': 'Priority must be one of: low, medium, high, urgent'
            }),
        deadline: Joi.date()
            .iso()
            .min('now')
            .messages({
                'date.base': 'Deadline must be a valid date',
                'date.format': 'Deadline must be in ISO format',
                'date.min': 'Deadline must be in the future'
            }),
        internal_number_start: Joi.string()
            .max(50)
            .allow(null, '')
            .messages({
                'string.max': 'Internal number start must not exceed 50 characters'
            }),
        internal_number_end: Joi.string()
            .max(50)
            .allow(null, '')
            .messages({
                'string.max': 'Internal number end must not exceed 50 characters'
            })
    }).custom((value, helpers) => {
        // Ensure either assigned_to_user or assigned_to_group is provided
        if (!value.assigned_to_user && !value.assigned_to_group) {
            return helpers.error('custom.assignee');
        }
        if (value.assigned_to_user && value.assigned_to_group) {
            return helpers.error('custom.multipleAssignees');
        }
        return value;
    }).messages({
        'custom.assignee': 'Either assigned_to_user or assigned_to_group must be provided',
        'custom.multipleAssignees': 'Cannot assign to both user and group simultaneously'
    }),

    updateTaskStatus: Joi.object({
        status: Joi.string()
            .valid('assigned', 'in_progress', 'completed', 'approved')
            .required()
            .messages({
                'any.only': 'Status must be one of: assigned, in_progress, completed, approved',
                'any.required': 'Status is required'
            })
    }),

    addTaskComment: Joi.object({
        comment: Joi.string()
            .min(1)
            .max(2000)
            .required()
            .messages({
                'string.min': 'Comment cannot be empty',
                'string.max': 'Comment must not exceed 2000 characters',
                'any.required': 'Comment is required'
            })
    }),

    addTaskResult: Joi.object({
        result_data: Joi.object()
            .required()
            .messages({
                'any.required': 'Result data is required',
                'object.base': 'Result data must be an object'
            }),
        analysis_metadata: Joi.object()
            .default({})
            .messages({
                'object.base': 'Analysis metadata must be an object'
            })
    })
};

// Common validation schemas
const commonSchemas = {
    uuid: Joi.object({
        id: Joi.string()
            .uuid()
            .required()
            .messages({
                'string.guid': 'Invalid UUID format',
                'any.required': 'ID is required'
            })
    }),

    orgParams: Joi.object({
        orgId: Joi.string()
            .uuid()
            .required()
            .messages({
                'string.guid': 'Invalid organization ID format',
                'any.required': 'Organization ID is required'
            })
    }),

    orgDeptParams: Joi.object({
        orgId: Joi.string()
            .uuid()
            .required()
            .messages({
                'string.guid': 'Invalid organization ID format',
                'any.required': 'Organization ID is required'
            }),
        deptId: Joi.string()
            .uuid()
            .required()
            .messages({
                'string.guid': 'Invalid department ID format',
                'any.required': 'Department ID is required'
            })
    }),

    pagination: Joi.object({
        page: Joi.number()
            .integer()
            .min(1)
            .default(1)
            .messages({
                'number.base': 'Page must be a number',
                'number.integer': 'Page must be an integer',
                'number.min': 'Page must be at least 1'
            }),
        limit: Joi.number()
            .integer()
            .min(1)
            .max(10000)
            .default(20)
            .messages({
                'number.base': 'Limit must be a number',
                'number.integer': 'Limit must be an integer',
                'number.min': 'Limit must be at least 1',
                'number.max': 'Limit must not exceed 10000'
            })
    })
};

// Export validation middleware functions
module.exports = {
    validate,
    
    // Authentication validations
    validateLogin: validate(authSchemas.login),
    validateRegister: validate(authSchemas.register),
    validateRefreshToken: validate(authSchemas.refreshToken),
    validateChangePassword: validate(authSchemas.changePassword),
    
    // User management validations
    validateUpdateRole: validate(userSchemas.updateRole),
    validateUpdateProfile: validate(userSchemas.updateProfile),
    validateResetPassword: validate(userSchemas.resetPassword),
    validateUpdateStatus: validate(userSchemas.updateStatus),
    validateSearchUsers: validate(userSchemas.searchUsers, 'query'),
    validateRegisterWithDepartment: validate(userSchemas.registerWithDepartment),
    validateAssignDepartment: validate(userSchemas.assignDepartment),
    
    // Organization validations
    validateCreateOrganization: validate(organizationSchemas.createOrganization),
    validateUpdateOrganization: validate(organizationSchemas.updateOrganization),
    validateCreateDepartment: validate(organizationSchemas.createDepartment),
    validateUpdateDepartment: validate(organizationSchemas.updateDepartment),
    validateCreateExpertGroup: validate(organizationSchemas.createExpertGroup),
    validateUpdateExpertGroup: validate(organizationSchemas.updateExpertGroup),
    
    // Task validations
    validateCreateTask: validate(taskSchemas.createTask),
    validateUpdateTaskStatus: validate(taskSchemas.updateTaskStatus),
    validateAddTaskComment: validate(taskSchemas.addTaskComment),
    validateAddTaskResult: validate(taskSchemas.addTaskResult),
    
    // Common validations
    validateUUID: validate(commonSchemas.uuid, 'params'),
    validateOrgParams: validate(commonSchemas.orgParams, 'params'),
    validateOrgDeptParams: validate(commonSchemas.orgDeptParams, 'params'),
    validatePagination: validate(commonSchemas.pagination, 'query'),
    
    // Raw schemas for custom validation
    schemas: {
        auth: authSchemas,
        user: userSchemas,
        organization: organizationSchemas,
        task: taskSchemas,
        common: commonSchemas
    }
};