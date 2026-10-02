/**
 * Модель популяционных частот
 * 
 * Этот класс управляет популяционными частотами аллелей
 * с кэшированием, валидацией и обработкой отсутствующих данных.
 */

const { logger } = require('../../../utils/logger');
const { query } = require('../../../config/database');

class PopulationFrequencies {
    constructor(populationId = 'default') {
        this.populationId = populationId;
        this.cache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 минут
        this.defaultFrequency = 0.001; // Консервативная оценка для отсутствующих аллелей
        this.minFrequency = 0.0001; // Минимальная частота
        this.maxFrequency = 0.9999; // Максимальная частота
        
        logger.debug(`Создан менеджер популяционных частот для популяции: ${populationId}`);
    }

    /**
     * Получение частоты аллеля
     */
    async getFrequency(locus, allele) {
        try {
            // Валидация входных параметров
            this.validateInputs(locus, allele);
            
            // Проверка кэша
            const cacheKey = `${locus}:${allele}`;
            const cached = this.getCachedFrequency(cacheKey);
            if (cached !== null) {
                return cached;
            }

            // Загрузка из базы данных
            const frequency = await this.loadFrequencyFromDatabase(locus, allele);
            
            // Кэширование результата
            this.setCachedFrequency(cacheKey, frequency);
            
            return frequency;

        } catch (error) {
            logger.error(`Ошибка получения частоты для ${locus}:${allele}: ${error.message}`);
            
            // Возвращаем консервативную оценку при ошибке
            return this.getConservativeFrequency(locus, allele);
        }
    }

    /**
     * Получение всех частот для локуса
     */
    async getAlleleFrequencies(locus) {
        try {
            this.validateLocus(locus);
            
            // Проверка кэша для всего локуса
            const cacheKey = `locus:${locus}`;
            const cached = this.getCachedFrequency(cacheKey);
            if (cached !== null) {
                return new Map(Object.entries(cached));
            }

            // Загрузка всех частот для локуса
            const frequencies = await this.loadAllFrequenciesForLocus(locus);
            
            // Кэширование
            const frequencyObject = Object.fromEntries(frequencies);
            this.setCachedFrequency(cacheKey, frequencyObject);
            
            return frequencies;

        } catch (error) {
            logger.error(`Ошибка получения частот для локуса ${locus}: ${error.message}`);
            return new Map();
        }
    }

    /**
     * Проверка доступности частоты
     */
    async isFrequencyAvailable(locus, allele) {
        try {
            const frequency = await this.getFrequency(locus, allele);
            return frequency > this.defaultFrequency;
        } catch (error) {
            return false;
        }
    }

    /**
     * Загрузка частоты из базы данных
     */
    async loadFrequencyFromDatabase(locus, allele) {
        const result = await query(`
            SELECT frequency 
            FROM population_frequencies 
            WHERE population_id = $1 
            AND locus_name = $2 
            AND allele_value = $3
        `, [this.populationId, locus, allele]);

        if (result.rows.length > 0) {
            const frequency = parseFloat(result.rows[0].frequency);
            return this.validateFrequency(frequency);
        }

        // Если частота не найдена, пытаемся найти похожие аллели
        const similarFrequency = await this.findSimilarAlleleFrequency(locus, allele);
        if (similarFrequency > 0) {
            logger.info(`Использована частота похожего аллеля для ${locus}:${allele}: ${similarFrequency}`);
            return similarFrequency;
        }

        // Возвращаем консервативную оценку
        logger.warn(`Частота не найдена для ${locus}:${allele}, используется консервативная оценка`);
        return this.getConservativeFrequency(locus, allele);
    }

    /**
     * Загрузка всех частот для локуса
     */
    async loadAllFrequenciesForLocus(locus) {
        const result = await query(`
            SELECT allele_value, frequency 
            FROM population_frequencies 
            WHERE population_id = $1 
            AND locus_name = $2
            ORDER BY frequency DESC
        `, [this.populationId, locus]);

        const frequencies = new Map();
        for (const row of result.rows) {
            const frequency = this.validateFrequency(parseFloat(row.frequency));
            frequencies.set(row.allele_value, frequency);
        }

        return frequencies;
    }

    /**
     * Поиск частоты похожего аллеля
     */
    async findSimilarAlleleFrequency(locus, allele) {
        try {
            // Попытка найти базовый аллель (без микровариантов)
            const baseAllele = this.getBaseAllele(allele);
            if (baseAllele !== allele) {
                const baseFrequency = await this.loadFrequencyFromDatabase(locus, baseAllele);
                if (baseFrequency > this.defaultFrequency) {
                    // Применяем штраф за микровариант
                    return baseFrequency * 0.1;
                }
            }

            // Поиск ближайших числовых аллелей
            const numericValue = this.extractNumericValue(allele);
            if (numericValue !== null) {
                const nearbyFrequency = await this.findNearbyNumericAlleleFrequency(locus, numericValue);
                if (nearbyFrequency > 0) {
                    return nearbyFrequency * 0.5; // Штраф за неточное совпадение
                }
            }

            return 0;

        } catch (error) {
            logger.warn(`Ошибка поиска похожего аллеля для ${locus}:${allele}: ${error.message}`);
            return 0;
        }
    }

    /**
     * Поиск частоты ближайшего числового аллеля
     */
    async findNearbyNumericAlleleFrequency(locus, targetValue) {
        const result = await query(`
            SELECT allele_value, frequency 
            FROM population_frequencies 
            WHERE population_id = $1 
            AND locus_name = $2
            AND allele_value ~ '^[0-9]+(\\.[0-9]+)?$'
            ORDER BY ABS(CAST(allele_value AS NUMERIC) - $3)
            LIMIT 1
        `, [this.populationId, locus, targetValue]);

        if (result.rows.length > 0) {
            return this.validateFrequency(parseFloat(result.rows[0].frequency));
        }

        return 0;
    }

    /**
     * Получение базового аллеля (без микровариантов и модификаторов)
     */
    getBaseAllele(allele) {
        // Специальные случаи для половых хромосом
        if (allele === 'X' || allele === 'Y') {
            return allele;
        }
        
        // Удаляем микроварианты (.1, .2, .3)
        let base = allele.replace(/\.\d+$/, '');
        
        // Удаляем буквенные модификаторы (A, B, C), но не X, Y
        // Только если есть числовая часть (включая десятичные) перед буквой
        base = base.replace(/^(\d+(?:\.\d+)?)[A-WZ]$/, '$1');
        
        return base;
    }

    /**
     * Извлечение числового значения из аллеля
     */
    extractNumericValue(allele) {
        const match = allele.match(/^(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
    }

    /**
     * Получение консервативной частоты
     */
    getConservativeFrequency(locus, allele) {
        // Более консервативная оценка для редких аллелей
        if (this.isRareAllele(allele)) {
            return this.minFrequency;
        }
        
        return this.defaultFrequency;
    }

    /**
     * Проверка является ли аллель редким
     */
    isRareAllele(allele) {
        // Микроварианты считаются редкими
        if (allele.includes('.')) {
            return true;
        }
        
        // Сложные аллели считаются редкими
        if (allele.includes('_')) {
            return true;
        }
        
        // Очень большие или маленькие числовые значения
        const numValue = this.extractNumericValue(allele);
        if (numValue !== null) {
            return numValue < 6 || numValue > 30;
        }
        
        return false;
    }

    /**
     * Валидация частоты
     */
    validateFrequency(frequency) {
        if (isNaN(frequency) || frequency < 0) {
            return this.defaultFrequency;
        }
        
        // Ограничиваем диапазон
        return Math.max(this.minFrequency, Math.min(this.maxFrequency, frequency));
    }

    /**
     * Валидация входных параметров
     */
    validateInputs(locus, allele) {
        if (!locus || typeof locus !== 'string') {
            throw new Error('Название локуса должно быть непустой строкой');
        }
        
        if (!allele || typeof allele !== 'string') {
            throw new Error('Значение аллеля должно быть непустой строкой');
        }
    }

    /**
     * Валидация локуса
     */
    validateLocus(locus) {
        if (!locus || typeof locus !== 'string') {
            throw new Error('Название локуса должно быть непустой строкой');
        }
    }

    /**
     * Получение кэшированной частоты
     */
    getCachedFrequency(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.value;
        }
        
        // Удаляем устаревшие записи
        if (cached) {
            this.cache.delete(key);
        }
        
        return null;
    }

    /**
     * Кэширование частоты
     */
    setCachedFrequency(key, value) {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    /**
     * Очистка кэша
     */
    clearCache() {
        this.cache.clear();
        logger.debug('Кэш популяционных частот очищен');
    }

    /**
     * Получение статистики кэша
     */
    getCacheStats() {
        const now = Date.now();
        let validEntries = 0;
        let expiredEntries = 0;
        
        for (const [key, entry] of this.cache) {
            if ((now - entry.timestamp) < this.cacheTimeout) {
                validEntries++;
            } else {
                expiredEntries++;
            }
        }
        
        return {
            totalEntries: this.cache.size,
            validEntries,
            expiredEntries,
            hitRate: this.hitRate || 0
        };
    }

    /**
     * Предварительная загрузка частот для локусов
     */
    async preloadFrequencies(loci) {
        logger.info(`Предварительная загрузка частот для ${loci.length} локусов`);
        
        const promises = loci.map(locus => 
            this.getAlleleFrequencies(locus).catch(error => {
                logger.warn(`Ошибка предзагрузки для локуса ${locus}: ${error.message}`);
                return new Map();
            })
        );
        
        await Promise.all(promises);
        logger.info('Предварительная загрузка завершена');
    }

    /**
     * Получение списка доступных популяций
     */
    async getAvailablePopulations() {
        try {
            const result = await query(`
                SELECT DISTINCT population_id, population_name, description
                FROM population_metadata
                ORDER BY population_name
            `);
            
            return result.rows.map(row => ({
                id: row.population_id,
                name: row.population_name,
                description: row.description
            }));
            
        } catch (error) {
            logger.error(`Ошибка получения списка популяций: ${error.message}`);
            return [];
        }
    }

    /**
     * Получение метаданных популяции
     */
    async getPopulationMetadata() {
        try {
            const result = await query(`
                SELECT population_name, description, sample_size, 
                       creation_date, last_updated, source
                FROM population_metadata
                WHERE population_id = $1
            `, [this.populationId]);
            
            if (result.rows.length > 0) {
                return result.rows[0];
            }
            
            return null;
            
        } catch (error) {
            logger.error(`Ошибка получения метаданных популяции ${this.populationId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Валидация популяционных данных
     */
    async validatePopulationData() {
        try {
            const issues = [];
            
            // Проверка суммы частот для каждого локуса
            const result = await query(`
                SELECT locus_name, SUM(frequency) as total_frequency
                FROM population_frequencies
                WHERE population_id = $1
                GROUP BY locus_name
                HAVING SUM(frequency) < 0.95 OR SUM(frequency) > 1.05
            `, [this.populationId]);
            
            for (const row of result.rows) {
                issues.push({
                    type: 'frequency_sum',
                    locus: row.locus_name,
                    totalFrequency: parseFloat(row.total_frequency),
                    message: `Сумма частот для локуса ${row.locus_name}: ${row.total_frequency}`
                });
            }
            
            // Проверка на дублирующиеся аллели
            const duplicates = await query(`
                SELECT locus_name, allele_value, COUNT(*) as count
                FROM population_frequencies
                WHERE population_id = $1
                GROUP BY locus_name, allele_value
                HAVING COUNT(*) > 1
            `, [this.populationId]);
            
            for (const row of duplicates.rows) {
                issues.push({
                    type: 'duplicate_allele',
                    locus: row.locus_name,
                    allele: row.allele_value,
                    count: parseInt(row.count),
                    message: `Дублирующийся аллель ${row.allele_value} в локусе ${row.locus_name}`
                });
            }
            
            return {
                isValid: issues.length === 0,
                issues
            };
            
        } catch (error) {
            logger.error(`Ошибка валидации популяционных данных: ${error.message}`);
            return {
                isValid: false,
                issues: [{ type: 'validation_error', message: error.message }]
            };
        }
    }

    /**
     * Экспорт популяционных данных
     */
    async exportPopulationData() {
        try {
            const result = await query(`
                SELECT locus_name, allele_value, frequency
                FROM population_frequencies
                WHERE population_id = $1
                ORDER BY locus_name, frequency DESC
            `, [this.populationId]);
            
            const data = {
                populationId: this.populationId,
                metadata: await this.getPopulationMetadata(),
                frequencies: result.rows,
                exportDate: new Date().toISOString()
            };
            
            return data;
            
        } catch (error) {
            logger.error(`Ошибка экспорта популяционных данных: ${error.message}`);
            throw error;
        }
    }

    /**
     * Строковое представление
     */
    toString() {
        return `PopulationFrequencies(population=${this.populationId}, cache=${this.cache.size} entries)`;
    }
}

module.exports = PopulationFrequencies;