import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import '../../styles/pages/tasks.css';

const TaskCreator = ({ onTaskCreated, onCancel }) => {
  const { hasRole } = useAuth();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    assigned_to_user: '',
    assigned_to_group: '',
    target_sample: '',
    data_source: 'master_array',
    data_source_id: '',
    priority: 'medium',
    deadline: ''
  });
  const [users, setUsers] = useState([]);
  const [expertGroups, setExpertGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [assignmentType, setAssignmentType] = useState('user');

  useEffect(() => {
    loadUsersAndGroups();
  }, []);

  const loadUsersAndGroups = async () => {
    try {
      const [usersResponse, groupsResponse] = await Promise.all([
        fetch('/api/users/department', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }),
        fetch('/api/expert-groups', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
      ]);

      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setUsers(usersData.data || []);
      }

      if (groupsResponse.ok) {
        const groupsData = await groupsResponse.json();
        setExpertGroups(groupsData.data || []);
      }
    } catch (err) {
      console.error('Error loading users and groups:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.title) {
      setError('Укажите название задачи');
      return;
    }

    if (!formData.target_sample) {
      setError('Укажите целевой образец');
      return;
    }

    if (assignmentType === 'user' && !formData.assigned_to_user) {
      setError('Выберите сотрудника для назначения задачи');
      return;
    }

    if (assignmentType === 'group' && !formData.assigned_to_group) {
      setError('Выберите экспертную группу для назначения задачи');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let targetSample;
      try {
        targetSample = JSON.parse(formData.target_sample);
      } catch {
        targetSample = { sample_name: formData.target_sample };
      }

      const taskData = {
        title: formData.title,
        description: formData.description,
        target_sample: targetSample,
        data_source: formData.data_source,
        data_source_id: formData.data_source_id || null,
        priority: formData.priority,
        deadline: formData.deadline || null
      };

      if (assignmentType === 'user') {
        taskData.assigned_to_user = formData.assigned_to_user;
      } else {
        taskData.assigned_to_group = formData.assigned_to_group;
      }

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(taskData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось создать задачу');
      }

      const result = await response.json();

      setFormData({
        title: '',
        description: '',
        assigned_to_user: '',
        assigned_to_group: '',
        target_sample: '',
        data_source: 'master_array',
        data_source_id: '',
        priority: 'medium',
        deadline: ''
      });
      setAssignmentType('user');

      if (onTaskCreated) {
        onTaskCreated(result.data.task);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!hasRole(['department_head', 'system_administrator'])) {
    return (
      <div className="alert alert-error task-viewer-state">
        <h3>Доступ ограничен</h3>
        <p>Создание задач доступно только руководителю подразделения или системному администратору.</p>
      </div>
    );
  }

  return (
    <div className="task-creator-shell task-creator-page">
      <div className="page-header task-creator-header">
        <div className="page-title-section">
          <h1 className="page-title">
            <span>📋</span>
            <span>Создание задачи</span>
          </h1>
          <p className="page-subtitle">Заполните параметры назначения и целевого образца для запуска анализа.</p>
        </div>
        <div className="departments-controls task-creator-controls">
          {onCancel && <button onClick={onCancel} className="nav-button">Отменить</button>}
        </div>
      </div>

      {error && <div className="alert alert-error organization-alert">{error}</div>}

      <form onSubmit={handleSubmit} className="task-creator-card task-creator-form-shell">
        <div className="task-creator-section">
          <div className="task-creator-section-head">
            <h3>Основные параметры</h3>
            <p>Укажите название, приоритет и краткое описание задачи.</p>
          </div>

          <div className="task-creator-grid">
            <div className="task-form-field">
              <label>Название задачи *</label>
              <input className="form-input" type="text" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required disabled={loading} />
            </div>
          </div>

          <div className="task-form-field">
            <label>Приоритет</label>
            <div className="task-priority-row" role="radiogroup" aria-label="Приоритет задачи">
              {[
                { value: 'low', label: 'Низкий' },
                { value: 'medium', label: 'Средний' },
                { value: 'high', label: 'Высокий' },
                { value: 'urgent', label: 'Срочный' }
              ].map((priorityOption) => (
                <label
                  key={priorityOption.value}
                  className={`task-priority-option task-priority-option--${priorityOption.value} ${formData.priority === priorityOption.value ? 'is-active' : ''}`}
                >
                  <input
                    type="radio"
                    name="priority"
                    value={priorityOption.value}
                    checked={formData.priority === priorityOption.value}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    disabled={loading}
                  />
                  <span>{priorityOption.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="task-form-field">
            <label>Описание</label>
            <textarea className="form-textarea" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} disabled={loading} rows={4} />
          </div>
        </div>

        <div className="task-creator-section">
          <div className="task-creator-section-head">
            <h3>Назначение</h3>
            <p>Выберите способ назначения и исполнителя для задачи.</p>
          </div>

          <div className="task-creator-grid">
            <div className="task-form-field">
              <label>Тип назначения</label>
              <select
                className="filter-select"
                value={assignmentType}
                onChange={(e) => {
                  setAssignmentType(e.target.value);
                  setFormData({
                    ...formData,
                    assigned_to_user: '',
                    assigned_to_group: ''
                  });
                }}
                disabled={loading}
              >
                <option value="user">Назначить сотруднику</option>
                <option value="group">Назначить экспертной группе</option>
              </select>
            </div>

            <div className="task-form-field">
              <label>{assignmentType === 'user' ? 'Сотрудник *' : 'Экспертная группа *'}</label>
              {assignmentType === 'user' ? (
                <select className="filter-select" value={formData.assigned_to_user} onChange={(e) => setFormData({ ...formData, assigned_to_user: e.target.value })} required disabled={loading}>
                  <option value="">Выберите сотрудника</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username} ({user.role})
                    </option>
                  ))}
                </select>
              ) : (
                <select className="filter-select" value={formData.assigned_to_group} onChange={(e) => setFormData({ ...formData, assigned_to_group: e.target.value })} required disabled={loading}>
                  <option value="">Выберите экспертную группу</option>
                  {expertGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        <div className="task-creator-section">
          <div className="task-creator-section-head">
            <h3>Данные для анализа</h3>
            <p>Настройте источник данных, срок и целевой образец.</p>
          </div>

          <div className="task-creator-grid">
            <div className="task-form-field">
              <label>Источник данных</label>
              <select className="filter-select" value={formData.data_source} onChange={(e) => setFormData({ ...formData, data_source: e.target.value })} disabled={loading}>
                <option value="master_array">Мастер-массив</option>
                <option value="user_array">Пользовательский массив</option>
                <option value="new_array">Новый массив</option>
              </select>
            </div>

            <div className="task-form-field">
              <label>Срок</label>
              <input className="form-input" type="datetime-local" value={formData.deadline} onChange={(e) => setFormData({ ...formData, deadline: e.target.value })} disabled={loading} />
            </div>
          </div>

          <div className="task-form-field">
            <label>Целевой образец *</label>
            <textarea
              className="form-textarea task-viewer-code-input"
              value={formData.target_sample}
              onChange={(e) => setFormData({ ...formData, target_sample: e.target.value })}
              required
              disabled={loading}
              rows={3}
              placeholder="Введите имя образца или JSON-структуру с параметрами цели"
            />
            <small className="task-form-help">
              Можно указать только имя образца или расширенный JSON с описанием параметров для анализа.
            </small>
          </div>
        </div>

        <div className="task-form-actions">
          {onCancel && <button type="button" onClick={onCancel} disabled={loading} className="btn btn-secondary">Отменить</button>}
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? 'Создание...' : 'Создать задачу'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default TaskCreator;
