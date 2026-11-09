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
    static aggregate() {
        return `COUNT(*) AS total_searches, COUNT(*) FILTER(WHERE l.match_type='full_match') AS full_matches,
            COUNT(*) FILTER(WHERE l.match_type='partial_match') AS contaminations, AVG(l.match_percentage) AS avg_match_percentage`;
    }
    static async getStatsByImport(importNumber, year, scope) {
        const { logScope } = require('../services/contamination/contaminationAccess');
        const values = [...scope.params]; let where = logScope(scope);
        if (importNumber) { values.push(importNumber); where += ` AND l.reference_import_number=$${values.length}`; }
        if (year) { values.push(year); where += ` AND l.reference_year=$${values.length}`; }
        return (await pool.query(`SELECT l.reference_import_number,l.reference_year,${this.aggregate()},
            MIN(l.search_date) AS first_search,MAX(l.search_date) AS last_search FROM profile_contamination_log l
            WHERE ${where} GROUP BY l.reference_import_number,l.reference_year ORDER BY l.reference_year DESC,l.reference_import_number DESC`,values)).rows;
    }
    static async getStatsByPeriod(startDate, endDate, scope) {
        const { logScope } = require('../services/contamination/contaminationAccess');
        const values=[...scope.params];let where=logScope(scope);
        if(startDate){values.push(startDate);where+=` AND DATE_TRUNC('month',l.search_date)>=$${values.length}`;}
        if(endDate){values.push(endDate);where+=` AND DATE_TRUNC('month',l.search_date)<=$${values.length}`;}
        return(await pool.query(`SELECT DATE_TRUNC('month',l.search_date) AS period,${this.aggregate()},
            COUNT(DISTINCT l.reference_profile_id) AS unique_references,COUNT(DISTINCT l.searched_by) AS unique_users
            FROM profile_contamination_log l WHERE ${where} GROUP BY DATE_TRUNC('month',l.search_date) ORDER BY period DESC`,values)).rows;
    }
    static async getSearchHistory(filters = {}, scope) {
        const { logScope } = require('../services/contamination/contaminationAccess');
        const values=[...scope.params];let where=logScope(scope);
        for(const [key,column] of [['profileId',null],['taskId','task_id'],['matchType','match_type'],['startDate','search_date'],['endDate','search_date']]){
            if(filters[key]){values.push(filters[key]);const p='$'+values.length;
                where+=key==='profileId'?` AND (l.reference_profile_id=${p} OR l.matched_profile_id=${p})`:
                    ` AND l.${column}${key==='startDate'?'>=':key==='endDate'?'<=':'='}${p}`;}
        }
        const limit=Math.min(1000,Math.max(1,Number.isInteger(Number(filters.limit))?Number(filters.limit):100));
        const offset=Math.max(0,Number.isInteger(Number(filters.offset))?Number(filters.offset):0);
        values.push(limit,offset);
        return(await pool.query(`SELECT l.* FROM contamination_log_detailed l WHERE ${where}
            ORDER BY l.search_date DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
    }
    static async getProfileContaminationStats(profileId, scope) {
        const { logScope } = require('../services/contamination/contaminationAccess');
        const values=[...scope.params,profileId],p='$'+values.length;
        return(await pool.query(`SELECT ${this.aggregate()},MIN(l.search_date) AS first_search,MAX(l.search_date) AS last_search
            FROM profile_contamination_log l WHERE ${logScope(scope)} AND (l.reference_profile_id=${p} OR l.matched_profile_id=${p})`,values)).rows[0];
    }
}
module.exports = ProfileContaminationLog;
