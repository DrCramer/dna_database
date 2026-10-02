const express = require('express');
const router = express.Router();
const { authenticate, adminOrDepartmentHead } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { query } = require('../config/database');

/**
 * GET /api/analytics/kpi
 * Получить KPI метрики для дашборда руководителя
 */
router.get('/kpi', authenticate, adminOrDepartmentHead, async (req, res) => {
    try {
        const userRole = req.user.role;
        const departmentId = req.user.department_id;

        // Базовый WHERE clause в зависимости от роли
        let whereClause = '';
        if (userRole === 'department_head') {
            whereClause = `WHERE owner.department_id = $1`;
        } else if (userRole !== 'admin' && userRole !== 'system_administrator') {
            // Обычные пользователи не имеют доступа
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        const params = userRole === 'department_head' ? [departmentId] : [];

        // 1. Всего профилей в базе
        const totalProfilesQuery = `
            SELECT COUNT(*) as count 
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
        `;
        const totalProfilesResult = await query(totalProfilesQuery, params);
        const totalProfiles = parseInt(totalProfilesResult.rows[0].count) || 0;

        // 2. Обработано за месяц
        const monthlyQuery = `
            SELECT COUNT(*) as count 
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
            ${whereClause ? 'AND' : 'WHERE'} dp.upload_date >= NOW() - INTERVAL '30 days'
        `;
        const monthlyResult = await query(monthlyQuery, params);
        const processedThisMonth = parseInt(monthlyResult.rows[0].count) || 0;

        // Рост по сравнению с предыдущим месяцем
        const previousMonthQuery = `
            SELECT COUNT(*) as count 
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
            ${whereClause ? 'AND' : 'WHERE'} dp.upload_date >= NOW() - INTERVAL '60 days'
            AND dp.upload_date < NOW() - INTERVAL '30 days'
        `;
        const previousMonthResult = await query(previousMonthQuery, params);
        const processedPreviousMonth = parseInt(previousMonthResult.rows[0].count) || 0;
        
        const growthPercentage = processedPreviousMonth > 0 
            ? Math.round(((processedThisMonth - processedPreviousMonth) / processedPreviousMonth) * 100)
            : 0;

        // 3. Найденные совпадения из таблицы результатов
        const matchesQuery = `
            SELECT COUNT(*) as count
            FROM match_results mr
            JOIN dna_profiles dp ON mr.profile_id_1 = dp.id
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
        `;
        const matchesResult = await query(matchesQuery, params);
        const totalMatches = parseInt(matchesResult.rows[0].count) || 0;

        // 4. Ожидают данных RealTime (заглушка - пока нет интеграции)
        const awaitingRealtime = 0; // TODO: Добавить когда будет интеграция с RealTime

        res.json({
            success: true,
            data: {
                totalProfiles,
                processedThisMonth,
                growthPercentage,
                totalMatches,
                awaitingRealtime
            }
        });

    } catch (error) {
        logger.error('Analytics KPI error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to load KPI data'
        });
    }
});

/**
 * GET /api/analytics/monthly-stats
 * Получить статистику по месяцам для графика
 */
router.get('/monthly-stats', authenticate, adminOrDepartmentHead, async (req, res) => {
    try {
        const userRole = req.user.role;
        const departmentId = req.user.department_id;

        let whereClause = '';
        const params = [];
        
        if (userRole === 'department_head') {
            whereClause = `WHERE owner.department_id = $1`;
            params.push(departmentId);
        }

        // Получить данные за последние 12 месяцев
        const monthlyStatsQuery = `
            SELECT 
                TO_CHAR(dp.upload_date, 'YYYY-MM') as month,
                COUNT(*) as count
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
            ${whereClause ? 'AND' : 'WHERE'} dp.upload_date >= NOW() - INTERVAL '12 months'
            GROUP BY TO_CHAR(dp.upload_date, 'YYYY-MM')
            ORDER BY month ASC
        `;
        
        const result = await query(monthlyStatsQuery, params);
        
        // Форматируем данные для recharts
        const monthlyData = result.rows.map(row => ({
            month: row.month,
            count: parseInt(row.count)
        }));

        res.json({
            success: true,
            data: monthlyData
        });

    } catch (error) {
        logger.error('Analytics monthly stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to load monthly statistics'
        });
    }
});

/**
 * GET /api/analytics/status-distribution
 * Получить распределение профилей по статусам для PieChart
 */
router.get('/status-distribution', authenticate, adminOrDepartmentHead, async (req, res) => {
    try {
        const userRole = req.user.role;
        const departmentId = req.user.department_id;

        let whereClause = '';
        const params = [];
        
        if (userRole === 'department_head') {
            whereClause = `WHERE owner.department_id = $1`;
            params.push(departmentId);
        }

        // Получить распределение по статусам
        const statusQuery = `
            SELECT 
                CASE
                    WHEN dp.is_active = false THEN 'deactivated'
                    ELSE 'active'
                END as status,
                COUNT(*) as count
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
            GROUP BY status
        `;
        
        const result = await query(statusQuery, params);
        
        // Форматируем данные для PieChart
        const statusLabels = {
            'active': 'Активные',
            'deactivated': 'Деактивированные'
        };

        const statusData = result.rows.map(row => ({
            name: statusLabels[row.status] || row.status,
            value: parseInt(row.count),
            status: row.status
        }));

        res.json({
            success: true,
            data: statusData
        });

    } catch (error) {
        logger.error('Analytics status distribution error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to load status distribution'
        });
    }
});

/**
 * GET /api/analytics/profiles-in-work
 * Получить список профилей в работе с фильтрами
 */
router.get('/profiles-in-work', authenticate, adminOrDepartmentHead, async (req, res) => {
    try {
        const { year, import_number, realtime_status, page = 1, limit = 50 } = req.query;
        const userRole = req.user.role;
        const departmentId = req.user.department_id;

        let whereConditions = ['dp.is_active = true'];
        const params = [];
        let paramIndex = 1;

        // Фильтр по отделу для department_head
        if (userRole === 'department_head') {
            whereConditions.push(`owner.department_id = $${paramIndex}`);
            params.push(departmentId);
            paramIndex++;
        }

        // Фильтр по году
        if (year) {
            whereConditions.push(`dp.year = $${paramIndex}`);
            params.push(year);
            paramIndex++;
        }

        // Фильтр по номеру привоза
        if (import_number) {
            whereConditions.push(`dp.import_number = $${paramIndex}`);
            params.push(import_number);
            paramIndex++;
        }

        // Фильтр по статусу RealTime (заглушка)
        // TODO: Добавить когда будет интеграция с RealTime

        const whereClause = whereConditions.length > 0 
            ? `WHERE ${whereConditions.join(' AND ')}`
            : '';

        // Подсчет общего количества
        const countQuery = `
            SELECT COUNT(*) as total
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
        `;
        const countResult = await query(countQuery, params);
        const total = parseInt(countResult.rows[0].total) || 0;

        // Получение данных с пагинацией
        const pageNumber = Number.parseInt(page, 10);
        const limitNumber = Number.parseInt(limit, 10);
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 100) {
            return res.status(400).json({ success: false, error: 'Invalid pagination' });
        }
        const offset = (pageNumber - 1) * limitNumber;
        params.push(limitNumber, offset);
        paramIndex = params.length - 1;
        
        const dataQuery = `
            SELECT 
                dp.id,
                dp.year,
                dp.import_number,
                dp.internal_number,
                dp.sample_name,
                NULL::boolean AS is_contaminated,
                dp.upload_date,
                'not_assigned' as realtime_status
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
            ORDER BY dp.upload_date DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        const dataResult = await query(dataQuery, params);

        res.json({
            success: true,
            data: {
                profiles: dataResult.rows,
                pagination: {
                    page: pageNumber,
                    limit: limitNumber,
                    total,
                    pages: Math.ceil(total / limitNumber)
                }
            }
        });

    } catch (error) {
        logger.error('Analytics profiles in work error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to load profiles in work'
        });
    }
});

/**
 * POST /api/analytics/find-duplicates
 * Поиск дубликатов по номеру воинской части
 */
router.post('/find-duplicates', authenticate, adminOrDepartmentHead, async (req, res) => {
    res.status(501).json({
        success: false,
        error: 'Поиск по номеру воинской части недоступен: такого поля нет в текущей базе данных'
    });
});

/**
 * GET /api/analytics/filters
 * Получить доступные значения для фильтров
 */
router.get('/filters', authenticate, adminOrDepartmentHead, async (req, res) => {
    try {
        const userRole = req.user.role;
        const departmentId = req.user.department_id;

        let whereClause = '';
        const params = [];
        
        if (userRole === 'department_head') {
            whereClause = `WHERE owner.department_id = $1`;
            params.push(departmentId);
        }

        // Получить уникальные годы
        const yearsQuery = `
            SELECT DISTINCT year 
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
            ORDER BY year DESC
        `;
        const yearsResult = await query(yearsQuery, params);
        const years = yearsResult.rows.map(row => row.year).filter(y => y);

        // Получить уникальные номера привозов
        const importsQuery = `
            SELECT DISTINCT import_number 
            FROM dna_profiles dp
            JOIN users owner ON owner.id = dp.user_id
            ${whereClause}
            ${whereClause ? 'AND' : 'WHERE'} import_number IS NOT NULL
            ORDER BY import_number DESC
            LIMIT 100
        `;
        const importsResult = await query(importsQuery, params);
        const importNumbers = importsResult.rows.map(row => row.import_number);

        res.json({
            success: true,
            data: {
                years,
                importNumbers,
                realtimeStatuses: [
                    { value: 'loaded', label: 'Загружено' },
                    { value: 'pending', label: 'Ожидается' },
                    { value: 'not_assigned', label: 'Не назначено' }
                ]
            }
        });

    } catch (error) {
        logger.error('Analytics filters error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to load filter options'
        });
    }
});

module.exports = router;
