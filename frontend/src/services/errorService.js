// Error handling service for consistent error management across the application
export const errorService = {
  // Parse API error responses
  parseError(error) {
    if (error.response) {
      // Server responded with error status
      const { status, data } = error.response;
      
      switch (status) {
        case 400:
          return {
            type: 'validation',
            message: data.message || 'Invalid request data',
            details: data.details || null
          };
        case 401:
          return {
            type: 'authentication',
            message: 'Authentication required. Please log in.',
            details: null
          };
        case 403:
          return {
            type: 'authorization',
            message: 'You do not have permission to perform this action.',
            details: null
          };
        case 404:
          return {
            type: 'not_found',
            message: 'The requested resource was not found.',
            details: null
          };
        case 409:
          return {
            type: 'conflict',
            message: data.message || 'A conflict occurred with the current state.',
            details: data.details || null
          };
        case 413:
          return {
            type: 'file_too_large',
            message: 'The uploaded file is too large.',
            details: null
          };
        case 422:
          return {
            type: 'validation',
            message: data.message || 'Validation failed',
            details: data.errors || null
          };
        case 429:
          return {
            type: 'rate_limit',
            message: 'Too many requests. Please try again later.',
            details: null
          };
        case 500:
          return {
            type: 'server_error',
            message: 'An internal server error occurred. Please try again.',
            details: null
          };
        default:
          return {
            type: 'unknown',
            message: data.message || `Server error (${status})`,
            details: null
          };
      }
    } else if (error.request) {
      // Network error
      return {
        type: 'network',
        message: 'Network error. Please check your connection and try again.',
        details: null
      };
    } else {
      // Other error
      return {
        type: 'client',
        message: error.message || 'An unexpected error occurred.',
        details: null
      };
    }
  },

  // Format error for display
  formatError(error) {
    const parsed = this.parseError(error);
    
    let message = parsed.message;
    
    if (parsed.details) {
      if (Array.isArray(parsed.details)) {
        message += '\n\nDetails:\n' + parsed.details.map(detail => `• ${detail}`).join('\n');
      } else if (typeof parsed.details === 'object') {
        const detailsList = Object.entries(parsed.details)
          .map(([key, value]) => `• ${key}: ${value}`)
          .join('\n');
        message += '\n\nDetails:\n' + detailsList;
      } else {
        message += '\n\nDetails: ' + parsed.details;
      }
    }
    
    return message;
  },

  // Handle authentication errors
  handleAuthError(error, navigate) {
    const parsed = this.parseError(error);
    
    if (parsed.type === 'authentication') {
      // Clear stored auth data
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      
      // Redirect to login
      if (navigate) {
        navigate('/login', { 
          state: { 
            from: window.location.pathname,
            message: 'Your session has expired. Please log in again.'
          }
        });
      } else {
        window.location.href = '/login';
      }
      
      return true;
    }
    
    return false;
  },

  // Show user-friendly error notifications
  showError(error, showNotification) {
    const parsed = this.parseError(error);
    const message = this.formatError(error);
    
    if (showNotification) {
      showNotification(message, 'error');
    } else {
      console.error('Error:', parsed);
    }
    
    return parsed;
  },

  // Retry logic for failed requests
  async withRetry(asyncFunction, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await asyncFunction();
      } catch (error) {
        lastError = error;
        const parsed = this.parseError(error);
        
        // Don't retry certain error types
        if (['authentication', 'authorization', 'validation', 'not_found'].includes(parsed.type)) {
          throw error;
        }
        
        // Don't retry on last attempt
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
    
    throw lastError;
  },

  // Validate form data
  validateForm(data, rules) {
    const errors = {};
    
    Object.entries(rules).forEach(([field, rule]) => {
      const value = data[field];
      
      if (rule.required && (!value || (typeof value === 'string' && !value.trim()))) {
        errors[field] = `${rule.label || field} is required`;
        return;
      }
      
      if (value && rule.minLength && value.length < rule.minLength) {
        errors[field] = `${rule.label || field} must be at least ${rule.minLength} characters`;
        return;
      }
      
      if (value && rule.maxLength && value.length > rule.maxLength) {
        errors[field] = `${rule.label || field} must be no more than ${rule.maxLength} characters`;
        return;
      }
      
      if (value && rule.pattern && !rule.pattern.test(value)) {
        errors[field] = rule.patternMessage || `${rule.label || field} format is invalid`;
        return;
      }
      
      if (value && rule.custom && !rule.custom(value)) {
        errors[field] = rule.customMessage || `${rule.label || field} is invalid`;
        return;
      }
    });
    
    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }
};

export default errorService;