const { informativeAlleles: parseAlleles } = require("../../utils/alleleTokens");
const { prepareLocusData, isExactLocusMatch } = require('../../utils/exactLocusComparison');
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

// Предобработка и форматы результатов действующего массового поиска.
function prepareMassSearchProfiles(profiles, ignoredLoci, extractImportNumber) {
    const ignoredSet = new Set(ignoredLoci);
    return profiles.map(profile => {
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
          processedLoci[locus] = prepareLocusData(locusData);
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

}

// Чистый расчёт диапазона: никаких запросов к БД или проверок доступа в worker.
function compareMassSearchRange(processedProfiles, { minMatches = 15, startIndex = 0, endIndex = processedProfiles.length } = {}) {
    const groups = [];
    let comparisonCount = 0, earlyExits = 0;
    // ОПТИМИЗАЦИЯ 2: Сравнение с ранним выходом
    for (let i = startIndex; i < endIndex; i++) {
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

          const isMatched = isExactLocusMatch(refData, compData);

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

        groups.push({ referenceIndex: i, matches });
      }
    }

    return { groups, comparisons: comparisonCount, earlyExits };
}

function groupMassSearchResults(processedProfiles, groups) {
    const massSearchResults = [], processedPairs = new Set();
    for (const { referenceIndex, matches } of groups) {
        const referenceProfile = processedProfiles[referenceIndex];
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
            exportMatches: uniqueMatches,
            matchCount: matches.length,  // Полное количество
            displayedCount: limitedMatches.length  // Показываем только топ
          });
        }
    }
    return massSearchResults;
}

async function runMassSearchComparisons(processedProfiles, minMatches, useWorkers = true) {
    if (!useWorkers || processedProfiles.length <= 100) {
        return { ...compareMassSearchRange(processedProfiles, { minMatches }), mode: 'single-threaded-optimized' };
    }
    const workers = [], count = Math.min(os.cpus().length, 4);
    const rangeSize = Math.ceil(processedProfiles.length / count);
    try {
        const tasks = [];
        for (let index = 0; index < count; index++) {
            const startIndex = index * rangeSize;
            if (startIndex >= processedProfiles.length) break;
            tasks.push(new Promise((resolve, reject) => {
                const worker = new Worker(path.join(__dirname, "../../workers/genotypeComparisonWorker.js"), {
                    workerData: {
                        operation: 'mass-search', profiles: processedProfiles, minMatches,
                        startIndex, endIndex: Math.min(startIndex + rangeSize, processedProfiles.length)
                    }
                });
                workers.push(worker);
                worker.once('message', resolve);
                worker.once('error', reject);
                worker.once('exit', code => reject(new Error(`Mass search worker exited before a result (code ${code})`)));
            }));
        }
        // Promise.all сохраняет порядок диапазонов, независимо от времени окончания workers.
        const ranges = await Promise.all(tasks);
        return {
            groups: ranges.flatMap(range => range.groups),
            comparisons: ranges.reduce((sum, range) => sum + range.comparisons, 0),
            earlyExits: ranges.reduce((sum, range) => sum + range.earlyExits, 0),
            mode: 'multi-threaded'
        };
    } finally {
        await Promise.allSettled(workers.map(worker => worker.terminate()));
    }
}

module.exports = { prepareMassSearchProfiles, compareMassSearchRange, groupMassSearchResults, runMassSearchComparisons };
