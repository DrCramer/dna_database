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
  analystsLoading,
  analystsError,
  activeDepartmentId,
  numberLabel,
  numberRangeLabel,
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
            className="nav-button btn btn-secondary"
          >
            ← Назад к задачам
          </button>
          <button
            onClick={() => onNavigate('/dashboard')}
            title="Вернуться на главную страницу"
            className="nav-button btn btn-secondary"
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
              <label htmlFor="internalNumberStart" className="form-label required">{numberLabel}</label>
              <input
                type="text"
                id="internalNumberStart"
                name="internalNumberStart"
                className="form-input"
                placeholder={numberLabel === '№ Экспертизы' ? '258' : 'Например: 2024-001'}
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
              <span>{numberRangeLabel}</span>
            </label>
          </div>

          {isRangeMode && (
            <div className="form-group">
              <label className="form-label required">{numberRangeLabel}</label>
              <div className="task-range-row">
                <input
                  type="text"
                  id="internalNumberStartRange"
                  name="internalNumberStart"
                  className="form-input"
                  placeholder={numberLabel === '№ Экспертизы' ? '258' : 'Например: 2024-001'}
                  required={isRangeMode}
                  disabled={loading}
                />
                <span className="task-range-separator">-</span>
                <input
                  type="text"
                  id="internalNumberEnd"
                  name="internalNumberEnd"
                  className="form-input"
                  placeholder={numberLabel === '№ Экспертизы' ? '260' : 'Например: 2024-010'}
                  required={isRangeMode}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="assignedTo" className="form-label required">Исполнитель</label>
            <select
              key={activeDepartmentId}
              id="assignedTo"
              name="assignedTo"
              className="form-select"
              required
              disabled={loading || analystsLoading || analysts.length === 0}
              aria-describedby="assignee-status"
            >
              <option value="">{analystsLoading ? 'Загрузка исполнителей…' : 'Выберите аналитика'}</option>
              {analysts.map((analyst) => (
                <option key={analyst.id} value={analyst.id}>
                  {analyst.username} ({analyst.email})
                </option>
              ))}
            </select>
            <p id="assignee-status" className="task-form-help" role={analystsError ? 'alert' : 'status'}>
              {analystsError || (analystsLoading ? 'Загружаем аналитиков активного отделения…' :
                analysts.length === 0 ? 'В активном отделении нет доступных аналитиков. Добавьте сотруднику доступ к отделению в управлении пользователями.' :
                'Исполнитель получит задачу в активном отделении.')}
            </p>
          </div>

          <fieldset className="task-priority-fieldset" disabled={loading}>
            <legend className="form-label required">Приоритет</legend>
            <div className="task-priority-row">
              {[
                { value: 'low', label: 'Низкий' },
                { value: 'medium', label: 'Средний' },
                { value: 'high', label: 'Высокий' },
                { value: 'urgent', label: 'Срочный' }
              ].map(option => (
                <label key={option.value} className={`task-priority-option task-priority-option--${option.value} ${selectedPriority === option.value ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="priority"
                    value={option.value}
                    checked={selectedPriority === option.value}
                    onChange={e => setSelectedPriority(e.target.value)}
                    required
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

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
              disabled={loading || analystsLoading || analysts.length === 0 || !!analystsError}
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
