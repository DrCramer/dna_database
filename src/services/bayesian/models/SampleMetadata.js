/**
 * Модель метаданных образца
 * 
 * Этот класс управляет дополнительной информацией об образце,
 * включая лабораторные данные, аналитика и примечания.
 */

const { logger } = require('../../../utils/logger');

class SampleMetadata {
    constructor(data = {}) {
        this.sampleType = data.sampleType || 'неизвестен';
        this.laboratory = data.laboratory || '';
        this.analyst = data.analyst || '';
        this.processingDate = data.processingDate ? new Date(data.processingDate) : new Date();
        this.notes = data.notes || '';
        this.source = data.source || '';
        this.caseNumber = data.caseNumber || '';
        this.priority = data.priority || 'обычный';
        this.storageConditions = data.storageConditions || '';
        this.qualityFlags = data.qualityFlags || [];
        this.customFields = data.customFields || {};
        
        this.validate();
        logger.debug('Созданы метаданные образца');
    }

    /**
     * Валидация метаданных
     */
    validate() {
        // Валидация типа образца
        const validSampleTypes = [
            'кровь', 'слюна', 'волосы', 'ткань', 'кость', 
            'зубы', 'ногти', 'сперма', 'смешанный', 'неизвестен'
        ];
        
        if (!validSampleTypes.includes(this.sampleType)) {
            logger.warn(`Неизвестный тип образца: ${this.sampleType}`);
        }

        // Валидация приоритета
        const validPriorities = ['низкий', 'обычный', 'высокий', 'критический'];
        if (!validPriorities.includes(this.priority)) {
            this.priority = 'обычный';
            logger.warn('Установлен приоритет по умолчанию: обычный');
        }

        // Валидация даты обработки
        if (this.processingDate > new Date()) {
            throw new Error('Дата обработки не может быть в будущем');
        }

        // Валидация флагов качества
        if (!Array.isArray(this.qualityFlags)) {
            this.qualityFlags = [];
        }
    }

    /**
     * Добавление флага качества
     */
    addQualityFlag(flag, description = '') {
        const validFlags = [
            'деградация', 'контаминация', 'смесь', 'низкое_качество',
            'неполный_профиль', 'подозрительные_данные', 'требует_повтора'
        ];

        if (!validFlags.includes(flag)) {
            throw new Error(`Неизвестный флаг качества: ${flag}`);
        }

        const existingFlag = this.qualityFlags.find(f => f.flag === flag);
        if (!existingFlag) {
            this.qualityFlags.push({
                flag,
                description,
                timestamp: new Date(),
                analyst: this.analyst
            });
            logger.info(`Добавлен флаг качества: ${flag}`);
        }
    }

    /**
     * Удаление флага качества
     */
    removeQualityFlag(flag) {
        const index = this.qualityFlags.findIndex(f => f.flag === flag);
        if (index !== -1) {
            this.qualityFlags.splice(index, 1);
            logger.info(`Удален флаг качества: ${flag}`);
        }
    }

    /**
     * Проверка наличия флага качества
     */
    hasQualityFlag(flag) {
        return this.qualityFlags.some(f => f.flag === flag);
    }

    /**
     * Получение всех флагов качества
     */
    getQualityFlags() {
        return this.qualityFlags.map(f => f.flag);
    }

    /**
     * Добавление пользовательского поля
     */
    setCustomField(key, value) {
        if (!key || typeof key !== 'string') {
            throw new Error('Ключ пользовательского поля должен быть непустой строкой');
        }
        
        this.customFields[key] = value;
        logger.debug(`Установлено пользовательское поле: ${key}`);
    }

    /**
     * Получение пользовательского поля
     */
    getCustomField(key) {
        return this.customFields[key];
    }

    /**
     * Удаление пользовательского поля
     */
    removeCustomField(key) {
        delete this.customFields[key];
        logger.debug(`Удалено пользовательское поле: ${key}`);
    }

    /**
     * Обновление аналитика
     */
    updateAnalyst(analyst, timestamp = new Date()) {
        const previousAnalyst = this.analyst;
        this.analyst = analyst;
        
        // Добавляем запись в историю изменений
        if (!this.customFields.analystHistory) {
            this.customFields.analystHistory = [];
        }
        
        this.customFields.analystHistory.push({
            previousAnalyst,
            newAnalyst: analyst,
            timestamp,
            action: 'смена_аналитика'
        });
        
        logger.info(`Аналитик изменен с ${previousAnalyst} на ${analyst}`);
    }

    /**
     * Обновление приоритета
     */
    updatePriority(priority, reason = '') {
        const validPriorities = ['низкий', 'обычный', 'высокий', 'критический'];
        if (!validPriorities.includes(priority)) {
            throw new Error(`Неверный приоритет: ${priority}`);
        }
        
        const previousPriority = this.priority;
        this.priority = priority;
        
        // Добавляем запись в историю изменений
        if (!this.customFields.priorityHistory) {
            this.customFields.priorityHistory = [];
        }
        
        this.customFields.priorityHistory.push({
            previousPriority,
            newPriority: priority,
            reason,
            timestamp: new Date(),
            analyst: this.analyst
        });
        
        logger.info(`Приоритет изменен с ${previousPriority} на ${priority}. Причина: ${reason}`);
    }

    /**
     * Добавление примечания
     */
    addNote(note, analyst = this.analyst) {
        if (!note || typeof note !== 'string') {
            throw new Error('Примечание должно быть непустой строкой');
        }
        
        const timestamp = new Date();
        const noteEntry = {
            text: note,
            analyst,
            timestamp
        };
        
        if (!this.customFields.noteHistory) {
            this.customFields.noteHistory = [];
        }
        
        this.customFields.noteHistory.push(noteEntry);
        
        // Обновляем основное поле примечаний
        if (this.notes) {
            this.notes += `\n[${timestamp.toISOString()}] ${analyst}: ${note}`;
        } else {
            this.notes = `[${timestamp.toISOString()}] ${analyst}: ${note}`;
        }
        
        logger.info(`Добавлено примечание от ${analyst}`);
    }

    /**
     * Получение истории примечаний
     */
    getNoteHistory() {
        return this.customFields.noteHistory || [];
    }

    /**
     * Проверка критичности образца
     */
    isCritical() {
        return this.priority === 'критический' || 
               this.hasQualityFlag('контаминация') ||
               this.hasQualityFlag('смесь');
    }

    /**
     * Получение уровня качества
     */
    getQualityLevel() {
        const criticalFlags = ['контаминация', 'смесь'];
        const warningFlags = ['деградация', 'низкое_качество', 'неполный_профиль'];
        
        if (this.qualityFlags.some(f => criticalFlags.includes(f.flag))) {
            return 'критический';
        }
        
        if (this.qualityFlags.some(f => warningFlags.includes(f.flag))) {
            return 'предупреждение';
        }
        
        return 'нормальный';
    }

    /**
     * Экспорт в JSON
     */
    toJSON() {
        return {
            sampleType: this.sampleType,
            laboratory: this.laboratory,
            analyst: this.analyst,
            processingDate: this.processingDate.toISOString(),
            notes: this.notes,
            source: this.source,
            caseNumber: this.caseNumber,
            priority: this.priority,
            storageConditions: this.storageConditions,
            qualityFlags: this.qualityFlags,
            customFields: this.customFields
        };
    }

    /**
     * Создание из JSON
     */
    static fromJSON(jsonData) {
        return new SampleMetadata(jsonData);
    }

    /**
     * Создание базовых метаданных
     */
    static createBasic(sampleType, laboratory, analyst) {
        return new SampleMetadata({
            sampleType,
            laboratory,
            analyst,
            processingDate: new Date()
        });
    }

    /**
     * Создание метаданных для экстренного случая
     */
    static createEmergency(sampleType, caseNumber, analyst) {
        const metadata = new SampleMetadata({
            sampleType,
            caseNumber,
            analyst,
            priority: 'критический',
            processingDate: new Date()
        });
        
        metadata.addNote('Экстренный случай - требует приоритетной обработки', analyst);
        return metadata;
    }

    /**
     * Валидация совместимости с другими метаданными
     */
    isCompatibleWith(otherMetadata) {
        if (!(otherMetadata instanceof SampleMetadata)) {
            return false;
        }
        
        // Проверка совместимости лабораторий
        if (this.laboratory && otherMetadata.laboratory && 
            this.laboratory !== otherMetadata.laboratory) {
            return false;
        }
        
        // Проверка совместимости типов образцов
        const incompatibleTypes = [
            ['кровь', 'сперма'],
            ['слюна', 'кровь']
        ];
        
        for (const [type1, type2] of incompatibleTypes) {
            if ((this.sampleType === type1 && otherMetadata.sampleType === type2) ||
                (this.sampleType === type2 && otherMetadata.sampleType === type1)) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Строковое представление
     */
    toString() {
        return `SampleMetadata(type=${this.sampleType}, lab=${this.laboratory}, analyst=${this.analyst}, priority=${this.priority})`;
    }
}

module.exports = SampleMetadata;