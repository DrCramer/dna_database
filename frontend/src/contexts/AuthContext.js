import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const normalizeUser = React.useCallback((rawUser) => {
    if (!rawUser) {
      return null;
    }

    const accessibleDepartments = Array.isArray(rawUser.accessible_departments)
      ? rawUser.accessible_departments
      : [];

    const activeDepartmentId = rawUser.active_department_id
      || rawUser.department_id
      || accessibleDepartments[0]?.id
      || null;

    return {
      ...rawUser,
      accessible_departments: accessibleDepartments,
      active_department_id: activeDepartmentId
    };
  }, []);

  const isTokenExpired = (token) => {
    if (!token) return true;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = payload.exp - now;
      return timeUntilExpiry < 300;
    } catch (tokenError) {
      console.error('Error checking token expiration:', tokenError);
      return true;
    }
  };

  const logout = React.useCallback(() => {
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch;

    const handleLogout = () => {
      logout();
      setError('Сессия истекла. Пожалуйста, войдите снова.');

      if (window.location.pathname !== '/login') {
        window.history.pushState(null, '', '/login');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    };

    window.fetch = async (...args) => {
      const [input, init = {}] = args;
      const requestUrl = typeof input === 'string' ? input : input?.url;
      const isApiRequest = typeof requestUrl === 'string' && requestUrl.startsWith('/api/');
      const savedUser = normalizeUser(JSON.parse(localStorage.getItem('user') || 'null'));

      let nextInit = init;

      if (isApiRequest && savedUser?.active_department_id) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        if (!headers.has('X-Active-Department-Id')) headers.set('X-Active-Department-Id', savedUser.active_department_id);
        nextInit = {
          ...init,
          headers
        };
      }

      const response = await originalFetch(input, nextInit);

      if (response.status === 401 && !(typeof requestUrl === 'string' && requestUrl.includes('/api/auth/login'))) {
        handleLogout();
      }

      return response;
    };

    window.addEventListener('auth:logout', handleLogout);

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener('auth:logout', handleLogout);
    };
  }, [logout, normalizeUser]);

  useEffect(() => {
    const checkTokenValidity = () => {
      const token = localStorage.getItem('token');
      const savedUser = localStorage.getItem('user');

      if (token && savedUser && user && isTokenExpired(token)) {
        logout();
        setError('Your session has expired. Please login again.');
      }
    };

    const interval = setInterval(checkTokenValidity, 60000);
    return () => clearInterval(interval);
  }, [logout, user]);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('token');

    if (savedUser && savedToken) {
      try {
        const userData = JSON.parse(savedUser);

        if (!isTokenExpired(savedToken)) {
          setUser(normalizeUser(userData));
        } else {
          localStorage.removeItem('user');
          localStorage.removeItem('token');
        }
      } catch (parseError) {
        console.error('Error parsing saved user:', parseError);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }

    setLoading(false);
  }, [normalizeUser]);

  const login = async (username, password) => {
    try {
      setError(null);
      setLoading(true);

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Login failed');
      }

      const userData = normalizeUser({
        id: data.data.user.id,
        username: data.data.user.username,
        email: data.data.user.email,
        role: data.data.user.role,
        can_upload_with_task: data.data.user.can_upload_with_task,
        can_upload_without_task: data.data.user.can_upload_without_task,
        organization_id: data.data.user.organization_id,
        department_id: data.data.user.department_id,
        accessible_departments: data.data.user.accessible_departments || [],
        active_department_id: data.data.user.active_department_id,
        accessToken: data.data.accessToken
      });

      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
      localStorage.setItem('token', data.data.accessToken);

      return { user: userData };
    } catch (loginError) {
      console.error('Login failed:', loginError);
      setError(loginError.message || 'Login failed');
      throw loginError;
    } finally {
      setLoading(false);
    }
  };

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  const refreshUser = React.useCallback(async (signal) => {
    const token = localStorage.getItem('token');
    const savedUser = JSON.parse(localStorage.getItem('user') || 'null');
    if (!token || !savedUser) throw new Error('Войдите в систему повторно.');
    const response = await fetch('/api/auth/me', { signal, headers: {
      Authorization: `Bearer ${token}`,
      'X-Active-Department-Id': savedUser.active_department_id || savedUser.department_id
    } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Не удалось проверить права загрузки.');
    const nextUser = normalizeUser({ ...savedUser, ...data.data.user });
    const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
    if (localStorage.getItem('token') === token && !signal?.aborted && currentUser?.active_department_id === savedUser.active_department_id) {
      setUser(nextUser);
      localStorage.setItem('user', JSON.stringify(nextUser));
    }
    return nextUser;
  }, [normalizeUser]);

  const setActiveDepartment = React.useCallback((departmentId) => {
    setUser((prevUser) => {
      const normalizedUser = normalizeUser(prevUser);
      if (!normalizedUser) {
        return prevUser;
      }

      const isAllowedDepartment = normalizedUser.accessible_departments.some(
        (department) => department.id === departmentId
      );

      if (!isAllowedDepartment) {
        return normalizedUser;
      }

      const nextUser = {
        ...normalizedUser,
        active_department_id: departmentId
      };

      localStorage.setItem('user', JSON.stringify(nextUser));
      window.dispatchEvent(new CustomEvent('auth:active-department-changed', {
        detail: { departmentId }
      }));
      return nextUser;
    });
  }, [normalizeUser]);

  const hasRole = (requiredRole) => {
    if (!user) return false;

    if (Array.isArray(requiredRole)) {
      return requiredRole.some((role) => hasRole(role));
    }

    const userRole = user.role;

    if (requiredRole === 'admin') return userRole === 'admin';
    if (requiredRole === 'department_head') return ['admin', 'department_head'].includes(userRole);
    if (requiredRole === 'user_analyst') return ['admin', 'department_head', 'user_analyst'].includes(userRole);

    if (requiredRole === 'system_administrator') return userRole === 'admin';
    if (requiredRole === 'analyst') return ['admin', 'department_head', 'user_analyst'].includes(userRole);

    return userRole === 'admin';
  };

  const value = {
    user,
    login,
    logout,
    loading,
    error,
    clearError,
    refreshUser,
    setActiveDepartment,
    hasRole,
    isAuthenticated: !!user,
    activeDepartmentId: user?.active_department_id || null,
    activeDepartment: user?.accessible_departments?.find(
      (department) => department.id === user?.active_department_id
    ) || null,
    accessibleDepartments: user?.accessible_departments || []
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
