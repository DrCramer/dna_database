/**
 * Модель данных локуса
 * 
 * Этот класс представляет данные одного генетического локуса
 * с валидацией аллелей и расчетом характеристик.
 */

const { logger } = require('../../../utils/logger');

class LocusData {
    constructor(locusName, allele1, allele2, options = {}) {
        // Валидация названия локуса в самом начале
        if (!locusName || typeof locusName !== 'string' || locusName.trim() === '') {
            throw new Error('Название локуса должно быть непустой строкой');
        }
        
        this.locusName = locusName.trim();
        this.allele1 = this.normalizeAllele(allele1);
        this.allele2 = this.normalizeAllele(allele2);
        this.status = options.status || this.determineStatus();
        this.quality = this.validateQuality(options.quality);
        this.confidence = this.validateConfidence(options.confidence);
        this.readDepth = options.readDepth || null;
        this.peakHeight = options.peakHeight || null;
        this.stutter = options.stutter || false;
        this.dropout = options.dropout || false;
        this.notes = options.notes || '';
        this.timestamp = options.timestamp ? new Date(options.timestamp) : new Date();
        
        this.validate();
        logger.debug(`Создан локус: ${this.locusName} (${this.allele1}/${this.allele2})`);
    }

    /**
     * Валидация данных локуса (для конструктора)
     */
    validate() {
        if (!this.locusName || typeof this.locusName !== 'string') {
            throw new Error('Название локуса должно быть непустой строкой');
        }

        if (!this.allele1 && !this.allele2) {
            throw new Error('Должен быть указан хотя бы один аллель');
        }

        // Валидация названия локуса
        if (!/^[A-Za-z0-9_-]+$/.test(this.locusName)) {
            logger.warn(`Подозрительное название локуса: ${this.locusName}`);
        }

        // Валидация статуса
        const validStatuses = ['определено', 'не определено', 'частично определено', 'сомнительно'];
        if (!validStatuses.includes(this.status)) {
            throw new Error(`Неверный статус локуса: ${this.status}`);
        }
    }

    /**
     * Валидация данных локуса (возвращает результат)
     */
    validateData() {
        const errors = [];
        const warnings = [];

        // Проверка названия локуса
        if (!this.locusName || typeof this.locusName !== 'string') {
            errors.push('Название локуса должно быть непустой строкой');
        } else if (!/^[A-Za-z0-9_-]+$/.test(this.locusName)) {
            warnings.push(`Подозрительное название локуса: ${this.locusName}`);
        }

        // Проверка аллелей
        if (this.allele1 === '0' && this.allele2 === '0') {
            warnings.push('Оба аллеля не определены');
        }

        // Проверка качества
        if (this.quality < 0.3) {
            warnings.push('Очень низкое качество локуса');
        }

        // Проверка статуса
        const validStatuses = ['определено', 'не определено', 'частично определено', 'сомнительно'];
        if (!validStatuses.includes(this.status)) {
            errors.push(`Неверный статус локуса: ${this.status}`);
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Нормализация аллеля
     */
    normalizeAllele(allele) {
        if (!allele) return '0';
        
        // Преобразование в строку и очистка
        let normalized = String(allele).trim().toUpperCase();
        
        // Обработка специальных случаев
        if (normalized === '' || normalized === 'NULL' || normalized === 'UNDEFINED' || normalized === 'N/A') {
            return '0';
        }

        // Обработка микровариантов (например, 9.3, 10.1)
        if (/^\d+\.\d+$/.test(normalized)) {
            return normalized;
        }

        // Обработка повторов (например, 12, 13, 14)
        if (/^\d+$/.test(normalized)) {
            return normalized;
        }

        // Обработка букв в аллелях (например, 12A, 13.2B)
        if (/^\d+(\.\d+)?[A-Z]?$/.test(normalized)) {
            return normalized;
        }

        // Обработка сложных аллелей (например, 12_13, 14.2_15)
        if (/^\d+(\.\d+)?[A-Z]?_\d+(\.\d+)?[A-Z]?$/.test(normalized)) {
            return normalized;
        }

        // Предупреждение о нестандартном аллеле
        logger.warn(`Нестандартный аллель: ${normalized} в локусе ${this.locusName}`);
        return normalized;
    }

    /**
     * Определение статуса локуса
     */
    determineStatus() {
        if (this.allele1 === '0' && this.allele2 === '0') {
            return 'не определено';
        }
        
        if (this.allele1 !== '0' && this.allele2 !== '0') {
            return 'определено';
        }
        
        return 'частично определено';
    }

    /**
     * Валидация качества
     */
    validateQuality(quality) {
        if (quality === undefined || quality === null) {
            return 1.0;
        }
        
        const numQuality = parseFloat(quality);
        if (isNaN(numQuality)) {
            logger.warn(`Некорректное значение качества: ${quality}, установлено 1.0`);
            return 1.0;
        }
        
        return Math.max(0, Math.min(1, numQuality));
    }

    /**
     * Валидация уверенности
     */
    validateConfidence(confidence) {
        if (confidence === undefined || confidence === null) {
            return 1.0;
        }
        
        const numConfidence = parseFloat(confidence);
        if (isNaN(numConfidence)) {
            return 1.0;
        }
        
        return Math.max(0, Math.min(1, numConfidence));
    }

    /**
     * Проверка является ли локус гетерозиготным
     */
    isHeterozygous() {
        return this.status === 'определено' && this.allele1 !== this.allele2;
    }

    /**
     * Проверка является ли локус гомозиготным
     */
    isHomozygous() {
        return this.status === 'определено' && this.allele1 === this.allele2;
    }

    /**
     * Проверка является ли локус проанализированным
     */
    isAnalyzed() {
        return this.status === 'определено';
    }

    /**
     * Получение аллелей в виде массива
     */
    getAlleles() {
        return [this.allele1, this.allele2];
    }

    /**
     * Получение уникальных аллелей
     */
    getUniqueAlleles() {
        const alleles = this.getAlleles().filter(a => a !== '0');
        return [...new Set(alleles)];
    }

    /**
     * Получение генотипа в стандартном формате
     */
    getGenotype() {
        if (!this.isAnalyzed()) {
            return 'не определено';
        }
        
        const alleles = [this.allele1, this.allele2].sort();
        return alleles.join('/');
    }

    /**
     * Сравнение с другим локусом
     */
    compareWith(otherLocus) {
        if (!(otherLocus instanceof LocusData)) {
            throw new Error('Сравнение возможно только с другим LocusData');
        }

        if (this.locusName !== otherLocus.locusName) {
            throw new Error('Нельзя сравнивать локусы с разными названиями');
        }

        if (!this.isAnalyzed() || !otherLocus.isAnalyzed()) {
            return 'не сравнимо';
        }

        const myAlleles = new Set(this.getUniqueAlleles());
        const otherAlleles = new Set(otherLocus.getUniqueAlleles());
        
        // Полное совпадение
        if (myAlleles.size === otherAlleles.size && 
            [...myAlleles].every(allele => otherAlleles.has(allele))) {
            return 'полное совпадение';
        }

        // Частичное совпадение
        const intersection = [...myAlleles].filter(allele => otherAlleles.has(allele));
        if (intersection.length > 0) {
            return 'частичное совпадение';
        }

        // Несовпадение
        return 'несовпадение';
    }

    /**
     * Проверка совместимости аллелей
     */
    isCompatibleWith(otherLocus) {
        const comparison = this.compareWith(otherLocus);
        return comparison === 'полное совпадение' || comparison === 'частичное совпадение';
    }

    /**
     * Получение числа аллелей
     */
    getAlleleCount() {
        return this.getUniqueAlleles().length;
    }

    /**
     * Проверка на микровариант
     */
    hasMicrovariant() {
        return this.allele1.includes('.') || this.allele2.includes('.');
    }

    /**
     * Проверка на сложный аллель
     */
    hasComplexAllele() {
        return this.allele1.includes('_') || this.allele2.includes('_');
    }

    /**
     * Получение диапазона аллелей (для числовых аллелей)
     */
    getAlleleRange() {
        const numericAlleles = this.getUniqueAlleles()
            .map(a => parseFloat(a))
            .filter(a => !isNaN(a))
            .sort((a, b) => a - b);
        
        if (numericAlleles.length === 0) {
            return null;
        }
        
        return {
            min: numericAlleles[0],
            max: numericAlleles[numericAlleles.length - 1],
            range: Math.round((numericAlleles[numericAlleles.length - 1] - numericAlleles[0]) * 10) / 10
        };
    }

    /**
     * Обновление качества
     */
    updateQuality(quality, reason = '') {
        const oldQuality = this.quality;
        this.quality = this.validateQuality(quality);
        
        if (reason) {
            this.addNote(`Качество изменено с ${oldQuality} на ${this.quality}. Причина: ${reason}`);
        }
        
        logger.debug(`Качество локуса ${this.locusName} обновлено: ${oldQuality} -> ${this.quality}`);
    }

    /**
     * Добавление примечания
     */
    addNote(note) {
        const timestamp = new Date().toISOString();
        if (this.notes) {
            this.notes += `\n[${timestamp}] ${note}`;
        } else {
            this.notes = `[${timestamp}] ${note}`;
        }
    }

    /**
     * Установка флага выпадения аллеля
     */
    setDropout(dropout, reason = '') {
        this.dropout = dropout;
        if (dropout && reason) {
            this.addNote(`Выпадение аллеля: ${reason}`);
        }
    }

    /**
     * Установка флага заикания
     */
    setStutter(stutter, reason = '') {
        this.stutter = stutter;
        if (stutter && reason) {
            this.addNote(`Заикание: ${reason}`);
        }
    }

    /**
     * Проверка качества локуса
     */
    getQualityAssessment() {
        const issues = [];
        
        if (this.quality < 0.5) {
            issues.push('низкое качество');
        }
        
        if (this.confidence < 0.7) {
            issues.push('низкая уверенность');
        }
        
        if (this.dropout) {
            issues.push('выпадение аллеля');
        }
        
        if (this.stutter) {
            issues.push('заикание');
        }
        
        if (this.getAlleleCount() > 2) {
            issues.push('избыточные аллели');
        }
        
        return {
            level: issues.length === 0 ? 'хорошее' : issues.length <= 2 ? 'приемлемое' : 'плохое',
            issues
        };
    }

    /**
     * Экспорт в JSON
     */
    toJSON() {
        return {
            locusName: this.locusName,
            allele1: this.allele1,
            allele2: this.allele2,
            status: this.status,
            quality: this.quality,
            confidence: this.confidence,
            readDepth: this.readDepth,
            peakHeight: this.peakHeight,
            stutter: this.stutter,
            dropout: this.dropout,
            notes: this.notes,
            timestamp: this.timestamp.toISOString()
        };
    }

    /**
     * Создание из JSON
     */
    static fromJSON(jsonData) {
        return new LocusData(
            jsonData.locusName,
            jsonData.allele1,
            jsonData.allele2,
            jsonData
        );
    }

    /**
     * Создание из STR данных
     */
    static fromSTRData(locusName, strData) {
        return new LocusData(
            locusName,
            strData.allele1 || strData.a1,
            strData.allele2 || strData.a2,
            {
                quality: strData.quality,
                notes: strData.notes
            }
        );
    }

    /**
     * Строковое представление
     */
    toString() {
        return `LocusData(${this.locusName}: ${this.getGenotype()}, quality=${this.quality.toFixed(2)})`;
    }
}

module.exports = LocusData;