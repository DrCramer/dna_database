import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ThemeSwitcher from './components/Common/ThemeSwitcher';
import GenotypePanelsPage from './components/Settings/GenotypePanelsPage';
import GenotypeAnalysisPage from './components/Analysis/GenotypeAnalysisPage';
import LoginPage from './components/Auth/LoginPage';
import AdminDashboard from './components/Dashboard/AdminDashboard';
import FileUploader from './components/Upload/FileUploader';
import { useNotifications } from './hooks/useNotifications';
import PageTransition from './components/Common/PageTransition';
import { Navigate, Route, SimpleRouter } from './components/Common/SimpleRouter';
import { AccessDeniedState } from './components/Common/LegacyRouteHelpers';
import {
  DepartmentsPage,
  ExpertGroupsPage,
  OrganizationsPage,
  ProfilesPage,
  UsersPage
} from './components/Common/LegacyManagementPages';
import LegacyTasksPageView from './components/Task/LegacyTasksPageView';
import LegacyCreateTaskPageView from './components/Task/LegacyCreateTaskPageView';
import LegacyDashboardView from './components/Dashboard/LegacyDashboardView';
import LegacyBayesianShell from './components/Analysis/LegacyBayesianShell';
import MasterObjectSearchPage from './components/Search/MasterObjectSearchPage';
import { getTaskNumberLabel, getTaskNumberRangeLabel } from '../../src/utils/taskLabels';
import { useProfileFieldLabel } from './hooks/useProfileFieldLabel';

// Функция склонения слова "профиль"
const pluralizeProfiles = (n) => {
  if (n % 100 >= 11 && n % 100 <= 14) {
    return 'профилей';
  }
  switch (n % 10) {
    case 1: return 'профиль';
    case 2:
    case 3:
    case 4: return 'профиля';
    default: return 'профилей';
  }
};

const getSelectedActiveTaskStorageKey = (departmentId) => `selectedActiveTaskId:${departmentId || 'default'}`;

// Login Form Component - используем новый LoginPage
const LoginForm = ({ onNavigate, setShowTransition, setTransitionStatus }) => {
  const { user, login, error, clearError } = useAuth();

  return (
    <LoginPage
      onNavigate={onNavigate}
      setShowTransition={setShowTransition}
      setTransitionStatus={setTransitionStatus}
      user={user}
      login={login}
      error={error}
      clearError={clearError}
    />
  );
};

// Protected Route Component
const ProtectedRoute = ({ children, onNavigate, fluid = false }) => {
  const { user, loading, logout, hasRole } = useAuth();

  // Синхронная проверка - если нет пользователя и не загружается, сразу перенаправляем
  React.useLayoutEffect(() => {
    if (!loading && !user) {
      onNavigate('/login');
    }
  }, [user, loading, onNavigate]);

  // Показываем загрузку
  if (loading) {
    return (
      <div className="protected-route-state">
        <div className="protected-route-spinner" />
        <span className="protected-route-text">Загрузка...</span>
      </div>
    );
  }

  // Если пользователь не авторизован, показываем заглушку (перенаправление произойдет через useLayoutEffect)
  if (!user) {
    return (
      <div className="protected-route-state">
        <div className="protected-route-redirect">
          <div className="protected-route-spinner" />
          Перенаправление на страницу входа...
        </div>
      </div>
    );
  }

  // Импортируем Layout компонент
  const Layout = require('./components/Layout/Layout').default;

  // Оборачиваем children в Layout
  return (
    <Layout
      user={user}
      onNavigate={onNavigate}
      onLogout={logout}
      hasRole={hasRole}
      fluid={fluid}
    >
      {children}
    </Layout>
  );
};

// File Uploader Component
// Profile Viewer Component
const ProfileViewer = ({ onNavigate }) => {
  const fieldLabel = useProfileFieldLabel();
  const isGenetic = fieldLabel('sample_name', '') === '№ Экспертизы';
  const { user } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const response = await fetch('/api/profiles', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setProfiles(data.profiles || data || []);
    } catch (err) {
      setError('Не удалось загрузить ДНК-профили: ' + err.message);
      console.error('Error loading profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredProfiles = profiles.filter(profile =>
    profile.sampleName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    profile.sample_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="profile-viewer-loading">
        <h2>📊 Все ДНК-профили</h2>
        <p>Загрузка профилей...</p>
      </div>
    );
  }

  return (
    <div className="profile-viewer-page">
      {/* Header */}
      <div className="profile-viewer-header page-header">
        <h2 className="profile-viewer-title page-title">📊 Все ДНК-профили</h2>
        <div className="profile-viewer-header-actions header-actions">
          <button
            onClick={() => onNavigate('/dashboard')}
            className="nav-button btn btn-secondary"
          >
            ← Назад к дашборду
          </button>
        </div>
      </div>

      {/* Поиск */}
      <div className="profile-viewer-search">
        <input
          type="text"
          placeholder={`Поиск профилей по ${fieldLabel('sample_name', 'названию образца')}...`}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="form-input"
        />
      </div>

      {/* Ошибка */}
      {error && (
        <div className="alert alert-danger profile-viewer-alert">
          <div className="alert-content">
            <div className="alert-title">Ошибка</div>
            <p className="alert-message">{error}</p>
          </div>
        </div>
      )}

      {/* Статистика */}
      <div className="profile-viewer-stats">
        <div className="profile-viewer-stat-card">
          <h3 className="profile-viewer-stat-title profile-viewer-stat-title-primary">Всего профилей</h3>
          <p className="profile-viewer-stat-value">{profiles.length}</p>
        </div>
        <div className="profile-viewer-stat-card">
          <h3 className="profile-viewer-stat-title profile-viewer-stat-title-success">После фильтрации</h3>
          <p className="profile-viewer-stat-value">{filteredProfiles.length}</p>
        </div>
      </div>

      {/* Таблица профилей */}
      {filteredProfiles.length > 0 ? (
        <div className="profile-viewer-table-shell table-container">
          <table className="profile-viewer-table table table-striped">
            <thead>
              <tr>
                <th>{fieldLabel('sample_name', 'Наименование образца')}</th>
                <th>{fieldLabel('import_number', 'Привоз')}</th>
                {isGenetic && <th>Панель</th>}
                <th>Дата загрузки</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile, index) => {
                // Используем import_number напрямую
                const importNumber = profile.import_number || 'Нет данных';

                return (
                  <tr
                    key={profile.id || index}
                    className={index % 2 === 0 ? 'profile-viewer-row-even' : 'profile-viewer-row-odd'}
                  >
                    <td className="profile-viewer-cell-bold">
                      {profile.sampleName || profile.sample_name || 'Нет данных'}
                    </td>
                    <td className="profile-viewer-cell-mono">
                      {importNumber}
                    </td>
                    {isGenetic && <td>{profile.panel?.name || profile.panelName || 'Не указана'}</td>}
                    <td className="profile-viewer-cell-muted">
                      {profile.uploadDate || profile.upload_date || profile.created_at ?
                        new Date(profile.uploadDate || profile.upload_date || profile.created_at).toLocaleDateString('ru-RU') :
                        'Нет данных'
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="profile-viewer-empty">
          <h3>Профили не найдены</h3>
          <p>
            {searchTerm ?
              `По запросу "${searchTerm}" ничего не найдено` :
              'Пока не загружено ни одного ДНК-профиля.'
            }
          </p>
          <button
            onClick={() => onNavigate('/upload')}
            className="btn btn-primary"
          >
            📁 Загрузить ДНК-профили
          </button>
        </div>
      )}
    </div>
  );
};

// Import Staff Profiles Component
import StaffProfilesPage from './components/StaffProfiles/StaffProfilesPage';

// Import Toast Notifications
import ToastWrapper from './components/Common/ToastWrapper';

// Dashboard Component (simplified)
const Dashboard = ({ onNavigate, selectedActiveTask, setSelectedActiveTask, onNotification }) => {
  const { user, logout, hasRole, activeDepartmentId, activeDepartment } = useAuth();
  const [stats, setStats] = useState({
    taskProfiles: 0,        // Профили в текущей задаче
    uploaded30Days: 0,      // Загружено за 30 дней
    activeTasks: 0,         // Активные задачи
    totalProfiles: 0,       // Всего профилей (для админов)
    staffProfiles: 0,       // Профили сотрудников (для админов)
    totalUsers: 0           // Всего пользователей (для админов)
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // State для списка активных задач
  const [activeTasks, setActiveTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Использовать WebSocket хук для уведомлений в реальном времени
  const { unreadCount, latestNotification, isConnected } = useNotifications(user);

  // Передать уведомление в родительский компонент для Toast
  useEffect(() => {
    if (latestNotification && onNotification) {
      onNotification(latestNotification);
    }
  }, [latestNotification, onNotification]);

  // Анимация появления дашборда после загрузки
  useEffect(() => {
    document.body.classList.add('fade-in');
    return () => {
      document.body.classList.remove('fade-in');
    };
  }, []);

  // Загрузить активные задачи при монтировании компонента (только один раз)
  useEffect(() => {
    if (hasRole('user_analyst') && !hasRole('department_head') && !hasRole('admin')) {
      loadActiveTasks();
    }
  }, [activeDepartmentId]);

  // Загрузить статистику при монтировании и при смене активной задачи
  useEffect(() => {
    loadDashboardStats();
  }, [selectedActiveTask, activeDepartmentId]);

  const loadDashboardStats = async () => {
    try {
      setLoading(true);

      // Для аналитиков - новая статистика
      if (hasRole('user_analyst') && !hasRole('department_head') && !hasRole('admin')) {
        const token = localStorage.getItem('token');

        // Профили в текущей задаче
        let taskProfiles = 0;
        if (selectedActiveTask) {
          const taskProfilesRes = await fetch(`/api/profiles/count-by-task/${selectedActiveTask.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (taskProfilesRes.ok) {
            const data = await taskProfilesRes.json();
            taskProfiles = data.count || 0;
          }
        }

        // Загружено за 30 дней
        const uploaded30DaysRes = await fetch('/api/profiles/count-by-user-30days', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const uploaded30DaysData = await uploaded30DaysRes.json();

        // Активные задачи
        const activeTasksRes = await fetch('/api/tasks/active-count', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const activeTasksData = await activeTasksRes.json();

        setStats({
          taskProfiles,
          uploaded30Days: uploaded30DaysData.count || 0,
          activeTasks: activeTasksData.count || 0,
          totalProfiles: 0,
          staffProfiles: 0,
          totalUsers: 0
        });
      } else {
        // Для админов и руководителей - старая статистика
        const response = await fetch('/api/dashboard');
        const data = await response.json();
        setStats({
          taskProfiles: 0,
          uploaded30Days: 0,
          activeTasks: 0,
          totalProfiles: data.stats?.totalProfiles || 0,
          staffProfiles: data.stats?.staffProfiles || 0,
          totalUsers: data.stats?.totalUsers || 0
        });
      }
    } catch (err) {
      setError('Не удалось загрузить статистику дашборда');
      console.error('Error loading dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadActiveTasks = async () => {
    try {
      setLoadingTasks(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/tasks/my-active', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const nextActiveTasks = data.data || [];
        const storageKey = getSelectedActiveTaskStorageKey(activeDepartmentId);
        const savedTaskId = localStorage.getItem(storageKey);
        const currentTaskFromDepartment = selectedActiveTask
          ? nextActiveTasks.find((task) => task.id === selectedActiveTask.id)
          : null;
        const savedTask = savedTaskId
          ? nextActiveTasks.find((task) => task.id === savedTaskId)
          : null;

        setActiveTasks(nextActiveTasks);

        if (currentTaskFromDepartment) {
          setSelectedActiveTask(currentTaskFromDepartment);
        } else if (savedTask) {
          setSelectedActiveTask(savedTask);
        } else {
          setSelectedActiveTask(null);
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки активных задач:', err);
    } finally {
      setLoadingTasks(false);
    }
  };

  const handleTaskSelect = (taskId) => {
    const task = activeTasks.find(t => t.id === taskId);
    const storageKey = getSelectedActiveTaskStorageKey(activeDepartmentId);
    setSelectedActiveTask(task || null);

    if (task) {
      localStorage.setItem(storageKey, task.id);
    } else {
      localStorage.removeItem(storageKey);
    }
  };

  const handleTasksNavigation = async () => {
    // Пометить все уведомления как прочитанные при переходе к задачам
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/tasks/notifications/read-all', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        // Счетчик обновится автоматически через SSE или при следующей загрузке
      }
    } catch (err) {
      console.error('Ошибка пометки уведомлений как прочитанных:', err);
      // Все равно переходим к задачам
    }

    onNavigate('/tasks');
  };

  const handleLogout = () => {
    // Добавляем анимацию исчезновения перед выходом
    const dashboardContainer = document.querySelector('.page-wrapper');
    if (dashboardContainer) {
      dashboardContainer.style.transition = 'all 0.3s ease';
      dashboardContainer.style.opacity = '0';
      dashboardContainer.style.transform = 'translateY(-20px) scale(0.98)';
    }

    // Выполняем logout после анимации
    setTimeout(() => {
      logout();
      onNavigate('/login');
    }, 300);
  };

  const analystNeedsTask = !selectedActiveTask && !hasRole('department_head') && !hasRole('admin');
  const taskSelectionTitle = analystNeedsTask ? '🔒 Выберите активную задачу для начала работы' : '';

  return (
    <LegacyDashboardView
      numberLabel={getTaskNumberLabel(activeDepartment)}
      user={user}
      loading={loading}
      error={error}
      handleLogout={handleLogout}
      showAnalystTaskSelector={hasRole('user_analyst') && !hasRole('department_head') && !hasRole('admin')}
      loadingTasks={loadingTasks}
      activeTasks={activeTasks}
      selectedActiveTask={selectedActiveTask}
      handleTaskSelect={handleTaskSelect}
      pluralizeProfiles={pluralizeProfiles}
      stats={stats}
      onNavigate={onNavigate}
      analystNeedsTask={analystNeedsTask}
      taskSelectionTitle={taskSelectionTitle}
      handleTasksNavigation={handleTasksNavigation}
      unreadCount={unreadCount}
      isAnalyst={hasRole('user_analyst')}
      isManager={hasRole('department_head')}
      isAdmin={hasRole('admin')}
    />
  );
};

const TasksPage = ({ onNavigate, onSelectActiveTask }) => {
  const { user, hasRole, activeDepartmentId, activeDepartment } = useAuth();
  const [tasks, setTasks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState('all');
  const [selectedTask, setSelectedTask] = React.useState(null);
  const [showModal, setShowModal] = React.useState(false);
  const [showCancelModal, setShowCancelModal] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [taskProfiles, setTaskProfiles] = React.useState([]);
  const [loadingProfiles, setLoadingProfiles] = React.useState(false);
  const [uploadingFile, setUploadingFile] = React.useState(false);
  const [showDnaLoading, setShowDnaLoading] = React.useState(false);
  const [showAssignModal, setShowAssignModal] = React.useState(false);
  const [taskToAssign, setTaskToAssign] = React.useState(null);
  const [departmentUsers, setDepartmentUsers] = React.useState([]);
  const [selectedAssignee, setSelectedAssignee] = React.useState(null);
  const [assigning, setAssigning] = React.useState(false);
  const [sortField, setSortField] = React.useState(null);
  const [sortDirection, setSortDirection] = React.useState('asc'); // 'asc' или 'desc'

  // Новые модальные окна для подтверждения действий
  const [showStartModal, setShowStartModal] = React.useState(false);
  const [showCompleteModal, setShowCompleteModal] = React.useState(false);
  const [showApproveModal, setShowApproveModal] = React.useState(false);
  const [actionTask, setActionTask] = React.useState(null);

  const [stats, setStats] = React.useState({
    total: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
    approved: 0
  });

  React.useEffect(() => {
    loadTasks();
    markNotificationsAsRead();
  }, [filterStatus, activeDepartmentId]);

  React.useEffect(() => {
    setShowModal(false);
    setShowCancelModal(false);
    setShowAssignModal(false);
    setShowStartModal(false);
    setShowCompleteModal(false);
    setShowApproveModal(false);
    setSelectedTask(null);
    setTaskProfiles([]);
    setTaskToAssign(null);
    setSelectedAssignee(null);
    setActionTask(null);
    setCancelReason('');
    setError('');
  }, [activeDepartmentId]);

  // Блокировка прокрутки при открытии модального окна
  React.useEffect(() => {
    if (showModal || showCancelModal || showAssignModal || showStartModal || showCompleteModal || showApproveModal) {
      // Блокируем прокрутку на всех прокручиваемых элементах
      document.body.style.overflow = 'hidden';
      const appMain = document.querySelector('.app-main');
      const pageContainer = document.querySelector('.page-container');
      const pageContent = document.querySelector('.page-content');

      if (appMain) appMain.style.overflow = 'hidden';
      if (pageContainer) pageContainer.style.overflow = 'hidden';
      if (pageContent) pageContent.style.overflow = 'hidden';
    } else {
      // Восстанавливаем прокрутку
      document.body.style.overflow = '';
      const appMain = document.querySelector('.app-main');
      const pageContainer = document.querySelector('.page-container');
      const pageContent = document.querySelector('.page-content');

      if (appMain) appMain.style.overflow = '';
      if (pageContainer) pageContainer.style.overflow = '';
      if (pageContent) pageContent.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      const appMain = document.querySelector('.app-main');
      const pageContainer = document.querySelector('.page-container');
      const pageContent = document.querySelector('.page-content');

      if (appMain) appMain.style.overflow = '';
      if (pageContainer) pageContainer.style.overflow = '';
      if (pageContent) pageContent.style.overflow = '';
    };
  }, [showModal, showCancelModal, showAssignModal, showStartModal, showCompleteModal, showApproveModal]);

  const markNotificationsAsRead = async () => {
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/tasks/notifications/read-all', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (err) {
      console.error('Ошибка пометки уведомлений:', err);
      // Не показываем ошибку пользователю
    }
  };

  const loadTasks = async () => {
    try {
      setLoading(true);
      setError('');
      const token = localStorage.getItem('token');

      // Для user_analyst показываем только свои задачи
      // Для department_head и admin показываем все задачи отдела
      const url = (hasRole('department_head') || hasRole('admin'))
        ? '/api/tasks'
        : '/api/tasks?assigned_to_me=true';

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        let tasksList = data.data?.tasks || [];

        // Загрузить количество профилей для каждой задачи (для всех пользователей)
        const tasksWithProfiles = await Promise.all(
          tasksList.map(async (task) => {
            try {
              const profilesRes = await fetch(`/api/profiles/count-by-task/${task.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (profilesRes.ok) {
                const profilesData = await profilesRes.json();
                return { ...task, profile_count: profilesData.count || 0 };
              }
            } catch (err) {
              console.error(`Ошибка загрузки профилей для задачи ${task.id}:`, err);
            }
            return { ...task, profile_count: 0 };
          })
        );
        tasksList = tasksWithProfiles;

        // Подсчет статистики для руководителей и админов
        if (hasRole('department_head') || hasRole('admin')) {
          const newStats = {
            total: tasksList.length,
            assigned: tasksList.filter(t => t.status === 'assigned').length,
            in_progress: tasksList.filter(t => t.status === 'in_progress').length,
            completed: tasksList.filter(t => t.status === 'completed').length,
            cancelled: tasksList.filter(t => t.status === 'cancelled').length,
            approved: tasksList.filter(t => t.status === 'approved').length
          };
          setStats(newStats);
        }

        // Фильтрация по статусу
        if (filterStatus !== 'all') {
          tasksList = tasksList.filter(task => task.status === filterStatus);
        }

        setTasks(tasksList);
      } else {
        setError('Ошибка загрузки задач');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
      console.error('Ошибка загрузки задач:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/tasks/${taskId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        const data = await response.json();
        if (newStatus === 'in_progress' && data.data?.task) onSelectActiveTask?.(data.data.task);
        loadTasks();
        setShowModal(false);
      } else {
        const data = await response.json();
        setError(data.message || 'Ошибка изменения статуса');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
    }
  };

  const loadTaskProfiles = async (taskId) => {
    try {
      setLoadingProfiles(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/tasks/${taskId}/profiles`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setTaskProfiles(data.data.profiles || []);
      } else {
        console.error('Ошибка загрузки профилей задачи');
        setTaskProfiles([]);
      }
    } catch (err) {
      console.error('Ошибка соединения с сервером:', err);
      setTaskProfiles([]);
    } finally {
      setLoadingProfiles(false);
    }
  };

  const handleFileUpload = async (taskId, file) => {
    try {
      setUploadingFile(true);
      setError('');

      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('taskId', taskId);
      formData.append('skipValidation', 'false');
      formData.append('validationOnly', 'false');

      const response = await fetch('/api/profiles/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        const count = data.processing.created;
        alert(`Успешно загружено ${count} ${pluralizeProfiles(count)} в задачу`);
        loadTaskProfiles(taskId);
      } else {
        const data = await response.json();
        setError(data.message || 'Ошибка загрузки файла');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
    } finally {
      setUploadingFile(false);
    }
  };

  const openModal = (task) => {
    setSelectedTask(task);
    setShowModal(true);
    setTaskProfiles([]);
    // Загружаем профили задачи
    if (task.status === 'in_progress' || task.status === 'completed' || task.status === 'approved') {
      loadTaskProfiles(task.id);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedTask(null);
    setTaskProfiles([]);
  };

  // Load department users when assign modal opens
  React.useEffect(() => {
    if (showAssignModal && (hasRole('admin') || hasRole('department_head'))) {
      loadDepartmentUsers();
      // Block body scroll when modal is open
      document.body.style.overflow = 'hidden';
    } else {
      // Restore body scroll when modal is closed
      document.body.style.overflow = 'unset';
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showAssignModal, activeDepartmentId]);

  const loadDepartmentUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/users/department', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setDepartmentUsers(data.data || []);
      }
    } catch (err) {
      console.error('Error loading department users:', err);
    }
  };

  const handleAssignTask = async () => {
    if (!selectedAssignee || !taskToAssign) {
      setError('Выберите исполнителя');
      return;
    }

    setAssigning(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/tasks/${taskToAssign.id}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ assigned_to_user: selectedAssignee })
      });

      if (response.ok) {
        setShowAssignModal(false);
        setSelectedAssignee(null);
        setTaskToAssign(null);
        await loadTasks(); // Reload tasks
        if (selectedTask && selectedTask.id === taskToAssign.id) {
          // Update selected task if it's the same one
          const updatedTask = tasks.find(t => t.id === taskToAssign.id);
          if (updatedTask) {
            setSelectedTask(updatedTask);
          }
        }
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Не удалось изменить исполнителя');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
    } finally {
      setAssigning(false);
    }
  };

  const handleApproveTask = async (taskId) => {
    try {
      setShowDnaLoading(true);
      setError('');

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();

        // Показать детальную информацию о результате
        let message = data.message || 'Задача подтверждена успешно';

        if (data.data && data.data.masterArrayResult) {
          const { success, errors } = data.data.masterArrayResult;

          if (errors && errors.length > 0) {
            message += '\n\nОшибки при добавлении в мастер массив:';
            errors.forEach(err => {
              if (err.sample_name) {
                message += `\n- ${err.sample_name} (${err.internal_number}): ${err.error}`;
              } else {
                message += `\n- ${err.error}`;
              }
            });
          }

          if (success && success.length > 0) {
            message += `\n\nУспешно добавлено ${success.length} ${pluralizeProfiles(success.length)}`;
          }
        }

        alert(message);
        loadTasks();
        setShowModal(false);
        setError('');
      } else {
        const data = await response.json();
        setError(data.message || 'Ошибка подтверждения задачи');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
    } finally {
      setShowDnaLoading(false);
    }
  };

  const openCancelModal = (task) => {
    setSelectedTask(task);
    setShowCancelModal(true);
    setCancelReason('');
  };

  const closeCancelModal = () => {
    setShowCancelModal(false);
    setSelectedTask(null);
    setCancelReason('');
  };

  const handleCancelTask = async () => {
    if (!cancelReason.trim()) {
      setError('Укажите причину отмены');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/tasks/${selectedTask.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ cancel_reason: cancelReason })
      });

      if (response.ok) {
        loadTasks();
        closeCancelModal();
        setError('');
      } else {
        const data = await response.json();
        setError(data.message || 'Ошибка отмены задачи');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
    }
  };

  // Функция сортировки
  const handleSort = (field) => {
    if (sortField === field) {
      // Если кликнули по тому же полю, меняем направление
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Если новое поле, устанавливаем по возрастанию
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Получение отсортированного списка задач
  const getSortedTasks = () => {
    if (!sortField) return tasks;

    const sorted = [...tasks].sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];

      // Специальная обработка для разных типов полей
      if (sortField === 'title') {
        aValue = (aValue || '').toLowerCase();
        bValue = (bValue || '').toLowerCase();
      } else if (sortField === 'assigned_user_name') {
        aValue = (a.assigned_user_name || a.assigned_group_name || '').toLowerCase();
        bValue = (b.assigned_user_name || b.assigned_group_name || '').toLowerCase();
      } else if (sortField === 'internal_number_start') {
        aValue = parseInt(aValue) || 0;
        bValue = parseInt(bValue) || 0;
      } else if (sortField === 'profile_count') {
        aValue = parseInt(aValue) || 0;
        bValue = parseInt(bValue) || 0;
      } else if (sortField === 'priority') {
        const priorityOrder = { low: 1, medium: 2, high: 3, urgent: 4 };
        aValue = priorityOrder[aValue] || 0;
        bValue = priorityOrder[bValue] || 0;
      } else if (sortField === 'status') {
        const statusOrder = { assigned: 1, in_progress: 2, completed: 3, approved: 4, cancelled: 5 };
        aValue = statusOrder[aValue] || 0;
        bValue = statusOrder[bValue] || 0;
      } else if (sortField === 'created_at') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  };

  return (
    <LegacyTasksPageView
      numberLabel={getTaskNumberLabel(activeDepartment)}
      onNavigate={onNavigate}
      isManager={hasRole('department_head') || hasRole('admin')}
      stats={stats}
      filterStatus={filterStatus}
      setFilterStatus={setFilterStatus}
      error={error}
      loading={loading}
      tasks={tasks}
      sortField={sortField}
      sortDirection={sortDirection}
      handleSort={handleSort}
      getSortedTasks={getSortedTasks}
      setActionTask={setActionTask}
      setShowStartModal={setShowStartModal}
      setShowCompleteModal={setShowCompleteModal}
      openModal={openModal}
      setShowApproveModal={setShowApproveModal}
      openCancelModal={openCancelModal}
      showModal={showModal}
      selectedTask={selectedTask}
      closeModal={closeModal}
      setShowAssignModal={setShowAssignModal}
      setTaskToAssign={setTaskToAssign}
      handleStatusChange={handleStatusChange}
      showCancelModal={showCancelModal}
      closeCancelModal={closeCancelModal}
      cancelReason={cancelReason}
      setCancelReason={setCancelReason}
      handleCancelTask={handleCancelTask}
      showDnaLoading={showDnaLoading}
      showAssignModal={showAssignModal}
      taskToAssign={taskToAssign}
      setSelectedAssignee={setSelectedAssignee}
      setTaskToAssignDirect={setTaskToAssign}
      setShowAssignModalDirect={setShowAssignModal}
      departmentUsers={departmentUsers}
      selectedAssignee={selectedAssignee}
      assigning={assigning}
      handleAssignTask={handleAssignTask}
      showStartModal={showStartModal}
      actionTask={actionTask}
      setShowStartModalDirect={setShowStartModal}
      showCompleteModal={showCompleteModal}
      setShowCompleteModalDirect={setShowCompleteModal}
      showApproveModal={showApproveModal}
      setShowApproveModalDirect={setShowApproveModal}
      handleApproveTask={handleApproveTask}
      setError={setError}
    />
  );
};

const CreateTaskPage = ({ onNavigate }) => {
  const { hasRole, activeDepartmentId, activeDepartment } = useAuth();
  const [selectedPriority, setSelectedPriority] = React.useState('medium');
  const [isRangeMode, setIsRangeMode] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [analysts, setAnalysts] = React.useState([]);
  const [analystsLoading, setAnalystsLoading] = React.useState(true);
  const [analystsError, setAnalystsError] = React.useState('');

  // Список относится к выбранному отделению; устаревший ответ не меняет форму.
  React.useEffect(() => {
    const controller = new AbortController();
    setAnalysts([]);
    setAnalystsLoading(true);
    setAnalystsError('');
    setError('');
    setSuccess('');
    const loadAnalysts = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/users/department?role=user_analyst', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Active-Department-Id': activeDepartmentId
          },
          signal: controller.signal
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Не удалось загрузить исполнителей');
        if (!Array.isArray(data.data)) throw new Error('Сервер вернул некорректный список исполнителей');
        if (!controller.signal.aborted) setAnalysts(data.data);
      } catch (err) {
        if (!controller.signal.aborted) setAnalystsError(err.message || 'Не удалось загрузить исполнителей');
      } finally {
        if (!controller.signal.aborted) setAnalystsLoading(false);
      }
    };

    loadAnalysts();
    return () => controller.abort();
  }, [activeDepartmentId]);

  // Обработка отправки формы
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const formData = new FormData(e.target);
      const taskData = {
        title: formData.get('taskName'),
        description: formData.get('taskDescription'),
        priority: selectedPriority,
        internal_number_start: formData.get('internalNumberStart'),
        internal_number_end: isRangeMode ? formData.get('internalNumberEnd') : null,
        assigned_to_user: formData.get('assignedTo'),
        data_source: 'new_array',
        target_sample: {}
      };

      // Валидация
      if (!taskData.title || !taskData.internal_number_start || !taskData.assigned_to_user) {
        setError('Заполните все обязательные поля');
        setLoading(false);
        return;
      }

      if (!analysts.some(analyst => analyst.id === taskData.assigned_to_user)) {
        setError('Выберите исполнителя из активного отделения');
        setLoading(false);
        return;
      }

      if (isRangeMode && !taskData.internal_number_end) {
        setError('Укажите конечный номер для диапазона');
        setLoading(false);
        return;
      }

      const token = localStorage.getItem('token');

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Active-Department-Id': activeDepartmentId
        },
        body: JSON.stringify(taskData)
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Задача успешно создана!');
        setTimeout(() => {
          onNavigate('/tasks');
        }, 1500);
      } else {
        setError(data.message || 'Ошибка создания задачи');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  // Проверка доступа: только для Руководителей и Администраторов
  if (!hasRole('department_head')) {
    return (
      <AccessDeniedState
        message="У вас нет прав для создания задач."
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <LegacyCreateTaskPageView
      onNavigate={onNavigate}
      error={error}
      success={success}
      loading={loading}
      handleSubmit={handleSubmit}
      isRangeMode={isRangeMode}
      setIsRangeMode={setIsRangeMode}
      analysts={analysts}
      analystsLoading={analystsLoading}
      analystsError={analystsError}
      activeDepartmentId={activeDepartmentId}
      numberLabel={getTaskNumberLabel(activeDepartment)}
      numberRangeLabel={getTaskNumberRangeLabel(activeDepartment)}
      selectedPriority={selectedPriority}
      setSelectedPriority={setSelectedPriority}
    />
  );
};

// Main App Component
function FixedApp() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  // Глобальный state для активной задачи (для передачи между компонентами)
  const [selectedActiveTask, setSelectedActiveTask] = useState(null);
  const handleSelectActiveTask = React.useCallback((task) => {
    const savedUser = JSON.parse(localStorage.getItem('user') || 'null');
    const departmentId = task?.department_id || savedUser?.active_department_id || savedUser?.department_id;
    const storageKey = getSelectedActiveTaskStorageKey(departmentId);
    if (task) localStorage.setItem(storageKey, task.id);
    else localStorage.removeItem(storageKey);
    setSelectedActiveTask(task || null);
  }, []);

  // Глобальный state для Toast уведомлений
  const [toastNotification, setToastNotification] = useState(null);

  // Глобальный state для анимации перехода логин → дашборд
  const [showTransition, setShowTransition] = useState(false);
  const [transitionStatus, setTransitionStatus] = useState('Инициализация биометрии...');

  // Callback для получения уведомлений из Dashboard
  const handleNotification = (notification) => {
    setToastNotification(notification);
  };

  // Защитный таймаут: автоматически скрываем анимацию через 10 секунд
  useEffect(() => {
    if (showTransition) {
      const safetyTimeout = setTimeout(() => {
        console.warn('Защитный таймаут: принудительное скрытие анимации через 10 секунд');
        setShowTransition(false);
      }, 10000);

      return () => clearTimeout(safetyTimeout);
    }
  }, [showTransition]);

  useEffect(() => {
    const handleActiveDepartmentChanged = (event) => {
      const nextDepartmentId = event.detail?.departmentId || null;

      setSelectedActiveTask((currentTask) => {
        if (!currentTask || !nextDepartmentId) {
          return currentTask;
        }

        return currentTask.department_id === nextDepartmentId ? currentTask : null;
      });
    };

    window.addEventListener('auth:active-department-changed', handleActiveDepartmentChanged);

    return () => {
      window.removeEventListener('auth:active-department-changed', handleActiveDepartmentChanged);
    };
  }, []);

  // Восстановление выбранной задачи из localStorage при монтировании
  useEffect(() => {
    const restoreSelectedTask = async () => {
      const savedUser = JSON.parse(localStorage.getItem('user') || 'null');
      const savedTaskId =
        localStorage.getItem(getSelectedActiveTaskStorageKey(savedUser?.active_department_id || savedUser?.department_id))
        || localStorage.getItem('selectedActiveTaskId');

      if (savedTaskId) {
        try {
          const token = localStorage.getItem('token');
          if (!token) return;

          // Загружаем активные задачи
          const response = await fetch('/api/tasks/my-active', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
              const savedTask = data.data.find(t => t.id === savedTaskId);
              if (savedTask) {
                setSelectedActiveTask(savedTask);
              }
            }
          }
        } catch (err) {
          console.error('Ошибка восстановления выбранной задачи:', err);
        }
      }
    };

    restoreSelectedTask();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path) => {
    window.history.pushState(null, '', path);
    setCurrentPath(path);
  };

  // Root route component that handles authentication-aware routing
  const RootRoute = () => {
    const { user, loading } = useAuth();

    if (loading) {
      return (
        <div className="protected-route-state">
          <div className="protected-route-spinner" />
          <span className="protected-route-text">Загрузка...</span>
        </div>
      );
    }

    // If user is authenticated, go to dashboard, otherwise go to login
    const targetPath = user ? '/dashboard' : '/login';
    if (currentPath !== targetPath) {
      navigate(targetPath);
    }
    return null;
  };

  return (
    <ThemeProvider>
      <AuthProvider>
        {/* Глобальный оверлей перехода логин → дашборд */}
        {showTransition && (
          <div className="transition-overlay active">
            <div className="dna">
              <div className="dna-dot"></div><div className="dna-dot"></div>
              <div className="dna-dot"></div><div className="dna-dot"></div>
              <div className="dna-dot"></div><div className="dna-dot"></div>
              <div className="dna-dot"></div><div className="dna-dot"></div>
              <div className="dna-dot"></div><div className="dna-dot"></div>
              <div className="dna-dot"></div><div className="dna-dot"></div>
            </div>
            <div className="loading-status">{transitionStatus}</div>
          </div>
        )}

        <div className="App app-root-shell">
          <SimpleRouter currentPath={currentPath} setCurrentPath={setCurrentPath}>
            <Route path="/login" element={
              <LoginForm
                onNavigate={navigate}
                setShowTransition={setShowTransition}
                setTransitionStatus={setTransitionStatus}
              />
            } />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition fast={true}>
                    <Dashboard
                      onNavigate={navigate}
                      selectedActiveTask={selectedActiveTask}
                      setSelectedActiveTask={setSelectedActiveTask}
                      onNotification={handleNotification}
                    />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/upload"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <FileUploader
                      onNavigate={navigate}
                      selectedActiveTask={selectedActiveTask}
                      onSelectActiveTask={handleSelectActiveTask}
                    />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profiles"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <ProfilesPage onNavigate={navigate} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/users"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <UsersPage onNavigate={navigate} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/organizations"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <OrganizationsPage onNavigate={navigate} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/departments"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <DepartmentsPage onNavigate={navigate} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expert-groups"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <ExpertGroupsPage onNavigate={navigate} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/tasks"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <TasksPage onNavigate={navigate} onSelectActiveTask={handleSelectActiveTask} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/tasks/create"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <CreateTaskPage onNavigate={navigate} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/bayesian"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <LegacyBayesianShell onNavigate={navigate} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/staff-profiles"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <StaffProfilesPage onNavigate={navigate} />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/master-object-search"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <MasterObjectSearchPage />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analysis"
              element={
                <ProtectedRoute onNavigate={navigate} fluid>
                  <PageTransition>
                    <GenotypeAnalysisPage
                      onNavigate={navigate}
                      selectedActiveTask={selectedActiveTask}
                    />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings/panels"
              element={<ProtectedRoute onNavigate={navigate}><PageTransition><GenotypePanelsPage /></PageTransition></ProtectedRoute>}
            />
            <Route
              path="/admin-dashboard"
              element={
                <ProtectedRoute onNavigate={navigate}>
                  <PageTransition>
                    <AdminDashboard
                      onNavigate={navigate}
                    />
                  </PageTransition>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<RootRoute />} />
            <Route path="*" element={<RootRoute />} />
          </SimpleRouter>

          {/* Toast уведомления */}
          <ToastWrapper notification={toastNotification} />
        </div>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default FixedApp;
