const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ProfileContaminationLog = require('../models/ProfileContaminationLog');
const { logger } = require('../utils/logger');

/**
 * GET /api/contamination-stats/by-import
 * Получение статистики по привозам
 */
router.get('/by-import', authenticate, async (req, res) => {
    try {
        const { importNumber, year } = req.query;

        const stats = await ProfileContaminationLog.getStatsByImport(
            importNumber,
            year ? parseInt(year) : null
        );

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        logger.error('Ошибка получения статистики по привозам', {
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
 * GET /api/contamination-stats/by-period
 * Получение статистики по периодам
 */
router.get('/by-period', authenticate, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const stats = await ProfileContaminationLog.getStatsByPeriod(
            startDate,
            endDate
        );

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        logger.error('Ошибка получения статистики по периодам', {
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
 * GET /api/contamination-stats/history
 * Получение детальной истории поиска
 */
router.get('/history', authenticate, async (req, res) => {
    try {
        const {
            profileId,
            taskId,
            departmentId,
            matchType,
            startDate,
            endDate,
            limit,
            offset
        } = req.query;

        const history = await ProfileContaminationLog.getSearchHistory({
            profileId,
            taskId,
            departmentId,
            matchType,
            startDate,
            endDate,
            limit: limit ? parseInt(limit) : 100,
            offset: offset ? parseInt(offset) : 0
        });

        res.json({
            success: true,
            data: history,
            count: history.length
        });
    } catch (error) {
        logger.error('Ошибка получения истории поиска', {
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
 * GET /api/contamination-stats/profile/:profileId
 * Получение статистики контаминации для конкретного профиля
 */
router.get('/profile/:profileId', authenticate, async (req, res) => {
    try {
        const { profileId } = req.params;

        const stats = await ProfileContaminationLog.getProfileContaminationStats(profileId);

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        logger.error('Ошибка получения статистики профиля', {
            userId: req.user.id,
            profileId: req.params.profileId,
            error: error.message
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
