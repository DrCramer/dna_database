/**
 * Модель генетического образца
 * 
 * Этот класс представляет генетический образец с полной валидацией данных
 * и методами для работы с генетической информацией.
 */

const { ValidationUtils, Classifications } = require('../types');
const { logger } = require('../../../utils/logger');

class GeneticSample {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.collectionDate = data.collectionDate ? new Date(data.collectionDate) : new Date();
        this.loci = new Map();
        this.metadata = data.metadata || {};
        this.str_data = data.str_data || {};
        
        // Валидация при создании
        this.validate();
        
        // Преобразование данных локусов
        this.initializeLoci(data);
        
        logger.debug(`Создан генетический образец: ${this.id}`);
    }

    /**
     * Валидация основных данных образца
     */
    validate() {
        if (!this.id || typeof this.id !== 'string' || this.id.trim() === '') {
            throw new Error('ID образца обязателен и должен быть непустой строкой');
        }
        
        // Проверка на валидные символы в ID (только буквы, цифры, дефисы и подчеркивания)
        if (!/^[A-Za-z0-9_-]+$/.test(this.id.trim())) {
            throw new Error('ID образца должен содержать только буквы, цифры, дефисы и подчеркивания');
        }
        
        if (!this.name || typeof this.name !== 'string' || this.name.trim() === '') {
            throw new Error('Название образца обязательно и должно быть непустой строкой');
        }
        
        if (!this.str_data && (!this.loci || this.loci.size === 0)) {
            // Разрешаем создание пустого образца, который будет заполнен позже
            logger.warn('Создан образец без генетических данных');
        }
        
        if (this.collectionDate > new Date()) {
            throw new Error('Дата сбора не может быть в будущем');
        }
    }

    /**
     * Инициализация данных локусов
     */
    initializeLoci(data) {
        // Если есть готовые данные локусов
        if (data.loci) {
            if (data.loci instanceof Map) {
                this.loci = data.loci;
            } else {
                // Преобразование объекта в Map
                for (const [locusName, locusData] of Object.entries(data.loci)) {
                    this.addLocus(locusName, locusData);
                }
            }
        }
        
        // Преобразование из str_data если loci пустые
        if (this.loci.size === 0 && this.str_data) {
            this.convertStrDataToLoci();
        }
    }

    /**
     * Добавление локуса с валидацией
     */
    addLocus(locusName, locusData) {
        try {
            // Создаем объект LocusData если передан обычный объект
            let validatedLocus;
            if (locusData instanceof require('./LocusData')) {
                validatedLocus = locusData;
            } else {
                const LocusData = require('./LocusData');
                validatedLocus = new LocusData(
                    locusName,
                    locusData.allele1 || locusData.a1,
                    locusData.allele2 || locusData.a2,
                    locusData
                );
            }
            
            this.loci.set(locusName, validatedLocus);
            
            // Синхронизация с str_data для обратной совместимости
            this.str_data[locusName] = {
                allele1: validatedLocus.allele1,
                allele2: validatedLocus.allele2,
                a1: validatedLocus.allele1, // Альтернативное название
                a2: validatedLocus.allele2
            };
            
        } catch (error) {
            logger.warn(`Ошибка при добавлении локуса ${locusName}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Валидация данных локуса
     */
    validateLocusData(locusName, locusData) {
        if (!locusName || typeof locusName !== 'string') {
            throw new Error('Название локуса должно быть непустой строкой');
        }
        
        if (!locusData || typeof locusData !== 'object') {
            throw new Error('Данные локуса должны быть объектом');
        }

        // Нормализация аллелей
        const allele1 = this.normalizeAllele(locusData.allele1 || locusData.a1);
        const allele2 = this.normalizeAllele(locusData.allele2 || locusData.a2);
        
        // Определение статуса
        const status = this.determineLocusStatus(allele1, allele2, locusData.status);
        
        // Валидация качества
        const quality = this.validateQuality(locusData.quality);

        return {
            locusName,
            allele1,
            allele2,
            status,
            quality,
            originalData: locusData // Сохраняем оригинальные данные
        };
    }

    /**
     * Нормализация аллеля
     */
    normalizeAllele(allele) {
        if (!allele) return '0';
        
        // Преобразование в строку и очистка
        let normalized = String(allele).trim();
        
        // Обработка специальных случаев
        if (normalized === '' || normalized === 'null' || normalized === 'undefined') {
            return '0';
        }
        
        // Проверка на валидные символы (цифры, точки, буквы)
        if (!/^[0-9A-Za-z.,-]+$/.test(normalized)) {
            logger.warn(`Подозрительный аллель: ${normalized}`);
        }
        
        return normalized;
    }

    /**
     * Определение статуса локуса
     */
    determineLocusStatus(allele1, allele2, providedStatus) {
        if (providedStatus) {
            const validStatuses = ['определено', 'не определено', 'частично определено'];
            if (validStatuses.includes(providedStatus)) {
                return providedStatus;
            }
        }
        
        // Автоматическое определение статуса
        if (allele1 && allele2 && allele1 !== '0' && allele2 !== '0') {
            return 'определено';
        } else if (allele1 === '0' && allele2 === '0') {
            return 'не определено';
        } else {
            return 'частично определено';
        }
    }

    /**
     * Валидация качества
     */
    validateQuality(quality) {
        if (quality === undefined || quality === null) {
            return 1.0; // Значение по умолчанию
        }
        
        const numQuality = parseFloat(quality);
        if (isNaN(numQuality)) {
            return 1.0;
        }
        
        // Ограничение диапазона 0-1
        return Math.max(0, Math.min(1, numQuality));
    }

    /**
     * Преобразование str_data в локусы
     */
    convertStrDataToLoci() {
        if (!this.str_data) return;
        
        for (const [locusName, locusData] of Object.entries(this.str_data)) {
            if (locusData && typeof locusData === 'object') {
                try {
                    this.addLocus(locusName, locusData);
                } catch (error) {
                    logger.warn(`Пропуск некорректного локуса ${locusName}: ${error.message}`);
                    // Не добавляем некорректные локусы
                }
            }
        }
    }

    /**
     * Получение локуса по имени
     */
    getLocus(locusName) {
        return this.loci.get(locusName);
    }

    /**
     * Проверка наличия локуса
     */
    hasLocus(locusName) {
        return this.loci.has(locusName);
    }

    /**
     * Получение всех проанализированных локусов
     */
    getAnalyzedLoci() {
        const analyzed = new Map();
        for (const [name, locus] of this.loci) {
            if (locus.status === 'определено') {
                analyzed.set(name, locus);
            }
        }
        return analyzed;
    }

    /**
     * Получение количества проанализированных локусов
     */
    getAnalyzedLociCount() {
        return this.getAnalyzedLoci().size;
    }

    /**
     * Получение всех названий локусов
     */
    getLocusNames() {
        return Array.from(this.loci.keys());
    }

    /**
     * Проверка является ли локус гетерозиготным
     */
    isLocusHeterozygous(locusName) {
        const locus = this.getLocus(locusName);
        if (!locus) {
            return false;
        }
        
        // Если это объект LocusData, используем его метод
        if (typeof locus.isHeterozygous === 'function') {
            return locus.isHeterozygous();
        }
        
        // Иначе проверяем напрямую
        if (locus.status !== 'определено') {
            return false;
        }
        return locus.allele1 !== locus.allele2;
    }

    /**
     * Подсчет гетерозиготных локусов
     */
    countHeterozygousLoci() {
        let count = 0;
        for (const locusName of this.getLocusNames()) {
            if (this.isLocusHeterozygous(locusName)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Проверка совместимости с другим образцом для сравнения
     */
    isCompatibleWith(otherSample) {
        if (!(otherSample instanceof GeneticSample)) {
            return false;
        }
        
        // Проверка наличия общих локусов
        const commonLoci = this.getCommonLoci(otherSample);
        return commonLoci.length > 0;
    }

    /**
     * Получение общих локусов с другим образцом
     */
    getCommonLoci(otherSample) {
        const commonLoci = [];
        const myAnalyzedLoci = this.getAnalyzedLoci();
        const otherAnalyzedLoci = otherSample.getAnalyzedLoci();
        
        for (const locusName of myAnalyzedLoci.keys()) {
            if (otherAnalyzedLoci.has(locusName)) {
                commonLoci.push(locusName);
            }
        }
        
        return commonLoci;
    }

    /**
     * Создание копии образца
     */
    clone() {
        const clonedData = {
            id: this.id + '_copy',
            name: this.name + ' (копия)',
            collectionDate: this.collectionDate,
            str_data: JSON.parse(JSON.stringify(this.str_data)),
            metadata: JSON.parse(JSON.stringify(this.metadata))
        };
        
        return new GeneticSample(clonedData);
    }

    /**
     * Экспорт в JSON
     */
    toJSON() {
        const lociObject = {};
        for (const [name, locus] of this.loci) {
            lociObject[name] = locus;
        }
        
        return {
            id: this.id,
            name: this.name,
            collectionDate: this.collectionDate.toISOString(),
            loci: lociObject,
            str_data: this.str_data,
            metadata: this.metadata
        };
    }

    /**
     * Создание из JSON
     */
    static fromJSON(jsonData) {
        return new GeneticSample(jsonData);
    }

    /**
     * Валидация целостности данных
     */
    validateIntegrity() {
        const issues = [];
        
        // Проверка соответствия loci и str_data
        for (const [locusName, locus] of this.loci) {
            const strLocus = this.str_data[locusName];
            if (!strLocus) {
                issues.push(`Локус ${locusName} отсутствует в str_data`);
                continue;
            }
            
            if (strLocus.allele1 !== locus.allele1 || strLocus.allele2 !== locus.allele2) {
                issues.push(`Несоответствие аллелей для локуса ${locusName}`);
            }
        }
        
        // Проверка качества данных
        let lowQualityCount = 0;
        for (const [locusName, locus] of this.loci) {
            if (locus.quality < 0.5) {
                lowQualityCount++;
            }
        }
        
        if (lowQualityCount > this.loci.size * 0.3) {
            issues.push(`Слишком много локусов низкого качества: ${lowQualityCount}/${this.loci.size}`);
        }
        
        return {
            isValid: issues.length === 0,
            issues
        };
    }

    /**
     * Получение статистики образца
     */
    getStatistics() {
        const totalLoci = this.loci.size;
        const analyzedLoci = this.getAnalyzedLociCount();
        const heterozygousLoci = this.countHeterozygousLoci();
        
        let totalQuality = 0;
        let qualityCount = 0;
        
        for (const [name, locus] of this.loci) {
            if (locus.quality !== undefined) {
                totalQuality += locus.quality;
                qualityCount++;
            }
        }
        
        const averageQuality = qualityCount > 0 ? totalQuality / qualityCount : 0;
        
        return {
            totalLoci,
            analyzedLoci,
            heterozygousLoci,
            completeness: totalLoci > 0 ? analyzedLoci / totalLoci : 0,
            heterozygosity: analyzedLoci > 0 ? heterozygousLoci / analyzedLoci : 0,
            averageQuality
        };
    }

    /**
     * Строковое представление
     */
    toString() {
        const stats = this.getStatistics();
        return `GeneticSample(id=${this.id}, loci=${stats.totalLoci}, analyzed=${stats.analyzedLoci}, completeness=${(stats.completeness * 100).toFixed(1)}%)`;
    }
}

module.exports = GeneticSample;