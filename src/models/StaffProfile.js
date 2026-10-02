/**
 * Модель для работы с профилями сотрудников
 * Обеспечивает CRUD операции и специализированные методы для анализа контаминации
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

class StaffProfile {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Создание нового профиля сотрудника
     */
    async create(staffData) {
        const client = await this.pool.connect();
        try {
            const {
                staff_id,
                full_name,
                department,
                position,
                str_data,
                notes,
                created_by
            } = staffData;

            const result = await client.query(`
                INSERT INTO staff_profiles (
                    staff_id, full_name, department, position, str_data, notes, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [staff_id, full_name, department, position, str_data, notes, created_by]);

            return result.rows[0];
        } finally {
            client.release();
        }
    }

    /**
     * Получение профиля сотрудника по ID
     */
    async getById(id) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT sp.*, u.username as created_by_username
                FROM staff_profiles sp
                LEFT JOIN users u ON sp.created_by = u.id
                WHERE sp.id = $1 AND sp.is_active = true
            `, [id]);

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Получение профиля сотрудника по staff_id
     */
    async getByStaffId(staffId) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT sp.*, u.username as created_by_username
                FROM staff_profiles sp
                LEFT JOIN users u ON sp.created_by = u.id
                WHERE sp.staff_id = $1 AND sp.is_active = true
            `, [staffId]);

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Получение всех активных профилей сотрудников
     */
    async getAll(filters = {}) {
        const client = await this.pool.connect();
        try {
            let query = `
                SELECT sp.*, u.username as created_by_username
                FROM staff_profiles sp
                LEFT JOIN users u ON sp.created_by = u.id
                WHERE sp.is_active = true
            `;
            const params = [];
            let paramCount = 0;

            // Фильтрация по отделу
            if (filters.department) {
                paramCount++;
                query += ` AND sp.department ILIKE $${paramCount}`;
                params.push(`%${filters.department}%`);
            }

            // Фильтрация по имени
            if (filters.name) {
                paramCount++;
                query += ` AND sp.full_name ILIKE $${paramCount}`;
                params.push(`%${filters.name}%`);
            }

            // Фильтрация по должности
            if (filters.position) {
                paramCount++;
                query += ` AND sp.position ILIKE $${paramCount}`;
                params.push(`%${filters.position}%`);
            }

            query += ` ORDER BY sp.full_name`;

            const result = await client.query(query, params);
            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Обновление профиля сотрудника
     */
    async update(id, updateData) {
        const client = await this.pool.connect();
        try {
            const allowedFields = ['full_name', 'department', 'position', 'str_data', 'notes', 'is_active'];
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

            // Добавляем обновление времени
            paramCount++;
            updates.push(`last_updated = $${paramCount}`);
            params.push(new Date());

            // Добавляем ID для WHERE условия
            paramCount++;
            params.push(id);

            const query = `
                UPDATE staff_profiles 
                SET ${updates.join(', ')}
                WHERE id = $${paramCount} AND is_active = true
                RETURNING *
            `;

            const result = await client.query(query, params);
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Мягкое удаление профиля сотрудника
     */
    async delete(id) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                UPDATE staff_profiles 
                SET is_active = false, last_updated = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `, [id]);

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Поиск сотрудников для анализа контаминации
     */
    async getForContaminationAnalysis() {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    id,
                    staff_id,
                    full_name,
                    department,
                    str_data
                FROM staff_profiles 
                WHERE is_active = true
                ORDER BY full_name
            `);

            return result.rows;
        } finally {
            client.release();
        }
    }

    /**
     * Получение статистики по профилям сотрудников
     */
    async getStatistics() {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
                SELECT 
                    COUNT(*) as total_profiles,
                    COUNT(CASE WHEN is_active = true THEN 1 END) as active_profiles,
                    COUNT(DISTINCT department) as departments_count,
                    COUNT(DISTINCT position) as positions_count
                FROM staff_profiles
            `);

            const departmentStats = await client.query(`
                SELECT 
                    department,
                    COUNT(*) as count
                FROM staff_profiles 
                WHERE is_active = true AND department IS NOT NULL
                GROUP BY department
                ORDER BY count DESC
            `);

            return {
                ...result.rows[0],
                departments: departmentStats.rows
            };
        } finally {
            client.release();
        }
    }

    /**
     * Проверка уникальности staff_id
     */
    async isStaffIdUnique(staffId, excludeId = null) {
        const client = await this.pool.connect();
        try {
            let query = 'SELECT COUNT(*) FROM staff_profiles WHERE staff_id = $1';
            const params = [staffId];

            if (excludeId) {
                query += ' AND id != $2';
                params.push(excludeId);
            }

            const result = await client.query(query, params);
            return parseInt(result.rows[0].count) === 0;
        } finally {
            client.release();
        }
    }

    /**
     * Получение профилей сотрудников с пагинацией
     */
    async getPaginated(page = 1, limit = 20, filters = {}) {
        const client = await this.pool.connect();
        try {
            const offset = (page - 1) * limit;
            
            let whereClause = 'WHERE sp.is_active = true';
            const params = [];
            let paramCount = 0;

            // Применение фильтров
            if (filters.department) {
                paramCount++;
                whereClause += ` AND sp.department ILIKE $${paramCount}`;
                params.push(`%${filters.department}%`);
            }

            if (filters.name) {
                paramCount++;
                whereClause += ` AND sp.full_name ILIKE $${paramCount}`;
                params.push(`%${filters.name}%`);
            }

            if (filters.position) {
                paramCount++;
                whereClause += ` AND sp.position ILIKE $${paramCount}`;
                params.push(`%${filters.position}%`);
            }

            // Получение общего количества записей
            const countQuery = `
                SELECT COUNT(*) 
                FROM staff_profiles sp 
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
                SELECT sp.*, u.username as created_by_username
                FROM staff_profiles sp
                LEFT JOIN users u ON sp.created_by = u.id
                ${whereClause}
                ORDER BY sp.full_name
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
}

module.exports = StaffProfile;