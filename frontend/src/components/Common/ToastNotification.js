import React, { useState, useEffect } from 'react';
import './ToastNotification.css';

/**
 * Toast уведомление - всплывающее окно в углу экрана
 * @param {Object} notification - Объект уведомления
 * @param {Function} onClose - Callback при закрытии
 */
const ToastNotification = ({ notification, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (notification) {
      setIsVisible(true);
      setIsExiting(false);
      // Автозакрытие полностью отключено
    }
  }, [notification]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose();
    }, 300); // Время анимации выхода
  };

  if (!notification || !isVisible) return null;

  // Форматировать время
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    // Если сегодня - показываем только время
    if (date.toDateString() === now.toDateString()) {
      return `${hours}:${minutes}`;
    }
    
    // Если другой день - показываем дату и время
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}.${month} ${hours}:${minutes}`;
  };

  // Определить иконку и цвет по типу уведомления
  const getNotificationStyle = (type) => {
    switch (type) {
      case 'new_task':
        return { icon: '📋', tone: 'info', title: 'Новая задача' };
      case 'task_assigned':
        return { icon: '👤', tone: 'success', title: 'Задача назначена' };
      case 'status_changed':
        return { icon: '🔄', tone: 'warning', title: 'Статус изменен' };
      case 'task_cancelled':
        return { icon: '❌', tone: 'danger', title: 'Задача отменена' };
      case 'task_approved':
        return { icon: '✅', tone: 'success', title: 'Задача подтверждена' };
      default:
        return { icon: '📬', tone: 'neutral', title: 'Уведомление' };
    }
  };

  const style = getNotificationStyle(notification.type);

  return (
    <div className={`toast-notification ${isExiting ? 'toast-exit' : 'toast-enter'}`}>
      <div className={`toast-icon tone-${style.tone}`}>
        {style.icon}
      </div>
      <div className="toast-content">
        <div className="toast-title">{style.title}</div>
        <div className="toast-message">{notification.message}</div>
        {notification.userName && (
          <div className="toast-user-name">👤 {notification.userName}</div>
        )}
        {notification.taskTitle && (
          <div className="toast-task-title">"{notification.taskTitle}"</div>
        )}
        {notification.priority && (
          <div className={`toast-priority priority-${notification.priority}`}>
            {notification.priority === 'urgent' ? '🔴 Срочно' : 
             notification.priority === 'high' ? '🟠 Высокий' : 
             notification.priority === 'normal' ? '🟢 Обычный' : '⚪ Низкий'}
          </div>
        )}
        {notification.timestamp && (
          <div className="toast-timestamp">🕐 {formatTime(notification.timestamp)}</div>
        )}
      </div>
      <button type="button" className="toast-close" onClick={handleClose} aria-label="Закрыть уведомление">
        ×
      </button>
    </div>
  );
};

export default ToastNotification;
