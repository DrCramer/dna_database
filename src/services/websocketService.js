const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');

class WebSocketService {
  constructor() {
    this.io = null;
    this.userSockets = new Map(); // userId -> Set of socket IDs
  }

  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      path: '/socket.io/'
    });

    // Middleware для аутентификации
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        logger.warn('WebSocket: Попытка подключения без токена');
        return next(new Error('Authentication error: No token provided'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id; // В JWT токене поле называется 'id'
        socket.userRole = decoded.role;
        socket.organizationId = decoded.organization_id;
        socket.departmentId = decoded.department_id;
        
        logger.info(`WebSocket: Аутентификация успешна для пользователя ${socket.userId}`);
        next();
      } catch (err) {
        logger.error('WebSocket: Ошибка аутентификации:', err.message);
        return next(new Error('Authentication error: Invalid token'));
      }
    });

    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    logger.info('WebSocket сервер инициализирован');
  }

  handleConnection(socket) {
    const userId = socket.userId;
    
    logger.info(`WebSocket: Пользователь ${userId} подключился (socket: ${socket.id})`);

    // Добавляем сокет в карту пользователей
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socket.id);

    // Отправляем подтверждение подключения
    socket.emit('connected', {
      message: 'WebSocket connection established',
      userId: userId,
      timestamp: new Date().toISOString()
    });

    // Обработка отключения
    socket.on('disconnect', (reason) => {
      logger.info(`WebSocket: Пользователь ${userId} отключился (socket: ${socket.id}), причина: ${reason}`);
      
      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          this.userSockets.delete(userId);
        }
      }
    });

    // Обработка ошибок
    socket.on('error', (error) => {
      logger.error(`WebSocket: Ошибка для пользователя ${userId}:`, error);
    });

    // Heartbeat для проверки соединения
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });
  }

  // Отправить уведомление конкретному пользователю
  sendToUser(userId, event, data) {
    const userSocketSet = this.userSockets.get(userId);
    
    if (!userSocketSet || userSocketSet.size === 0) {
      logger.debug(`WebSocket: Пользователь ${userId} не подключен`);
      return false;
    }

    userSocketSet.forEach(socketId => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit(event, data);
        logger.debug(`WebSocket: Отправлено событие "${event}" пользователю ${userId} (socket: ${socketId})`);
      }
    });

    return true;
  }

  // Отправить уведомление всем пользователям отдела
  sendToDepartment(departmentId, event, data, excludeUserId = null) {
    let sentCount = 0;

    this.io.sockets.sockets.forEach(socket => {
      if (socket.departmentId === departmentId && socket.userId !== excludeUserId) {
        socket.emit(event, data);
        sentCount++;
      }
    });

    logger.debug(`WebSocket: Отправлено событие "${event}" ${sentCount} пользователям отдела ${departmentId}`);
    return sentCount;
  }

  // Отправить уведомление всем пользователям организации
  sendToOrganization(organizationId, event, data, excludeUserId = null) {
    let sentCount = 0;

    this.io.sockets.sockets.forEach(socket => {
      if (socket.organizationId === organizationId && socket.userId !== excludeUserId) {
        socket.emit(event, data);
        sentCount++;
      }
    });

    logger.debug(`WebSocket: Отправлено событие "${event}" ${sentCount} пользователям организации ${organizationId}`);
    return sentCount;
  }

  // Отправить уведомление всем подключенным пользователям
  broadcast(event, data) {
    this.io.emit(event, data);
    logger.debug(`WebSocket: Broadcast события "${event}" всем пользователям`);
  }

  // Получить количество подключенных пользователей
  getConnectedUsersCount() {
    return this.userSockets.size;
  }

  // Проверить, подключен ли пользователь
  isUserConnected(userId) {
    return this.userSockets.has(userId) && this.userSockets.get(userId).size > 0;
  }
}

// Singleton instance
const websocketService = new WebSocketService();

module.exports = websocketService;
