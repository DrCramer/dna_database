import React from 'react';
import AnimatedCounter from '../Common/AnimatedCounter';

const NotificationBadge = ({ count }) => {
  if (!count || count === 0) return null;

  return (
    <span className="notification-badge">
      {count > 99 ? '99+' : count}
    </span>
  );
};

const LegacyDashboardView = ({
  user,
  numberLabel,
  loading,
  error,
  handleLogout,
  showAnalystTaskSelector,
  loadingTasks,
  activeTasks,
  selectedActiveTask,
  handleTaskSelect,
  pluralizeProfiles,
  stats,
  onNavigate,
  analystNeedsTask,
  taskSelectionTitle,
  handleTasksNavigation,
  unreadCount,
  isAnalyst,
  isManager,
  isAdmin
}) => {
  return (
    <div className="dashboard-legacy-shell">
      <div className="dashboard-legacy-hero">
        <div className="dashboard-legacy-hero-top">
          <div>
            <h1 className="dashboard-legacy-title">Добро пожаловать, {user?.username}!</h1>
            <p className="dashboard-legacy-subtitle">
              Система анализа ДНК. Роль: <strong className="dashboard-legacy-role">{user?.role}</strong>
              <span className="dashboard-legacy-online">
                {loading ? 'Загрузка...' : 'Онлайн'}
              </span>
            </p>
          </div>
          <div className="dashboard-legacy-actions">
            <button onClick={handleLogout} className="btn btn-danger">
              Выйти
            </button>
          </div>
        </div>

        {error && <div className="dashboard-legacy-alert alert alert-error">{error}</div>}
      </div>

      {showAnalystTaskSelector && (
        <div className="dashboard-legacy-panel">
          <h3 className="dashboard-legacy-panel-title">🎯 Активная задача</h3>

          {loadingTasks ? (
            <p className="dashboard-legacy-active-placeholder">Загрузка задач...</p>
          ) : activeTasks.length === 0 ? (
            <div className="dashboard-legacy-empty">
              <p className="dashboard-legacy-empty-title">📋 Нет активных задач</p>
              <p>
                Перейдите в <strong>"Просмотр задач"</strong> чтобы взять задачу в работу
              </p>
            </div>
          ) : (
            <>
              <div className="dashboard-legacy-select-block">
                <div className="dashboard-legacy-select-header">
                  <div>
                    <p className="dashboard-legacy-select-label">Выбор активной задачи</p>
                    <p className="dashboard-legacy-select-hint">
                      Выберите задачу, с которой хотите продолжить работу в текущей сессии.
                    </p>
                  </div>
                  <span className="dashboard-legacy-select-count">
                    {activeTasks.length} {activeTasks.length === 1 ? 'задача' : activeTasks.length < 5 ? 'задачи' : 'задач'}
                  </span>
                </div>

                <div className="dashboard-legacy-select-shell">
                  <select
                    value={selectedActiveTask?.id || ''}
                    onChange={(e) => handleTaskSelect(e.target.value)}
                    className="form-select dashboard-legacy-select"
                  >
                    <option value="">Выберите задачу из списка</option>
                    {activeTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title} - {numberLabel}: {task.internal_number_start || 'не указан'} ({task.profile_count || 0} {pluralizeProfiles(task.profile_count || 0)})
                      </option>
                    ))}
                  </select>
                  <span className="dashboard-legacy-select-icon">▾</span>
                </div>
              </div>

              {selectedActiveTask ? (
                <div className="dashboard-legacy-active-card">
                  <div className="dashboard-legacy-active-summary">
                    <div>
                      <p className="dashboard-legacy-active-name">{selectedActiveTask.title}</p>
                      <p className="dashboard-legacy-active-meta">
                        {numberLabel}: <strong>{selectedActiveTask.internal_number_start || 'не указан'}</strong>
                        {' | '}
                        Создана: <strong>{new Date(selectedActiveTask.created_at).toLocaleDateString('ru-RU')}</strong>
                      </p>
                    </div>
                    <div className="dashboard-legacy-pill-row">
                      {selectedActiveTask.priority === 'urgent' && (
                        <span className="dashboard-legacy-pill is-urgent">Срочный</span>
                      )}
                      {selectedActiveTask.priority === 'high' && (
                        <span className="dashboard-legacy-pill is-high">Высокий</span>
                      )}
                      <span className="dashboard-legacy-pill is-count">
                        📋 {selectedActiveTask.profile_count || 0} {pluralizeProfiles(selectedActiveTask.profile_count || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="dashboard-legacy-active-placeholder">
                  ℹ️ Выберите задачу чтобы начать работу
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="dashboard-legacy-stats">
        {showAnalystTaskSelector ? (
          <>
            <div className="dashboard-legacy-stat-card">
              <h3 className="dashboard-legacy-stat-value is-primary">
                {loading ? '...' : <AnimatedCounter key={`task-${stats.taskProfiles}-${selectedActiveTask?.id || 'none'}`} value={stats.taskProfiles} />}
              </h3>
              <p className="dashboard-legacy-stat-label">📋 Профили в текущей задаче</p>
            </div>

            <div className="dashboard-legacy-stat-card">
              <h3 className="dashboard-legacy-stat-value is-success">
                {loading ? '...' : <AnimatedCounter key={`uploaded-${stats.uploaded30Days}`} value={stats.uploaded30Days} />}
              </h3>
              <p className="dashboard-legacy-stat-label">📤 Загружено за 30 дней</p>
            </div>

            <div className="dashboard-legacy-stat-card">
              <h3 className="dashboard-legacy-stat-value is-info">
                {loading ? '...' : <AnimatedCounter key={`active-${stats.activeTasks}`} value={stats.activeTasks} />}
              </h3>
              <p className="dashboard-legacy-stat-label">⏳ Активные задачи</p>
            </div>
          </>
        ) : (
          <>
            <div className="dashboard-legacy-stat-card">
              <h3 className="dashboard-legacy-stat-value is-primary">
                {loading ? '...' : <AnimatedCounter key={`total-${stats.totalProfiles}`} value={stats.totalProfiles} />}
              </h3>
              <p className="dashboard-legacy-stat-label">Всего ДНК профилей</p>
            </div>

            <div className="dashboard-legacy-stat-card">
              <h3 className="dashboard-legacy-stat-value is-success">
                {loading ? '...' : <AnimatedCounter key={`staff-${stats.staffProfiles}`} value={stats.staffProfiles} />}
              </h3>
              <p className="dashboard-legacy-stat-label">ДНК профили сотрудников</p>
            </div>

            <div className="dashboard-legacy-stat-card">
              <h3 className="dashboard-legacy-stat-value is-secondary">
                {loading ? '...' : <AnimatedCounter key={`users-${stats.totalUsers}`} value={stats.totalUsers} />}
              </h3>
              <p className="dashboard-legacy-stat-label">Всего пользователей</p>
            </div>
          </>
        )}
      </div>

      <div className="quick-actions-section">
        <h3>Быстрые действия</h3>

        <div className="quick-actions-grid">
          {isAnalyst && (
            <>
              <button
                onClick={() => onNavigate('/upload')}
                className={`quick-action-card${analystNeedsTask ? ' is-disabled' : ''}`}
                disabled={analystNeedsTask}
                title={taskSelectionTitle}
              >
                <div className="quick-action-icon">{analystNeedsTask ? '🔒' : '📁'}</div>
                <h4 className="quick-action-title">Загрузить ДНК профили</h4>
                <p className="quick-action-desc">{analystNeedsTask ? 'Выберите задачу' : 'Импорт данных из файлов'}</p>
              </button>

              <button
                onClick={() => onNavigate('/bayesian')}
                className="quick-action-card is-disabled"
                disabled
                title="В разработке"
              >
                <div className="quick-action-icon">🧬</div>
                <h4 className="quick-action-title">Байесовский анализ</h4>
                <p className="quick-action-desc">В разработке</p>
                <span className="quick-action-badge">🔒 В разработке</span>
              </button>

              <div className="button-with-badge">
                <button onClick={handleTasksNavigation} className="quick-action-card">
                  <div className="quick-action-icon">📋</div>
                  <h4 className="quick-action-title">Просмотр задач</h4>
                  <p className="quick-action-desc">История и текущие задания</p>
                </button>
                <NotificationBadge count={unreadCount} />
              </div>

              <button
                onClick={() => onNavigate('/analysis')}
                className={`quick-action-card${analystNeedsTask ? ' is-disabled' : ''}`}
                disabled={analystNeedsTask}
                title={taskSelectionTitle}
              >
                <div className="quick-action-icon">{analystNeedsTask ? '🔒' : '🔍'}</div>
                <h4 className="quick-action-title">Анализ данных</h4>
                <p className="quick-action-desc">{analystNeedsTask ? 'Выберите задачу' : 'Сравнение и обработка профилей'}</p>
              </button>
            </>
          )}

          {isManager && (
            <>
              <button onClick={() => onNavigate('/admin-dashboard')} className="quick-action-card">
                <div className="quick-action-icon">📊</div>
                <h4 className="quick-action-title">Аналитический дашборд</h4>
                <p className="quick-action-desc">Статистика и отчеты</p>
              </button>
              <button onClick={() => onNavigate('/profiles')} className="quick-action-card">
                <div className="quick-action-icon">📋</div>
                <h4 className="quick-action-title">Все профили</h4>
                <p className="quick-action-desc">Просмотр базы данных</p>
              </button>
              <button onClick={() => onNavigate('/users')} className="quick-action-card">
                <div className="quick-action-icon">👥</div>
                <h4 className="quick-action-title">Управление пользователями</h4>
                <p className="quick-action-desc">Настройка прав и доступа</p>
              </button>
              <button onClick={() => onNavigate('/departments')} className="quick-action-card">
                <div className="quick-action-icon">🏢</div>
                <h4 className="quick-action-title">Управление отделами</h4>
                <p className="quick-action-desc">Организационная структура</p>
              </button>
              <button onClick={() => onNavigate('/expert-groups')} className="quick-action-card">
                <div className="quick-action-icon">👩‍🔬</div>
                <h4 className="quick-action-title">Экспертные группы</h4>
                <p className="quick-action-desc">Настройка групп специалистов</p>
              </button>
              <button onClick={() => onNavigate('/tasks/create')} className="quick-action-card">
                <div className="quick-action-icon">➕</div>
                <h4 className="quick-action-title">Создать новую задачу</h4>
                <p className="quick-action-desc">Начать новый анализ</p>
              </button>
            </>
          )}

          {isAdmin && (
            <>
              <button onClick={() => onNavigate('/organizations')} className="quick-action-card">
                <div className="quick-action-icon">🏢</div>
                <h4 className="quick-action-title">Управление организациями</h4>
                <p className="quick-action-desc">Настройка организационных единиц</p>
              </button>
              <button onClick={() => onNavigate('/staff-profiles')} className="quick-action-card">
                <div className="quick-action-icon">👨‍💼</div>
                <h4 className="quick-action-title">ДНК профили сотрудников</h4>
                <p className="quick-action-desc">Управление профилями сотрудников</p>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="dashboard-legacy-system">
        <h3>✅ React приложение с пользовательским роутером работает!</h3>
        <p>Эта версия использует пользовательскую реализацию роутера вместо `react-router-dom`.</p>
        <ul>
          <li>✅ React рендеринг работает</li>
          <li>✅ Пользовательская маршрутизация работает</li>
          <li>✅ Аутентификация работает</li>
          <li>✅ Интеграция с API работает</li>
          <li>✅ Защищенные маршруты работают</li>
          <li>✅ Навигация работает</li>
        </ul>

        <div className="dashboard-legacy-system-meta">
          <p><strong>ID пользователя:</strong> {user.id}</p>
          <p><strong>Email:</strong> {user.email}</p>
          <p><strong>Роль:</strong> {user.role}</p>
          <p><strong>Время входа:</strong> {new Date().toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
};

export default LegacyDashboardView;
