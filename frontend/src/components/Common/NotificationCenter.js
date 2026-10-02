import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { notificationService } from '../../services/notificationService';

const NotificationCenter = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    loadNotifications();
    loadUnreadCount();

    const unsubscribe = notificationService.subscribeToNotifications((notification) => {
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + 1);

      notificationService.showBrowserNotification('Система анализа ДНК', {
        body: notification.message,
        tag: `notification-${notification.id}`
      });
    });

    return unsubscribe;
  }, [user]);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const response = await notificationService.getNotifications({ limit: 20 });
      setNotifications(response.data || []);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const response = await notificationService.getUnreadCount();
      setUnreadCount(response.data?.count || 0);
    } catch (error) {
      console.error('Error loading unread count:', error);
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      await notificationService.markAsRead(notificationId);
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === notificationId ? { ...notification, is_read: true } : notification
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((prev) => prev.map((notification) => ({ ...notification, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'task_assigned':
        return '📋';
      case 'task_status_changed':
        return '🔄';
      case 'task_completed':
        return '✅';
      case 'task_approved':
        return '👍';
      case 'comment_added':
        return '💬';
      case 'result_added':
        return '📊';
      default:
        return '🔔';
    }
  };

  const getNotificationTone = (type) => {
    switch (type) {
      case 'task_assigned':
        return 'info';
      case 'task_status_changed':
        return 'warning';
      case 'task_completed':
        return 'success';
      case 'task_approved':
        return 'neutral';
      case 'comment_added':
        return 'info';
      case 'result_added':
        return 'warning';
      default:
        return 'neutral';
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="notification-center">
      <button
        type="button"
        className="notification-trigger"
        onClick={() => setShowDropdown((prev) => !prev)}
        title="Уведомления"
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <div>
              <h4>Уведомления</h4>
              <p>Последние события по задачам и результатам.</p>
            </div>
            {unreadCount > 0 && (
              <button type="button" className="btn btn-primary btn-sm" onClick={handleMarkAllAsRead}>
                Прочитать все
              </button>
            )}
          </div>

          <div className="notification-dropdown-body">
            {loading ? (
              <div className="table-loading">Загрузка уведомлений...</div>
            ) : notifications.length > 0 ? (
              notifications.map((notification) => (
                <button
                  type="button"
                  key={notification.id}
                  className={`notification-item ${notification.is_read ? 'is-read' : 'is-unread'} tone-${getNotificationTone(notification.type)}`}
                  onClick={() => !notification.is_read && handleMarkAsRead(notification.id)}
                >
                  <span className="notification-item-icon" aria-hidden="true">
                    {getNotificationIcon(notification.type)}
                  </span>
                  <span className="notification-item-content">
                    <span className="notification-item-title">{notification.title}</span>
                    <span className="notification-item-message">{notification.message}</span>
                    <span className="notification-item-time">
                      {new Date(notification.created_at).toLocaleString('ru-RU')}
                    </span>
                  </span>
                  {!notification.is_read && <span className="notification-item-dot" aria-hidden="true" />}
                </button>
              ))
            ) : (
              <div className="table-empty">Пока нет новых уведомлений.</div>
            )}
          </div>

          <div className="notification-dropdown-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDropdown(false)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
