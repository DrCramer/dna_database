const ProfileContaminationLog = require('../models/ProfileContaminationLog');
const logger = require('../utils/logger');

/**
 * Сервис для логирования результатов поиска контаминации
 */
class ContaminationLogger {
    /**
     * Логирование результатов поиска
     * @param {Array} searchResults - Результаты поиска
     * @param {Object} context - Контекст поиска
     */
    static async logSearchResults(searchResults, context) {
        try {
            const {
                searchMode,
                algorithmUsed,
                minMatchesThreshold,
                ignoredLoci,
                taskId,
                departmentId,
                searchedBy
            } = context;

            const logsToSave = [];

            for (const result of searchResults) {
                // Пропускаем если нет совпадений
                if (!result.matches || result.matches.length === 0) {
                    continue;
                }

                const referenceProfile = {
                    sample_name: result.reference?.sample_name || result.sample_name,
                    internal_number: result.reference?.internal_number || result.internal_number,
                    import_number: result.reference?.import_number || result.import_number,
                    year: result.reference?.year || result.year
                };

                for (const match of result.matches) {
                    // Определяем тип совпадения
                    let matchType = 'no_match';
                    let matchingLociCount = match.matchingLoci?.length || 0;
                    let totalLociCompared = match.totalLoci || 40;
                    let matchPercentage = (matchingLociCount / totalLociCompared * 100).toFixed(2);

                    // Проверяем тип совпадения
                    if (match.isFullMatch || matchingLociCount === totalLociCompared) {
                        matchType = 'full_match';
                    } else if (match.isContamination || match.contaminatedLoci || matchingLociCount > 0) {
                        matchType = 'partial_match';
                    }

                    const matchedProfile = {
                        sample_name: match.sample_name,
                        internal_number: match.internal_number,
                        import_number: match.import_number,
                        year: match.year
                    };

                    logsToSave.push({
                        referenceProfileId: result.reference?.id || result.id,
                        matchedProfileId: match.id,
                        referenceProfile,
                        matchedProfile,
                        matchType,
                        matchingLociCount,
                        totalLociCompared,
                        matchPercentage: parseFloat(matchPercentage),
                        matchedLoci: match.matchingLoci || match.matchedLoci || [],
                        contaminatedLoci: match.contaminatedLoci || match.detailedMatches || null,
                        searchMode,
                        algorithmUsed,
                        minMatchesThreshold,
                        ignoredLoci,
                        taskId,
                        departmentId,
                        searchedBy
                    });
                }
            }

            if (logsToSave.length > 0) {
                await ProfileContaminationLog.logBulkSearchResults(logsToSave, {});
                logger.info('✅ Результаты поиска сохранены в лог', {
                    savedCount: logsToSave.length,
                    searchMode,
                    taskId
                });
            }

            return logsToSave.length;
        } catch (error) {
            logger.error('❌ Ошибка логирования результатов поиска', {
                error: error.message,
                stack: error.stack
            });
            // Не прерываем выполнение, просто логируем ошибку
            return 0;
        }
    }

    /**
     * Логирование одного результата поиска
     */
    static async logSingleResult(referenceProfile, matchedProfile, matchDetails, context) {
        try {
            const {
                searchMode,
                algorithmUsed,
                minMatchesThreshold,
                ignoredLoci,
                taskId,
                departmentId,
                searchedBy
            } = context;

            let matchType = 'no_match';
            const matchingLociCount = matchDetails.matchingLoci?.length || 0;
            const totalLociCompared = matchDetails.totalLoci || 40;
            const matchPercentage = (matchingLociCount / totalLociCompared * 100).toFixed(2);

            if (matchDetails.isFullMatch || matchingLociCount === totalLociCompared) {
                matchType = 'full_match';
            } else if (matchDetails.isContamination || matchDetails.contaminatedLoci || matchingLociCount > 0) {
                matchType = 'partial_match';
            }

            const logData = {
                referenceProfileId: referenceProfile.id,
                matchedProfileId: matchedProfile.id,
                referenceProfile: {
                    sample_name: referenceProfile.sample_name,
                    internal_number: referenceProfile.internal_number,
                    import_number: referenceProfile.import_number,
                    year: referenceProfile.year
                },
                matchedProfile: {
                    sample_name: matchedProfile.sample_name,
                    internal_number: matchedProfile.internal_number,
                    import_number: matchedProfile.import_number,
                    year: matchedProfile.year
                },
                matchType,
                matchingLociCount,
                totalLociCompared,
                matchPercentage: parseFloat(matchPercentage),
                matchedLoci: matchDetails.matchingLoci || [],
                contaminatedLoci: matchDetails.contaminatedLoci || null,
                searchMode,
                algorithmUsed,
                minMatchesThreshold,
                ignoredLoci,
                taskId,
                departmentId,
                searchedBy
            };

            const client = await require('../config/database').pool.connect();
            try {
                await ProfileContaminationLog.logSearchResult(client, logData);
                logger.info('✅ Результат поиска сохранен в лог', {
                    referenceId: referenceProfile.id,
                    matchedId: matchedProfile.id,
                    matchType
                });
            } finally {
                client.release();
            }
        } catch (error) {
            logger.error('❌ Ошибка логирования результата поиска', {
                error: error.message
            });
        }
    }
}

module.exports = ContaminationLogger;
