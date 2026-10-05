const { query, transaction } = require('../config/database');
const { resolveProfileImportFormat, geneticObjectKey } = require('../utils/profileImportFormat');
const { logger } = require('../utils/logger');
const { STR_LOCI } = require('../services/excelService');

class MasterArray {
    constructor(data) {
        this.id = data.id;
        this.department_id = data.department_id;
        this.name = data.name;
        this.description = data.description;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.is_active = data.is_active;
    }

    /**
     * Create a new master array
     * @param {Object} masterArrayData - Master array data
     * @param {string} masterArrayData.department_id - Department ID (required)
     * @param {string} masterArrayData.name - Master array name (required)
     * @param {string} masterArrayData.description - Master array description
     * @returns {Promise<MasterArray>} Created master array
     */
    static async create(masterArrayData) {
        const { department_id, name, description } = masterArrayData;

        // Validate required fields
        if (!department_id) {
            throw new Error('Department ID is required');
        }

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            throw new Error('Master array name is required and must be a non-empty string');
        }

        if (name.length > 255) {
            throw new Error('Master array name must be 255 characters or less');
        }

        try {
            const result = await transaction(async (client) => {
                // Verify department exists and is active
                const deptResult = await client.query(
                    'SELECT id FROM departments WHERE id = $1 AND is_active = true',
                    [department_id]
                );

                if (deptResult.rows.length === 0) {
                    throw new Error('Department not found or inactive');
                }

                // Create master array
                const masterArrayResult = await client.query(`
                    INSERT INTO master_arrays (department_id, name, description)
                    VALUES ($1, $2, $3)
                    RETURNING *
                `, [
                    department_id,
                    name.trim(),
                    description || null
                ]);

                return masterArrayResult.rows[0];
            });

            const masterArray = new MasterArray(result);
            
            logger.info('Master array created', {
                masterArrayId: masterArray.id,
                name: masterArray.name,
                departmentId: masterArray.department_id
            });

            return masterArray;
        } catch (error) {
            logger.error('Error creating master array', { 
                error: error.message, 
                masterArrayData 
            });
            throw error;
        }
    }

    /**
     * Find master array by ID
     * @param {string} id - Master array ID
     * @returns {Promise<MasterArray|null>} Master array or null if not found
     */
    static async findById(id) {
        if (!id) {
            throw new Error('Master array ID is required');
        }

        const queryText = `
            SELECT * FROM master_arrays 
            WHERE id = $1 AND is_active = true
        `;

        try {
            const result = await query(queryText, [id]);
            return result.rows.length > 0 ? new MasterArray(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding master array by ID', { 
                error: error.message, 
                id 
            });
            throw error;
        }
    }

    /**
     * Find master array by department ID
     * @param {string} departmentId - Department ID
     * @returns {Promise<MasterArray|null>} Master array or null if not found
     */
    static async findByDepartment(departmentId) {
        if (!departmentId) {
            throw new Error('Department ID is required');
        }

        const queryText = `
            SELECT * FROM master_arrays 
            WHERE department_id = $1 AND is_active = true
        `;

        try {
            const result = await query(queryText, [departmentId]);
            return result.rows.length > 0 ? new MasterArray(result.rows[0]) : null;
        } catch (error) {
            logger.error('Error finding master array by department', { 
                error: error.message, 
                departmentId 
            });
            throw error;
        }
    }

    /**
     * Get all active master arrays
     * @param {Object} options - Query options
     * @param {number} options.limit - Limit results (default: 100)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @returns {Promise<Array<MasterArray>>} Array of master arrays
     */
    static async findAll(options = {}) {
        const { limit = 100, offset = 0 } = options;

        const queryText = `
            SELECT ma.*, d.name as department_name, o.name as organization_name 
            FROM master_arrays ma
            JOIN departments d ON ma.department_id = d.id
            JOIN organizations o ON d.organization_id = o.id
            WHERE ma.is_active = true AND d.is_active = true AND o.is_active = true
            ORDER BY ma.created_at DESC
            LIMIT $1 OFFSET $2
        `;

        try {
            const result = await query(queryText, [limit, offset]);
            return result.rows.map(row => new MasterArray(row));
        } catch (error) {
            logger.error('Error finding all master arrays', { 
                error: error.message, 
                options 
            });
            throw error;
        }
    }

    /**
     * Update master array
     * @param {Object} updates - Fields to update
     * @param {string} updates.name - Master array name
     * @param {string} updates.description - Master array description
     * @returns {Promise<MasterArray>} Updated master array
     */
    async update(updates) {
        const allowedFields = ['name', 'description'];
        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                if (key === 'name') {
                    if (!value || typeof value !== 'string' || value.trim().length === 0) {
                        throw new Error('Master array name is required and must be a non-empty string');
                    }
                    if (value.length > 255) {
                        throw new Error('Master array name must be 255 characters or less');
                    }
                    updateFields.push(`name = $${paramIndex}`);
                    values.push(value.trim());
                } else {
                    updateFields.push(`${key} = $${paramIndex}`);
                    values.push(value);
                }
                paramIndex++;
            }
        }

        if (updateFields.length === 0) {
            throw new Error('No valid fields to update');
        }

        values.push(this.id);
        const queryText = `
            UPDATE master_arrays 
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex} AND is_active = true
            RETURNING *
        `;

        try {
            const result = await query(queryText, values);
            
            if (result.rows.length === 0) {
                throw new Error('Master array not found or inactive');
            }

            // Update instance properties
            const updatedData = result.rows[0];
            Object.assign(this, updatedData);

            logger.info('Master array updated', {
                masterArrayId: this.id,
                updates
            });

            return this;
        } catch (error) {
            logger.error('Error updating master array', { 
                error: error.message, 
                masterArrayId: this.id, 
                updates 
            });
            throw error;
        }
    }

    /**
     * Deactivate master array (soft delete)
     * This will also deactivate all profiles in the master array
     * @returns {Promise<void>}
     */
    async deactivate() {
        try {
            await transaction(async (client) => {
                // Deactivate the master array
                await client.query(
                    'UPDATE master_arrays SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                    [this.id]
                );

                // Deactivate all profiles in this master array
                await client.query(
                    'UPDATE master_array_profiles SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE master_array_id = $1',
                    [this.id]
                );

                // Update department to remove master array reference
                await client.query(
                    'UPDATE departments SET master_array_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE master_array_id = $1',
                    [this.id]
                );
            });

            this.is_active = false;
            
            logger.info('Master array deactivated with cascade', {
                masterArrayId: this.id,
                name: this.name
            });
        } catch (error) {
            logger.error('Error deactivating master array', { 
                error: error.message, 
                masterArrayId: this.id 
            });
            throw error;
        }
    }

    /**
     * Add multiple profiles to master array in batch (optimized)
     * @param {Array<Object>} profilesData - Array of profile data objects
     * @returns {Promise<Object>} Result with success and error arrays
     */
    async isGeneticDepartment() {
        const result = await query('SELECT name FROM departments WHERE id = $1 AND is_active = true', [this.department_id]);
        return resolveProfileImportFormat(result.rows[0]) === 'genetic';
    }

    async addProfilesBatch(profilesData) {
        if (!Array.isArray(profilesData) || profilesData.length === 0) {
            throw new Error('Profiles data must be a non-empty array');
        }

        const geneticDepartment = profilesData.some(p => p.metadata?.importFormat === 'genetic') && await this.isGeneticDepartment();
        const results = {
            success: [],
            errors: []
        };

        try {
            await transaction(async (client) => {
                // Получить существующие (year, internal_number) для проверки дубликатов
                const existingResult = await client.query(
                    'SELECT year, internal_number, sample_name, metadata FROM master_array_profiles WHERE master_array_id = $1 AND is_active = true',
                    [this.id]
                );
                
                const existingKeys = new Set(
                    existingResult.rows
                        .filter(r => (r.metadata?.importFormat === 'genetic') || (r.year && r.internal_number))
                        .map(r => r.metadata?.importFormat === 'genetic' ? `genetic:${geneticObjectKey(r.internal_number)}` : `${r.year}-${r.internal_number}`)
                );

                // Проверить доступ пользователя один раз
                const createdBy = profilesData[0]?.created_by;
                if (!createdBy) {
                    throw new Error('Created by user ID is required');
                }

                const userResult = await client.query(`
                    SELECT u.id, u.department_id, u.role
                    FROM users u
                    JOIN departments d ON u.department_id = d.id
                    WHERE u.id = $1 AND u.is_active = true AND (d.id = $2 OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id AND ud.department_id = $2))
                `, [createdBy, this.department_id]);

                if (userResult.rows.length === 0) {
                    const systemAdminResult = await client.query(
                        "SELECT id FROM users WHERE id = $1 AND role IN ($2, 'admin') AND is_active = true",
                        [createdBy, 'system_administrator']
                    );
                    
                    if (systemAdminResult.rows.length === 0) {
                        throw new Error('User not found or does not have access to this department');
                    }
                }

                // Подготовить данные для batch insert
                const valuesToInsert = [];
                const validProfiles = [];

                for (const profileData of profilesData) {
                    const { sample_name, str_data, year, internal_number, import_number, metadata = {} } = profileData;

                    // Валидация
                    if (!sample_name || typeof sample_name !== 'string' || sample_name.trim().length === 0) {
                        results.errors.push({
                            sample_name: sample_name || 'unknown',
                            internal_number,
                            error: 'Sample name is required and must be a non-empty string'
                        });
                        continue;
                    }

                    if (!str_data || typeof str_data !== 'object') {
                        results.errors.push({
                            sample_name,
                            internal_number,
                            error: 'STR data is required and must be an object'
                        });
                        continue;
                    }

                    // Валидация года (обязательное поле)
                    const genetic = geneticDepartment && metadata.importFormat === 'genetic';
                    if (!year && !genetic) {
                        results.errors.push({
                            sample_name,
                            internal_number,
                            error: 'Год обязателен для профиля ЧС в мастер-массиве'
                        });
                        continue;
                    }

                    // Проверка дубликатов
                    if (genetic || (year && internal_number)) {
                        const profileKey = genetic ? `genetic:${geneticObjectKey(internal_number)}` : `${year}-${internal_number}`;
                        if (existingKeys.has(profileKey)) {
                            results.errors.push({
                                sample_name,
                                internal_number,
                                error: genetic ? `Объект «${internal_number}» уже есть в мастер-массиве.` : `Профиль с номером ${internal_number} за ${year} год уже существует в мастер массиве`
                            });
                            continue;
                        }
                        // Добавить в set чтобы избежать дубликатов в текущем batch
                        existingKeys.add(profileKey);
                    }

                    try {
                        this.validateSTRData(str_data);
                        validProfiles.push(profileData);
                    } catch (error) {
                        results.errors.push({
                            sample_name,
                            internal_number,
                            error: error.message
                        });
                    }
                }

                // Batch insert всех валидных профилей
                if (validProfiles.length > 0) {
                    const values = [];
                    const placeholders = [];
                    let paramIndex = 1;

                    for (let i = 0; i < validProfiles.length; i++) {
                        const { sample_name, str_data, year, internal_number, import_number, metadata = {} } = validProfiles[i];
                        
                        placeholders.push(
                            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`
                        );
                        
                        values.push(
                            this.id,
                            year || null,
                            sample_name.trim(),
                            JSON.stringify(str_data),
                            JSON.stringify(metadata),
                            createdBy,
                            internal_number || null,
                            import_number || null
                        );
                        
                        paramIndex += 8;
                    }

                    const insertQuery = `
                        INSERT INTO master_array_profiles (
                            master_array_id,
                            year,
                            sample_name, 
                            str_data, 
                            metadata, 
                            created_by,
                            internal_number,
                            import_number
                        )
                        VALUES ${placeholders.join(', ')}
                        RETURNING id, sample_name, internal_number
                    `;

                    const insertResult = await client.query(insertQuery, values);
                    
                    results.success = insertResult.rows.map(row => ({
                        sample_name: row.sample_name,
                        internal_number: row.internal_number,
                        profile_id: row.id
                    }));
                }
            });

            logger.info('Batch profiles added to master array', {
                masterArrayId: this.id,
                totalProfiles: profilesData.length,
                successCount: results.success.length,
                errorCount: results.errors.length
            });

            return results;
        } catch (error) {
            logger.error('Error adding batch profiles to master array', { 
                error: error.message, 
                masterArrayId: this.id,
                profilesCount: profilesData.length
            });
            throw error;
        }
    }

    /**
     * Add profile to master array
     * @param {Object} profileData - Profile data
     * @param {string} profileData.sample_name - Sample name (required)
     * @param {Object} profileData.str_data - STR loci data (required)
     * @param {string} profileData.created_by - User ID who created the profile (required)
     * @param {string} profileData.internal_number - Internal number from original file
     * @param {string} profileData.import_number - Import number (номер привоза)
     * @param {Object} profileData.metadata - Additional metadata
     * @returns {Promise<Object>} Created profile
     */
    async addProfile(profileData) {
        const { sample_name, str_data, created_by, internal_number, import_number, year, metadata = {} } = profileData;

        // Validate required fields
        if (!sample_name || typeof sample_name !== 'string' || sample_name.trim().length === 0) {
            throw new Error('Sample name is required and must be a non-empty string');
        }

        if (!str_data || typeof str_data !== 'object') {
            throw new Error('STR data is required and must be an object');
        }

        if (!created_by) {
            throw new Error('Created by user ID is required');
        }

        // Validate year (required field)
        const genetic = metadata.importFormat === 'genetic' && await this.isGeneticDepartment();
        if (!year && !genetic) {
            throw new Error('Year is required for master array profile');
        }

        // Validate STR data
        this.validateSTRData(str_data);

        try {
            const result = await transaction(async (client) => {
                // Check for duplicate (year, internal_number) in this master array
                if (year && internal_number) {
                    const duplicateResult = await client.query(
                        'SELECT id FROM master_array_profiles WHERE master_array_id = $1 AND year = $2 AND internal_number = $3 AND is_active = true',
                        [this.id, year, internal_number]
                    );

                    if (duplicateResult.rows.length > 0) {
                        throw new Error(`Sample with internal number '${internal_number}' for year ${year} already exists in this master array`);
                    }
                }

                if (genetic) {
                    const duplicate = await client.query(`SELECT id FROM master_array_profiles WHERE master_array_id = $1 AND is_active = true AND metadata->>'importFormat' = 'genetic' AND lower(btrim(internal_number)) = lower(btrim($2))`, [this.id, internal_number]);
                    if (duplicate.rows.length) throw new Error(`Объект «${internal_number}» уже есть в мастер-массиве.`);
                }
                // Verify user exists and has access to this department
                const userResult = await client.query(`
                    SELECT u.id, u.department_id, u.role
                    FROM users u
                    JOIN departments d ON u.department_id = d.id
                    WHERE u.id = $1 AND u.is_active = true AND (d.id = $2 OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id AND ud.department_id = $2))
                `, [created_by, this.department_id]);

                if (userResult.rows.length === 0) {
                    const systemAdminResult = await client.query(
                        "SELECT id FROM users WHERE id = $1 AND role IN ($2, 'admin') AND is_active = true",
                        [created_by, 'system_administrator']
                    );
                    
                    if (systemAdminResult.rows.length === 0) {
                        throw new Error('User not found or does not have access to this department');
                    }
                }

                // Create profile in master array
                const profileResult = await client.query(`
                    INSERT INTO master_array_profiles (
                        master_array_id,
                        year,
                        sample_name, 
                        str_data, 
                        metadata, 
                        created_by,
                        internal_number,
                        import_number
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING *
                `, [
                    this.id,
                    year ?? null,
                    sample_name.trim(),
                    JSON.stringify(str_data),
                    JSON.stringify(metadata),
                    created_by,
                    internal_number || null,
                    import_number || null
                ]);

                return profileResult.rows[0];
            });

            logger.info('Profile added to master array', {
                masterArrayId: this.id,
                profileId: result.id,
                sampleName: result.sample_name,
                createdBy: created_by
            });

            return result;
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                throw new Error(`Sample with name '${sample_name}' already exists in this master array`);
            }
            logger.error('Error adding profile to master array', { 
                error: error.message, 
                masterArrayId: this.id,
                profileData 
            });
            throw error;
        }
    }

    /**
     * Remove profile from master array
     * @param {string} profileId - Profile ID to remove
     * @returns {Promise<boolean>} True if removed, false if not found
     */
    async removeProfile(profileId) {
        if (!profileId) {
            throw new Error('Profile ID is required');
        }

        try {
            const result = await query(
                'UPDATE master_array_profiles SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND master_array_id = $2 AND is_active = true RETURNING id',
                [profileId, this.id]
            );

            const removed = result.rows.length > 0;
            
            if (removed) {
                logger.info('Profile removed from master array', {
                    masterArrayId: this.id,
                    profileId
                });
            }

            return removed;
        } catch (error) {
            logger.error('Error removing profile from master array', { 
                error: error.message, 
                masterArrayId: this.id,
                profileId 
            });
            throw error;
        }
    }

    /**
     * Get all profiles in master array
     * @param {Object} options - Query options
     * @param {number} options.limit - Limit results (default: 100)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @param {boolean} options.includeInactive - Include inactive profiles (default: false)
     * @returns {Promise<Array>} Array of profiles
     */
    async getProfiles(options = {}) {
        const { limit = 100, offset = 0, includeInactive = false } = options;
        
        let queryText = `
            SELECT map.*, u.username as created_by_username
            FROM master_array_profiles map
            JOIN users u ON map.created_by = u.id
            WHERE map.master_array_id = $1
        `;
        
        if (!includeInactive) {
            queryText += ' AND map.is_active = true';
        }
        
        queryText += ' ORDER BY map.created_at DESC LIMIT $2 OFFSET $3';

        try {
            const result = await query(queryText, [this.id, limit, offset]);
            return result.rows;
        } catch (error) {
            logger.error('Error getting master array profiles', { 
                error: error.message, 
                masterArrayId: this.id 
            });
            throw error;
        }
    }

    /**
     * Search profiles in master array by STR data
     * @param {Object} searchCriteria - Search criteria
     * @param {Object} searchCriteria.str_data - STR data to match against
     * @param {number} searchCriteria.min_matches - Minimum number of loci matches (default: 15)
     * @param {Array} searchCriteria.ignore_loci - Loci to ignore in comparison
     * @returns {Promise<Array>} Array of matching profiles with match scores
     */
    async searchProfiles(searchCriteria) {
        const { str_data, min_matches = 15, ignore_loci = [] } = searchCriteria;

        if (!str_data || typeof str_data !== 'object') {
            throw new Error('STR data is required for search');
        }

        // Validate STR data
        this.validateSTRData(str_data);

        try {
            // Get all profiles from master array
            const profiles = await this.getProfiles({ limit: 10000 }); // Large limit for comprehensive search
            const matches = [];

            for (const profile of profiles) {
                const profileSTRData = typeof profile.str_data === 'string' 
                    ? JSON.parse(profile.str_data) 
                    : profile.str_data;

                const matchResult = this.compareSTRProfiles(str_data, profileSTRData, ignore_loci);
                
                if (matchResult.matches >= min_matches) {
                    matches.push({
                        ...profile,
                        match_score: matchResult.matches,
                        total_compared: matchResult.total_compared,
                        match_percentage: matchResult.match_percentage,
                        matching_loci: matchResult.matching_loci,
                        non_matching_loci: matchResult.non_matching_loci
                    });
                }
            }

            // Sort by match score (highest first)
            matches.sort((a, b) => b.match_score - a.match_score);

            logger.info('Master array search completed', {
                masterArrayId: this.id,
                searchedProfiles: profiles.length,
                matches: matches.length,
                minMatches: min_matches
            });

            return matches;
        } catch (error) {
            logger.error('Error searching master array profiles', { 
                error: error.message, 
                masterArrayId: this.id,
                searchCriteria 
            });
            throw error;
        }
    }

    /**
     * Find profile by sample name in master array
     * @param {string} sampleName - Sample name to search for
     * @returns {Promise<Object|null>} Profile or null if not found
     */
    async findProfileBySampleName(sampleName) {
        if (!sampleName) {
            throw new Error('Sample name is required');
        }

        const queryText = `
            SELECT map.*, u.username as created_by_username
            FROM master_array_profiles map
            JOIN users u ON map.created_by = u.id
            WHERE map.master_array_id = $1 AND map.sample_name = $2 AND map.is_active = true
        `;

        try {
            const result = await query(queryText, [this.id, sampleName]);
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            logger.error('Error finding profile by sample name', { 
                error: error.message, 
                masterArrayId: this.id,
                sampleName 
            });
            throw error;
        }
    }

    /**
     * Get master array statistics
     * @returns {Promise<Object>} Master array statistics
     */
    async getStatistics() {
        try {
            const result = await query(`
                SELECT 
                    COUNT(*) as total_profiles,
                    COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as profiles_last_30_days,
                    COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as profiles_last_7_days,
                    MIN(created_at) as oldest_profile,
                    MAX(created_at) as newest_profile
                FROM master_array_profiles 
                WHERE master_array_id = $1 AND is_active = true
            `, [this.id]);

            const stats = result.rows[0];
            return {
                totalProfiles: parseInt(stats.total_profiles),
                profilesLast30Days: parseInt(stats.profiles_last_30_days),
                profilesLast7Days: parseInt(stats.profiles_last_7_days),
                oldestProfile: stats.oldest_profile,
                newestProfile: stats.newest_profile
            };
        } catch (error) {
            logger.error('Error getting master array statistics', { 
                error: error.message, 
                masterArrayId: this.id 
            });
            throw error;
        }
    }

    /**
     * Compare two STR profiles and return match information
     * @param {Object} profile1 - First STR profile
     * @param {Object} profile2 - Second STR profile
     * @param {Array} ignoreLoci - Loci to ignore in comparison
     * @returns {Object} Match result with score and details
     */
    compareSTRProfiles(profile1, profile2, ignoreLoci = []) {
        // Ensure ignoreLoci is always an array
        const safeIgnoreLoci = Array.isArray(ignoreLoci) ? ignoreLoci : [];
        
        const loci1 = Object.keys(profile1).filter(locus => !safeIgnoreLoci.includes(locus));
        const loci2 = Object.keys(profile2).filter(locus => !safeIgnoreLoci.includes(locus));
        
        // Find common loci
        const commonLoci = loci1.filter(locus => loci2.includes(locus));
        
        let matches = 0;
        const matchingLoci = [];
        const nonMatchingLoci = [];
        
        for (const locus of commonLoci) {
            const alleles1 = [profile1[locus].allele1, profile1[locus].allele2].sort();
            const alleles2 = [profile2[locus].allele1, profile2[locus].allele2].sort();
            
            // Check if alleles match (considering both orders)
            const isMatch = alleles1[0] === alleles2[0] && alleles1[1] === alleles2[1];
            
            if (isMatch) {
                matches++;
                matchingLoci.push(locus);
            } else {
                nonMatchingLoci.push({
                    locus,
                    profile1_alleles: alleles1,
                    profile2_alleles: alleles2
                });
            }
        }
        
        return {
            matches,
            total_compared: commonLoci.length,
            match_percentage: commonLoci.length > 0 ? (matches / commonLoci.length) * 100 : 0,
            matching_loci: matchingLoci,
            non_matching_loci: nonMatchingLoci
        };
    }

    /**
     * Validate STR data structure
     * @param {Object} strData - STR data to validate
     * @throws {Error} If validation fails
     */
    validateSTRData(strData) {
        if (!strData || typeof strData !== 'object') {
            throw new Error('STR data must be an object');
        }

        const providedLoci = Object.keys(strData);
        
        // Minimum of 3 loci required for basic functionality
        if (providedLoci.length < 3) {
            throw new Error(`STR data must contain at least 3 loci, found ${providedLoci.length}`);
        }

        // Validate that provided loci are valid
        // Create a case-insensitive map for comparison
        const strLociUpperCase = STR_LOCI.map(l => l.toUpperCase());
        
        for (const locus of providedLoci) {
            const locusUpper = locus.toUpperCase();
            if (!strLociUpperCase.includes(locusUpper)) {
                // Log the error for debugging
                logger.warn('Unknown STR locus detected', {
                    locus,
                    locusUpper,
                    availableLoci: STR_LOCI.length,
                    sampleLoci: STR_LOCI.filter(l => l.toUpperCase().includes('PENTA'))
                });
                throw new Error(`Unknown STR locus: ${locus}`);
            }

            const locusData = strData[locus];
            
            // Проверка для нового формата (массив)
            if (Array.isArray(locusData)) {
                // Массив может быть пустым (это нормально)
                continue;
            }
            
            // Проверка для старого формата (объект)
            if (!locusData || locusData.allele1 === undefined || locusData.allele2 === undefined) {
                throw new Error(`Invalid allele data for locus ${locus}`);
            }
        }
    }

    /**
     * Validate user access to this master array
     * @param {string} userId - User ID to validate
     * @returns {Promise<boolean>} True if user has access, false otherwise
     */
    async validateUserAccess(userId) {
        if (!userId) {
            return false;
        }

        try {
            const result = await query(`
                SELECT u.id, u.role, u.department_id, u.organization_id
                FROM users u
                JOIN departments d ON u.department_id = d.id
                WHERE u.id = $1 AND u.is_active = true AND (d.id = $2 OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id AND ud.department_id = $2))
            `, [userId, this.department_id]);

            if (result.rows.length === 0) {
                // Check if user is system administrator
                const adminResult = await query(
                    "SELECT id FROM users WHERE id = $1 AND role IN ($2, 'admin') AND is_active = true",
                    [userId, 'system_administrator']
                );
                
                return adminResult.rows.length > 0;
            }

            return true;
        } catch (error) {
            logger.error('Error validating user access to master array', { 
                error: error.message, 
                masterArrayId: this.id,
                userId 
            });
            return false;
        }
    }

    /**
     * Get all profiles from master array with their loci data
     * @param {Object} options - Query options
     * @param {string} options.organizationId - Filter by organization (optional)
     * @param {string} options.departmentId - Filter by department (optional)
     * @returns {Promise<Array>} Array of profiles with loci data
     */
    /**
         * Get all profiles from master array with their loci data
         * @param {Object} options - Query options
         * @param {string} options.organizationId - Filter by organization (optional)
         * @param {string} options.departmentId - Filter by department (optional)
         * @returns {Promise<Array>} Array of profiles with loci data
         */
        static async getAllProfiles(options = {}) {
            const { organizationId, departmentId } = options;

            let queryText = `
                SELECT 
                    map.id,
                    map.sample_name,
                    map.internal_number,
                    map.import_number,
                    map.year,
                    map.str_data as loci,
                    map.created_at,
                    ma.department_id,
                    d.organization_id
                FROM master_array_profiles map
                JOIN master_arrays ma ON map.master_array_id = ma.id
                JOIN departments d ON ma.department_id = d.id
                WHERE map.is_active = true 
                  AND ma.is_active = true
                  AND d.is_active = true
            `;

            const params = [];
            let paramIndex = 1;

            if (organizationId) {
                queryText += ` AND d.organization_id = $${paramIndex}`;
                params.push(organizationId);
                paramIndex++;
            }

            if (departmentId) {
                queryText += ` AND ma.department_id = $${paramIndex}`;
                params.push(departmentId);
                paramIndex++;
            }

            queryText += ` ORDER BY map.created_at DESC`;

            try {
                const result = await query(queryText, params);

                // Парсим JSON данные локусов
                const profiles = result.rows.map(row => ({
                    ...row,
                    loci: typeof row.loci === 'string' ? JSON.parse(row.loci) : row.loci
                }));

                logger.info('Получены профили из мастер массива', {
                    count: profiles.length,
                    organizationId,
                    departmentId
                });

                return profiles;
            } catch (error) {
                logger.error('Ошибка получения профилей из мастер массива', { 
                    error: error.message,
                    organizationId,
                    departmentId
                });
                throw error;
            }
        }

    /**
     * Получить "горячих кандидатов" из мастер массива по ключевым локусам (пре-фильтрация)
     * Использует JSONB оператор ?| для быстрого поиска профилей с совпадающими аллелями
     * Работает с массивами: {"SE33": ["29", "31.2"]}
     * @param {Object} referenceProfile - Эталонный профиль для поиска
     * @param {Object} options - Опции поиска
     * @param {string} options.organizationId - ID организации
     * @param {string} options.departmentId - ID отдела (опционально)
     * @param {Array<string>} options.keyLoci - Ключевые локусы для фильтрации
     * @param {number} options.limit - Максимальное количество кандидатов
     * @returns {Promise<Array>} Массив профилей-кандидатов
     */
    static async getHotCandidates(referenceProfile, options = {}) {
        const {
            organizationId,
            departmentId,
            keyLoci = ['SE33', 'D1S1656', 'D3S1358', 'TH01'], // 4 ключевых локуса
            limit = 500 // Увеличен лимит
        } = options;

        // Извлекаем аллели из ключевых локусов
        const filters = [];
        const params = [];
        let paramIndex = 1;

        for (const locus of keyLoci) {
            const locusData = referenceProfile.str_data?.[locus];
            if (!locusData) continue;

            // Данные уже в формате массива
            let alleles = [];
            if (Array.isArray(locusData)) {
                alleles = locusData.filter(a => a && a !== '' && a !== '.' && a !== '*' && a !== '**' && a !== '?');
            }
            
            if (alleles.length === 0) continue;

            // Добавляем фильтр для этого локуса
            // Используем JSONB оператор ?| (contains any of array elements)
            filters.push(`(map.str_data->$${paramIndex} ?| $${paramIndex + 1})`);
            params.push(locus, alleles);
            paramIndex += 2;
        }

        // Если нет валидных локусов - возвращаем пустой массив
        if (filters.length === 0) {
            logger.warn('Нет валидных ключевых локусов для пре-фильтрации', {
                profileId: referenceProfile.id,
                keyLoci
            });
            return [];
        }

        // Строим запрос
        let queryText = `
            SELECT 
                map.id,
                map.sample_name,
                map.internal_number,
                map.import_number,
                map.year,
                map.str_data as loci,
                map.created_at
            FROM master_array_profiles map
            JOIN master_arrays ma ON map.master_array_id = ma.id
            JOIN departments d ON ma.department_id = d.id
            WHERE map.is_active = true 
              AND ma.is_active = true
              AND d.is_active = true
              AND d.organization_id = $${paramIndex}
        `;
        params.push(organizationId);
        paramIndex++;

        // Добавляем фильтр по отделу для аналитиков
        if (departmentId) {
            queryText += ` AND ma.department_id = $${paramIndex}`;
            params.push(departmentId);
            paramIndex++;
        }

        // Добавляем фильтры по локусам (OR - хотя бы один локус должен совпасть)
        queryText += ` AND (${filters.join(' OR ')})`;

        // Лимит
        queryText += ` LIMIT $${paramIndex}`;
        params.push(limit);

        try {
            const result = await query(queryText, params);
            
            // Парсим JSON данные локусов
            const profiles = result.rows.map(row => ({
                ...row,
                loci: typeof row.loci === 'string' ? JSON.parse(row.loci) : row.loci
            }));

            logger.info('🔥 Пре-фильтрация выполнена', {
                profileId: referenceProfile.id,
                totalCandidates: profiles.length,
                keyLoci,
                filtersUsed: filters.length,
                limit
            });

            return profiles;
        } catch (error) {
            logger.error('Ошибка пре-фильтрации', { 
                error: error.message,
                profileId: referenceProfile.id,
                keyLoci
            });
            throw error;
        }
    }

    /**
     * Получить "горячих кандидатов" с использованием пар локусов (ТУРБО-ПОИСК)
     * Стратегия: 2 группы по 3 локуса с AND внутри группы, OR между группами
     * Группа 1: SE33 AND D1S1656 AND vWA (мощные локусы)
     * Группа 2: D3S1358 AND TH01 AND D21S11 (стабильные локусы)
     * @param {Object} referenceProfile - Эталонный профиль для поиска
     * @param {Object} options - Опции поиска
     * @param {string} options.organizationId - ID организации
     * @param {string} options.departmentId - ID отдела (опционально)
     * @param {number} options.limit - Максимальное количество кандидатов
     * @returns {Promise<Array>} Массив профилей-кандидатов
     */
    static async getHotCandidatesWithPairs(referenceProfile, options = {}) {
        const {
            organizationId,
            departmentId,
            limit = 500
        } = options;

        // Группа 1: "Мощные" локусы (высокая дискриминация)
        const group1Loci = ['SE33', 'D1S1656', 'vWA'];
        // Группа 2: "Стабильные" локусы (на случай деградации)
        const group2Loci = ['D3S1358', 'TH01', 'D21S11'];

        const params = [];
        let paramIndex = 1;

        // Функция для создания фильтров группы
        const buildGroupFilters = (loci) => {
            const groupFilters = [];
            for (const locus of loci) {
                const locusData = referenceProfile.str_data?.[locus];
                if (!locusData) continue;

                let alleles = [];
                if (Array.isArray(locusData)) {
                    alleles = locusData.filter(a => a && a !== '' && a !== '.' && a !== '*' && a !== '**' && a !== '?');
                }

                if (alleles.length === 0) continue;

                // Добавляем фильтр для этого локуса
                groupFilters.push(`(map.str_data->$${paramIndex} ?| $${paramIndex + 1})`);
                params.push(locus, alleles);
                paramIndex += 2;
            }
            return groupFilters;
        };

        // Строим фильтры для обеих групп
        const group1Filters = buildGroupFilters(group1Loci);
        const group2Filters = buildGroupFilters(group2Loci);

        // Если нет валидных локусов ни в одной группе - возвращаем пустой массив
        if (group1Filters.length === 0 && group2Filters.length === 0) {
            logger.warn('Нет валидных локусов для пре-фильтрации с парами', {
                profileId: referenceProfile.id
            });
            return [];
        }

        // Строим запрос
        let queryText = `
            SELECT
                map.id,
                map.sample_name,
                map.internal_number,
                map.import_number,
                map.year,
                map.str_data as loci,
                map.created_at
            FROM master_array_profiles map
            JOIN master_arrays ma ON map.master_array_id = ma.id
            JOIN departments d ON ma.department_id = d.id
            WHERE map.is_active = true
              AND ma.is_active = true
              AND d.is_active = true
              AND d.organization_id = $${paramIndex}
        `;
        params.push(organizationId);
        paramIndex++;

        // Добавляем фильтр по отделу для аналитиков
        if (departmentId) {
            queryText += ` AND ma.department_id = $${paramIndex}`;
            params.push(departmentId);
            paramIndex++;
        }

        // Добавляем фильтры по группам
        const groupConditions = [];
        if (group1Filters.length > 0) {
            groupConditions.push(`(${group1Filters.join(' AND ')})`);
        }
        if (group2Filters.length > 0) {
            groupConditions.push(`(${group2Filters.join(' AND ')})`);
        }

        if (groupConditions.length > 0) {
            queryText += ` AND (${groupConditions.join(' OR ')})`;
        }

        // Лимит
        queryText += ` LIMIT $${paramIndex}`;
        params.push(limit);

        try {
            const result = await query(queryText, params);

            // Парсим JSON данные локусов
            const profiles = result.rows.map(row => ({
                ...row,
                loci: typeof row.loci === 'string' ? JSON.parse(row.loci) : row.loci
            }));

            logger.info('🚀 Турбо-поиск с парами локусов выполнен', {
                profileId: referenceProfile.id,
                totalCandidates: profiles.length,
                group1Loci,
                group2Loci,
                group1FiltersCount: group1Filters.length,
                group2FiltersCount: group2Filters.length,
                limit
            });

            return profiles;
        } catch (error) {
            logger.error('Ошибка турбо-поиска с парами локусов', {
                error: error.message,
                profileId: referenceProfile.id
            });
            throw error;
        }
    }



    /**
     * Convert master array to JSON
     * @returns {Object} Master array as plain object
     */
    toJSON() {
        return {
            id: this.id,
            department_id: this.department_id,
            name: this.name,
            description: this.description,
            created_at: this.created_at,
            updated_at: this.updated_at,
            is_active: this.is_active
        };
    }
}

module.exports = MasterArray;