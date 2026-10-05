/**
 * API маршруты для анализа генотипов и поиска дубликатов
 * ОПТИМИЗИРОВАННАЯ ОДНОПОТОЧНАЯ ВЕРСИЯ
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { calculateContaminationScoreV5 } = require('../utils/contaminationAlgorithmV5');
const { calculateDuplicateSimilarity, isDuplicate } = require('../services/duplicateDetectionService');
const { calculateDuplicateSimilarityOptimized, isDuplicateOptimized } = require('../services/duplicateDetectionServiceOptimized');

const DNAProfile = require('../models/DNAProfile');
const { ProfileAccessService } = require('../services/profileAccessService');
const { getAnalysisLoci } = require('../utils/analysisLoci');

// Веса локусов для алгоритма контаминации (v4.0)
const LOCUS_WEIGHTS = {
  'SE33': 1.3,
  'D1S1656': 1.25,
  'D12S391': 1.2,
  'D2S1338': 1.15,
  'D19S433': 1.1,
  'D21S11': 1.1,
  'FGA': 1.1,
  'D22S1045': 1.1,
  'D18S51': 1.05,
  'D3S1358': 1.0,
  'vWA': 1.0,
  'D16S539': 1.0,
  'CSF1PO': 1.0,
  'D8S1179': 1.0,
  'D2S441': 1.0,
  'D13S317': 1.0,
  'D7S820': 1.0,
  'D10S1248': 1.0,
  'TH01': 0.95,
  'D5S818': 0.95,
  'TPOX': 0.9,
  'Yindel': 0.8,
  'AMEL': 0.8,
  'DYS391': 0.8
};

// Коэффициенты совпадения для алгоритма контаминации
const MATCH_COEFFICIENTS = {
  fullMatch: 1.0,      // Полное совпадение
  partialMatch: 0.4,   // Частичное совпадение
  penalty: -0.6        // Штраф за несовпадение
};

function getActiveDepartmentId(req) {
  return req.activeDepartmentId || req.user.department_id || null;
}

/**
 * Парсит аллели в массив
 */
function parseAlleles(value) {
  if (!value || value === '.' || value === '*' || value === '**' || value === '?' || value === '') return [];
  
  if (Array.isArray(value)) {
    return value.map(a => String(a).trim())
      .filter(a => a !== '' && a !== '.' && a !== '*' && a !== '**' && a !== '?');
  }
  
  if (typeof value === 'object') {
    if (value.allele1 !== undefined || value.allele2 !== undefined) {
      const alleles = [];
      if (value.allele1 && value.allele1 !== '' && value.allele1 !== '.' && value.allele1 !== '*' && value.allele1 !== '**' && value.allele1 !== '?') {
        alleles.push(String(value.allele1).trim());
      }
      if (value.allele2 && value.allele2 !== '' && value.allele2 !== '.' && value.allele2 !== '*' && value.allele2 !== '**' && value.allele2 !== '?') {
        alleles.push(String(value.allele2).trim());
      }
      return alleles.filter(a => a !== '');
    }
  }
  
  const separators = /[,;/\s]+/;
  return String(value).split(separators)
    .map(a => a.trim())
    .filter(a => a !== '' && a !== '.' && a !== '*' && a !== '**' && a !== '?');
}

/**
 * Вычисляет пересечение двух массивов с учетом количества повторений
 */
function intersect(arr1, arr2) {
  const result = [];
  const arr2Copy = [...arr2];
  
  for (const value of arr1) {
    const index = arr2Copy.indexOf(value);
    if (index !== -1) {
      result.push(value);
      arr2Copy.splice(index, 1);
    }
  }
  
  return result;
}

/**
 * Проверка совпадения между двумя значениями аллелей (СТАНДАРТНЫЙ АЛГОРИТМ)
 */
function isMatch(inputValue, cellValue) {
  if (!inputValue || !cellValue) return false;
  
  const inputStr = inputValue.trim().toUpperCase();
  const cellStr = cellValue.trim().toUpperCase();
  
  // Специальные символы - НЕ считаются совпадениями
  if (inputStr === '*' || inputStr === 'F' || inputStr === '?' || inputStr === '*,*') return false;
  if (cellStr === '*' || cellStr === 'F' || cellStr === '?' || cellStr === '*,*') return false;
  
  const inputParts = inputStr.split(',').map(p => p.trim());
  const cellParts = cellStr.split(',').map(p => p.trim());
  
  // Проверяем что нет пустых значений или специальных символов в частях
  if (inputParts.some(p => !p || p === '*' || p === 'F' || p === '?')) return false;
  if (cellParts.some(p => !p || p === '*' || p === 'F' || p === '?')) return false;
  
  const cellSet = new Set(cellParts);
  
  // Проверка на гомозиготу
  const isInputHomozygote = inputParts.length === 2 && inputParts[0] === inputParts[1];
  
  if (isInputHomozygote) {
    // Гомозигота - должны совпадать оба значения
    return cellParts.length === 2 && 
           cellParts[0] === cellParts[1] && 
           cellParts[0] === inputParts[0];
  } else {
    // Гетерозигота - все части эталона должны быть в образце
    for (const part of inputParts) {
      if (!cellSet.has(part)) return false;
    }
    return true;
  }
}

/**
 * Сравнение локусов с алгоритмом контаминации (v4.0)
 * Возвращает взвешенный скор совпадения
 */
function compareLocusContamination(refAlleles, compAlleles, locus) {
  if (refAlleles.length === 0 || compAlleles.length === 0) {
    return { score: 0, matchType: 'none', explainedCount: 0 };
  }
  
  // Вес локуса
  const locusWeight = LOCUS_WEIGHTS[locus] || 1.0;
  
  // Совпадения (с учетом повторений)
  const explainedAlleles = intersect(refAlleles, compAlleles);
  const explainedCount = explainedAlleles.length;
  const refCount = refAlleles.length;
  
  // Коэффициент совпадения
  let matchCoeff, matchType;
  if (explainedCount === refCount && refCount > 0) {
    matchCoeff = MATCH_COEFFICIENTS.fullMatch; // Полное совпадение
    matchType = 'full';
  } else if (explainedCount > 0) {
    matchCoeff = MATCH_COEFFICIENTS.partialMatch; // Частичное совпадение
    matchType = 'partial';
  } else {
    matchCoeff = MATCH_COEFFICIENTS.penalty; // Штраф
    matchType = 'penalty';
  }
  
  // Вклад локуса
  const locusScore = locusWeight * matchCoeff;
  
  return {
    score: locusScore,
    matchType,
    matchCoeff,
    locusWeight,
    explainedCount,
    explainedAlleles
  };
}

/**
 * Проверка является ли значение числовым (не *, F, ?)
 */
function isNumericValue(value) {
  if (!value) return false;
  const str = value.trim().toUpperCase();
  // Проверяем что строка не пустая и не содержит специальные символы
  if (str === '' || str === '*' || str === '**' || str === '?' || str === 'F' || str === '*,*') return false;
  // Проверяем что в строке нет символов *, ?, F
  if (/[*?F]/i.test(str)) return false;
  return true;
}

/**
 * Стандартное сравнение локусов (для поиска дубликатов)
 * Возвращает количество совпадающих и общих локусов
 */
function compareLocus(refProcessedLoci, compProcessedLoci, ignoredSet) {
  let matchingLoci = 0;
  let totalLoci = 0;
  const matchedLociNames = [];
  
  for (const locus of getAnalysisLoci([{ loci: refProcessedLoci }, { loci: compProcessedLoci }])) {
    if (ignoredSet.has(locus)) continue;
    
    const refData = refProcessedLoci[locus];
    const compData = compProcessedLoci[locus];
    
    // Если хотя бы один профиль не имеет данных по локусу, пропускаем
    if (!refData || !compData) continue;
    
    totalLoci++;
    
    let isMatched = false;
    
    if (refData.isHomozygote) {
      // Гомозигота - быстрая проверка
      isMatched = compData.isHomozygote && refData.parts[0] === compData.parts[0];
    } else {
      // Гетерозигота - используем Set для быстрой проверки
      isMatched = refData.parts.every(part => compData.partsSet.has(part));
    }
    
    if (isMatched) {
      matchingLoci++;
      matchedLociNames.push(locus);
    }
  }
  
  return {
    matchingLoci,
    totalLoci,
    matchedLoci: matchedLociNames
  };
}

/**
 * Сравнение с алгоритмом контаминации (обёртка для processedLoci)
 * Возвращает скор и список совпадающих локусов
 * @param {Object} refProcessedLoci - Обработанные локусы референса
 * @param {Object} compProcessedLoci - Обработанные локусы для сравнения
 * @param {Set} ignoredSet - Игнорируемые локусы
 * @param {boolean} useV5 - Использовать алгоритм v5.0 (по умолчанию true)
 */
function compareWithContaminationAlgorithm(refProcessedLoci, compProcessedLoci, ignoredSet, useV5 = true) {
  // Если включен v5.0, используем новый алгоритм
  if (useV5) {
    // Преобразуем processedLoci в формат для v5.0
    const refProfile = {};
    const compProfile = {};

    for (const locus of getAnalysisLoci([{ loci: refProcessedLoci }, { loci: compProcessedLoci }])) {
      if (ignoredSet.has(locus)) continue;

      if (refProcessedLoci[locus]) {
        refProfile[locus] = refProcessedLoci[locus].parts || [];
      }
      if (compProcessedLoci[locus]) {
        compProfile[locus] = compProcessedLoci[locus].parts || [];
      }
    }

    const result = calculateContaminationScoreV5(refProfile, compProfile, ignoredSet);

    return {
      matchingLoci: result.matchedLoci,
      totalLoci: getAnalysisLoci([{ loci: refProcessedLoci }, { loci: compProcessedLoci }]).filter(locus => !ignoredSet.has(locus)).length,
      matchedLoci: result.matchedLociNames,
      score: result.score,
      level: result.level,
      severity: result.severity,
      rareCriticalMatches: result.rareCriticalMatches,
      rareRuleTriggered: result.rareRuleTriggered,
      algorithm: result.algorithm
    };
  }

  // Старый алгоритм v4.0 (для обратной совместимости)
  let rawScore = 0;
  let markersEvaluated = 0;
  let matchCount = 0;
  const matchedLociNames = [];

  for (const locus of getAnalysisLoci([{ loci: refProcessedLoci }, { loci: compProcessedLoci }])) {
    if (ignoredSet.has(locus)) continue;

    const refData = refProcessedLoci[locus];
    const compData = compProcessedLoci[locus];

    if (!refData || !compData) continue;

    // Используем функцию сравнения с весами
    const comparison = compareLocusContamination(refData.parts, compData.parts, locus);

    rawScore += comparison.score;
    markersEvaluated++;

    // Считаем совпадения для matchedLoci
    if (comparison.matchType === 'full' || comparison.matchType === 'partial') {
      matchedLociNames.push(locus);
      if (comparison.matchType === 'full') {
        matchCount++; // Полное совпадение
      }
    }
  }

  // Нормализация скора (0-10)
  const score = markersEvaluated > 0 ? (rawScore / markersEvaluated) * 10 : 0;

  return {
    matchingLoci: matchCount,
    totalLoci: markersEvaluated,
    matchedLoci: matchedLociNames,
    score: parseFloat(score.toFixed(2)),
    algorithm: 'v4.0'
  };
}


/**
 * Извлечение номера привоза из профиля
 * Читает только из столбца import_number
 */
function extractImportNumber(profile) {
  // Читаем только из столбца import_number
  if (profile.import_number) {
    return profile.import_number.toString();
  }
  
  return '';
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
    
    res.json({
      success: true,
      matches,
      count: matches.length,
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
      profileIds = []
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
    
    const massSearchResults = [];
    let comparisonCount = 0;
    let earlyExits = 0;
    
    // Создаем Set для игнорируемых локусов (быстрая проверка)
    const ignoredSet = new Set(ignoredLoci);
    
    // Set для отслеживания уже обработанных пар (чтобы избежать дубликатов)
    const processedPairs = new Set();
    
    // ОПТИМИЗАЦИЯ 1: Предобработка всех профилей один раз
    const processedProfiles = profiles.map(profile => {
      const loci = profile.str_data || {};
      const processedLoci = {};
      let validLociCount = 0;
      
      for (const locus of Object.keys(loci)) {
        if (ignoredSet.has(locus)) continue;
        
        const locusData = loci[locus];
        if (!locusData) continue;
        
        // Используем parseAlleles для правильной фильтрации
        const parts = parseAlleles(locusData);
        
        // Проверяем что есть валидные аллели
        if (parts.length > 0) {
          processedLoci[locus] = {
            parts: parts,
            isHomozygote: parts.length === 2 && parts[0] === parts[1],
            partsSet: new Set(parts)  // Для быстрой проверки вхождения
          };
          validLociCount++;
        }
      }
      
      return {
        id: profile.id,
        import_format: profile.import_format,
        sample_name: profile.sample_name,
        internal_number: profile.internal_number || profile.sample_name,
        import_number: extractImportNumber(profile),
        loci: profile.str_data || {},  // Добавляем оригинальные данные локусов
        processedLoci,
        validLociCount
      };
    });
    
    // ОПТИМИЗАЦИЯ 2: Сравнение с ранним выходом
    for (let i = 0; i < processedProfiles.length; i++) {
      const referenceProfile = processedProfiles[i];
      const referenceLoci = referenceProfile.processedLoci;
      const refLociKeys = Object.keys(referenceLoci);
      const maxPossibleMatches = refLociKeys.length;
      
      // Ранний выход: если у эталона меньше локусов чем нужно
      if (maxPossibleMatches < minMatches) {
        continue;
      }
      
      const matches = [];
      
      for (let j = 0; j < processedProfiles.length; j++) {
        if (i === j) continue;
        
        const compareProfile = processedProfiles[j];
        const compareLoci = compareProfile.processedLoci;
        
        // Ранний выход: если у сравниваемого профиля меньше локусов чем нужно
        if (compareProfile.validLociCount < minMatches) {
          earlyExits++;
          continue;
        }
        
        let numericMatchCount = 0;
        const matchedLoci = [];
        
        comparisonCount++;
        
        // ОПТИМИЗАЦИЯ 3: Сравнение с ранним выходом
        for (let k = 0; k < refLociKeys.length; k++) {
          const locus = refLociKeys[k];
          
          if (!compareLoci[locus]) {
            // Ранний выход: проверяем можем ли еще достичь порога
            const remainingLoci = refLociKeys.length - k - 1;
            if (numericMatchCount + remainingLoci < minMatches) {
              earlyExits++;
              break;
            }
            continue;
          }
          
          const refData = referenceLoci[locus];
          const compData = compareLoci[locus];
          
          let isMatched = false;
          
          if (refData.isHomozygote) {
            // Гомозигота - быстрая проверка
            isMatched = compData.isHomozygote && refData.parts[0] === compData.parts[0];
          } else {
            // Гетерозигота - используем Set для быстрой проверки
            isMatched = refData.parts.every(part => compData.partsSet.has(part));
          }
          
          if (isMatched) {
            numericMatchCount++;
            matchedLoci.push(locus);
          } else {
            // Ранний выход: проверяем можем ли еще достичь порога
            const remainingLoci = refLociKeys.length - k - 1;
            if (numericMatchCount + remainingLoci < minMatches) {
              earlyExits++;
              break;
            }
          }
        }
        
        if (numericMatchCount >= minMatches) {
          // Дополнительная проверка: не добавляем сам эталонный профиль
          if (compareProfile.id === referenceProfile.id) {
            continue;
          }
          
          // Проверка по sample_name (на случай дубликатов)
          if (referenceProfile.import_format !== 'genetic' && compareProfile.sample_name === referenceProfile.sample_name) {
            continue;
          }
          
          matches.push({
            id: compareProfile.id,
            sample_name: compareProfile.sample_name,
            internal_number: compareProfile.internal_number,
            import_number: compareProfile.import_number,
            matchCount: numericMatchCount,
            matchedLoci: matchedLoci,
            loci: compareProfile.loci
          });
        }
      }
      
      if (matches.length > 0) {
        matches.sort((a, b) => b.matchCount - a.matchCount);
        
        // Фильтруем дубликаты пар (A→B и B→A)
        const refId = referenceProfile.id;
        const uniqueMatches = [];
        
        for (const match of matches) {
          const pairKey = [refId, match.id].sort().join('_');
          if (!processedPairs.has(pairKey)) {
            processedPairs.add(pairKey);
            uniqueMatches.push(match);
          }
        }
        
        // Если есть уникальные совпадения, добавляем результат
        if (uniqueMatches.length > 0) {
          // Ограничиваем количество результатов для ускорения передачи
          const limitedMatches = uniqueMatches.slice(0, 100); // Топ-100 совпадений
          
          massSearchResults.push({
            reference: {
              id: referenceProfile.id,
              sample_name: referenceProfile.sample_name,
              internal_number: referenceProfile.internal_number,
              import_number: referenceProfile.import_number
            },
            matches: limitedMatches,
            matchCount: matches.length,  // Полное количество
            displayedCount: limitedMatches.length  // Показываем только топ
          });
        }
      }
    }
    
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
    
    res.json({
      success: true,
      results: massSearchResults,
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
        mode: 'single-threaded-optimized'
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
router.post('/task-search', authenticate, async (req, res) => {
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
    
    // Получаем профили задачи
    const taskProfilesData = await DNAProfile.findByTaskId(taskId);
    
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
    
    // Создаем Set для игнорируемых локусов
    const ignoredSet = new Set(ignoredLoci);
    
    // Предобработка профилей
    const processedReference = referenceProfiles.map(profile => {
      const loci = profile.str_data || {};
      const processedLoci = {};
      let validLociCount = 0;
      
      for (const locus of Object.keys(loci)) {
        if (ignoredSet.has(locus)) continue;
        
        const locusData = loci[locus];
        if (!locusData) continue;
        
        // Используем parseAlleles для правильной фильтрации
        const parts = parseAlleles(locusData);
        
        // Проверяем что есть валидные аллели
        if (parts.length > 0) {
          processedLoci[locus] = {
            parts: parts,
            isHomozygote: parts.length === 2 && parts[0] === parts[1],
            partsSet: new Set(parts)
          };
          validLociCount++;
        }
      }
      
      return {
        ...profile,
        processedLoci,
        validLociCount
      };
    });
    
    const processedCompare = compareProfiles.map(profile => {
      const loci = profile.str_data || {};
      const processedLoci = {};
      let validLociCount = 0;
      
      for (const locus of Object.keys(loci)) {
        if (ignoredSet.has(locus)) continue;
        
        const locusData = loci[locus];
        if (!locusData) continue;
        
        // Используем parseAlleles для правильной фильтрации
        const parts = parseAlleles(locusData);
        
        // Проверяем что есть валидные аллели
        if (parts.length > 0) {
          processedLoci[locus] = {
            parts: parts,
            isHomozygote: parts.length === 2 && parts[0] === parts[1],
            partsSet: new Set(parts)
          };
          validLociCount++;
        }
      }
      
      return {
        ...profile,
        processedLoci,
        validLociCount
      };
    });
    
    // Выполняем сравнение
    const results = [];
    let comparisonCount = 0;
    
    logger.info('🔍 Начало цикла сравнения', {
      processedReferenceCount: processedReference.length,
      processedCompareCount: processedCompare.length,
      minMatches
    });
    
    for (let i = 0; i < processedReference.length; i++) {
      const refProfile = processedReference[i];
      const refLoci = refProfile.processedLoci;
      const refLociKeys = Object.keys(refLoci);
      
      // Пропускаем эталонные профили с недостаточным количеством локусов
      if (refProfile.validLociCount < minMatches) {
        continue;
      }
      
      const matches = [];
      
      for (let j = 0; j < processedCompare.length; j++) {
        const compProfile = processedCompare[j];
        
        // Пропускаем сравнение профиля с самим собой
        // В режиме "task" - по ID
        // В режиме "master_array" - по sample_name, internal_number И year (уникальная комбинация)
        if (searchMode === 'task' && refProfile.id === compProfile.id) continue;
        if (searchMode === 'master_array' && 
            refProfile.sample_name === compProfile.sample_name && 
            refProfile.internal_number === compProfile.internal_number &&
            refProfile.year === compProfile.year) {
          continue;
        }
        
        // НЕ пропускаем профили с малым количеством локусов - сравниваем все!
        // Фильтрация по minMatches будет после подсчета совпадений
        
        const compLoci = compProfile.processedLoci;
        let matchCount = 0;
        let matchScore = 0; // Для алгоритма контаминации
        const matchedLoci = [];
        
        comparisonCount++;
        
        // Выбор алгоритма сравнения
        if (comparisonAlgorithm === 'duplicate_v5') {
          // АЛГОРИТМ ПОИСКА ДУБЛЕЙ V5.0 - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ С РАННИМ ВЫХОДОМ
          // Работаем напрямую с объектами БД без преобразований
          
          // Получаем настройки из запроса
          const duplicateSettingsFromReq = req.body.duplicateSettings || {};
          const locusWeights = duplicateSettingsFromReq.locusWeights || {};
          
          // Передаем пороги для раннего выхода
          const thresholds = {
            minScore: duplicateSettingsFromReq.minScore || 15,
            minPercentage: duplicateSettingsFromReq.minPercentage || 80,
            minLoci: duplicateSettingsFromReq.minLoci || 15
          };
          
          // Вызываем ОПТИМИЗИРОВАННЫЙ алгоритм v5.0 с ранним выходом
          const v5Result = calculateDuplicateSimilarityOptimized(
            refProfile.str_data,
            compProfile.str_data,
            { locusWeights, ignoredLoci, thresholds }
          );
          
          // Если был ранний выход - пропускаем
          if (v5Result.earlyExit) {
            continue;
          }
          
          const meetsScoreThreshold = v5Result.totalScore >= thresholds.minScore;
          const meetsPercentageThreshold = parseFloat(v5Result.matchPercentage) >= thresholds.minPercentage && v5Result.comparedLociCount >= thresholds.minLoci;
          
          if (meetsScoreThreshold || meetsPercentageThreshold) {
            // Подсчитываем количество совпадений для обратной совместимости
            matchCount = Object.values(v5Result.details).filter(d => 
              d.status === 'match' || d.status === 'contamination' || d.status === 'dropout'
            ).length;
            
            matches.push({
              id: compProfile.id,
              sample_name: compProfile.sample_name,
              internal_number: compProfile.internal_number,
              import_number: extractImportNumber(compProfile),
              year: compProfile.year,
              matchCount: matchCount,
              totalScore: v5Result.totalScore,
              matchPercentage: parseFloat(v5Result.matchPercentage),
              comparedLociCount: v5Result.comparedLociCount,
              maxPossibleScore: v5Result.maxPossibleScore,
              details: v5Result.details,
              loci: compProfile.str_data,
              source: compProfile.source,
              algorithm: 'duplicate_v5'
            });
          }
        } else if (comparisonAlgorithm === 'contamination') {
          // АЛГОРИТМ КОНТАМИНАЦИИ (используем функцию с поддержкой v5.0)
          const matchResult = compareWithContaminationAlgorithm(
            refLoci,
            compLoci,
            ignoredSet,
            useV5Algorithm
          );
          
          matchCount = matchResult.matchingLoci;
          matchScore = matchResult.score;
          matchedLoci.push(...matchResult.matchedLoci);
          
          // Для алгоритма контаминации используем порог по скору
          // minMatches интерпретируется как минимальное количество совпадений
          // Для v5.0 используем более гибкую логику с учетом уровня
          const minScoreThreshold = 5.0; // Минимальный скор качества (WARNING и выше)
          
          if (matchCount >= minMatches || matchScore >= minScoreThreshold) {
            matches.push({
              id: compProfile.id,
              sample_name: compProfile.sample_name,
              internal_number: compProfile.internal_number,
              import_number: extractImportNumber(compProfile),
              year: compProfile.year,
              matchCount: matchCount,
              matchScore: parseFloat(matchScore.toFixed(2)),
              matchedLoci: matchedLoci,
              loci: compProfile.str_data,
              source: compProfile.source,
              algorithm: matchResult.algorithm || 'contamination',
              level: matchResult.level,
              severity: matchResult.severity,
              rareCriticalMatches: matchResult.rareCriticalMatches,
              rareRuleTriggered: matchResult.rareRuleTriggered
            });
          }
        } else {
          // СТАНДАРТНЫЙ АЛГОРИТМ (точное совпадение)
          for (const locus of refLociKeys) {
            if (!compLoci[locus]) continue;
            
            const refData = refLoci[locus];
            const compData = compLoci[locus];
            
            let isMatched = false;
            
            if (refData.isHomozygote) {
              isMatched = compData.isHomozygote && refData.parts[0] === compData.parts[0];
            } else {
              isMatched = refData.parts.every(part => compData.partsSet.has(part));
            }
            
            if (isMatched) {
              matchCount++;
              matchedLoci.push(locus);
            }
          }
          
          if (matchCount >= minMatches) {
            const matchResult = {
              id: compProfile.id,
              sample_name: compProfile.sample_name,
              internal_number: compProfile.internal_number,
              import_number: extractImportNumber(compProfile),
              year: compProfile.year,
              matchCount: matchCount,
              matchedLoci: matchedLoci,
              loci: compProfile.str_data,
              source: compProfile.source,
              algorithm: 'standard'
            };
            
            matches.push(matchResult);
          }
        }
      }
      
      if (matches.length > 0) {
        matches.sort((a, b) => b.matchCount - a.matchCount);
        
        results.push({
          reference: {
            id: refProfile.id,
            sample_name: refProfile.sample_name,
            internal_number: refProfile.internal_number,
            import_number: extractImportNumber(refProfile),
            year: refProfile.year
          },
          matches: matches.slice(0, 100), // Топ-100
          matchCount: matches.length,
          displayedCount: Math.min(matches.length, 100)
        });
      }
    }
    
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
      const ContaminationLogger = require('../services/contaminationLogger');
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
    
    res.json({
      success: true,
      results: results,
      totalAnalyzed: referenceProfiles.length,
      resultsWithMatches: results.length,
      searchMode: searchMode,
      comparisonAlgorithm: comparisonAlgorithm,
      statistics: {
        duration: duration,
        durationSeconds: (duration / 1000).toFixed(2),
        comparisons: comparisonCount,
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
    
    res.status(500).json({
      success: false,
      error: 'Ошибка выполнения поиска: ' + error.message
    });
  }
});

/**
 * POST /api/genotype-analysis/department-tasks-search
 * Поиск дубликатов в активных задачах других пользователей отдела
 */
router.post('/department-tasks-search', authenticate, async (req, res) => {
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
    const taskQuery = await pool.query(`
      SELECT t.id, t.department_id, t.assigned_to_user
      FROM tasks t
      WHERE t.id = $1
    `, [taskId]);
    
    if (taskQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Задача не найдена'
      });
    }
    
    const currentTask = taskQuery.rows[0];
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
      WHERE dp.task_id = $1 AND dp.is_active = true
    `, [taskId]);
    
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
      LEFT JOIN users u ON t.assigned_to_user = u.id
      WHERE t.department_id = $1 
        AND t.id != $2
        AND t.status = 'in_progress'
        AND t.is_active = true
      ORDER BY t.created_at DESC
    `, [departmentId, taskId]);
    
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
      LEFT JOIN users u ON t.assigned_to_user = u.id
      WHERE dp.task_id = ANY($1) AND dp.is_active = true
    `, [taskIds]);
    
    const compareProfiles = compareProfilesQuery.rows;
    
    logger.info('📊 Профили для сравнения загружены', {
      referenceCount: referenceProfiles.length,
      compareCount: compareProfiles.length
    });
    
    // Создаем Set для игнорируемых локусов
    const ignoredSet = new Set(ignoredLoci);
    
    // Предобработка эталонных профилей
    const processedReferenceProfiles = referenceProfiles.map(profile => {
      const loci = profile.str_data || {};
      const processedLoci = {};
      let validLociCount = 0;
      
      for (const locus of Object.keys(loci)) {
        if (ignoredSet.has(locus)) continue;
        
        const locusData = loci[locus];
        if (!locusData) continue;
        
        const parts = parseAlleles(locusData);
        
        if (parts.length > 0) {
          processedLoci[locus] = {
            parts: parts,
            isHomozygote: parts.length === 2 && parts[0] === parts[1],
            partsSet: new Set(parts)
          };
          validLociCount++;
        }
      }
      
      return {
        id: profile.id,
        sample_name: profile.sample_name,
        internal_number: profile.internal_number || profile.sample_name,
        import_number: extractImportNumber(profile),
        year: profile.year,
        loci: profile.str_data || {},
        processedLoci,
        validLociCount
      };
    });
    
    // Предобработка профилей для сравнения
    const processedCompareProfiles = compareProfiles.map(profile => {
      const loci = profile.str_data || {};
      const processedLoci = {};
      let validLociCount = 0;
      
      for (const locus of Object.keys(loci)) {
        if (ignoredSet.has(locus)) continue;
        
        const locusData = loci[locus];
        if (!locusData) continue;
        
        const parts = parseAlleles(locusData);
        
        if (parts.length > 0) {
          processedLoci[locus] = {
            parts: parts,
            isHomozygote: parts.length === 2 && parts[0] === parts[1],
            partsSet: new Set(parts)
          };
          validLociCount++;
        }
      }
      
      return {
        id: profile.id,
        task_id: profile.task_id,
        task_name: profile.task_name,
        task_owner: profile.task_owner,
        sample_name: profile.sample_name,
        internal_number: profile.internal_number || profile.sample_name,
        import_number: extractImportNumber(profile),
        year: profile.year,
        loci: profile.str_data || {},
        processedLoci,
        validLociCount
      };
    });
    
    // Выполняем сравнение
    const results = [];
    let comparisonCount = 0;
    
    for (const refProfile of processedReferenceProfiles) {
      const matches = [];
      
      for (const compareProfile of processedCompareProfiles) {
        comparisonCount++;
        
        let matchResult;
        if (comparisonAlgorithm === 'duplicate_v5') {
          // АЛГОРИТМ ПОИСКА ДУБЛЕЙ V5.0 - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ С РАННИМ ВЫХОДОМ
          // Работаем напрямую с объектами БД без преобразований
          
          // Получаем настройки из запроса
          const duplicateSettingsFromReq = req.body.duplicateSettings || {};
          const locusWeights = duplicateSettingsFromReq.locusWeights || {};
          
          // Передаем пороги для раннего выхода
          const thresholds = {
            minScore: duplicateSettingsFromReq.minScore || 15,
            minPercentage: duplicateSettingsFromReq.minPercentage || 80,
            minLoci: duplicateSettingsFromReq.minLoci || 15
          };
          
          // Вызываем ОПТИМИЗИРОВАННЫЙ алгоритм v5.0 с ранним выходом
          const v5Result = calculateDuplicateSimilarityOptimized(
            refProfile.loci,
            compareProfile.loci,
            { locusWeights, ignoredLoci, thresholds }
          );
          
          // Если был ранний выход - пропускаем
          if (v5Result.earlyExit) {
            continue;
          }
          
          const meetsScoreThreshold = v5Result.totalScore >= thresholds.minScore;
          const meetsPercentageThreshold = parseFloat(v5Result.matchPercentage) >= thresholds.minPercentage && v5Result.comparedLociCount >= thresholds.minLoci;
          
          if (meetsScoreThreshold || meetsPercentageThreshold) {
            matches.push({
              id: compareProfile.id,
              task_id: compareProfile.task_id,
              task_name: compareProfile.task_name,
              task_owner: compareProfile.task_owner,
              sample_name: compareProfile.sample_name,
              internal_number: compareProfile.internal_number,
              import_number: compareProfile.import_number,
              year: compareProfile.year,
              loci: compareProfile.loci,
              matchingLoci: v5Result.comparedLociCount,
              totalLoci: v5Result.comparedLociCount,
              matchedLoci: Object.keys(v5Result.details).filter(locus => 
                v5Result.details[locus].status === 'match' || 
                v5Result.details[locus].status === 'contamination' || 
                v5Result.details[locus].status === 'dropout'
              ),
              totalScore: v5Result.totalScore,
              matchPercentage: parseFloat(v5Result.matchPercentage),
              maxPossibleScore: v5Result.maxPossibleScore,
              details: v5Result.details,
              algorithm: 'duplicate_v5',
              score: v5Result.totalScore
            });
          }
        } else if (comparisonAlgorithm === 'contamination') {
          matchResult = compareWithContaminationAlgorithm(
            refProfile.processedLoci,
            compareProfile.processedLoci,
            ignoredSet,
            useV5Algorithm
          );
          
          if (matchResult.matchingLoci >= minMatches) {
            matches.push({
              id: compareProfile.id,
              task_id: compareProfile.task_id,
              task_name: compareProfile.task_name,
              task_owner: compareProfile.task_owner,
              sample_name: compareProfile.sample_name,
              internal_number: compareProfile.internal_number,
              import_number: compareProfile.import_number,
              year: compareProfile.year,
              loci: compareProfile.loci,
              matchingLoci: matchResult.matchingLoci,
              totalLoci: matchResult.totalLoci,
              matchedLoci: matchResult.matchedLoci,
              score: matchResult.score || 0,
              algorithm: 'contamination'
            });
          }
        } else {
          matchResult = compareLocus(
            refProfile.processedLoci,
            compareProfile.processedLoci,
            ignoredSet
          );
          
          if (matchResult.matchingLoci >= minMatches) {
            matches.push({
              id: compareProfile.id,
              task_id: compareProfile.task_id,
              task_name: compareProfile.task_name,
              task_owner: compareProfile.task_owner,
              sample_name: compareProfile.sample_name,
              internal_number: compareProfile.internal_number,
              import_number: compareProfile.import_number,
              year: compareProfile.year,
              loci: compareProfile.loci,
              matchingLoci: matchResult.matchingLoci,
              totalLoci: matchResult.totalLoci,
              matchedLoci: matchResult.matchedLoci,
              score: matchResult.score || 0,
              algorithm: 'standard'
            });
          }
        }
      }
      
      if (matches.length > 0) {
        // Сортируем по количеству совпадений
        matches.sort((a, b) => {
          if (comparisonAlgorithm === 'contamination' || comparisonAlgorithm === 'duplicate_v5') {
            return b.score - a.score;
          }
          return b.matchingLoci - a.matchingLoci;
        });
        
        results.push({
          reference: {
            id: refProfile.id,
            sample_name: refProfile.sample_name,
            internal_number: refProfile.internal_number,
            import_number: refProfile.import_number,
            year: refProfile.year,
            loci: refProfile.loci
          },
          matches: matches
        });
      }
    }
    
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
      const ContaminationLogger = require('../services/contaminationLogger');
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
    
    res.status(200).json({
      success: true,
      results: results,
      stats: {
        totalTimeMs: totalTime,
        comparisons: comparisonCount,
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
    
    res.status(500).json({
      success: false,
      error: 'Ошибка выполнения поиска: ' + error.message
    });
  }
});

/**
 * POST /api/genotype-analysis/department-profiles
 * Загрузка всех профилей из активных задач отдела (для восстановления из истории)
 */
router.post('/department-profiles', authenticate, async (req, res) => {
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
    const taskQuery = await pool.query(`
      SELECT t.id, t.department_id
      FROM tasks t
      WHERE t.id = $1
    `, [taskId]);
    
    if (taskQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Задача не найдена'
      });
    }
    
    const departmentId = taskQuery.rows[0].department_id;
    
    // Получаем все активные задачи отдела (кроме текущей)
    const departmentTasksQuery = await pool.query(`
      SELECT id FROM tasks
      WHERE department_id = $1 
        AND id != $2
        AND status = 'in_progress'
        AND is_active = true
    `, [departmentId, taskId]);
    
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
      WHERE dp.task_id = ANY($1) AND dp.is_active = true
    `, [taskIds]);
    
    res.status(200).json({
      success: true,
      profiles: profilesQuery.rows
    });
    
  } catch (error) {
    logger.error('Ошибка загрузки профилей из задач отдела:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка загрузки профилей из задач отдела'
    });
  }
});

module.exports = router;
