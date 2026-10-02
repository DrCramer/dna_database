import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const TaskViewer = ({ taskId, onClose }) => {
  const { user, hasRole } = useAuth();
  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [newResult, setNewResult] = useState({
    result_data: '',
    analysis_metadata: ''
  });
  const [addingResult, setAddingResult] = useState(false);
  const [showAddResult, setShowAddResult] = useState(false);

  useEffect(() => {
    if (taskId) {
      loadTaskDetails();
    }
  }, [taskId]);

  const loadTaskDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Не удалось загрузить детали задачи');
      }

      const data = await response.json();
      setTask(data.data.task);
      setComments(data.data.comments || []);
      setResults(data.data.results || []);
    } catch (err) {
      setError(`Не удалось загрузить детали задачи: ${err.message}`);
      console.error('Error loading task details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setAddingComment(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ comment: newComment })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось добавить комментарий');
      }

      setNewComment('');
      await loadTaskDetails();
    } catch (err) {
      setError(`Не удалось добавить комментарий: ${err.message}`);
    } finally {
      setAddingComment(false);
    }
  };

  const handleAddResult = async (e) => {
    e.preventDefault();

    if (!newResult.result_data.trim()) {
      setError('Укажите данные результата');
      return;
    }

    setAddingResult(true);
    try {
      let resultData;
      let analysisMetadata = {};

      try {
        resultData = JSON.parse(newResult.result_data);
      } catch {
        resultData = { result: newResult.result_data };
      }

      if (newResult.analysis_metadata.trim()) {
        try {
          analysisMetadata = JSON.parse(newResult.analysis_metadata);
        } catch {
          analysisMetadata = { notes: newResult.analysis_metadata };
        }
      }

      const response = await fetch(`/api/tasks/${taskId}/results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          result_data: resultData,
          analysis_metadata: analysisMetadata
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось добавить результат');
      }

      setNewResult({ result_data: '', analysis_metadata: '' });
      setShowAddResult(false);
      await loadTaskDetails();
    } catch (err) {
      setError(`Не удалось добавить результат: ${err.message}`);
    } finally {
      setAddingResult(false);
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Не удалось обновить статус');
      }

      await loadTaskDetails();
    } catch (err) {
      setError(`Не удалось обновить статус: ${err.message}`);
    }
  };

  const canUpdateStatus = (currentTask) => {
    if (!currentTask) return false;
    if (currentTask.assigned_to_user === user.id) return true;
    return hasRole(['department_head', 'system_administrator']);
  };

  const canAddResults = (currentTask) => {
    if (!currentTask) return false;
    return currentTask.assigned_to_user === user.id;
  };

  if (loading) {
    return (
      <div className="tasks-loading-card task-viewer-loading">
        <div className="tasks-loading-spinner"></div>
        <p>Загрузка деталей задачи...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="alert alert-error task-viewer-state">
        <h3>Задача не найдена</h3>
        <p>Запрошенная задача не найдена или у вас нет прав на ее просмотр.</p>
      </div>
    );
  }

  return (
    <div className="task-viewer-shell">
      <div className="task-header task-header-panel page-header">
        <div>
          <h1>Карточка задачи</h1>
          <p className="tasks-subtitle">Подробности, обсуждение и результаты по выбранной задаче.</p>
        </div>
        {onClose && <button onClick={onClose} className="btn btn-secondary">Закрыть</button>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="task-viewer-card">
        <div className="task-viewer-card-header">
          <h3 className="task-viewer-title">{task.title}</h3>
          <div className="task-viewer-pills">
            <span className={`task-pill ${task.status}`}>
              {task.status === 'assigned' && 'Назначена'}
              {task.status === 'in_progress' && 'В работе'}
              {task.status === 'completed' && 'Завершена'}
              {task.status === 'approved' && 'Утверждена'}
            </span>
            <span className={`task-pill priority-${task.priority}`}>
              {task.priority === 'urgent' && 'Срочный'}
              {task.priority === 'high' && 'Высокий'}
              {task.priority === 'medium' && 'Средний'}
              {task.priority === 'low' && 'Низкий'}
            </span>
            {canUpdateStatus(task) && task.status !== 'approved' && (
              <select className="filter-select task-status-select form-select" value={task.status} onChange={(e) => handleStatusUpdate(e.target.value)}>
                <option value="assigned">Назначена</option>
                <option value="in_progress">В работе</option>
                <option value="completed">Завершена</option>
              </select>
            )}
          </div>
        </div>

        <div className="task-viewer-card-body">
          <div className="task-viewer-meta-grid">
            <div className="task-viewer-meta-item">
              <strong>Назначение:</strong>
              <div>{task.assigned_to_user ? 'Сотрудник' : 'Экспертная группа'}</div>
            </div>
            <div className="task-viewer-meta-item">
              <strong>Источник данных:</strong>
              <div>{task.data_source.replace('_', ' ')}</div>
            </div>
            <div className="task-viewer-meta-item">
              <strong>Создана:</strong>
              <div>{new Date(task.created_at).toLocaleString('ru-RU')}</div>
            </div>
            <div className="task-viewer-meta-item">
              <strong>Срок:</strong>
              <div>{task.deadline ? new Date(task.deadline).toLocaleString('ru-RU') : 'Не задан'}</div>
            </div>
          </div>

          {task.description && (
            <div className="task-viewer-description">
              <strong>Описание:</strong>
              <div className="task-viewer-description-text">{task.description}</div>
            </div>
          )}

          <div>
            <strong>Целевой образец:</strong>
            <div className="task-viewer-code">{JSON.stringify(task.target_sample, null, 2)}</div>
          </div>
        </div>
      </div>

      <div className="task-viewer-grid">
        <div className="task-viewer-section">
          <div className="task-viewer-section-header">
            <h4>Комментарии ({comments.length})</h4>
          </div>
          <div className="task-viewer-section-body">
            <form onSubmit={handleAddComment} className="task-viewer-form">
              <textarea className="form-textarea" value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Добавьте комментарий" disabled={addingComment} rows={3} />
              <button type="submit" disabled={addingComment || !newComment.trim()} className="btn btn-primary">
                {addingComment ? 'Сохранение...' : 'Добавить комментарий'}
              </button>
            </form>

            <div className="task-viewer-list">
              {comments.map((comment, index) => (
                <div key={comment.id} className={`task-viewer-list-item${index % 2 === 0 ? ' is-alt' : ''}`}>
                  <div className="task-viewer-list-item-header">
                    <strong>{comment.username || 'Пользователь'}</strong>
                    <small className="task-viewer-muted">{new Date(comment.created_at).toLocaleString('ru-RU')}</small>
                  </div>
                  <div className="task-viewer-prewrap">{comment.comment}</div>
                </div>
              ))}
              {comments.length === 0 && <div className="empty-tasks tasks-empty-panel">Комментариев пока нет. Добавьте первый комментарий.</div>}
            </div>
          </div>
        </div>

        <div className="task-viewer-section">
          <div className="task-viewer-section-header task-viewer-section-header-split">
            <h4>Результаты ({results.length})</h4>
            {canAddResults(task) && (
              <button onClick={() => setShowAddResult(!showAddResult)} className={`btn ${showAddResult ? 'btn-secondary' : 'btn-primary'} btn-sm`}>
                {showAddResult ? 'Отменить' : 'Добавить результат'}
              </button>
            )}
          </div>
          <div className="task-viewer-section-body">
            {showAddResult && (
              <form onSubmit={handleAddResult} className="task-viewer-form">
                <div className="task-form-field">
                  <label>Данные результата *</label>
                  <textarea className="form-textarea task-viewer-code-input" value={newResult.result_data} onChange={(e) => setNewResult({ ...newResult, result_data: e.target.value })} placeholder="Введите данные результата, желательно в формате JSON" disabled={addingResult} rows={4} />
                </div>
                <div className="task-form-field">
                  <label>Метаданные анализа</label>
                  <textarea className="form-textarea task-viewer-code-input" value={newResult.analysis_metadata} onChange={(e) => setNewResult({ ...newResult, analysis_metadata: e.target.value })} placeholder="Введите дополнительные сведения об анализе" disabled={addingResult} rows={3} />
                </div>
                <div className="task-form-actions">
                  <button type="submit" disabled={addingResult || !newResult.result_data.trim()} className="btn btn-primary">
                    {addingResult ? 'Сохранение...' : 'Сохранить результат'}
                  </button>
                  <button type="button" onClick={() => setShowAddResult(false)} disabled={addingResult} className="btn btn-secondary">
                    Отменить
                  </button>
                </div>
              </form>
            )}

            <div className="task-viewer-list">
              {results.map((result, index) => (
                <div key={result.id} className={`task-viewer-list-item${index % 2 === 0 ? ' is-alt' : ''}`}>
                  <div className="task-viewer-list-item-header">
                    <strong>{result.username || 'Пользователь'}</strong>
                    <small className="task-viewer-muted">{new Date(result.created_at).toLocaleString('ru-RU')}</small>
                  </div>
                  <div className="task-viewer-result-block">
                    <strong>Данные результата:</strong>
                    <div className="task-viewer-code task-viewer-code-scroll">{JSON.stringify(result.result_data, null, 2)}</div>
                  </div>
                  {result.analysis_metadata && Object.keys(result.analysis_metadata).length > 0 && (
                    <div className="task-viewer-result-block">
                      <strong>Метаданные анализа:</strong>
                      <div className="task-viewer-code task-viewer-code-scroll task-viewer-code-scroll-sm">{JSON.stringify(result.analysis_metadata, null, 2)}</div>
                    </div>
                  )}
                </div>
              ))}
              {results.length === 0 && <div className="empty-tasks tasks-empty-panel">Результаты пока не добавлены. Завершите задачу и сохраните результат анализа.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskViewer;
