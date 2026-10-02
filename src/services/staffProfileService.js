/**
 * Сервис для работы с профилями сотрудников
 */

const XLSX = require('xlsx');
const { logger } = require('../utils/logger');

// Фиксированный порядок локусов (38 штук)
const LOCI_ORDER = [
  'D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'Yindel', 'AMEL',
  'D8S1179', 'D21S11', 'D18S51', 'DYS391', 'D2S441', 'D19S433',
  'TH01', 'FGA', 'D22S1045', 'D5S818', 'D13S317', 'D7S820', 'SE33',
  'D10S1248', 'D1S1656', 'D12S391', 'D2S1338', 'D6S477', 'D6S1043',
  'D15S659', 'DXS6795', 'Penta E', 'D19S253', 'Penta D', 'D8S1132',
  'D3S3045', 'D10S1435', 'D4S2366', 'rs759551978', 'rs771783753',
  'rs199815934'
];

class StaffProfileService {
  constructor(pool) {
    this.pool = pool;
  }

  async parseExcelFile(buffer, filename) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (data.length < 2) {
        throw new Error('Файл не содержит данных');
      }

      const headers = data[0];
      const sampleNameIndex = headers.findIndex(h => 
        h && h.toString().toLowerCase().includes('sample')
      );
      
      if (sampleNameIndex === -1) {
        throw new Error('Не найден столбец "Sample Name" в файле');
      }

      // Создаем Map для регистронезависимого поиска локусов
      const lociMap = new Map();
      LOCI_ORDER.forEach(locus => {
        lociMap.set(locus.toUpperCase(), locus);
      });

      const profiles = [];
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0 || !row[sampleNameIndex]) continue;

        const fullName = row[sampleNameIndex].toString().trim();
        if (!fullName) continue;

        const loci = {};
        
        for (let j = 0; j < headers.length; j++) {
          const locusName = headers[j];
          if (j === sampleNameIndex || !locusName) continue;

          const locusNameStr = locusName.toString().trim();
          const locusNameUpper = locusNameStr.toUpperCase();
          
          // Регистронезависимый поиск локуса
          const correctLocusName = lociMap.get(locusNameUpper);
          if (!correctLocusName) continue;

          const cellValue = row[j];
          if (cellValue === undefined || cellValue === null || cellValue === '') continue;

          const valueStr = cellValue.toString().trim();
          if (!valueStr || valueStr === '0' || valueStr === '-') continue;

          const alleles = valueStr.split(/[,\s]+/).filter(a => a && a !== '0');
          if (alleles.length === 0) continue;

          // Сохраняем в новом формате - массив аллелей
          loci[correctLocusName] = alleles.length === 1 ? [alleles[0]] : [alleles[0], alleles[1]];
        }

        if (Object.keys(loci).length > 0) {
          profiles.push({ fullName, loci });
        }
      }

      if (profiles.length === 0) {
        throw new Error('В файле не найдено ни одного валидного профиля');
      }

      logger.info('Excel файл успешно распарсен', { filename, profilesCount: profiles.length });
      return profiles;
    } catch (error) {
      logger.error('Ошибка парсинга Excel файла', { filename, error: error.message });
      throw error;
    }
  }

  async createProfiles(profiles, createdBy) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const result = {
        summary: { total: profiles.length, created: 0, failed: 0 },
        errors: []
      };

      // Создаем Map для отслеживания дубликатов ФИО
      const nameCounters = new Map();

      for (const profile of profiles) {
        try {
          let staffId = profile.fullName
            .replace(/[^а-яА-ЯёЁa-zA-Z0-9]/g, '_')
            .toLowerCase()
            .substring(0, 50);

          // Если такое ФИО уже встречалось, добавляем счетчик
          if (nameCounters.has(profile.fullName)) {
            const counter = nameCounters.get(profile.fullName) + 1;
            nameCounters.set(profile.fullName, counter);
            staffId = `${staffId}_${counter}`;
          } else {
            nameCounters.set(profile.fullName, 1);
          }

          await client.query(
            `INSERT INTO staff_profiles (staff_id, full_name, str_data, created_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (staff_id) DO UPDATE 
             SET str_data = EXCLUDED.str_data,
                 last_updated = CURRENT_TIMESTAMP`,
            [staffId, profile.fullName, JSON.stringify(profile.loci), createdBy]
          );
          
          result.summary.created++;
        } catch (error) {
          result.summary.failed++;
          result.errors.push({ fullName: profile.fullName, error: error.message });
          logger.error('Ошибка создания профиля сотрудника', { fullName: profile.fullName, error: error.message });
        }
      }

      await client.query('COMMIT');
      logger.info('Профили сотрудников созданы', result.summary);
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Ошибка транзакции создания профилей', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  async getAllProfiles() {
    try {
      const result = await this.pool.query(
        `SELECT id, full_name, date_added, last_updated, is_active
         FROM staff_profiles
         WHERE is_active = true
         ORDER BY full_name ASC`
      );
      return result.rows;
    } catch (error) {
      logger.error('Ошибка получения профилей сотрудников', { error: error.message });
      throw error;
    }
  }

  async getProfileById(profileId) {
    try {
      const result = await this.pool.query(
        `SELECT id, full_name, str_data, date_added, last_updated, is_active
         FROM staff_profiles
         WHERE id = $1 AND is_active = true`,
        [profileId]
      );

      if (result.rows.length === 0) {
        const error = new Error('Профиль сотрудника не найден');
        error.code = 'DATABASE_ERROR';
        throw error;
      }

      const profile = result.rows[0];
      return {
        id: profile.id,
        full_name: profile.full_name,
        loci: profile.str_data,
        date_added: profile.date_added,
        last_updated: profile.last_updated
      };
    } catch (error) {
      logger.error('Ошибка получения профиля сотрудника', { profileId, error: error.message });
      throw error;
    }
  }

  async deleteProfile(profileId) {
    try {
      const result = await this.pool.query(
        `UPDATE staff_profiles
         SET is_active = false, last_updated = CURRENT_TIMESTAMP
         WHERE id = $1 AND is_active = true
         RETURNING id, full_name`,
        [profileId]
      );

      if (result.rows.length === 0) {
        const error = new Error('Профиль сотрудника не найден');
        error.code = 'DATABASE_ERROR';
        throw error;
      }

      logger.info('Профиль сотрудника удален', { profileId, fullName: result.rows[0].full_name });
      return { success: true, profile: result.rows[0] };
    } catch (error) {
      logger.error('Ошибка удаления профиля сотрудника', { profileId, error: error.message });
      throw error;
    }
  }
}

module.exports = StaffProfileService;
