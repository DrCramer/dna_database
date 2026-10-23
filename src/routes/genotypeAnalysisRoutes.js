const { runProfileSearchForRequest } = require('../services/profiles/searchWorkerExecutor');
const { isMatch, isNumericValue, extractImportNumber } = require('../services/profiles/genotypeComparisonMath');
const { prepareMassSearchProfiles, runMassSearchComparisons, groupMassSearchResults } = require("../services/profiles/massSearchService");
/**
 * API маршруты для анализа генотипов и поиска дубликатов
 * Массовый поиск поддерживает обработку в Worker Threads.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const DNAProfile = require('../models/DNAProfile');
const { ProfileAccessService } = require("../services/security/profileAccessService");
const { getAnalysisLoci } = require('../utils/analysisLoci');
const { createSearchSnapshot } = require("../services/profiles/searchSnapshotStore");
const { validateSearchParameters, getAnalysisTask } = require('../services/profiles/analysisTaskAccess');

function getActiveDepartmentId(req) {
  return req.activeDepartmentId || req.user.department_id || null;
}

function createGroupedExportSnapshot(req, { results, referenceProfiles = [], compareProfiles = [], settings = {}, searchMode, algorithm }) {
  const referencesById = new Map(referenceProfiles.filter(profile => profile?.id).map(profile => [profile.id, profile]));
  const matchesById = new Map(compareProfiles.filter(profile => profile?.id).map(profile => [profile.id, profile]));
  const comparisons = (results || []).flatMap(group => (group.exportMatches || group.matches || []).map(match => {
    const reference = referencesById.get(group.reference?.id) || group.reference;
    const matched = matchesById.get(match.id) || match;
    return {
      referenceProfile: reference,
      matchedProfile: matched,
      matchedLoci: match.matchedLoci,
      details: match.details,
      matchCount: match.matchCount ?? match.matchingLoci,
      totalLoci: match.totalLoci ?? match.comparedLociCount,
      matchPercentage: match.matchPercentage,
      totalScore: match.totalScore ?? match.matchScore ?? match.score,
      algorithm: match.algorithm || algorithm
    };
  }));
  const snapshot = createSearchSnapshot({
    userId: req.user.id,
    departmentId: getActiveDepartmentId(req),
    searchMode,
    algorithm,
    settings,
    comparisons
  });
  return snapshot;
}

/**
 * GET /api/genotype-analysis/profiles
 * Получение всех профилей для анализа
 */
router.get('/profiles', authenticate, async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const activeDepartmentId = getActiveDepartmentId(req);
    
    // Получаем профили с учетом прав доступа
    let query = `
      SELECT 
        dp.id,
        dp.sample_name,
        dp.year,
        dp.internal_number,
        dp.import_number,
        dp.notes,
        dp.str_data,
        dp.upload_date,
        dp.profile_type, dp.import_format, dp.panel_id
      FROM dna_profiles dp
      LEFT JOIN users u ON dp.user_id = u.id
      WHERE dp.is_active = true
    `;
    
    const params = [];
    
    const scope = await ProfileAccessService.getScope({ userId: req.user.id, activeDepartmentId });
    const shiftedScope = scope.clause.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + params.length}`);
    query += ` AND ${shiftedScope}`;
    params.push(...scope.params);
    
    query += ` ORDER BY dp.upload_date DESC LIMIT 10000`;
    
    const result = await pool.query(query, params);
    
    // Форматируем данные для фронтенда
    const enrichedProfiles = await DNAProfile.fromRows(result.rows);
    const profiles = result.rows.map((row, index) => {
      if (!row.year) {
        logger.warn('Profile without year', {
          id: row.id,
          sample_name: row.sample_name,
          internal_number: row.internal_number,
          year: row.year,
          allKeys: Object.keys(row)
        });
      }
      
      return {
        ...enrichedProfiles[index].toJSON(),
        id: row.id,
        sample_name: row.sample_name,
        internal_number: row.internal_number || row.sample_name,
        import_number: extractImportNumber(row),
        year: row.year,
        loci: row.str_data || {},
        upload_date: row.upload_date,
        profile_type: row.profile_type
      };
    });
    
    logger.info('Профили для анализа загружены', {
      userId: req.user.id,
      count: profiles.length
    });
    
    res.json({
      success: true,
      profiles,
      count: profiles.length
    });
    
  } catch (error) {
    logger.error('Ошибка получения профилей для анализа', {
      userId: req.user.id,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      error: 'Ошибка получения профилей'
    });
  }
});

/**
 * POST /api/genotype-analysis/search
 * Поиск совпадений для одного эталонного профиля
 */
router.post('/search', authenticate, async (req, res) => {
  try {
    const activeDepartmentId = getActiveDepartmentId(req);
    const { 
      referenceProfile,  // { sample_name, internal_number, import_number, loci: { D3S1358: '12,13', ... } }
      minMatches = 15,   // Минимальное количество совпадений
      ignoredLoci = [],  // Массив игнорируемых локусов
      excludeProfileId   // ID профиля, который нужно исключить из поиска
    } = req.body;
    
    if (!referenceProfile || !referenceProfile.loci) {
      return res.status(400).json({
        success: false,
        error: 'Не указан эталонный профиль'
      });
    }
    
    const { pool } = req.app.locals;
    
    // Получаем все профили для сравнения
    let query = `
      SELECT 
        dp.id,
        dp.sample_name,
        dp.internal_number,
        dp.notes,
        dp.str_data
      FROM dna_profiles dp
      LEFT JOIN users u ON dp.user_id = u.id
      WHERE dp.is_active = true
    `;
    
    const params = [];
    
    // Исключаем сам эталонный профиль
    if (excludeProfileId) {
      query += ` AND dp.id != $${params.length + 1}`;
      params.push(excludeProfileId);
    }
    
    const scope = await ProfileAccessService.getScope({ userId: req.user.id, activeDepartmentId });
    const shiftedScope = scope.clause.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + params.length}`);
    query += ` AND ${shiftedScope}`;
    params.push(...scope.params);
    
    query += ` LIMIT 10000`;
    
    const result = await pool.query(query, params);
    
    logger.info('Начало поиска совпадений', {
      userId: req.user.id,
      referenceSample: referenceProfile.sample_name,
      profilesToCompare: result.rows.length,
      minMatches,
      ignoredLociCount: ignoredLoci.length
    });
    
    // Выполняем сравнение
    const matches = [];
    const referenceLoci = referenceProfile.loci;
    let profilesChecked = 0;
    let maxMatchCount = 0;
    
    for (const profile of result.rows) {
      profilesChecked++;
      const profileLoci = profile.str_data || {};
      let numericMatchCount = 0;
      const matchedLoci = [];
      
      // Сравниваем каждый локус
      for (const locus of getAnalysisLoci([{ loci: referenceLoci }, { loci: profileLoci }])) {
        // Пропускаем игнорируемые локусы
        if (ignoredLoci.includes(locus)) {
          continue;
        }
        
        const refValue = referenceLoci[locus];
        const profValue = profileLoci[locus];
        
        // Пропускаем если нет данных
        if (!refValue || !profValue) {
          continue;
        }
        
        // Формируем строковые значения для сравнения
        const refStr = typeof refValue === 'object' 
          ? `${refValue.allele1 || ''}${refValue.allele2 ? ',' + refValue.allele2 : ''}`
          : refValue.toString();
          
        const profStr = typeof profValue === 'object'
          ? `${profValue.allele1 || ''}${profValue.allele2 ? ',' + profValue.allele2 : ''}`
          : profValue.toString();
        
        // Проверяем совпадение
        if (isMatch(refStr, profStr)) {
          // Считаем только числовые совпадения
          if (isNumericValue(refStr) && isNumericValue(profStr)) {
            numericMatchCount++;
          }
          matchedLoci.push(locus);
        }
      }
      
      // Отслеживаем максимальное количество совпадений
      if (numericMatchCount > maxMatchCount) {
        maxMatchCount = numericMatchCount;
      }
      
      // Добавляем в результаты если достигнут порог
      if (numericMatchCount >= minMatches) {
        matches.push({
          id: profile.id,
          sample_name: profile.sample_name,
          internal_number: profile.internal_number || profile.sample_name,
          import_number: extractImportNumber(profile),
          loci: profileLoci,
          matchCount: numericMatchCount,
          matchedLoci: matchedLoci
        });
      }
    }
    
    // Сортируем по количеству совпадений (больше совпадений - выше)
    matches.sort((a, b) => b.matchCount - a.matchCount);
    
    logger.info('Поиск совпадений выполнен', {
      userId: req.user.id,
      referenceSample: referenceProfile.sample_name,
      profilesChecked,
      matchesFound: matches.length,
      maxMatchCount,
      minMatches
    });
    
    const exportSnapshot = createSearchSnapshot({
      userId: req.user.id,
      departmentId: activeDepartmentId,
      searchMode: 'single',
      algorithm: 'standard',
      settings: { ignoredLoci, minMatches, colors: req.body.colors },
      comparisons: matches.map(match => ({
        referenceProfile: { ...referenceProfile, loci: referenceLoci },
        matchedProfile: match,
        matchedLoci: match.matchedLoci,
        algorithm: 'standard',
        matchCount: match.matchCount
      }))
    });

    res.json({
      success: true,
      matches,
      count: matches.length,
      exportSnapshot: exportSnapshot,
      reference: {
        sample_name: referenceProfile.sample_name,
        internal_number: referenceProfile.internal_number,
        import_number: referenceProfile.import_number
      }
    });
    
  } catch (error) {
    logger.error('Ошибка поиска совпадений', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Ошибка выполнения поиска'
    });
  }
});

/**
 * POST /api/genotype-analysis/mass-search
 * Массовый поиск - ОПТИМИЗИРОВАННАЯ ОДНОПОТОЧНАЯ ВЕРСИЯ
 */
router.post('/mass-search', authenticate, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const activeDepartmentId = getActiveDepartmentId(req);
    const { 
      minMatches = 15,
      ignoredLoci = [],
      profileIds = [],
      useWorkers = true
    } = req.body;
    
    const { pool } = req.app.locals;
    
    logger.info('🔍 Начало массового поиска (оптимизированная версия)', {
      userId: req.user.id,
      minMatches,
      ignoredLociCount: ignoredLoci.length
    });
    
    // Получаем профили для массового поиска
    let query = `
      SELECT 
        id,
        sample_name,
        year,
        internal_number,
        import_number,
        import_format,
        notes,
        str_data
      FROM dna_profiles dp
      WHERE dp.is_active = true
    `;
    
    const params = [];
    
    if (profileIds.length > 0) {
      query += ` AND id = ANY($${params.length + 1})`;
      params.push(profileIds);
    }
    
    const scope = await ProfileAccessService.getScope({ userId: req.user.id, activeDepartmentId });
    const shiftedScope = scope.clause.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + params.length}`);
    query += ` AND ${shiftedScope}`;
    params.push(...scope.params);
    
    query += ` LIMIT 10000`;
    
    const result = await pool.query(query, params);
    const profiles = result.rows;
    
    const loadTime = Date.now() - startTime;
    
    logger.info('📊 Профили загружены', {
      count: profiles.length,
      loadTimeMs: loadTime
    });
    
    const processedProfiles = prepareMassSearchProfiles(profiles, ignoredLoci, extractImportNumber);
    const comparison = await runMassSearchComparisons(processedProfiles, minMatches, useWorkers);
    const massSearchResults = groupMassSearchResults(processedProfiles, comparison.groups);
    const comparisonCount = comparison.comparisons;
    const earlyExits = comparison.earlyExits;

    const endTime = Date.now();
    const duration = endTime - startTime;
    const durationSeconds = (duration / 1000).toFixed(2);
    const avgTimePerComparison = comparisonCount > 0 ? (duration / comparisonCount).toFixed(4) : 0;
    
    logger.info('✅ Массовый поиск завершен', {
      userId: req.user.id,
      profilesAnalyzed: profiles.length,
      resultsWithMatches: massSearchResults.length,
      comparisons: comparisonCount,
      earlyExits: earlyExits,
      durationMs: duration,
      durationSeconds: durationSeconds,
      avgTimePerComparison: avgTimePerComparison,
      minMatches
    });

    const exportSnapshot = createGroupedExportSnapshot(req, {
      results: massSearchResults,
      referenceProfiles: processedProfiles,
      compareProfiles: processedProfiles,
      settings: { ignoredLoci, minMatches, colors: req.body.colors },
      searchMode: 'mass',
      algorithm: 'standard'
    });
    
    const responseResults = massSearchResults.map(({ exportMatches, ...group }) => group);
    res.json({
      success: true,
      results: responseResults,
      exportSnapshot,
      totalAnalyzed: profiles.length,
      resultsWithMatches: massSearchResults.length,
      statistics: {
        duration: duration,
        durationSeconds: durationSeconds,
        comparisons: comparisonCount,
        earlyExits: earlyExits,
        averageTimePerComparison: avgTimePerComparison + 'ms',
        comparisonsPerSecond: Math.round(comparisonCount / (duration / 1000)),
        loadTimeMs: loadTime,
        processingTimeMs: duration - loadTime,
        mode: comparison.mode
      }
    });
    
  } catch (error) {
    logger.error('❌ Ошибка массового поиска', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Ошибка выполнения массового поиска: ' + error.message
    });
  }
});

/**
 * POST /api/genotype-analysis/task-search
 * Поиск для задач - два режима:
 * - "task": сравнение профилей внутри задачи между собой
 * - "master_array": сравнение профилей задачи с мастер массивом
 */
router.post('/task-search', authenticate, validateSearchParameters, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const activeDepartmentId = getActiveDepartmentId(req);
    const { 
      taskId,
      searchMode = 'task',  // 'task' или 'master_array'
      minMatches = 15,
      ignoredLoci = [],
      comparisonAlgorithm = 'standard',  // 'standard' или 'contamination'
      useV5Algorithm = true  // Использовать алгоритм v5.0 для contamination
    } = req.body;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'taskId обязателен'
      });
    }
    
    if (!['task', 'master_array'].includes(searchMode)) {
      return res.status(400).json({
        success: false,
        error: 'searchMode должен быть "task" или "master_array"'
      });
    }
    
    logger.info('🔍 Начало поиска для задачи', {
      userId: req.user.id,
      taskId,
      searchMode,
      minMatches,
      ignoredLociCount: ignoredLoci.length,
      comparisonAlgorithm
    });
    
    const DNAProfile = require('../models/DNAProfile');
    const MasterArray = require('../models/MasterArray');
    const analysisTask = await getAnalysisTask(req, taskId);
    
    // Получаем профили задачи
    const taskProfilesData = await DNAProfile.findByTaskId(taskId, { departmentId: analysisTask.department_id, organizationId: analysisTask.organization_id });
    
    logger.info('🔍 Профили задачи загружены', {
      taskId,
      profilesCount: taskProfilesData.length
    });
    
    if (taskProfilesData.length === 0) {
      return res.json({
        success: true,
        results: [],
        totalAnalyzed: 0,
        resultsWithMatches: 0,
        searchMode,
        message: 'В задаче нет профилей для анализа'
      });
    }
    
    let referenceProfiles = [];
    let compareProfiles = [];
    
    if (searchMode === 'task') {
      // Режим 1: Сравнение внутри задачи (профили задачи сравниваются между собой)
      referenceProfiles = taskProfilesData.map(p => ({
        id: p.id,
        sample_name: p.sampleName,
        internal_number: p.internalNumber,
        import_number: p.importNumber,
        year: p.year,
        notes: p.notes,
        str_data: p.strData,
        source: 'task'
      }));
      compareProfiles = referenceProfiles; // Сравниваем с теми же профилями
      
      logger.info('📊 Режим: сравнение внутри задачи', {
        profilesCount: referenceProfiles.length
      });
    } else {
      // Режим 2: Сравнение с мастер массивом С ПРЕ-ФИЛЬТРАЦИЕЙ (ТУРБО-ПОИСК)
      referenceProfiles = taskProfilesData.map(p => ({
        id: p.id,
        sample_name: p.sampleName,
        internal_number: p.internalNumber,
        import_number: p.importNumber,
        year: p.year,
        notes: p.notes,
        str_data: p.strData,
        source: 'task'
      }));
      
      // Проверяем что у пользователя есть организация и отдел
      if (!req.user.organization_id || !activeDepartmentId) {
        return res.status(403).json({
          success: false,
          error: 'Доступ запрещен',
          message: 'Для поиска в мастер массиве необходимо быть привязанным к организации и отделу. Обратитесь к администратору для назначения.'
        });
      }
      
      // ПРЕ-ФИЛЬТРАЦИЯ: Для каждого профиля задачи получаем "горячих кандидатов"
      const preFilterStartTime = Date.now();
      const hotCandidatesMap = new Map(); // Дедупликация кандидатов
      
      logger.info('🚀 Начало турбо-поиска с пре-фильтрацией', {
        taskProfilesCount: referenceProfiles.length,
        strategy: '2 группы по 3 локуса (AND внутри, OR между)'
      });
      
      for (const refProfile of referenceProfiles) {
        try {
          logger.info('🔍 Вызов getHotCandidatesWithPairs', {
            profileId: refProfile.id,
            sampleName: refProfile.sample_name
          });
          
          const candidates = await MasterArray.getHotCandidatesWithPairs(refProfile, {
            organizationId: req.user.organization_id,
            departmentId: req.user.role === 'user_analyst' ? activeDepartmentId : null,
            limit: 500
          });
          
          logger.info('✅ Получены кандидаты', {
            profileId: refProfile.id,
            candidatesCount: candidates.length
          });
          
          // Добавляем кандидатов в Map (дедупликация по ID)
          for (const candidate of candidates) {
            if (!hotCandidatesMap.has(candidate.id)) {
              hotCandidatesMap.set(candidate.id, candidate);
            }
          }
        } catch (error) {
          logger.error('❌ Ошибка пре-фильтрации для профиля', {
            profileId: refProfile.id,
            sampleName: refProfile.sample_name,
            error: error.message,
            stack: error.stack
          });
        }
      }
      
      const preFilterDuration = Date.now() - preFilterStartTime;
      
      // Преобразуем Map в массив
      const hotCandidates = Array.from(hotCandidatesMap.values());
      
      compareProfiles = hotCandidates.map(p => ({
        id: p.id,
        sample_name: p.sample_name,
        internal_number: p.internal_number,
        import_number: p.import_number,
        year: p.year,
        notes: `Привоз: ${p.import_number || 'не указан'}`,
        str_data: p.loci,
        source: 'master_array'
      }));
      
      logger.info('📊 Режим: сравнение с мастер массивом (ТУРБО-ПОИСК)', {
        taskProfilesCount: referenceProfiles.length,
        hotCandidatesCount: compareProfiles.length,
        preFilterDurationMs: preFilterDuration,
        preFilterDurationSec: (preFilterDuration / 1000).toFixed(2),
        reductionFactor: compareProfiles.length > 0 ? 'N/A' : 'N/A'
      });
    }
    
    const comparison = await runProfileSearchForRequest(req, res, {
      referenceProfiles, compareProfiles, minMatches, ignoredLoci,
      comparisonAlgorithm, useV5Algorithm, searchMode: searchMode,
      duplicateSettings: req.body.duplicateSettings || {}
    });
    const { results, comparisons: comparisonCount } = comparison;

    const duration = Date.now() - startTime;
    
    logger.info('✅ Поиск для задачи завершен', {
      userId: req.user.id,
      taskId,
      searchMode,
      comparisonAlgorithm,
      profilesAnalyzed: referenceProfiles.length,
      resultsWithMatches: results.length,
      comparisons: comparisonCount,
      durationMs: duration
    });
    
    // Логирование результатов поиска для статистики
    try {
      const ContaminationLogger = require("../services/contamination/contaminationLogger");
      await ContaminationLogger.logSearchResults(results, {
        searchMode,
        algorithmUsed: comparisonAlgorithm,
        minMatchesThreshold: minMatches,
        ignoredLoci,
        taskId,
        departmentId: activeDepartmentId,
        searchedBy: req.user.id
      });
    } catch (logError) {
      logger.error('Ошибка логирования результатов', { error: logError.message });
      // Не прерываем выполнение
    }
    
    const exportSnapshot = createGroupedExportSnapshot(req, {
      results,
      referenceProfiles,
      compareProfiles,
      settings: { ignoredLoci, minMatches, duplicateSettings: req.body.duplicateSettings, colors: req.body.colors },
      searchMode,
      algorithm: comparisonAlgorithm
    });

    const responseResults = results.map(({ exportMatches, ...group }) => group);
    res.json({
      success: true,
      results: responseResults,
      exportSnapshot,
      totalAnalyzed: referenceProfiles.length,
      resultsWithMatches: results.length,
      searchMode: searchMode,
      comparisonAlgorithm: comparisonAlgorithm,
      statistics: {
        duration: duration,
        durationSeconds: (duration / 1000).toFixed(2),
        comparisons: comparisonCount,
        mode: comparison.mode,
        workerCount: comparison.workerCount,
        referenceProfilesCount: referenceProfiles.length,
        compareProfilesCount: compareProfiles.length
      }
    });
    
  } catch (error) {
    logger.error('❌ Ошибка поиска для задачи', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    
    res.status(error.status || 500).json({
      success: false,
      error: 'Ошибка выполнения поиска: ' + error.message
    });
  }
});

/**
 * POST /api/genotype-analysis/department-tasks-search
 * Поиск дубликатов в активных задачах других пользователей отдела
 */
router.post('/department-tasks-search', authenticate, validateSearchParameters, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const activeDepartmentId = getActiveDepartmentId(req);
    const { 
      taskId,
      minMatches = 15,
      ignoredLoci = [],
      comparisonAlgorithm = 'standard',
      useV5Algorithm = true  // Использовать алгоритм v5.0 для contamination
    } = req.body;
    
    const { pool } = req.app.locals;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Не указан ID текущей задачи'
      });
    }
    
    logger.info('🔍 Начало поиска в активных задачах отдела', {
      userId: req.user.id,
      taskId,
      minMatches,
      ignoredLociCount: ignoredLoci.length,
      algorithm: comparisonAlgorithm
    });
    
    // Получаем информацию о текущей задаче и отделе пользователя
    const currentTask = await getAnalysisTask(req, taskId);
    const departmentId = currentTask.department_id;
    
    // Получаем профили из текущей задачи (эталонные)
    const referenceProfilesQuery = await pool.query(`
      SELECT 
        dp.id,
        dp.sample_name,
        dp.year,
        dp.internal_number,
        dp.import_number,
        dp.str_data
      FROM dna_profiles dp
      WHERE dp.task_id = $1 AND dp.is_active = true AND dp.department_id=$2 AND dp.organization_id=$3
    `, [taskId, departmentId, currentTask.organization_id]);
    
    const referenceProfiles = referenceProfilesQuery.rows;
    
    if (referenceProfiles.length === 0) {
      return res.status(200).json({
        success: true,
        results: [],
        message: 'В текущей задаче нет профилей для поиска'
      });
    }
    
    // Получаем все активные задачи отдела (кроме текущей)
    // Статусы: 'in_progress' - взяты в работу
    const departmentTasksQuery = await pool.query(`
      SELECT DISTINCT t.id, t.title as name, t.assigned_to_user, t.created_at, u.username
      FROM tasks t
      JOIN departments d ON d.id=t.department_id JOIN organizations o ON o.id=d.organization_id
      LEFT JOIN users u ON t.assigned_to_user = u.id
      WHERE t.department_id = $1 
        AND t.id != $2
        AND t.status = 'in_progress'
        AND t.is_active = true
        AND d.organization_id = $3 AND d.is_active=true AND o.is_active=true
      ORDER BY t.created_at DESC
    `, [departmentId, taskId, currentTask.organization_id]);
    
    const departmentTasks = departmentTasksQuery.rows;
    
    if (departmentTasks.length === 0) {
      return res.status(200).json({
        success: true,
        results: [],
        message: 'В отделе нет других активных задач с загруженными профилями'
      });
    }
    
    logger.info('📊 Найдено активных задач отдела', {
      count: departmentTasks.length,
      taskIds: departmentTasks.map(t => t.id)
    });
    
    // Получаем все профили из этих задач
    const taskIds = departmentTasks.map(t => t.id);
    const compareProfilesQuery = await pool.query(`
      SELECT 
        dp.id,
        dp.task_id,
        dp.sample_name,
        dp.year,
        dp.internal_number,
        dp.import_number,
        dp.str_data,
        t.title as task_name,
        u.username as task_owner
      FROM dna_profiles dp
      JOIN tasks t ON dp.task_id = t.id
      JOIN departments d ON d.id=t.department_id JOIN organizations o ON o.id=d.organization_id
      LEFT JOIN users u ON t.assigned_to_user = u.id
      WHERE dp.task_id = ANY($1) AND dp.is_active = true
        AND dp.department_id=$2 AND dp.organization_id=$3
        AND t.department_id=$2 AND d.organization_id=$3 AND d.is_active=true AND o.is_active=true AND t.is_active=true AND t.status='in_progress'
    `, [taskIds, departmentId, currentTask.organization_id]);
    
    const compareProfiles = compareProfilesQuery.rows;
    
    logger.info('📊 Профили для сравнения загружены', {
      referenceCount: referenceProfiles.length,
      compareCount: compareProfiles.length
    });
    
    const comparison = await runProfileSearchForRequest(req, res, {
      referenceProfiles, compareProfiles, minMatches, ignoredLoci,
      comparisonAlgorithm, useV5Algorithm, searchMode: 'department_tasks',
      duplicateSettings: req.body.duplicateSettings || {}
    });
    const { results, comparisons: comparisonCount } = comparison;

    const totalTime = Date.now() - startTime;
    
    logger.info('✅ Поиск в задачах отдела завершен', {
      userId: req.user.id,
      totalTimeMs: totalTime,
      comparisons: comparisonCount,
      resultsCount: results.length,
      departmentTasksCount: departmentTasks.length
    });
    
    // Логирование результатов поиска для статистики
    try {
      const ContaminationLogger = require("../services/contamination/contaminationLogger");
      await ContaminationLogger.logSearchResults(results, {
        searchMode: 'department_tasks',
        algorithmUsed: comparisonAlgorithm,
        minMatchesThreshold: minMatches,
        ignoredLoci,
        taskId,
        departmentId: activeDepartmentId,
        searchedBy: req.user.id
      });
    } catch (logError) {
      logger.error('Ошибка логирования результатов', { error: logError.message });
      // Не прерываем выполнение
    }
    
    const exportSnapshot = createGroupedExportSnapshot(req, {
      results,
      referenceProfiles,
      compareProfiles,
      settings: { ignoredLoci, minMatches, duplicateSettings: req.body.duplicateSettings, colors: req.body.colors },
      searchMode: 'department_tasks',
      algorithm: comparisonAlgorithm
    });

    res.status(200).json({
      success: true,
      results: results,
      exportSnapshot,
      stats: {
        totalTimeMs: totalTime,
        comparisons: comparisonCount,
        mode: comparison.mode,
        workerCount: comparison.workerCount,
        referenceProfilesCount: referenceProfiles.length,
        compareProfilesCount: compareProfiles.length,
        departmentTasksCount: departmentTasks.length
      }
    });

  } catch (error) {
    logger.error('❌ Ошибка поиска в задачах отдела', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    
    res.status(error.status || 500).json({
      success: false,
      error: 'Ошибка выполнения поиска: ' + error.message
    });
  }
});

/**
 * POST /api/genotype-analysis/department-profiles
 * Загрузка всех профилей из активных задач отдела (для восстановления из истории)
 */
router.post('/department-profiles', authenticate, validateSearchParameters, async (req, res) => {
  try {
    const { taskId } = req.body;
    const { pool } = req.app.locals;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Не указан ID текущей задачи'
      });
    }
    
    // Получаем информацию о текущей задаче и отделе
    const currentTask = await getAnalysisTask(req, taskId);
    const departmentId = currentTask.department_id;
    
    // Получаем все активные задачи отдела (кроме текущей)
    const departmentTasksQuery = await pool.query(`
      SELECT t.id FROM tasks t
      JOIN departments d ON d.id=t.department_id JOIN organizations o ON o.id=d.organization_id
      WHERE t.department_id = $1
        AND t.id != $2
        AND t.status = 'in_progress'
        AND t.is_active = true
        AND d.organization_id = $3 AND d.is_active=true AND o.is_active=true
    `, [departmentId, taskId, currentTask.organization_id]);
    
    const taskIds = departmentTasksQuery.rows.map(t => t.id);
    
    if (taskIds.length === 0) {
      return res.status(200).json({
        success: true,
        profiles: []
      });
    }
    
    // Получаем все профили из этих задач
    const profilesQuery = await pool.query(`
      SELECT 
        dp.id,
        dp.sample_name as "sampleName",
        dp.year,
        dp.internal_number as "internalNumber",
        dp.import_number as "importNumber",
        dp.str_data as "strData"
      FROM dna_profiles dp
      JOIN tasks t ON t.id=dp.task_id
      JOIN departments d ON d.id=t.department_id JOIN organizations o ON o.id=d.organization_id
      WHERE dp.task_id = ANY($1) AND dp.is_active = true
        AND dp.department_id=$2 AND dp.organization_id=$3
        AND t.department_id=$2 AND d.organization_id=$3 AND d.is_active=true AND o.is_active=true AND t.is_active=true AND t.status='in_progress'
    `, [taskIds, departmentId, currentTask.organization_id]);
    
    res.status(200).json({
      success: true,
      profiles: profilesQuery.rows
    });
    
  } catch (error) {
    logger.error('Ошибка загрузки профилей из задач отдела:', error);
    res.status(error.status || 500).json({
      success: false,
      error: 'Ошибка загрузки профилей из задач отдела'
    });
  }
});

module.exports = router;
