import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

/**
 * Custom hook для работы с WebSocket
 * @param {string} token - JWT токен для аутентификации
 * @param {Object} options - Дополнительные опции
 * @returns {Object} - { socket, isConnected, error, sendMessage }
 */
export const useWebSocket = (token, options = {}) => {
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const reconnectTimeoutRef = useRef(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const {
    autoConnect = true,
    reconnect = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
    onConnect,
    onDisconnect,
    onError,
    onMessage
  } = options;

  // Подключение к WebSocket
  const connect = useCallback(() => {
    if (!token) {
      console.warn('WebSocket: Нет токена для подключения');
      return;
    }

    if (socketRef.current?.connected) {
      console.log('WebSocket: Уже подключен');
      return;
    }

    console.log('WebSocket: Подключение...');

    // Определить URL WebSocket сервера (тот же хост что и страница)
    const wsUrl = window.location.origin;
    console.log('WebSocket: URL сервера:', wsUrl);

    const socket = io(wsUrl, {
      auth: {
        token: token
      },
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: reconnect,
      reconnectionDelay: reconnectDelay,
      reconnectionAttempts: maxReconnectAttempts
    });

    socket.on('connect', () => {
      console.log('WebSocket: Подключено');
      setIsConnected(true);
      setError(null);
      setReconnectAttempts(0);
      if (onConnect) onConnect();
    });

    socket.on('connected', (data) => {
      console.log('WebSocket: Получено подтверждение подключения:', data);
    });

    socket.on('disconnect', (reason) => {
      console.log('WebSocket: Отключено, причина:', reason);
      setIsConnected(false);
      if (onDisconnect) onDisconnect(reason);

      // Автоматическое переподключение
      if (reconnect && reason !== 'io client disconnect') {
        setReconnectAttempts(prev => prev + 1);
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`WebSocket: Попытка переподключения ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
            connect();
          }, reconnectDelay);
        } else {
          setError('Превышено максимальное количество попыток переподключения');
        }
      }
    });

    socket.on('connect_error', (err) => {
      console.error('WebSocket: Ошибка подключения:', err.message);
      setError(err.message);
      setIsConnected(false);
      if (onError) onError(err);
    });

    socket.on('error', (err) => {
      console.error('WebSocket: Ошибка:', err);
      setError(err.message || 'WebSocket error');
      if (onError) onError(err);
    });

    // Обработка входящих сообщений
    if (onMessage) {
      socket.onAny((event, data) => {
        if (event !== 'connect' && event !== 'disconnect' && event !== 'connected' && event !== 'pong') {
          onMessage(event, data);
        }
      });
    }

    socketRef.current = socket;
  }, [token, reconnect, reconnectDelay, maxReconnectAttempts, reconnectAttempts, onConnect, onDisconnect, onError, onMessage]);

  // Отключение от WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (socketRef.current) {
      console.log('WebSocket: Отключение...');
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, []);

  // Отправка сообщения
  const sendMessage = useCallback((event, data) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
      return true;
    } else {
      console.warn('WebSocket: Не подключен, невозможно отправить сообщение');
      return false;
    }
  }, []);

  // Подписка на событие
  const on = useCallback((event, handler) => {
    if (socketRef.current) {
      socketRef.current.on(event, handler);
    }
  }, []);

  // Отписка от события
  const off = useCallback((event, handler) => {
    if (socketRef.current) {
      socketRef.current.off(event, handler);
    }
  }, []);

  // Автоматическое подключение при монтировании
  useEffect(() => {
    if (autoConnect && token) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [token, autoConnect]); // Не добавляем connect и disconnect в зависимости

  return {
    socket: socketRef.current,
    isConnected,
    error,
    connect,
    disconnect,
    sendMessage,
    on,
    off
  };
};

export default useWebSocket;
