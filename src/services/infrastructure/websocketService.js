const { Server } = require('socket.io');
const { createHash } = require('node:crypto');
const authService = require('../security/authService');
const { logger } = require('../../utils/logger');

class WebSocketService {
  constructor() { this.io = null; this.userSockets = new Map(); }
  async validate(socket) {
    try {
      const decoded = authService.verifyAccessToken(socket.accessToken);
      const session = await authService.validateSession(socket.accessToken);
      if (!session || session.user_id !== decoded.id || session.department_id !== decoded.department_id
          || session.organization_id !== decoded.organization_id) throw new Error('Session unavailable');
      socket.userId = session.user_id; socket.userRole = session.role;
      socket.departmentId = session.department_id; socket.organizationId = session.organization_id;
      socket.familyId = session.session_family_id;
      return decoded;
    } catch { socket.disconnect(true); return null; }
  }
  initialize(server) {
    this.io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'], credentials: true }, path: '/socket.io/' });
    this.io.use(async (socket, next) => {
      socket.accessToken = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace(/^Bearer /, '');
      if (typeof socket.accessToken !== 'string') return next(new Error('Authentication required'));
      const decoded = await this.validate(socket);
      if (!decoded) return next(new Error('Invalid access session'));
      socket.tokenHash = createHash('sha256').update(socket.accessToken).digest('hex');
      socket.expiresAt = decoded.exp * 1000;
      next();
    });
    this.revocationListener = ({ userId, tokenHash, familyId }) => {
      for (const socket of this.io.sockets.sockets.values())
        if (socket.userId === userId || socket.tokenHash === tokenHash || familyId && socket.familyId === familyId) socket.disconnect(true);
    };
    authService.on('sessionRevoked', this.revocationListener);
    server.once('close', () => authService.off('sessionRevoked', this.revocationListener));
    this.io.on('connection', socket => this.handleConnection(socket));
    logger.info('WebSocket server initialized with session validation');
  }
  handleConnection(socket) {
    const id = socket.userId;
    if (!this.userSockets.has(id)) this.userSockets.set(id, new Set());
    this.userSockets.get(id).add(socket.id);
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(socket.expiresAt - Date.now(), 2147483647)));
    expiry.unref();
    const check = setInterval(() => this.validate(socket), 30000); check.unref();
    socket.emit('connected', { message: 'WebSocket connection established', userId: id, timestamp: new Date().toISOString() });
    socket.on('disconnect', () => {
      clearTimeout(expiry); clearInterval(check);
      this.userSockets.get(id)?.delete(socket.id);
      if (!this.userSockets.get(id)?.size) this.userSockets.delete(id);
    });
    socket.on('ping', async () => { if (await this.validate(socket)) socket.emit('pong', { timestamp: new Date().toISOString() }); });
    socket.on('error', () => logger.warn('WebSocket client error'));
  }
  async deliver(socket, event, data) {
    if (await this.validate(socket) && socket.connected) socket.emit(event, data);
  }
  sendToUser(userId, event, data) {
    const sockets = this.userSockets.get(userId);
    if (!sockets?.size) return false;
    for (const id of sockets) { const socket = this.io.sockets.sockets.get(id); if (socket) void this.deliver(socket, event, data); }
    return true;
  }
  sendToDepartment(departmentId, event, data, excludeUserId = null) {
    return this.sendWhere(s => s.departmentId === departmentId && s.userId !== excludeUserId, event, data);
  }
  sendToOrganization(organizationId, event, data, excludeUserId = null) {
    return this.sendWhere(s => s.organizationId === organizationId && s.userId !== excludeUserId, event, data);
  }
  sendWhere(predicate, event, data) {
    let count = 0;
    for (const socket of this.io?.sockets.sockets.values() || []) if (predicate(socket)) { void this.deliver(socket, event, data); count++; }
    return count;
  }
  broadcast(event, data) { return this.sendWhere(() => true, event, data); }
  getConnectedUsersCount() { return this.userSockets.size; }
  isUserConnected(id) { return Boolean(this.userSockets.get(id)?.size); }
}
module.exports = new WebSocketService();
