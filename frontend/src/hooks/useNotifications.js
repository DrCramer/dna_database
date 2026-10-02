import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from './useWebSocket';

/**
 * Хук для работы с уведомлениями в реальном времени через WebSocket
 * @param {Object} user - Объект пользователя
 * @returns {Object} { unreadCount, latestNotification, isConnected }
 */
export const useNotifications = (user) => {
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestNotification, setLatestNotification] = useState(null);
  const initialLoadRef = useRef(false);

  // Получить токен
  const token = user?.accessToken || localStorage.getItem('token');

  // Обработчик WebSocket сообщений
  const handleMessage = (event, data) => {
    console.log('WebSocket notification received:', event, data);

    switch (event) {
      case 'task:created':
        setUnreadCount(prev => prev + 1);
        setLatestNotification({
          type: 'new_task',
          message: data.message || `Новая задача: ${data.taskTitle}`,
          taskId: data.taskId,
          taskTitle: data.taskTitle,
          priority: data.priority,
          userName: data.userName,
          timestamp: data.timestamp
        });
        showBrowserNotification({
          type: 'new_task',
          message: data.message || `Новая задача: ${data.taskTitle}`,
          created_at: data.timestamp
        });
        playNotificationSound();
        break;

      case 'task:assigned':
        setUnreadCount(prev => prev + 1);
        setLatestNotification({
          type: 'task_assigned',
          message: data.message || `Задача назначена: ${data.taskTitle}`,
          taskId: data.taskId,
          taskTitle: data.taskTitle,
          priority: data.priority,
          userName: data.userName,
          timestamp: data.timestamp
        });
        showBrowserNotification({
          type: 'task_assigned',
          message: data.message || `Задача назначена: ${data.taskTitle}`,
          created_at: data.timestamp
        });
        playNotificationSound();
        break;

      case 'task:cancelled':
        setUnreadCount(prev => prev + 1);
        setLatestNotification({
          type: 'task_cancelled',
          message: data.message || `Задача "${data.taskTitle}" отменена`,
          taskId: data.taskId,
          taskTitle: data.taskTitle,
          userName: data.userName,
          timestamp: data.timestamp
        });
        showBrowserNotification({
          type: 'task_cancelled',
          message: `Задача "${data.taskTitle}" отменена`,
          created_at: data.timestamp
        });
        playNotificationSound();
        break;

      case 'task:status_changed':
        setUnreadCount(prev => prev + 1);
        setLatestNotification({
          type: 'status_changed',
          message: data.message || `Статус задачи "${data.taskTitle}" изменен`,
          taskId: data.taskId,
          taskTitle: data.taskTitle,
          oldStatus: data.oldStatus,
          newStatus: data.newStatus,
          userName: data.userName,
          timestamp: data.timestamp
        });
        showBrowserNotification({
          type: 'status_changed',
          message: data.message || `Статус задачи изменен`,
          created_at: data.timestamp
        });
        playNotificationSound();
        break;

      case 'task:approved':
        setUnreadCount(prev => prev + 1);
        setLatestNotification({
          type: 'task_approved',
          message: data.message || `Задача "${data.taskTitle}" подтверждена`,
          taskId: data.taskId,
          taskTitle: data.taskTitle,
          userName: data.userName,
          masterArrayAdded: data.masterArrayAdded,
          timestamp: data.timestamp
        });
        showBrowserNotification({
          type: 'task_approved',
          message: data.message || `Задача "${data.taskTitle}" подтверждена`,
          created_at: data.timestamp
        });
        playNotificationSound();
        break;

      case 'notification:count':
        setUnreadCount(data.count);
        break;

      default:
        console.log('Unknown notification event:', event);
    }
  };

  // Подключение к WebSocket
  const { isConnected, on, off } = useWebSocket(token, {
    autoConnect: !!user && !!token,
    onConnect: () => {
      console.log('WebSocket notifications connected');
      // Загрузить начальный счетчик уведомлений
      if (!initialLoadRef.current) {
        loadInitialCount();
        initialLoadRef.current = true;
      }
    },
    onDisconnect: (reason) => {
      console.log('WebSocket notifications disconnected:', reason);
    },
    onMessage: handleMessage
  });

  // Загрузить начальный счетчик уведомлений
  const loadInitialCount = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch('/api/tasks/notifications/count', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.data.count);
      }
    } catch (error) {
      console.error('Ошибка загрузки счетчика уведомлений:', error);
    }
  };

  // Запросить разрешение на уведомления при первом использовании
  useEffect(() => {
    if (user && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [user]);

  return { unreadCount, latestNotification, isConnected };
};

/**
 * Показать браузерное уведомление
 * @param {Object} notification - Объект уведомления
 */
const showBrowserNotification = (notification) => {
  try {
    // Проверить поддержку браузером
    if (!('Notification' in window)) {
      return;
    }

    // Если разрешение уже дано - показать уведомление
    if (Notification.permission === 'granted') {
      const title = getNotificationTitle(notification.type);
      const options = {
        body: notification.message,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: `notification-${notification.id}`,
        requireInteraction: true,
        silent: false,
        timestamp: new Date(notification.created_at).getTime()
      };

      const browserNotification = new Notification(title, options);

      // Обработать клик по уведомлению
      browserNotification.onclick = () => {
        window.focus();
        browserNotification.close();
      };

      browserNotification.onerror = (error) => {
        console.error('Ошибка браузерного уведомления:', error);
      };
    } 
    // Если разрешение не запрошено - запросить
    else if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showBrowserNotification(notification);
        }
      });
    }
  } catch (error) {
    console.error('Ошибка показа браузерного уведомления:', error);
  }
};

/**
 * Получить заголовок уведомления по типу
 * @param {string} type - Тип уведомления
 * @returns {string} Заголовок
 */
const getNotificationTitle = (type) => {
  const titles = {
    'new_task': '🆕 Новая задача',
    'status_changed': '🔄 Изменение статуса',
    'task_cancelled': '❌ Задача отменена',
    'task_approved': '✅ Задача подтверждена',
    'task_assigned': '👤 Задача назначена'
  };
  return titles[type] || '📬 Уведомление';
};

/**
 * Воспроизвести звук уведомления
 */
const playNotificationSound = () => {
  try {
    // Создать короткий звуковой сигнал
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (error) {
    console.error('Ошибка воспроизведения звука:', error);
  }
};
