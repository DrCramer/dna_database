import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const ExpertGroupManager = () => {
  const { user, hasRole } = useAuth();
  const [expertGroups, setExpertGroups] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroup, setNewGroup] = useState({
    name: '',
    description: '',
    department_id: '',
    member_ids: []
  });
  const [isCreating, setIsCreating] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [showMembersModal, setShowMembersModal] = useState(null);

  useEffect(() => {
    if (hasRole('system_administrator') || hasRole('department_head')) {
      loadExpertGroups();
      loadDepartments();
      loadUsers();
    }
  }, [hasRole]);

  const loadExpertGroups = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/expert-groups', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Не удалось загрузить экспертные группы');
      }

      const data = await response.json();
      setExpertGroups(data);
    } catch (err) {
      setError('Не удалось загрузить экспертные группы: ' + err.message);
      console.error('Error loading expert groups:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await fetch('/api/departments', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Не удалось загрузить отделы');
      }

      const data = await response.json();
      setDepartments(data.filter(dept => dept.is_active));
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/users', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Не удалось загрузить пользователей');
      }

      const data = await response.json();
      setUsers(data);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();

    if (!newGroup.name || !newGroup.department_id) {
      setError('Group name and department are required');
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch('/api/expert-groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(newGroup)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось создать экспертную группу');
      }

      setNewGroup({ name: '', description: '', department_id: '', member_ids: [] });
      setShowCreateForm(false);
      setError(null);
      await loadExpertGroups();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateGroup = async (groupId, updates) => {
    try {
      const response = await fetch(`/api/expert-groups/${groupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось обновить экспертную группу');
      }

      setEditingGroup(null);
      await loadExpertGroups();
    } catch (err) {
      setError('Не удалось обновить экспертную группу: ' + err.message);
      console.error('Error updating expert group:', err);
    }
  };

  const handleAddMember = async (groupId, userId) => {
    try {
      const response = await fetch(`/api/expert-groups/${groupId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ user_id: userId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось добавить участника');
      }

      await loadExpertGroups();
    } catch (err) {
      setError('Не удалось добавить участника: ' + err.message);
      console.error('Error adding member:', err);
    }
  };

  const handleRemoveMember = async (groupId, userId) => {
    try {
      const response = await fetch(`/api/expert-groups/${groupId}/members/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось удалить участника');
      }

      await loadExpertGroups();
    } catch (err) {
      setError('Не удалось удалить участника: ' + err.message);
      console.error('Error removing member:', err);
    }
  };

  const handleDeactivateGroup = async (groupId) => {
    if (!window.confirm('Вы уверены, что хотите деактивировать эту экспертную группу? Это повлияет на текущие задачи.')) {
      return;
    }

    try {
      const response = await fetch(`/api/expert-groups/${groupId}/deactivate`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось деактивировать экспертную группу');
      }

      await loadExpertGroups();
    } catch (err) {
      setError('Не удалось деактивировать экспертную группу: ' + err.message);
      console.error('Error deactivating expert group:', err);
    }
  };

  const getAvailableUsers = (departmentId, currentMembers = []) => {
    return users.filter(user =>
      user.department_id === parseInt(departmentId) &&
      !currentMembers.some(member => member.id === user.id)
    );
  };

  if (!hasRole('system_administrator') && !hasRole('department_head')) {
    return (
      <div className="access-denied">
        <h3>🚫 Доступ запрещен</h3>
        <p>Для управления экспертными группами нужны права системного администратора или руководителя подразделения.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Загрузка экспертных групп...</p>
      </div>
    );
  }

  return (
    <div className="departments-page">
      <div className="page-header">
        <div>
          <h1 className="page-title departments">Управление экспертными группами</h1>
          <p className="page-subtitle">Создание экспертных групп, управление составом и распределением по отделам.</p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="create-department-btn btn btn-primary"
        >
          <span>➕</span>
          <span>{showCreateForm ? 'Отмена' : 'Создать экспертную группу'}</span>
        </button>
      </div>

      {error && (
        <div className="alert alert-error organization-alert">
          {error}
        </div>
      )}

      {showCreateForm && (
        <div className="modal-content department-create-panel modal-lg">
          <h3 className="modal-title">Создать новую экспертную группу</h3>
          <form onSubmit={handleCreateGroup}>
            <div className="form-grid department-create-grid">
              <div className="form-group">
                <label className="form-label required">
                  Название группы
                </label>
                <input
                  type="text"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  required
                  disabled={isCreating}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label required">
                  Отдел
                </label>
                <select
                  value={newGroup.department_id}
                  onChange={(e) => setNewGroup({ ...newGroup, department_id: e.target.value })}
                  required
                  disabled={isCreating}
                  className="form-select"
                >
                  <option value="">Выберите отдел</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  Описание
                </label>
                <input
                  type="text"
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  disabled={isCreating}
                  className="form-input"
                />
              </div>
            </div>
            <div className="form-actions">
              <button
                type="submit"
                disabled={isCreating}
                className="btn btn-primary"
              >
                {isCreating ? 'Создание...' : 'Создать экспертную группу'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                disabled={isCreating}
                className="btn btn-secondary"
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="organization-table-shell">
        <table>
          <thead>
            <tr>
              <th>Группа</th>
              <th>Отдел</th>
              <th>Описание</th>
              <th>Участники</th>
              <th>Активные задачи</th>
              <th>Создана</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {expertGroups.map((group, index) => (
              <tr key={group.id} className={index % 2 === 0 ? 'organization-row-even' : 'organization-row-odd'}>
                <td>
                  {editingGroup === group.id ? (
                    <input
                      type="text"
                      defaultValue={group.name}
                      onBlur={(e) => handleUpdateGroup(group.id, { name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateGroup(group.id, { name: e.target.value });
                        }
                      }}
                      className="form-input"
                    />
                  ) : (
                    <span
                      onClick={() => setEditingGroup(group.id)}
                      className="editable-text"
                      title="Нажмите для редактирования"
                    >
                      {group.name}
                    </span>
                  )}
                </td>
                <td>
                  {group.department_name}
                </td>
                <td className="organization-muted">
                  {group.description || '-'}
                </td>
                <td>
                  <div className="organization-members-inline">
                    <span>{group.member_count || 0}</span>
                    <button
                      onClick={() => setShowMembersModal(group)}
                      className="btn btn-secondary btn-sm"
                    >
                      Состав
                    </button>
                  </div>
                </td>
                <td>
                  {group.active_tasks || 0}
                </td>
                <td className="organization-muted">
                  {new Date(group.created_at).toLocaleDateString('ru-RU')}
                </td>
                <td>
                  <span className={`organization-status-badge ${group.is_active ? 'active' : 'inactive'}`}>
                    {group.is_active ? 'Активна' : 'Неактивна'}
                  </span>
                </td>
                <td>
                  <div className="organization-action-row">
                    {group.is_active && (
                      <button
                        onClick={() => handleDeactivateGroup(group.id)}
                        className="btn btn-danger btn-sm"
                      >
                        Деактивировать
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {expertGroups.length === 0 && (
        <div className="organization-empty-state">
          Экспертные группы не найдены. Создайте первую группу для начала работы.
        </div>
      )}

      {/* Members Management Modal */}
      {showMembersModal && (
        <div className="modal-overlay">
          <div className="organization-modal-panel modal-content modal-lg">
            <div className="organization-modal-header">
              <h3>Состав группы: {showMembersModal.name}</h3>
              <button
                onClick={() => setShowMembersModal(null)}
                className="organization-modal-close"
               aria-label="Закрыть">
                ×
              </button>
            </div>

            <div className="user-details-section">
              <h4>Текущие участники</h4>
              {showMembersModal.members && showMembersModal.members.length > 0 ? (
                <div className="organization-list-stack">
                  {showMembersModal.members.map(member => (
                    <div key={member.id} className="organization-list-card">
                      <span>{member.username} ({member.email})</span>
                      <button
                        onClick={() => handleRemoveMember(showMembersModal.id, member.id)}
                        className="btn btn-danger btn-sm"
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="organization-list-card-empty">Участники пока не назначены</p>
              )}
            </div>

            <div>
              <h4>Добавить участников</h4>
              {getAvailableUsers(showMembersModal.department_id, showMembersModal.members).length > 0 ? (
                <div className="organization-list-stack">
                  {getAvailableUsers(showMembersModal.department_id, showMembersModal.members).map(user => (
                    <div key={user.id} className="organization-list-card">
                      <span>{user.username} ({user.email}) - {user.role}</span>
                      <button
                        onClick={() => handleAddMember(showMembersModal.id, user.id)}
                        className="btn btn-primary btn-sm"
                      >
                        Добавить
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="organization-list-card-empty">В этом отделе нет доступных пользователей</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpertGroupManager;
