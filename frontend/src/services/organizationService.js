import api from './authService';

export const organizationService = {
  // Organization management
  async getOrganizations() {
    try {
      const response = await api.get('/organizations');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch organizations');
    }
  },

  async createOrganization(organizationData) {
    try {
      const response = await api.post('/organizations', organizationData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create organization');
    }
  },

  async updateOrganization(organizationId, updates) {
    try {
      const response = await api.put(`/organizations/${organizationId}`, updates);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update organization');
    }
  },

  async deactivateOrganization(organizationId) {
    try {
      const response = await api.put(`/organizations/${organizationId}/deactivate`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to deactivate organization');
    }
  },

  // Department management
  async getDepartments(organizationId = null) {
    try {
      const url = organizationId ? `/departments?organization_id=${organizationId}` : '/departments';
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch departments');
    }
  },

  async createDepartment(departmentData) {
    try {
      const response = await api.post('/departments', departmentData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create department');
    }
  },

  async updateDepartment(departmentId, updates) {
    try {
      const response = await api.put(`/departments/${departmentId}`, updates);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update department');
    }
  },

  async deactivateDepartment(departmentId) {
    try {
      const response = await api.put(`/departments/${departmentId}/deactivate`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to deactivate department');
    }
  },

  // Expert Group management
  async getExpertGroups(departmentId = null) {
    try {
      const url = departmentId ? `/expert-groups?department_id=${departmentId}` : '/expert-groups';
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch expert groups');
    }
  },

  async createExpertGroup(groupData) {
    try {
      const response = await api.post('/expert-groups', groupData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create expert group');
    }
  },

  async updateExpertGroup(groupId, updates) {
    try {
      const response = await api.put(`/expert-groups/${groupId}`, updates);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update expert group');
    }
  },

  async deactivateExpertGroup(groupId) {
    try {
      const response = await api.put(`/expert-groups/${groupId}/deactivate`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to deactivate expert group');
    }
  },

  async addMemberToGroup(groupId, userId) {
    try {
      const response = await api.post(`/expert-groups/${groupId}/members`, { user_id: userId });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to add member to group');
    }
  },

  async removeMemberFromGroup(groupId, userId) {
    try {
      const response = await api.delete(`/expert-groups/${groupId}/members/${userId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to remove member from group');
    }
  },

  // User management with organizational context
  async getUsers(departmentId = null) {
    try {
      const url = departmentId ? `/users?department_id=${departmentId}` : '/users';
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch users');
    }
  },

  async createUser(userData) {
    try {
      const response = await api.post('/users', userData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create user');
    }
  },

  async updateUser(userId, updates) {
    try {
      const response = await api.put(`/users/${userId}`, updates);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update user');
    }
  },

  async deleteUser(userId) {
    try {
      const response = await api.delete(`/users/${userId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to delete user');
    }
  },

  // Get organizational context for current user
  async getUserContext() {
    try {
      const response = await api.get('/users/context');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch user context');
    }
  },

  // Master Array management
  async getMasterArrays(departmentId = null) {
    try {
      const url = departmentId ? `/master-arrays?department_id=${departmentId}` : '/master-arrays';
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch master arrays');
    }
  },

  async getMasterArrayProfiles(masterArrayId) {
    try {
      const response = await api.get(`/master-arrays/${masterArrayId}/profiles`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch master array profiles');
    }
  },

  async addProfileToMasterArray(masterArrayId, profileData) {
    try {
      const response = await api.post(`/master-arrays/${masterArrayId}/profiles`, profileData);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to add profile to master array');
    }
  },

  async removeProfileFromMasterArray(masterArrayId, profileId) {
    try {
      const response = await api.delete(`/master-arrays/${masterArrayId}/profiles/${profileId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to remove profile from master array');
    }
  }
};

export default organizationService;