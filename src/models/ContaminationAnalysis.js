/**
 * Модель для работы с анализом контаминации
 * Обеспечивает связь между образцами и профилями сотрудников
 */

const { Pool } = require('pg');

class ContaminationAnalysis {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Создание записи анализа контаминации
     */
    async create(analysisData) {
        const client = await this.pool.connect();
        try {
            const {
                sample_profile_id,
                staff_profile_id,
                contamination_percentage,
                locus_matches,
                analyzed_by,
                analysis_method = 'bayesian',
                confidence_level,
                notes
            } = analysisData;

            const result = await client.query(`
                INSERT INTO contamination_analysis (
                    sample_profile_id, staff_profile_id, contamination_percentage,
                    locus_matches, analyzed_by, analysis_method, confidence_level, notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [
                sample_profile_id, staff_profile_id, contamination_percentage,
                locus_matches, analyzed_by, analysis_method, confidence_level, notes
            ]);

            return result.rows[0];
        } finally {
            client.release();
        }
    }

    /**
     * Получение анализа по ID
     */
    async getById(id) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    ca.*,
                    dp.sample_name,
                    sp.full_name as staff_name,
                    sp.staff_id,
                    sp.department,
                    u.username as analyzed_by_username
                FROM contamination_analysis ca
                JOIN dna_profiles dp ON ca.sample_profile_id = dp.id
                JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                LEFT JOIN users u ON ca.analyzed_by = u.id
                WHERE ca.id = $1
            `, [id]);

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Получение всех анализов для образца
     */
    async getBySampleId(sampleProfileId) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    ca.*,
                    sp.full_name as staff_name,
                    sp.staff_id,
                    sp.department,
                    u.username as analyzed_by_username
                FROM contamination_analysis ca
                JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                LEFT JOIN users u ON ca.analyzed_by = u.id
                WHERE ca.sample_profile_id = $1
                ORDER BY ca.contamination_percentage DESC, ca.analysis_date DESC
            `, [sampleProfileId]);

            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Получение всех анализов для сотрудника
     */
    async getByStaffId(staffProfileId) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    ca.*,
                    dp.sample_name,
                    u.username as analyzed_by_username
                FROM contamination_analysis ca
                JOIN dna_profiles dp ON ca.sample_profile_id = dp.id
                LEFT JOIN users u ON ca.analyzed_by = u.id
                WHERE ca.staff_profile_id = $1
                ORDER BY ca.contamination_percentage DESC, ca.analysis_date DESC
            `, [staffProfileId]);

            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Получение анализов с высоким уровнем контаминации
     */
    async getHighContamination(threshold = 10.0) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    ca.*,
                    dp.sample_name,
                    sp.full_name as staff_name,
                    sp.staff_id,
                    sp.department,
                    u.username as analyzed_by_username
                FROM contamination_analysis ca
                JOIN dna_profiles dp ON ca.sample_profile_id = dp.id
                JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                LEFT JOIN users u ON ca.analyzed_by = u.id
                WHERE ca.contamination_percentage >= $1
                ORDER BY ca.contamination_percentage DESC, ca.analysis_date DESC
            `, [threshold]);

            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Получение последних анализов контаминации
     */
    async getRecent(limit = 50) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    ca.*,
                    dp.sample_name,
                    sp.full_name as staff_name,
                    sp.staff_id,
                    sp.department,
                    u.username as analyzed_by_username
                FROM contamination_analysis ca
                JOIN dna_profiles dp ON ca.sample_profile_id = dp.id
                JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                LEFT JOIN users u ON ca.analyzed_by = u.id
                ORDER BY ca.analysis_date DESC
                LIMIT $1
            `, [limit]);

            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Получение статистики по анализам контаминации
     */
    async getStatistics(dateFrom = null, dateTo = null) {
        const client = await this.pool.connect();
        try {
            let whereClause = '';
            const params = [];

            if (dateFrom && dateTo) {
                whereClause = 'WHERE ca.analysis_date BETWEEN $1 AND $2';
                params.push(dateFrom, dateTo);
            } else if (dateFrom) {
                whereClause = 'WHERE ca.analysis_date >= $1';
                params.push(dateFrom);
            } else if (dateTo) {
                whereClause = 'WHERE ca.analysis_date <= $1';
                params.push(dateTo);
            }

            // Общая статистика
            const generalStats = await client.query(`
                SELECT 
                    COUNT(*) as total_analyses,
                    AVG(contamination_percentage) as avg_contamination,
                    MAX(contamination_percentage) as max_contamination,
                    MIN(contamination_percentage) as min_contamination,
                    COUNT(CASE WHEN contamination_percentage >= 10 THEN 1 END) as high_contamination_count,
                    COUNT(CASE WHEN contamination_percentage >= 5 AND contamination_percentage < 10 THEN 1 END) as medium_contamination_count,
                    COUNT(CASE WHEN contamination_percentage < 5 THEN 1 END) as low_contamination_count
                FROM contamination_analysis ca
                ${whereClause}
            `, params);

            // Статистика по отделам
            const departmentStats = await client.query(`
                SELECT 
                    sp.department,
                    COUNT(*) as analyses_count,
                    AVG(ca.contamination_percentage) as avg_contamination,
                    COUNT(CASE WHEN ca.contamination_percentage >= 10 THEN 1 END) as high_contamination_count
                FROM contamination_analysis ca
                JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                ${whereClause}
                GROUP BY sp.department
                ORDER BY analyses_count DESC
            `, params);

            // Статистика по методам анализа
            const methodStats = await client.query(`
                SELECT 
                    analysis_method,
                    COUNT(*) as count,
                    AVG(contamination_percentage) as avg_contamination
                FROM contamination_analysis ca
                ${whereClause}
                GROUP BY analysis_method
                ORDER BY count DESC
            `, params);

            return {
                general: generalStats.rows[0],
                by_department: departmentStats.rows,
                by_method: methodStats.rows
            };
        } finally {
            client.release();
        }
    }

    /**
     * Поиск потенциальных источников контаминации
     */
    async findContaminationSources(sampleProfileId, threshold = 5.0) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    ca.*,
                    sp.full_name as staff_name,
                    sp.staff_id,
                    sp.department,
                    sp.position
                FROM contamination_analysis ca
                JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                WHERE ca.sample_profile_id = $1 
                  AND ca.contamination_percentage >= $2
                ORDER BY ca.contamination_percentage DESC
            `, [sampleProfileId, threshold]);

            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Получение анализов с пагинацией
     */
    async getPaginated(page = 1, limit = 20, filters = {}) {
        const client = await this.pool.connect();
        try {
            const offset = (page - 1) * limit;
            
            let whereClause = '';
            const params = [];
            let paramCount = 0;

            // Применение фильтров
            const conditions = [];

            if (filters.sample_name) {
                paramCount++;
                conditions.push(`dp.sample_name ILIKE $${paramCount}`);
                params.push(`%${filters.sample_name}%`);
            }

            if (filters.staff_name) {
                paramCount++;
                conditions.push(`sp.full_name ILIKE $${paramCount}`);
                params.push(`%${filters.staff_name}%`);
            }

            if (filters.department) {
                paramCount++;
                conditions.push(`sp.department ILIKE $${paramCount}`);
                params.push(`%${filters.department}%`);
            }

            if (filters.min_contamination) {
                paramCount++;
                conditions.push(`ca.contamination_percentage >= $${paramCount}`);
                params.push(filters.min_contamination);
            }

            if (filters.date_from) {
                paramCount++;
                conditions.push(`ca.analysis_date >= $${paramCount}`);
                params.push(filters.date_from);
            }

            if (filters.date_to) {
                paramCount++;
                conditions.push(`ca.analysis_date <= $${paramCount}`);
                params.push(filters.date_to);
            }

            if (conditions.length > 0) {
                whereClause = 'WHERE ' + conditions.join(' AND ');
            }

            // Получение общего количества записей
            const countQuery = `
                SELECT COUNT(*) 
                FROM contamination_analysis ca
                JOIN dna_profiles dp ON ca.sample_profile_id = dp.id
                JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                ${whereClause}
            `;
            const countResult = await client.query(countQuery, params);
            const totalCount = parseInt(countResult.rows[0].count);

            // Получение данных с пагинацией
            paramCount++;
            params.push(limit);
            paramCount++;
            params.push(offset);

            const dataQuery = `
                SELECT 
                    ca.*,
                    dp.sample_name,
                    sp.full_name as staff_name,
                    sp.staff_id,
                    sp.department,
                    u.username as analyzed_by_username
                FROM contamination_analysis ca
                JOIN dna_profiles dp ON ca.sample_profile_id = dp.id
                JOIN staff_profiles sp ON ca.staff_profile_id = sp.id
                LEFT JOIN users u ON ca.analyzed_by = u.id
                ${whereClause}
                ORDER BY ca.analysis_date DESC
                LIMIT $${paramCount - 1} OFFSET $${paramCount}
            `;

            const dataResult = await client.query(dataQuery, params);

            return {
                data: dataResult.rows,
                pagination: {
                    page,
                    limit,
                    total: totalCount,
                    pages: Math.ceil(totalCount / limit)
                }
            };
        } finally {
            client.release();
        }
    }

    /**
     * Удаление анализа контаминации
     */
    async delete(id) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                DELETE FROM contamination_analysis 
                WHERE id = $1
                RETURNING *
            `, [id]);

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Обновление анализа контаминации
     */
    async update(id, updateData) {
        const client = await this.pool.connect();
        try {
            const allowedFields = ['contamination_percentage', 'locus_matches', 'confidence_level', 'notes'];
            const updates = [];
            const params = [];
            let paramCount = 0;

            for (const [key, value] of Object.entries(updateData)) {
                if (allowedFields.includes(key)) {
                    paramCount++;
                    updates.push(`${key} = $${paramCount}`);
                    params.push(value);
                }
            }

            if (updates.length === 0) {
                throw new Error('Нет полей для обновления');
            }

            // Добавляем ID для WHERE условия
            paramCount++;
            params.push(id);

            const query = `
                UPDATE contamination_analysis 
                SET ${updates.join(', ')}
                WHERE id = $${paramCount}
                RETURNING *
            `;

            const result = await client.query(query, params);
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }
}

module.exports = ContaminationAnalysis;