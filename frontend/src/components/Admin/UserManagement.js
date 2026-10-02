import React, { useState, useEffect } from 'react';
import './UserManagement.css';

const UserManagement = ({ onBack }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showUserDetails, setShowUserDetails] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [departments, setDepartments] = useState([]);

  const usersPerPage = 10;

  // Роли пользователей
  const roles = [
    { value: 'admin', label: 'Администратор', description: 'Абсолютно полный контроль над системой' },
    { value: 'department_head', label: 'Руководитель', description: 'Управление пользователями, отделами, задачами, анализ' },
    { value: 'user_analyst', label: 'Эксперт', description: 'Загрузка профилей, байесовский анализ, просмотр задач' }
  ];

  // Загрузка пользователей
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const params = new URLSearchParams({
        page: currentPage,
        limit: usersPerPage,
        ...(searchTerm && { search: searchTerm }),
        ...(roleFilter && { role: roleFilter })
      });

      const response = await fetch(`/api/users?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Ошибка загрузки пользователей');
      }

      const data = await response.json();
      setUsers(data.data.users || []);
      setTotalPages(Math.ceil((data.data.total || 0) / usersPerPage));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка организаций и департаментов
  const fetchOrganizationsAndDepartments = async () => {
    try {
      const token = localStorage.getItem('token');
      
      const [orgsResponse, deptsResponse] = await Promise.all([
        fetch('/api/organizations?page=1&limit=1000', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/organizations/departments', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (orgsResponse.ok) {
        const orgsData = await orgsResponse.json();
        const orgs = orgsData.data?.organizations || orgsData.data || [];
        setOrganizations(Array.isArray(orgs) ? orgs : []);
      } else {
        console.error('Не удалось загрузить организации:', orgsResponse.status);
        setOrganizations([]);
      }

      if (deptsResponse.ok) {
        const deptsData = await deptsResponse.json();
        const depts = deptsData.data || [];
        setDepartments(Array.isArray(depts) ? depts : []);
      } else {
        console.error('Не удалось загрузить отделы:', deptsResponse.status);
        setDepartments([]);
      }
    } catch (err) {
      console.error('Не удалось загрузить организации и отделы:', err);
      setOrganizations([]);
      setDepartments([]);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchOrganizationsAndDepartments();
  }, [currentPage, searchTerm, roleFilter]);

  // Создание пользователя
  const handleCreateUser = async (userData) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/register-with-department', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка создания пользователя');
      }

      setShowCreateForm(false);
      fetchUsers();
      alert('Пользователь успешно создан');
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    }
  };

  // Обновление пользователя
  const handleUpdateUser = async (userId, userData) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка обновления пользователя');
      }

      setEditingUser(null);
      fetchUsers();
      alert('Пользователь успешно обновлен');
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    }
  };

  // Деактивация пользователя
  const handleDeactivateUser = async (userId) => {
    if (!confirm('Вы уверены, что хотите деактивировать этого пользователя?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      
      if (!token) {
        alert('Ошибка: токен авторизации не найден. Пожалуйста, войдите в систему заново.');
        return;
      }

      const response = await fetch(`/api/users/${userId}/deactivate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Ошибка деактивации:', errorData);
        throw new Error(errorData.message || `Ошибка ${response.status}: ${response.statusText}`);
      }

      await response.json();

      fetchUsers();
      alert('Пользователь деактивирован');
    } catch (err) {
      console.error('Ошибка деактивации пользователя:', err);
      alert(`Ошибка: ${err.message}`);
    }
  };

  // Сброс пароля
  const handleResetPassword = async (userId) => {
    if (!confirm('Вы уверены, что хотите сбросить пароль этого пользователя?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Ошибка сброса пароля');
      }

      const data = await response.json();
      alert(`Пароль сброшен. Новый пароль: ${data.data.temporaryPassword}`);
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    }
  };

  // Форма создания/редактирования пользователя
  const UserForm = ({ user, onSubmit, onCancel }) => {
    const [formData, setFormData] = useState({
      username: user?.username || '',
      email: user?.email || '',
      password: '',
      role: user?.role || 'user_analyst',
      organization_id: user?.organization_id || '',
      department_ids: Array.isArray(user?.accessible_departments) && user.accessible_departments.length > 0
        ? user.accessible_departments.map((department) => department.id)
        : (user?.department_id ? [user.department_id] : [])
    });

    const handleSubmit = (e) => {
      e.preventDefault();
      
      // Валидация
      if (!formData.username || !formData.email || (!user && !formData.password)) {
        alert('Заполните все обязательные поля');
        return;
      }
      
      // Валидация организации и отдела (обязательны для всех ролей)
      if (!formData.organization_id || formData.department_ids.length === 0) {
        alert('Организация и минимум один отдел являются обязательными полями');
        return;
      }

      const submitData = { ...formData };
      if (user && !formData.password) {
        delete submitData.password; // Не обновляем пароль если он не указан
      }

      onSubmit(submitData);
    };

    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <div className="modal-header">
            <h3 className="modal-title">
              {user ? 'Редактировать пользователя' : 'Создать пользователя'}
            </h3>
            <button onClick={onCancel} className="modal-close">×</button>
          </div>
          
          <form onSubmit={handleSubmit}>
            <div className="user-form-shell">
              <div className="user-form-column">
                <div className="form-section">
                  <h4 className="section-title">Основная информация</h4>

                  <div className="form-grid form-grid-compact">
                    <div className="form-group">
                      <label className="form-label required">Имя пользователя</label>
                      <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({...formData, username: e.target.value})}
                        className="form-input"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label required">Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({...formData, email: e.target.value})}
                        className="form-input"
                        required
                      />
                    </div>

                    <div className="form-group form-group-full">
                      <label className={`form-label ${user ? '' : 'required'}`}>
                        {user ? 'Новый пароль' : 'Пароль'}
                      </label>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({...formData, password: e.target.value})}
                        className="form-input"
                        placeholder={user ? 'Оставьте пустым, чтобы не менять' : ''}
                        required={!user}
                      />
                      {user && (
                        <small className="form-hint">
                          Оставьте пустым, чтобы не менять
                        </small>
                      )}
                    </div>
                  </div>
                </div>

                <div className="form-section">
                  <h4 className="section-title">Организация</h4>

                  <div className="form-group">
                    <label className="form-label required">Организация</label>
                    <div className="select-wrapper">
                      <select
                        value={formData.organization_id}
                        onChange={(e) => setFormData({
                          ...formData,
                          organization_id: e.target.value,
                          department_ids: []
                        })}
                        className="form-select"
                        required
                      >
                        <option value="">Выберите организацию</option>
                        {organizations.map(org => (
                          <option key={org.id} value={org.id}>
                            {org.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="user-form-column user-form-column-narrow">
                <div className="form-section">
                  <h4 className="section-title">Роль</h4>

                  <div className="role-options role-options-compact">
                    {roles.map(role => (
                      <label
                        key={role.value}
                        className={`role-option ${formData.role === role.value ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={role.value}
                          checked={formData.role === role.value}
                          onChange={(e) => setFormData({...formData, role: e.target.value})}
                        />
                        <div>
                          <div className="role-name">{role.label}</div>
                          <div className="role-desc">{role.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="form-section">
                  <h4 className="section-title">Отделы</h4>

                  <div className="form-group">
                    <label className="form-label required">Доступные отделы</label>
                    <div className="department-checkboxes department-checkboxes-compact">
                      {departments
                        .filter(dept => !formData.organization_id || dept.organization_id === formData.organization_id)
                        .map((dept) => {
                          const isChecked = formData.department_ids.includes(dept.id);
                          return (
                            <label
                              key={dept.id}
                              className={`department-checkbox ${isChecked ? 'is-selected' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    department_ids: e.target.checked
                                      ? [...prev.department_ids, dept.id]
                                      : prev.department_ids.filter((departmentId) => departmentId !== dept.id)
                                  }));
                                }}
                              />
                              <span>{dept.name}</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Кнопки действий */}
            <div className="form-actions">
              <button
                type="button"
                onClick={onCancel}
                className="btn btn-secondary"
              >
                <span>←</span>
                <span>Отмена</span>
              </button>
              <button
                type="submit"
                className="btn btn-primary"
              >
                <span>✓</span>
                <span>{user ? 'Обновить' : 'Создать'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Детали пользователя
  const UserDetails = ({ user, onClose }) => {
    const [sessions, setSessions] = useState([]);

    useEffect(() => {
      // Загрузка сессий пользователя
      const fetchUserSessions = async () => {
        try {
          const token = localStorage.getItem('token');
          const response = await fetch(`/api/users/${user.id}/sessions`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            const data = await response.json();
            setSessions(Array.isArray(data.data) ? data.data : []);
          } else {
            console.error('Ошибка загрузки сессий:', response.status);
            setSessions([]);
          }
        } catch (err) {
          console.error('Ошибка загрузки сессий:', err);
          setSessions([]);
        }
      };

      fetchUserSessions();
    }, [user.id]);

    return (
      <div className="modal-overlay user-details-overlay">
        <div className="user-details-modal">
          <div className="user-details-header">
            <h3>Детали пользователя</h3>
            <button onClick={onClose} className="user-details-close">×</button>
          </div>

          <div className="user-details-section">
            <h4>Основная информация</h4>
            <p><strong>Имя пользователя:</strong> {user.username}</p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Роль:</strong> {roles.find(r => r.value === user.role)?.label || user.role}</p>
            <p><strong>Статус:</strong> {user.is_active ? 'Активен' : 'Неактивен'}</p>
            <p><strong>Дата создания:</strong> {new Date(user.created_at).toLocaleString('ru-RU')}</p>
            <p><strong>Последний вход:</strong> {user.last_login ? new Date(user.last_login).toLocaleString('ru-RU') : 'Никогда'}</p>
          </div>

          <div className="user-details-section">
            <h4>Активные сессии ({sessions.length})</h4>
            {sessions.length > 0 ? (
              <div className="user-sessions-list">
                {sessions.map(session => (
                  <div key={session.id} className="user-session-item">
                    <p>
                      <strong>IP:</strong> {session.ip_address}
                    </p>
                    <p>
                      <strong>Браузер:</strong> {session.user_agent}
                    </p>
                    <p>
                      <strong>Создана:</strong> {new Date(session.created_at).toLocaleString('ru-RU')}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="user-details-empty">Нет активных сессий</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="user-loading-state">
        <p>Загрузка пользователей...</p>
      </div>
    );
  }

  return (
    <div className="user-management departments-page">
      <div className="page-header user-management-header">
        <div className="page-title-section">
          <h1 className="page-title">
            <span>👥</span>
            <span>Управление пользователями</span>
          </h1>
          <p className="page-subtitle user-management-subtitle">Создание учетных записей, назначение ролей и контроль доступа по организации.</p>
        </div>
        <div className="departments-controls user-management-header-actions">
          <button
            onClick={onBack}
            className="nav-button"
          >
            Назад к дашборду
          </button>
        </div>
      </div>

      {/* Панель управления */}
      <div className="user-management-controls departments-controls">
        <div className="user-management-filters">
          <button
            className={`role-filter ${!roleFilter ? 'active' : ''}`}
            onClick={() => setRoleFilter('')}
          >
            Все роли
          </button>
          {roles.map(role => (
            <button
              key={role.value}
              className={`role-filter ${roleFilter === role.value ? 'active' : ''}`}
              onClick={() => setRoleFilter(role.value)}
            >
              {role.label}
            </button>
          ))}
        </div>
        
        <button
          onClick={() => setShowCreateForm(true)}
          className="create-department-btn create-user-btn"
        >
          <span>+</span>
          <span>Создать пользователя</span>
        </button>
      </div>

      {/* Ошибка */}
      {error && (
        <div className="user-error-banner organization-alert">
          {error}
        </div>
      )}

      {/* Таблица пользователей */}
      <div className="user-management-table organization-table-shell">
        <table>
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Роль</th>
              <th>Отделы</th>
              <th>Статус</th>
              <th>Последний вход</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>
                  <div>
                    <strong>{user.username}</strong>
                    <div className="user-email">{user.email}</div>
                  </div>
                </td>
                <td>
                  <span className={`user-role-badge org-badge ${
                    user.role === 'admin' ? 'role-admin' :
                    user.role === 'department_head' ? 'role-manager' :
                    'role-expert'
                  }`}>
                    {roles.find(r => r.value === user.role)?.label || user.role}
                  </span>
                </td>
                <td>
                  <span className="user-departments-cell">
                    {user.department_names || user.department_name || '—'}
                  </span>
                </td>
                <td>
                  <span className={`user-status-badge ${user.is_active ? 'user-status-active' : 'user-status-inactive'}`}>
                    {user.is_active ? 'Активен' : 'Неактивен'}
                  </span>
                </td>
                <td>
                  <span className="last-login">
                    {user.last_login ? new Date(user.last_login).toLocaleString('ru-RU') : 'Никогда'}
                  </span>
                </td>
                <td>
                  <div className="user-actions department-actions">
                    <button
                      onClick={() => setShowUserDetails(user)}
                      className="user-action-btn department-action-btn department-action-view user-action-view"
                      title="Просмотр"
                    >
                      👁️
                    </button>
                    <button
                      onClick={() => setEditingUser(user)}
                      className="user-action-btn department-action-btn department-action-edit user-action-edit"
                      title="Редактировать"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleResetPassword(user.id)}
                      className="user-action-btn department-action-btn department-action-settings user-action-reset"
                      title="Сбросить пароль"
                    >
                      🔑
                    </button>
                    {user.is_active && (
                      <button
                        onClick={() => handleDeactivateUser(user.id)}
                        className="user-action-btn department-action-btn department-action-delete user-action-deactivate"
                        title="Деактивировать"
                      >
                        🚫
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="user-empty-state organization-empty-state">
            Пользователи не найдены
          </div>
        )}
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="user-pagination">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="user-pagination-btn"
          >
            ← Предыдущая
          </button>
          
          <span className="page-info">
            Страница {currentPage} из {totalPages}
          </span>
          
          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="user-pagination-btn"
          >
            Следующая →
          </button>
        </div>
      )}

      {/* Модальные окна */}
      {showCreateForm && (
        <UserForm
          onSubmit={handleCreateUser}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {editingUser && (
        <UserForm
          user={editingUser}
          onSubmit={(userData) => handleUpdateUser(editingUser.id, userData)}
          onCancel={() => setEditingUser(null)}
        />
      )}

      {showUserDetails && (
        <UserDetails
          user={showUserDetails}
          onClose={() => setShowUserDetails(null)}
        />
      )}
    </div>
  );
};

export default UserManagement;
