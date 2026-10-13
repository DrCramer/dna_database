const { equalSets, isAlleleSubset, setIntersection, hasIntersection } = require("../../utils/alleleComparison");
const { informativeAlleles } = require("../../utils/alleleTokens");
/**
 * DNA Duplicate Detection Service v5.0
 * Оптимизирован для поиска дубликатов с учетом:
 * - Гомозигот (11,11 = 1.0 балл)
 * - Drop-out (потеря аллеля = 0.6 балл)
 * - Контаминации (вхождение в смесь = 0.8 балл)
 */


// Утилиты для работы с множествами
const utils = {
  // Парсинг строки "14, 15.2" -> Set(["14", "15.2"])
  parseAlleles: value => new Set(informativeAlleles(value)),

  eqSet: equalSets,
  isSubset: isAlleleSubset,
  intersection: setIntersection
};

/**
 * Основная функция расчета скора для поиска дублей
 * @param {Object} profileA - Объект профиля { "vWA": "14,17", ... }
 * @param {Object} profileB - Объект профиля { "vWA": "14,17", ... }
 * @param {Object} options - Опции { locusWeights, ignoredLoci }
 */
const calculateDuplicateSimilarity = (profileA, profileB, options = {}) => {
  const { locusWeights = {}, ignoredLoci = [] } = options;

  // Собираем все уникальные локусы из двух профилей
  const loci = new Set([...Object.keys(profileA), ...Object.keys(profileB)]);

  let totalScore = 0;
  let maxPossibleScore = 0; // Для расчета % совпадения
  let comparedLociCount = 0;

  const details = {}; // Детализация для UI (тепловая карта)

  // Список служебных полей, которые не являются локусами
  const ignoredFields = ['sample_name', 'id', 'gender', 'internal_number', 'created_at', 'year', 'import_number'];
  const ignoredSet = new Set([...ignoredFields, ...ignoredLoci]);

  for (const locus of loci) {
    if (ignoredSet.has(locus)) continue;

    const valA = profileA[locus];
    const valB = profileB[locus];

    const setA = utils.parseAlleles(valA);
    const setB = utils.parseAlleles(valB);

    // Пропускаем локус, если хотя бы в одном профиле нет данных (No Call)
    if (setA.size === 0 || setB.size === 0) {
      details[locus] = { status: 'no_call', score: 0, valA, valB };
      continue;
    }

    comparedLociCount++;
    const weight = locusWeights[locus] || 1.0;
    maxPossibleScore += (1.0 * weight); // Максимум, если бы было полное совпадение

    let matchScore = 0;
    let status = 'mismatch';

    // --- ЛОГИКА v5.0 ---

    // 1. Полное точное совпадение (1.0)
    if (utils.eqSet(setA, setB)) {
      matchScore = 1.0;
      status = 'match';
    }
    // 2. Вхождение подмножества (0.8 или 0.6)
    else if (utils.isSubset(setA, setB) || utils.isSubset(setB, setA)) {
      // Если в большем профиле > 2 аллелей -> это Смесь (Contamination) -> 0.8
      // Если в большем профиле <= 2 аллелей -> это Drop-out -> 0.6
      const maxAlleles = Math.max(setA.size, setB.size);
      if (maxAlleles > 2) {
        matchScore = 0.8;
        status = 'contamination';
      } else {
        matchScore = 0.6;
        status = 'dropout';
      }
    }
    // 3. Частичное пересечение (-0.5)
    else if (utils.intersection(setA, setB).size > 0) {
      matchScore = -0.5;
      status = 'partial';
    }
    // 4. Полное несовпадение (-1.0)
    else {
      matchScore = -1.0;
      status = 'mismatch';
    }

    // Применяем вес локуса
    totalScore += (matchScore * weight);

    details[locus] = {
      score: matchScore,
      weightedScore: matchScore * weight,
      status: status, // match, contamination, dropout, partial, mismatch, no_call
      valA: valA,
      valB: valB,
      allelesA: Array.from(setA),
      allelesB: Array.from(setB)
    };
  }

  return {
    totalScore: parseFloat(totalScore.toFixed(2)),
    comparedLociCount,
    maxPossibleScore: parseFloat(maxPossibleScore.toFixed(2)),
    // Нормализованный % сходства (с учетом весов)
    matchPercentage: comparedLociCount > 0 ? Math.max(0, (totalScore / maxPossibleScore) * 100).toFixed(1) : 0,
    details
  };
};

/**
 * Проверка, является ли профиль дубликатом
 * @param {Object} result - Результат calculateDuplicateSimilarity
 * @param {Object} thresholds - Пороги { minScore, minPercentage, minLoci }
 */
const isDuplicate = (result, thresholds = {}) => {
  const {
    minScore = 15,           // Минимальный суммарный скор
    minPercentage = 80,      // Минимальный процент совпадения
    minLoci = 15             // Минимальное количество сравненных локусов
  } = thresholds;

  return (
    result.totalScore >= minScore &&
    parseFloat(result.matchPercentage) >= minPercentage &&
    result.comparedLociCount >= minLoci
  );
};

const compareLocusArrays = (locusA, locusB) => {
  locusA = informativeAlleles(locusA); locusB = informativeAlleles(locusB);
  // Проверка на no call
  if (!locusA || locusA.length === 0 || !locusB || locusB.length === 0) {
    return { score: 0, status: 'no_call' };
  }

  // Создаем Set для быстрого поиска
  const setA = new Set(locusA.filter(Boolean));
  const setB = new Set(locusB.filter(Boolean));

  if (equalSets(setA, setB)) return { score: 1, status: 'match' };
  // Сохраняем историческую асимметрию быстрого пути, зафиксированную в baseline.
  if (isAlleleSubset(setA, setB) || (setB.size >= setA.size && isAlleleSubset(setB, setA))) {
    return Math.max(setA.size, setB.size) > 2
      ? { score: 0.8, status: 'contamination' }
      : { score: 0.6, status: 'dropout' };
  }
  if (hasIntersection(setA, setB)) return { score: -0.5, status: 'partial' };
  return { score: -1, status: 'mismatch' };
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

  allelesA = informativeAlleles(allelesA); allelesB = informativeAlleles(allelesB);
  // Проверка на no call
  if (allelesA.length === 0 || allelesB.length === 0) {
    return { score: 0, status: 'no_call' };
  }

  return compareLocusArrays(allelesA, allelesB);
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
  calculateDuplicateSimilarity,
  isDuplicate,
  utils,
  calculateDuplicateSimilarityOptimized,
  isDuplicateOptimized,
  compareLocusObjects
};
