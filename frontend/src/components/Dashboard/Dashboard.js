import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { dnaAnalysisService } from '../../services/dnaAnalysisService';
import './Dashboard.css';

const Dashboard = () => {
  const { user, hasRole } = useAuth();
  const [stats, setStats] = useState({
    totalProfiles: 0,
    staffProfiles: 0,
    recentProfiles: 0,
    totalUsers: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadDashboardStats();
  }, []);

  const loadDashboardStats = async () => {
    try {
      setLoading(true);
      const dashboardStats = await dnaAnalysisService.getDashboardStats();
      setStats(dashboardStats);
      setError(null);
    } catch (err) {
      setError('Не удалось загрузить статистику рабочей панели.');
      console.error('Ошибка загрузки статистики панели:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-container">
      <section className="dashboard-hero">
        <div className="dashboard-hero-card">
          <div className="dashboard-overline">Лабораторная аналитическая система</div>
          <h1 className="dashboard-title">Здравствуйте, {user?.username}.</h1>
          <p className="dashboard-subtitle-text">
            Здесь собраны основные действия по работе с профилями, задачами и аналитическими
            инструментами. Текущая роль: <strong>{user?.role}</strong>.
          </p>

          {error && <div className="dashboard-error">{error}</div>}
        </div>

        <div className="dashboard-hero-card dashboard-status-panel">
          <div>
            <h2 className="dashboard-status-title">Состояние системы</h2>
            <div className="dashboard-status-grid">
              <div className="dashboard-status-item">
                <span className="dashboard-status-label">Статус приложения</span>
                <span className={`status-badge ${loading ? 'status-loading' : 'status-online'}`}>
                  {loading ? 'Загрузка' : 'В сети'}
                </span>
              </div>
              <div className="dashboard-status-item">
                <span className="dashboard-status-label">Текущий пользователь</span>
                <span className="dashboard-status-value">{user?.username || 'Не определен'}</span>
              </div>
              <div className="dashboard-status-item">
                <span className="dashboard-status-label">Роль доступа</span>
                <span className="dashboard-status-value">{user?.role || 'Не определена'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-head">
            <p className="stat-card-title">Всего ДНК-профилей</p>
            <div className="stat-card-icon primary">🧬</div>
          </div>
          <h3 className="stat-value">{loading ? '...' : stats.totalProfiles}</h3>
          <p className="stat-description">Общее количество профилей в системе.</p>
        </div>

        <div className="stat-card">
          <div className="stat-card-head">
            <p className="stat-card-title">Профили сотрудников</p>
            <div className="stat-card-icon success">👨‍🔬</div>
          </div>
          <h3 className="stat-value">{loading ? '...' : stats.staffProfiles}</h3>
          <p className="stat-description">Служебные профили для внутреннего контроля.</p>
        </div>

        <div className="stat-card">
          <div className="stat-card-head">
            <p className="stat-card-title">Новые за 30 дней</p>
            <div className="stat-card-icon warning">⏱️</div>
          </div>
          <h3 className="stat-value">{loading ? '...' : stats.recentProfiles}</h3>
          <p className="stat-description">Недавние загрузки и обработки.</p>
        </div>

        <div className="stat-card">
          <div className="stat-card-head">
            <p className="stat-card-title">Пользователи</p>
            <div className="stat-card-icon info">👥</div>
          </div>
          <h3 className="stat-value">{loading ? '...' : stats.totalUsers}</h3>
          <p className="stat-description">Активные учетные записи системы.</p>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <h3 className="dashboard-card-title">Быстрые действия</h3>
          </div>
          <div className="dashboard-card-body">
            <div className="quick-actions">
              {hasRole('analyst') && (
                <>
                  <Link to="/upload" className="action-link action-link-primary">
                    <span className="action-link-title">Загрузить профили</span>
                    <span className="action-link-text">Импортировать ДНК-профили из Excel-файла.</span>
                  </Link>
                  <Link to="/search" className="action-link action-link-secondary">
                    <span className="action-link-title">Поиск и сравнение</span>
                    <span className="action-link-text">Найти совпадения и провести сравнение профилей.</span>
                  </Link>
                  <Link to="/profiles" className="action-link action-link-secondary">
                    <span className="action-link-title">Список профилей</span>
                    <span className="action-link-text">Открыть все доступные профили и их историю.</span>
                  </Link>
                </>
              )}

              {hasRole('admin') && (
                <Link to="/users" className="action-link action-link-secondary">
                  <span className="action-link-title">Пользователи</span>
                  <span className="action-link-text">Настройка ролей, доступа и учетных записей.</span>
                </Link>
              )}

              {hasRole('system_administrator') && (
                <Link to="/organizations" className="action-link action-link-info">
                  <span className="action-link-title">Организации</span>
                  <span className="action-link-text">Управление структурой организаций и параметрами.</span>
                </Link>
              )}

              {(hasRole('system_administrator') || hasRole('department_head')) && (
                <>
                  <Link to="/departments" className="action-link action-link-warning">
                    <span className="action-link-title">Отделы</span>
                    <span className="action-link-text">Управление подразделениями и рабочими зонами.</span>
                  </Link>
                  <Link to="/expert-groups" className="action-link action-link-purple">
                    <span className="action-link-title">Экспертные группы</span>
                    <span className="action-link-text">Назначение состава групп и маршрутов работы.</span>
                  </Link>
                </>
              )}

              {user?.role === 'user_analyst' ? (
                <div className="action-link-disabled">
                  <span className="action-link-title">Байесовский анализ</span>
                  <span className="action-link-disabled-subtitle">Раздел пока находится в разработке.</span>
                </div>
              ) : (
                <Link to="/bayesian-analysis" className="action-link action-link-info">
                  <span className="action-link-title">Байесовский анализ</span>
                  <span className="action-link-text">Расширенный аналитический модуль для сравнения профилей.</span>
                </Link>
              )}

              <Link to="/tasks" className="action-link action-link-success">
                <span className="action-link-title">Задачи</span>
                <span className="action-link-text">Просмотр назначенных и активных задач отдела.</span>
              </Link>

              {(hasRole('system_administrator') || hasRole('department_head')) && (
                <Link to="/tasks/create" className="action-link action-link-danger">
                  <span className="action-link-title">Создать задачу</span>
                  <span className="action-link-text">Постановка новой задачи и назначение исполнителя.</span>
                </Link>
              )}

              {!hasRole('analyst') && (
                <p className="no-permissions-text">
                  Для расширения прав обратитесь к администратору системы.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <h3 className="dashboard-card-title">Последняя активность</h3>
          </div>
          <div className="dashboard-card-body">
            <p className="recent-activity-text">
              Сводка по текущей сессии и последнему входу в систему.
            </p>
            <div className="activity-details">
              <p><strong>Последний вход</strong> {new Date().toLocaleString('ru-RU')}</p>
              <p><strong>Состояние сессии</strong> Активна</p>
            </div>
          </div>
        </div>
      </section>

      <section className="system-info-card">
        <div className="dashboard-card-header">
          <h3 className="dashboard-card-title">Системная информация</h3>
        </div>
        <div className="system-info-grid">
          <div>
            <strong>Поддерживаемые STR-локусы</strong>
            39
          </div>
          <div>
            <strong>Форматы файлов</strong>
            Excel (.xlsx, .xls)
          </div>
          <div>
            <strong>Максимальный размер файла</strong>
            10 МБ
          </div>
          <div>
            <strong>Текущая роль</strong>
            {user?.role}
          </div>
          <div>
            <strong>Сервер</strong>
            <span className="system-info-online">В сети</span>
          </div>
          <div>
            <strong>База данных</strong>
            <span className="system-info-online">Подключена</span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
