import React from 'react';
import ReactDOM from 'react-dom';
import {
  TaskFilterBar,
  TaskListState,
  TaskPriorityBadge,
  TaskSortableHeader,
  TaskStatsGrid,
  TaskStatusBadge
} from './TaskPagePrimitives';

const LegacyTasksPageView = ({
  onNavigate,
  isManager,
  stats,
  filterStatus,
  setFilterStatus,
  error,
  loading,
  tasks,
  sortField,
  sortDirection,
  handleSort,
  getSortedTasks,
  setActionTask,
  setShowStartModal,
  setShowCompleteModal,
  openModal,
  setShowApproveModal,
  openCancelModal,
  showModal,
  selectedTask,
  closeModal,
  setShowAssignModal,
  setTaskToAssign,
  handleStatusChange,
  showCancelModal,
  closeCancelModal,
  cancelReason,
  setCancelReason,
  handleCancelTask,
  showDnaLoading,
  showAssignModal,
  taskToAssign,
  setSelectedAssignee,
  setTaskToAssignDirect,
  setShowAssignModalDirect,
  departmentUsers,
  selectedAssignee,
  assigning,
  handleAssignTask,
  showStartModal,
  actionTask,
  setShowStartModalDirect,
  showCompleteModal,
  setShowCompleteModalDirect,
  showApproveModal,
  setShowApproveModalDirect,
  handleApproveTask,
  setError
}) => {
  return (
    <div className="task-page">
      <div className="page-header">
        <div className="page-title-section">
          <h1 className="page-title">
            <span>📋</span>
            <span>{isManager ? 'Управление задачами' : 'Мои задачи'}</span>
          </h1>
          <p className="page-subtitle">
            {isManager ? 'Отслеживание и контроль задач отдела' : 'Список назначенных задач на анализ'}
          </p>
        </div>
        <div className="header-actions">
          {isManager && (
            <button
              onClick={() => onNavigate('/tasks/create')}
              title="Создать новую задачу для аналитика"
              className="nav-button btn btn-secondary"
            >
              ➕ Создать задачу
            </button>
          )}
          <button
            onClick={() => onNavigate('/dashboard')}
            title="Вернуться на главную страницу"
            className="nav-button btn btn-secondary"
          >
            Назад к дашборду
          </button>
        </div>
      </div>

      {isManager && <TaskStatsGrid stats={stats} />}

      <TaskFilterBar filterStatus={filterStatus} onChange={setFilterStatus} />

      {error && (
        <div className="alert alert-error task-filter-card">
          <strong>Ошибка:</strong> {error}
        </div>
      )}

      <div className="task-page-content">
        <div className="task-panel">
          {loading || tasks.length === 0 ? (
            <TaskListState loading={loading} isEmpty={!loading && tasks.length === 0} />
          ) : (
            <div className="table-container task-table-container">
              <table className="table task-list-table">
                <thead>
                  <tr>
                    <TaskSortableHeader field="title" currentField={sortField} currentDirection={sortDirection} onSort={handleSort}>Название</TaskSortableHeader>
                    {isManager && (
                      <TaskSortableHeader field="assigned_user_name" currentField={sortField} currentDirection={sortDirection} onSort={handleSort}>Назначена</TaskSortableHeader>
                    )}
                    <TaskSortableHeader field="internal_number_start" currentField={sortField} currentDirection={sortDirection} onSort={handleSort}>Экспертиза</TaskSortableHeader>
                    <TaskSortableHeader field="profile_count" currentField={sortField} currentDirection={sortDirection} onSort={handleSort}>Генотипов</TaskSortableHeader>
                    <TaskSortableHeader field="priority" currentField={sortField} currentDirection={sortDirection} onSort={handleSort}>Приоритет</TaskSortableHeader>
                    <TaskSortableHeader field="status" currentField={sortField} currentDirection={sortDirection} onSort={handleSort}>Статус</TaskSortableHeader>
                    <TaskSortableHeader field="created_at" currentField={sortField} currentDirection={sortDirection} onSort={handleSort}>Дата создания</TaskSortableHeader>
                    <th className="task-table-heading-center">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {getSortedTasks().map((task) => (
                    <tr key={task.id}>
                      <td className="task-table-cell-strong">{task.title}</td>
                      {isManager && (
                        <td className="task-table-cell-muted">
                          {task.assigned_user_name || task.assigned_group_name || '—'}
                        </td>
                      )}
                      <td className="task-table-cell-mono">
                        {task.internal_number_start}
                        {task.internal_number_end && ` - ${task.internal_number_end}`}
                      </td>
                      <td className="task-table-cell-accent">{task.profile_count || 0}</td>
                      <td className="task-table-cell-center"><TaskPriorityBadge priority={task.priority} /></td>
                      <td className="task-table-cell-center"><TaskStatusBadge status={task.status} /></td>
                      <td className="task-table-cell-muted">{new Date(task.created_at).toLocaleDateString('ru-RU')}</td>
                      <td className="task-table-cell-actions">
                        <div className="task-table-actions">
                          {!isManager && task.status === 'assigned' && (
                            <button
                              onClick={() => {
                                setActionTask(task);
                                setShowStartModal(true);
                              }}
                              title="Взять задачу в работу и начать загрузку генотипов"
                              className="task-action-btn is-start btn btn-secondary btn-sm btn-outline-primary"
                            >
                              <span>Начать</span>
                            </button>
                          )}

                          {!isManager && task.status === 'in_progress' && (
                            <button
                              onClick={() => {
                                setActionTask(task);
                                setShowCompleteModal(true);
                              }}
                              title="Завершить задачу после загрузки всех генотипов"
                              className="task-action-btn is-complete btn btn-secondary btn-sm"
                            >
                              <span>Завершить</span>
                            </button>
                          )}

                          {!isManager && ['completed', 'cancelled', 'approved'].includes(task.status) && (
                            <button
                              onClick={() => openModal(task)}
                              title="Просмотреть детали задачи и загруженные генотипы"
                              className="task-action-btn is-view btn btn-secondary btn-sm"
                            >
                              <span>Открыть</span>
                            </button>
                          )}

                          {isManager && (
                            <>
                              <button
                                onClick={() => openModal(task)}
                                title="Просмотреть детали задачи и загруженные генотипы"
                                className="task-action-btn is-view btn btn-secondary btn-sm"
                              >
                                <span>Открыть</span>
                              </button>

                              {task.status === 'completed' && (
                                <button
                                  onClick={() => {
                                    setActionTask(task);
                                    setShowApproveModal(true);
                                  }}
                                  disabled={loading}
                                  title="Подтвердить задачу и добавить генотипы в мастер массив"
                                  className={`task-action-btn is-approve btn btn-secondary btn-sm${loading ? ' task-btn-disabled' : ''}`}
                                >
                                  <span>{loading ? '...' : 'Утвердить'}</span>
                                </button>
                              )}

                              {['assigned', 'in_progress'].includes(task.status) && (
                                <button
                                  onClick={() => openCancelModal(task)}
                                  title="Отменить задачу с указанием причины"
                                  className="task-action-btn is-cancel btn btn-secondary btn-sm btn-outline-danger"
                                >
                                  <span>Отменить</span>
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
          )}
        </div>
      </div>

      {showModal && selectedTask && ReactDOM.createPortal(
        <div className="task-modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="task-modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="task-modal-header">
              <h2 className="task-modal-title">📋 {selectedTask.title}</h2>
              <button onClick={closeModal} className="task-modal-close" aria-label="Закрыть">✕</button>
            </div>

            <div className="task-modal-section">
              <strong className="task-modal-strong">Описание:</strong>
              <p className="task-modal-text task-modal-text-tight">{selectedTask.description}</p>
            </div>

            <div className="task-modal-meta-grid">
              <div>
                <strong className="task-modal-strong">Номер экспертизы:</strong>
                <p className="task-modal-code">
                  {selectedTask.internal_number_start}
                  {selectedTask.internal_number_end && ` - ${selectedTask.internal_number_end}`}
                </p>
              </div>
              <div>
                <strong className="task-modal-strong">Исполнитель:</strong>
                <div className="task-modal-inline">
                  <p className="task-modal-text">
                    {selectedTask.assigned_user_name || selectedTask.assigned_group_name || '—'}
                  </p>
                  {isManager && (
                    <button
                      onClick={() => {
                        setShowAssignModal(true);
                        setTaskToAssign(selectedTask);
                      }}
                      className="btn btn-primary btn-sm"
                    >
                      Изменить
                    </button>
                  )}
                </div>
              </div>
              <div>
                <strong className="task-modal-strong">Приоритет:</strong>
                <p><TaskPriorityBadge priority={selectedTask.priority} /></p>
              </div>
              <div>
                <strong className="task-modal-strong">Статус:</strong>
                <p><TaskStatusBadge status={selectedTask.status} /></p>
              </div>
              <div>
                <strong className="task-modal-strong">Дата создания:</strong>
                <p className="task-modal-text">{new Date(selectedTask.created_at).toLocaleString('ru-RU')}</p>
              </div>
            </div>

            <div className="task-modal-footer">
              {selectedTask.status === 'pending' && !isManager && (
                <button
                  onClick={() => handleStatusChange(selectedTask.id, 'in_progress')}
                  title="Взять задачу в работу и начать загрузку генотипов"
                  className="btn btn-warning"
                >
                  <span>▶️</span>
                  <span>Взять в работу</span>
                </button>
              )}

              {selectedTask.status === 'in_progress' && !isManager && (
                <button
                  onClick={() => handleStatusChange(selectedTask.id, 'completed')}
                  title="Завершить задачу после загрузки всех генотипов"
                  className="btn btn-success"
                >
                  <span>✅</span>
                  <span>Завершить</span>
                </button>
              )}

              <button onClick={closeModal} title="Закрыть окно без изменений" className="btn btn-secondary">
                Закрыть
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showCancelModal && selectedTask && ReactDOM.createPortal(
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeCancelModal()}>
          <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="task-modal-title">❌ Отмена задачи</h3>
              <button className="close-button" onClick={closeCancelModal} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <p className="task-modal-text with-gap">
                <strong className="task-modal-strong">Задача:</strong> {selectedTask.title}
              </p>
              <p className="task-modal-text with-gap">
                Вы уверены, что хотите отменить эту задачу? Укажите причину отмены:
              </p>
              <label className="task-modal-label">
                Причина отмены <span className="task-modal-label-required">*</span>
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Укажите причину отмены задачи..."
                className="task-modal-textarea form-textarea"
              />
              {error && <div className="task-modal-alert with-gap-top">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeCancelModal}>Закрыть</button>
              <button onClick={handleCancelTask} className="btn btn-danger">Отменить задачу</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showDnaLoading && (
        <div className="dna-loading-overlay">
          <div className="dna-loading-container">
            <div className="dna">
              <div className="dna-dot"></div><div className="dna-dot"></div><div className="dna-dot"></div><div className="dna-dot"></div>
              <div className="dna-dot"></div><div className="dna-dot"></div><div className="dna-dot"></div><div className="dna-dot"></div>
              <div className="dna-dot"></div><div className="dna-dot"></div><div className="dna-dot"></div><div className="dna-dot"></div>
            </div>
            <h2 className="dna-loading-title">🧬 Подтверждение задачи</h2>
            <p className="dna-loading-message">Добавление генотипов в мастер массив...</p>
            <div className="dna-loading-dots">
              <div className="dna-loading-dot"></div>
              <div className="dna-loading-dot"></div>
              <div className="dna-loading-dot"></div>
            </div>
          </div>
        </div>
      )}

      {showAssignModal && taskToAssign && ReactDOM.createPortal(
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAssignModalDirect(false);
              setSelectedAssignee(null);
              setTaskToAssignDirect(null);
              setError('');
            }
          }}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="task-modal-title">👤 Изменить исполнителя</h3>
              <button
                className="close-button"
                onClick={() => {
                  setShowAssignModalDirect(false);
                  setSelectedAssignee(null);
                  setTaskToAssignDirect(null);
                  setError('');
                }}
               aria-label="Закрыть">
                ✕
              </button>
            </div>

            <div className="modal-body">
              {error && <div className="task-modal-alert with-gap-bottom">{error}</div>}
              <div className="task-inline-gap">
                <p className="task-modal-text with-gap">
                  <strong className="task-modal-strong">Задача:</strong> {taskToAssign.title}
                </p>
              </div>
              <div>
                <label className="task-modal-label">Выберите пользователя:</label>
                <select
                  value={selectedAssignee || ''}
                  onChange={(e) => setSelectedAssignee(e.target.value)}
                  className="task-modal-select form-select"
                >
                  <option value="">-- Выберите пользователя --</option>
                  {departmentUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => {
                  setShowAssignModalDirect(false);
                  setSelectedAssignee(null);
                  setTaskToAssignDirect(null);
                  setError('');
                }}
                disabled={assigning}
                className="btn btn-secondary"
              >
                Отмена
              </button>
              <button
                onClick={handleAssignTask}
                disabled={assigning || !selectedAssignee}
                className={`btn btn-primary${(assigning || !selectedAssignee) ? ' task-btn-disabled' : ''}`}
              >
                {assigning ? 'Назначение...' : 'Назначить'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showStartModal && actionTask && ReactDOM.createPortal(
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowStartModalDirect(false)}>
          <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="task-modal-title">▶️ Взять задачу в работу</h3>
              <button className="close-button" onClick={() => setShowStartModalDirect(false)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <p className="task-modal-text with-gap">
                <strong className="task-modal-strong">Задача:</strong> {actionTask.title}
              </p>
              <p className="task-modal-text">
                Вы уверены, что хотите взять эту задачу в работу? После этого вы сможете начать загрузку генотипов.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowStartModalDirect(false)}>Отмена</button>
              <button
                className="btn btn-warning"
                onClick={() => {
                  handleStatusChange(actionTask.id, 'in_progress');
                  setShowStartModalDirect(false);
                  setActionTask(null);
                }}
              >
                Взять в работу
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showCompleteModal && actionTask && ReactDOM.createPortal(
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCompleteModalDirect(false)}>
          <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="task-modal-title">✅ Завершить задачу</h3>
              <button className="close-button" onClick={() => setShowCompleteModalDirect(false)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <p className="task-modal-text with-gap">
                <strong className="task-modal-strong">Задача:</strong> {actionTask.title}
              </p>
              <p className="task-modal-text">
                Вы уверены, что хотите завершить эту задачу? Убедитесь, что все генотипы загружены.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCompleteModalDirect(false)}>Отмена</button>
              <button
                className="btn btn-success"
                onClick={() => {
                  handleStatusChange(actionTask.id, 'completed');
                  setShowCompleteModalDirect(false);
                  setActionTask(null);
                }}
              >
                Завершить
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showApproveModal && actionTask && ReactDOM.createPortal(
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowApproveModalDirect(false)}>
          <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="task-modal-title">✅ Подтвердить задачу</h3>
              <button className="close-button" onClick={() => setShowApproveModalDirect(false)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <p className="task-modal-text with-gap">
                <strong className="task-modal-strong">Задача:</strong> {actionTask.title}
              </p>
              <p className="task-modal-text">
                <strong className="task-modal-critical">⚠️ Критическое действие!</strong>
              </p>
              <p className="task-modal-text">
                Подтвердить задачу? Генотипы будут добавлены в мастер массив. Это действие нельзя отменить.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowApproveModalDirect(false)}>Отмена</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  handleApproveTask(actionTask.id);
                  setShowApproveModalDirect(false);
                  setActionTask(null);
                }}
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default LegacyTasksPageView;
