const { parseAlleles, compareLocus, compareWithContaminationAlgorithm, extractImportNumber } = require('./genotypeComparisonMath');
const { createDuplicateSimilarityComparator, isDuplicateOptimized } = require('./duplicateDetectionService');

function compareTaskProfiles({ referenceProfiles, compareProfiles, minMatches = 15, ignoredLoci = [], comparisonAlgorithm = 'standard', useV5Algorithm = true, searchMode = 'task', duplicateSettings = {} }) {
    const thresholds = {
      minScore: duplicateSettings.minScore || 15,
      minPercentage: duplicateSettings.minPercentage || 80,
      minLoci: duplicateSettings.minLoci || 15
    };
    const compareDuplicate = createDuplicateSimilarityComparator({
      locusWeights: duplicateSettings.locusWeights || {}, ignoredLoci, thresholds
    });
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

          const v5Result = compareDuplicate(
            refProfile.str_data,
            compProfile.str_data
          );

          // Если был ранний выход - пропускаем
          if (v5Result.earlyExit) {
            continue;
          }

          if (isDuplicateOptimized(v5Result, thresholds)) {
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
          exportMatches: matches,
          matchCount: matches.length,
          displayedCount: Math.min(matches.length, 100)
        });
      }
    }


    return { results, comparisons: comparisonCount };
}

function compareDepartmentProfiles({ referenceProfiles, compareProfiles, minMatches = 15, ignoredLoci = [], comparisonAlgorithm = 'standard', useV5Algorithm = true, searchMode = 'task', duplicateSettings = {} }) {
    const thresholds = {
      minScore: duplicateSettings.minScore || 15,
      minPercentage: duplicateSettings.minPercentage || 80,
      minLoci: duplicateSettings.minLoci || 15
    };
    const compareDuplicate = createDuplicateSimilarityComparator({
      locusWeights: duplicateSettings.locusWeights || {}, ignoredLoci, thresholds
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

          const v5Result = compareDuplicate(
            refProfile.loci,
            compareProfile.loci
          );

          // Если был ранний выход - пропускаем
          if (v5Result.earlyExit) {
            continue;
          }

          if (isDuplicateOptimized(v5Result, thresholds)) {
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


    return { results, comparisons: comparisonCount };
}

module.exports = { compareTaskProfiles, compareDepartmentProfiles };
