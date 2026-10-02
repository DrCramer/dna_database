import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import TaskViewer from './TaskViewer';
import '../../styles/pages/tasks.css';

const TaskDashboard = () => {
  const { user, hasRole } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    assigned_to_me: false
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });

  useEffect(() => {
    loadTasks();
  }, [filters, pagination.page]);

  const loadTasks = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(filters.status && { status: filters.status }),
        ...(filters.priority && { priority: filters.priority }),
        ...(filters.assigned_to_me && { assigned_to_me: 'true' })
      });

      const response = await fetch(`/api/tasks?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load tasks');
      }
      
      const data = await response.json();
      setTasks(data.data.tasks);
      setPagination(prev => ({
        ...prev,
        total: data.data.pagination.total,
        pages: data.data.pagination.pages
      }));
    } catch (err) {
      setError('Failed to load tasks: ' + err.message);
      console.error('Error loading tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (taskId, newStatus) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update task status');
      }

      await loadTasks();
    } catch (err) {
      setError('Failed to update task status: ' + err.message);
      console.error('Error updating task status:', err);
    }
  };

  const handleApproveTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to approve this task?')) {
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to approve task');
      }

      await loadTasks();
    } catch (err) {
      setError('Failed to approve task: ' + err.message);
      console.error('Error approving task:', err);
    }
  };

  const canUpdateStatus = (task) => {
    // Users can update status of tasks assigned to them
    if (task.assigned_to_user === user.id) return true;
    
    // Users can update status of tasks assigned to their expert groups
    // (This would need expert group membership check in real implementation)
    
    // Department heads and admins can update any task in their department
    if (hasRole(['department_head', 'system_administrator'])) return true;
    
    return false;
  };

  const canApprove = (task) => {
    return hasRole(['department_head', 'system_administrator']) && task.status === 'completed';
  };

  if (loading) {
    return (
      <div className="task-dashboard">
        <div className="tasks-loading-card">
          <div className="tasks-loading-spinner"></div>
          <p>Загрузка задач...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="task-dashboard task-dashboard-shell">
      <div className="task-header task-header-panel">
        <div>
          <h1>Рабочие задачи</h1>
          <p className="tasks-subtitle">Управление назначениями, статусами и контролем исполнения.</p>
        </div>
        <div className="task-header-actions">
          {hasRole(['department_head', 'system_administrator']) && (
            <button
              onClick={() => window.location.href = '/tasks/create'}
              className="btn btn-primary"
            >
              Создать задачу
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="task-filters-panel">
        <h4 className="task-filters-title">Фильтры</h4>
        <div className="task-filters-grid">
          <div className="filter-group">
            <label>
              Статус
            </label>
            <select
              className="filter-select"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Все статусы</option>
              <option value="assigned">Назначена</option>
              <option value="in_progress">В работе</option>
              <option value="completed">Завершена</option>
              <option value="approved">Утверждена</option>
            </select>
          </div>
          <div className="filter-group">
            <label>
              Приоритет
            </label>
            <select
              className="filter-select"
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
            >
              <option value="">Все приоритеты</option>
              <option value="urgent">Срочный</option>
              <option value="high">Высокий</option>
              <option value="medium">Средний</option>
              <option value="low">Низкий</option>
            </select>
          </div>
          <div className="filter-group filter-group-checkbox">
            <label className="task-checkbox-label">
              <input
                type="checkbox"
                checked={filters.assigned_to_me}
                onChange={(e) => setFilters({ ...filters, assigned_to_me: e.target.checked })}
              />
              Показывать только мои задачи
            </label>
          </div>
        </div>
      </div>

      {/* Tasks Table */}
      <div className="tasks-table-shell">
        <table className="table tasks-table">
          <thead>
            <tr>
              <th>Задача</th>
              <th>Статус</th>
              <th>Приоритет</th>
              <th>Назначение</th>
              <th>Срок</th>
              <th>Создана</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, index) => (
              <tr key={task.id} className={index % 2 === 0 ? 'tasks-row-even' : 'tasks-row-odd'}>
                <td>
                  <div className="tasks-title-cell">
                    <strong 
                      onClick={() => setSelectedTaskId(task.id)}
                      className="tasks-title-link"
                    >
                      {task.title}
                    </strong>
                    {task.description && (
                      <div className="tasks-title-meta">
                        {task.description.length > 100 
                          ? task.description.substring(0, 100) + '...'
                          : task.description
                        }
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`task-pill ${task.status}`}>
                    {task.status === 'assigned' && 'Назначена'}
                    {task.status === 'in_progress' && 'В работе'}
                    {task.status === 'completed' && 'Завершена'}
                    {task.status === 'approved' && 'Утверждена'}
                  </span>
                </td>
                <td>
                  <span className={`task-pill priority-${task.priority}`}>
                    {task.priority === 'urgent' && 'Срочный'}
                    {task.priority === 'high' && 'Высокий'}
                    {task.priority === 'medium' && 'Средний'}
                    {task.priority === 'low' && 'Низкий'}
                  </span>
                </td>
                <td className="tasks-muted-cell">
                  {task.assigned_to_user ? 'Сотрудник' : 'Экспертная группа'}
                </td>
                <td className="tasks-muted-cell">
                  {task.deadline 
                    ? new Date(task.deadline).toLocaleDateString('ru-RU')
                    : '—'
                  }
                </td>
                <td className="tasks-muted-cell">
                  {new Date(task.created_at).toLocaleDateString('ru-RU')}
                </td>
                <td>
                  <div className="task-actions">
                    <button
                      onClick={() => setSelectedTaskId(task.id)}
                      className="btn btn-secondary btn-sm"
                    >
                      Открыть
                    </button>
                    
                    {canUpdateStatus(task) && task.status !== 'approved' && (
                      <select
                        className="filter-select task-status-select"
                        value={task.status}
                        onChange={(e) => handleStatusUpdate(task.id, e.target.value)}
                      >
                        <option value="assigned">Назначена</option>
                        <option value="in_progress">В работе</option>
                        <option value="completed">Завершена</option>
                      </select>
                    )}
                    
                    {canApprove(task) && (
                      <button
                        onClick={() => handleApproveTask(task.id)}
                        className="btn btn-primary btn-sm"
                      >
                        Утвердить
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="tasks-pagination">
          <button
            onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            disabled={pagination.page === 1}
            className="btn btn-secondary"
          >
            Назад
          </button>
          
          <span className="tasks-pagination-info">
            Страница {pagination.page} из {pagination.pages}
          </span>
          
          <button
            onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.pages, prev.page + 1) }))}
            disabled={pagination.page === pagination.pages}
            className="btn btn-secondary"
          >
            Вперед
          </button>
        </div>
      )}

      {tasks.length === 0 && (
        <div className="empty-tasks tasks-empty-panel">
          Задачи не найдены. {hasRole(['department_head', 'system_administrator']) && 'Создайте первую задачу, чтобы начать работу.'}
        </div>
      )}

      {/* Task Viewer Modal */}
      {selectedTaskId && (
        <div className="modal-overlay tasks-viewer-overlay">
          <TaskViewer 
            taskId={selectedTaskId} 
            onClose={() => {
              setSelectedTaskId(null);
              loadTasks(); // Reload tasks after closing viewer
            }} 
          />
        </div>
      )}
    </div>
  );
};

export default TaskDashboard;
