/**
 * ОПТИМИЗИРОВАННАЯ версия массового поиска с Worker Threads
 * Замените функцию router.post('/mass-search') в genotypeAnalysisRoutes.js на эту
 */

const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

/**
 * POST /api/analysis/mass-search
 * Массовый поиск с использованием Worker Threads для параллельной обработки
 */
async function massSearchOptimized(req, res, pool, logger, ANALYSIS_LOCI, isNumericValue, extractPrivoz) {
  const startTime = Date.now();
  
  try {
    const { 
      minMatches = 15,
      ignoredLoci = [],
      profileIds = [],
      useWorkers = true  // Флаг для использования многопоточности
    } = req.body;
    
    logger.info('Начало массового поиска (оптимизированная версия)', {
      userId: req.user.id,
      minMatches,
      ignoredLociCount: ignoredLoci.length,
      useWorkers
    });
    
    // Получаем профили
    let query = `
      SELECT 
        id,
        sample_name,
        internal_number,
        notes,
        str_data
      FROM dna_profiles
      WHERE is_active = true
    `;
    
    const params = [];
    
    if (profileIds.length > 0) {
      query += ` AND id = ANY($${params.length + 1})`;
      params.push(profileIds);
    }
    
    if (req.user.role !== 'admin') {
      if (req.user.organization_id) {
        query += ` AND organization_id = $${params.length + 1}`;
        params.push(req.user.organization_id);
      }
      
      if (req.user.role === 'user_analyst' && req.user.department_id) {
        query += ` AND department_id = $${params.length + 1}`;
        params.push(req.user.department_id);
      }
    }
    
    query += ` LIMIT 10000`;
    
    const result = await pool.query(query, params);
    const profiles = result.rows;
    
    const loadTime = Date.now() - startTime;
    
    logger.info('Профили загружены', {
      count: profiles.length,
      loadTimeMs: loadTime
    });
    
    let massSearchResults = [];
    let comparisonCount = 0;
    
    // Используем Worker Threads для параллельной обработки
    if (useWorkers && profiles.length > 100) {
      const numWorkers = Math.min(os.cpus().length, 4);
      const profilesPerWorker = Math.ceil(profiles.length / numWorkers);
      
      logger.info('Запуск параллельной обработки', {
        numWorkers,
        profilesPerWorker,
        totalProfiles: profiles.length,
        cpuCount: os.cpus().length
      });
      
      const workerPromises = [];
      
      for (let i = 0; i < numWorkers; i++) {
        const startIndex = i * profilesPerWorker;
        const endIndex = Math.min(startIndex + profilesPerWorker, profiles.length);
        
        if (startIndex >= profiles.length) break;
        
        const workerPromise = new Promise((resolve, reject) => {
          const worker = new Worker(path.join(__dirname, '../workers/genotypeComparisonWorker.js'), {
            workerData: {
              referenceProfiles: profiles,
              allProfiles: profiles,
              minMatches,
              ignoredLoci,
              startIndex,
              endIndex
            }
          });
          
          worker.on('message', (data) => {
            worker.terminate();
            resolve(data);
          });
          
          worker.on('error', (error) => {
            worker.terminate();
            reject(error);
          });
          
          worker.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`Worker stopped with exit code ${code}`));
            }
          });
        });
        
        workerPromises.push(workerPromise);
      }
      
      const workerResults = await Promise.all(workerPromises);
      
      // Объединяем результаты
      workerResults.forEach(workerResult => {
        massSearchResults = massSearchResults.concat(workerResult.results);
        comparisonCount += workerResult.comparisons;
      });
      
    } else {
      // Однопоточная обработка (fallback)
      const processedProfiles = profiles.map(profile => {
        const loci = profile.str_data || {};
        const processedLoci = {};
        
        for (const locus of Object.keys(loci)) {
          if (ignoredLoci.includes(locus)) continue;
          
          const locusData = loci[locus];
          if (!locusData) continue;
          
          const str = typeof locusData === 'object'
            ? `${locusData.allele1 || ''}${locusData.allele2 ? ',' + locusData.allele2 : ''}`
            : locusData.toString();
          
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
        
        return {
          ...profile,
          processedLoci
        };
      });
      
      for (let i = 0; i < processedProfiles.length; i++) {
        const referenceProfile = processedProfiles[i];
        const referenceLoci = referenceProfile.processedLoci;
        const matches = [];
        
        for (let j = 0; j < processedProfiles.length; j++) {
          if (i === j) continue;
          
          const compareProfile = processedProfiles[j];
          const compareLoci = compareProfile.processedLoci;
          let numericMatchCount = 0;
          const matchedLoci = [];
          
          comparisonCount++;
          
          // Ранний выход
          const maxPossibleMatches = Object.keys(referenceLoci).length;
          if (maxPossibleMatches < minMatches) continue;
          
          for (const locus in referenceLoci) {
            if (!compareLoci[locus]) continue;
            
            const refData = referenceLoci[locus];
            const compData = compareLoci[locus];
            
            let isMatched = false;
            
            if (refData.isHomozygote) {
              isMatched = compData.isHomozygote && refData.parts[0] === compData.parts[0];
            } else {
              isMatched = refData.parts.every(part => compData.partsSet.has(part));
            }
            
            if (isMatched) {
              numericMatchCount++;
              matchedLoci.push(locus);
            } else {
              // Ранний выход
              const remainingLoci = Object.keys(referenceLoci).length - matchedLoci.length - 1;
              if (numericMatchCount + remainingLoci < minMatches) {
                break;
              }
            }
          }
          
          if (numericMatchCount >= minMatches) {
            matches.push({
              id: compareProfile.id,
              sample_name: compareProfile.sample_name,
              internal_number: compareProfile.internal_number || compareProfile.sample_name,
              privoz: extractPrivoz(compareProfile.notes),
              matchCount: numericMatchCount,
              matchedLoci: matchedLoci
            });
          }
        }
        
        if (matches.length > 0) {
          matches.sort((a, b) => b.matchCount - a.matchCount);
          
          massSearchResults.push({
            reference: {
              id: referenceProfile.id,
              sample_name: referenceProfile.sample_name,
              internal_number: referenceProfile.internal_number || referenceProfile.sample_name,
              privoz: extractPrivoz(referenceProfile.notes)
            },
            matches: matches,
            matchCount: matches.length
          });
        }
      }
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    const durationSeconds = (duration / 1000).toFixed(2);
    const avgTimePerComparison = comparisonCount > 0 ? (duration / comparisonCount).toFixed(4) : 0;
    
    logger.info('Массовый поиск завершен', {
      userId: req.user.id,
      profilesAnalyzed: profiles.length,
      resultsWithMatches: massSearchResults.length,
      comparisons: comparisonCount,
      durationMs: duration,
      durationSeconds: durationSeconds,
      avgTimePerComparison: avgTimePerComparison,
      minMatches,
      useWorkers,
      speedup: useWorkers ? 'multi-threaded' : 'single-threaded'
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
        averageTimePerComparison: avgTimePerComparison + 'ms',
        comparisonsPerSecond: Math.round(comparisonCount / (duration / 1000)),
        loadTimeMs: loadTime,
        processingTimeMs: duration - loadTime,
        mode: useWorkers ? 'multi-threaded' : 'single-threaded'
      }
    });
    
  } catch (error) {
    logger.error('Ошибка массового поиска', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Ошибка выполнения массового поиска: ' + error.message
    });
  }
}

module.exports = { massSearchOptimized };
