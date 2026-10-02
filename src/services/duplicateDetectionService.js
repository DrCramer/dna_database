/**
 * DNA Duplicate Detection Service v5.0
 * Оптимизирован для поиска дубликатов с учетом:
 * - Гомозигот (11,11 = 1.0 балл)
 * - Drop-out (потеря аллеля = 0.6 балл)
 * - Контаминации (вхождение в смесь = 0.8 балл)
 */

const logger = require('../utils/logger');

// Утилиты для работы с множествами
const utils = {
  // Парсинг строки "14, 15.2" -> Set(["14", "15.2"])
  parseAlleles: (str) => {
    if (!str || typeof str !== 'string') return new Set();
    // Удаляем спецсимволы *, ?, F и пробелы
    const cleanStr = str.replace(/[?*F]/g, '').trim();
    if (!cleanStr) return new Set();
    return new Set(cleanStr.split(',').map(s => s.trim()).filter(Boolean));
  },

  eqSet: (as, bs) => as.size === bs.size && [...as].every((x) => bs.has(x)),
  isSubset: (subset, superset) => [...subset].every((x) => superset.has(x)),
  intersection: (as, bs) => new Set([...as].filter((x) => bs.has(x)))
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

module.exports = {
  calculateDuplicateSimilarity,
  isDuplicate,
  utils
};
