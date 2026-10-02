import React, { useState, useEffect } from 'react';

const OrganizationManager = ({ hasRole, onNavigate }) => {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newOrganization, setNewOrganization] = useState({
    name: '',
    description: '',
    settings: {}
  });
  const [isCreating, setIsCreating] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);

  useEffect(() => {
    if (hasRole('admin')) {
      loadOrganizations();
    }
  }, [hasRole]);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/organizations', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load organizations');
      }
      
      const data = await response.json();
      // Handle both response formats
      const orgsArray = data.data?.organizations || data.data || data;
      setOrganizations(Array.isArray(orgsArray) ? orgsArray : []);
    } catch (err) {
      setError('Failed to load organizations: ' + err.message);
      console.error('Error loading organizations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrganization = async (e) => {
    e.preventDefault();
    
    if (!newOrganization.name) {
      setError('Organization name is required');
      return;
    }

    setIsCreating(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newOrganization)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create organization');
      }

      setNewOrganization({ name: '', description: '', settings: {} });
      setShowCreateForm(false);
      setError(null);
      await loadOrganizations();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateOrganization = async (orgId, updates) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/organizations/${orgId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update organization');
      }

      setEditingOrg(null);
      setError(null);
      await loadOrganizations();
    } catch (err) {
      setError('Failed to update organization: ' + err.message);
      console.error('Error updating organization:', err);
    }
  };

  const handleDeactivateOrganization = async (orgId) => {
    if (!window.confirm('Вы уверены, что хотите деактивировать эту организацию? Это повлияет на все отделы и пользователей в ней.')) {
      return;
    }

    // Backend uses DELETE method, not PUT with /deactivate
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/organizations/${orgId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to deactivate organization');
      }

      await loadOrganizations();
    } catch (err) {
      setError('Failed to deactivate organization: ' + err.message);
      console.error('Error deactivating organization:', err);
    }
  };

  if (!hasRole('admin')) {
    return (
      <div className="access-denied">
        <h3>🚫 Доступ запрещен</h3>
        <p>Вам нужны права Системного Администратора для управления организациями.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Загрузка организаций...</p>
      </div>
    );
  }

  return (
    <div className="organizations-page">
      <div className="page-header">
        <div className="page-title-section">
          <h1 className="page-title">
            <span>🏢</span>
            <span>Управление организациями</span>
          </h1>
          <p className="page-subtitle">Эта страница позволит вам управлять организациями в системе.</p>
        </div>
        
        <div className="header-actions">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="create-organization-btn"
          >
            <span>➕</span>
            <span>{showCreateForm ? 'Отмена' : 'Создать организацию'}</span>
          </button>
          {onNavigate && (
            <button
              onClick={() => onNavigate('/dashboard')}
              className="nav-button"
            >
              Назад к дашборду
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error organization-alert">
          {error}
        </div>
      )}

      {showCreateForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Создать новую организацию</h3>
              <button onClick={() => setShowCreateForm(false)} className="modal-close">×</button>
            </div>
            
            <form onSubmit={handleCreateOrganization}>
              <div className="form-section">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label required">Название организации</label>
                    <input
                      type="text"
                      value={newOrganization.name}
                      onChange={(e) => setNewOrganization({ ...newOrganization, name: e.target.value })}
                      required
                      disabled={isCreating}
                      className="form-input"
                      placeholder="Введите название"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Описание</label>
                    <input
                      type="text"
                      value={newOrganization.description}
                      onChange={(e) => setNewOrganization({ ...newOrganization, description: e.target.value })}
                      disabled={isCreating}
                      className="form-input"
                      placeholder="Введите описание"
                    />
                  </div>
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  disabled={isCreating}
                  className="btn btn-secondary"
                >
                  <span>←</span>
                  <span>Отмена</span>
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="btn btn-primary"
                >
                  <span>✓</span>
                  <span>{isCreating ? 'Создание...' : 'Создать организацию'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="organization-table-shell">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Описание</th>
              <th>Отделов</th>
              <th>Создано</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((org) => (
              <tr key={org.id}>
                <td>
                  <div className="org-name-cell">
                    {editingOrg === org.id ? (
                      <input
                        type="text"
                        defaultValue={org.name}
                        onBlur={(e) => handleUpdateOrganization(org.id, { name: e.target.value })}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            handleUpdateOrganization(org.id, { name: e.target.value });
                          }
                        }}
                        className="inline-edit-input"
                      />
                    ) : (
                      <span
                        onClick={() => setEditingOrg(org.id)}
                        className="editable-text"
                        title="Нажмите для редактирования"
                      >
                        {org.name}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="org-description">{org.description || '-'}</div>
                </td>
                <td>
                  <span className="dept-count">
                    <span className="dept-icon">🏢</span>
                    <span>{parseInt(org.department_count) || 0}</span>
                  </span>
                </td>
                <td>
                  <span className="last-login">
                    {new Date(org.created_at).toLocaleDateString('ru-RU')}
                  </span>
                </td>
                <td>
                  <span className={`org-status-badge ${org.is_active ? 'org-status-active' : 'org-status-inactive'}`}>
                    {org.is_active ? 'Активна' : 'Неактивна'}
                  </span>
                </td>
                <td>
                  <div className="organization-actions">
                    <button
                      className="organization-action-btn organization-action-view"
                      title="Просмотр"
                      onClick={() => console.log('View org:', org.id)}
                    >
                      👁️
                    </button>
                    <button
                      className="organization-action-btn organization-action-edit"
                      title="Редактировать"
                      onClick={() => setEditingOrg(org.id)}
                    >
                      ✏️
                    </button>
                    <button
                      className="organization-action-btn organization-action-settings"
                      title="Настройки"
                      onClick={() => setError('Функция настроек пока не реализована')}
                    >
                      ⚙️
                    </button>
                    {org.is_active && (
                      <button
                        className="organization-action-btn organization-action-delete"
                        title="Удалить"
                        onClick={() => handleDeactivateOrganization(org.id)}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {organizations.length === 0 && (
        <div className="organization-empty-state">
          Организации не найдены. Создайте первую организацию для начала работы.
        </div>
      )}
    </div>
  );
};

export default OrganizationManager;
