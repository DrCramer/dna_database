import React, { useState, useEffect } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useProfileFieldLabel } from '../../hooks/useProfileFieldLabel';

const AdminDashboard = ({ onNavigate }) => {
  const fieldLabel = useProfileFieldLabel();
  // Получаем user из контекста через window (так как useAuth недоступен здесь)
  // Альтернатива: передать user как prop или использовать контекст
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Получаем user из localStorage
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (err) {
        console.error('Error parsing user:', err);
      }
    }
  }, []);

  const [activeTab, setActiveTab] = useState('summary');
  const [kpiData, setKpiData] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [statusData, setStatusData] = useState([]);
  const [profilesInWork, setProfilesInWork] = useState([]);
  const [filters, setFilters] = useState({
    year: '',
    import_number: '',
    realtime_status: ''
  });
  const [filterOptions, setFilterOptions] = useState({
    years: [],
    importNumbers: [],
    realtimeStatuses: []
  });
  const [duplicateSearch, setDuplicateSearch] = useState('');
  const [duplicateResults, setDuplicateResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });

  // Цвета для графиков
  const COLORS = {
    primary: '#1565C0',
    success: '#28a745',
    warning: '#ffc107',
    danger: '#dc3545',
    info: '#17a2b8'
  };

  const PIE_COLORS = [COLORS.success, COLORS.warning, COLORS.danger];

  // Загрузка KPI данных
  useEffect(() => {
    loadKPIData();
    loadMonthlyStats();
    loadStatusDistribution();
    loadFilterOptions();
  }, []);

  // Загрузка профилей в работе при изменении фильтров
  useEffect(() => {
    if (activeTab === 'in-work') {
      loadProfilesInWork();
    }
  }, [activeTab, filters, pagination.page]);

  const loadKPIData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/analytics/kpi', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load KPI data');

      const result = await response.json();
      setKpiData(result.data);
    } catch (err) {
      console.error('Error loading KPI:', err);
      setError('Не удалось загрузить KPI данные');
    }
  };

  const loadMonthlyStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/analytics/monthly-stats', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load monthly stats');

      const result = await response.json();
      setMonthlyData(result.data);
    } catch (err) {
      console.error('Error loading monthly stats:', err);
    }
  };

  const loadStatusDistribution = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/analytics/status-distribution', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load status distribution');

      const result = await response.json();
      setStatusData(result.data);
    } catch (err) {
      console.error('Error loading status distribution:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadFilterOptions = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/analytics/filters', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load filter options');

      const result = await response.json();
      setFilterOptions(result.data);
    } catch (err) {
      console.error('Error loading filter options:', err);
    }
  };

  const loadProfilesInWork = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: pagination.page,
        limit: pagination.limit,
        ...filters
      });

      const response = await fetch(`/api/analytics/profiles-in-work?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load profiles in work');

      const result = await response.json();
      setProfilesInWork(result.data.profiles);
      setPagination(prev => ({ ...prev, total: result.data.pagination.total }));
    } catch (err) {
      console.error('Error loading profiles in work:', err);
    }
  };

  const handleFindDuplicates = async () => {
    if (!duplicateSearch.trim()) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/analytics/find-duplicates', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ military_unit_number: duplicateSearch })
      });

      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Не удалось найти дубликаты');
      }

      const result = await response.json();
      setDuplicateResults(result.data);
    } catch (err) {
      console.error('Error finding duplicates:', err);
      setError(err.message);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getRealtimeStatusBadge = (status) => {
    const badges = {
      'loaded': { emoji: '🟢', text: 'Загружено', class: 'badge-success' },
      'pending': { emoji: '🟡', text: 'Ожидается', class: 'badge-warning' },
      'not_assigned': { emoji: '🔴', text: 'Не назначено', class: 'badge-danger' }
    };

    const badge = badges[status] || badges.not_assigned;
    return (
      <span className={`realtime-badge ${badge.class}`}>
        {badge.emoji} {badge.text}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="admin-dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Загрузка аналитики...</p>
      </div>
    );
  }

  return (
    <div className="admin-dashboard analytics-dashboard-page">
      {/* Header */}
      <div className="page-header analytics-page-header">
        <div className="page-title-section">
          <h1 className="page-title analytics-page-title">Аналитический дашборд</h1>
          <p className="page-subtitle analytics-page-subtitle">
            Пользователь: <strong>{user?.username}</strong> ({user?.role})
          </p>
        </div>
        <button onClick={() => onNavigate('/dashboard')} className="nav-button btn btn-secondary">
          Назад к дашборду
        </button>
      </div>

      {/* Tabs */}
      <div className="dashboard-tabs">
        <button
          className={`tab-button btn btn-ghost ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          📈 Сводка
        </button>
        <button
          className={`tab-button btn btn-ghost ${activeTab === 'in-work' ? 'active' : ''}`}
          onClick={() => setActiveTab('in-work')}
        >
          📋 Данные в работе
        </button>
        <button
          className={`tab-button btn btn-ghost ${activeTab === 'duplicates' ? 'active' : ''}`}
          onClick={() => setActiveTab('duplicates')}
        >
          🔍 Анализ дубликатов
        </button>
      </div>

      {/* Tab Content */}
      <div className="dashboard-content">
        {/* Summary Tab */}
        {activeTab === 'summary' && (
          <>
            {/* KPI Cards */}
            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-icon">🗄️</div>
                <div className="kpi-content">
                  <div className="kpi-value">{kpiData?.totalProfiles || 0}</div>
                  <div className="kpi-label">Всего профилей в базе</div>
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-icon">📊</div>
                <div className="kpi-content">
                  <div className="kpi-value">
                    {kpiData?.processedThisMonth || 0}
                    {kpiData?.growthPercentage !== 0 && (
                      <span className={`kpi-growth ${kpiData?.growthPercentage > 0 ? 'positive' : 'negative'}`}>
                        {kpiData?.growthPercentage > 0 ? '↑' : '↓'} {Math.abs(kpiData?.growthPercentage)}%
                      </span>
                    )}
                  </div>
                  <div className="kpi-label">Обработано за месяц</div>
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-icon">👥</div>
                <div className="kpi-content">
                  <div className="kpi-value">{kpiData?.totalMatches || 0}</div>
                  <div className="kpi-label">Выявлено совпадений</div>
                </div>
              </div>

              <div className="kpi-card realtime-card">
                <div className="kpi-icon">🧪</div>
                <div className="kpi-content">
                  <div className="kpi-value">{kpiData?.awaitingRealtime || 0}</div>
                  <div className="kpi-label">Ожидают данных RealTime</div>
                </div>
              </div>
            </div>

            {/* Charts */}
            <div className="charts-grid">
              {/* Bar Chart */}
              <div className="chart-card">
                <h3 className="chart-title">Динамика обработки образцов по месяцам</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis
                      dataKey="month"
                      stroke="var(--text-secondary)"
                      tick={{ fill: 'var(--text-secondary)' }}
                    />
                    <YAxis
                      stroke="var(--text-secondary)"
                      tick={{ fill: 'var(--text-secondary)' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="count" fill={COLORS.primary} name="Количество профилей" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Pie Chart */}
              <div className="chart-card">
                <h3 className="chart-title">Статусы образцов</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {/* In Work Tab */}
        {activeTab === 'in-work' && (
          <div className="in-work-section">
            {/* Filters */}
            <div className="filters-row">
              <div className="filter-group">
                <label>Год:</label>
                <select
                  value={filters.year}
                  onChange={(e) => handleFilterChange('year', e.target.value)}
                  className="filter-select form-select"
                >
                  <option value="">Все</option>
                  {filterOptions.years.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>{fieldLabel('import_number', 'Привоз')}:</label>
                <select
                  value={filters.import_number}
                  onChange={(e) => handleFilterChange('import_number', e.target.value)}
                  className="filter-select form-select"
                >
                  <option value="">Все</option>
                  {filterOptions.importNumbers.map(num => (
                    <option key={num} value={num}>{num}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Статус RT:</label>
                <select
                  value={filters.realtime_status}
                  onChange={(e) => handleFilterChange('realtime_status', e.target.value)}
                  className="filter-select form-select"
                >
                  <option value="">Все</option>
                  {filterOptions.realtimeStatuses.map(status => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="table-container">
              <table className="data-table table table-striped">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Год</th>
                    <th>{fieldLabel('import_number', 'Привоз')}</th>
                                        <th>{fieldLabel('internal_number', 'Внутренний №')}</th>
                    <th>Статус ДНК-профиля</th>
                    <th>Данные RealTime</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {profilesInWork.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="analytics-empty-cell">
                        Нет данных для отображения
                      </td>
                    </tr>
                  ) : (
                    profilesInWork.map(profile => (
                      <tr key={profile.id}>
                        <td>{profile.id}</td>
                        <td>{profile.year || '-'}</td>
                        <td>{profile.import_number || '-'}</td>
                                                <td>{profile.internal_number || '-'}</td>
                        <td>
                          <span className="status-badge active">Активен</span>
                        </td>
                        <td>{getRealtimeStatusBadge(profile.realtime_status)}</td>
                        <td>
                          <button className="btn-icon btn btn-secondary" title="Привязать данные">
                            🔗
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.total > pagination.limit && (
              <div className="pagination">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={pagination.page === 1}
                  className="btn-secondary btn-sm btn"
                >
                  ← Назад
                </button>
                <span className="pagination-info">
                  Страница {pagination.page} из {Math.ceil(pagination.total / pagination.limit)}
                </span>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.min(Math.ceil(pagination.total / pagination.limit), prev.page + 1) }))}
                  disabled={pagination.page >= Math.ceil(pagination.total / pagination.limit)}
                  className="btn-secondary btn-sm btn"
                >
                  Вперед →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Duplicates Tab */}
        {activeTab === 'duplicates' && (
          <div className="duplicates-section">
            <div className="search-card">
              <h3 className="section-title">🔍 Поиск дубликатов по {fieldLabel('sample_name', 'номеру воинской части')}</h3>
              <p className="section-description">
                Введите {fieldLabel('sample_name', 'номер воинской части')} для поиска всех профилей с этим номером
              </p>

              <div className="search-row">
                <input
                  type="text"
                  value={duplicateSearch}
                  onChange={(e) => setDuplicateSearch(e.target.value)}
                  placeholder={`Введите ${fieldLabel('sample_name', '№ в в/ч')}`}
                  className="search-input form-input"
                  onKeyPress={(e) => e.key === 'Enter' && handleFindDuplicates()}
                />
                <button
                  onClick={handleFindDuplicates}
                  className="btn-primary btn"
                >
                  Найти дубликаты
                </button>
              </div>

              {duplicateResults && (
                <div className="results-section">
                  <div className="results-header">
                    <h4>Найдено {duplicateResults.count} совпадений</h4>
                    <p>{fieldLabel('sample_name', 'Номер в/ч')}: <strong>{duplicateResults.military_unit_number}</strong></p>
                  </div>

                  {duplicateResults.count > 0 && (
                    <div className="table-container">
                      <table className="data-table table table-striped">
                        <thead>
                          <tr>
                            <th>{fieldLabel('internal_number', 'Внутренний №')}</th>
                            <th>Год</th>
                            <th>{fieldLabel('import_number', 'Привоз')}</th>
                            <th>Статус</th>
                            <th>Дата загрузки</th>
                          </tr>
                        </thead>
                        <tbody>
                          {duplicateResults.duplicates.map(dup => (
                            <tr key={dup.id}>
                              <td>{dup.internal_number || '-'}</td>
                              <td>{dup.year || '-'}</td>
                              <td>{dup.import_number || '-'}</td>
                              <td>
                                {dup.is_active ? (
                                  <span className="status-badge active">✓ Активный</span>
                                ) : (
                                  <span className="status-badge inactive">✗ Деактивирован</span>
                                )}
                              </td>
                              <td>{new Date(dup.upload_date).toLocaleDateString('ru-RU')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Export Section */}
            <div className="export-card">
              <h3 className="section-title">📥 Выгрузка данных</h3>

              <div className="export-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Период с:</label>
                    <input type="date" className="form-control form-input" />
                  </div>
                  <div className="form-group">
                    <label>Период по:</label>
                    <input type="date" className="form-control form-input" />
                  </div>
                </div>

                <div className="form-group">
                  <label>Тип отчета:</label>
                  <select className="form-control form-select">
                    <option>Сводный отчет по лаборатории</option>
                    <option>Отчет по дубликатам</option>
                    <option>{fieldLabel('import_number', 'Привоз') === 'ФИО' ? 'Отчёт по ФИО' : 'Отчет по привозам'}</option>
                  </select>
                </div>

                <button className="btn-export btn btn-primary">
                  📊 Сформировать Excel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
