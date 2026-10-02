const Task = require('../models/Task');
const TaskComment = require('../models/TaskComment');
const TaskResult = require('../models/TaskResult');
const User = require('../models/User');
const ExpertGroup = require('../models/ExpertGroup');
const { logger } = require('../utils/logger');
const { query } = require('../config/database');

class TaskCollaborationService {
    /**
     * Add comment to task with visibility validation
     * @param {UUID} taskId - Task ID
     * @param {UUID} userId - User ID
     * @param {string} comment - Comment text
     * @returns {Promise<TaskComment>} Created comment
     */
    async addComment(taskId, userId, comment) {
        try {
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Task not found');
            }

            // Validate user can comment on task
            const canComment = await this.canUserAccessTask(userId, taskId);
            if (!canComment) {
                throw new Error('User cannot comment on this task');
            }

            const taskComment = await TaskComment.create({
                task_id: taskId,
                user_id: userId,
                comment: comment
            });

            // Notify relevant users about new comment
            await this.notifyTaskUpdate(task, 'comment_added', userId, {
                comment_id: taskComment.id,
                comment_preview: comment.substring(0, 100)
            });

            logger.info(`Comment added to task ${taskId} by user ${userId}`);
            return taskComment;
        } catch (error) {
            logger.error('Error adding task comment:', error);
            throw error;
        }
    }

    /**
     * Add result to task with expert group visibility
     * @param {UUID} taskId - Task ID
     * @param {UUID} userId - User ID
     * @param {Object} resultData - Analysis result data
     * @param {Object} analysisMetadata - Analysis metadata
     * @returns {Promise<TaskResult>} Created result
     */
    async addResult(taskId, userId, resultData, analysisMetadata = {}) {
        try {
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Task not found');
            }

            // Validate user can add results to task
            const canAddResult = await this.canUserAccessTask(userId, taskId);
            if (!canAddResult) {
                throw new Error('User cannot add results to this task');
            }

            const taskResult = await TaskResult.create({
                task_id: taskId,
                user_id: userId,
                result_data: resultData,
                analysis_metadata: analysisMetadata
            });

            // Notify relevant users about new result
            await this.notifyTaskUpdate(task, 'result_added', userId, {
                result_id: taskResult.id,
                analysis_type: analysisMetadata.analysis_type || 'unknown'
            });

            logger.info(`Result added to task ${taskId} by user ${userId}`);
            return taskResult;
        } catch (error) {
            logger.error('Error adding task result:', error);
            throw error;
        }
    }

    /**
     * Get task collaboration data (comments and results)
     * @param {UUID} taskId - Task ID
     * @param {UUID} requesterId - ID of user requesting data
     * @returns {Promise<Object>} Collaboration data
     */
    async getTaskCollaboration(taskId, requesterId) {
        try {
            const task = await Task.findById(taskId);
            if (!task) {
                throw new Error('Task not found');
            }

            // Validate user can access task
            const canAccess = await this.canUserAccessTask(requesterId, taskId);
            if (!canAccess) {
                throw new Error('User cannot access this task');
            }

            const [comments, results, participants] = await Promise.all([
                TaskComment.findByTaskId(taskId),
                TaskResult.findByTaskId(taskId),
                this.getTaskParticipants(taskId)
            ]);

            return {
                task: task.toJSON(),
                comments: comments.map(comment => comment.toJSON()),
                results: results.map(result => result.toJSON()),
                participants: participants,
                collaboration_stats: await this.getCollaborationStats(taskId)
            };
        } catch (error) {
            logger.error('Error getting task collaboration:', error);
            throw error;
        }
    }

    /**
     * Get task participants (assignees and expert group members)
     * @param {UUID} taskId - Task ID
     * @returns {Promise<Object[]>} Array of participants
     */
    async getTaskParticipants(taskId) {
        try {
            // Get task details first
            const taskResult = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
            if (taskResult.rows.length === 0) {
                return [];
            }
            
            const task = taskResult.rows[0];
            const participants = [];

            // Add task creator
            if (task.created_by) {
                const creatorResult = await query(
                    'SELECT id, username, email, role FROM users WHERE id = $1 AND is_active = true',
                    [task.created_by]
                );
                if (creatorResult.rows.length > 0) {
                    participants.push({
                        ...creatorResult.rows[0],
                        participation_type: 'creator',
                        expert_group_name: null
                    });
                }
            }

            // Add direct assignee if exists
            if (task.assigned_to_user) {
                const assigneeResult = await query(
                    'SELECT id, username, email, role FROM users WHERE id = $1 AND is_active = true',
                    [task.assigned_to_user]
                );
                if (assigneeResult.rows.length > 0) {
                    participants.push({
                        ...assigneeResult.rows[0],
                        participation_type: 'direct_assignee',
                        expert_group_name: null
                    });
                }
            }

            // Add expert group members if task is assigned to group
            if (task.assigned_to_group) {
                const groupMembersResult = await query(
                    `SELECT u.id, u.username, u.email, u.role, eg.name as expert_group_name
                     FROM users u
                     JOIN expert_group_members egm ON u.id = egm.user_id
                     JOIN expert_groups eg ON egm.group_id = eg.id
                     WHERE eg.id = $1 AND u.is_active = true AND eg.is_active = true`,
                    [task.assigned_to_group]
                );
                
                for (const member of groupMembersResult.rows) {
                    // Avoid duplicates (user might be both creator and group member)
                    if (!participants.find(p => p.id === member.id)) {
                        participants.push({
                            ...member,
                            participation_type: 'group_member'
                        });
                    }
                }
            }

            return participants;
        } catch (error) {
            logger.error('Error getting task participants:', error);
            return [];
        }
    }

    /**
     * Get collaboration statistics for a task
     * @param {UUID} taskId - Task ID
     * @returns {Promise<Object>} Collaboration statistics
     */
    async getCollaborationStats(taskId) {
        try {
            const result = await query(
                `SELECT 
                    COUNT(DISTINCT tc.id) as total_comments,
                    COUNT(DISTINCT tr.id) as total_results,
                    COUNT(DISTINCT tc.user_id) as unique_commenters,
                    COUNT(DISTINCT tr.user_id) as unique_contributors,
                    MAX(tc.created_at) as last_comment_at,
                    MAX(tr.created_at) as last_result_at
                FROM tasks t
                LEFT JOIN task_comments tc ON tc.task_id = t.id AND tc.is_active = true
                LEFT JOIN task_results tr ON tr.task_id = t.id AND tr.is_active = true
                WHERE t.id = $1`,
                [taskId]
            );

            const stats = result.rows[0];
            return {
                total_comments: parseInt(stats.total_comments) || 0,
                total_results: parseInt(stats.total_results) || 0,
                unique_commenters: parseInt(stats.unique_commenters) || 0,
                unique_contributors: parseInt(stats.unique_contributors) || 0,
                last_activity_at: stats.last_comment_at > stats.last_result_at 
                    ? stats.last_comment_at 
                    : stats.last_result_at,
                collaboration_level: this.calculateCollaborationLevel(stats)
            };
        } catch (error) {
            logger.error('Error getting collaboration stats:', error);
            return {
                total_comments: 0,
                total_results: 0,
                unique_commenters: 0,
                unique_contributors: 0,
                last_activity_at: null,
                collaboration_level: 'none'
            };
        }
    }

    /**
     * Calculate collaboration level based on activity
     * @param {Object} stats - Collaboration statistics
     * @returns {string} Collaboration level
     */
    calculateCollaborationLevel(stats) {
        const totalActivity = parseInt(stats.total_comments) + parseInt(stats.total_results);
        const uniqueUsers = Math.max(parseInt(stats.unique_commenters), parseInt(stats.unique_contributors));

        if (totalActivity === 0) return 'none';
        if (totalActivity < 3 || uniqueUsers < 2) return 'low';
        if (totalActivity < 10 || uniqueUsers < 3) return 'medium';
        return 'high';
    }

    /**
     * Check if user can access task (for comments and results)
     * @param {UUID} userId - User ID
     * @param {UUID} taskId - Task ID
     * @returns {Promise<boolean>} Access permission
     */
    async canUserAccessTask(userId, taskId) {
        try {
            const user = await User.findById(userId);
            const task = await Task.findById(taskId);

            if (!user || !task) {
                return false;
            }

            // System administrators can access all tasks
            if (user.role === 'system_administrator') {
                return true;
            }

            // Department heads can access all tasks in their department
            if (user.role === 'department_head' && user.department_id === task.department_id) {
                return true;
            }

            // Users can access tasks assigned to them
            if (task.assigned_to_user === userId) {
                return true;
            }

            // Users can access tasks assigned to their expert groups
            if (task.assigned_to_group) {
                const userGroups = await user.getExpertGroups();
                const groupIds = userGroups.map(group => group.id);
                if (groupIds.includes(task.assigned_to_group)) {
                    return true;
                }
            }

            // Task creators can access their tasks
            if (task.created_by === userId) {
                return true;
            }

            return false;
        } catch (error) {
            logger.error('Error checking task access:', error);
            return false;
        }
    }

    /**
     * Get expert group shared results for a task
     * @param {UUID} taskId - Task ID
     * @param {UUID} groupId - Expert group ID
     * @returns {Promise<Object[]>} Shared results
     */
    async getGroupSharedResults(taskId, groupId) {
        try {
            const result = await query(
                `SELECT tr.*, u.username, u.email as user_email
                 FROM task_results tr
                 JOIN users u ON tr.user_id = u.id
                 JOIN expert_group_members egm ON egm.user_id = u.id
                 WHERE tr.task_id = $1 
                   AND egm.group_id = $2 
                   AND egm.is_active = true
                   AND tr.is_active = true
                 ORDER BY tr.created_at DESC`,
                [taskId, groupId]
            );

            return result.rows.map(row => new TaskResult(row));
        } catch (error) {
            logger.error('Error getting group shared results:', error);
            return [];
        }
    }

    /**
     * Update comment with edit history
     * @param {UUID} commentId - Comment ID
     * @param {UUID} userId - User ID
     * @param {string} newComment - Updated comment text
     * @returns {Promise<TaskComment>} Updated comment
     */
    async updateComment(commentId, userId, newComment) {
        try {
            const comment = await TaskComment.findById(commentId);
            if (!comment) {
                throw new Error('Comment not found');
            }

            const canEdit = await comment.canUserEdit(userId);
            if (!canEdit) {
                throw new Error('User cannot edit this comment');
            }

            // Store edit history
            await this.storeCommentEditHistory(commentId, comment.comment, userId);

            const updatedComment = await comment.update({ comment: newComment });

            logger.info(`Comment ${commentId} updated by user ${userId}`);
            return updatedComment;
        } catch (error) {
            logger.error('Error updating comment:', error);
            throw error;
        }
    }

    /**
     * Store comment edit history
     * @param {UUID} commentId - Comment ID
     * @param {string} previousComment - Previous comment text
     * @param {UUID} editedBy - User who edited
     */
    async storeCommentEditHistory(commentId, previousComment, editedBy) {
        try {
            await query(
                `INSERT INTO comment_edit_history (comment_id, previous_comment, edited_by, edited_at)
                 VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
                [commentId, previousComment, editedBy]
            );
        } catch (error) {
            // Non-critical error - log but don't throw
            logger.warn('Failed to store comment edit history:', error);
        }
    }

    /**
     * Notify users about task updates
     * @param {Task} task - Task object
     * @param {string} updateType - Type of update
     * @param {UUID} userId - User who made the update
     * @param {Object} metadata - Additional metadata
     */
    async notifyTaskUpdate(task, updateType, userId, metadata = {}) {
        try {
            const participants = await this.getTaskParticipants(task.id);
            
            // Filter out the user who made the update
            const notifyUsers = participants.filter(p => p.id !== userId);

            for (const user of notifyUsers) {
                // Implementation would depend on notification service
                logger.info(`Notification: ${updateType} on task "${task.title}" for user ${user.username}`);
                
                // TODO: Integrate with notification service when available
                // await NotificationService.sendTaskUpdateNotification(user.id, task, updateType, metadata);
            }
        } catch (error) {
            logger.error('Error sending task update notifications:', error);
        }
    }

    /**
     * Get task activity timeline
     * @param {UUID} taskId - Task ID
     * @param {UUID} requesterId - ID of user requesting timeline
     * @returns {Promise<Object[]>} Activity timeline
     */
    async getTaskActivityTimeline(taskId, requesterId) {
        try {
            // Validate access
            const canAccess = await this.canUserAccessTask(requesterId, taskId);
            if (!canAccess) {
                throw new Error('User cannot access this task');
            }

            const result = await query(
                `SELECT 
                    'comment' as activity_type,
                    tc.id as activity_id,
                    tc.user_id,
                    u.username,
                    tc.comment as content,
                    tc.created_at as activity_time
                FROM task_comments tc
                JOIN users u ON tc.user_id = u.id
                WHERE tc.task_id = $1 AND tc.is_active = true
                
                UNION ALL
                
                SELECT 
                    'result' as activity_type,
                    tr.id as activity_id,
                    tr.user_id,
                    u.username,
                    'Analysis result added' as content,
                    tr.created_at as activity_time
                FROM task_results tr
                JOIN users u ON tr.user_id = u.id
                WHERE tr.task_id = $1 AND tr.is_active = true
                
                UNION ALL
                
                SELECT 
                    'status_change' as activity_type,
                    al.id as activity_id,
                    al.user_id,
                    u.username,
                    al.details->>'new_status' as content,
                    al.timestamp as activity_time
                FROM audit_log al
                JOIN users u ON al.user_id = u.id
                WHERE al.resource_type = 'task' 
                  AND al.resource_id = $1::text
                  AND al.action = 'status_update'
                
                ORDER BY activity_time DESC`,
                [taskId]
            );

            return result.rows;
        } catch (error) {
            logger.error('Error getting task activity timeline:', error);
            return [];
        }
    }
}

module.exports = new TaskCollaborationService();