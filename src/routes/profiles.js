const express = require('express');
const multer = require('multer');
const { authenticate, adminOrAnalyst, requireDepartmentAccess } = require('../middleware/auth');
const { logProfileOperation } = require('../middleware/operationLogger');
const { auditDataAccess, auditComplianceOperation } = require('../middleware/auditLogger');
const { backwardCompatibility } = require('../middleware/backwardCompatibility');
const OperationHistory = require('../models/OperationHistory');
const { ExcelService, ExcelParsingError, EXCEL_ERROR_CODES } = require('../services/excelService');
const { FileValidationService, FileValidationError, VALIDATION_ERROR_CODES } = require('../services/fileValidationService');
const DNAProfile = require('../models/DNAProfile');
const PermissionService = require('../services/permissionService');
const { ProfileAccessService, ProfileAccessError } = require('../services/profileAccessService');
const { ProfileUploadAccessError } = require('../services/profileUploadPolicy');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const router = express.Router();
router.use(require('../middleware/requestContext').requestContext);

function profileAccessContext(req, options = {}) {
  return { userId: req.user.id, activeDepartmentId: req.activeDepartmentId, ...options };
}

function respondProfileAccessError(req, res, error) {
  const denied = error instanceof ProfileAccessError;
  const code = denied ? 'PROFILE_ACCESS_DENIED' : 'PROFILE_ACCESS_CHECK_ERROR';
  const metadata = {
    userId: req.user?.id, profileId: req.params.id || null,
    activeDepartmentId: req.activeDepartmentId, requestId: req.requestId
  };
  if (denied) logger.warn(code, metadata);
  else logger.error(code, { ...metadata, error: error.message, code: error.code });
  return res.status(denied ? 403 : 500).json({
    error: denied ? 'Access denied' : 'Internal server error',
    message: denied ? error.message : 'Failed to check profile access',
    code, requestId: req.requestId
  });
}

async function requireProfileAccess(req, res, action = 'read', includeInactive = false) {
  const allowed = await PermissionService.validateDataAccess(
    req.user.id, 'dna_profile', req.params.id, req.activeDepartmentId, { action, includeInactive }
  );
  if (!allowed) respondProfileAccessError(req, res, new ProfileAccessError('You do not have permission to access this profile'));
  return allowed;
}

/**
 * Извлечение номера привоза из профиля
 * Читает только из столбца import_number
 */
function extractImportNumber(profileData) {
  // Читаем только из столбца import_number
  if (profileData.import_number || profileData.importNumber) {
    return profileData.import_number || profileData.importNumber;
  }
  
  return null;
}

function getMasterArrayAccessScope(user) {
  if (!user) {
    return { clause: '1 = 0', params: [] };
  }

  if (user.role === 'admin') {
    return { clause: '1 = 1', params: [] };
  }

  if (user.department_id) {
    return {
      clause: 'ma.department_id = $1',
      params: [user.department_id]
    };
  }

  return { clause: '1 = 0', params: [] };
}

function extractMasterObjectComment(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const commentKeys = [
    'comment',
    'comments',
    'expert_comment',
    'expertComment',
    'note',
    'notes',
    'description'
  ];

  for (const key of commentKeys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function buildMasterObjectTimeline(masterObject) {
  const timeline = [];

  if (masterObject.created_at) {
    timeline.push({
      type: 'created',
      label: 'Объект создан',
      timestamp: masterObject.created_at,
      actor: masterObject.created_by_username || null
    });
  }

  if (masterObject.updated_at && masterObject.updated_at !== masterObject.created_at) {
    timeline.push({
      type: 'updated',
      label: 'Объект обновлён',
      timestamp: masterObject.updated_at,
      actor: masterObject.last_modified_by || masterObject.created_by_username || null
    });
  }

  if (masterObject.comment && masterObject.comment_updated_at) {
    timeline.push({
      type: 'comment',
      label: 'Комментарий обновлён',
      timestamp: masterObject.comment_updated_at,
      actor: masterObject.comment_updated_by || null
    });
  }

  return timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function mapMasterObjectRow(row) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const comment = extractMasterObjectComment(metadata);
  const commentUpdatedAt = metadata.comment_updated_at || metadata.commentUpdatedAt || metadata.updated_at || null;
  const commentUpdatedBy = metadata.comment_updated_by_username
    || metadata.commentUpdatedByUsername
    || metadata.comment_updated_by
    || metadata.commentUpdatedBy
    || null;
  const lastModifiedBy = metadata.updated_by_username
    || metadata.updatedByUsername
    || metadata.updated_by
    || metadata.updatedBy
    || row.created_by_username
    || null;

  const mapped = {
    id: row.id,
    master_array_id: row.master_array_id,
    master_array_name: row.master_array_name,
    department_id: row.department_id,
    department_name: row.department_name,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    sample_name: row.sample_name,
    internal_number: row.internal_number,
    import_number: row.import_number,
    year: row.year,
    str_data: row.str_data,
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    created_by_username: row.created_by_username,
    last_modified_by: lastModifiedBy,
    comment,
    comment_updated_at: commentUpdatedAt,
    comment_updated_by: commentUpdatedBy,
    is_active: row.is_active
  };

  mapped.timeline = buildMasterObjectTimeline(mapped);

  return mapped;
}

// Apply backward compatibility middleware to all routes
router.use(backwardCompatibility);

// Configure multer for file uploads with enhanced validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Only one file at a time
  },
  fileFilter: (req, file, cb) => {
    // Исправляем кодировку имени файла
    // Multer неправильно декодирует UTF-8 имена файлов из заголовка Content-Disposition
    try {
      // Пробуем декодировать имя файла из Latin-1 в UTF-8
      const buffer = Buffer.from(file.originalname, 'latin1');
      file.originalname = buffer.toString('utf8');
    } catch (e) {
      // Если не получилось, оставляем как есть
      logger.warn('Failed to fix filename encoding:', e.message);
    }
    
    // Базовая проверка расширения файла
    const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    if (['.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Please upload an Excel file (.xlsx or .xls).'), false);
    }
  }
});

const excelService = new ExcelService();
const fileValidationService = new FileValidationService();

// Helper methods for enhanced upload processing
const calculateAverageCompleteness = (createdProfiles) => {
  if (!createdProfiles || createdProfiles.length === 0) return 0;
  
  const totalCompleteness = createdProfiles.reduce((sum, item) => {
    const profile = item.profile;
    const completeness = profile.metadata?.qualityMetrics?.completeness || 0;
    return sum + completeness;
  }, 0);
  
  return Math.round(totalCompleteness / createdProfiles.length);
};

const getRecommendedAnalysisTypes = (createdProfiles) => {
  if (!createdProfiles || createdProfiles.length === 0) return [];
  
  const analysisTypes = createdProfiles.map(item => {
    const profile = item.profile;
    return profile.metadata?.qualityMetrics?.recommendedAnalysis || 'standard_analysis';
  });
  
  // Count occurrences and return unique types with counts
  const typeCounts = analysisTypes.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  
  return Object.entries(typeCounts).map(([type, count]) => ({
    analysisType: type,
    profileCount: count,
    percentage: Math.round((count / createdProfiles.length) * 100)
  }));
};

// Middleware для обработки ошибок multer
const handleMulterError = (err, req, res, next) => {
  console.log('🔍 DEBUG: Multer error handler called!');
  console.log('🔍 DEBUG: Error:', err);
  console.log('🔍 DEBUG: Error message:', err.message);
  console.log('🔍 DEBUG: Error code:', err.code);
  
  if (err) {
    logger.error('Multer error', {
      error: err.message,
      code: err.code,
      filename: req.file?.originalname
    });
    
    if (err.message.includes('Invalid file format')) {
      return res.status(400).json({
        error: 'Invalid file format',
        message: 'Пожалуйста, загрузите файл Excel (.xlsx или .xls)',
        code: 'INVALID_FILE_FORMAT',
        details: {
          originalError: err.message,
          filename: req.file?.originalname || 'неизвестно'
        }
      });
    }
    
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        message: 'Размер файла превышает лимит в 10MB',
        code: 'FILE_TOO_LARGE'
      });
    }
    
    return res.status(400).json({
      error: 'File upload error',
      message: err.message,
      code: err.code || 'UPLOAD_ERROR'
    });
  }
  
  next();
};

// Используем только контекст, уже проверенный authenticate.
async function getImportContext(req) {
  return excelService.resolveUserContext({
    userId: req.user.id,
    departmentId: req.activeDepartmentId || req.organizationalContext?.department_id,
    taskId: req.body.taskId || null
  });
}

// Preview endpoint - analyze file without saving to database
router.post('/upload/preview', 
    authenticate, 
    adminOrAnalyst,
    upload.single('file'), 
    handleMulterError,
    async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please select an Excel file to upload',
        code: 'NO_FILE'
      });
    }

    const { originalname, buffer } = req.file;
    const userId = req.user.id;
    const { mode = 'auto_detect', taskId = null } = req.body;

    logger.info('Preview file upload', { 
      filename: originalname, 
      size: buffer.length, 
      userId
    });

    const userContext = await getImportContext(req);

    // Parse file
    const parsingOptions = {
      mode,
      minRequiredLoci: 3
    };

    const parseResult = await excelService.parseExcelFileWithContext(
      buffer,
      originalname,
      userContext,
      parsingOptions
    );

    // Check for existing profiles (active and deactivated)
    const profileIdentifiers = parseResult.profiles.map(p => ({
      sampleName: p.sampleName,
      internalNumber: p.internalNumber,
      year: p.year,
      importFormat: p.importFormat
    }));

    const existingChecks = await DNAProfile.checkExistingProfiles(userId, profileIdentifiers, userContext);

    // Build preview response
    const preview = {
      importFormat: userContext.importFormat,
      totalProfiles: parseResult.profiles.length,
      breakdown: {
        create: 0,
        replace: 0,
        conflict: 0
      },
      profiles: []
    };

    for (let i = 0; i < parseResult.profiles.length; i++) {
      const profile = parseResult.profiles[i];
      const check = existingChecks[i];

      const previewItem = {
        index: i,
        importFormat: profile.importFormat,
        sampleName: profile.sampleName,
        internalNumber: profile.internalNumber,
        year: profile.year,
        importNumber: profile.importNumber,
        lociCount: Object.keys(profile.strData || {}).length,
        action: check.action,
        existingProfile: check.existing
      };

      preview.profiles.push(previewItem);
      preview.breakdown[check.action]++;
    }

    res.status(200).json({
      success: true,
      message: 'File preview generated successfully',
      filename: originalname,
      preview,
      parsing: {
        totalParsed: parseResult.profiles.length,
        compatibilityMode: parseResult.compatibilityMode,
        supportedMarkers: parseResult.supportedMarkers
      }
    });

  } catch (error) {
    logger.error('Error generating file preview', { 
      error: error.message, 
      filename: req.file?.originalname,
      userId: req.user?.id,
      stack: error.stack
    });

    if (error instanceof ProfileUploadAccessError) {
      return res.status(error.status).json({ error: 'Profile upload denied', code: error.code, message: error.message });
    }

    if (error instanceof ExcelParsingError) {
      return res.status(400).json({
        error: 'Excel parsing failed',
        code: error.code,
        message: error.message,
        details: error.details
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to generate file preview',
      code: 'PREVIEW_ERROR'
    });
  }
});

// Enhanced upload endpoint with organizational context and improved validation
router.post('/upload', 
    authenticate, 
    adminOrAnalyst, 
    // auditDataAccess('dna_profiles', 'write', 'restricted'),
    // auditComplianceOperation('DNA_PROFILE_UPLOAD', 'high'),
    upload.single('file'), 
    handleMulterError,
    logProfileOperation(OperationHistory.OPERATION_TYPES.PROFILE_UPLOAD), 
    async (req, res) => {
  console.log('🔍 DEBUG: Upload route called!');
  console.log('🔍 DEBUG: req.file =', req.file);
  console.log('🔍 DEBUG: req.body =', req.body);
  console.log('🔍 DEBUG: req.body keys =', Object.keys(req.body || {}));
  
  logger.info('Upload route called with debug info', {
    bodyKeys: Object.keys(req.body || {}),
    hasFile: !!req.file,
    filename: req.file?.originalname,
    fileSize: req.file?.size,
    fileMimeType: req.file?.mimetype
  });
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please select an Excel file to upload',
        code: 'NO_FILE'
      });
    }

    const { originalname, buffer } = req.file;
    const userId = req.user.id;
    const { 
      mode = 'auto_detect', 
      performDeduplication = true,  // По умолчанию включена проверка дубликатов
      compareMasterArray = false,
      allowDuplicates = false,  // По умолчанию дубликаты не разрешены
      skipValidation = false, // Опция для пропуска валидации (для тестирования)
      validationOnly = false, // Изменено: теперь по умолчанию данные обрабатываются
      taskId = null // ID задачи для привязки генотипов
    } = req.body;

    // Преобразуем строковые значения в булевы
    const skipValidationBool = skipValidation === 'true' || skipValidation === true;
    const validationOnlyBool = validationOnly === 'true' || validationOnly === true;
    const performDeduplicationBool = validationOnlyBool ? false : (performDeduplication === 'true' || performDeduplication === true);
    const compareMasterArrayBool = validationOnlyBool ? false : (compareMasterArray === 'true' || compareMasterArray === true);
    const allowDuplicatesBool = validationOnlyBool ? true : (allowDuplicates === 'true' || allowDuplicates === true);

    console.log('🔍 DEBUG: Processing parameters:', {
      skipValidation,
      skipValidationBool,
      validationOnly,
      validationOnlyBool,
      performDeduplication: performDeduplicationBool,
      compareMasterArray: compareMasterArrayBool,
      allowDuplicates: allowDuplicatesBool,
      originalSkipValidation: req.body.skipValidation,
      type: typeof skipValidation
    });
    
    logger.info('Processing parameters debug', {
      skipValidation,
      skipValidationBool,
      validationOnly,
      validationOnlyBool,
      performDeduplication: performDeduplicationBool,
      compareMasterArray: compareMasterArrayBool,
      allowDuplicates: allowDuplicatesBool,
      originalSkipValidation: req.body.skipValidation,
      type: typeof skipValidation
    });

    logger.info('Processing Excel file upload with validation and data processing', { 
      filename: originalname, 
      size: buffer.length, 
      userId,
      departmentId: req.user.department_id,
      organizationId: req.user.organization_id,
      mode
    });

    const userContext = await getImportContext(req);

    // 1. Расширенная валидация файла
    console.log('🔍 DEBUG: Checking validation skip:', skipValidationBool);
    if (!skipValidationBool) {
      console.log('🔍 DEBUG: Running validation...');
      try {
        const validationResult = fileValidationService.validateFile(buffer, originalname, { importFormat: userContext.importFormat });
        
        if (!validationResult.valid) {
          logger.warn('File validation failed', {
            filename: originalname,
            errors: validationResult.errors,
            warnings: validationResult.warnings
          });

          return res.status(400).json({
            error: 'File validation failed',
            message: 'Файл не прошел валидацию',
            code: 'VALIDATION_FAILED',
            validation: {
              valid: false,
              errors: validationResult.errors,
              warnings: validationResult.warnings,
              expertiseType: validationResult.expertiseType,
              summary: validationResult.summary
            }
          });
        }

        // Логируем успешную валидацию
        logger.info('File validation successful', {
          filename: originalname,
          expertiseType: validationResult.expertiseType,
          warnings: validationResult.warnings.length
        });

        // Если есть предупреждения, включаем их в ответ
        if (validationResult.warnings.length > 0) {
          logger.warn('File validation warnings', {
            filename: originalname,
            warnings: validationResult.warnings
          });
        }
      } catch (validationError) {
        logger.error('File validation error', {
          filename: originalname,
          error: validationError.message,
          details: validationError.details
        });

        if (validationError instanceof FileValidationError) {
          return res.status(400).json({
            error: 'File validation error',
            message: validationError.message,
            code: validationError.code,
            details: validationError.details
          });
        }

        // Неожиданная ошибка валидации
        return res.status(500).json({
          error: 'Validation system error',
          message: 'Ошибка системы валидации файлов',
          code: 'VALIDATION_SYSTEM_ERROR'
        });
      }
    } else {
      console.log('🔍 DEBUG: Validation skipped!');
    }

    // Если включен режим "только валидация", возвращаем только результаты валидации
    if (validationOnlyBool && (!skipValidationBool || userContext.importFormat === 'genetic')) {
      if (userContext.importFormat === 'genetic') await excelService.parseExcelFileWithContext(buffer, originalname, userContext, { minRequiredLoci: 3 });
      logger.info('Validation-only mode: returning validation results without data processing', {
        filename: originalname,
        userId
      });

      return res.status(200).json({
        success: true,
        message: 'File validation completed successfully',
        filename: originalname,
        mode: 'validation_only',
        validation: {
          passed: true,
          message: 'Файл прошел валидацию успешно',
          expertiseType: 'detected'
        },
        note: 'Файл проверен только на ошибки валидации. Данные не были обработаны или сохранены.'
      });
    }

    // 2. Обработка файла (обычная логика с сохранением в БД)
    logger.info('Processing file data and saving to database', {
      filename: originalname,
      userId,
      performDeduplication: performDeduplicationBool,
      compareMasterArray: compareMasterArrayBool,
      allowDuplicates: allowDuplicatesBool
    });

    const processingOptions = {
      performDeduplication: performDeduplicationBool,
      compareMasterArray: compareMasterArrayBool,
      allowDuplicates: allowDuplicatesBool,
      skipValidation: skipValidationBool // Add skipValidation to processing options
    };

    const parsingOptions = {
      mode,
      minRequiredLoci: 3,
      skipValidation: skipValidationBool // Add skipValidation to parsing options
    };

    // Use enhanced bulk upload with organizational context
    const result = await excelService.bulkUploadWithContext(
      buffer, 
      originalname, 
      userContext, 
      { ...processingOptions, parsingOptions }
    );

    // Enhanced response with validation info
    res.status(200).json({
      success: true,
      message: 'File processed successfully with validation and saved to database',
      importFormat: result.importFormat,
      uploadId: result.uploadId,
      filename: originalname,
      uploadedBy: result.uploadedBy,
      uploadedAt: result.uploadedAt,
      validation: {
        passed: true,
        expertiseType: skipValidationBool ? 'unknown' : 'detected'
      },
      organizationalContext: {
        department: result.department,
        organization: result.organization
      },
      parsing: {
        totalParsed: result.parsing.totalParsed,
        compatibilityMode: result.parsing.compatibilityMode,
        supportedMarkers: result.parsing.supportedMarkers
      },
      processing: {
        created: result.processing.summary.createdCount,
        duplicates: result.processing.summary.duplicateCount,
        masterArrayMatches: result.processing.summary.matchCount,
        errors: result.processing.summary.errorCount
      },
      data: {
        createdProfiles: result.processing.created.map(item => ({
          id: item.profile.id,
          importFormat: item.profile.importFormat,
          year: item.profile.year,
          lociCount: Object.keys(item.profile.strData || {}).length,
          sampleName: item.profile.sampleName,
          internal_number: item.profile.internalNumber, // Исправлено: используем camelCase из модели
          uploadDate: item.profile.uploadDate,
          priorityMarkerCount: item.profile.priorityMarkerCount || 0,
          compatibilityMode: item.profile.compatibilityMode,
          masterArrayMatches: item.masterArrayMatches?.length || 0
        })),
        duplicates: result.processing.duplicates,
        masterArrayMatches: result.processing.masterArrayMatches,
        errors: result.processing.errors
      },
      recommendations: result.recommendations,
      qualityMetrics: {
        averageCompleteness: calculateAverageCompleteness(result.processing.created),
        recommendedAnalysisTypes: getRecommendedAnalysisTypes(result.processing.created)
      }
    });

  } catch (error) {
    logger.error('Error processing Excel file upload with enhanced validation', { 
      error: error.message, 
      filename: req.file?.originalname,
      userId: req.user?.id,
      departmentId: req.user?.department_id,
      organizationId: req.user?.organization_id,
      stack: error.stack
    });

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        message: 'File size exceeds 10MB limit',
        code: 'FILE_TOO_LARGE'
      });
    }

    if (error instanceof ProfileUploadAccessError) {
      return res.status(error.status).json({ error: 'Profile upload denied', code: error.code, message: error.message });
    }

    if (error instanceof ExcelParsingError) {
      return res.status(400).json({
        error: 'Excel parsing failed',
        code: error.code,
        message: error.message,
        details: error.details
      });
    }

    if (error instanceof FileValidationError) {
      return res.status(400).json({
        error: 'File validation failed',
        code: error.code,
        message: error.message,
        details: error.details
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to process Excel file with enhanced validation',
      code: 'PROCESSING_ERROR'
    });
  }
});

// Enhanced bulk upload endpoint with automatic master array comparison
router.post('/bulk-upload-with-comparison', 
    authenticate, 
    adminOrAnalyst, 
    // auditDataAccess('dna_profiles', 'write', 'restricted'),
    // auditComplianceOperation('DNA_BULK_UPLOAD_WITH_COMPARISON', 'high'),
    upload.single('file'), 
    logProfileOperation(OperationHistory.OPERATION_TYPES.PROFILE_UPLOAD),
    async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please select an Excel file to upload'
      });
    }

    const { originalname, buffer } = req.file;
    const userId = req.user.id;
    const { 
      mode = 'extended_40',
      minMatchThreshold = 15,
      performDeduplication = true,
      compareMasterArray = true,
      allowDuplicates = false,
      autoCreateMasterArrayEntries = false
    } = req.body;

    // Enhanced user context
    const userContext = await getImportContext(req);

    // Enhanced processing options
    const processingOptions = {
      performDeduplication: performDeduplication === 'true' || performDeduplication === true,
      compareMasterArray: compareMasterArray === 'true' || compareMasterArray === true,
      allowDuplicates: allowDuplicates === 'true' || allowDuplicates === true,
      autoCreateMasterArrayEntries: autoCreateMasterArrayEntries === 'true' || autoCreateMasterArrayEntries === true,
      minMatchThreshold: parseInt(minMatchThreshold) || 15,
      parsingOptions: {
        mode,
        minRequiredLoci: 3
      }
    };

    logger.info('Processing bulk upload with master array comparison', {
      filename: originalname,
      userId,
      departmentId: req.user.department_id,
      processingOptions
    });

    // Use enhanced bulk upload service
    const result = await excelService.bulkUploadWithContext(
      buffer, 
      originalname, 
      userContext, 
      processingOptions
    );

    // Enhanced analysis of results
    const analysisResults = {
      uploadSummary: {
        uploadId: result.uploadId,
        filename: originalname,
        uploadedBy: result.uploadedBy,
        uploadedAt: result.uploadedAt,
        organizationalContext: {
          department: result.department,
          organization: result.organization
        }
      },
      processingResults: {
        totalProfiles: result.parsing.totalParsed,
        created: result.processing.summary.createdCount,
        duplicates: result.processing.summary.duplicateCount,
        errors: result.processing.summary.errorCount,
        masterArrayMatches: result.processing.summary.matchCount
      },
      masterArrayAnalysis: {
        totalMatches: result.processing.masterArrayMatches.length,
        highConfidenceMatches: result.processing.masterArrayMatches.filter(
          match => match.matches.some(m => m.matchPercentage >= 80)
        ).length,
        potentialRelationships: result.processing.masterArrayMatches.filter(
          match => match.matches.some(m => m.matchPercentage >= 60 && m.matchPercentage < 80)
        ).length
      },
      qualityMetrics: {
        averageCompleteness: calculateAverageCompleteness(result.processing.created),
        recommendedAnalysisTypes: getRecommendedAnalysisTypes(result.processing.created),
        dataQualityDistribution: this.getDataQualityDistribution(result.processing.created)
      },
      recommendations: result.recommendations
    };

    res.status(200).json({
      success: true,
      message: 'Bulk upload with master array comparison completed successfully',
      ...analysisResults
    });

  } catch (error) {
    logger.error('Error in bulk upload with master array comparison', {
      error: error.message,
      filename: req.file?.originalname,
      userId: req.user?.id,
      departmentId: req.user?.department_id
    });

    if (error instanceof ProfileUploadAccessError) {
      return res.status(error.status).json({ error: 'Profile upload denied', code: error.code, message: error.message });
    }

    if (error instanceof ExcelParsingError) {
      return res.status(400).json({
        error: 'Excel parsing failed',
        code: error.code,
        message: error.message,
        details: error.details
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to process bulk upload with master array comparison'
    });
  }
});

// Helper method for data quality distribution
const getDataQualityDistribution = (createdProfiles) => {
  if (!createdProfiles || createdProfiles.length === 0) return {};
  
  const qualityDistribution = { excellent: 0, good: 0, fair: 0, poor: 0 };
  
  createdProfiles.forEach(item => {
    const quality = item.profile.metadata?.qualityMetrics?.dataQuality || 'poor';
    qualityDistribution[quality] = (qualityDistribution[quality] || 0) + 1;
  });
  
  const total = createdProfiles.length;
  return Object.entries(qualityDistribution).reduce((acc, [quality, count]) => {
    acc[quality] = {
      count,
      percentage: Math.round((count / total) * 100)
    };
    return acc;
  }, {});
};

// Get upload statistics with organizational context
router.get('/upload-stats', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const departmentId = req.user.department_id;
    const organizationId = req.user.organization_id;
    
    // Get user's upload statistics
    const userStats = await DNAProfile.getUserUploadStats(userId);
    
    // Get department statistics (if user has access)
    let departmentStats = null;
    if (departmentId && (req.user.role === 'department_head' || req.user.role === 'system_administrator')) {
      departmentStats = await DNAProfile.getDepartmentUploadStats(departmentId);
    }
    
    // Get master array information
    const masterArrayInfo = await DNAProfile.getMasterArrayInfo(departmentId);
    
    // Calculate compatibility metrics
    const compatibilityMetrics = await calculateCompatibilityMetrics(userId, departmentId);
    
    res.json({
      userStatistics: {
        totalProfiles: userStats.totalProfiles,
        totalUploads: userStats.totalUploads,
        averageProfilesPerUpload: userStats.averageProfilesPerUpload,
        lastUploadDate: userStats.lastUploadDate,
        compatibilityBreakdown: userStats.compatibilityBreakdown
      },
      departmentStatistics: departmentStats ? {
        totalProfiles: departmentStats.totalProfiles,
        totalUsers: departmentStats.totalUsers,
        masterArraySize: departmentStats.masterArraySize,
        averageProfilesPerUser: departmentStats.averageProfilesPerUser
      } : null,
      masterArrayInfo: {
        size: masterArrayInfo.size,
        lastUpdated: masterArrayInfo.lastUpdated,
        averageCompleteness: masterArrayInfo.averageCompleteness,
        markerDistribution: masterArrayInfo.markerDistribution
      },
      compatibilityMetrics,
      organizationalContext: {
        userId,
        departmentId,
        organizationId,
        userRole: req.user.role,
        hasAccessToDepartmentStats: departmentStats !== null
      }
    });
    
  } catch (error) {
    logger.error('Error fetching upload statistics', {
      error: error.message,
      userId: req.user?.id,
      departmentId: req.user?.department_id
    });
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch upload statistics'
    });
  }
});

// Helper method for compatibility metrics
const calculateCompatibilityMetrics = async (userId, departmentId) => {
  try {
    // Get profiles with compatibility information
    const profiles = await DNAProfile.findByUserWithCompatibilityInfo(userId);
    
    const metrics = {
      original39Compatible: 0,
      extended40Compatible: 0,
      full80Compatible: 0,
      snpSupported: 0,
      averageMarkerCount: 0,
      recommendedUpgradeProfiles: 0
    };
    
    if (profiles.length === 0) return metrics;
    
    let totalMarkers = 0;
    
    profiles.forEach(profile => {
      const metadata = profile.metadata || {};
      const compatibilityInfo = metadata.compatibilityInfo || {};
      
      totalMarkers += compatibilityInfo.totalLociCount || 0;
      
      if (compatibilityInfo.backwardCompatible) {
        metrics.original39Compatible++;
      }
      
      if (compatibilityInfo.priorityMarkerCount >= 35) {
        metrics.extended40Compatible++;
      }
      
      if (compatibilityInfo.totalLociCount >= 50) {
        metrics.full80Compatible++;
      }
      
      if (compatibilityInfo.hasExtendedSupport) {
        metrics.snpSupported++;
      }
      
      if (compatibilityInfo.totalLociCount < 35) {
        metrics.recommendedUpgradeProfiles++;
      }
    });
    
    metrics.averageMarkerCount = Math.round(totalMarkers / profiles.length);
    
    return metrics;
  } catch (error) {
    logger.error('Error calculating compatibility metrics', {
      error: error.message,
      userId,
      departmentId
    });
    return {};
  }
};
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 100, offset = 0, include_master_array = false } = req.query;

    let profiles;
    let totalCount;

    if (include_master_array === 'true' && req.activeDepartmentId) {
      // Include both user profiles and department master array profiles
      profiles = await DNAProfile.findByUserWithDepartmentAccess(userId, req.activeDepartmentId, {
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
      totalCount = await DNAProfile.countByUserWithDepartmentAccess(userId, req.activeDepartmentId);
    } else {
      // Only user's own profiles
      profiles = await DNAProfile.findByUserId(userId, {
        departmentId: req.activeDepartmentId,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
      totalCount = await DNAProfile.countByUserId(userId, { departmentId: req.activeDepartmentId });
    }

    res.json({
      profiles: profiles.map(p => {
        const profileData = p.toJSON();
        
        // Add import_number field and fix internal_number mapping to the response
        return {
          ...profileData,
          internal_number: profileData.internalNumber, // Исправляем маппинг поля
          import_number: extractImportNumber(profileData)
        };
      }),
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + profiles.length) < totalCount
      },
      context: {
        organization_id: req.user.organization_id,
        department_id: req.activeDepartmentId,
        include_master_array: include_master_array === 'true'
      }
    });

  } catch (error) {
    logger.error('Error fetching user profiles', { 
      error: error.message, 
      userId: req.user?.id,
      departmentId: req.user?.department_id
    });

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch profiles'
    });
  }
});

// GET /api/profiles/search - Search DNA profiles
router.get('/search', authenticate, async (req, res) => {
    try {
        const { q: searchTerm, limit = 50, offset = 0 } = req.query;
        
        if (!searchTerm || searchTerm.trim().length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Search term is required'
            });
        }

        logger.info('Profile search requested', {
            searchTerm,
            userId: req.user.id,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        const scope = await ProfileAccessService.getScope(profileAccessContext(req));
        
        // Helper function to generate case variations for Cyrillic text
        const generateCaseVariations = (text) => {
            const variations = new Set();
            
            // Add original text
            variations.add(`%${text}%`);
            
            // Add uppercase version
            variations.add(`%${text.toUpperCase()}%`);
            
            // Add lowercase version  
            variations.add(`%${text.toLowerCase()}%`);
            
            // Add title case (first letter uppercase, rest lowercase)
            if (text.length > 0) {
                const titleCase = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
                variations.add(`%${titleCase}%`);
            }
            
            return Array.from(variations);
        };
        
        const patterns = generateCaseVariations(searchTerm);
        
        // Build dynamic query with all pattern variations
        const whereConditions = [];
        const queryParams = [...scope.params];
        let paramIndex = queryParams.length + 1;
        
        // For each field, add all pattern variations
        const fields = ['internal_number', 'sample_name', 'notes'];
        
        fields.forEach(field => {
            patterns.forEach(pattern => {
                whereConditions.push(`dp.${field} LIKE $${paramIndex}`);
                queryParams.push(pattern);
                paramIndex++;
            });
        });
        
        const searchQuery = `
            SELECT 
                id, 
                sample_name, 
                internal_number, 
                notes, 
                upload_date,
                user_id,
                import_number
            FROM dna_profiles dp
            WHERE ${scope.clause}
                AND (${whereConditions.join(' OR ')})
            ORDER BY upload_date DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        queryParams.push(parseInt(limit), parseInt(offset));
        const result = await query(searchQuery, queryParams);
        
        const profiles = result.rows.map(profile => {
            // Extract import_number (with fallback to notes)
            const import_number = extractImportNumber(profile);
            
            return {
                id: profile.id,
                sample_name: profile.sample_name,
                sampleName: profile.sample_name, // For backward compatibility
                internal_number: profile.internal_number,
                import_number: import_number,
                upload_date: profile.upload_date,
                user_id: profile.user_id
            };
        });

        logger.info('Profile search completed (database)', {
            searchTerm,
            resultsCount: profiles.length,
            userId: req.user.id
        });

        res.json({
            success: true,
            profiles: profiles,
            searchTerm,
            total: profiles.length,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        respondProfileAccessError(req, res, error);
    }
});

// GET /api/profiles/master-objects/search - Search objects in accessible master arrays
router.get('/master-objects/search', authenticate, async (req, res) => {
    try {
        const { q: searchTerm, limit = 25, offset = 0 } = req.query;

        if (!searchTerm || searchTerm.trim().length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Search term is required'
            });
        }

        const normalizedSearchTerm = searchTerm.trim();
        const { clause: accessClause, params: accessParams } = getMasterArrayAccessScope(req.user);
        const searchPattern = `%${normalizedSearchTerm}%`;
        const queryParams = [...accessParams, searchPattern];
        const searchParamIndex = queryParams.length;

        queryParams.push(parseInt(limit, 10), parseInt(offset, 10));
        const limitParamIndex = queryParams.length - 1;
        const offsetParamIndex = queryParams.length;

        const result = await query(`
            SELECT
                map.*,
                ma.name AS master_array_name,
                ma.department_id,
                d.name AS department_name,
                d.organization_id,
                o.name AS organization_name,
                creator.username AS created_by_username
            FROM master_array_profiles map
            JOIN master_arrays ma ON ma.id = map.master_array_id
            JOIN departments d ON d.id = ma.department_id
            LEFT JOIN organizations o ON o.id = d.organization_id
            LEFT JOIN users creator ON creator.id = map.created_by
            WHERE map.is_active = true
              AND ma.is_active = true
              AND d.is_active = true
              AND (${accessClause})
              AND (
                map.sample_name ILIKE $${searchParamIndex}
                OR COALESCE(map.internal_number, '') ILIKE $${searchParamIndex}
                OR COALESCE(map.import_number, '') ILIKE $${searchParamIndex}
                OR COALESCE(map.metadata::text, '') ILIKE $${searchParamIndex}
              )
            ORDER BY map.updated_at DESC, map.created_at DESC
            LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
        `, queryParams);

        const objects = result.rows.map(mapMasterObjectRow);

        res.json({
            success: true,
            query: normalizedSearchTerm,
            total: objects.length,
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10),
            objects
        });
    } catch (error) {
        logger.error('Master object search failed', {
            error: error.message,
            searchTerm: req.query.q,
            userId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to search master array objects'
        });
    }
});

// GET /api/profiles/master-objects/:id - Get detailed master array object card
router.get('/master-objects/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { clause: accessClause, params: accessParams } = getMasterArrayAccessScope(req.user);
        const queryParams = [id, ...accessParams];

        const result = await query(`
            SELECT
                map.*,
                ma.name AS master_array_name,
                ma.department_id,
                d.name AS department_name,
                d.organization_id,
                o.name AS organization_name,
                creator.username AS created_by_username
            FROM master_array_profiles map
            JOIN master_arrays ma ON ma.id = map.master_array_id
            JOIN departments d ON d.id = ma.department_id
            LEFT JOIN organizations o ON o.id = d.organization_id
            LEFT JOIN users creator ON creator.id = map.created_by
            WHERE map.id = $1
              AND map.is_active = true
              AND ma.is_active = true
              AND d.is_active = true
              AND (${accessClause.replace(/\$1/g, '$2')})
            LIMIT 1
        `, queryParams);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Master array object not found'
            });
        }

        const object = mapMasterObjectRow(result.rows[0]);

        res.json({
            success: true,
            object
        });
    } catch (error) {
        logger.error('Failed to fetch master object details', {
            error: error.message,
            objectId: req.params.id,
            userId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch master array object'
        });
    }
});

// POST /api/profiles/compare - Compare two DNA profiles using Bayesian analysis
router.post('/compare', authenticate, async (req, res) => {
    try {
        const { profile1Id, profile2Id } = req.body;

        if (!profile1Id || !profile2Id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Both profile1Id and profile2Id are required'
            });
        }

        if (profile1Id === profile2Id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cannot compare a profile with itself'
            });
        }

        logger.info('Profile comparison requested with Bayesian analysis', {
            profile1Id,
            profile2Id,
            userId: req.user.id
        });

        try {
            // Try to load Bayesian Engine for real analysis
            console.log('🔍 DEBUG: Attempting to load Bayesian Engine...');
            const BayesianEngine = require('../services/bayesian/BayesianEngine');
            const LRCalculator = require('../services/bayesian/LRCalculator');
            console.log('🔍 DEBUG: Bayesian modules loaded successfully');
            
            // Create mock profiles for demonstration (since database is not fully configured)
            const mockProfile1 = {
                id: profile1Id,
                sampleName: profile1Id === 'mock-profile-1' ? 'Test Sample 1' : 
                           profile1Id === 'mock-profile-2' ? 'Test Sample 2' : 
                           'DNA Profile Sample',
                loci: new Map([
                    ['D3S1358', { locusName: 'D3S1358', locusType: 'STR', alleles: ['15', '16'] }],
                    ['vWA', { locusName: 'vWA', locusType: 'STR', alleles: ['17', '18'] }],
                    ['D16S539', { locusName: 'D16S539', locusType: 'STR', alleles: ['11', '12'] }],
                    ['CSF1PO', { locusName: 'CSF1PO', locusType: 'STR', alleles: ['10', '12'] }],
                    ['TPOX', { locusName: 'TPOX', locusType: 'STR', alleles: ['8', '11'] }],
                    ['D8S1179', { locusName: 'D8S1179', locusType: 'STR', alleles: ['13', '14'] }],
                    ['D21S11', { locusName: 'D21S11', locusType: 'STR', alleles: ['30', '32.2'] }],
                    ['D18S51', { locusName: 'D18S51', locusType: 'STR', alleles: ['14', '17'] }],
                    ['DYS391', { locusName: 'DYS391', locusType: 'Y_CHROMOSOME', alleles: ['10'] }],
                    ['D2S441', { locusName: 'D2S441', locusType: 'STR', alleles: ['11', '14'] }],
                    ['AMEL', { locusName: 'AMEL', locusType: 'AMELOGENIN', alleles: ['X', 'Y'] }]
                ])
            };

            const mockProfile2 = {
                id: profile2Id,
                sampleName: profile2Id === 'mock-profile-1' ? 'Test Sample 1' : 
                           profile2Id === 'mock-profile-2' ? 'Test Sample 2' : 
                           'DNA Profile Sample',
                loci: new Map([
                    ['D3S1358', { locusName: 'D3S1358', locusType: 'STR', alleles: ['15', '16'] }],
                    ['vWA', { locusName: 'vWA', locusType: 'STR', alleles: ['17', '19'] }], // Different allele
                    ['D16S539', { locusName: 'D16S539', locusType: 'STR', alleles: ['11', '12'] }],
                    ['CSF1PO', { locusName: 'CSF1PO', locusType: 'STR', alleles: ['10', '12'] }],
                    ['TPOX', { locusName: 'TPOX', locusType: 'STR', alleles: ['8', '11'] }],
                    ['D8S1179', { locusName: 'D8S1179', locusType: 'STR', alleles: ['13', '15'] }], // Different allele
                    ['D21S11', { locusName: 'D21S11', locusType: 'STR', alleles: ['30', '32.2'] }],
                    ['D18S51', { locusName: 'D18S51', locusType: 'STR', alleles: ['14', '17'] }],
                    ['DYS391', { locusName: 'DYS391', locusType: 'Y_CHROMOSOME', alleles: ['11'] }], // Different allele
                    ['D2S441', { locusName: 'D2S441', locusType: 'STR', alleles: ['11', '14'] }],
                    ['AMEL', { locusName: 'AMEL', locusType: 'AMELOGENIN', alleles: ['X', 'Y'] }]
                ])
            };

            // Mock population data for demonstration
            const mockPopulationData = {
                populationId: 'default',
                name: 'Default Population',
                locusFrequencies: new Map([
                    ['D3S1358', { frequencies: new Map([['15', 0.25], ['16', 0.20], ['14', 0.15], ['17', 0.40]]) }],
                    ['vWA', { frequencies: new Map([['17', 0.22], ['18', 0.18], ['19', 0.25], ['16', 0.35]]) }],
                    ['D16S539', { frequencies: new Map([['11', 0.30], ['12', 0.25], ['10', 0.20], ['13', 0.25]]) }],
                    ['CSF1PO', { frequencies: new Map([['10', 0.20], ['12', 0.30], ['11', 0.25], ['13', 0.25]]) }],
                    ['TPOX', { frequencies: new Map([['8', 0.35], ['11', 0.25], ['9', 0.20], ['10', 0.20]]) }],
                    ['D8S1179', { frequencies: new Map([['13', 0.25], ['14', 0.20], ['15', 0.30], ['12', 0.25]]) }],
                    ['D21S11', { frequencies: new Map([['30', 0.20], ['32.2', 0.15], ['29', 0.25], ['31', 0.40]]) }],
                    ['D18S51', { frequencies: new Map([['14', 0.25], ['17', 0.20], ['15', 0.30], ['16', 0.25]]) }],
                    ['DYS391', { frequencies: new Map([['10', 0.40], ['11', 0.35], ['9', 0.15], ['12', 0.10]]) }],
                    ['D2S441', { frequencies: new Map([['11', 0.30], ['14', 0.25], ['12', 0.25], ['13', 0.20]]) }],
                    ['AMEL', { frequencies: new Map([['X', 0.50], ['Y', 0.50]]) }]
                ])
            };

            // Initialize LR Calculator with mock dependencies
            const mockPopulationManager = {
                loadPopulationData: async (populationId) => mockPopulationData
            };
            
            const mockSystemParameters = {
                getBayesianParameters: async () => ({
                    dropOutProbability: 0.01,
                    falseAlleleProbability: 0.01,
                    inbreedingCoefficient: 0.01,
                    thetaCorrection: 0.01
                })
            };

            const lrCalculator = new LRCalculator(mockPopulationManager, mockSystemParameters);
            console.log('🔍 DEBUG: LRCalculator instantiated successfully');

            // Perform Bayesian LR calculation
            console.log('🔍 DEBUG: Starting LR calculation...');
            const lrResult = await lrCalculator.calculateProfileLR(
                mockProfile1, 
                mockProfile2, 
                mockPopulationData
            );
            console.log('🔍 DEBUG: LR calculation completed:', {
                overallLR: lrResult.overallLR,
                significance: lrResult.significance,
                locusCount: lrResult.locusLRs ? lrResult.locusLRs.size : 0
            });

            // Helper function to interpret LR values
            const interpretLR = (lr) => {
                if (lr >= 1000000) return 'Extremely strong evidence supporting the hypothesis';
                if (lr >= 10000) return 'Very strong evidence supporting the hypothesis';
                if (lr >= 100) return 'Strong evidence supporting the hypothesis';
                if (lr >= 10) return 'Moderate evidence supporting the hypothesis';
                if (lr >= 1) return 'Weak evidence supporting the hypothesis';
                return 'Evidence excludes the hypothesis';
            };

            // Convert LR result to comparison format
            const lociComparison = {};
            const profile1Loci = mockProfile1.loci;
            const profile2Loci = mockProfile2.loci;

            for (const [locusName, locusData] of profile1Loci) {
                if (profile2Loci.has(locusName)) {
                    const profile1Alleles = locusData.alleles.join(',');
                    const profile2Alleles = profile2Loci.get(locusName).alleles.join(',');
                    const match = profile1Alleles === profile2Alleles;
                    
                    lociComparison[locusName] = {
                        profile1: profile1Alleles,
                        profile2: profile2Alleles,
                        match: match,
                        lr: lrResult.locusLRs.get(locusName)?.lr || 0,
                        significance: lrResult.locusLRs.get(locusName)?.significance || 'UNKNOWN',
                        colorCode: lrResult.locusLRs.get(locusName)?.colorCode || '#757575'
                    };
                }
            }

            const matchingLoci = Object.values(lociComparison).filter(locus => locus.match).length;
            const totalLoci = Object.keys(lociComparison).length;

            const comparisonResult = {
                profile1: {
                    id: profile1Id,
                    sampleName: mockProfile1.sampleName
                },
                profile2: {
                    id: profile2Id,
                    sampleName: mockProfile2.sampleName
                },
                bayesianAnalysis: {
                    overallLR: lrResult.overallLR,
                    logLR: lrResult.logLR,
                    significance: lrResult.significance,
                    colorCode: lrResult.colorCode,
                    confidenceInterval: lrResult.confidenceInterval,
                    interpretation: interpretLR(lrResult.overallLR)
                },
                overallMatch: Math.round((matchingLoci / totalLoci) * 100),
                matchingLoci,
                totalLoci,
                lociComparison,
                comparisonDate: new Date().toISOString(),
                analysisMethod: 'Bayesian Likelihood Ratio',
                populationUsed: mockPopulationData.name,
                calculationMetadata: lrResult.calculationMetadata
            };

            logger.info('Profile comparison completed with Bayesian analysis', {
                profile1Id,
                profile2Id,
                overallLR: lrResult.overallLR,
                significance: lrResult.significance,
                matchingLoci,
                totalLoci,
                userId: req.user.id
            });

            res.json({
                success: true,
                ...comparisonResult
            });

        } catch (bayesianError) {
            // Fallback to mock data if Bayesian analysis fails
            console.log('🔍 DEBUG: Bayesian analysis error:', bayesianError.message);
            console.log('🔍 DEBUG: Stack trace:', bayesianError.stack);
            logger.warn('Bayesian analysis failed, falling back to mock comparison', {
                error: bayesianError.message,
                profile1Id,
                profile2Id,
                userId: req.user.id
            });

            // Original mock comparison logic as fallback
            const mockLociComparison = {
                'D3S1358': { profile1: '15,16', profile2: '15,16', match: true },
                'vWA': { profile1: '17,18', profile2: '17,19', match: false },
                'D16S539': { profile1: '11,12', profile2: '11,12', match: true },
                'CSF1PO': { profile1: '10,12', profile2: '10,12', match: true },
                'TPOX': { profile1: '8,11', profile2: '8,11', match: true },
                'D8S1179': { profile1: '13,14', profile2: '13,15', match: false },
                'D21S11': { profile1: '30,32.2', profile2: '30,32.2', match: true },
                'D18S51': { profile1: '14,17', profile2: '14,17', match: true },
                'DYS391': { profile1: '10', profile2: '11', match: false },
                'D2S441': { profile1: '11,14', profile2: '11,14', match: true },
                'AMEL': { profile1: 'X,Y', profile2: 'X,Y', match: true }
            };

            const matchingLoci = Object.values(mockLociComparison).filter(locus => locus.match).length;
            const totalLoci = Object.keys(mockLociComparison).length;
            const overallMatch = Math.round((matchingLoci / totalLoci) * 100);

            const comparisonResult = {
                profile1: {
                    id: profile1Id,
                    sampleName: profile1Id === 'mock-profile-1' ? 'Test Sample 1' : 
                               profile1Id === 'mock-profile-2' ? 'Test Sample 2' : 
                               'DNA Profile Sample'
                },
                profile2: {
                    id: profile2Id,
                    sampleName: profile2Id === 'mock-profile-1' ? 'Test Sample 1' : 
                               profile2Id === 'mock-profile-2' ? 'Test Sample 2' : 
                               'DNA Profile Sample'
                },
                overallMatch,
                matchingLoci,
                totalLoci,
                lociComparison: mockLociComparison,
                comparisonDate: new Date().toISOString(),
                analysisMethod: 'Simple Mock Comparison (Fallback)',
                note: 'Bayesian analysis unavailable - using fallback comparison'
            };

            res.json({
                success: true,
                ...comparisonResult
            });
        }

    } catch (error) {
        logger.error('Profile comparison failed', {
            error: error.message,
            profile1Id: req.body.profile1Id,
            profile2Id: req.body.profile2Id,
            userId: req.user?.id
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Comparison failed'
        });
    }
});

// Get accessible profiles for current user (includes user's own profiles + department profiles if authorized)
router.get('/accessible', authenticate, async (req, res) => {
  try {
    const { limit = 100, offset = 0, profile_type } = req.query;
    const scope = await ProfileAccessService.getScope(profileAccessContext(req));
    const options = { limit: parseInt(limit), offset: parseInt(offset), profile_type };
    const profiles = await DNAProfile.findInAccessScope(scope, options);
    const totalCount = await DNAProfile.countInAccessScope(scope, options);

    res.json({
      profiles: profiles.map(p => {
        const profileData = p.toJSON();
        
        // Add import_number field and fix internal_number mapping to the response
        return {
          ...profileData,
          internal_number: profileData.internalNumber, // Исправляем маппинг поля
          import_number: extractImportNumber(profileData),
          
        };
      }),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: totalCount,
        hasMore: (parseInt(offset) + profiles.length) < totalCount
      },
      context: {
        user_role: req.user.role,
        user_department_id: req.activeDepartmentId,
        access_level: scope.accessLevel
      }
    });

  } catch (error) {
    respondProfileAccessError(req, res, error);
  }
});

/**
 * GET /api/profiles/count-by-task/:taskId
 * Получить количество профилей в задаче
 */
router.get('/count-by-task/:taskId', authenticate, async (req, res) => {
    try {
        const taskId = req.params.taskId;
        
        const count = await DNAProfile.countByTaskId(taskId);
        
        res.json({
            success: true,
            count: count
        });
    } catch (error) {
        logger.error('Error counting profiles by task', {
            error: error.message,
            taskId: req.params.taskId,
            userId: req.user?.id
        });

        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to count profiles'
        });
    }
});

/**
 * GET /api/profiles/count-by-user-30days
 * Получить количество профилей загруженных пользователем за последние 30 дней
 */
router.get('/count-by-user-30days', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const result = await DNAProfile.countByUserLast30Days(userId);
        
        res.json({
            success: true,
            count: result.count
        });
    } catch (error) {
        logger.error('Error counting profiles by user (30 days)', {
            error: error.message,
            userId: req.user?.id
        });

        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to count profiles'
        });
    }
});

// Get specific profile by ID with organizational access control
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await DNAProfile.findById(id);

    if (!profile) {
      return res.status(404).json({
        error: 'Profile not found',
        message: 'The requested DNA profile does not exist'
      });
    }

    if (!await requireProfileAccess(req, res, 'read')) return;

    res.json(profile.toJSON());

  } catch (error) {
    respondProfileAccessError(req, res, error);
  }
});

// Check for duplicate profiles with department scope
router.post('/check-duplicates', authenticate, adminOrAnalyst, async (req, res) => {
  try {
    const { strData, sampleName } = req.body;
    const userId = req.user.id;
    const departmentId = req.activeDepartmentId;

    if (!strData) {
      return res.status(400).json({
        error: 'Missing STR data',
        message: 'STR data is required for duplicate checking'
      });
    }

    // Check for STR data duplicates within department scope
    const strDuplicates = await DNAProfile.findDuplicatesInDepartment(strData, departmentId);
    
    // Check for sample name duplicates if provided (within user's own profiles)
    let sampleNameDuplicates = [];
    if (sampleName) {
      sampleNameDuplicates = await DNAProfile.findBySampleName(sampleName, userId, null, { departmentId });
    }

    res.json({
      hasDuplicates: strDuplicates.length > 0 || sampleNameDuplicates.length > 0,
      strDataDuplicates: strDuplicates.map(p => ({
        id: p.id,
        sampleName: p.sampleName,
        uploadDate: p.uploadDate,
        userId: p.userId,
        profileType: p.profile_type
      })),
      sampleNameDuplicates: sampleNameDuplicates.map(p => ({
        id: p.id,
        sampleName: p.sampleName,
        uploadDate: p.uploadDate
      })),
      context: {
        department_id: departmentId,
        scope: 'department'
      }
    });

  } catch (error) {
    logger.error('Error checking for duplicates', { 
      error: error.message, 
      userId: req.user?.id,
      departmentId: req.user?.department_id
    });

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to check for duplicates'
    });
  }
});

// Get all profiles with organizational filtering (admin and department heads)
router.get('/admin/all', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'system_administrator' && req.user.role !== 'department_head') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin or Department Head access required'
      });
    }

    const { limit = 100, offset = 0, department_id, profile_type } = req.query;
    
    let queryOptions = {
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    // System administrators can see all profiles, department heads only their department
    if (req.user.role === 'department_head') {
      queryOptions.department_id = req.user.department_id;
    } else if (department_id) {
      queryOptions.department_id = department_id;
    }

    if (profile_type) {
      queryOptions.profile_type = profile_type;
    }

    const profiles = await DNAProfile.findAllWithOrganizationalContext(queryOptions);
    const totalCount = await DNAProfile.countWithOrganizationalContext(queryOptions);

    res.json({
      profiles: profiles.map(p => {
        const profileData = p.toJSON();
        
        // Add import_number field and fix internal_number mapping to the response
        return {
          ...profileData,
          internal_number: profileData.internalNumber, // Исправляем маппинг поля
          import_number: extractImportNumber(profileData),
          
        };
      }),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: totalCount,
        hasMore: (parseInt(offset) + profiles.length) < totalCount
      },
      context: {
        user_role: req.user.role,
        user_department_id: req.user.department_id,
        filtered_department_id: queryOptions.department_id,
        profile_type: profile_type
      }
    });

  } catch (error) {
    logger.error('Error fetching all profiles', { 
      error: error.message, 
      userId: req.user?.id,
      userRole: req.user?.role,
      departmentId: req.user?.department_id
    });

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch profiles'
    });
  }
});

router.delete('/:id', authenticate, adminOrAnalyst, logProfileOperation(OperationHistory.OPERATION_TYPES.PROFILE_DELETE), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // First, check if profile exists and user has access
        const profile = await DNAProfile.findById(id);
        
        if (!profile) {
            return res.status(404).json({
                error: 'Profile not found',
                message: 'The requested DNA profile does not exist'
            });
        }

        if (!await requireProfileAccess(req, res, 'delete')) return;

        // Delete the profile (soft delete)
        const deleted = await DNAProfile.delete(id);
        
        if (!deleted) {
            return res.status(404).json({
                error: 'Profile not found',
                message: 'Profile may have already been deleted'
            });
        }

        // Cascade delete related match results
        const { query } = require('../config/database');
        await query(
            'DELETE FROM match_results WHERE profile_id_1 = $1 OR profile_id_2 = $1',
            [id]
        );

        logger.info('Profile deleted with cascade', {
            profileId: id,
            sampleName: profile.sampleName,
            deletedBy: userId
        });

        res.json({
            success: true,
            message: 'Profile and related match results deleted successfully',
            data: {
                profileId: id,
                sampleName: profile.sampleName
            }
        });

    } catch (error) {
        respondProfileAccessError(req, res, error);
    }
});

// Update profile
router.put('/:id', authenticate, adminOrAnalyst, logProfileOperation(OperationHistory.OPERATION_TYPES.PROFILE_UPDATE), async (req, res) => {
    try {
        const { id } = req.params;
        const { sampleName, notes } = req.body;
        const userId = req.user.id;

        // Validate input
        if (!sampleName && !notes) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'At least one field (sampleName or notes) must be provided'
            });
        }

        // Check if profile exists and user has access
        const profile = await DNAProfile.findById(id);
        
        if (!profile) {
            return res.status(404).json({
                error: 'Profile not found',
                message: 'The requested DNA profile does not exist'
            });
        }

        if (!await requireProfileAccess(req, res, 'update')) return;

        // Check for duplicate sample name if updating sample name
        if (sampleName && sampleName !== profile.sampleName) {
            const duplicates = await DNAProfile.findBySampleName(sampleName, profile.userId, id, { departmentId: req.activeDepartmentId });
            if (duplicates.length > 0) {
                return res.status(409).json({
                    error: 'Duplicate sample name',
                    message: 'A profile with this sample name already exists',
                    existingProfile: {
                        id: duplicates[0].id,
                        sampleName: duplicates[0].sampleName,
                        uploadDate: duplicates[0].uploadDate
                    }
                });
            }
        }

        // Prepare updates
        const updates = {};
        if (sampleName) updates.sampleName = sampleName;
        if (notes !== undefined) updates.notes = notes;

        // Update profile
        const updatedProfile = await DNAProfile.update(id, updates);
        
        if (!updatedProfile) {
            return res.status(404).json({
                error: 'Profile not found',
                message: 'Profile may have been deleted'
            });
        }

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: updatedProfile.toJSON()
        });

    } catch (error) {
        respondProfileAccessError(req, res, error);
    }
});

// ============================================
// Profile Deactivation and Comments API
// ============================================

/**
 * PUT /api/profiles/:id/toggle-active
 * Toggle profile active status (deactivate/activate)
 */
router.put('/:id/toggle-active', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;
        const { query } = require('../config/database');

        // Get current profile (without is_active filter)
        const result = await query(
            'SELECT * FROM dna_profiles WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        
        const profile = result.rows[0];

        if (!await requireProfileAccess(req, res, 'update', true)) return;

        // Check permissions
        const canModify = req.user.role === 'admin' || 
                         req.user.role === 'department_head' ||
                         profile.user_id === userId;
        
        if (!canModify) {
            logger.warn('Permission denied for toggle-active', {
                userId,
                userRole: req.user.role,
                profileUserId: profile.user_id,
                profileId: id
            });
            return res.status(403).json({ error: 'Permission denied' });
        }

        // Toggle active status
        const newStatus = !profile.is_active;

        // Update using NOW() for correct timezone
        if (!newStatus) {
            // Deactivating
            await query(
                `UPDATE dna_profiles 
                 SET is_active = $1, 
                     deactivated_by = $2, 
                     deactivated_at = NOW(), 
                     deactivation_reason = $3 
                 WHERE id = $4`,
                [newStatus, userId, reason || null, id]
            );
        } else {
            // Reactivating - clear deactivation data
            await query(
                `UPDATE dna_profiles 
                 SET is_active = $1, 
                     deactivated_by = NULL, 
                     deactivated_at = NULL, 
                     deactivation_reason = NULL 
                 WHERE id = $2`,
                [newStatus, id]
            );
        }

        logger.info('Profile active status toggled', {
            profileId: id,
            newStatus,
            userId,
            reason
        });

        res.json({
            success: true,
            is_active: newStatus,
            message: newStatus ? 'Profile activated' : 'Profile deactivated'
        });
    } catch (error) {
        respondProfileAccessError(req, res, error);
    }
});
/**
 * PUT /api/profiles/:id/comment
 * Add or update expert comment for a profile
 */
router.put('/:id/comment', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = req.body;
        const userId = req.user.id;
        const { query } = require('../config/database');

        // Get current profile (including deactivated)
        const result = await query(
            'SELECT * FROM dna_profiles WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        
        const profile = result.rows[0];

        if (!await requireProfileAccess(req, res, 'update', true)) return;

        // Check permissions
        const canComment = req.user.role === 'admin' || 
                          req.user.role === 'department_head' ||
                          req.user.role === 'analyst' ||
                          profile.user_id === userId;
        
        if (!canComment) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        // Update comment using NOW() for correct timezone
        await query(
            `UPDATE dna_profiles 
             SET expert_comment = $1, 
                 comment_updated_at = NOW(), 
                 comment_updated_by = $2 
             WHERE id = $3`,
            [comment || null, userId, id]
        );

        logger.info('Profile comment updated', {
            profileId: id,
            userId,
            hasComment: !!comment
        });

        res.json({
            success: true,
            message: 'Comment updated successfully'
        });
    } catch (error) {
        respondProfileAccessError(req, res, error);
    }
});
/**
 * GET /api/profiles/:id/comment
 * Get expert comment for a profile
 */
router.get('/:id/comment', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { query } = require('../config/database');

        // Get profile (including deactivated)
        const result = await query(
            'SELECT expert_comment, comment_updated_at, comment_updated_by FROM dna_profiles WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        
        if (!await requireProfileAccess(req, res, 'read', true)) return;

        const profile = result.rows[0];

        res.json({
            comment: profile.expert_comment || null,
            updated_at: profile.comment_updated_at || null,
            updated_by: profile.comment_updated_by || null
        });
    } catch (error) {
        respondProfileAccessError(req, res, error);
    }
});
/**
 * POST /api/tasks/:taskId/duplicate-groups/comment
 * Add or update comment for a duplicate group
 */
router.post('/tasks/:taskId/duplicate-groups/comment', authenticate, async (req, res) => {
    try {
        const { taskId } = req.params;
        const { groupIdentifier, comment } = req.body;
        const userId = req.user.id;
        const { query } = require('../config/database');

        if (!groupIdentifier || !comment) {
            return res.status(400).json({ error: 'Group identifier and comment are required' });
        }

        // Check if comment exists
        const existingComment = await query(
            'SELECT * FROM duplicate_group_comments WHERE task_id = $1 AND group_identifier = $2',
            [taskId, groupIdentifier]
        );

        if (existingComment.rows.length > 0) {
            // Update existing comment
            await query(
                `UPDATE duplicate_group_comments 
                 SET comment = $1, updated_at = NOW() 
                 WHERE task_id = $2 AND group_identifier = $3`,
                [comment, taskId, groupIdentifier]
            );
        } else {
            // Insert new comment
            await query(
                `INSERT INTO duplicate_group_comments 
                 (task_id, group_identifier, comment, created_by) 
                 VALUES ($1, $2, $3, $4)`,
                [taskId, groupIdentifier, comment, userId]
            );
        }

        logger.info('Duplicate group comment saved', {
            taskId,
            groupIdentifier,
            userId
        });

        res.json({
            success: true,
            message: 'Comment saved successfully'
        });
    } catch (error) {
        logger.error('Error saving duplicate group comment', {
            error: error.message,
            taskId: req.params.taskId
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to save comment'
        });
    }
});

/**
 * GET /api/tasks/:taskId/duplicate-groups/:groupId/comment
 * Get comment for a duplicate group
 */
router.get('/tasks/:taskId/duplicate-groups/:groupId/comment', authenticate, async (req, res) => {
    try {
        const { taskId, groupId } = req.params;
        const { query } = require('../config/database');

        const result = await query(
            'SELECT * FROM duplicate_group_comments WHERE task_id = $1 AND group_identifier = $2',
            [taskId, groupId]
        );

        if (result.rows.length === 0) {
            return res.json({ comment: null });
        }

        res.json({
            comment: result.rows[0].comment,
            created_by: result.rows[0].created_by,
            created_at: result.rows[0].created_at,
            updated_at: result.rows[0].updated_at
        });
    } catch (error) {
        logger.error('Error fetching duplicate group comment', {
            error: error.message,
            taskId: req.params.taskId,
            groupId: req.params.groupId
        });

        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch comment'
        });
    }
});

module.exports = router;
