/**
 * API маршруты для анализа контаминации сотрудников
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const StaffContaminationAnalyzer = require('../services/staffContaminationAnalyzer');

/**
 * POST /api/staff-contamination/analyze
 * Анализ одного образца на контаминацию
 */
router.post('/analyze', authenticate, async (req, res) => {
    try {
        const { 
            sampleProfileId,
            options = {}
        } = req.body;

        if (!sampleProfileId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан ID образца'
            });
        }

        const { pool } = req.app.locals;
        const analyzer = new StaffContaminationAnalyzer(pool);

        const result = await analyzer.analyzeSample(
            sampleProfileId,
            req.user.id,
            options
        );

        logger.info('Анализ контаминации выполнен', {
            userId: req.user.id,
            sampleId: sampleProfileId,
            casesFound: result.contamination_cases
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        logger.error('Ошибка анализа контаминации', {
            userId: req.user.id,
            error: error.message
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/staff-contamination/bulk-analyze
 * Массовый анализ контаминации
 */
router.post('/bulk-analyze', authenticate, async (req, res) => {
    try {
        const { 
            sampleProfileIds,
            options = {}
        } = req.body;

        if (!sampleProfileIds || !Array.isArray(sampleProfileIds) || sampleProfileIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Не указаны ID образцов'
            });
        }

        const { pool } = req.app.locals;
        const analyzer = new StaffContaminationAnalyzer(pool);

        const result = await analyzer.bulkAnalyze(
            sampleProfileIds,
            req.user.id,
            options
        );

        logger.info('Массовый анализ контаминации выполнен', {
            userId: req.user.id,
            samplesCount: sampleProfileIds.length,
            successCount: result.successful_analyses
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        logger.error('Ошибка массового анализа контаминации', {
            userId: req.user.id,
            error: error.message
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/staff-contamination/history/:sampleId
 * Получение истории анализов контаминации для образца
 */
router.get('/history/:sampleId', authenticate, async (req, res) => {
    try {
        const { sampleId } = req.params;

        const { pool } = req.app.locals;
        const analyzer = new StaffContaminationAnalyzer(pool);

        const history = await analyzer.getHistory(sampleId);

        res.json({
            success: true,
            data: history
        });

    } catch (error) {
        logger.error('Ошибка получения истории анализов', {
            userId: req.user.id,
            error: error.message
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/staff-contamination/staff-profiles
 * Получение списка профилей сотрудников
 */
router.get('/staff-profiles', authenticate, async (req, res) => {
    try {
        const { pool } = req.app.locals;

        const result = await pool.query(`
            SELECT 
                id,
                staff_id,
                full_name,
                date_added,
                last_updated
            FROM staff_profiles
            WHERE is_active = true
            ORDER BY full_name
        `);

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        logger.error('Ошибка получения профилей сотрудников', {
            userId: req.user.id,
            error: error.message
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/staff-contamination/default-parameters
 * Получение дефолтных параметров алгоритма
 */
router.get('/default-parameters', authenticate, async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const analyzer = new StaffContaminationAnalyzer(pool);

        res.json({
            success: true,
            data: {
                locusWeights: analyzer.defaultLocusWeights,
                matchCoefficients: analyzer.defaultMatchCoefficients,
                options: analyzer.defaultOptions
            }
        });

    } catch (error) {
        logger.error('Ошибка получения дефолтных параметров', {
            userId: req.user.id,
            error: error.message
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/staff-contamination/analyze-task
 * Анализ контаминации сотрудников для всех профилей задачи
 */
router.post('/analyze-task', authenticate, async (req, res) => {
    try {
        const { 
            taskId,
            options = {}
        } = req.body;

        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан ID задачи'
            });
        }

        const { pool } = req.app.locals;
        const analyzer = new StaffContaminationAnalyzer(pool);

        logger.info('Начало анализа контаминации для задачи', {
            userId: req.user.id,
            taskId,
            options
        });

        // Получаем профили задачи
        const DNAProfile = require('../models/DNAProfile');
        const taskProfiles = await DNAProfile.findByTaskId(taskId);

        if (taskProfiles.length === 0) {
            return res.json({
                success: true,
                data: [],
                message: 'В задаче нет профилей для анализа'
            });
        }

        logger.info('Профили задачи загружены', {
            taskId,
            profilesCount: taskProfiles.length
        });

        // Получаем профили сотрудников
        const staffResult = await pool.query(`
            SELECT 
                sp.id,
                sp.staff_id,
                sp.full_name,
                sp.str_data,
                sp.date_added
            FROM staff_profiles sp
            WHERE sp.is_active = true
            ORDER BY sp.full_name
        `);

        const staffProfiles = staffResult.rows;

        if (staffProfiles.length === 0) {
            return res.json({
                success: true,
                data: [],
                message: 'Нет профилей сотрудников для сравнения'
            });
        }

        logger.info('Профили сотрудников загружены', {
            staffCount: staffProfiles.length
        });

        // Анализируем каждый профиль задачи
        const results = [];
        let profilesWithContamination = 0;
        
        for (const taskProfile of taskProfiles) {
            const sampleProfile = {
                id: taskProfile.id,
                sample_name: taskProfile.sampleName,
                internal_number: taskProfile.internalNumber,
                import_number: taskProfile.importNumber,
                year: taskProfile.year,
                str_data: taskProfile.strData
            };

            logger.debug('Анализ профиля на контаминацию', {
                profileId: sampleProfile.id,
                sampleName: sampleProfile.sample_name,
                staffCount: staffProfiles.length
            });

            // Выполняем анализ контаминации
            const contamination = await analyzer.detectStaffContamination(
                sampleProfile,
                staffProfiles,
                options
            );

            logger.debug('Результат анализа профиля', {
                profileId: sampleProfile.id,
                matchesFound: contamination.length,
                topScore: contamination.length > 0 ? contamination[0].matchScore : 0
            });

            // Фильтруем результаты по порогу
            const threshold = options.threshold || analyzer.defaultOptions.threshold;
            const significantMatches = contamination.filter(match => 
                match.finalScore >= threshold
            );

            logger.debug('После фильтрации по порогу', {
                profileId: sampleProfile.id,
                threshold,
                beforeFilter: contamination.length,
                afterFilter: significantMatches.length,
                topScores: contamination.slice(0, 3).map(m => ({
                    staffName: m.staffName || 'Unknown',
                    score: m.contaminationScore || 0,
                    finalScore: m.finalScore || 0
                }))
            });

            // Добавляем результаты с совпадениями
            if (significantMatches.length > 0) {
                profilesWithContamination++;
                for (const match of significantMatches) {
                    results.push({
                        sampleProfile: {
                            id: sampleProfile.id,
                            sample_name: sampleProfile.sample_name,
                            internal_number: sampleProfile.internal_number,
                            import_number: sampleProfile.import_number,
                            year: sampleProfile.year
                        },
                        staffProfile: {
                            id: match.staffId,
                            staff_id: match.staffIdentifier,
                            full_name: match.staffName
                        },
                        matchScore: match.finalScore,
                        matchedLoci: match.matchingLoci || [],
                        detailedMatches: match.detailedMatches || [],
                        criticalAlleles: match.criticalLoci || [],
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }

        logger.info('Анализ контаминации для задачи завершен', {
            userId: req.user.id,
            taskId,
            profilesAnalyzed: taskProfiles.length,
            profilesWithContamination,
            contaminationCasesFound: results.length,
            threshold: options.threshold || analyzer.defaultOptions.threshold
        });

        res.json({
            success: true,
            data: results,
            statistics: {
                profilesAnalyzed: taskProfiles.length,
                staffProfilesCompared: staffProfiles.length,
                contaminationCasesFound: results.length
            }
        });

    } catch (error) {
        logger.error('Ошибка анализа контаминации для задачи', {
            userId: req.user.id,
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
