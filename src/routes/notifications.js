const express = require('express');
const { authenticate } = require('../middleware/auth');
const { notificationService } = require('../services/notificationService');
const { logger } = require('../utils/logger');
const Joi = require('joi');

const router = express.Router();

// Validation schemas
const markAsReadSchema = Joi.object({
  notificationIds: Joi.array().items(Joi.string()).min(1).required()
});

const notificationQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50),
  unreadOnly: Joi.boolean().default(false),
  type: Joi.string().valid(
    'export_success',
    'export_failed', 
    'job_progress',
    'system_notification'
  ).optional()
});

/**
 * GET /api/notifications
 * Get user's notifications
 */
router.get('/', authenticate, async (req, res) => {
  try {
    // Validate query parameters
    const { error, value } = notificationQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map(detail => detail.message)
      });
    }

    const notifications = notificationService.getUserNotifications(req.user.id, value);
    const stats = notificationService.getNotificationStats(req.user.id);

    res.json({
      success: true,
      notifications,
      stats,
      pagination: {
        limit: value.limit,
        returned: notifications.length
      }
    });

  } catch (error) {
    logger.error('Error getting user notifications', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Notifications Retrieval Failed',
      message: 'Failed to retrieve notifications'
    });
  }
});

/**
 * GET /api/notifications/stats
 * Get notification statistics for user
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    const stats = notificationService.getNotificationStats(req.user.id);

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    logger.error('Error getting notification stats', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Stats Retrieval Failed',
      message: 'Failed to retrieve notification statistics'
    });
  }
});

/**
 * PUT /api/notifications/read
 * Mark notifications as read
 */
router.put('/read', authenticate, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = markAsReadSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map(detail => detail.message)
      });
    }

    const { notificationIds } = value;
    let markedCount = 0;

    // Mark each notification as read
    for (const notificationId of notificationIds) {
      if (notificationService.markAsRead(req.user.id, notificationId)) {
        markedCount++;
      }
    }

    logger.info('Notifications marked as read', {
      userId: req.user.id,
      requestedCount: notificationIds.length,
      markedCount
    });

    res.json({
      success: true,
      message: `${markedCount} notifications marked as read`,
      markedCount,
      requestedCount: notificationIds.length
    });

  } catch (error) {
    logger.error('Error marking notifications as read', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Mark Read Failed',
      message: 'Failed to mark notifications as read'
    });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read for user
 */
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const markedCount = notificationService.markAllAsRead(req.user.id);

    logger.info('All notifications marked as read', {
      userId: req.user.id,
      markedCount
    });

    res.json({
      success: true,
      message: `${markedCount} notifications marked as read`,
      markedCount
    });

  } catch (error) {
    logger.error('Error marking all notifications as read', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Mark All Read Failed',
      message: 'Failed to mark all notifications as read'
    });
  }
});

/**
 * DELETE /api/notifications/:notificationId
 * Delete a specific notification
 */
router.delete('/:notificationId', authenticate, async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json({
        error: 'Missing Notification ID',
        message: 'Notification ID is required'
      });
    }

    const deleted = notificationService.deleteNotification(req.user.id, notificationId);

    if (!deleted) {
      return res.status(404).json({
        error: 'Notification Not Found',
        message: 'Notification not found or access denied'
      });
    }

    logger.info('Notification deleted', {
      userId: req.user.id,
      notificationId
    });

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting notification', {
      error: error.message,
      userId: req.user?.id,
      notificationId: req.params.notificationId
    });

    res.status(500).json({
      error: 'Delete Failed',
      message: 'Failed to delete notification'
    });
  }
});

/**
 * DELETE /api/notifications
 * Clear all notifications for user
 */
router.delete('/', authenticate, async (req, res) => {
  try {
    const clearedCount = notificationService.clearUserNotifications(req.user.id);

    logger.info('User notifications cleared', {
      userId: req.user.id,
      clearedCount
    });

    res.json({
      success: true,
      message: `${clearedCount} notifications cleared`,
      clearedCount
    });

  } catch (error) {
    logger.error('Error clearing notifications', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Clear Failed',
      message: 'Failed to clear notifications'
    });
  }
});

// SSE endpoint removed - using WebSocket instead (see src/services/websocketService.js)

/**
 * POST /api/notifications/test
 * Create test notification (development only)
 */
if (process.env.NODE_ENV === 'development') {
  router.post('/test', authenticate, async (req, res) => {
    try {
      const { type = 'test', title = 'Test Notification', message = 'This is a test notification' } = req.body;

      const notificationId = await notificationService.createNotification({
        userId: req.user.id,
        type,
        title,
        message,
        data: { test: true },
        priority: 'normal'
      });

      res.json({
        success: true,
        message: 'Test notification created',
        notificationId
      });

    } catch (error) {
      logger.error('Error creating test notification', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        error: 'Test Failed',
        message: 'Failed to create test notification'
      });
    }
  });
}

module.exports = router;