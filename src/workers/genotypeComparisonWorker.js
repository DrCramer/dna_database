/**
 * Worker для параллельного сравнения генотипов
 */

const { parentPort, workerData } = require('worker_threads');



/**
 * Проверка является ли значение числовым
 */
function isNumericValue(value) {
  if (!value) return false;
  const str = value.trim().toUpperCase();
  return str !== '' && !/^[*?F]$/i.test(str);
}

/**
 * Предобработка профиля
 */
function preprocessProfile(profile, ignoredLoci) {
  const loci = profile.str_data || {};
  const processedLoci = {};
  
  for (const locus of Object.keys(loci)) {
    if (ignoredLoci.includes(locus)) continue;
    
    const locusData = loci[locus];
    if (!locusData) continue;
    
    // Новый формат: массив аллелей
    let str;
    if (Array.isArray(locusData)) {
      str = locusData.filter(a => a && a !== '').join(',');
    } else if (typeof locusData === 'object' && (locusData.allele1 || locusData.allele2)) {
      // Старый формат: объект с allele1/allele2
      str = `${locusData.allele1 || ''}${locusData.allele2 ? ',' + locusData.allele2 : ''}`;
    } else {
      str = locusData.toString();
    }
    
    if (isNumericValue(str)) {
      const parts = str.split(',').map(p => p.trim());
      processedLoci[locus] = {
        str: str,
        parts: parts,
        isHomozygote: parts.length === 2 && parts[0] === parts[1],
        partsSet: new Set(parts)
      };
    }
  }
  
  return processedLoci;
}

/**
 * Быстрое сравнение двух профилей
 */
function compareProfiles(refLoci, compLoci, minMatches) {
  let numericMatchCount = 0;
  const matchedLoci = [];
  const refLociKeys = Object.keys(refLoci);
  
  // Ранний выход: если максимально возможных совпадений меньше порога
  const maxPossibleMatches = refLociKeys.length;
  if (maxPossibleMatches < minMatches) {
    return null;
  }
  
  for (const locus of refLociKeys) {
    if (!compLoci[locus]) continue;
    
    const refData = refLoci[locus];
    const compData = compLoci[locus];
    
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
      
      // Ранний выход: если уже достигнут порог, можно продолжать
      // но для точного подсчета нужно проверить все локусы
    } else {
      // Ранний выход: если оставшихся локусов недостаточно для достижения порога
      const remainingLoci = refLociKeys.length - matchedLoci.length - 1;
      if (numericMatchCount + remainingLoci < minMatches) {
        return null;
      }
    }
  }
  
  if (numericMatchCount >= minMatches) {
    return {
      matchCount: numericMatchCount,
      matchedLoci: matchedLoci
    };
  }
  
  return null;
}

/**
 * Извлечение номера привоза из профиля
 * Читает только из столбца import_number
 */
function extractPrivoz(profile) {
  // Читаем только из столбца import_number
  if (profile && profile.import_number) {
    return profile.import_number.toString();
  }
  
  return '';
}

// Получаем данные от главного потока
const { referenceProfiles, allProfiles, minMatches, ignoredLoci, startIndex, endIndex } = workerData;

const results = [];
let comparisonCount = 0;

// Обрабатываем только назначенный диапазон профилей
for (let i = startIndex; i < endIndex; i++) {
  const referenceProfile = referenceProfiles[i];
  const referenceLoci = preprocessProfile(referenceProfile, ignoredLoci);
  const matches = [];
  
  // Сравниваем с всеми профилями
  for (let j = 0; j < allProfiles.length; j++) {
    if (i === j) continue;
    
    const compareProfile = allProfiles[j];
    const compareLoci = preprocessProfile(compareProfile, ignoredLoci);
    
    comparisonCount++;
    
    const result = compareProfiles(referenceLoci, compareLoci, minMatches);
    
    if (result) {
      matches.push({
        id: compareProfile.id,
        sample_name: compareProfile.sample_name,
        internal_number: compareProfile.internal_number || compareProfile.sample_name,
        privoz: extractPrivoz(compareProfile),
        matchCount: result.matchCount,
        matchedLoci: result.matchedLoci
      });
    }
  }
  
  if (matches.length > 0) {
    matches.sort((a, b) => b.matchCount - a.matchCount);
    
    results.push({
      reference: {
        id: referenceProfile.id,
        sample_name: referenceProfile.sample_name,
        internal_number: referenceProfile.internal_number || referenceProfile.sample_name,
        privoz: extractPrivoz(referenceProfile)
      },
      matches: matches,
      matchCount: matches.length
    });
  }
}

// Отправляем результаты обратно
parentPort.postMessage({
  results: results,
  comparisons: comparisonCount
});
