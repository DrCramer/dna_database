import React from 'react';
import UserManagement from '../Admin/UserManagement';
import DepartmentManager from '../Organization/DepartmentManager';
import OrganizationManager from '../Organization/OrganizationManager';
import { useAuth } from '../../contexts/AuthContext';
import {
  AccessDeniedState,
  ExpertGroupsFeaturePage,
  ProfilesFeaturePage
} from './LegacyRouteHelpers';

export const ProfilesPage = ({ onNavigate }) => {
  const { hasRole } = useAuth();

  if (!hasRole('department_head')) {
    return (
      <AccessDeniedState
        message="У вас нет прав для просмотра этой страницы."
        onNavigate={onNavigate}
      />
    );
  }

  return <ProfilesFeaturePage onNavigate={onNavigate} />;
};

export const UsersPage = ({ onNavigate }) => {
  const { hasRole } = useAuth();

  if (!hasRole('department_head')) {
    return (
      <AccessDeniedState
        message="У вас нет прав для управления пользователями."
        onNavigate={onNavigate}
      />
    );
  }

  return <UserManagement onBack={() => onNavigate('/dashboard')} />;
};

export const OrganizationsPage = ({ onNavigate }) => {
  const { hasRole } = useAuth();

  return <OrganizationManager hasRole={hasRole} onNavigate={onNavigate} />;
};

export const DepartmentsPage = ({ onNavigate }) => {
  const { hasRole } = useAuth();

  if (!hasRole('department_head')) {
    return (
      <AccessDeniedState
        message="У вас нет прав для управления отделами."
        onNavigate={onNavigate}
      />
    );
  }

  return <DepartmentManager hasRole={hasRole} onNavigate={onNavigate} />;
};

export const ExpertGroupsPage = ({ onNavigate }) => {
  const { hasRole } = useAuth();

  if (!hasRole('department_head')) {
    return (
      <AccessDeniedState
        message="У вас нет прав для управления экспертными группами."
        onNavigate={onNavigate}
      />
    );
  }

  return <ExpertGroupsFeaturePage onNavigate={onNavigate} />;
};
