const { informativeAlleles } = require('./alleleTokens');
/**
 * Алгоритм контаминации v5.0
 * Поддержка LCN (Low Copy Number) и деградированных образцов
 * 
 * Основные улучшения:
 * - Учет вероятности выпадения аллелей (Drop-out)
 * - Корректировка на деградацию (длинные vs короткие локусы)
 * - Бонус за редкие аллели
 * - "Правило трех редких" для критических случаев
 */

// Веса локусов (v5.0) - обновленные с учетом информативности
const LOCUS_WEIGHTS_V5 = {
  'SE33': 2.5,        // Самый информативный
  'D1S1656': 2.0,
  'D12S391': 2.0,
  'D10S1248': 1.8,    // Mini-STR, важен для деградации
  'D2S1338': 1.5,
  'D19S433': 1.3,
  'D21S11': 1.3,
  'FGA': 1.3,
  'D22S1045': 1.3,    // Mini-STR
  'D18S51': 1.2,
  'D3S1358': 1.0,
  'vWA': 1.0,
  'D16S539': 1.0,
  'CSF1PO': 1.0,
  'D8S1179': 1.0,
  'D2S441': 1.0,      // Mini-STR
  'D13S317': 1.0,
  'D7S820': 1.0,
  'TH01': 0.9,
  'D5S818': 0.9,
  'D14S1434': 0.9,    // Mini-STR
  'TPOX': 0.5,        // Низкая информативность
  'Yindel': 0.3,
  'AMEL': 0.3,
  'DYS391': 0.3
};

// Коэффициенты совпадения для v5.0
const MATCH_COEFFICIENTS_V5 = {
  fullMatch: 1.0,           // Sample(12,13) == Staff(12,13)
  inclusiveDropout: 0.85,   // Sample(12) ⊂ Staff(12,13) - критично для LCN!
  overInclusiveMix: 0.7,    // Staff(12,13) ⊂ Sample(12,13,15)
  partialMix: 0.4,          // Staff(12) ⊂ Sample(12,15) - слабый сигнал
  mismatch: -1.0            // Базовый штраф (корректируется на деградацию)
};

// Mini-STR локусы (короткие фрагменты, устойчивы к деградации)
const SHORT_LOCI = [
  'D10S1248', 'D22S1045', 'D2S441', 'D14S1434'
];

// Длинные локусы (подвержены деградации)
const LONG_LOCI = [
  'FGA', 'D2S1338', 'SE33', 'D18S51', 'D21S11'
];

// Высокоинформативные редкие локусы для "правила трех редких"
const RARE_CRITICAL_LOCI = [
  'SE33', 'D12S391', 'D1S1656'
];

/**
 * Проверяет, является ли аллель редким (микровариант)
 * @param {string} allele - Аллель для проверки
 * @param {string} locus - Название локуса
 * @returns {boolean}
 */
function isRareAllele(allele, locus) {
  // Проверка на десятичные значения (микроварианты)
  const hasDecimal = allele.includes('.') || allele.includes(',');
  
  if (!hasDecimal) {
    return false;
  }
  
  // TH01 9.3 - частый аллель, не считаем редким
  if (locus === 'TH01' && (allele === '9.3' || allele === '9,3')) {
    return false;
  }
  
  return true;
}

/**
 * Вычисляет бонус за редкость аллелей
 * @param {Array<string>} sampleAlleles - Аллели образца
 * @param {Array<string>} staffAlleles - Аллели сотрудника
 * @param {string} locus - Название локуса
 * @returns {number} - Множитель (1.0 или 1.5)
 */
function calculateRarityBonus(sampleAlleles, staffAlleles, locus) {
  // Проверяем совпадающие аллели на редкость
  for (const allele of sampleAlleles) {
    if (staffAlleles.includes(allele) && isRareAllele(allele, locus)) {
      return 1.5; // Бонус за совпадение редкого аллеля
    }
  }
  return 1.0; // Нет бонуса
}

/**
 * Вычисляет штраф за несовпадение с учетом деградации
 * @param {string} locus - Название локуса
 * @param {boolean} isMismatch - Есть ли несовпадение
 * @returns {number} - Значение штрафа
 */
function calculateDegradationPenalty(locus, isMismatch) {
  if (!isMismatch) {
    return 0;
  }
  
  // Короткие локусы должны были сохраниться - сильный штраф
  if (SHORT_LOCI.includes(locus)) {
    return -2.0;
  }
  
  // Длинные локусы могли разрушиться - малый штраф
  if (LONG_LOCI.includes(locus)) {
    return -0.5;
  }
  
  // Средний штраф для остальных
  return -1.0;
}

/**
 * Проверяет, является ли arr1 подмножеством arr2
 * @param {Array} arr1 - Первый массив
 * @param {Array} arr2 - Второй массив
 * @returns {boolean}
 */
function isSubset(arr1, arr2) {
  if (arr1.length === 0) return false;
  return arr1.every(item => arr2.includes(item));
}

/**
 * Проверяет, есть ли пересечение между массивами
 * @param {Array} arr1 - Первый массив
 * @param {Array} arr2 - Второй массив
 * @returns {boolean}
 */
function hasIntersection(arr1, arr2) {
  return arr1.some(item => arr2.includes(item));
}

/**
 * Проверяет равенство массивов (порядок не важен)
 * @param {Array} arr1 - Первый массив
 * @param {Array} arr2 - Второй массив
 * @returns {boolean}
 */
function arraysEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();
  return sorted1.every((val, idx) => val === sorted2[idx]);
}

/**
 * Сравнивает локус с учетом LCN и деградации (v5.0)
 * @param {Array<string>} sampleAlleles - Аллели образца
 * @param {Array<string>} staffAlleles - Аллели сотрудника
 * @param {string} locus - Название локуса
 * @returns {Object} - Результат сравнения
 */
function compareLocusV5(sampleAlleles, staffAlleles, locus) {
  sampleAlleles = informativeAlleles(sampleAlleles); staffAlleles = informativeAlleles(staffAlleles);
  // Пропускаем пустые локусы
  if (sampleAlleles.length === 0 || staffAlleles.length === 0) {
    return {
      score: 0,
      matchType: 'empty',
      matchCoeff: 0,
      locusWeight: 0,
      rarityBonus: 1.0,
      isRareCritical: false
    };
  }
  
  const baseWeight = LOCUS_WEIGHTS_V5[locus] || 1.0;
  let matchCoeff = 0;
  let matchType = 'none';
  
  // 1. Полное совпадение: Sample(12,13) == Staff(12,13)
  if (arraysEqual(sampleAlleles, staffAlleles)) {
    matchCoeff = MATCH_COEFFICIENTS_V5.fullMatch;
    matchType = 'fullMatch';
  }
  // 2. Inclusive (Drop-out): Sample(12) ⊂ Staff(12,13)
  // КРИТИЧНО для LCN! Второй аллель мог выпасть
  else if (isSubset(sampleAlleles, staffAlleles)) {
    matchCoeff = MATCH_COEFFICIENTS_V5.inclusiveDropout;
    matchType = 'inclusiveDropout';
  }
  // 3. Over-Inclusive (Mix): Staff(12,13) ⊂ Sample(12,13,15)
  // Образец - смесь, но профиль сотрудника полностью в нем
  else if (isSubset(staffAlleles, sampleAlleles)) {
    matchCoeff = MATCH_COEFFICIENTS_V5.overInclusiveMix;
    matchType = 'overInclusiveMix';
  }
  // 4. Partial Mix: есть хотя бы одно пересечение
  else if (hasIntersection(sampleAlleles, staffAlleles)) {
    matchCoeff = MATCH_COEFFICIENTS_V5.partialMix;
    matchType = 'partialMix';
  }
  // 5. Mismatch: полное несовпадение
  else {
    matchCoeff = calculateDegradationPenalty(locus, true);
    matchType = 'mismatch';
  }
  
  // Бонус за редкость
  const rarityBonus = calculateRarityBonus(sampleAlleles, staffAlleles, locus);
  
  // Проверка на критический редкий локус
  const isRareCritical = RARE_CRITICAL_LOCI.includes(locus) && 
                         (matchType === 'fullMatch' || matchType === 'inclusiveDropout');
  
  // Вычисляем совпавшие аллели (explainedAlleles) с учетом количества повторений
  let explainedAlleles = [];
  if (matchType === 'fullMatch') {
    // Полное совпадение - все аллели образца совпали
    explainedAlleles = [...sampleAlleles];
  } else if (matchType === 'inclusiveDropout') {
    // Sample ⊂ Staff - все аллели образца совпали
    explainedAlleles = [...sampleAlleles];
  } else if (matchType === 'overInclusiveMix' || matchType === 'partialMix') {
    // Staff ⊂ Sample или частичное пересечение
    // Вычисляем РЕАЛЬНОЕ пересечение с учетом количества повторений
    // Пример: образец [8,9,11,14], сотрудник [11,11] → совпадение [11] (только одна!)
    const sampleCopy = [...sampleAlleles];
    const staffCopy = [...staffAlleles];
    
    for (const staffAllele of staffCopy) {
      const index = sampleCopy.indexOf(staffAllele);
      if (index !== -1) {
        explainedAlleles.push(staffAllele);
        sampleCopy.splice(index, 1); // Удаляем использованную аллель из образца
      }
    }
  } else {
    // Mismatch - нет совпадений
    explainedAlleles = [];
  }
  
  // Итоговый скор локуса
  const locusScore = baseWeight * matchCoeff * rarityBonus;
  
  return {
    score: locusScore,
    matchType,
    matchCoeff,
    locusWeight: baseWeight,
    rarityBonus,
    isRareCritical,
    sampleAlleles,
    staffAlleles,
    explainedAlleles
  };
}

/**
 * Основная функция расчета контаминации v5.0
 * @param {Object} sampleProfile - Профиль образца {locus: [alleles]}
 * @param {Object} staffProfile - Профиль сотрудника {locus: [alleles]}
 * @param {Set} ignoredLoci - Игнорируемые локусы
 * @returns {Object} - Результат анализа
 */
function calculateContaminationScoreV5(sampleProfile, staffProfile, ignoredLoci = new Set()) {
  let totalScore = 0;
  let matchedLociCount = 0;
  let rareCriticalMatches = 0;
  const matchedLociNames = [];
  const locusDetails = [];
  
  // Получаем все локусы из обоих профилей
  const allLoci = new Set([
    ...Object.keys(sampleProfile),
    ...Object.keys(staffProfile)
  ]);
  
  for (const locus of allLoci) {
    // Пропускаем игнорируемые локусы
    if (ignoredLoci.has(locus)) continue;
    
    const sampleAlleles = informativeAlleles(sampleProfile[locus]);
    const staffAlleles = informativeAlleles(staffProfile[locus]);
    
    // Пропускаем, если нет данных
    if (sampleAlleles.length === 0 || staffAlleles.length === 0) continue;
    
    // Сравниваем локус
    const comparison = compareLocusV5(sampleAlleles, staffAlleles, locus);
    
    // Добавляем к общему скору
    totalScore += comparison.score;
    
    // Считаем совпадения
    if (comparison.matchType !== 'mismatch' && comparison.matchType !== 'empty') {
      matchedLociCount++;
      matchedLociNames.push(locus);
      
      // Считаем критические редкие совпадения
      if (comparison.isRareCritical) {
        rareCriticalMatches++;
      }
    }
    
    // Сохраняем детали для отладки
    locusDetails.push({
      locus,
      ...comparison
    });
  }
  
  // Применяем "правило трех редких"
  // Даже при низком общем скоре, 3+ редких совпадения = CRITICAL
  const rareRuleTriggered = rareCriticalMatches >= 3;
  
  // Итоговый скор не может быть отрицательным
  const finalScore = Math.max(0, totalScore);
  
  // Определяем уровень контаминации
  let level = 'CLEAN';
  let severity = 'low';
  
  if (rareRuleTriggered || finalScore > 12.0) {
    level = 'STRONG_CRITICAL';
    severity = 'critical';
  } else if (finalScore >= 8.0) {
    level = 'CRITICAL';
    severity = 'high';
  } else if (finalScore >= 5.0) {
    level = 'WARNING';
    severity = 'medium';
  }
  
  return {
    score: parseFloat(finalScore.toFixed(2)),
    matchedLoci: matchedLociCount,
    matchedLociNames,
    level,
    severity,
    rareCriticalMatches,
    rareRuleTriggered,
    locusDetails,
    algorithm: 'v5.0'
  };
}

module.exports = {
  calculateContaminationScoreV5,
  compareLocusV5,
  LOCUS_WEIGHTS_V5,
  MATCH_COEFFICIENTS_V5,
  SHORT_LOCI,
  LONG_LOCI,
  RARE_CRITICAL_LOCI
};
