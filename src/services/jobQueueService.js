/**
 * Job Queue Service
 * Manages background export jobs
 */

const { logger } = require('../utils/logger');

class JobQueueService {
  constructor() {
    this.jobs = new Map();
    this.exportService = null; // Will be set later to avoid circular dependency
    this.jobCounter = 0;
    this.maxJobs = 100;
    this.cleanupInterval = 60 * 60 * 1000; // 1 hour
    
    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Set export service (to avoid circular dependency)
   * @param {ExportService} exportService - Export service instance
   */
  setExportService(exportService) {
    this.exportService = exportService;
  }

  /**
   * Add export job to queue
   * @param {Object} jobData - Job data
   * @returns {string} Job ID
   */
  addExportJob(jobData) {
    const jobId = this.generateJobId();
    const job = {
      id: jobId,
      type: 'export',
      status: 'queued',
      progress: 0,
      data: jobData,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: jobData.userInfo?.userId,
      error: null,
      result: null
    };

    this.jobs.set(jobId, job);
    
    // Start processing immediately (simulate background processing)
    this.processJob(jobId);

    logger.info('Export job added to queue', {
      jobId,
      userId: job.userId,
      recordCount: jobData.matchResults?.length || 0
    });

    return jobId;
  }

  /**
   * Process a job
   * @param {string} jobId - Job ID
   */
  async processJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error('Job not found for processing', { jobId });
      return;
    }

    try {
      job.status = 'processing';
      job.progress = 10;
      job.updatedAt = new Date();

      logger.info('Starting job processing', {
        jobId,
        userId: job.userId,
        type: job.type
      });

      // Simulate processing time for large exports
      const recordCount = job.data.matchResults?.length || 0;
      const processingTime = Math.min(recordCount * 10, 5000); // Max 5 seconds

      // Update progress periodically
      const progressInterval = setInterval(() => {
        if (job.status === 'processing' && job.progress < 80) {
          job.progress += 10;
          job.updatedAt = new Date();
        }
      }, processingTime / 8);

      // Wait for simulated processing time
      await new Promise(resolve => setTimeout(resolve, processingTime));
      clearInterval(progressInterval);

      // Process the actual export
      job.progress = 80;
      
      if (!this.exportService) {
        // Lazy load to avoid circular dependency
        const { ExportService } = require('./exportService');
        this.exportService = new ExportService();
      }
      
      const result = await this.exportService.generateExcelExportWithAccessControl(
        job.data.matchResults,
        {
          ...job.data.exportOptions,
          exportScope: 'search_results'
        },
        job.data.userInfo
      );

      job.status = 'completed';
      job.progress = 100;
      job.result = result;
      job.updatedAt = new Date();

      logger.info('Job completed successfully', {
        jobId,
        userId: job.userId,
        exportId: result.exportId,
        recordCount: result.recordCount
      });

    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date();

      logger.error('Job processing failed', {
        jobId,
        userId: job.userId,
        error: error.message
      });
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Object|null} Job status
   */
  getJobStatus(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      result: job.result ? {
        exportId: job.result.exportId,
        filename: job.result.filename,
        recordCount: job.result.recordCount,
        fileSize: job.result.fileSize,
        downloadUrl: job.result.downloadUrl,
        expiresAt: job.result.expiresAt
      } : null
    };
  }

  /**
   * Get user's jobs
   * @param {string} userId - User ID
   * @returns {Array} User's jobs
   */
  getUserJobs(userId) {
    const userJobs = [];
    
    for (const job of this.jobs.values()) {
      if (job.userId === userId) {
        userJobs.push(this.getJobStatus(job.id));
      }
    }

    return userJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Cancel a job
   * @param {string} jobId - Job ID
   * @param {string} userId - User ID (for access control)
   * @returns {boolean} True if cancelled
   */
  cancelJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    
    if (!job || job.userId !== userId) {
      return false;
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return false; // Cannot cancel completed or failed jobs
    }

    job.status = 'cancelled';
    job.updatedAt = new Date();

    logger.info('Job cancelled by user', {
      jobId,
      userId
    });

    return true;
  }

  /**
   * Get queue statistics
   * @returns {Object} Queue statistics
   */
  getQueueStats() {
    const stats = {
      totalJobs: this.jobs.size,
      queuedJobs: 0,
      processingJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      cancelledJobs: 0
    };

    for (const job of this.jobs.values()) {
      switch (job.status) {
        case 'queued':
          stats.queuedJobs++;
          break;
        case 'processing':
          stats.processingJobs++;
          break;
        case 'completed':
          stats.completedJobs++;
          break;
        case 'failed':
          stats.failedJobs++;
          break;
        case 'cancelled':
          stats.cancelledJobs++;
          break;
      }
    }

    return stats;
  }

  /**
   * Clean up old jobs
   * @returns {number} Number of jobs cleaned up
   */
  cleanupOldJobs() {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    let cleanedCount = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      const jobAge = now - job.createdAt.getTime();
      
      if (jobAge > maxAge && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
        this.jobs.delete(jobId);
        cleanedCount++;
      }
    }

    // Also enforce max jobs limit
    if (this.jobs.size > this.maxJobs) {
      const sortedJobs = Array.from(this.jobs.entries())
        .sort(([, a], [, b]) => a.createdAt - b.createdAt);
      
      const jobsToRemove = sortedJobs.slice(0, this.jobs.size - this.maxJobs);
      jobsToRemove.forEach(([jobId]) => {
        this.jobs.delete(jobId);
        cleanedCount++;
      });
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old jobs', { cleanedCount });
    }

    return cleanedCount;
  }

  /**
   * Start cleanup timer
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupOldJobs();
    }, this.cleanupInterval);
  }

  /**
   * Generate unique job ID
   * @returns {string} Job ID
   */
  generateJobId() {
    this.jobCounter++;
    const timestamp = Date.now();
    return `job_${timestamp}_${this.jobCounter}`;
  }

  /**
   * Get all jobs (admin only)
   * @returns {Array} All jobs
   */
  getAllJobs() {
    const allJobs = [];
    
    for (const job of this.jobs.values()) {
      allJobs.push(this.getJobStatus(job.id));
    }

    return allJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Retry a failed job
   * @param {string} jobId - Job ID
   * @param {string} userId - User ID (for access control)
   * @returns {boolean} True if retried
   */
  retryJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    
    if (!job || job.userId !== userId || job.status !== 'failed') {
      return false;
    }

    job.status = 'queued';
    job.progress = 0;
    job.error = null;
    job.result = null;
    job.updatedAt = new Date();

    // Start processing again
    this.processJob(jobId);

    logger.info('Job retried by user', {
      jobId,
      userId
    });

    return true;
  }
}

// Create singleton instance
const jobQueueService = new JobQueueService();

module.exports = {
  JobQueueService,
  jobQueueService
};