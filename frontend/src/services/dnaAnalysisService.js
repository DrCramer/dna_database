import api from './authService';

export const dnaAnalysisService = {
  // Get all profiles for the current user
  async getProfiles(options = {}) {
    try {
      const params = new URLSearchParams();
      if (options.scope) {
        params.append('scope', options.scope);
      }
      if (options.limit) {
        params.append('limit', options.limit);
      }
      if (options.offset) {
        params.append('offset', options.offset);
      }
      
      const queryString = params.toString();
      const url = queryString ? `/profiles?${queryString}` : '/profiles';
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch profiles');
    }
  },

  // Get a specific profile by ID
  async getProfile(profileId) {
    try {
      const response = await api.get(`/profiles/${profileId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch profile');
    }
  },

  // Upload Excel file with DNA profiles
  async uploadProfiles(file, onProgress) {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post('/profiles/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: onProgress,
      });

      return response.data;
    } catch (error) {
      // Handle validation errors specially
      if (error.response?.data?.code === 'VALIDATION_FAILED' && error.response?.data?.validation) {
        const validationError = new Error(error.response.data.message || 'File validation failed');
        validationError.validation = error.response.data.validation;
        validationError.code = 'VALIDATION_FAILED';
        throw validationError;
      }
      
      // Handle other errors
      throw new Error(error.response?.data?.message || 'Upload failed');
    }
  },

  // Delete a profile
  async deleteProfile(profileId) {
    try {
      const response = await api.delete(`/profiles/${profileId}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to delete profile');
    }
  },

  // Search for matches with a specific profile
  async searchProfile(profileId, searchOptions = {}) {
    try {
      const response = await api.post('/analysis/search', {
        profileId,
        ...searchOptions
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Search failed');
    }
  },

  // Perform bulk search across all profiles
  async bulkSearch(searchOptions = {}) {
    try {
      const response = await api.post('/analysis/bulk-search', searchOptions);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Bulk search failed');
    }
  },

  // Compare two specific profiles
  async compareProfiles(profileId1, profileId2) {
    try {
      const response = await api.post('/analysis/compare', {
        profileId1,
        profileId2
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Comparison failed');
    }
  },

  // Export search results
  async exportResults(results, format = 'excel') {
    try {
      // Convert results to the format expected by the export service
      const exportData = {
        analysisType: 'search',
        results: { matches: results },
        exportTimestamp: new Date().toISOString()
      };

      // Use the export service to handle the actual export
      const { exportService } = await import('./exportService');
      
      switch (format) {
        case 'excel':
          return await exportService.exportToExcel(exportData, `search_results_${Date.now()}.xlsx`);
        case 'csv':
          return await exportService.exportToCSV(exportData, `search_results_${Date.now()}.csv`);
        case 'json':
          return await exportService.exportToJSON(exportData, `search_results_${Date.now()}.json`);
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      throw new Error(error.message || 'Export failed');
    }
  },

  // Get analysis history
  async getAnalysisHistory(limit = 50) {
    try {
      const response = await api.get(`/history/analysis?limit=${limit}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch history');
    }
  },

  // Get dashboard statistics
  async getDashboardStats() {
    try {
      const response = await api.get('/dashboard');
      return response.data.stats || {
        totalProfiles: 0,
        recentUploads: 0,
        totalMatches: 0
      };
    } catch (error) {
      console.error('Dashboard stats error:', error);
      // Return default values if API fails
      return {
        totalProfiles: 0,
        recentUploads: 0,
        totalMatches: 0
      };
    }
  }
};