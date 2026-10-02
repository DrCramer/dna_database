import React, { useState, useEffect } from 'react';

const DepartmentManager = ({ hasRole = () => false, onNavigate }) => {
  const [departments, setDepartments] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDepartment, setNewDepartment] = useState({
    name: '',
    description: '',
    organization_id: ''
  });
  const [isCreating, setIsCreating] = useState(false);
  const [editingDept, setEditingDept] = useState(null);

  useEffect(() => {
    if (hasRole('system_administrator') || hasRole('department_head')) {
      loadDepartments();
      loadOrganizations();
    }
  }, [hasRole]);

  const loadDepartments = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/organizations/departments', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load departments');
      }
      
      const data = await response.json();
      setDepartments(Array.isArray(data) ? data : data.data || []);
    } catch (err) {
      setError('Failed to load departments: ' + err.message);
      console.error('Error loading departments:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadOrganizations = async () => {
    try {
      const response = await fetch('/api/organizations', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load organizations');
      }
      
      const data = await response.json();
      const orgs = data.data?.organizations || data.data || data || [];
      setOrganizations(Array.isArray(orgs) ? orgs.filter(org => org.is_active) : []);
    } catch (err) {
      console.error('Error loading organizations:', err);
      setOrganizations([]);
    }
  };

  const handleCreateDepartment = async (e) => {
    e.preventDefault();
    
    if (!newDepartment.name || !newDepartment.organization_id) {
      setError('Department name and organization are required');
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch(`/api/organizations/${newDepartment.organization_id}/departments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          name: newDepartment.name,
          description: newDepartment.description
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create department');
      }

      setNewDepartment({ name: '', description: '', organization_id: '' });
      setShowCreateForm(false);
      setError(null);
      await loadDepartments();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateDepartment = async (deptId, updates) => {
    try {
      const dept = departments.find(d => d.id === deptId);
      if (!dept) {
        throw new Error('Department not found');
      }

      const response = await fetch(`/api/organizations/${dept.organization_id}/departments/${deptId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update department');
      }

      setEditingDept(null);
      setError(null);
      await loadDepartments();
    } catch (err) {
      setError('Failed to update department: ' + err.message);
      console.error('Error updating department:', err);
    }
  };

  const handleDeactivateDepartment = async (deptId) => {
    if (!window.confirm('Вы уверены, что хотите деактивировать этот отдел? Это повлияет на всех пользователей и данные внутри него.')) {
      return;
    }

    try {
      const dept = departments.find(d => d.id === deptId);
      if (!dept) {
        throw new Error('Department not found');
      }

      const response = await fetch(`/api/organizations/${dept.organization_id}/departments/${deptId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to deactivate department');
      }

      setError(null);
      await loadDepartments();
    } catch (err) {
      setError('Failed to deactivate department: ' + err.message);
      console.error('Error deactivating department:', err);
    }
  };

  if (!hasRole('system_administrator') && !hasRole('department_head')) {
    return (
      <div className="access-denied">
        <h3>🚫 Доступ запрещен</h3>
        <p>Для управления отделами нужны права системного администратора или руководителя подразделения.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Загрузка отделов...</p>
      </div>
    );
  }

  return (
    <div className="departments-page">
      <div className="page-header">
        <div className="page-title-section">
          <h1 className="page-title">
            <span>🏛️</span>
            <span>Управление отделами</span>
          </h1>
          <p className="page-subtitle">Эта страница позволит вам управлять отделами внутри организаций.</p>
        </div>
        
        <div className="departments-controls">
          {hasRole('system_administrator') && (
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="create-department-btn"
            >
              <span>➕</span>
              <span>{showCreateForm ? 'Отмена' : 'Добавить новый отдел'}</span>
            </button>
          )}
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

      {showCreateForm && hasRole('system_administrator') && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Создать новый отдел</h3>
              <button onClick={() => setShowCreateForm(false)} className="modal-close">×</button>
            </div>
            
            <form onSubmit={handleCreateDepartment}>
              <div className="form-section">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label required">Название отдела</label>
                    <input
                      type="text"
                      value={newDepartment.name}
                      onChange={(e) => setNewDepartment({ ...newDepartment, name: e.target.value })}
                      required
                      disabled={isCreating}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label required">Организация</label>
                    <div className="select-wrapper">
                      <select
                        value={newDepartment.organization_id}
                        onChange={(e) => setNewDepartment({ ...newDepartment, organization_id: e.target.value })}
                        required
                        disabled={isCreating}
                        className="form-select"
                      >
                        <option value="">Выберите организацию</option>
                        {organizations.map(org => (
                          <option key={org.id} value={org.id}>{org.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Описание</label>
                    <input
                      type="text"
                      value={newDepartment.description}
                      onChange={(e) => setNewDepartment({ ...newDepartment, description: e.target.value })}
                      disabled={isCreating}
                      className="form-input"
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
                  <span>{isCreating ? 'Создание...' : 'Создать отдел'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="organization-table-shell departments-table-shell">
        <table>
          <thead>
            <tr>
              <th>Отдел</th>
              <th>Организация</th>
              <th>Пользователи</th>
              <th>Мастер массив</th>
              <th>Создан</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((dept) => (
              <tr key={dept.id}>
                <td>
                  {editingDept === dept.id ? (
                    <input
                      type="text"
                      defaultValue={dept.name}
                      onBlur={(e) => handleUpdateDepartment(dept.id, { name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateDepartment(dept.id, { name: e.target.value });
                        }
                      }}
                      className="form-input"
                    />
                  ) : (
                    <div>
                      <strong
                        onClick={() => hasRole('system_administrator') && setEditingDept(dept.id)}
                        className={hasRole('system_administrator') ? 'editable-text' : ''}
                        title={hasRole('system_administrator') ? "Нажмите для редактирования" : ""}
                      >
                        {dept.name}
                      </strong>
                      {dept.description && (
                        <div className="department-head">{dept.description}</div>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`org-badge ${
                    dept.organization_name?.includes('Судебно') ? 'org-forensic' :
                    dept.organization_name?.includes('Полиция') ? 'org-police' :
                    'org-research'
                  }`}>
                    {dept.organization_name}
                  </span>
                </td>
                <td>
                  <div className="department-stats">
                    <div className="stat-item">
                      <span className="stat-icon">👥</span>
                      <span>{dept.user_count || 0} сотрудников</span>
                    </div>
                  </div>
                </td>
                <td>
                  {dept.master_array_id ? (
                    <div className="department-stats">
                      <div className="stat-item">
                        <span className="stat-icon">🧬</span>
                        <span>{parseInt(dept.profile_count) || 0} профилей</span>
                      </div>
                    </div>
                  ) : (
                    <span className="user-status-badge user-status-inactive">Не создан</span>
                  )}
                </td>
                <td>
                  <span className="last-login">
                    {new Date(dept.created_at).toLocaleDateString('ru-RU')}
                  </span>
                </td>
                <td>
                  <span className={`user-status-badge ${dept.is_active ? 'user-status-active' : 'user-status-inactive'}`}>
                    {dept.is_active ? 'Активен' : 'Неактивен'}
                  </span>
                </td>
                <td>
                  <div className="department-actions">
                    <button
                      className="department-action-btn department-action-view"
                      title="Просмотр"
                      onClick={() => alert('Функция просмотра деталей отдела будет реализована позже')}
                    >
                      👁️
                    </button>
                    {hasRole('system_administrator') && (
                      <>
                        <button
                          onClick={() => setEditingDept(dept.id)}
                          className="department-action-btn department-action-edit"
                          title="Редактировать"
                        >
                          ✏️
                        </button>
                        <button
                          className="department-action-btn department-action-settings"
                          title="Настройки"
                          onClick={() => alert('Функция настроек отдела будет реализована позже')}
                        >
                          ⚙️
                        </button>
                        {dept.is_active && (
                          <button
                            onClick={() => handleDeactivateDepartment(dept.id)}
                            className="department-action-btn department-action-delete"
                            title="Удалить"
                          >
                            🗑️
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {departments.length === 0 && (
        <div className="organization-empty-state">
          Отделы не найдены. {hasRole('system_administrator') ? 'Создайте первый отдел для начала работы.' : 'Обратитесь к администратору для создания отделов.'}
        </div>
      )}
    </div>
  );
};

export default DepartmentManager;
