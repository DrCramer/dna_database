const { multisetIntersection } = require('../../utils/alleleComparison');
const { informativeAlleles } = require('../../utils/alleleTokens');
const { getAnalysisLoci } = require('../../utils/analysisLoci');
const { calculateContaminationScoreV5 } = require('../../utils/contaminationAlgorithm');
const { prepareLocusData, isExactLocusMatch } = require('../../utils/exactLocusComparison');
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

/**
 * Парсит аллели в массив
 */
function parseAlleles(value) { return informativeAlleles(value); }

/**
 * Вычисляет пересечение двух массивов с учетом количества повторений
 */
const intersect = multisetIntersection;

/**
 * Проверка совпадения между двумя значениями аллелей (СТАНДАРТНЫЙ АЛГОРИТМ)
 */
function isMatch(inputValue, cellValue) {
  if (!inputValue || !cellValue) return false;

  return isExactLocusMatch(prepareLocusData(String(inputValue).toUpperCase()), prepareLocusData(String(cellValue).toUpperCase()));
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

    const isMatched = isExactLocusMatch(refData, compData);

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


module.exports = { parseAlleles, isMatch, isNumericValue, compareLocus, compareWithContaminationAlgorithm, extractImportNumber };
