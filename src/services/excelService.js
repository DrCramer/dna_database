const XLSX = require('xlsx');
const Joi = require('joi');
const { LociTypeDetector, ALL_LOCI } = require('../utils/lociTypeDetector');
const { logger } = require('../utils/logger');
const DNAProfile = require('../models/DNAProfile');
const { GenotypePanel } = require('../models/GenotypePanel');
const User = require('../models/User');
const { assertProfileUploadAllowed } = require('./profileUploadPolicy');
const { readConversionMetadata, CONVERSION_META_SHEET } = require('../utils/geneticConversionMetadata');
const { informativeAlleles, amelogeninTokens, normalizeSpecialAllele, isSpecialAllele, isMissingAllele } = require('../utils/alleleTokens');
const { resolveProfileImportFormat, normalizeObjectName, extractExpertiseNumber, geneticObjectKey, getGeneticHeaders, validateGeneticHeaders } = require('../utils/profileImportFormat');

// Импортируем конвертер латинских символов
const { LatinToCyrillicConverter } = require('./latinToCyrillicConverter');

// Complete genetic loci configuration - 80 genetic markers
// Includes STR loci, Y-chromosome markers, SNPs, and other genetic markers
const GENETIC_LOCI = ALL_LOCI;

// Legacy STR_LOCI for backward compatibility
const STR_LOCI = GENETIC_LOCI;

// Extended 40 STR/SNP markers configuration for the requirements
// This represents the core 40 markers that the system should prioritize
const EXTENDED_40_STR_SNP_MARKERS = [
  // Core 39 STR loci from original FM_DNA 1.0.0.html (backward compatibility)
  'D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'D8S1179', 'D21S11', 'D18S51',
  'D2S441', 'D19S433', 'TH01', 'FGA', 'D22S1045', 'D5S818', 'D13S317', 'D7S820',
  'D6S1043', 'D10S1248', 'D1S1656', 'D12S391', 'D2S1338', 'AMEL', 'D9S1122',
  'D18S853', 'D17S906', 'D4S2408', 'D8S1132', 'D1S1677', 'D20S482', 'D14S1434',
  'D11S4463', 'D15S659', 'D3S4529', 'D16S753', 'D17S1301', 'D18S1364', 'D2S1776',
  'D4S2366', 'D1S1627',
  // Additional SNP marker for extended analysis (40th marker)
  'Rs2032678'
];

// Compatibility modes for different analysis requirements
const COMPATIBILITY_MODES = {
  ORIGINAL_39: 'original_39_str', // Original FM_DNA 1.0.0.html compatibility
  EXTENDED_40: 'extended_40_str_snp', // Full extended analysis with 40 markers
  AUTO_DETECT: 'auto_detect', // Automatically detect based on input data
  FULL_80: 'full_80_markers' // Use all 80 supported markers
};

// Default configuration
const DEFAULT_CONFIG = {
  mode: COMPATIBILITY_MODES.AUTO_DETECT,
  minimumMatchThreshold: 15, // Configurable minimum match threshold
  enableBayesianAnalysis: true,
  defaultPopulation: 'caucasian', // Default population for LR calculations
  thetaCorrection: 0.01, // Default θ-correction value
  priorityMarkers: EXTENDED_40_STR_SNP_MARKERS
};

class ExcelParsingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ExcelParsingError';
    this.code = code;
    this.details = details;
  }
}

const EXCEL_ERROR_CODES = {
  INVALID_FILE_FORMAT: 'INVALID_FILE_FORMAT',
  MISSING_STR_COLUMNS: 'MISSING_STR_COLUMNS',
  INVALID_STR_COUNT: 'INVALID_STR_COUNT',
  INVALID_ALLELE_VALUE: 'INVALID_ALLELE_VALUE',
  EMPTY_FILE: 'EMPTY_FILE',
  MISSING_SAMPLE_NAME: 'MISSING_SAMPLE_NAME',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  VALIDATION_ERRORS: 'VALIDATION_ERRORS',
  INTERNAL_DUPLICATES: 'INTERNAL_DUPLICATES'
};

class ExcelService {
  constructor() {
    this.lociTypeDetector = new LociTypeDetector();
    this.latinConverter = new LatinToCyrillicConverter(); // Добавляем конвертер
  }

  /**
   * Parse Excel file and extract DNA profiles with multi-user context
   * @param {Buffer} fileBuffer - Excel file buffer
   * @param {string} filename - Original filename for error reporting
   * @param {Object} userContext - User context for multi-user functionality
   * @param {string} userContext.userId - User ID uploading the file
   * @param {string} userContext.departmentId - User's department ID
   * @param {string} userContext.organizationId - User's organization ID
   * @returns {Object} Parsing result with profiles and metadata
   */
  async resolveUserContext(context) {
    const user = await User.findById(context.userId);
    if (!user) throw new ExcelParsingError('Указан недопустимый пользователь.', 'INVALID_USER');
    const departments = await user.getAccessibleDepartments();
    const departmentId = context.departmentId || user.department_id;
    const department = departments.find(item => item.id === departmentId);
    if (!department) throw new ExcelParsingError('Нет доступа к активному отделению.', 'DEPARTMENT_ACCESS_DENIED');
    await assertProfileUploadAllowed(user, { ...context, departmentId: department.id });
    return {
      ...context,
      departmentId: department.id,
      organizationId: department.organization_id,
      departmentName: department.name,
      importFormat: resolveProfileImportFormat(department),
      userRole: user.role,
      username: user.username
    };
  }

  async parseExcelFileWithContext(fileBuffer, filename = 'unknown', userContext = {}, options = {}) {
    try {
      userContext = await this.resolveUserContext(userContext);
      const { userId, departmentId, organizationId, importFormat } = userContext;
      options = { ...options, importFormat };
      
      if (!userId) {
        throw new ExcelParsingError(
          'Для многопользовательской загрузки требуется контекст пользователя',
          EXCEL_ERROR_CODES.INVALID_FILE_FORMAT,
          { filename }
        );
      }

      // Parse Excel file using existing logic
      const profiles = await this.parseExcelFile(fileBuffer, filename, options);

      const assignments = new Map();
      const panelsForProfiles = [];
      for (const profile of profiles) {
        const panelId = options.panelId || userContext.panelId;
        const detectedPanelId = options.detectedPanelId || profile.metadata?.conversion?.detectedPanelId;
        const key = panelId || detectedPanelId || '';
        if (!assignments.has(key)) assignments.set(key, await GenotypePanel.resolveAssignment({ ...userContext, panelId, detectedPanelId }));
        panelsForProfiles.push(assignments.get(key));
      }
      const uniquePanels = [...new Set(panelsForProfiles.map(panel => panel?.id || null))];
      const panel = uniquePanels.length === 1 ? panelsForProfiles[0] : null;
      const panelWarnings = [...new Set(profiles.flatMap((profile, index) => GenotypePanel.compareLoci(panelsForProfiles[index], profile.metadata.sourceLoci || Object.keys(profile.strData))))];

      // Add user context to each profile
      const profilesWithContext = profiles.map((profile, index) => ({
        ...profile,
        panelId: panelsForProfiles[index]?.id || null,
        panel: panelsForProfiles[index],
        userId,
        departmentId,
        organizationId,
        fileSource: filename,
        importFormat: importFormat || 'emergency',
        metadata: { ...profile.metadata, departmentId, organizationId, panelLoci: panelsForProfiles[index]?.lociOrder || [], ...(panelsForProfiles[index] ? { panelId: panelsForProfiles[index].id, panelName: panelsForProfiles[index].name, panelLociOrder: panelsForProfiles[index].lociOrder } : {}) },
        uploadContext: {
          uploadedAt: new Date().toISOString(),
          uploadedBy: userId,
          department: departmentId,
          organization: organizationId
        }
      }));

      logger.info('Excel file parsed with multi-user context', {
        filename,
        profileCount: profilesWithContext.length,
        userId,
        departmentId,
        organizationId
      });

      return {
        profiles: profilesWithContext,
        panel,
        panelWarnings,
        metadata: {
          filename,
          importFormat,
          profileCount: profilesWithContext.length,
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
          department: departmentId,
          organization: organizationId
        }
      };
    } catch (error) {
      logger.error('Error parsing Excel file with context', { errorCode: error.code || 'IMPORT_ERROR', filename });
      throw error;
    }
  }

  /**
   * Process and store profiles with deduplication and master array comparison
   * @param {Array} profiles - Parsed profiles from Excel
   * @param {Object} userContext - User context
   * @param {Object} options - Processing options
   * @param {boolean} options.performDeduplication - Whether to perform deduplication
   * @param {boolean} options.compareMasterArray - Whether to compare with master array
   * @param {boolean} options.allowDuplicates - Whether to allow duplicate uploads
   * @returns {Object} Processing result with created profiles, duplicates, and matches
   */
  async processProfilesWithContext(profiles, userContext, options = {}) {
    const {
      performDeduplication = true,  // По умолчанию включена проверка дубликатов
      compareMasterArray = true,
      allowDuplicates = false
    } = options;

    const { userId, departmentId } = userContext;

    if (!userId) {
      throw new ExcelParsingError(
        'Для обработки профиля требуется контекст пользователя',
        EXCEL_ERROR_CODES.INVALID_FILE_FORMAT
      );
    }

    const result = {
      created: [],
      duplicates: [],
      masterArrayMatches: [],
      errors: [],
      summary: {
        totalProfiles: profiles.length,
        createdCount: 0,
        duplicateCount: 0,
        matchCount: 0,
        errorCount: 0
      }
    };

    try {
      const startTime = Date.now();
      logger.info('Starting profile processing', {
        userId,
        profileCount: profiles.length,
        performDeduplication,
        compareMasterArray
      });

      // Get user's accessible master arrays for comparison
      let masterArrayProfiles = [];
      if (compareMasterArray && departmentId) {
        const masterStartTime = Date.now();
        const accessibleProfiles = await DNAProfile.getAccessibleProfiles(userId, {
          includeMasterArray: true,
          departmentId,
          limit: 1000
        });
        masterArrayProfiles = accessibleProfiles.masterArrayProfiles || [];
        logger.info('Master array profiles loaded', {
          count: masterArrayProfiles.length,
          timeMs: Date.now() - masterStartTime
        });
      }

      // OPTIMIZATION 1: Batch duplicate check - get all existing profiles at once
      let existingProfiles = [];
      let existingProfileKeys = new Set(); // Для быстрой проверки по ключу year-internal_number
      
      const isGenetic = profiles.some(profile => profile.importFormat === 'genetic');
      const geneticChecks = isGenetic ? await DNAProfile.checkExistingProfiles(userId, profiles, userContext) : null;
      if (performDeduplication && !isGenetic) {
        const dedupStartTime = Date.now();
        
        // Get all user's profiles that might be duplicates
        existingProfiles = await DNAProfile.findByUserId(userId, { limit: 10000, departmentId });
        
        // Build a Set of keys for O(1) lookup
        existingProfiles.forEach(profile => {
          if (profile.year && profile.internalNumber) {
            const key = `${profile.year}-${profile.internalNumber}`;
            existingProfileKeys.add(key);
          }
        });
        
        logger.info('Existing profiles loaded for deduplication', {
          count: existingProfiles.length,
          uniqueKeys: existingProfileKeys.size,
          timeMs: Date.now() - dedupStartTime
        });
      }

      // OPTIMIZATION 2: Prepare profiles for batch insert
      const profilesToCreate = [];
      const profilesWithMasterMatches = [];

      // Process each profile (validation and duplicate check)
      for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        
        try {
          // Step 1: Check for duplicates using in-memory data
          if (isGenetic && geneticChecks[i].action === 'conflict') {
            result.duplicates.push({ sampleName: profile.sampleName, internalNumber: profile.internalNumber, importFormat: 'genetic', lociCount: profile.totalLociCount,
              reason: 'duplicate_object', existingProfiles: [geneticChecks[i].existing] });
            result.summary.duplicateCount++;
            continue;
          }
          if (!isGenetic && performDeduplication && !allowDuplicates) {
            const duplicateCheck = this.checkForDuplicatesInMemory(profile, existingProfiles, existingProfileKeys, userId);
            
            if (duplicateCheck.hasDuplicates) {
              result.duplicates.push({
                sampleName: profile.sampleName,
                internalNumber: profile.internalNumber,
                year: profile.year,
                reason: duplicateCheck.reason,
                existingProfiles: duplicateCheck.existingProfiles
              });
              result.summary.duplicateCount++;
              continue;
            }
          }

          // Step 2: Compare with master array if available
          let masterArrayMatches = [];
          if (compareMasterArray && masterArrayProfiles.length > 0) {
            masterArrayMatches = await this.compareWithMasterArray(
              profile, 
              masterArrayProfiles
            );
            
            if (masterArrayMatches.length > 0) {
              result.masterArrayMatches.push({
                sampleName: profile.sampleName,
                matches: masterArrayMatches
              });
              result.summary.matchCount++;
            }
          }

          // Prepare profile for batch creation
          profilesToCreate.push({
            userId,
            year: profile.year,
            importFormat: profile.importFormat,
            departmentId: userContext.departmentId,
            organizationId: userContext.organizationId,
            sampleName: profile.sampleName,
            panelId: profile.panelId || null,
            internalNumber: profile.internalNumber,
            importNumber: profile.importNumber,
            strData: profile.strData,
            fileSource: profile.fileSource,
            taskId: userContext.taskId || null,
            notes: JSON.stringify({
              ...profile.metadata,
              masterArrayMatches: masterArrayMatches.length,
              uploadContext: profile.uploadContext
            })
          });

          profilesWithMasterMatches.push(masterArrayMatches);
          
          // ВАЖНО: Добавляем профиль в existingProfiles для проверки дубликатов внутри файла
          if (performDeduplication && !allowDuplicates) {
            existingProfiles.push({
              sampleName: profile.sampleName,
              internalNumber: profile.internalNumber,
              year: profile.year,
              strData: profile.strData
            });
            
            // Добавляем ключ в Set для быстрой проверки
            if (profile.year && profile.internalNumber) {
              const key = `${profile.year}-${profile.internalNumber}`;
              existingProfileKeys.add(key);
            }
          }

        } catch (error) {
          result.errors.push({
            sampleName: profile.sampleName,
            internal_number: profile.internalNumber,
            year: profile.year,
            importFormat: profile.importFormat,
            rowNumber: profile.rowNumber,
            error: error.message,
            index: i
          });
          result.summary.errorCount++;
          
          logger.warn('Error processing individual profile', { panelId: profile.panelId || null, year: profile.year, errorCode: error.code || 'IMPORT_ERROR', userId });
        }
      }

      // OPTIMIZATION 3: Batch insert all profiles at once
      if (profilesToCreate.length > 0) {
        const insertStartTime = Date.now();
        logger.info('Starting batch insert', { count: profilesToCreate.length });
        
        let createdProfiles;
        try {
          createdProfiles = await DNAProfile.batchInsert(profilesToCreate, userId, profilesToCreate[0].fileSource, { uploadContext: userContext });
        } catch (error) {
          if (error.code === '23505' && error.constraint === 'idx_dna_profiles_genetic_object') {
            throw new ExcelParsingError('Объект уже загружен в активное отделение. Обновите предварительный просмотр и повторите загрузку.', 'OBJECT_CONFLICT');
          }
          throw error;
        }

        logger.info('Batch insert completed', {
          count: createdProfiles.length,
          timeMs: Date.now() - insertStartTime
        });

        // Map created profiles with their master array matches
        for (let i = 0; i < createdProfiles.length; i++) {
          result.created.push({
            profile: createdProfiles[i],
            masterArrayMatches: profilesWithMasterMatches[i]
          });
          result.summary.createdCount++;
        }
      }

      const totalTime = Date.now() - startTime;
      logger.info('Profile processing completed', {
        userId,
        departmentId,
        summary: result.summary,
        totalTimeMs: totalTime,
        avgTimePerProfile: profiles.length > 0 ? (totalTime / profiles.length).toFixed(2) : 0
      });

      return result;
    } catch (error) {
      logger.error('Error processing profiles with context', { errorCode: error.code || 'IMPORT_ERROR', userId, profileCount: profiles.length });
      throw error;
    }
  }

  /**
   * Check for duplicates using in-memory data (faster than DB queries)
   * @param {Object} profile - Profile to check
   * @param {Array} existingProfiles - Array of existing user profiles
   * @param {Set} existingProfileKeys - Set of existing year-internal_number keys
   * @param {string} userId - User ID
   * @returns {Object} Duplicate check result
   */
  checkForDuplicatesInMemory(profile, existingProfiles, existingProfileKeys, userId) {
    // FAST CHECK: Check by year-internal_number key first (O(1))
    if (profile.year && profile.internalNumber && existingProfileKeys) {
      const key = `${profile.year}-${profile.internalNumber}`;
      if (existingProfileKeys.has(key)) {
        // Find the actual profile for details
        const duplicate = existingProfiles.find(existing => 
          existing.year === profile.year && 
          existing.internalNumber === profile.internalNumber
        );
        
        return {
          hasDuplicates: true,
          reason: 'duplicate_year_internal_number',
          existingProfiles: duplicate ? [{
            id: duplicate.id,
            sampleName: duplicate.sampleName,
            internalNumber: duplicate.internalNumber,
            year: duplicate.year,
            uploadDate: duplicate.uploadDate,
            taskId: duplicate.taskId,
            userId: duplicate.userId
          }] : []
        };
      }
    }
    
    // Check for identical STR data
    const strDataString = JSON.stringify(profile.strData);
    const strDuplicates = existingProfiles.filter(existing => {
      const existingStrData = JSON.stringify(existing.strData);
      return existingStrData === strDataString;
    });

    if (strDuplicates.length > 0) {
      return {
        hasDuplicates: true,
        reason: 'identical_str_data',
        existingProfiles: strDuplicates.map(dup => ({
          id: dup.id,
          sampleName: dup.sampleName,
          year: dup.year,
          internalNumber: dup.internalNumber,
          uploadDate: dup.uploadDate,
          taskId: dup.taskId,
          userId: dup.userId
        }))
      };
    }

    // УДАЛЕНО: Проверка по sample_name убрана, так как sample_name может повторяться
    // при разных internal_number (это нормально и не является дубликатом)
    
    // Если дубликатов не найдено
    return {
      hasDuplicates: false,
      reason: null,
      existingProfiles: []
    };
  }

  /**
   * Check for duplicate profiles in user's data
   * @param {Object} profile - Profile to check
   * @param {string} userId - User ID
   * @returns {Object} Duplicate check result
   */
  async checkForDuplicates(profile, userId) {
    try {
      // Check for identical STR data
      const strDuplicates = await DNAProfile.findDuplicates(profile.strData);
      const userStrDuplicates = strDuplicates.filter(dup => dup.userId === userId);

      if (userStrDuplicates.length > 0) {
        return {
          hasDuplicates: true,
          reason: 'identical_str_data',
          existingProfiles: userStrDuplicates.map(dup => ({
            id: dup.id,
            sampleName: dup.sampleName,
            uploadDate: dup.uploadDate
          }))
        };
      }

      // УДАЛЕНО: Проверка по sample_name убрана, так как sample_name может повторяться
      // при разных internal_number (это нормально и не является дубликатом)

      return {
        hasDuplicates: false,
        reason: null,
        existingProfiles: []
      };
    } catch (error) {
      logger.error('Error checking for duplicates', { errorCode: error.code || 'IMPORT_ERROR', userId });
      throw error;
    }
  }

  /**
   * Compare profile with department master array
   * @param {Object} profile - Profile to compare
   * @param {Array} masterArrayProfiles - Master array profiles
   * @returns {Array} Array of matches above threshold
   */
  async compareWithMasterArray(profile, masterArrayProfiles) {
    try {
      const matches = [];
      const minMatchThreshold = 15; // Configurable threshold

      // Import DNAAnalysisService for comparison
      const { DNAAnalysisService } = require('./dnaAnalysisService');
      const analysisService = new DNAAnalysisService();

      for (const masterProfile of masterArrayProfiles) {
        try {
          // Ensure both profiles have the required structure
          if (!profile.strData || !masterProfile.strData) {
            continue;
          }

          const comparison = await analysisService.compareProfiles(
            profile,
            masterProfile,
            { minNumericMatches: minMatchThreshold }
          );

          if (comparison.passesThreshold) {
            matches.push({
              masterProfileId: masterProfile.id,
              masterSampleName: masterProfile.sampleName,
              matchPercentage: comparison.overallMatch,
              numericMatches: comparison.numericMatchCount,
              totalComparisons: comparison.totalComparisons,
              comparisonDetails: comparison.locusMatches
            });
          }
        } catch (comparisonError) {
          logger.warn('Error comparing with master profile', { errorCode: comparisonError.code || 'IMPORT_ERROR' });
        }
      }

      // Sort matches by match percentage (descending)
      matches.sort((a, b) => b.matchPercentage - a.matchPercentage);

      return matches;
    } catch (error) {
      logger.error('Error comparing with master array', { errorCode: error.code || 'IMPORT_ERROR' });
      return [];
    }
  }

  /**
   * Bulk upload and process Excel file with full multi-user support
   * @param {Buffer} fileBuffer - Excel file buffer
   * @param {string} filename - Original filename
   * @param {Object} userContext - User context
   * @param {Object} options - Processing options
   * @returns {Object} Complete upload result
   */
  async bulkUploadWithContext(fileBuffer, filename, userContext, options = {}) {
    try {
      // Validate user context
      if (!userContext.userId) {
        throw new ExcelParsingError(
          'Для массовой загрузки требуется ID пользователя',
          EXCEL_ERROR_CODES.INVALID_FILE_FORMAT,
          { filename }
        );
      }

      // Сохраняем активное отделение и повторно проверяем доступ к нему.
      const enrichedUserContext = await this.resolveUserContext(userContext);

      // Step 1: Parse Excel file
      const parseResult = await this.parseExcelFileWithContext(
        fileBuffer,
        filename,
        enrichedUserContext,
        options.parsingOptions || {}
      );

      // Step 2: Process profiles with deduplication and master array comparison
      const processResult = await this.processProfilesWithContext(
        parseResult.profiles,
        enrichedUserContext,
        options
      );

      // Step 3: Compile final result
      const finalResult = {
        uploadId: require('crypto').randomUUID(),
        taskId: enrichedUserContext.taskId || null,
        filename,
        uploadedBy: enrichedUserContext.username,
        uploadedAt: new Date().toISOString(),
        importFormat: enrichedUserContext.importFormat,
        department: enrichedUserContext.departmentId,
        organization: enrichedUserContext.organizationId,
        parsing: {
          totalParsed: parseResult.profiles.length,
          parseErrors: []
        },
        processing: {
          created: processResult.created,
          duplicates: processResult.duplicates,
          masterArrayMatches: processResult.masterArrayMatches,
          errors: processResult.errors,
          summary: processResult.summary
        },
        recommendations: this.generateUploadRecommendations(processResult)
      };

      logger.info('Bulk upload completed', {
        uploadId: finalResult.uploadId,
        filename,
        userId: userContext.userId,
        summary: processResult.summary
      });

      return finalResult;
    } catch (error) {
      logger.error('Error in bulk upload with context', { errorCode: error.code || 'IMPORT_ERROR', filename });
      throw error;
    }
  }

  /**
   * Generate recommendations based on upload results
   * @param {Object} processResult - Processing result
   * @returns {Array} Array of recommendations
   */
  generateUploadRecommendations(processResult) {
    const recommendations = [];

    if (processResult.duplicates.length > 0) {
      recommendations.push({
        type: 'warning',
        title: 'Duplicate Profiles Detected',
        message: `${processResult.duplicates.length} profiles were skipped due to duplicates. Review existing data before re-uploading.`,
        action: 'review_duplicates'
      });
    }

    if (processResult.masterArrayMatches.length > 0) {
      const highMatches = processResult.masterArrayMatches.filter(
        match => match.matches.some(m => m.matchPercentage >= 80)
      ).length;

      if (highMatches > 0) {
        recommendations.push({
          type: 'info',
          title: 'Master Array Matches Found',
          message: `${highMatches} profiles have high similarity matches with the department master array. Consider reviewing for potential relationships.`,
          action: 'review_matches'
        });
      }
    }

    if (processResult.errors.length > 0) {
      recommendations.push({
        type: 'error',
        title: 'Processing Errors',
        message: `${processResult.errors.length} profiles could not be processed. Check data format and try again.`,
        action: 'review_errors'
      });
    }

    if (processResult.summary.createdCount > 0) {
      recommendations.push({
        type: 'success',
        title: 'Upload Successful',
        message: `${processResult.summary.createdCount} profiles were successfully uploaded and are ready for analysis.`,
        action: 'start_analysis'
      });
    }

    return recommendations;
  }
  /**
   * Assess data quality of extracted loci data
   * @param {Object} lociData - Loci data object
   * @returns {string} Quality assessment
   */
  assessDataQuality(lociData) {
    const totalLoci = Object.keys(lociData).length;
    const emptyLoci = Object.values(lociData).filter(alleles => 
      !Array.isArray(alleles) || alleles.length === 0
    ).length;
    
    const completeness = ((totalLoci - emptyLoci) / totalLoci) * 100;
    
    if (completeness >= 95) return 'excellent';
    if (completeness >= 85) return 'good';
    if (completeness >= 70) return 'fair';
    return 'poor';
  }

  /**
   * Get recommended analysis type based on available data
   * @param {Object} lociData - Loci data object
   * @param {Object} validationResult - Validation result
   * @returns {string} Recommended analysis type
   */
  getRecommendedAnalysisType(lociData, validationResult) {
    const strCount = Object.keys(lociData).filter(locus => 
      this.lociTypeDetector.detectLocusType(locus) === 'STR'
    ).length;
    
    const snpCount = Object.keys(lociData).filter(locus => 
      this.lociTypeDetector.detectLocusType(locus) === 'SNP'
    ).length;

    const priorityMarkerCount = Object.keys(lociData).filter(locus => 
      EXTENDED_40_STR_SNP_MARKERS.includes(locus)
    ).length;

    if (priorityMarkerCount >= 35 && snpCount > 0) {
      return 'extended_40_analysis';
    } else if (strCount >= 30 && snpCount === 0) {
      return 'original_39_analysis';
    } else if (strCount >= 15) {
      return 'standard_str_analysis';
    } else {
      return 'limited_analysis';
    }
  }

  /**
   * Enhanced parseExcelFile method with 40 STR/SNP support
   * @param {Buffer} fileBuffer - Excel file buffer
   * @param {string} filename - Original filename for error reporting
   * @param {Object} options - Parsing options
   * @param {string} options.mode - Compatibility mode
   * @param {number} options.minRequiredLoci - Minimum required loci
   * @returns {Array} Array of DNA profiles
   */
  async parseExcelFile(fileBuffer, filename = 'unknown', options = {}) {
    try {
      // Read Excel file
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new ExcelParsingError(
          'Excel файл не содержит листов',
          EXCEL_ERROR_CODES.EMPTY_FILE,
          { filename }
        );
      }

      // Use first worksheet
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const isGenetic = options.importFormat === 'genetic';
      const range = isGenetic && worksheet['!ref']
        ? { s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(worksheet['!ref']).e } : undefined;
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, ...(range ? { range } : {}) });
      if (range && jsonData.length) {
        jsonData[0] = getGeneticHeaders(jsonData);
      }

      if (!jsonData || jsonData.length === 0) {
        throw new ExcelParsingError(
          'Excel файл пуст или не содержит данных',
          EXCEL_ERROR_CODES.EMPTY_FILE,
          { filename }
        );
      }

      // Validate and extract profiles with enhanced 40 STR/SNP support
      const profiles = this.extractProfiles(jsonData, filename, { ...options, converted: isGenetic && !!workbook.Sheets[CONVERSION_META_SHEET] });
      if (isGenetic) {
        const columns = validateGeneticHeaders(jsonData[0]).columns.map(column => column.locus);
        const metadata = readConversionMetadata(workbook, profiles, columns);
        const fullCatalog = columns.length === ALL_LOCI.length && ALL_LOCI.every(locus => columns.includes(locus));
        const fallback = fullCatalog ? columns.filter(locus => profiles.some(profile => profile.strData[locus]?.length)) : columns;
        for (const profile of profiles) {
          const entry = metadata?.get(geneticObjectKey(profile.internalNumber));
          const sourceLoci = entry?.sourceLoci || fallback;
          // Минимум три заголовка уже проверен; без метаданных заполненных локусов может быть меньше.
          profile.strData = Object.fromEntries(sourceLoci.map(locus => [locus, profile.strData[locus] || []]));
          profile.lociData = profile.strData;
          profile.lociTypes = Object.fromEntries(sourceLoci.map(locus => [locus, this.lociTypeDetector.detectLocusType(locus)]));
          profile.priorityMarkers = Object.fromEntries(sourceLoci.filter(locus => EXTENDED_40_STR_SNP_MARKERS.includes(locus)).map(locus => [locus, true]));
          profile.priorityMarkerCount = Object.keys(profile.priorityMarkers).length;
          profile.totalLociCount = sourceLoci.length;
          profile.strLociCount = sourceLoci.filter(locus => this.lociTypeDetector.detectLocusType(locus) === 'STR').length;
          profile.snpLociCount = sourceLoci.filter(locus => this.lociTypeDetector.detectLocusType(locus) === 'SNP').length;
          profile.metadata = { ...profile.metadata, catalogLoci: [...ALL_LOCI], sourceLoci, populatedLoci: sourceLoci.filter(locus => profile.strData[locus].length),
            populatedLociCount: sourceLoci.filter(locus => profile.strData[locus].length).length, lociTypeBreakdown: this.getLociTypeBreakdown(profile.strData),
            compatibilityInfo: { ...profile.metadata.compatibilityInfo, totalLociCount: sourceLoci.length, priorityMarkerCount: profile.priorityMarkerCount },
            qualityMetrics: { ...profile.metadata.qualityMetrics, completeness: sourceLoci.filter(locus => informativeAlleles(profile.strData[locus]).length).length / sourceLoci.length * 100, dataQuality: this.assessDataQuality(Object.fromEntries(sourceLoci.map(locus => [locus, informativeAlleles(profile.strData[locus])]))) },
            ...(entry ? { conversion: entry } : {}) };
        }
      }
      return profiles;
    } catch (error) {
      if (error instanceof ExcelParsingError) {
        throw error;
      }
      
      throw new ExcelParsingError(
        `Не удалось разобрать Excel файл: ${error.message}`,
        EXCEL_ERROR_CODES.INVALID_FILE_FORMAT,
        { filename, originalError: error.message }
      );
    }
  }

  /**
   * Extract DNA profiles from parsed Excel data with enhanced 40 STR/SNP support
   * @param {Array} jsonData - Parsed Excel data
   * @param {string} filename - Original filename
   * @param {Object} options - Extraction options
   * @param {string} options.mode - Compatibility mode
   * @param {number} options.minRequiredLoci - Minimum required loci
   * @returns {Array} Array of DNA profiles
   */
  extractProfiles(jsonData, filename, options = {}) {
    const startTime = Date.now();
    

    
    if (jsonData.length < 2) {
      throw new ExcelParsingError(
        'Excel файл должен содержать как минимум строку заголовков и одну строку данных',
        EXCEL_ERROR_CODES.EMPTY_FILE,
        { filename }
      );
    }

    const headers = jsonData[0];
    const dataRows = jsonData.slice(1);

    // Enhanced header validation with 40 STR/SNP support
    const validationResult = this.validateHeaders(headers, filename, options);
    
    logger.info('Headers validated', {
      filename,
      mode: validationResult.mode,
      recognizedMarkers: validationResult.recognizedMarkers,
      timeMs: Date.now() - startTime
    });

    const profiles = [];
    const validationErrors = []; // Собираем все ошибки валидации
    
    // OPTIMIZATION: Pre-filter empty rows to avoid processing them
    const nonEmptyRows = [];
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (row && (options.importFormat === 'genetic' ? row.some(cell => normalizeObjectName(cell) !== '') : !row.every(cell => !cell || cell.toString().trim() === ''))) {
        nonEmptyRows.push({ row, originalIndex: i });
      }
    }
    
    logger.info('Empty rows filtered', {
      filename,
      totalRows: dataRows.length,
      nonEmptyRows: nonEmptyRows.length,
      timeMs: Date.now() - startTime
    });
    
    // Process non-empty rows
    for (let i = 0; i < nonEmptyRows.length; i++) {
      const { row, originalIndex } = nonEmptyRows[i];
      const rowNumber = originalIndex + 2; // +2 because we start from row 1 and skip header

      try {
        const profile = (options.importFormat === 'genetic' ? this.extractGeneticProfileFromRow : this.extractProfileFromRow).call(this,
          row, 
          headers, 
          rowNumber, 
          filename, 
          validationResult,
          options
        );
        profile.rowNumber = rowNumber; // Сохраняем номер строки для проверки дубликатов
        profiles.push(profile);
      } catch (error) {
        if (error instanceof ExcelParsingError) {
          error.details.rowNumber = rowNumber;
          // Собираем ошибку вместо того чтобы сразу выбрасывать
          validationErrors.push({
            rowNumber,
            message: error.message,
            details: error.details,
            code: error.code
          });
        } else {
          validationErrors.push({
            rowNumber,
            message: `Ошибка обработки строки ${rowNumber}: ${error.message}`,
            details: { filename, rowNumber, originalError: error.message },
            code: EXCEL_ERROR_CODES.INVALID_ALLELE_VALUE
          });
        }
      }
    }
    
    logger.info('Profiles extracted', {
      filename,
      profileCount: profiles.length,
      errorCount: validationErrors.length,
      timeMs: Date.now() - startTime
    });
    
    // Если есть ошибки валидации, выбрасываем их все сразу
    if (validationErrors.length > 0) {
      const errorMessage = validationErrors.length === 1
        ? validationErrors[0].message
        : `Найдено ошибок валидации: ${validationErrors.length}`;
      
      throw new ExcelParsingError(
        errorMessage,
        EXCEL_ERROR_CODES.VALIDATION_ERRORS,
        { 
          filename, 
          validationErrors,
          errorCount: validationErrors.length
        }
      );
    }
    
    if (options.importFormat === 'genetic' && profiles.length === 0) {
      throw new ExcelParsingError('В файле отсутствуют строки с ДНК-профилями.', EXCEL_ERROR_CODES.EMPTY_FILE, { filename });
    }

    // ПРОВЕРКА ДУБЛИКАТОВ ВНУТРИ ФАЙЛА
    // OPTIMIZATION: Use Map for O(1) lookup instead of array search
    const profileKeys = new Map(); // key -> {rowNumber, sampleName}
    const internalDuplicates = [];
    
    for (const profile of profiles) {
      if (profile.importFormat === 'genetic' || (profile.year && profile.internalNumber)) {
        const key = profile.importFormat === 'genetic' ? geneticObjectKey(profile.internalNumber) : `${profile.year}-${profile.internalNumber}`;
        
        if (profileKeys.has(key)) {
          // Найден дубликат!
          const firstOccurrence = profileKeys.get(key);
          internalDuplicates.push({
            key,
            year: profile.year,
            internalNumber: profile.internalNumber,
            sampleName: profile.sampleName,
            firstRow: firstOccurrence.rowNumber,
            duplicateRow: profile.rowNumber
          });
        } else {
          profileKeys.set(key, {
            rowNumber: profile.rowNumber,
            sampleName: profile.sampleName
          });
        }
      }
    }
    
    logger.info('Duplicate check completed', {
      filename,
      duplicatesFound: internalDuplicates.length,
      timeMs: Date.now() - startTime
    });
    
    // Если найдены дубликаты внутри файла - это критическая ошибка
    if (internalDuplicates.length > 0) {
      throw new ExcelParsingError(
        options.importFormat === 'genetic'
          ? internalDuplicates.map(dup => `Обнаружен дубликат объекта «${dup.internalNumber}»: первая строка ${dup.firstRow}, повторная строка ${dup.duplicateRow}.`).join('\n')
          : `Обнаружены дубликаты внутри файла: ${internalDuplicates.length} повторяющихся номеров образцов`,
        EXCEL_ERROR_CODES.INTERNAL_DUPLICATES,
        { 
          filename, 
          internalDuplicates,
          duplicateCount: internalDuplicates.length
        }
      );
    }

    if (profiles.length === 0) {
      throw new ExcelParsingError(
        'В Excel файле не найдено валидных ДНК профилей',
        EXCEL_ERROR_CODES.EMPTY_FILE,
        { filename }
      );
    }

    // Add validation metadata to profiles
    profiles.forEach(profile => {
      profile.validationResult = validationResult;
      profile.compatibilityMode = validationResult.mode;
    });

    const totalTime = Date.now() - startTime;
    logger.info('Profile extraction completed', {
      filename,
      profileCount: profiles.length,
      totalTimeMs: totalTime,
      avgTimePerProfile: (totalTime / profiles.length).toFixed(2)
    });

    return profiles;
  }

  /**
   * Validate Excel headers contain genetic loci with enhanced 40 STR/SNP support
   * @param {Array} headers - Excel headers
   * @param {string} filename - Original filename
   * @param {Object} options - Validation options
   * @param {string} options.mode - Compatibility mode
   * @param {number} options.minRequiredLoci - Minimum required loci
   */
  validateHeaders(headers, filename, options = {}) {
    if (options.importFormat === 'genetic') {
      const result = validateGeneticHeaders(headers, options.minRequiredLoci || 3);
      if (!result.valid) throw new ExcelParsingError(result.errors.map(e => e.message).join('\n'),
        result.errors[0].code, { filename, errors: result.errors });
      return { ...result, mode: COMPATIBILITY_MODES.AUTO_DETECT };
    }

    const { 
      mode = COMPATIBILITY_MODES.AUTO_DETECT, 
      minRequiredLoci = 3 
    } = options;

    if (!headers || headers.length === 0) {
      throw new ExcelParsingError(
        'Excel файл не содержит заголовков',
        EXCEL_ERROR_CODES.MISSING_STR_COLUMNS,
        { filename }
      );
    }

    // Find sample name column (usually first column)
    const sampleNameIndex = 0;
    const strHeaders = headers.slice(1); // Skip first column (sample name)

    // Enhanced validation based on compatibility mode
    if (mode === COMPATIBILITY_MODES.ORIGINAL_39) {
      return this.validateOriginal39Headers(strHeaders, filename);
    } else if (mode === COMPATIBILITY_MODES.EXTENDED_40) {
      return this.validateExtended40Headers(strHeaders, filename);
    } else if (mode === COMPATIBILITY_MODES.FULL_80) {
      return this.validateFull80Headers(strHeaders, filename);
    } else {
      // AUTO_DETECT mode - flexible validation
      return this.validateAutoDetectHeaders(strHeaders, filename, minRequiredLoci);
    }
  }

  /**
   * Validate headers for original 39 STR markers compatibility
   * @param {Array} strHeaders - STR headers (excluding sample name)
   * @param {string} filename - Original filename
   */
  validateOriginal39Headers(strHeaders, filename) {
    const original39Markers = EXTENDED_40_STR_SNP_MARKERS.slice(0, 39);
    
    if (strHeaders.length < 35) {
      throw new ExcelParsingError(
        `Excel файл должен содержать как минимум 35 STR локусов для оригинальной совместимости, найдено ${strHeaders.length}`,
        EXCEL_ERROR_CODES.INVALID_STR_COUNT,
        { 
          filename, 
          expected: 'at least 35', 
          found: strHeaders.length,
          mode: 'original_39'
        }
      );
    }

    // Check how many of the original 39 markers are present
    const presentOriginalMarkers = strHeaders.filter(header => 
      original39Markers.includes(header)
    );

    if (presentOriginalMarkers.length < 30) {

    }

    return {
      mode: COMPATIBILITY_MODES.ORIGINAL_39,
      totalHeaders: strHeaders.length,
      recognizedMarkers: presentOriginalMarkers.length,
      supportedMarkers: presentOriginalMarkers
    };
  }

  /**
   * Validate headers for extended 40 STR/SNP markers
   * @param {Array} strHeaders - STR headers (excluding sample name)
   * @param {string} filename - Original filename
   */
  validateExtended40Headers(strHeaders, filename) {
    if (strHeaders.length < 35) {
      throw new ExcelParsingError(
        `Excel файл должен содержать как минимум 35 локусов для расширенного анализа 40 маркеров, найдено ${strHeaders.length}`,
        EXCEL_ERROR_CODES.INVALID_STR_COUNT,
        { 
          filename, 
          expected: 'at least 35', 
          found: strHeaders.length,
          mode: 'extended_40'
        }
      );
    }

    // Check how many of the extended 40 markers are present
    const presentExtendedMarkers = strHeaders.filter(header => 
      EXTENDED_40_STR_SNP_MARKERS.includes(header)
    );

    if (presentExtendedMarkers.length < 30) {

    }

    // Check for SNP markers specifically
    const presentSNPMarkers = strHeaders.filter(header => 
      this.lociTypeDetector.detectLocusType(header) === 'SNP'
    );

    return {
      mode: COMPATIBILITY_MODES.EXTENDED_40,
      totalHeaders: strHeaders.length,
      recognizedMarkers: presentExtendedMarkers.length,
      supportedMarkers: presentExtendedMarkers,
      snpMarkers: presentSNPMarkers.length,
      hasExtendedSupport: presentSNPMarkers.length > 0
    };
  }

  /**
   * Validate headers for full 80 marker support
   * @param {Array} strHeaders - STR headers (excluding sample name)
   * @param {string} filename - Original filename
   */
  validateFull80Headers(strHeaders, filename) {
    if (strHeaders.length < 10) {
      throw new ExcelParsingError(
        `Excel файл должен содержать как минимум 10 генетических локусов для полного анализа маркеров, найдено ${strHeaders.length}`,
        EXCEL_ERROR_CODES.INVALID_STR_COUNT,
        { 
          filename, 
          expected: 'at least 10', 
          found: strHeaders.length,
          mode: 'full_80'
        }
      );
    }

    // Validate that provided loci are recognized
    const recognizedLoci = strHeaders.filter(header => 
      this.lociTypeDetector.isLocusSupported(header)
    );

    const unrecognizedLoci = strHeaders.filter(header => 
      !this.lociTypeDetector.isLocusSupported(header)
    );

    if (unrecognizedLoci.length > 0) {

    }

    return {
      mode: COMPATIBILITY_MODES.FULL_80,
      totalHeaders: strHeaders.length,
      recognizedMarkers: recognizedLoci.length,
      supportedMarkers: recognizedLoci,
      unrecognizedMarkers: unrecognizedLoci
    };
  }

  /**
   * Auto-detect validation - flexible approach
   * @param {Array} strHeaders - STR headers (excluding sample name)
   * @param {string} filename - Original filename
   * @param {number} minRequiredLoci - Minimum required loci
   */
  validateAutoDetectHeaders(strHeaders, filename, minRequiredLoci) {
    // Backward compatibility: Accept files with fewer loci
    if (strHeaders.length < minRequiredLoci) {
      throw new ExcelParsingError(
        `Excel файл должен содержать как минимум ${minRequiredLoci} столбцов генетических локусов, найдено ${strHeaders.length}`,
        EXCEL_ERROR_CODES.INVALID_STR_COUNT,
        { 
          filename, 
          expected: `at least ${minRequiredLoci}`, 
          found: strHeaders.length,
          foundHeaders: strHeaders
        }
      );
    }

    // Validate that provided loci are recognized
    const recognizedLoci = strHeaders.filter(header => 
      this.lociTypeDetector.isLocusSupported(header)
    );
    
    const unrecognizedLoci = strHeaders.filter(header => 
      !this.lociTypeDetector.isLocusSupported(header)
    );

    // Warn about unrecognized loci but don't fail
    if (unrecognizedLoci.length > 0) {

    }

    // Check if we have enough recognized loci
    if (recognizedLoci.length < minRequiredLoci) {
      throw new ExcelParsingError(
        `Excel файл должен содержать как минимум ${minRequiredLoci} распознанных генетических локусов, найдено ${recognizedLoci.length}`,
        EXCEL_ERROR_CODES.MISSING_STR_COLUMNS,
        { 
          filename,
          recognizedLoci: recognizedLoci.length,
          unrecognizedLoci,
          expectedLoci: `at least ${minRequiredLoci} recognized loci`
        }
      );
    }

    // Determine the best compatibility mode based on content
    let detectedMode = COMPATIBILITY_MODES.AUTO_DETECT;
    const original39Count = strHeaders.filter(h => EXTENDED_40_STR_SNP_MARKERS.slice(0, 39).includes(h)).length;
    const extended40Count = strHeaders.filter(h => EXTENDED_40_STR_SNP_MARKERS.includes(h)).length;
    const snpCount = strHeaders.filter(h => this.lociTypeDetector.detectLocusType(h) === 'SNP').length;

    if (original39Count >= 30 && snpCount === 0) {
      detectedMode = COMPATIBILITY_MODES.ORIGINAL_39;
    } else if (extended40Count >= 30 && snpCount > 0) {
      detectedMode = COMPATIBILITY_MODES.EXTENDED_40;
    } else if (recognizedLoci.length >= 50) {
      detectedMode = COMPATIBILITY_MODES.FULL_80;
    }

    return {
      mode: detectedMode,
      totalHeaders: strHeaders.length,
      recognizedMarkers: recognizedLoci.length,
      supportedMarkers: recognizedLoci,
      unrecognizedMarkers: unrecognizedLoci,
      original39Count,
      extended40Count,
      snpCount,
      autoDetected: true
    };
  }

  /**
   * Extract DNA profile from a single row with enhanced validation
   * @param {Array} row - Excel row data
   * @param {Array} headers - Excel headers
   * @param {number} rowNumber - Row number for error reporting
   * @param {string} filename - Original filename
   * @param {Object} validationResult - Header validation result
   * @returns {Object} DNA profile object
   */
  extractProfileFromRow(row, headers, rowNumber, filename, validationResult = {}, options = {}) {
    // НОВАЯ ЛОГИКА: Адаптация под файл check_7-107_edit.xlsx
    // Структура файла:
    // Столбец 1: "№ ПРИСВОЕННЫЙ..." → sample_name (второстепенный номер)
    // Столбец 2: "ПРИВОЗ" → notes.privoz
    // Столбец 3: "Sample Name" → internal_number (основной номер)
    // Столбцы 4+: Генетические локусы → str_data
    
    // Определяем структуру файла по заголовкам
    const firstColumnHeader = headers[0];
    const secondColumnHeader = headers[1];
    const thirdColumnHeader = headers[2];
    
    // Проверяем, что это файл с правильной структурой (check_7-107_edit.xlsx)
    const isNewStructure = firstColumnHeader && firstColumnHeader.toString().toLowerCase().includes('присвоенный');
    
    let internalNumber = ''; // Основной номер (уникальный в году)
    let sampleName = '';     // Второстепенный номер (может повторяться)
    let privozData = '';     // Данные привоза
    let yearData = null;     // Год образца
    
    // Функция для извлечения года из строки (убирает все лишние символы)
    const extractYear = (value) => {
      if (!value) return null;
      const str = value.toString().trim();
      // Извлекаем 4 цифры подряд (год)
      const yearMatch = str.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        // Проверяем что год в разумных пределах
        if (year >= 1900 && year <= 2100) {
          return year;
        }
      }
      return null;
    };
    
    if (isNewStructure) {

      
      // НОВАЯ СТРУКТУРА (обновленная):
      // Столбец 1: № ПРИСВОЕННЫЙ... → sample_name (второстепенный)
      // Столбец 2: ПРИВОЗ → import_number
      // Столбец 3: ГОД → year
      // Столбец 4: Sample Name → internal_number (основной)
      // Столбец 5+: Генетические локусы
      
      // УЛУЧШЕНИЕ: Умная нормализация с конвертацией латинских символов
      const sampleNameResult = this.latinConverter.normalizeSampleName(
        row[0] ? row[0].toString() : '', 
        { filename, rowNumber, fieldName: 'assigned_number' }
      );
      
      sampleName = sampleNameResult.normalized; // Второстепенный номер
      privozData = row[1] ? row[1].toString().trim() : ''; // Привоз
      
      // УЛУЧШЕНИЕ: Сначала пытаемся найти год в столбце 3, затем ищем по заголовку
      yearData = extractYear(row[2]); // Год из 3-го столбца
      
      // Если год не найден в столбце 3, ищем по заголовку "Год"
      if (!yearData) {
        const yearIndex = headers.findIndex(header => 
          header && header.toString().toLowerCase().includes('год')
        );
        if (yearIndex !== -1 && row[yearIndex]) {
          yearData = extractYear(row[yearIndex]);
        }
      }
      
      // Внутренний номер теперь в 4-м столбце
      const internalNumberResult = this.latinConverter.normalizeSampleName(
        row[3] ? row[3].toString() : '', 
        { filename, rowNumber, fieldName: 'internal_number' }
      );
      internalNumber = internalNumberResult.normalized; // Основной номер
      

      
    } else {

      
      // СТАРАЯ СТРУКТУРА (для обратной совместимости):
      // Столбец 1: Sample Name → internal_number (основной)
      // Столбец 2: № ПРИСВОЕННЫЙ... → sample_name (второстепенный)
      // Столбец 3: Привоз → import_number
      // Столбец 4+: Ищем столбец "Год"
      
      // УЛУЧШЕНИЕ: Умная нормализация с конвертацией латинских символов
      const internalNumberResult = this.latinConverter.normalizeSampleName(
        row[0] ? row[0].toString() : '', 
        { filename, rowNumber, fieldName: 'internal_number' }
      );
      internalNumber = internalNumberResult.normalized; // Основной номер
      
      // Найти столбец с присвоенными номерами
      const assignedNumberIndex = headers.findIndex(header => 
        header && (
          header.toString().toLowerCase().includes('присвоенный') ||
          header.toString().toLowerCase().includes('в/ч') ||
          header.toString().toLowerCase().includes('цпооп')
        )
      );
      
      if (assignedNumberIndex !== -1 && row[assignedNumberIndex]) {
        const sampleNameResult = this.latinConverter.normalizeSampleName(
          row[assignedNumberIndex].toString(), 
          { filename, rowNumber, fieldName: 'assigned_number' }
        );
        sampleName = sampleNameResult.normalized;
      } else {
        // Генерируем fallback для второстепенного номера
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        sampleName = `${internalNumber}_${timestamp}_${random}`;
      }
      
      // Найти столбец с привозом
      const privozIndex = headers.findIndex(header => 
        header && header.toString().toLowerCase().includes('привоз')
      );
      if (privozIndex !== -1 && row[privozIndex]) {
        privozData = row[privozIndex].toString().trim();
      }
      
      // Найти столбец с годом
      const yearIndex = headers.findIndex(header => 
        header && header.toString().toLowerCase().includes('год')
      );
      if (yearIndex !== -1 && row[yearIndex]) {
        yearData = extractYear(row[yearIndex]);
      }
      

    }
    
    // Валидация основного номера
    if (!options.skipValidation && (!internalNumber || internalNumber === '')) {
      throw new ExcelParsingError(
        'Основной номер образца (internal_number) не может быть пустым',
        EXCEL_ERROR_CODES.MISSING_SAMPLE_NAME,
        { filename, rowNumber }
      );
    }
    
    // Валидация года (обязательное поле)
    if (!options.skipValidation && !yearData) {
      // Определяем что именно находится в столбце года
      let columnLetter = '';
      let columnName = '';
      let actualValue = '';
      
      if (isNewStructure) {
        // Для NEW структуры год должен быть в столбце C (индекс 2)
        columnLetter = 'C';
        columnName = 'Год';
        actualValue = row[2] ? row[2].toString() : '(пусто)';
      } else {
        // Для OLD структуры ищем столбец "Год"
        const yearIndex = headers.findIndex(header => 
          header && header.toString().toLowerCase().includes('год')
        );
        
        if (yearIndex !== -1) {
          columnLetter = String.fromCharCode(65 + yearIndex); // A=65, B=66, C=67...
          columnName = headers[yearIndex];
          actualValue = row[yearIndex] ? row[yearIndex].toString() : '(пусто)';
        } else {
          throw new ExcelParsingError(
            `Ошибка валидации: Столбец "Год" не найден в заголовках файла.\nПожалуйста, убедитесь что в первой строке файла есть столбец с названием "Год".`,
            EXCEL_ERROR_CODES.MISSING_REQUIRED_FIELD,
            { filename, rowNumber, field: 'year' }
          );
        }
      }
      
      throw new ExcelParsingError(
        `Ошибка валидации года`,
        EXCEL_ERROR_CODES.MISSING_REQUIRED_FIELD,
        { 
          filename, 
          rowNumber, 
          field: 'year', 
          column: columnLetter,
          columnName: columnName,
          actualValue, 
          expectedFormat: 'Год в формате 4 цифры (например: 2024, 2025). Год должен быть числом от 1900 до 2100'
        }
      );
    }
    
    // Если второстепенный номер пустой, генерируем его
    if (!sampleName || sampleName === '') {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8).toUpperCase();
      sampleName = `GEN_${internalNumber}_${timestamp}_${random}`;
      
      logger.info('Generated fallback sample name', { filename, rowNumber });

      
    }

    // Определяем начальный индекс для генетических данных
    const geneticDataStartIndex = isNewStructure ? 4 : 1; // Для новой структуры пропускаем первые 4 столбца (№, Привоз, Год, Sample Name)
    
    // Обработка генетических локусов
    const lociData = {};
    const lociTypes = {};
    const priorityMarkers = {};
    
    for (let i = geneticDataStartIndex; i < headers.length; i++) {
      const locusName = headers[i];
      const cellValue = row[i];
      
      // Проверяем, поддерживается ли этот локус
      if (!this.lociTypeDetector.isLocusSupported(locusName)) {
        continue; // Пропускаем неподдерживаемые локусы
      }

      // Определяем тип локуса
      const locusType = this.lociTypeDetector.detectLocusType(locusName);
      lociTypes[locusName] = locusType;

      // Проверяем, является ли это приоритетным маркером
      const isPriorityMarker = EXTENDED_40_STR_SNP_MARKERS.includes(locusName);
      if (isPriorityMarker) {
        priorityMarkers[locusName] = true;
      }

      // Парсим значения аллелей
      const alleles = this.parseAlleleValue(cellValue, locusName, locusType, rowNumber, filename);
      lociData[locusName] = alleles;
    }

    // Подсчет различных типов локусов
    const strLociCount = Object.keys(lociData).filter(locus => 
      this.lociTypeDetector.detectLocusType(locus) === 'STR'
    ).length;

    const snpLociCount = Object.keys(lociData).filter(locus => 
      this.lociTypeDetector.detectLocusType(locus) === 'SNP'
    ).length;

    const priorityMarkerCount = Object.keys(priorityMarkers).length;
    const presentLoci = Object.keys(lociData);
    
    // Валидация минимального количества локусов
    if (presentLoci.length < 3) {
      throw new ExcelParsingError(
        `Недостаточно генетических локусов: найдено ${presentLoci.length}, минимум требуется 3`,
        EXCEL_ERROR_CODES.MISSING_STR_COLUMNS,
        { filename, rowNumber, presentLoci: presentLoci.length }
      );
    }

    // Определяем тип файла
    const fileType = this.detectFileType(headers);
    
    // Расширенные метаданные (убрали additionalData.privoz - теперь только import_number)
    const enhancedMetadata = {
      source: filename,
      extractedAt: new Date().toISOString(),
      rowNumber,
      fileType,
      fileStructure: isNewStructure ? 'new_format' : 'old_format',
      lociTypeBreakdown: this.getLociTypeBreakdown(lociData),
      compatibilityInfo: {
        mode: validationResult.mode || COMPATIBILITY_MODES.AUTO_DETECT,
        priorityMarkerCount,
        strLociCount,
        snpLociCount,
        totalLociCount: presentLoci.length,
        hasExtendedSupport: snpLociCount > 0,
        backwardCompatible: strLociCount >= 30
      },
      qualityMetrics: {
        completeness: (priorityMarkerCount / EXTENDED_40_STR_SNP_MARKERS.length) * 100,
        dataQuality: this.assessDataQuality(lociData),
        recommendedAnalysis: this.getRecommendedAnalysisType(lociData, validationResult)
      }
    };

    // Финальное логирование


    return {
      sampleName: sampleName,        // Второстепенный номер (может повторяться)
      internalNumber: internalNumber, // Основной номер (уникальный в году)
      year: yearData,                // Год образца
      importNumber: privozData,      // Номер привоза
      strData: lociData,             // Генетические данные
      lociData,                      // Новые комплексные данные локусов
      lociTypes,                     // Информация о типах локусов
      priorityMarkers,               // Приоритетные маркеры
      strLociCount,                  // Количество STR локусов
      snpLociCount,                  // Количество SNP маркеров
      totalLociCount: presentLoci.length,
      priorityMarkerCount,
      metadata: enhancedMetadata
    };
  }

  /**
   * Parse allele value from Excel cell
   * @param {*} cellValue - Excel cell value
   * @param {string} locusName - Locus name
   * @param {string} locusType - Type of locus (STR, SNP, etc.)
   * @param {number} rowNumber - Row number for error reporting
   * @param {string} filename - Original filename
   * @returns {Object} Allele object with allele1 and allele2
   */
  extractGeneticProfileFromRow(row, headers, rowNumber, filename, validationResult, options = {}) {
    const objectNumber = normalizeObjectName(row[0]);
    const sampleName = extractExpertiseNumber(objectNumber);
    if (!objectNumber || !sampleName) throw new ExcelParsingError(`Строка ${rowNumber}: не заполнено обязательное поле «Объект».`, 'MISSING_OBJECT', { rowNumber });
    if (objectNumber.length > 100) throw new ExcelParsingError(`Строка ${rowNumber}: значение «Объект» длиннее 100 символов.`, 'INVALID_OBJECT', { rowNumber });
    const strData = {};
    const lociTypes = {};
    const priorityMarkers = {};
    for (const { index, locus } of validationResult.columns) {
      const type = this.lociTypeDetector.detectLocusType(locus);
      strData[locus] = this.parseAlleleValue(row[index], locus, type, rowNumber, filename, { genetic: true, preserveAlleleCount: options.converted });
      lociTypes[locus] = type;
      if (EXTENDED_40_STR_SNP_MARKERS.includes(locus)) priorityMarkers[locus] = true;
    }
    const populatedLociCount = Object.values(strData).filter(alleles => alleles.length > 0).length;
    if (!populatedLociCount) throw new ExcelParsingError(`Строка ${rowNumber}, объект «${sampleName}»: отсутствуют данные генетического профиля.`, 'EMPTY_GENETIC_PROFILE', { rowNumber });
    const priorityMarkerCount = Object.keys(priorityMarkers).length;
    const breakdown = this.getLociTypeBreakdown(strData);
    return {
      sampleName,
      // Полный номер объекта, включая суффикс, сохраняется без сокращения.
      internalNumber: objectNumber,
      year: null,
      importNumber: null,
      importFormat: 'genetic',
      strData,
      lociData: strData,
      lociTypes,
      priorityMarkers,
      priorityMarkerCount,
      totalLociCount: Object.keys(strData).length,
      strLociCount: Object.keys(strData).filter(locus => lociTypes[locus] === 'STR').length,
      snpLociCount: Object.keys(strData).filter(locus => lociTypes[locus] === 'SNP').length,
      metadata: {
        importFormat: 'genetic', source: filename, rowNumber, populatedLociCount,
        lociTypeBreakdown: breakdown,
        compatibilityInfo: { totalLociCount: Object.keys(strData).length, priorityMarkerCount, mode: COMPATIBILITY_MODES.AUTO_DETECT },
        qualityMetrics: { completeness: populatedLociCount / Object.keys(strData).length * 100, dataQuality: this.assessDataQuality(strData) }
      }
    };
  }

  parseAlleleValue(cellValue, locusName, locusType, rowNumber, filename, options = {}) {
    if (cellValue === null || cellValue === undefined || cellValue === '') {
      // Allow empty values - will be handled as no data
      return [];
    }

    // УЛУЧШЕНИЕ: Удаляем ВСЕ пробелы из значения для обработки человеческих ошибок
    // Примеры: "12 , 13" → "12,13", "X , Y" → "X,Y", "17 ?" → "17?"
    let valueStr = cellValue.toString().replace(/\s+/g, '').trim();

    if (isMissingAllele(valueStr)) return [];
    if (locusType === 'Y_INDEL') {
      const alleles = valueStr.split(/[,;/]/).map(token => token.trim()).filter(Boolean);
      const validation = this.lociTypeDetector.validateAlleles(locusName, alleles);
      if (!validation.isValid) throw new ExcelParsingError(`Недопустимые значения аллелей для ${locusName}.`, EXCEL_ERROR_CODES.INVALID_ALLELE_VALUE, { filename, rowNumber, locusName, value: valueStr, errors: validation.errors });
      if (alleles.length > 1) logger.warn('Multiple alleles in haploid Y-InDel marker', { filename, rowNumber, locusName, alleleCount: alleles.length });
      return alleles;
    }
    if (locusType === 'AMELOGENIN' || options.preserveAlleleCount) {
      const alleles = locusType === 'AMELOGENIN' ? amelogeninTokens(valueStr) : valueStr.split(/[,;/]/).map(token => normalizeSpecialAllele(token) || token);
      const validation = this.lociTypeDetector.validateAlleles(locusName, alleles);
      if (!validation.isValid) throw new ExcelParsingError(`Недопустимые значения аллелей для ${locusName}.`, EXCEL_ERROR_CODES.INVALID_ALLELE_VALUE, { filename, rowNumber, locusName });
      return alleles;
    }
    
    // Удаляем дефис "-" (пустое значение)
    if (valueStr === '-') {
      return [];
    }
    
    // Handle different allele formats based on locus type:
    // STR: "12,13" or "12/13" or "12-13" or "12" (homozygous)
    // SNP: "A,T" or "A/T" or "A" (homozygous)
    // Y-chromosome: "12" (haploid)
    // Amelogenin: "X,Y" or "X" or "Y"
    // Complex formats: "23 (16,25)" - extract main alleles, ignore parenthetical info
    
    let alleles = [];
    
    // First, handle complex formats with parentheses containing additional info
    let cleanValue = valueStr;
    if (valueStr.includes('(') && valueStr.includes(')')) {
      // Extract the main part before parentheses and the content within parentheses
      const mainPart = valueStr.split('(')[0].trim();
      const parenthesesContent = valueStr.match(/\(([^)]+)\)/)?.[1] || '';
      
      // If main part has alleles, use those; otherwise use parentheses content
      if (mainPart && mainPart !== '') {
        cleanValue = mainPart;
      } else {
        cleanValue = parenthesesContent;
      }
    }
    
    // Удаляем дефис из cleanValue (может быть в составных значениях)
    if (cleanValue === '-') {
      return [];
    }
    
    if (options.genetic && isSpecialAllele(cleanValue)) {
      alleles = [normalizeSpecialAllele(cleanValue)];
    } else if (cleanValue.includes(',')) {
      alleles = cleanValue.split(',').map(a => a.trim()).filter(a => a !== '-');
    } else if (cleanValue.includes('/')) {
      alleles = cleanValue.split('/').map(a => a.trim()).filter(a => a !== '-');
    } else if (cleanValue.includes('-') && !cleanValue.startsWith('+') && !cleanValue.startsWith('-')) {
      // Разделитель "-" между аллелями, но не дефис как пустое значение
      alleles = cleanValue.split('-').map(a => a.trim()).filter(a => a !== '' && a !== '-');
    } else if (locusName === 'AMEL' && cleanValue.toUpperCase() === 'XY') {
      // Специальная обработка для AMEL: "XY" → ["X", "Y"]
      alleles = ['X', 'Y'];
    } else if (locusName === 'Yindel' || locusType === 'Y_CHROMOSOME') {
      // Специальная обработка для Y-хромосомных маркеров (гаплоидные)
      // Одно значение не дублируется
      alleles = [cleanValue];
    } else {
      // Single value (homozygous)
      alleles = [cleanValue, cleanValue];
    }

    // Фильтруем пустые значения и дефисы после разбиения
    alleles = alleles.filter(a => a && a !== '' && a !== '-');
    
    // Если после фильтрации не осталось аллелей
    if (alleles.length === 0) {
      return [];
    }

    // Handle different allele count scenarios
    let finalAlleles = [];
    let warnings = [];
    
    if (alleles.length === 1) {
      // Для Y-хромосомных маркеров (гаплоидные) - не дублируем
      if (locusName === 'Yindel' || locusType === 'Y_CHROMOSOME' || (options.genetic && isSpecialAllele(alleles[0]))) {
        finalAlleles = [alleles[0]];
      } else {
        // Homozygous - duplicate the allele
        finalAlleles = [alleles[0], alleles[0]];
      }
    } else if (alleles.length === 2) {
      // Normal heterozygous или контаминация для Y-хромосомных
      finalAlleles = alleles;
      
      // Предупреждение для Y-хромосомных маркеров с двумя аллелями
      if (locusName === 'Yindel' || locusType === 'Y_CHROMOSOME') {
        warnings.push(`Potential contamination in Y-chromosome marker: 2 alleles found (${alleles.join(', ')})`);
        logger.warn('Potential contamination in Y-chromosome marker', { filename, rowNumber, locusName });
      }
    } else if (alleles.length > 2) {
      // Contamination or mixture - СОХРАНЯЕМ ВСЕ АЛЛЕЛИ
      finalAlleles = alleles;
      warnings.push(`Potential contamination detected: ${alleles.length} alleles found (${alleles.join(', ')})`);
      
      logger.warn('Potential contamination detected in DNA profile', { filename, rowNumber, locusName, alleleCount: alleles.length });
    } else {
      throw new ExcelParsingError(
        `Недопустимый формат аллеля для ${locusName}: не найдено валидных аллелей`,
        EXCEL_ERROR_CODES.INVALID_ALLELE_VALUE,
        { filename, rowNumber, locusName, value: valueStr }
      );
    }

    // Clean up final alleles (remove any remaining parentheses and normalize question marks)
    // Пробелы уже удалены выше, поэтому здесь только убираем скобки и нормализуем знаки вопроса
    finalAlleles = finalAlleles.map(allele => {
      let cleanedAllele = allele.replace(/[()]/g, '').trim();
      
      // Нормализация знаков вопроса (уже без пробелов)
      cleanedAllele = cleanedAllele.replace(/\?+/g, '?'); // Множественные ? в один
      
      return options.genetic ? normalizeSpecialAllele(cleanedAllele) || cleanedAllele : cleanedAllele;
    });

    // Validate allele values using loci type detector
    const validation = this.lociTypeDetector.validateAlleles(locusName, finalAlleles);
    if (!validation.isValid) {
      throw new ExcelParsingError(
        `Недопустимые значения аллелей для ${locusName}: ${validation.errors.join(', ')}`,
        EXCEL_ERROR_CODES.INVALID_ALLELE_VALUE,
        { filename, rowNumber, locusName, value: valueStr, errors: validation.errors }
      );
    }

    // Combine warnings from contamination detection and validation
    const allWarnings = [...warnings, ...(validation.warnings || [])];

    // Возвращаем массив аллелей (новый формат БД)
    // Для совместимости с логированием добавляем метаданные как свойства массива
    const result = finalAlleles;
    if (allWarnings.length > 0) {
      result.warnings = allWarnings;
    }
    if (valueStr !== cleanValue) {
      result.originalValue = valueStr;
    }
    
    return result;
  }

  /**
   * Get loci type breakdown for metadata
   * @param {Object} lociData - Loci data object
   * @returns {Object} Breakdown by loci type
   */
  getLociTypeBreakdown(lociData) {
    const breakdown = {};
    
    for (const locusName of Object.keys(lociData)) {
      const locusType = this.lociTypeDetector.detectLocusType(locusName);
      breakdown[locusType] = (breakdown[locusType] || 0) + 1;
    }
    
    return breakdown;
  }

  /**
   * Detect file type based on headers
   * @param {Array} headers - Excel file headers
   * @returns {string} File type ('emergency' or 'genetic')
   */
  detectFileType(headers) {
    // Check for emergency file characteristics
    const hasPrivozColumn = headers.some(header => 
      header && header.toString().toLowerCase().includes('привоз')
    );
    
    const hasEmergencyNumberColumn = headers.some(header => 
      header && header.toString().toLowerCase().includes('в/ч')
    );
    
    if (hasPrivozColumn || hasEmergencyNumberColumn) {
      return 'emergency';
    }
    
    return 'genetic';
  }

  /**
   * Validate allele value format
   * @param {string} allele - Allele value
   * @param {string} locusName - STR locus name
   * @returns {boolean} True if valid
   */
  isValidAlleleValue(allele, locusName) {
    if (!allele || allele === '') {
      return true; // Allow empty values
    }

    // AMEL locus can have X, Y values
    if (locusName === 'AMEL') {
      return /^[XY]$/i.test(allele);
    }

    // Other loci should be numeric (can include decimals like 9.3)
    return /^\d+(\.\d+)?$/.test(allele);
  }

  /**
   * Get supported file extensions
   * @returns {Array} Array of supported extensions
   */
  getSupportedExtensions() {
    return ['.xlsx', '.xls'];
  }

  /**
   * Validate file extension
   * @param {string} filename - Filename to validate
   * @returns {boolean} True if supported
   */
  isSupportedFile(filename) {
    if (!filename) return false;
    
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return this.getSupportedExtensions().includes(ext);
  }
}

module.exports = {
  ExcelService,
  ExcelParsingError,
  EXCEL_ERROR_CODES,
  STR_LOCI,
  GENETIC_LOCI,
  EXTENDED_40_STR_SNP_MARKERS,
  COMPATIBILITY_MODES,
  DEFAULT_CONFIG
};
