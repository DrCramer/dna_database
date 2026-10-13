const express = require('express');
const { authenticate, adminOrAnalyst } = require('../middleware/auth');
const { ExportService } = require('../services/exportService');
const { jobQueueService } = require('../services/jobQueueService');
const { logger } = require('../utils/logger');
const Joi = require('joi');
const { query } = require('../config/database');
const DNAProfile = require('../models/DNAProfile');
const { ProfileAccessService } = require('../services/profileAccessService');
const { DuplicateExcelExportService, XLSX_MIME } = require('../services/duplicateExcelExportService');
const { getSearchSnapshots, profileFingerprint } = require('../services/searchSnapshotStore');
const { resolveProfileImportFormat } = require('../utils/profileImportFormat');
const { normalizeMatchColors } = require('../utils/locusComparisonPresentation');

const router = express.Router();
const exportService = new ExportService();
const duplicateExcelExportService = new DuplicateExcelExportService();

const duplicateExcelRequestSchema = Joi.object({
  snapshotIds: Joi.array().items(Joi.string().guid({ version: ['uuidv4', 'uuidv5'] })).min(1).max(20).required(),
  options: Joi.object({
    scope: Joi.string().valid('all', 'reference').default('all'),
    referenceKey: Joi.string().max(200).allow(null, ''),
    includeReferences: Joi.boolean().default(true),
    includeHighlights: Joi.boolean().default(true),
    highlightAlleles: Joi.boolean().default(true),
    includeComparisons: Joi.boolean().default(true),
    includeAnalysis: Joi.boolean().default(true),
    locusMode: Joi.string().valid('all', 'visible').default('all'),
    visibleLoci: Joi.array().items(Joi.string().max(100)).max(500).default([]),
    colors: Joi.object({
      fullMatch: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/),
      partialMatch: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/),
      partialMatchAllele: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/),
      noMatch: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/)
    }).default({})
  }).default({})
});
const MAX_DUPLICATE_EXPORT_CELLS = 2_000_000;

/**
 * Export a server-held, short-lived search snapshot. Genotypes and match details
 * are never accepted from the browser; database records are reloaded in scope.
 */
router.post('/duplicates/excel', authenticate, async (req, res) => {
  try {
    const { error, value } = duplicateExcelRequestSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: 'Проверьте настройки экспорта и повторите попытку.' });

    const activeDepartmentId = req.activeDepartmentId || req.user.department_id || null;
    const snapshots = getSearchSnapshots(value.snapshotIds, { userId: req.user.id, departmentId: activeDepartmentId });
    const options = value.options;
    const pairs = snapshots.flatMap(snapshot => snapshot.pairs.map(pair => ({
      ...pair,
      ignoredLoci: snapshot.settings.ignoredLoci || []
    })));
    const selectedPairs = options.scope === 'reference'
      ? pairs.filter(pair => pair.referenceKey === options.referenceKey)
      : pairs;
    if (!selectedPairs.length) return res.status(400).json({ message: 'Нет найденных дубликатов для выгрузки.' });
    if (selectedPairs.length > 20000) {
      return res.status(413).json({ message: 'Слишком много пар для формирования одного файла (максимум 20 000). Выберите группу одного эталона и повторите экспорт.' });
    }
    const availableLoci = new Set(snapshots.flatMap(snapshot => snapshot.locusNames || []));
    const locusCount = options.locusMode === 'visible'
      ? options.visibleLoci.filter(locus => availableLoci.has(locus)).length
      : availableLoci.size;
    if (selectedPairs.length * Math.max(1, locusCount) * 2 > MAX_DUPLICATE_EXPORT_CELLS) {
      return res.status(413).json({ message: 'Отчёт превышает безопасный размер одного XLSX. Выберите группу одного эталона или только отображаемые локусы.' });
    }

    const profileIds = [...new Set(selectedPairs.flatMap(pair => [pair.referenceProfileId, pair.matchedProfileId]).filter(Boolean))];
    if (profileIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      return res.status(400).json({ message: 'Невозможно восстановить корректные данные поиска. Выполните поиск заново.' });
    }

    const scope = await ProfileAccessService.getScope({
      userId: req.user.id,
      activeDepartmentId,
      action: 'read'
    });
    let authorizedProfiles = [];
    if (profileIds.length) {
      const idParam = scope.params.length + 1;
      const result = await query(`SELECT dp.* FROM dna_profiles dp WHERE dp.id = ANY($${idParam}::uuid[]) AND ${scope.clause}`, [...scope.params, profileIds]);
      authorizedProfiles = await DNAProfile.fromRows(result.rows);
    }
    const profilesById = new Map(authorizedProfiles.map(profile => [profile.id, profile]));
    if (profilesById.size !== profileIds.length) {
      return res.status(403).json({ message: 'Нет доступа к выбранным профилям.' });
    }

    const fingerprintMismatch = snapshots.some(snapshot => Object.entries(snapshot.profileFingerprints)
      .some(([id, fingerprint]) => selectedPairs.some(pair => pair.referenceProfileId === id || pair.matchedProfileId === id) &&
        (!profilesById.has(id) || profileFingerprint(profilesById.get(id)) !== fingerprint)));
    if (fingerprintMismatch) {
      return res.status(409).json({ message: 'Данные профилей изменились после поиска. Повторите анализ, чтобы экспорт соответствовал найденным результатам.' });
    }

    const hydratedPairs = selectedPairs.map(pair => ({
      ...pair,
      reference: pair.referenceProfileId ? profilesById.get(pair.referenceProfileId) : pair.reference,
      matched: profilesById.get(pair.matchedProfileId)
    }));
    const colors = options.colors || {};
    const mergedColors = normalizeMatchColors({ ...snapshots[0].settings.colors, ...colors });
    const departmentResult = await query('SELECT name FROM departments WHERE id = $1 AND is_active = true', [activeDepartmentId]);
    const format = resolveProfileImportFormat({ name: departmentResult.rows[0]?.name });
    const metadata = {
      importFormat: format || 'emergency',
      departmentName: departmentResult.rows[0]?.name || '',
      searchModes: [...new Set(snapshots.map(snapshot => snapshot.searchMode))],
      searchedAt: snapshots.map(snapshot => snapshot.createdAt).sort((a, b) => a - b)[0]?.toISOString(),
      minMatches: snapshots[0].settings.minMatches,
      duplicateSettings: snapshots[0].settings.duplicateSettings
    };
    const buffer = await duplicateExcelExportService.createWorkbookBuffer({
      comparisons: hydratedPairs.map(pair => ({
        reference: pair.reference,
        matched: pair.matched,
        matchedLoci: pair.matchedLoci,
        details: pair.details,
        algorithm: pair.algorithm,
        matchCount: pair.matchCount,
        totalLoci: pair.totalLoci,
        matchPercentage: pair.matchPercentage,
        totalScore: pair.totalScore,
        ignoredLoci: pair.ignoredLoci
      })),
      metadata,
      options: { ...options, colors: mergedColors }
    });

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').slice(0, 13);
    const filename = `Дубликаты_${(departmentResult.rows[0]?.name || 'отделение').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40)}_${stamp}.xlsx`;
    logger.info('Duplicate XLSX export generated', {
      userId: req.user.id,
      departmentId: activeDepartmentId,
      pairCount: selectedPairs.length,
      profileCount: profilesById.size,
      snapshotCount: snapshots.length
    });
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="dna-duplicates.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    logger.error('Duplicate XLSX export failed', { userId: req.user?.id, error: error.message });
    return res.status(error.status || 500).json({ message: error.message || 'Не удалось сформировать Excel-файл.' });
  }
});

// Configuration for large export threshold
const LARGE_EXPORT_THRESHOLD = 1000; // Records

// Validation schemas
const exportRequestSchema = Joi.object({
  matchResults: Joi.array().items(Joi.object({
    matchedProfile: Joi.object({
      id: Joi.string().required(),
      sampleName: Joi.string().required(),
      uploadDate: Joi.date(),
      userId: Joi.string(),
      departmentId: Joi.string().optional(),
      organizationId: Joi.string().optional()
    }).required(),
    overallMatch: Joi.number().min(0).max(100).required(),
    numericMatchCount: Joi.number().integer().min(0).required(),
    totalComparisons: Joi.number().integer().min(0).required(),
    passesThreshold: Joi.boolean().required(),
    likelihoodRatio: Joi.number().optional(), // LR value
    lrSignificance: Joi.string().optional(), // LR significance level
    locusMatches: Joi.object().optional(),
    analysisDate: Joi.date().optional(),
    organizationalContext: Joi.object({
      department: Joi.string().optional(),
      organization: Joi.string().optional(),
      userRole: Joi.string().optional()
    }).optional()
  })).required(),
  exportOptions: Joi.object({
    includeProfileDetails: Joi.boolean().default(true),
    includeLocusDetails: Joi.boolean().default(true),
    includeMetadata: Joi.boolean().default(true),
    includeLRValues: Joi.boolean().default(true), // Include LR values
    includeOrganizationalContext: Joi.boolean().default(true), // Include organizational data
    filename: Joi.string().optional(),
    forceBackground: Joi.boolean().default(false) // Force background processing
  }).default({}),
  searchInfo: Joi.object({
    targetProfile: Joi.object().optional(),
    options: Joi.object().optional(),
    organizationalContext: Joi.object().optional() // Organizational search context
  }).default({})
});

/**
 * POST /api/export/excel
 * Generate Excel export from match results
 * Automatically uses background processing for large datasets
 */
router.post('/excel', authenticate, adminOrAnalyst, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = exportRequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map(detail => detail.message)
      });
    }

    const { matchResults, exportOptions, searchInfo } = value;

    // Check if there are results to export
    if (!matchResults || matchResults.length === 0) {
      return res.status(400).json({
        error: 'No Results',
        message: 'No match results provided for export'
      });
    }

    // Prepare user info for logging
    const userInfo = {
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    };

    // Determine if we should use background processing
    const isLargeExport = matchResults.length > LARGE_EXPORT_THRESHOLD;
    const useBackground = isLargeExport || exportOptions.forceBackground;

    if (useBackground) {
      // Use background processing for large exports
      const jobId = jobQueueService.addExportJob({
        matchResults,
        exportOptions,
        userInfo,
        searchInfo
      });

      logger.info('Large export queued for background processing', {
        userId: req.user.id,
        jobId,
        recordCount: matchResults.length
      });

      res.json({
        success: true,
        backgroundProcessing: true,
        job: {
          jobId,
          status: 'queued',
          recordCount: matchResults.length,
          estimatedTime: Math.ceil(matchResults.length / 100) + ' seconds', // Rough estimate
          statusUrl: `/api/export/job/${jobId}`,
          message: 'Export is being processed in the background. You will be notified when it\'s ready.'
        }
      });

    } else {
      // Process immediately for smaller exports
      const exportResult = await exportService.generateExcelExportWithAccessControl(
        matchResults,
        {
          ...exportOptions,
          exportScope: 'search_results'
        },
        userInfo
      );

      logger.info('Excel export completed immediately', {
        userId: req.user.id,
        exportId: exportResult.exportId,
        recordCount: matchResults.length
      });

      res.json({
        success: true,
        backgroundProcessing: false,
        export: {
          exportId: exportResult.exportId,
          filename: exportResult.filename,
          recordCount: exportResult.recordCount,
          fileSize: exportResult.fileSize,
          downloadUrl: exportResult.downloadUrl,
          expiresAt: exportResult.expiresAt,
          createdAt: exportResult.createdAt
        }
      });
    }

  } catch (error) {
    logger.error('Error processing Excel export request', {
      error: error.message,
      userId: req.user?.id,
      stack: error.stack
    });

    res.status(500).json({
      error: 'Export Failed',
      message: 'Failed to generate Excel export',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/export/job/:jobId
 * Get background job status
 */
router.get('/job/:jobId', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: 'Missing Job ID',
        message: 'Job ID is required'
      });
    }

    const jobStatus = jobQueueService.getJobStatus(jobId);

    if (!jobStatus) {
      return res.status(404).json({
        error: 'Job Not Found',
        message: 'Export job not found or has expired'
      });
    }

    // Check if user has access to this job (users can only see their own jobs)
    const userJobs = jobQueueService.getUserJobs(req.user.id);
    const hasAccess = userJobs.some(job => job.id === jobId);

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You do not have access to this export job'
      });
    }

    res.json({
      success: true,
      job: jobStatus
    });

  } catch (error) {
    logger.error('Error getting job status', {
      error: error.message,
      jobId: req.params.jobId,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Status Check Failed',
      message: 'Failed to check job status'
    });
  }
});

/**
 * GET /api/export/jobs
 * Get user's export jobs
 */
router.get('/jobs', authenticate, async (req, res) => {
  try {
    const userJobs = jobQueueService.getUserJobs(req.user.id);

    res.json({
      success: true,
      jobs: userJobs,
      total: userJobs.length
    });

  } catch (error) {
    logger.error('Error getting user jobs', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Jobs Retrieval Failed',
      message: 'Failed to retrieve export jobs'
    });
  }
});

/**
 * DELETE /api/export/job/:jobId
 * Cancel a background job
 */
router.delete('/job/:jobId', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: 'Missing Job ID',
        message: 'Job ID is required'
      });
    }

    const cancelled = jobQueueService.cancelJob(jobId, req.user.id);

    if (!cancelled) {
      return res.status(404).json({
        error: 'Cancellation Failed',
        message: 'Job not found, already completed, or access denied'
      });
    }

    logger.info('Export job cancelled by user', {
      jobId,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Export job cancelled successfully'
    });

  } catch (error) {
    logger.error('Error cancelling job', {
      error: error.message,
      jobId: req.params.jobId,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Cancellation Failed',
      message: 'Failed to cancel export job'
    });
  }
});

/**
 * POST /api/export/department
 * Export department data with organizational context
 */
router.post('/department', authenticate, adminOrAnalyst, async (req, res) => {
  try {
    const exportOptions = req.body.exportOptions || {};
    
    // Validate export options
    const validationSchema = Joi.object({
      includeUserProfiles: Joi.boolean().default(true),
      includeMasterArray: Joi.boolean().default(true),
      includeSearchHistory: Joi.boolean().default(false),
      includeAuditTrail: Joi.boolean().default(false),
      includeLRValues: Joi.boolean().default(true),
      includeOrganizationalContext: Joi.boolean().default(true),
      dateRange: Joi.object({
        startDate: Joi.date(),
        endDate: Joi.date()
      }).optional(),
      filename: Joi.string().optional()
    });

    const { error, value } = validationSchema.validate(exportOptions);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map(detail => detail.message)
      });
    }

    // Generate department export
    const exportResult = await exportService.exportDepartmentData(req.user.id, value);

    logger.info('Department data export completed', {
      userId: req.user.id,
      exportId: exportResult.exportId,
      recordCount: exportResult.recordCount
    });

    res.json({
      success: true,
      export: {
        exportId: exportResult.exportId,
        filename: exportResult.filename,
        recordCount: exportResult.recordCount,
        fileSize: exportResult.fileSize,
        downloadUrl: exportResult.downloadUrl,
        expiresAt: exportResult.expiresAt,
        createdAt: exportResult.createdAt,
        exportScope: 'department_data'
      }
    });

  } catch (error) {
    logger.error('Error processing department export request', {
      error: error.message,
      userId: req.user?.id,
      stack: error.stack
    });

    res.status(500).json({
      error: 'Export Failed',
      message: 'Failed to generate department export',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/export/audit
 * Export audit trail with organizational context
 */
router.post('/audit', authenticate, adminOrAnalyst, async (req, res) => {
  try {
    // Only department heads and system administrators can export audit trails
    if (!['department_head', 'system_administrator'].includes(req.user.role)) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Insufficient permissions to export audit trail'
      });
    }

    const auditOptions = req.body.auditOptions || {};
    
    // Validate audit options
    const validationSchema = Joi.object({
      dateRange: Joi.object({
        startDate: Joi.date(),
        endDate: Joi.date()
      }).optional(),
      operationTypes: Joi.array().items(Joi.string()).default([]),
      includeUserDetails: Joi.boolean().default(true),
      departmentScope: Joi.boolean().default(true),
      includeOrganizationalContext: Joi.boolean().default(true),
      filename: Joi.string().optional()
    });

    const { error, value } = validationSchema.validate(auditOptions);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map(detail => detail.message)
      });
    }

    // Generate audit export
    const exportResult = await exportService.exportAuditTrail(req.user.id, value);

    logger.info('Audit trail export completed', {
      userId: req.user.id,
      exportId: exportResult.exportId,
      recordCount: exportResult.recordCount
    });

    res.json({
      success: true,
      export: {
        exportId: exportResult.exportId,
        filename: exportResult.filename,
        recordCount: exportResult.recordCount,
        fileSize: exportResult.fileSize,
        downloadUrl: exportResult.downloadUrl,
        expiresAt: exportResult.expiresAt,
        createdAt: exportResult.createdAt,
        exportScope: 'audit_trail'
      }
    });

  } catch (error) {
    logger.error('Error processing audit export request', {
      error: error.message,
      userId: req.user?.id,
      stack: error.stack
    });

    res.status(500).json({
      error: 'Export Failed',
      message: 'Failed to generate audit export',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/export/pdf
 * Generate PDF export from match results
 */
router.post('/pdf', authenticate, adminOrAnalyst, async (req, res) => {
  try {
    // Validate request body using the same schema as Excel export
    const { error, value } = exportRequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map(detail => detail.message)
      });
    }

    const { matchResults, exportOptions, searchInfo } = value;

    // Check if there are results to export
    if (!matchResults || matchResults.length === 0) {
      return res.status(400).json({
        error: 'No Results',
        message: 'No match results provided for export'
      });
    }

    // Prepare user info for logging
    const userInfo = {
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    };

    // Generate PDF export (always immediate processing for PDFs)
    const exportResult = await exportService.generatePDFExportWithAccessControl(
      matchResults,
      {
        ...exportOptions,
        exportScope: 'search_results'
      },
      userInfo
    );

    logger.info('PDF export completed', {
      userId: req.user.id,
      exportId: exportResult.exportId,
      recordCount: matchResults.length
    });

    res.json({
      success: true,
      export: {
        exportId: exportResult.exportId,
        filename: exportResult.filename,
        recordCount: exportResult.recordCount,
        fileSize: exportResult.fileSize,
        downloadUrl: exportResult.downloadUrl,
        expiresAt: exportResult.expiresAt,
        createdAt: exportResult.createdAt,
        format: 'pdf'
      }
    });

  } catch (error) {
    logger.error('Error processing PDF export request', {
      error: error.message,
      userId: req.user?.id,
      stack: error.stack
    });

    res.status(500).json({
      error: 'Export Failed',
      message: 'Failed to generate PDF export',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/export/download/:exportId
 * Download generated export file
 */
router.get('/download/:exportId', authenticate, async (req, res) => {
  try {
    const { exportId } = req.params;

    if (!exportId) {
      return res.status(400).json({
        error: 'Missing Export ID',
        message: 'Export ID is required'
      });
    }

    // Get export file
    const fileInfo = await exportService.getExportFile(exportId);

    logger.info('Export file download requested', {
      userId: req.user.id,
      exportId,
      filename: fileInfo.filename
    });

    // Set headers for file download
    res.setHeader('Content-Type', fileInfo.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.filename}"`);
    res.setHeader('Content-Length', fileInfo.size);

    // Stream file to response
    const fs = require('fs');
    const fileStream = fs.createReadStream(fileInfo.filePath);
    
    fileStream.on('error', (error) => {
      logger.error('Error streaming export file', {
        error: error.message,
        exportId,
        userId: req.user.id
      });
      
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Download Failed',
          message: 'Failed to download export file'
        });
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    logger.error('Error processing export download', {
      error: error.message,
      exportId: req.params.exportId,
      userId: req.user?.id
    });

    if (error.message.includes('not found') || error.message.includes('expired')) {
      res.status(404).json({
        error: 'Export Not Found',
        message: error.message
      });
    } else {
      res.status(500).json({
        error: 'Download Failed',
        message: 'Failed to process download request'
      });
    }
  }
});

/**
 * GET /api/export/stats
 * Get export statistics (admin only)
 */
router.get('/stats', authenticate, adminOrAnalyst, async (req, res) => {
  try {
    const fileStats = await exportService.getExportStats();
    const queueStats = jobQueueService.getQueueStats();
    
    res.json({
      success: true,
      stats: {
        files: {
          activeFiles: fileStats.fileCount,
          totalSize: fileStats.totalSize,
          averageFileSize: fileStats.averageSize
        },
        queue: queueStats,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    logger.error('Error getting export statistics', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Stats Failed',
      message: 'Failed to retrieve export statistics'
    });
  }
});

/**
 * POST /api/export/cleanup
 * Clean up expired export files and old jobs (admin only)
 */
router.post('/cleanup', authenticate, adminOrAnalyst, async (req, res) => {
  try {
    const cleanedFiles = await exportService.cleanupExpiredFiles();
    const cleanedJobs = jobQueueService.cleanupOldJobs();
    
    logger.info('Export cleanup performed', {
      userId: req.user.id,
      cleanedFiles,
      cleanedJobs
    });

    res.json({
      success: true,
      message: `Cleaned up ${cleanedFiles} expired files and ${cleanedJobs} old jobs`,
      cleanedFiles,
      cleanedJobs
    });

  } catch (error) {
    logger.error('Error cleaning up export files', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      error: 'Cleanup Failed',
      message: 'Failed to clean up export files'
    });
  }
});

module.exports = router;
