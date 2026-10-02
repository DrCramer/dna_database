import React from 'react';
import AnimatedCounter from '../Common/AnimatedCounter';

export const TaskStatusBadge = ({ status }) => {
  const statusConfig = {
    assigned: { label: 'Назначена', className: 'status-assigned' },
    pending: { label: 'Ожидает', className: 'status-pending' },
    in_progress: { label: 'В работе', className: 'status-in-progress' },
    completed: { label: 'Завершена', className: 'status-completed' },
    cancelled: { label: 'Отменена', className: 'status-cancelled' },
    approved: { label: 'Подтверждена', className: 'status-approved' }
  };

  const config = statusConfig[status] || { label: status, className: 'status-pending' };

  return <span className={`task-badge ${config.className}`}>{config.label}</span>;
};

export const TaskPriorityBadge = ({ priority }) => {
  const priorityConfig = {
    low: { label: 'Низкий', className: 'priority-low' },
    medium: { label: 'Средний', className: 'priority-medium' },
    high: { label: 'Высокий', className: 'priority-high' },
    urgent: { label: 'Срочный', className: 'priority-urgent' }
  };

  const config = priorityConfig[priority] || { label: priority, className: 'priority-medium' };

  return <span className={`task-badge priority ${config.className}`}>{config.label}</span>;
};

export const TaskSortableHeader = ({
  field,
  currentField,
  currentDirection,
  onSort,
  children
}) => (
  <th
    onClick={() => onSort(field)}
    className="task-sort-header"
    title={`Сортировать по ${children}`}
  >
    <div className="task-sort-header__inner">
      {children}
      {currentField === field && (
        <span className="task-sort-header__indicator">
          {currentDirection === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </div>
  </th>
);

export const TaskStatsGrid = ({ stats }) => {
  const items = [
    { key: 'total', label: 'Всего задач', className: 'is-primary' },
    { key: 'assigned', label: 'Назначена', className: 'is-assigned' },
    { key: 'in_progress', label: 'В работе', className: 'is-progress' },
    { key: 'completed', label: 'Завершена', className: 'is-completed' },
    { key: 'approved', label: 'Подтверждена', className: 'is-approved' },
    { key: 'cancelled', label: 'Отменено', className: 'is-cancelled' }
  ];

  return (
    <div className="task-stats-grid">
      {items.map((item) => (
        <div key={item.key} className="task-stat-card">
          <div className="task-stat-label">{item.label}</div>
          <div className={`task-stat-value ${item.className}`}>
            <AnimatedCounter key={`task-stat-${item.key}-${stats[item.key] || 0}`} value={stats[item.key] || 0} />
          </div>
        </div>
      ))}
    </div>
  );
};

export const TaskFilterBar = ({ filterStatus, onChange }) => {
  const filters = [
    { value: 'all', label: 'Все', icon: '📋' },
    { value: 'assigned', label: 'Назначена', icon: '⏳' },
    { value: 'in_progress', label: 'В работе', icon: '🔄' },
    { value: 'completed', label: 'Завершена', icon: '✅' },
    { value: 'approved', label: 'Подтверждена', icon: '✔️' },
    { value: 'cancelled', label: 'Отменена', icon: '❌' }
  ];

  return (
    <div className="task-filter-card">
      <h3 className="task-filter-title">Фильтр по статусу</h3>
      <div className="task-filter-actions">
        {filters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => onChange(filter.value)}
            className={`task-filter-btn btn btn-secondary btn-sm${filterStatus === filter.value ? ' is-active' : ''}`}
          >
            <span className="task-filter-icon">{filter.icon}</span>
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export const TaskListState = ({ loading, isEmpty }) => {
  if (loading) {
    return (
      <div className="task-state">
        <div className="loading-spinner task-state-icon"></div>
        Загрузка задач...
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="task-state">
        <div className="task-state-icon">📭</div>
        <p>Задач не найдено</p>
      </div>
    );
  }

  return null;
};
