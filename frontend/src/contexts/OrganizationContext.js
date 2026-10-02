import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import organizationService from '../services/organizationService';

const OrganizationContext = createContext();

export const useOrganization = () => {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
};

export const OrganizationProvider = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [organizationContext, setOrganizationContext] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [expertGroups, setExpertGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load user's organizational context
  useEffect(() => {
    if (isAuthenticated && user) {
      loadUserContext();
    } else {
      setOrganizationContext(null);
    }
  }, [isAuthenticated, user]);

  const loadUserContext = async () => {
    try {
      setLoading(true);
      setError(null);
      const context = await organizationService.getUserContext();
      setOrganizationContext(context);
    } catch (err) {
      setError('Failed to load organizational context');
      console.error('Error loading organizational context:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load organizations (for system administrators)
  const loadOrganizations = async () => {
    try {
      setLoading(true);
      setError(null);
      const orgs = await organizationService.getOrganizations();
      setOrganizations(orgs);
      return orgs;
    } catch (err) {
      setError('Failed to load organizations');
      console.error('Error loading organizations:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Load departments
  const loadDepartments = async (organizationId = null) => {
    try {
      setLoading(true);
      setError(null);
      const depts = await organizationService.getDepartments(organizationId);
      setDepartments(depts);
      return depts;
    } catch (err) {
      setError('Failed to load departments');
      console.error('Error loading departments:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Load expert groups
  const loadExpertGroups = async (departmentId = null) => {
    try {
      setLoading(true);
      setError(null);
      const groups = await organizationService.getExpertGroups(departmentId);
      setExpertGroups(groups);
      return groups;
    } catch (err) {
      setError('Failed to load expert groups');
      console.error('Error loading expert groups:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Organization management functions
  const createOrganization = async (organizationData) => {
    try {
      const newOrg = await organizationService.createOrganization(organizationData);
      setOrganizations(prev => [...prev, newOrg]);
      return newOrg;
    } catch (err) {
      setError('Failed to create organization');
      throw err;
    }
  };

  const updateOrganization = async (organizationId, updates) => {
    try {
      const updatedOrg = await organizationService.updateOrganization(organizationId, updates);
      setOrganizations(prev => 
        prev.map(org => org.id === organizationId ? updatedOrg : org)
      );
      return updatedOrg;
    } catch (err) {
      setError('Failed to update organization');
      throw err;
    }
  };

  const deactivateOrganization = async (organizationId) => {
    try {
      await organizationService.deactivateOrganization(organizationId);
      setOrganizations(prev => 
        prev.map(org => org.id === organizationId ? { ...org, is_active: false } : org)
      );
    } catch (err) {
      setError('Failed to deactivate organization');
      throw err;
    }
  };

  // Department management functions
  const createDepartment = async (departmentData) => {
    try {
      const newDept = await organizationService.createDepartment(departmentData);
      setDepartments(prev => [...prev, newDept]);
      return newDept;
    } catch (err) {
      setError('Failed to create department');
      throw err;
    }
  };

  const updateDepartment = async (departmentId, updates) => {
    try {
      const updatedDept = await organizationService.updateDepartment(departmentId, updates);
      setDepartments(prev => 
        prev.map(dept => dept.id === departmentId ? updatedDept : dept)
      );
      return updatedDept;
    } catch (err) {
      setError('Failed to update department');
      throw err;
    }
  };

  const deactivateDepartment = async (departmentId) => {
    try {
      await organizationService.deactivateDepartment(departmentId);
      setDepartments(prev => 
        prev.map(dept => dept.id === departmentId ? { ...dept, is_active: false } : dept)
      );
    } catch (err) {
      setError('Failed to deactivate department');
      throw err;
    }
  };

  // Expert group management functions
  const createExpertGroup = async (groupData) => {
    try {
      const newGroup = await organizationService.createExpertGroup(groupData);
      setExpertGroups(prev => [...prev, newGroup]);
      return newGroup;
    } catch (err) {
      setError('Failed to create expert group');
      throw err;
    }
  };

  const updateExpertGroup = async (groupId, updates) => {
    try {
      const updatedGroup = await organizationService.updateExpertGroup(groupId, updates);
      setExpertGroups(prev => 
        prev.map(group => group.id === groupId ? updatedGroup : group)
      );
      return updatedGroup;
    } catch (err) {
      setError('Failed to update expert group');
      throw err;
    }
  };

  const deactivateExpertGroup = async (groupId) => {
    try {
      await organizationService.deactivateExpertGroup(groupId);
      setExpertGroups(prev => 
        prev.map(group => group.id === groupId ? { ...group, is_active: false } : group)
      );
    } catch (err) {
      setError('Failed to deactivate expert group');
      throw err;
    }
  };

  const addMemberToGroup = async (groupId, userId) => {
    try {
      await organizationService.addMemberToGroup(groupId, userId);
      // Reload expert groups to get updated member counts
      await loadExpertGroups();
    } catch (err) {
      setError('Failed to add member to group');
      throw err;
    }
  };

  const removeMemberFromGroup = async (groupId, userId) => {
    try {
      await organizationService.removeMemberFromGroup(groupId, userId);
      // Reload expert groups to get updated member counts
      await loadExpertGroups();
    } catch (err) {
      setError('Failed to remove member from group');
      throw err;
    }
  };

  // Helper functions
  const getCurrentOrganization = () => {
    return organizationContext?.organization || null;
  };

  const getCurrentDepartment = () => {
    return organizationContext?.department || null;
  };

  const getUserExpertGroups = () => {
    return organizationContext?.expertGroups || [];
  };

  const canManageOrganizations = () => {
    return user?.role === 'System_Administrator';
  };

  const canManageDepartments = () => {
    return ['System_Administrator', 'Department_Head'].includes(user?.role);
  };

  const canManageExpertGroups = () => {
    return ['System_Administrator', 'Department_Head'].includes(user?.role);
  };

  const clearError = () => {
    setError(null);
  };

  const value = {
    // State
    organizationContext,
    organizations,
    departments,
    expertGroups,
    loading,
    error,

    // Actions
    loadUserContext,
    loadOrganizations,
    loadDepartments,
    loadExpertGroups,
    
    // Organization management
    createOrganization,
    updateOrganization,
    deactivateOrganization,
    
    // Department management
    createDepartment,
    updateDepartment,
    deactivateDepartment,
    
    // Expert group management
    createExpertGroup,
    updateExpertGroup,
    deactivateExpertGroup,
    addMemberToGroup,
    removeMemberFromGroup,
    
    // Helpers
    getCurrentOrganization,
    getCurrentDepartment,
    getUserExpertGroups,
    canManageOrganizations,
    canManageDepartments,
    canManageExpertGroups,
    clearError
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
};

export default OrganizationContext;