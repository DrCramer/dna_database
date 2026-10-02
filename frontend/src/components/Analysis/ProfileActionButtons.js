import React, { useState } from 'react';

/**
 * Кнопка деактивации профиля (стиль как у ThemeSwitcher)
 */
export const DeactivateButton = ({ profile, onToggle, disabled }) => {
  const [loading, setLoading] = useState(false);
  const isActive = profile.is_active !== false; // По умолчанию активен

  const handleClick = async (e) => {
    e.stopPropagation(); // Не выбирать строку при клике

    if (loading || disabled) return;

    // Проверка наличия ID профиля
    if (!profile || !profile.id) {
      console.error('Profile ID is missing:', profile);
      alert('Ошибка: ID профиля не найден. Возможно, это временный профиль из результатов поиска.');
      return;
    }

    // Вызываем callback для открытия модального окна
    if (onToggle) {
      onToggle(profile, isActive);
    }
  };

  return (
    <button
      className={`profile-action-btn btn btn-secondary btn-analysis-icon deactivate-btn ${!isActive ? 'inactive' : ''} ${loading ? 'loading' : ''}`}
      onClick={handleClick}
      disabled={loading || disabled}
      title={isActive ? 'Деактивировать профиль' : 'Активировать профиль'}
    >
      {loading ? (
        <span className="spinner">⏳</span>
      ) : isActive ? (
        <span className="icon">🚫</span>
      ) : (
        <span className="icon">✓</span>
      )}
    </button>
  );
};

/**
 * Иконка комментария
 */
export const CommentIcon = ({ profile, onClick, disabled }) => {
  const hasComment = !!profile.expert_comment;

  const handleClick = (e) => {
    e.stopPropagation(); // Не выбирать строку при клике
    if (!disabled) {
      onClick && onClick(profile);
    }
  };

  return (
    <button
      className={`profile-action-btn btn btn-secondary btn-analysis-icon comment-btn ${hasComment ? 'has-comment' : ''}`}
      onClick={handleClick}
      disabled={disabled}
      title={hasComment ? 'Редактировать комментарий' : 'Добавить комментарий'}
    >
      <span className="icon">💬</span>
      {hasComment && <span className="badge">✓</span>}
    </button>
  );
};

/**
 * Контейнер для кнопок действий
 */
const ProfileActionButtons = ({ profile, onToggleActive, onOpenComment, onDeactivate, onComment, disabled }) => {
  // Поддерживаем оба варианта названий для обратной совместимости
  const handleToggle = onToggleActive || onDeactivate;
  const handleComment = onOpenComment || onComment;

  return (
    <div className="profile-actions" onClick={(e) => e.stopPropagation()}>
      <DeactivateButton
        profile={profile}
        onToggle={handleToggle}
        disabled={disabled}
      />
      <CommentIcon
        profile={profile}
        onClick={handleComment}
        disabled={disabled}
      />
    </div>
  );
};

export default ProfileActionButtons;
