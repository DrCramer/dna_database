import api from './authService';

export const taskService = {
  // Task management
  async getTasks(options = {}) {
    try {
      const params = new URLSearchParams();
      if (options.page) params.append('page', options.page);
      if (options.limit) params.append('limit', options.limit);
      if (options.status) params.append('status', options.status);
      if (options.priority) params.append('priority', options.priority);
      if (options.assigned_to_me) params.append('assigned_to_me', 'true');
      if (options.department_id) params.append('department_id', options.department_id);

      const queryString = params.toString();
      const url = queryString ? `/tasks?${queryString}` : '/tasks';
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch tasks');
    }
  },

  async getTask(taskId) {
    try {
      const response = await api.get(`/tasks/${taskId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch task');
    }
  },

  async createTask(taskData) {
    try {
      const response = await api.post('/tasks', taskData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create task');
    }
  },

  async updateTask(taskId, updates) {
    try {
      const response = await api.put(`/tasks/${taskId}`, updates);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update task');
    }
  },

  async updateTaskStatus(taskId, status) {
    try {
      const response = await api.put(`/tasks/${taskId}/status`, { status });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update task status');
    }
  },

  async approveTask(taskId) {
    try {
      const response = await api.post(`/tasks/${taskId}/approve`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to approve task');
    }
  },

  async deleteTask(taskId) {
    try {
      const response = await api.delete(`/tasks/${taskId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to delete task');
    }
  },

  // Task comments
  async getTaskComments(taskId) {
    try {
      const response = await api.get(`/tasks/${taskId}/comments`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch task comments');
    }
  },

  async addTaskComment(taskId, comment) {
    try {
      const response = await api.post(`/tasks/${taskId}/comments`, { comment });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to add task comment');
    }
  },

  async updateTaskComment(taskId, commentId, comment) {
    try {
      const response = await api.put(`/tasks/${taskId}/comments/${commentId}`, { comment });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update task comment');
    }
  },

  async deleteTaskComment(taskId, commentId) {
    try {
      const response = await api.delete(`/tasks/${taskId}/comments/${commentId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to delete task comment');
    }
  },

  // Task results
  async getTaskResults(taskId) {
    try {
      const response = await api.get(`/tasks/${taskId}/results`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch task results');
    }
  },

  async addTaskResult(taskId, resultData) {
    try {
      const response = await api.post(`/tasks/${taskId}/results`, resultData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to add task result');
    }
  },

  async updateTaskResult(taskId, resultId, resultData) {
    try {
      const response = await api.put(`/tasks/${taskId}/results/${resultId}`, resultData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update task result');
    }
  },

  async deleteTaskResult(taskId, resultId) {
    try {
      const response = await api.delete(`/tasks/${taskId}/results/${resultId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to delete task result');
    }
  },

  // Task assignment
  async assignTaskToUser(taskId, userId) {
    try {
      const response = await api.post(`/tasks/${taskId}/assign/user`, { user_id: userId });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to assign task to user');
    }
  },

  async assignTaskToGroup(taskId, groupId) {
    try {
      const response = await api.post(`/tasks/${taskId}/assign/group`, { group_id: groupId });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to assign task to group');
    }
  },

  async unassignTask(taskId) {
    try {
      const response = await api.post(`/tasks/${taskId}/unassign`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to unassign task');
    }
  },

  // Task statistics
  async getTaskStatistics(departmentId = null) {
    try {
      const url = departmentId ? `/tasks/statistics?department_id=${departmentId}` : '/tasks/statistics';
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch task statistics');
    }
  },

  // Task templates
  async getTaskTemplates() {
    try {
      const response = await api.get('/tasks/templates');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch task templates');
    }
  },

  async createTaskFromTemplate(templateId, taskData) {
    try {
      const response = await api.post(`/tasks/templates/${templateId}/create`, taskData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create task from template');
    }
  }
};

export default taskService;