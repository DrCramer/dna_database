const { logger } = require('../utils/logger');
const UserSettings = require('../models/UserSettings');
const OperationHistory = require('../models/OperationHistory');

// Generate UUID using crypto module
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();

/**
 * Notification Service for handling user notifications
 * Supports in-app notifications and future email notifications
 */
class NotificationService {
  constructor() {
    this.notifications = new Map(); // In-memory notification storage
    // subscribers removed - using WebSocket instead (see src/services/websocketService.js)
    this.maxNotificationsPerUser = 100; // Limit notifications per user
  }

  /**
   * Create a new notification
   * @param {Object} notificationData - Notification data
   * @param {string} notificationData.userId - Target user ID
   * @param {string} notificationData.type - Notification type
   * @param {string} notificationData.title - Notification title
   * @param {string} notificationData.message - Notification message
   * @param {Object} notificationData.data - Additional data
   * @param {string} notificationData.priority - Priority level (low, normal, high)
   * @returns {string} Notification ID
   */
  async createNotification(notificationData) {
    const {
      userId,
      type,
      title,
      message,
      data = {},
      priority = 'normal'
    } = notificationData;

    const notificationId = uuidv4();
    const notification = {
      id: notificationId,
      userId,
      type,
      title,
      message,
      data,
      priority,
      read: false,
      createdAt: new Date(),
      readAt: null
    };

    // Store notification
    if (!this.notifications.has(userId)) {
      this.notifications.set(userId, []);
    }

    const userNotifications = this.notifications.get(userId);
    userNotifications.unshift(notification); // Add to beginning

    // Limit notifications per user
    if (userNotifications.length > this.maxNotificationsPerUser) {
      userNotifications.splice(this.maxNotificationsPerUser);
    }

    // Log notification creation
    logger.info('Notification created', {
      notificationId,
      userId,
      type,
      title,
      priority
    });

    // Real-time notifications now handled by WebSocket (see src/services/websocketService.js)

    // Log to operation history
    try {
      await OperationHistory.logOperation({
        userId,
        operationType: OperationHistory.OPERATION_TYPES.SYSTEM_NOTIFICATION,
        operationDetails: {
          notificationId,
          type,
          title,
          priority
        },
        success: true
      });
    } catch (error) {
      logger.warn('Failed to log notification to operation history', {
        error: error.message,
        notificationId
      });
    }

    return notificationId;
  }

  /**
   * Send export completion notification
   * @param {string} userId - User ID
   * @param {Object} exportResult - Export result data
   * @param {boolean} success - Whether export was successful
   */
  async notifyExportCompletion(userId, exportResult, success = true) {
    try {
      // Check user notification preferences (with fallback if UserSettings fails)
      let notificationPrefs = { showSuccessMessages: true };
      try {
        const userSettings = await UserSettings.getUserSettings(userId);
        notificationPrefs = userSettings.notifications || notificationPrefs;
      } catch (error) {
        logger.warn('Failed to get user notification preferences, using defaults', {
          error: error.message,
          userId
        });
      }

      if (!notificationPrefs.showSuccessMessages && success) {
        return; // User disabled success notifications
      }

      const notificationData = {
        userId,
        type: success ? 'export_success' : 'export_failed',
        priority: success ? 'normal' : 'high'
      };

      if (success) {
        notificationData.title = 'Export Complete';
        notificationData.message = `Your DNA analysis export "${exportResult.filename}" is ready for download.`;
        notificationData.data = {
          exportId: exportResult.exportId,
          filename: exportResult.filename,
          recordCount: exportResult.recordCount,
          fileSize: exportResult.fileSize,
          downloadUrl: exportResult.downloadUrl,
          expiresAt: exportResult.expiresAt
        };
      } else {
        notificationData.title = 'Export Failed';
        notificationData.message = `Failed to generate export: ${exportResult.error || 'Unknown error'}`;
        notificationData.data = {
          error: exportResult.error,
          recordCount: exportResult.recordCount || 0
        };
      }

      await this.createNotification(notificationData);

      logger.info('Export completion notification sent', {
        userId,
        success,
        exportId: exportResult.exportId || 'N/A'
      });

    } catch (error) {
      logger.error('Error sending export completion notification', {
        error: error.message,
        userId,
        exportResult: exportResult?.exportId || 'N/A'
      });
    }
  }

  /**
   * Send job progress notification
   * @param {string} userId - User ID
   * @param {Object} jobData - Job progress data
   */
  async notifyJobProgress(userId, jobData) {
    try {
      const { jobId, progress, status, recordCount } = jobData;

      // Only send progress notifications for significant milestones
      const milestones = [25, 50, 75];
      if (!milestones.includes(progress)) {
        return;
      }

      await this.createNotification({
        userId,
        type: 'job_progress',
        title: 'Export Progress',
        message: `Export processing ${progress}% complete (${recordCount} records)`,
        priority: 'low',
        data: {
          jobId,
          progress,
          status,
          recordCount
        }
      });

    } catch (error) {
      logger.error('Error sending job progress notification', {
        error: error.message,
        userId,
        jobId: jobData.jobId
      });
    }
  }

  /**
   * Send task assignment notification
   * @param {Object} task - Task object
   * @param {Array} assigneeIds - Array of user IDs to notify
   */
  async notifyTaskAssignment(task, assigneeIds) {
    try {
      for (const userId of assigneeIds) {
        await this.createNotification({
          userId,
          type: 'task_assigned',
          title: 'New Task Assigned',
          message: `You have been assigned a new task: "${task.title}"`,
          priority: task.priority === 'urgent' ? 'high' : 'normal',
          data: {
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description,
            priority: task.priority,
            deadline: task.deadline,
            departmentId: task.department_id,
            createdBy: task.created_by
          }
        });
      }

      logger.info('Task assignment notifications sent', {
        taskId: task.id,
        assigneeCount: assigneeIds.length
      });

    } catch (error) {
      logger.error('Error sending task assignment notifications', {
        error: error.message,
        taskId: task.id
      });
    }
  }

  /**
   * Send task status change notification
   * @param {Object} task - Task object
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   * @param {string} changedBy - User ID who changed the status
   * @param {Array} notifyUserIds - Array of user IDs to notify
   */
  async notifyTaskStatusChange(task, oldStatus, newStatus, changedBy, notifyUserIds) {
    try {
      const statusMessages = {
        'assigned': 'assigned',
        'in_progress': 'started',
        'completed': 'completed',
        'approved': 'approved'
      };

      const message = `Task "${task.title}" has been ${statusMessages[newStatus] || newStatus}`;
      
      for (const userId of notifyUserIds) {
        // Don't notify the user who made the change
        if (userId === changedBy) continue;

        await this.createNotification({
          userId,
          type: 'task_status_changed',
          title: 'Task Status Updated',
          message,
          priority: newStatus === 'approved' ? 'high' : 'normal',
          data: {
            taskId: task.id,
            taskTitle: task.title,
            oldStatus,
            newStatus,
            changedBy,
            departmentId: task.department_id
          }
        });
      }

      logger.info('Task status change notifications sent', {
        taskId: task.id,
        oldStatus,
        newStatus,
        notifyCount: notifyUserIds.length
      });

    } catch (error) {
      logger.error('Error sending task status change notifications', {
        error: error.message,
        taskId: task.id
      });
    }
  }

  /**
   * Send task comment notification
   * @param {Object} task - Task object
   * @param {Object} comment - Comment object
   * @param {Array} notifyUserIds - Array of user IDs to notify
   */
  async notifyTaskComment(task, comment, notifyUserIds) {
    try {
      for (const userId of notifyUserIds) {
        // Don't notify the comment author
        if (userId === comment.user_id) continue;

        await this.createNotification({
          userId,
          type: 'task_comment',
          title: 'New Task Comment',
          message: `${comment.username} commented on task "${task.title}"`,
          priority: 'normal',
          data: {
            taskId: task.id,
            taskTitle: task.title,
            commentId: comment.id,
            commentText: comment.comment.substring(0, 100) + (comment.comment.length > 100 ? '...' : ''),
            commentAuthor: comment.username,
            departmentId: task.department_id
          }
        });
      }

      logger.info('Task comment notifications sent', {
        taskId: task.id,
        commentId: comment.id,
        notifyCount: notifyUserIds.length
      });

    } catch (error) {
      logger.error('Error sending task comment notifications', {
        error: error.message,
        taskId: task.id,
        commentId: comment.id
      });
    }
  }

  /**
   * Send task deadline reminder notification
   * @param {Object} task - Task object
   * @param {Array} assigneeIds - Array of user IDs to notify
   * @param {number} hoursUntilDeadline - Hours until deadline
   */
  async notifyTaskDeadlineReminder(task, assigneeIds, hoursUntilDeadline) {
    try {
      const urgencyLevel = hoursUntilDeadline <= 24 ? 'high' : 'normal';
      const timeText = hoursUntilDeadline <= 24 
        ? `${hoursUntilDeadline} hours` 
        : `${Math.ceil(hoursUntilDeadline / 24)} days`;

      for (const userId of assigneeIds) {
        await this.createNotification({
          userId,
          type: 'task_deadline_reminder',
          title: 'Task Deadline Reminder',
          message: `Task "${task.title}" is due in ${timeText}`,
          priority: urgencyLevel,
          data: {
            taskId: task.id,
            taskTitle: task.title,
            deadline: task.deadline,
            hoursUntilDeadline,
            departmentId: task.department_id
          }
        });
      }

      logger.info('Task deadline reminder notifications sent', {
        taskId: task.id,
        assigneeCount: assigneeIds.length,
        hoursUntilDeadline
      });

    } catch (error) {
      logger.error('Error sending task deadline reminder notifications', {
        error: error.message,
        taskId: task.id
      });
    }
  }

  /**
   * Send task result notification
   * @param {Object} task - Task object
   * @param {Object} result - Task result object
   * @param {Array} notifyUserIds - Array of user IDs to notify
   */
  async notifyTaskResult(task, result, notifyUserIds) {
    try {
      for (const userId of notifyUserIds) {
        // Don't notify the result author
        if (userId === result.user_id) continue;

        await this.createNotification({
          userId,
          type: 'task_result',
          title: 'New Task Result',
          message: `${result.username} added results to task "${task.title}"`,
          priority: 'normal',
          data: {
            taskId: task.id,
            taskTitle: task.title,
            resultId: result.id,
            resultAuthor: result.username,
            departmentId: task.department_id
          }
        });
      }

      logger.info('Task result notifications sent', {
        taskId: task.id,
        resultId: result.id,
        notifyCount: notifyUserIds.length
      });

    } catch (error) {
      logger.error('Error sending task result notifications', {
        error: error.message,
        taskId: task.id,
        resultId: result.id
      });
    }
  }

  /**
   * Get notifications for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of notifications
   * @param {boolean} options.unreadOnly - Only return unread notifications
   * @param {string} options.type - Filter by notification type
   * @returns {Array} Array of notifications
   */
  getUserNotifications(userId, options = {}) {
    const {
      limit = 50,
      unreadOnly = false,
      type = null
    } = options;

    const userNotifications = this.notifications.get(userId) || [];
    
    let filtered = userNotifications;

    // Filter by read status
    if (unreadOnly) {
      filtered = filtered.filter(n => !n.read);
    }

    // Filter by type
    if (type) {
      filtered = filtered.filter(n => n.type === type);
    }

    // Apply limit
    return filtered.slice(0, limit);
  }

  /**
   * Mark notification as read
   * @param {string} userId - User ID
   * @param {string} notificationId - Notification ID
   * @returns {boolean} Success status
   */
  markAsRead(userId, notificationId) {
    const userNotifications = this.notifications.get(userId) || [];
    const notification = userNotifications.find(n => n.id === notificationId);

    if (!notification) {
      return false;
    }

    if (!notification.read) {
      notification.read = true;
      notification.readAt = new Date();

      logger.debug('Notification marked as read', {
        notificationId,
        userId
      });
    }

    return true;
  }

  /**
   * Mark all notifications as read for a user
   * @param {string} userId - User ID
   * @returns {number} Number of notifications marked as read
   */
  markAllAsRead(userId) {
    const userNotifications = this.notifications.get(userId) || [];
    let markedCount = 0;

    userNotifications.forEach(notification => {
      if (!notification.read) {
        notification.read = true;
        notification.readAt = new Date();
        markedCount++;
      }
    });

    if (markedCount > 0) {
      logger.info('All notifications marked as read', {
        userId,
        markedCount
      });
    }

    return markedCount;
  }

  /**
   * Delete notification
   * @param {string} userId - User ID
   * @param {string} notificationId - Notification ID
   * @returns {boolean} Success status
   */
  deleteNotification(userId, notificationId) {
    const userNotifications = this.notifications.get(userId) || [];
    const index = userNotifications.findIndex(n => n.id === notificationId);

    if (index === -1) {
      return false;
    }

    userNotifications.splice(index, 1);

    logger.debug('Notification deleted', {
      notificationId,
      userId
    });

    return true;
  }

  /**
   * Clear all notifications for a user
   * @param {string} userId - User ID
   * @returns {number} Number of notifications cleared
   */
  clearUserNotifications(userId) {
    const userNotifications = this.notifications.get(userId) || [];
    const count = userNotifications.length;

    this.notifications.set(userId, []);

    if (count > 0) {
      logger.info('User notifications cleared', {
        userId,
        clearedCount: count
      });
    }

    return count;
  }

  // SSE methods removed - using WebSocket instead (see src/services/websocketService.js)
  // subscribe(), unsubscribe(), sendRealTimeNotification() are no longer needed

  /**
   * Get notification statistics
   * @param {string} userId - User ID (optional, for specific user stats)
   * @returns {Object} Notification statistics
   */
  getNotificationStats(userId = null) {
    if (userId) {
      const userNotifications = this.notifications.get(userId) || [];
      const unreadCount = userNotifications.filter(n => !n.read).length;
      
      return {
        total: userNotifications.length,
        unread: unreadCount,
        read: userNotifications.length - unreadCount
        // isSubscribed removed - using WebSocket instead
      };
    }

    // Global stats
    let totalNotifications = 0;
    let totalUnread = 0;
    let totalUsers = 0;

    for (const [userId, notifications] of this.notifications.entries()) {
      totalUsers++;
      totalNotifications += notifications.length;
      totalUnread += notifications.filter(n => !n.read).length;
    }

    return {
      totalUsers,
      totalNotifications,
      totalUnread
      // totalSubscribers removed - using WebSocket instead
    };
  }

  /**
   * Clean up old notifications
   * @param {number} maxAge - Maximum age in milliseconds (default: 30 days)
   * @returns {number} Number of notifications cleaned up
   */
  cleanupOldNotifications(maxAge = 30 * 24 * 60 * 60 * 1000) {
    const cutoffTime = new Date(Date.now() - maxAge);
    let cleanedCount = 0;

    for (const [userId, notifications] of this.notifications.entries()) {
      const originalLength = notifications.length;
      
      // Keep only notifications newer than cutoff time
      const filtered = notifications.filter(n => n.createdAt > cutoffTime);
      
      if (filtered.length < originalLength) {
        this.notifications.set(userId, filtered);
        cleanedCount += originalLength - filtered.length;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Old notifications cleaned up', { cleanedCount });
    }

    return cleanedCount;
  }

  /**
   * Shutdown the notification service
   */
  shutdown() {
    // WebSocket connections are managed by websocketService.js
    logger.info('Notification service shutdown');
  }
}

// Create singleton instance
const notificationService = new NotificationService();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  notificationService.shutdown();
});

process.on('SIGINT', () => {
  notificationService.shutdown();
});

module.exports = {
  NotificationService,
  notificationService
};