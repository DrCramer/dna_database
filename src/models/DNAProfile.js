const { query, transaction } = require('../config/database');
const { logger } = require('../utils/logger');
const { ALL_LOCI } = require('../utils/lociTypeDetector');

class DNAProfile {
  constructor(data) {
    this.id = data.id;
    this.userId = data.user_id || data.userId;
    this.year = data.year; // Год образца
    this.sampleName = data.sample_name || data.sampleName;
    this.internalNumber = data.internal_number || data.internalNumber; // New field for original Sample Name
    this.importNumber = data.import_number || data.importNumber; // Import number
    this.taskId = data.task_id || data.taskId; // Task ID for task-related profiles
    
    // Handle STR data parsing - it might be stored as JSON string
    let strData = data.str_data || data.strData;
    if (typeof strData === 'string') {
      try {
        strData = JSON.parse(strData);
      } catch (parseError) {
        console.warn(`Failed to parse STR data for profile ${data.id}:`, parseError);
        strData = null;
      }
    }
    this.strData = strData;
    
    this.uploadDate = data.upload_date || data.uploadDate;
    this.fileSource = data.file_source || data.fileSource;
    this.notes = data.notes;
    this.isActive = data.is_active !== undefined ? data.is_active : data.isActive;
    // Master array support fields
    this.masterArrayId = data.master_array_id || data.masterArrayId;
    this.profileType = data.profile_type || data.profileType || 'user';
  }

  /**
   * Create a new DNA profile in the database
   * @param {Object} profileData - Profile data
   * @param {string} profileData.userId - User ID
   * @param {number} profileData.year - Год образца
   * @param {string} profileData.sampleName - Generated unique sample name
   * @param {string} profileData.internalNumber - Original sample name from Excel (Sample Name column)
   * @param {Object} profileData.strData - STR loci data
   * @param {string} profileData.fileSource - Source file name
   * @param {string} profileData.notes - Optional notes
   * @param {string} profileData.masterArrayId - Master array ID (for master profiles)
   * @param {string} profileData.profileType - Profile type ('user' or 'master')
   * @param {string} profileData.taskId - Task ID (for task-related profiles)
   * @returns {Promise<DNAProfile>} Created profile
   */
  static async create(profileData) {
    const { userId, year, sampleName, internalNumber, importNumber, strData, fileSource, notes, masterArrayId, profileType = 'user', taskId } = profileData;

    // Validate year (required field)
    if (!year) {
      throw new Error('Year is required for DNA profile');
    }

    // Validate STR data
    this.validateSTRData(strData);

    // Validate profile type
    if (!['user', 'master'].includes(profileType)) {
      throw new Error('Profile type must be either "user" or "master"');
    }

    // For master profiles, master array ID is required
    if (profileType === 'master' && !masterArrayId) {
      throw new Error('Master array ID is required for master profiles');
    }

    // For user profiles, master array ID should not be set
    if (profileType === 'user' && masterArrayId) {
      throw new Error('Master array ID should not be set for user profiles');
    }

    const queryText = `
      INSERT INTO dna_profiles (user_id, year, sample_name, internal_number, import_number, str_data, file_source, notes, master_array_id, profile_type, task_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    console.log('🔍 DEBUG DNAProfile.create() - SQL parameters:', {
      userId,
      year,
      sampleName,
      internalNumber,
      importNumber,
      hasImportNumber: !!importNumber,
      importNumberValue: importNumber,
      importNumberType: typeof importNumber
    });

    try {
      // Ensure fileSource and notes are properly encoded as UTF-8 strings
      const fileSourceStr = fileSource ? String(fileSource) : null;
      const notesStr = notes ? (typeof notes === 'object' ? JSON.stringify(notes) : String(notes)) : null;
      
      const result = await query(queryText, [
        userId,
        year,                   // Year is required (NOT NULL)
        sampleName,
        internalNumber || null, // Allow null for internal_number
        importNumber || null,   // Allow null for import_number
        JSON.stringify(strData),
        fileSourceStr,
        notesStr,
        masterArrayId || null,
        profileType,
        taskId || null
      ]);

      logger.info('DNA profile created', { 
        profileId: result.rows[0].id, 
        year,
        sampleName, 
        internalNumber,
        importNumber,
        userId,
        profileType,
        masterArrayId,
        taskId
      });

      return new DNAProfile(result.rows[0]);
    } catch (error) {
      logger.error('Error creating DNA profile', { error: error.message, profileData });
      throw error;
    }
  }

  /**
   * Find profile by ID
   * @param {string} id - Profile ID
   * @returns {Promise<DNAProfile|null>} Profile or null if not found
   */
  static async findById(id) {
    const queryText = `
      SELECT * FROM dna_profiles 
      WHERE id = $1 AND is_active = true
    `;

    try {
      const result = await query(queryText, [id]);
      return result.rows.length > 0 ? new DNAProfile(result.rows[0]) : null;
    } catch (error) {
      logger.error('Error finding DNA profile by ID', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Check if profiles already exist (active or deactivated)
   * @param {string} userId - User ID
   * @param {Array} profiles - Array of profiles to check { sampleName, internalNumber, year }
   * @returns {Promise<Array>} Array of check results with action: 'create' | 'conflict' | 'replace'
   */
  static async checkExistingProfiles(userId, profiles) {
    if (!profiles || profiles.length === 0) {
      return [];
    }

    try {
      const results = [];

      for (const profile of profiles) {
        const { sampleName, internalNumber, year } = profile;

        // Ищем профили по internal_number и year (основные идентификаторы)
        let queryText = `
          SELECT id, sample_name, internal_number, year, is_active, upload_date,
                 deactivated_at, deactivation_reason
          FROM dna_profiles
          WHERE user_id = $1 AND internal_number = $2 AND year = $3
          ORDER BY is_active DESC, upload_date DESC
        `;

        const result = await query(queryText, [userId, internalNumber, year]);

        if (result.rows.length === 0) {
          // Профиль не найден - можно создавать
          results.push({
            profile: { sampleName, internalNumber, year },
            existing: null,
            action: 'create'
          });
        } else {
          // Найдены существующие профили
          const activeProfile = result.rows.find(row => row.is_active === true);
          const deactivatedProfile = result.rows.find(row => row.is_active === false);

          if (activeProfile) {
            // Есть активный профиль - конфликт
            results.push({
              profile: { sampleName, internalNumber, year },
              existing: {
                id: activeProfile.id,
                sampleName: activeProfile.sample_name,
                internalNumber: activeProfile.internal_number,
                year: activeProfile.year,
                isActive: true,
                uploadDate: activeProfile.upload_date
              },
              action: 'conflict'
            });
          } else if (deactivatedProfile) {
            // Есть только деактивированный профиль - можно заменить
            results.push({
              profile: { sampleName, internalNumber, year },
              existing: {
                id: deactivatedProfile.id,
                sampleName: deactivatedProfile.sample_name,
                internalNumber: deactivatedProfile.internal_number,
                year: deactivatedProfile.year,
                isActive: false,
                uploadDate: deactivatedProfile.upload_date,
                deactivatedAt: deactivatedProfile.deactivated_at,
                deactivationReason: deactivatedProfile.deactivation_reason
              },
              action: 'replace'
            });
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('Error checking existing profiles', {
        error: error.message,
        userId,
        profileCount: profiles.length
      });
      throw error;
    }
  }

  /**
   * Find profiles by task ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Array<DNAProfile>>} Array of profiles
   */
  static async findByTaskId(taskId) {
    const queryText = `
      SELECT * FROM dna_profiles 
      WHERE task_id = $1 AND is_active = true
      ORDER BY upload_date DESC
    `;

    try {
      const result = await query(queryText, [taskId]);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding DNA profiles by task ID', { error: error.message, taskId });
      throw error;
    }
  }

  /**
   * Count profiles by task ID
   * @param {string} taskId - Task ID
   * @returns {Promise<number>} Count of profiles
   */
  static async countByTaskId(taskId) {
    const queryText = `
      SELECT COUNT(*) as count FROM dna_profiles 
      WHERE task_id = $1 AND is_active = true
    `;

    try {
      const result = await query(queryText, [taskId]);
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error('Error counting DNA profiles by task ID', { error: error.message, taskId });
      throw error;
    }
  }

  /**
   * Count profiles uploaded by user in last 30 days
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Object with count
   */
  static async countByUserLast30Days(userId) {
    const queryText = `
      SELECT COUNT(*) as count FROM dna_profiles 
      WHERE user_id = $1 
        AND is_active = true
        AND upload_date >= NOW() - INTERVAL '30 days'
    `;

    try {
      const result = await query(queryText, [userId]);
      return { count: parseInt(result.rows[0].count, 10) };
    } catch (error) {
      logger.error('Error counting DNA profiles by user (30 days)', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Find profiles by user ID with department isolation
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit results
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.profileType - Filter by profile type ('user', 'master', or 'all')
   * @returns {Promise<Array<DNAProfile>>} Array of profiles
   */
  static async findByUserId(userId, options = {}) {
    const { limit = 100, offset = 0, profileType = 'user' } = options;
    
    let queryText = `
      SELECT dp.* FROM dna_profiles dp
      JOIN users u ON dp.user_id = u.id
      WHERE dp.user_id = $1 AND dp.is_active = true AND u.is_active = true
    `;
    const params = [userId];
    let paramIndex = 2;

    // Filter by profile type
    if (profileType !== 'all') {
      queryText += ` AND dp.profile_type = $${paramIndex}`;
      params.push(profileType);
      paramIndex++;
    }

    queryText += ` ORDER BY dp.upload_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const result = await query(queryText, params);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding DNA profiles by user ID', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Find duplicate profiles based on STR data
   * @param {Object} strData - STR data to check for duplicates
   * @param {string} excludeId - Profile ID to exclude from search (for updates)
   * @returns {Promise<Array<DNAProfile>>} Array of duplicate profiles
   */
  static async findDuplicates(strData, excludeId = null) {
    // Validate STR data
    this.validateSTRData(strData);

    let queryText = `
      SELECT * FROM dna_profiles 
      WHERE str_data = $1 AND is_active = true
    `;
    const params = [JSON.stringify(strData)];

    if (excludeId) {
      queryText += ' AND id != $2';
      params.push(excludeId);
    }

    try {
      const result = await query(queryText, params);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding duplicate DNA profiles', { error: error.message });
      throw error;
    }
  }

  /**
   * Find potential duplicates by sample name and user
   * @param {string} sampleName - Sample name to check
   * @param {string} userId - User ID
   * @param {string} excludeId - Profile ID to exclude from search
   * @returns {Promise<Array<DNAProfile>>} Array of profiles with same sample name
   */
  static async findBySampleName(sampleName, userId, excludeId = null) {
    let queryText = `
      SELECT * FROM dna_profiles 
      WHERE sample_name = $1 AND user_id = $2 AND is_active = true
    `;
    const params = [sampleName, userId];

    if (excludeId) {
      queryText += ' AND id != $3';
      params.push(excludeId);
    }

    try {
      const result = await query(queryText, params);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding profiles by sample name', { error: error.message, sampleName, userId });
      throw error;
    }
  }

  /**
   * Find profiles by internal number (original Sample Name from Excel)
   * @param {string} internalNumber - Internal number to search for
   * @param {string} userId - User ID (optional, for user-specific search)
   * @param {string} excludeId - Profile ID to exclude from search
   * @returns {Promise<Array<DNAProfile>>} Array of profiles with same internal number
   */
  static async findByInternalNumber(internalNumber, userId = null, excludeId = null) {
    let queryText = `
      SELECT * FROM dna_profiles 
      WHERE internal_number = $1 AND is_active = true
    `;
    const params = [internalNumber];
    let paramIndex = 2;

    if (userId) {
      queryText += ` AND user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (excludeId) {
      queryText += ` AND id != $${paramIndex}`;
      params.push(excludeId);
    }

    queryText += ' ORDER BY upload_date DESC';

    try {
      const result = await query(queryText, params);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding profiles by internal number', { error: error.message, internalNumber, userId });
      throw error;
    }
  }

  /**
   * Get all active profiles
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit results
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Array<DNAProfile>>} Array of profiles
   */
  static async findAll(options = {}) {
    const { limit = 100, offset = 0 } = options;
    
    const queryText = `
      SELECT * FROM dna_profiles 
      WHERE is_active = true
      ORDER BY upload_date DESC
      LIMIT $1 OFFSET $2
    `;

    try {
      const result = await query(queryText, [limit, offset]);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding all DNA profiles', { error: error.message });
      throw error;
    }
  }

  /**
   * Find profiles by user with department access (includes user's own profiles + department master array profiles)
   * @param {string} userId - User ID
   * @param {string} departmentId - Department ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit results
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.profile_type - Filter by profile type
   * @returns {Promise<Array<DNAProfile>>} Array of profiles
   */
  static async findByUserWithDepartmentAccess(userId, departmentId, options = {}) {
    const { limit = 100, offset = 0, profile_type } = options;
    
    let queryText = `
      SELECT DISTINCT dp.* FROM dna_profiles dp
      LEFT JOIN users u ON dp.user_id = u.id
      LEFT JOIN master_array_profiles map ON dp.id = map.id
      WHERE dp.is_active = true AND (
        (dp.user_id = $1) OR 
        (dp.profile_type = 'master' AND u.department_id = $2)
      )
    `;
    const params = [userId, departmentId];
    let paramIndex = 3;

    // Filter by profile type if specified
    if (profile_type && profile_type !== 'all') {
      queryText += ` AND dp.profile_type = ${paramIndex}`;
      params.push(profile_type);
      paramIndex++;
    }

    queryText += ` ORDER BY dp.upload_date DESC LIMIT ${paramIndex} OFFSET ${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const result = await query(queryText, params);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding profiles by user with department access', { 
        error: error.message, 
        userId, 
        departmentId 
      });
      throw error;
    }
  }

  /**
   * Count profiles by user with department access
   * @param {string} userId - User ID
   * @param {string} departmentId - Department ID
   * @param {Object} options - Query options
   * @param {string} options.profile_type - Filter by profile type
   * @returns {Promise<number>} Count of profiles
   */
  static async countByUserWithDepartmentAccess(userId, departmentId, options = {}) {
    const { profile_type } = options;
    
    let queryText = `
      SELECT COUNT(DISTINCT dp.id) as count FROM dna_profiles dp
      LEFT JOIN users u ON dp.user_id = u.id
      WHERE dp.is_active = true AND (
        (dp.user_id = $1) OR 
        (dp.profile_type = 'master' AND u.department_id = $2)
      )
    `;
    const params = [userId, departmentId];

    // Filter by profile type if specified
    if (profile_type && profile_type !== 'all') {
      queryText += ` AND dp.profile_type = $3`;
      params.push(profile_type);
    }

    try {
      const result = await query(queryText, params);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('Error counting profiles by user with department access', { 
        error: error.message, 
        userId, 
        departmentId 
      });
      throw error;
    }
  }

  /**
   * Find all profiles with organizational context (for admin/department head access)
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit results
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.department_id - Filter by department ID
   * @param {string} options.profile_type - Filter by profile type
   * @returns {Promise<Array<DNAProfile>>} Array of profiles
   */
  static async findAllWithOrganizationalContext(options = {}) {
    const { limit = 100, offset = 0, department_id, profile_type } = options;
    
    let queryText = `
      SELECT dp.* FROM dna_profiles dp
      LEFT JOIN users u ON dp.user_id = u.id
      WHERE dp.is_active = true
    `;
    const params = [];
    let paramIndex = 1;

    // Filter by department if specified
    if (department_id) {
      queryText += ` AND u.department_id = $${paramIndex}`;
      params.push(department_id);
      paramIndex++;
    }

    // Filter by profile type if specified
    if (profile_type && profile_type !== 'all') {
      queryText += ` AND dp.profile_type = $${paramIndex}`;
      params.push(profile_type);
      paramIndex++;
    }

    queryText += ` ORDER BY dp.upload_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const result = await query(queryText, params);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding all profiles with organizational context', { 
        error: error.message, 
        options 
      });
      throw error;
    }
  }

  /**
   * Count all profiles with organizational context
   * @param {Object} options - Query options
   * @param {string} options.department_id - Filter by department ID
   * @param {string} options.profile_type - Filter by profile type
   * @returns {Promise<number>} Count of profiles
   */
  static async countWithOrganizationalContext(options = {}) {
    const { department_id, profile_type } = options;
    
    let queryText = `
      SELECT COUNT(*) as count FROM dna_profiles dp
      LEFT JOIN users u ON dp.user_id = u.id
      WHERE dp.is_active = true
    `;
    const params = [];
    let paramIndex = 1;

    // Filter by department if specified
    if (department_id) {
      queryText += ` AND u.department_id = $${paramIndex}`;
      params.push(department_id);
      paramIndex++;
    }

    // Filter by profile type if specified
    if (profile_type && profile_type !== 'all') {
      queryText += ` AND dp.profile_type = $${paramIndex}`;
      params.push(profile_type);
      paramIndex++;
    }

    try {
      const result = await query(queryText, params);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('Error counting profiles with organizational context', { 
        error: error.message, 
        options 
      });
      throw error;
    }
  }

  /**
   * Find duplicates within department scope
   * @param {Object} strData - STR data to check for duplicates
   * @param {string} departmentId - Department ID to limit search scope
   * @param {string} excludeId - Profile ID to exclude from search
   * @returns {Promise<Array<DNAProfile>>} Array of duplicate profiles
   */
  static async findDuplicatesInDepartment(strData, departmentId, excludeId = null) {
    // Validate STR data
    this.validateSTRData(strData);

    let queryText = `
      SELECT dp.* FROM dna_profiles dp
      JOIN users u ON dp.user_id = u.id
      WHERE dp.str_data = $1 AND dp.is_active = true AND u.department_id = $2
    `;
    const params = [JSON.stringify(strData), departmentId];

    if (excludeId) {
      queryText += ' AND dp.id != $3';
      params.push(excludeId);
    }

    try {
      const result = await query(queryText, params);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding duplicate DNA profiles in department', { 
        error: error.message, 
        departmentId 
      });
      throw error;
    }
  }

  /**
   * Update profile
   * @param {string} id - Profile ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<DNAProfile|null>} Updated profile or null if not found
   */
  static async update(id, updates) {
    const allowedFields = [
      'sample_name', 
      'internal_number', 
      'str_data', 
      'notes', 
      'is_active', 
      'master_array_id', 
      'profile_type',
      'deactivated_by',
      'deactivated_at',
      'deactivation_reason',
      'expert_comment',
      'comment_updated_at',
      'comment_updated_by'
    ];
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(dbField)) {
        updateFields.push(`${dbField} = $${paramIndex}`);
        values.push(dbField === 'str_data' ? JSON.stringify(value) : value);
        paramIndex++;
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);
    const queryText = `
      UPDATE dna_profiles 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      const result = await query(queryText, values);
      if (result.rows.length === 0) {
        return null;
      }

      logger.info('DNA profile updated', { profileId: id, updates });
      return new DNAProfile(result.rows[0]);
    } catch (error) {
      logger.error('Error updating DNA profile', { error: error.message, id, updates });
      throw error;
    }
  }

  /**
   * Soft delete profile with cascade deletion of match results
   * @param {string} id - Profile ID
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  static async delete(id) {
    try {
      // First, soft delete the profile
      const profileQueryText = `
        UPDATE dna_profiles 
        SET is_active = false 
        WHERE id = $1 AND is_active = true
        RETURNING id
      `;

      const profileResult = await query(profileQueryText, [id]);
      const deleted = profileResult.rows.length > 0;
      
      if (deleted) {
        // Cascade delete related match results
        const matchResultsQueryText = `
          DELETE FROM match_results 
          WHERE profile_id_1 = $1 OR profile_id_2 = $1
        `;
        
        try {
          const matchResultsResult = await query(matchResultsQueryText, [id]);
          
          logger.info('DNA profile deleted with cascade', { 
            profileId: id,
            deletedMatchResults: matchResultsResult ? matchResultsResult.rowCount : 0
          });
        } catch (matchError) {
          // Log but don't fail if match results deletion fails
          logger.warn('Failed to delete match results during profile deletion', { 
            profileId: id,
            error: matchError.message 
          });
        }
      }
      
      return deleted;
    } catch (error) {
      logger.error('Error deleting DNA profile', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Bulk create profiles with duplicate detection
   * @param {Array} profilesData - Array of profile data
   * @param {string} userId - User ID
   * @param {string} fileSource - Source file name
   * @returns {Promise<Object>} Result with created profiles and duplicates info
   */
  static async bulkCreate(profilesData, userId, fileSource) {
    const results = {
      created: [],
      duplicates: [],
      errors: []
    };

    try {
      await transaction(async (client) => {
        for (let i = 0; i < profilesData.length; i++) {
          const profileData = profilesData[i];
          
          try {
            // Check for duplicates
            const duplicates = await this.findDuplicates(profileData.strData);
            const sampleNameDuplicates = await this.findBySampleName(
              profileData.sampleName, 
              userId
            );

            if (duplicates.length > 0) {
              results.duplicates.push({
                sampleName: profileData.sampleName,
                reason: 'identical_str_data',
                existingProfiles: duplicates.map(d => ({
                  id: d.id,
                  sampleName: d.sampleName,
                  uploadDate: d.uploadDate
                }))
              });
              continue;
            }

            if (sampleNameDuplicates.length > 0) {
              results.duplicates.push({
                sampleName: profileData.sampleName,
                reason: 'duplicate_sample_name',
                existingProfiles: sampleNameDuplicates.map(d => ({
                  id: d.id,
                  sampleName: d.sampleName,
                  uploadDate: d.uploadDate
                }))
              });
              continue;
            }

            // Create profile
            const profile = await this.create({
              userId,
              sampleName: profileData.sampleName,
              strData: profileData.strData,
              fileSource,
              notes: profileData.metadata ? JSON.stringify(profileData.metadata) : null
            });

            results.created.push(profile);

          } catch (error) {
            results.errors.push({
              sampleName: profileData.sampleName,
              error: error.message
            });
          }
        }
      });

      logger.info('Bulk profile creation completed', {
        userId,
        fileSource,
        created: results.created.length,
        duplicates: results.duplicates.length,
        errors: results.errors.length
      });

      return results;
    } catch (error) {
      logger.error('Error in bulk profile creation', { error: error.message, userId, fileSource });
      throw error;
    }
  }

  /**
   * Optimized batch insert for multiple profiles (no duplicate checking)
   * Use this when duplicates have already been checked
   * @param {Array} profilesData - Array of profile data objects
   * @param {string} userId - User ID
   * @param {string} fileSource - File source
   * @returns {Promise<Array>} Array of created profiles
   */
  static async batchInsert(profilesData, userId, fileSource) {
    if (!profilesData || profilesData.length === 0) {
      return [];
    }

    try {
      // Build VALUES clause for batch insert
      const values = [];
      const params = [];
      let paramIndex = 1;

      for (const profileData of profilesData) {
        const { year, sampleName, internalNumber, importNumber, strData, taskId, notes } = profileData;

        // Validate required fields
        if (!year) {
          throw new Error(`Year is required for profile: ${sampleName}`);
        }

        this.validateSTRData(strData);

        // Add parameters
        params.push(
          userId,                                                    // $1, $8, $15...
          year,                                                      // $2, $9, $16...
          sampleName,                                                // $3, $10, $17...
          internalNumber || null,                                    // $4, $11, $18...
          importNumber || null,                                      // $5, $12, $19...
          JSON.stringify(strData),                                   // $6, $13, $20...
          fileSource ? String(fileSource) : null,                    // $7, $14, $21...
          notes ? (typeof notes === 'object' ? JSON.stringify(notes) : String(notes)) : null, // $8, $15, $22...
          taskId || null,                                            // $9, $16, $23...
          'user'                                                     // $10, $17, $24... (profile_type)
        );

        // Build VALUES clause
        const valueClause = `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9})`;
        values.push(valueClause);
        paramIndex += 10;
      }

      const queryText = `
        INSERT INTO dna_profiles (
          user_id, year, sample_name, internal_number, import_number, 
          str_data, file_source, notes, task_id, profile_type
        )
        VALUES ${values.join(', ')}
        RETURNING *
      `;

      const result = await query(queryText, params);

      logger.info('Batch insert completed', {
        userId,
        fileSource,
        insertedCount: result.rows.length,
        profileCount: profilesData.length
      });

      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error in batch insert', {
        error: error.message,
        userId,
        profileCount: profilesData.length
      });
      throw error;
    }
  }

  /**
   * Validate STR data structure
   * @param {Object} strData - STR data to validate
   * @throws {Error} If validation fails
   */
  static validateSTRData(strData) {
    if (!strData || typeof strData !== 'object') {
      throw new Error('STR data must be an object');
    }

    const providedLoci = Object.keys(strData);
    
    // Backward compatibility: Accept profiles with fewer loci
    // Minimum of 3 loci required for basic functionality
    if (providedLoci.length < 3) {
      throw new Error(`STR data must contain at least 3 loci, found ${providedLoci.length}`);
    }

    // Validate that provided loci are valid
    for (const locus of providedLoci) {
      const normalizedLocus = locus.trim();
      const isSupported = ALL_LOCI.some(supportedLocus => 
        supportedLocus.toLowerCase() === normalizedLocus.toLowerCase()
      );
      
      if (!isSupported) {
        console.log(`Unknown locus: "${locus}" (normalized: "${normalizedLocus}")`);
        console.log('Available loci sample:', ALL_LOCI.slice(0, 20));
        throw new Error(`Unknown STR locus: ${locus} `);
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
   * Find profiles by master array ID
   * @param {string} masterArrayId - Master array ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit results
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Array<DNAProfile>>} Array of profiles
   */
  static async findByMasterArrayId(masterArrayId, options = {}) {
    const { limit = 100, offset = 0 } = options;
    
    const queryText = `
      SELECT dp.* FROM dna_profiles dp
      WHERE dp.master_array_id = $1 AND dp.profile_type = 'master' AND dp.is_active = true
      ORDER BY dp.upload_date DESC
      LIMIT $2 OFFSET $3
    `;

    try {
      const result = await query(queryText, [masterArrayId, limit, offset]);
      return result.rows.map(row => new DNAProfile(row));
    } catch (error) {
      logger.error('Error finding DNA profiles by master array ID', { error: error.message, masterArrayId });
      throw error;
    }
  }

  /**
   * Find user profiles with department access validation
   * @param {string} userId - User ID
   * @param {string} requestingUserId - ID of user making the request
   * @param {Object} options - Query options
   * @returns {Promise<Array<DNAProfile>>} Array of profiles (empty if no access)
   */
  static async findByUserIdWithAccess(userId, requestingUserId, options = {}) {
    if (!requestingUserId) {
      throw new Error('Requesting user ID is required');
    }

    try {
      // Check if requesting user has access to target user's profiles
      const hasAccess = await this.validateUserProfileAccess(requestingUserId, userId);
      if (!hasAccess) {
        return [];
      }

      return await this.findByUserId(userId, options);
    } catch (error) {
      logger.error('Error finding profiles with access validation', { 
        error: error.message, 
        userId, 
        requestingUserId 
      });
      throw error;
    }
  }

  /**
   * Get profiles accessible to user (own profiles + department master array profiles)
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @param {boolean} options.includeMasterArray - Include department master array profiles
   * @param {number} options.limit - Limit results
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Object>} Object with user profiles and master array profiles
   */
  static async getAccessibleProfiles(userId, options = {}) {
    const { includeMasterArray = true, limit = 100, offset = 0 } = options;

    try {
      // Get user's own profiles
      const userProfiles = await this.findByUserId(userId, { limit, offset, profileType: 'user' });

      let masterArrayProfiles = [];
      let departmentInfo = null;

      if (includeMasterArray) {
        // Get user's department and master array profiles
        const departmentResult = await query(`
          SELECT 
            u.department_id,
            d.name as department_name,
            d.master_array_id,
            ma.name as master_array_name
          FROM users u
          LEFT JOIN departments d ON u.department_id = d.id
          LEFT JOIN master_arrays ma ON d.master_array_id = ma.id
          WHERE u.id = $1 AND u.is_active = true
        `, [userId]);

        if (departmentResult.rows.length > 0 && departmentResult.rows[0].master_array_id) {
          const dept = departmentResult.rows[0];
          departmentInfo = {
            department_id: dept.department_id,
            department_name: dept.department_name,
            master_array_id: dept.master_array_id,
            master_array_name: dept.master_array_name
          };

          // Get master array profiles using the master_array_profiles table
          const masterArrayResult = await query(`
            SELECT 
              map.id,
              map.sample_name,
              map.str_data,
              map.metadata,
              map.created_at as upload_date,
              map.created_by as user_id,
              'master_array' as file_source,
              map.master_array_id,
              'master' as profile_type,
              true as is_active,
              u.username as created_by_username
            FROM master_array_profiles map
            JOIN users u ON map.created_by = u.id
            WHERE map.master_array_id = $1 AND map.is_active = true
            ORDER BY map.created_at DESC
            LIMIT $2 OFFSET $3
          `, [dept.master_array_id, limit, offset]);

          masterArrayProfiles = masterArrayResult.rows.map(row => new DNAProfile(row));
        }
      }

      return {
        userProfiles,
        masterArrayProfiles,
        departmentInfo,
        summary: {
          userProfileCount: userProfiles.length,
          masterArrayProfileCount: masterArrayProfiles.length,
          totalAccessibleProfiles: userProfiles.length + masterArrayProfiles.length
        }
      };
    } catch (error) {
      logger.error('Error getting accessible profiles', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Validate if requesting user can access target user's profiles
   * @param {string} requestingUserId - ID of user making the request
   * @param {string} targetUserId - ID of user whose profiles are being accessed
   * @returns {Promise<boolean>} True if access is allowed
   */
  static async validateUserProfileAccess(requestingUserId, targetUserId) {
    if (requestingUserId === targetUserId) {
      return true; // Users can always access their own profiles
    }

    try {
      const result = await query(`
        SELECT 
          requesting.id as requesting_id,
          requesting.role as requesting_role,
          requesting.department_id as requesting_dept,
          requesting.organization_id as requesting_org,
          target.id as target_id,
          target.department_id as target_dept,
          target.organization_id as target_org
        FROM users requesting, users target
        WHERE requesting.id = $1 AND target.id = $2 
        AND requesting.is_active = true AND target.is_active = true
      `, [requestingUserId, targetUserId]);

      if (result.rows.length === 0) {
        return false;
      }

      const { requesting_role, requesting_dept, requesting_org, target_dept, target_org } = result.rows[0];

      // System administrators can access any profiles
      if (requesting_role === 'system_administrator') {
        return true;
      }

      // Department heads can access profiles within their department
      if (requesting_role === 'department_head' && requesting_dept === target_dept) {
        return true;
      }

      // Users in the same department can access each other's profiles
      if (requesting_dept === target_dept && requesting_org === target_org) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error validating user profile access', { 
        error: error.message, 
        requestingUserId, 
        targetUserId 
      });
      return false;
    }
  }

  /**
   * Check if profile is a master array profile
   * @returns {boolean} True if profile is a master array profile
   */
  isMasterProfile() {
    return this.profileType === 'master' && this.masterArrayId !== null;
  }

  /**
   * Check if profile is a user profile
   * @returns {boolean} True if profile is a user profile
   */
  isUserProfile() {
    return this.profileType === 'user' && this.masterArrayId === null;
  }

  /**
   * Get department isolation info for this profile
   * @returns {Promise<Object|null>} Department info or null
   */
  async getDepartmentInfo() {
    if (!this.userId) {
      return null;
    }

    try {
      const result = await query(`
        SELECT 
          u.department_id,
          u.organization_id,
          d.name as department_name,
          o.name as organization_name
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN organizations o ON u.organization_id = o.id
        WHERE u.id = $1 AND u.is_active = true
      `, [this.userId]);

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting department info for profile', { 
        error: error.message, 
        profileId: this.id,
        userId: this.userId 
      });
      return null;
    }
  }

  /**
   * Validate department isolation for profile access
   * @param {string} requestingUserId - ID of user requesting access
   * @returns {Promise<boolean>} True if access is allowed
   */
  async validateDepartmentIsolation(requestingUserId) {
    if (!requestingUserId) {
      return false;
    }

    try {
      // For master array profiles, check master array access
      if (this.isMasterProfile()) {
        const masterArrayResult = await query(`
          SELECT ma.department_id
          FROM master_arrays ma
          WHERE ma.id = $1 AND ma.is_active = true
        `, [this.masterArrayId]);

        if (masterArrayResult.rows.length === 0) {
          return false;
        }

        const departmentId = masterArrayResult.rows[0].department_id;
        return await this.validateUserDepartmentAccess(requestingUserId, departmentId);
      }

      // For user profiles, validate access to the profile owner
      return await DNAProfile.validateUserProfileAccess(requestingUserId, this.userId);
    } catch (error) {
      logger.error('Error validating department isolation', { 
        error: error.message, 
        profileId: this.id,
        requestingUserId 
      });
      return false;
    }
  }

  /**
   * Validate user access to specific department
   * @param {string} userId - User ID
   * @param {string} departmentId - Department ID
   * @returns {Promise<boolean>} True if user has access to department
   */
  async validateUserDepartmentAccess(userId, departmentId) {
    try {
      const result = await query(`
        SELECT u.role, u.department_id
        FROM users u
        WHERE u.id = $1 AND u.is_active = true
      `, [userId]);

      if (result.rows.length === 0) {
        return false;
      }

      const user = result.rows[0];

      // System administrators can access any department
      if (user.role === 'system_administrator') {
        return true;
      }

      // Users can access their own department
      return user.department_id === departmentId;
    } catch (error) {
      logger.error('Error validating user department access', { 
        error: error.message, 
        userId,
        departmentId 
      });
      return false;
    }
  }

  /**
   * Convert profile to JSON
   * @returns {Object} Profile as plain object
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      sampleName: this.sampleName,
      internalNumber: this.internalNumber, // Add internal number to JSON output
      strData: this.strData,
      uploadDate: this.uploadDate,
      fileSource: this.fileSource,
      notes: this.notes,
      isActive: this.isActive,
      masterArrayId: this.masterArrayId,
      profileType: this.profileType
    };
  }
}

module.exports = DNAProfile;