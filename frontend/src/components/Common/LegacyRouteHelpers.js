import React from 'react';

export const AccessDeniedState = ({ message, onNavigate }) => (
  <div className="access-denied-state">
    <h2>🚫 Доступ запрещен</h2>
    <p>{message}</p>
    <button
      onClick={() => onNavigate('/dashboard')}
      className="btn btn-secondary"
    >
      ← Назад к дашборду
    </button>
  </div>
);

export const LegacyFeaturePage = ({ title, accent = false, description, actions = [], onNavigate }) => (
  <div className="legacy-page-shell">
    <div className={`legacy-page-header page-header${accent ? ' is-accent' : ''}`}>
      <h2 className={`legacy-page-title page-title${accent ? ' is-accent' : ''}`}>{title}</h2>
      <div className="legacy-page-actions header-actions">
        <button
          onClick={() => onNavigate('/dashboard')}
          className="btn btn-secondary"
        >
          ← Назад к дашборду
        </button>
      </div>
    </div>

    <div className="legacy-page-card">
      <h3>{title}</h3>
      <p>{description}</p>
      {actions.length > 0 && (
        <div className="legacy-page-button-row">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className={action.className || 'btn btn-primary'}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
);

export const ProfilesFeaturePage = ({ onNavigate }) => (
  <LegacyFeaturePage
    title="📊 Просмотр всех профилей"
    description="Эта страница покажет все ДНК-профили в системе."
    onNavigate={onNavigate}
    actions={[
      {
        label: '📁 Загрузить новые профили',
        onClick: () => onNavigate('/upload'),
        className: 'btn btn-primary'
      },
      {
        label: '🧬 Байесовский анализ',
        onClick: () => onNavigate('/bayesian'),
        className: 'btn btn-info'
      }
    ]}
  />
);

export const ExpertGroupsFeaturePage = ({ onNavigate }) => (
  <LegacyFeaturePage
    title="👨‍🔬 Управление экспертными группами"
    accent
    description="Эта страница позволит вам управлять экспертными группами и их участниками."
    onNavigate={onNavigate}
    actions={[
      {
        label: '➕ Добавить новую экспертную группу',
        onClick: () => onNavigate('/expert-groups'),
        className: 'btn btn-success'
      },
      {
        label: '👥 Управление участниками',
        onClick: () => onNavigate('/expert-groups'),
        className: 'btn btn-secondary'
      }
    ]}
  />
);
