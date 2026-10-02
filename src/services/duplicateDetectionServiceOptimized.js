/**
 * DNA Duplicate Detection Service v5.0 - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
 * Работает напрямую с форматом БД: { allele1: "20", allele2: "21" }
 * Без лишних преобразований и парсинга строк
 */

const logger = require('../utils/logger');

/**
 * Быстрое сравнение двух аллелей (массивов)
 * @param {Array} locusA - ["20", "21"]
 * @param {Array} locusB - ["20", "21"]
 * @returns {Object} { score, status }
 */
const compareLocusArrays = (locusA, locusB) => {
  // Проверка на no call
  if (!locusA || locusA.length === 0 || !locusB || locusB.length === 0) {
    return { score: 0, status: 'no_call' };
  }
  
  // Создаем Set для быстрого поиска
  const setA = new Set(locusA.filter(Boolean));
  const setB = new Set(locusB.filter(Boolean));
  
  // 1. Точное совпадение
  if (setA.size === setB.size) {
    let allMatch = true;
    for (const allele of setA) {
      if (!setB.has(allele)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return { score: 1.0, status: 'match' };
    }
  }
  
  // 2. Вхождение подмножества (контаминация или drop-out)
  let isSubset = true;
  for (const allele of setA) {
    if (!setB.has(allele)) {
      isSubset = false;
      break;
    }
  }
  
  if (isSubset || (isSubset = true, setB.size < setA.size ? false : (() => {
    for (const allele of setB) {
      if (!setA.has(allele)) {
        isSubset = false;
        break;
      }
    }
    return isSubset;
  })())) {
    const maxAlleles = Math.max(setA.size, setB.size);
    if (maxAlleles > 2) {
      return { score: 0.8, status: 'contamination' };
    } else {
      return { score: 0.6, status: 'dropout' };
    }
  }
  
  // 3. Частичное пересечение
  let hasIntersection = false;
  for (const allele of setA) {
    if (setB.has(allele)) {
      hasIntersection = true;
      break;
    }
  }
  
  if (hasIntersection) {
    return { score: -0.5, status: 'partial' };
  }
  
  // 4. Полное несовпадение
  return { score: -1.0, status: 'mismatch' };
};

/**
 * Быстрое сравнение двух аллелей (объектов или массивов)
 * @param {Object|Array} locusA - Массив аллелей или объект { allele1, allele2 }
 * @param {Object|Array} locusB - Массив аллелей или объект { allele1, allele2 }
 * @returns {Object} { score, status }
 */
const compareLocusObjects = (locusA, locusB) => {
  // Преобразуем в массивы аллелей
  let allelesA, allelesB;
  
  if (Array.isArray(locusA)) {
    allelesA = locusA.filter(a => a && a !== '');
  } else if (locusA && typeof locusA === 'object') {
    allelesA = [locusA.allele1, locusA.allele2].filter(a => a && a !== '');
  } else {
    allelesA = [];
  }
  
  if (Array.isArray(locusB)) {
    allelesB = locusB.filter(a => a && a !== '');
  } else if (locusB && typeof locusB === 'object') {
    allelesB = [locusB.allele1, locusB.allele2].filter(a => a && a !== '');
  } else {
    allelesB = [];
  }
  
  // Проверка на no call
  if (allelesA.length === 0 || allelesB.length === 0) {
    return { score: 0, status: 'no_call' };
  }
  
  // Создаем Set для быстрого поиска
  const setA = new Set(allelesA);
  const setB = new Set(allelesB);
  
  // 1. Точное совпадение
  if (setA.size === setB.size) {
    let allMatch = true;
    for (const allele of setA) {
      if (!setB.has(allele)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return { score: 1.0, status: 'match' };
    }
  }
  
  // 2. Вхождение подмножества (контаминация или drop-out)
  let isSubset = true;
  for (const allele of setA) {
    if (!setB.has(allele)) {
      isSubset = false;
      break;
    }
  }
  
  if (isSubset || (isSubset = true, setB.size < setA.size ? false : (() => {
    for (const allele of setB) {
      if (!setA.has(allele)) {
        isSubset = false;
        break;
      }
    }
    return isSubset;
  })())) {
    const maxAlleles = Math.max(setA.size, setB.size);
    if (maxAlleles > 2) {
      return { score: 0.8, status: 'contamination' };
    } else {
      return { score: 0.6, status: 'dropout' };
    }
  }
  
  // 3. Частичное пересечение
  let hasIntersection = false;
  for (const allele of setA) {
    if (setB.has(allele)) {
      hasIntersection = true;
      break;
    }
  }
  
  if (hasIntersection) {
    return { score: -0.5, status: 'partial' };
  }
  
  // 4. Полное несовпадение
  return { score: -1.0, status: 'mismatch' };
};

/**
 * Оптимизированная функция расчета скора для поиска дублей С РАННИМ ВЫХОДОМ
 * Работает с массивами аллелей: { "vWA": ["14", "17"], ... }
 * @param {Object} profileA - Объект профиля { "vWA": ["14", "17"], ... }
 * @param {Object} profileB - Объект профиля { "vWA": ["14", "17"], ... }
 * @param {Object} options - Опции { locusWeights, ignoredLoci, thresholds }
 */
const calculateDuplicateSimilarityOptimized = (profileA, profileB, options = {}) => {
  const { locusWeights = {}, ignoredLoci = [], thresholds = {} } = options;
  
  // Пороги для раннего выхода
  const minScore = thresholds.minScore || 15;
  const minPercentage = thresholds.minPercentage || 80;
  const minLoci = thresholds.minLoci || 15;
  
  // Создаем Set для быстрой проверки игнорируемых локусов
  const ignoredSet = new Set(ignoredLoci);
  
  // Собираем все уникальные локусы из двух профилей
  const allLoci = new Set([...Object.keys(profileA), ...Object.keys(profileB)]);
  
  let totalScore = 0;
  let maxPossibleScore = 0;
  let comparedLociCount = 0;
  let processedLociCount = 0;
  
  const details = {};
  
  // Список служебных полей
  const ignoredFields = new Set(['sample_name', 'id', 'gender', 'internal_number', 'created_at', 'year', 'import_number']);
  
  // Подсчитываем максимально возможное количество локусов
  let maxPossibleLoci = 0;
  for (const locus of allLoci) {
    if (!ignoredFields.has(locus) && !ignoredSet.has(locus)) {
      maxPossibleLoci++;
    }
  }
  
  for (const locus of allLoci) {
    // Пропускаем служебные поля и игнорируемые локусы
    if (ignoredFields.has(locus) || ignoredSet.has(locus)) continue;
    
    processedLociCount++;
    
    const locusA = profileA[locus];
    const locusB = profileB[locus];
    
    // Проверяем что оба локуса существуют и являются массивами
    if (!locusA || !locusB || !Array.isArray(locusA) || !Array.isArray(locusB)) {
      // РАННИЙ ВЫХОД: проверяем можем ли еще достичь порога
      const remainingLoci = maxPossibleLoci - processedLociCount;
      const maxPossibleScoreRemaining = maxPossibleScore + remainingLoci; // предполагаем вес 1.0
      
      // Если даже при идеальном совпадении оставшихся локусов не достичь порога - выходим
      if (totalScore + remainingLoci < minScore && comparedLociCount + remainingLoci < minLoci) {
        return {
          totalScore: 0,
          comparedLociCount: 0,
          maxPossibleScore: 0,
          matchPercentage: 0,
          details: {},
          earlyExit: true
        };
      }
      
      continue;
    }
    
    // Проверяем что есть хотя бы один аллель в каждом локусе
    if (locusA.length === 0 || locusB.length === 0) {
      // РАННИЙ ВЫХОД
      const remainingLoci = maxPossibleLoci - processedLociCount;
      if (totalScore + remainingLoci < minScore && comparedLociCount + remainingLoci < minLoci) {
        return {
          totalScore: 0,
          comparedLociCount: 0,
          maxPossibleScore: 0,
          matchPercentage: 0,
          details: {},
          earlyExit: true
        };
      }
      
      continue;
    }
    
    comparedLociCount++;
    const weight = locusWeights[locus] || 1.0;
    maxPossibleScore += weight;
    
    // Сравниваем локусы (массивы)
    const result = compareLocusArrays(locusA, locusB);
    
    // Применяем вес локуса
    const weightedScore = result.score * weight;
    totalScore += weightedScore;
    
    details[locus] = {
      score: result.score,
      weightedScore: weightedScore,
      status: result.status,
      valA: locusA,
      valB: locusB,
      allelesA: locusA,
      allelesB: locusB
    };
    
    // РАННИЙ ВЫХОД: если уже понятно что не достигнем порога
    const remainingLoci = maxPossibleLoci - processedLociCount;
    const maxPossibleFinalScore = totalScore + remainingLoci; // предполагаем идеальное совпадение
    
    // Проверяем: даже при идеальном совпадении оставшихся локусов не достичь порога
    if (maxPossibleFinalScore < minScore && comparedLociCount + remainingLoci < minLoci) {
      return {
        totalScore: 0,
        comparedLociCount: 0,
        maxPossibleScore: 0,
        matchPercentage: 0,
        details: {},
        earlyExit: true
      };
    }
  }
  
  return {
    totalScore: parseFloat(totalScore.toFixed(2)),
    comparedLociCount,
    maxPossibleScore: parseFloat(maxPossibleScore.toFixed(2)),
    matchPercentage: comparedLociCount > 0 ? Math.max(0, (totalScore / maxPossibleScore) * 100).toFixed(1) : 0,
    details,
    earlyExit: false
  };
};

/**
 * Проверка, является ли профиль дубликатом
 * @param {Object} result - Результат calculateDuplicateSimilarityOptimized
 * @param {Object} thresholds - Пороги { minScore, minPercentage, minLoci }
 */
const isDuplicateOptimized = (result, thresholds = {}) => {
  const {
    minScore = 15,
    minPercentage = 80,
    minLoci = 15
  } = thresholds;
  
  // Используем ИЛИ для более гибкой фильтрации
  const meetsScoreThreshold = result.totalScore >= minScore;
  const meetsPercentageThreshold = parseFloat(result.matchPercentage) >= minPercentage && result.comparedLociCount >= minLoci;
  
  return meetsScoreThreshold || meetsPercentageThreshold;
};

module.exports = {
  calculateDuplicateSimilarityOptimized,
  isDuplicateOptimized,
  compareLocusObjects
};
