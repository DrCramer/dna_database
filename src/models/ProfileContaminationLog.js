const { pool } = require('../config/database');

/**
 * Модель для логирования результатов поиска контаминации между профилями
 */
class ProfileContaminationLog {
    /**
     * Сохранение результата поиска контаминации
     */
    static async logSearchResult(client, data) {
        const {
            referenceProfileId,
            matchedProfileId,
            referenceProfile,
            matchedProfile,
            matchType,
            matchingLociCount,
            totalLociCompared,
            matchPercentage,
            matchedLoci,
            contaminatedLoci,
            searchMode,
            algorithmUsed,
            minMatchesThreshold,
            ignoredLoci,
            taskId,
            departmentId,
            searchedBy
        } = data;

        const query = `
            INSERT INTO profile_contamination_log (
                reference_profile_id,
                matched_profile_id,
                reference_sample_name,
                reference_internal_number,
                reference_import_number,
                reference_year,
                matched_sample_name,
                matched_internal_number,
                matched_import_number,
                matched_year,
                match_type,
                matching_loci_count,
                total_loci_compared,
                match_percentage,
                matched_loci,
                contaminated_loci,
                search_mode,
                algorithm_used,
                min_matches_threshold,
                ignored_loci,
                task_id,
                department_id,
                searched_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23
            )
            ON CONFLICT (reference_profile_id, matched_profile_id, search_date)
            DO UPDATE SET
                match_type = EXCLUDED.match_type,
                matching_loci_count = EXCLUDED.matching_loci_count,
                match_percentage = EXCLUDED.match_percentage
            RETURNING *
        `;

        const values = [
            referenceProfileId,
            matchedProfileId,
            referenceProfile.sample_name,
            referenceProfile.internal_number,
            referenceProfile.import_number,
            referenceProfile.year,
            matchedProfile.sample_name,
            matchedProfile.internal_number,
            matchedProfile.import_number,
            matchedProfile.year,
            matchType,
            matchingLociCount,
            totalLociCompared,
            matchPercentage,
            matchedLoci ? JSON.stringify(matchedLoci) : null,
            contaminatedLoci ? JSON.stringify(contaminatedLoci) : null,
            searchMode,
            algorithmUsed,
            minMatchesThreshold,
            ignoredLoci || [],
            taskId,
            departmentId,
            searchedBy
        ];

        const result = await client.query(query, values);
        return result.rows[0];
    }

    /**
     * Массовое сохранение результатов поиска
     */
    static async logBulkSearchResults(searchResults, searchContext) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const savedResults = [];
            for (const result of searchResults) {
                const saved = await this.logSearchResult(client, {
                    ...result,
                    ...searchContext
                });
                savedResults.push(saved);
            }

            await client.query('COMMIT');
            return savedResults;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Получение статистики по привозам
     */
    static async getStatsByImport(importNumber, year) {
        let query = 'SELECT * FROM contamination_stats_by_import';
        const conditions = [];
        const values = [];
        let paramCount = 1;

        if (importNumber) {
            conditions.push(`reference_import_number = $${paramCount++}`);
            values.push(importNumber);
        }

        if (year) {
            conditions.push(`reference_year = $${paramCount++}`);
            values.push(year);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const result = await pool.query(query, values);
        return result.rows;
    }

    /**
     * Получение статистики по периодам
     */
    static async getStatsByPeriod(startDate, endDate) {
        let query = 'SELECT * FROM contamination_stats_by_period';
        const conditions = [];
        const values = [];
        let paramCount = 1;

        if (startDate) {
            conditions.push(`period >= $${paramCount++}`);
            values.push(startDate);
        }

        if (endDate) {
            conditions.push(`period <= $${paramCount++}`);
            values.push(endDate);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY period DESC';

        const result = await pool.query(query, values);
        return result.rows;
    }

    /**
     * Получение детальной истории поиска
     */
    static async getSearchHistory(filters = {}) {
        const {
            profileId,
            taskId,
            departmentId,
            matchType,
            startDate,
            endDate,
            limit = 100,
            offset = 0
        } = filters;

        let query = 'SELECT * FROM contamination_log_detailed WHERE 1=1';
        const values = [];
        let paramCount = 1;

        if (profileId) {
            query += ` AND (reference_profile_id = $${paramCount} OR matched_profile_id = $${paramCount})`;
            values.push(profileId);
            paramCount++;
        }

        if (taskId) {
            query += ` AND task_id = $${paramCount++}`;
            values.push(taskId);
        }

        if (departmentId) {
            query += ` AND department_id = $${paramCount++}`;
            values.push(departmentId);
        }

        if (matchType) {
            query += ` AND match_type = $${paramCount++}`;
            values.push(matchType);
        }

        if (startDate) {
            query += ` AND search_date >= $${paramCount++}`;
            values.push(startDate);
        }

        if (endDate) {
            query += ` AND search_date <= $${paramCount++}`;
            values.push(endDate);
        }

        query += ` ORDER BY search_date DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
        values.push(limit, offset);

        const result = await pool.query(query, values);
        return result.rows;
    }

    /**
     * Получение статистики контаминации для профиля
     */
    static async getProfileContaminationStats(profileId) {
        const query = `
            SELECT 
                COUNT(*) as total_searches,
                COUNT(CASE WHEN match_type = 'full_match' THEN 1 END) as full_matches,
                COUNT(CASE WHEN match_type = 'partial_match' THEN 1 END) as contaminations,
                AVG(match_percentage) as avg_match_percentage,
                MIN(search_date) as first_search,
                MAX(search_date) as last_search
            FROM profile_contamination_log
            WHERE reference_profile_id = $1 OR matched_profile_id = $1
        `;

        const result = await pool.query(query, [profileId]);
        return result.rows[0];
    }
}

module.exports = ProfileContaminationLog;
