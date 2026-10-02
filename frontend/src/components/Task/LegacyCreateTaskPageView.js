import React from 'react';

const LegacyCreateTaskPageView = ({
  onNavigate,
  error,
  success,
  loading,
  handleSubmit,
  isRangeMode,
  setIsRangeMode,
  analysts,
  selectedPriority,
  setSelectedPriority
}) => {
  return (
    <div className="task-page">
      <div className="page-header">
        <div className="page-title-section">
          <h1 className="page-title">
            <span>📋</span>
            <span>Создание задачи</span>
          </h1>
          <p className="page-subtitle">Назначьте задачу на анализ образцов</p>
        </div>
        <div className="header-actions">
          <button
            onClick={() => onNavigate('/tasks')}
            title="Вернуться к списку задач"
            className="nav-button"
          >
            ← Назад к задачам
          </button>
          <button
            onClick={() => onNavigate('/dashboard')}
            title="Вернуться на главную страницу"
            className="nav-button"
          >
            Назад к дашборду
          </button>
        </div>
      </div>

      <div className="create-task-card">
        {error && (
          <div className="alert alert-error task-alert-gap">
            <strong>Ошибка:</strong> {error}
          </div>
        )}

        {success && (
          <div className="alert alert-success task-alert-gap">
            <strong>Успешно:</strong> {success}
          </div>
        )}

        <form className="task-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="taskName" className="form-label required">Название задачи</label>
            <input
              type="text"
              id="taskName"
              name="taskName"
              className="form-input"
              placeholder="Введите название задачи"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="taskDescription" className="form-label required">Описание задачи</label>
            <textarea
              id="taskDescription"
              name="taskDescription"
              className="form-textarea"
              placeholder="Введите описание задачи"
              required
              disabled={loading}
            />
          </div>

          {!isRangeMode && (
            <div className="form-group">
              <label htmlFor="internalNumberStart" className="form-label required">Номер привоза/экспертизы</label>
              <input
                type="text"
                id="internalNumberStart"
                name="internalNumberStart"
                className="form-input"
                placeholder="Например: 2024-001"
                required
                disabled={loading}
              />
            </div>
          )}

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isRangeMode}
                onChange={(e) => setIsRangeMode(e.target.checked)}
                disabled={loading}
              />
              <span>Диапазон номеров</span>
            </label>
          </div>

          {isRangeMode && (
            <div className="form-group">
              <label className="form-label required">Диапазон номеров</label>
              <div className="task-range-row">
                <input
                  type="text"
                  id="internalNumberStartRange"
                  name="internalNumberStart"
                  className="form-input"
                  placeholder="Например: 2024-001"
                  required={isRangeMode}
                  disabled={loading}
                />
                <span className="task-range-separator">-</span>
                <input
                  type="text"
                  id="internalNumberEnd"
                  name="internalNumberEnd"
                  className="form-input"
                  placeholder="Например: 2024-010"
                  required={isRangeMode}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="assignedTo" className="form-label required">Исполнитель</label>
            <select
              id="assignedTo"
              name="assignedTo"
              className="form-select"
              required
              disabled={loading}
            >
              <option value="">Выберите аналитика</option>
              {analysts.map((analyst) => (
                <option key={analyst.id} value={analyst.id}>
                  {analyst.username} ({analyst.email})
                </option>
              ))}
            </select>
          </div>

          <div className="priority-group">
            <label className="form-label required">Приоритет</label>
            <div className="priority-options">
              <label className={`priority-option ${selectedPriority === 'low' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="priority"
                  value="low"
                  checked={selectedPriority === 'low'}
                  onChange={(e) => setSelectedPriority(e.target.value)}
                  disabled={loading}
                />
                <div className="priority-name priority-low">Низкий</div>
              </label>

              <label className={`priority-option ${selectedPriority === 'medium' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="priority"
                  value="medium"
                  checked={selectedPriority === 'medium'}
                  onChange={(e) => setSelectedPriority(e.target.value)}
                  disabled={loading}
                />
                <div className="priority-name priority-medium">Средний</div>
              </label>

              <label className={`priority-option ${selectedPriority === 'high' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="priority"
                  value="high"
                  checked={selectedPriority === 'high'}
                  onChange={(e) => setSelectedPriority(e.target.value)}
                  disabled={loading}
                />
                <div className="priority-name priority-high">Высокий</div>
              </label>

              <label className={`priority-option ${selectedPriority === 'urgent' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="priority"
                  value="urgent"
                  checked={selectedPriority === 'urgent'}
                  onChange={(e) => setSelectedPriority(e.target.value)}
                  disabled={loading}
                />
                <div className="priority-name priority-urgent">Срочный</div>
              </label>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onNavigate('/tasks')}
              title="Отменить создание задачи и вернуться к списку"
              disabled={loading}
            >
              <span>❌</span>
              <span>Отмена</span>
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              title="Создать задачу и назначить исполнителя"
              disabled={loading}
            >
              <span>{loading ? '⏳' : '✅'}</span>
              <span>{loading ? 'Создание...' : 'Создать задачу'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LegacyCreateTaskPageView;
