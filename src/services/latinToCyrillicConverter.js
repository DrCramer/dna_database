/**
 * Конвертер латинских символов в русские (кириллические)
 * Автоматически заменяет визуально похожие символы с логированием
 */

const { logger } = require('../utils/logger');

class LatinToCyrillicConverter {
  constructor() {
    // Карта замены визуально похожих символов
    this.replacementMap = {
      // Заглавные буквы
      'A': 'А', // Латинская A → Русская А
      'B': 'В', // Латинская B → Русская В  
      'C': 'С', // Латинская C → Русская С
      'E': 'Е', // Латинская E → Русская Е
      'H': 'Н', // Латинская H → Русская Н
      'K': 'К', // Латинская K → Русская К
      'M': 'М', // Латинская M → Русская М
      'O': 'О', // Латинская O → Русская О
      'P': 'Р', // Латинская P → Русская Р
      'T': 'Т', // Латинская T → Русская Т
      'X': 'Х', // Латинская X → Русская Х
      'Y': 'У', // Латинская Y → Русская У (редко используется)
      
      // Строчные буквы
      'a': 'а', // Латинская a → Русская а
      'c': 'с', // Латинская c → Русская с
      'e': 'е', // Латинская e → Русская е
      'o': 'о', // Латинская o → Русская о
      'p': 'р', // Латинская p → Русская р
      'x': 'х', // Латинская x → Русская х
      'y': 'у', // Латинская y → Русская у
    };
    
    // Создаем регулярное выражение для поиска всех заменяемых символов
    const latinChars = Object.keys(this.replacementMap).join('');
    this.latinRegex = new RegExp(`[${latinChars}]`, 'g');
  }

  /**
   * Конвертирует латинские символы в русские с логированием
   * @param {string} text - Исходный текст
   * @param {Object} context - Контекст для логирования (filename, rowNumber, fieldName)
   * @returns {Object} Результат конвертации
   */
  convertWithLogging(text, context = {}) {
    if (!text || typeof text !== 'string') {
      return {
        original: text,
        converted: text,
        hasChanges: false,
        changes: []
      };
    }

    const changes = [];
    let converted = text;
    
    // Заменяем каждый найденный латинский символ
    converted = text.replace(this.latinRegex, (match, offset) => {
      const replacement = this.replacementMap[match];
      changes.push({
        position: offset,
        from: match,
        to: replacement,
        fromCode: match.charCodeAt(0),
        toCode: replacement.charCodeAt(0)
      });
      return replacement;
    });

    const result = {
      original: text,
      converted: converted,
      hasChanges: changes.length > 0,
      changes: changes,
      changeCount: changes.length
    };

    // Логируем изменения если они есть
    if (result.hasChanges) {
      const changesStr = changes.map(c => `${c.from}→${c.to}`).join(', ');
      
      logger.info('Latin to Cyrillic conversion applied', {
        original: text,
        converted: converted,
        changes: changesStr,
        changeCount: changes.length,
        context: context
      });
    }

    return result;
  }

  /**
   * Нормализация номера образца (trim + uppercase + latin→cyrillic)
   * @param {string} sampleName - Исходный номер образца
   * @param {Object} context - Контекст для логирования
   * @returns {Object} Результат нормализации
   */
  normalizeSampleName(sampleName, context = {}) {
    if (!sampleName) {
      return { 
        normalized: sampleName, 
        hasChanges: false,
        original: sampleName
      };
    }
    
    // Шаг 1: Очистка и приведение к верхнему регистру
    const trimmed = sampleName.toString().trim();
    const upperCase = trimmed.toUpperCase();
    
    // Шаг 2: Конвертация латинских символов в русские
    const conversionResult = this.convertWithLogging(upperCase, {
      ...context,
      fieldName: context.fieldName || 'sampleName',
      step: 'latin_to_cyrillic_conversion'
    });
    
    const hasAnyChanges = trimmed !== sampleName || 
                         upperCase !== trimmed || 
                         conversionResult.hasChanges;
    
    return {
      original: sampleName,
      normalized: conversionResult.converted,
      hasChanges: hasAnyChanges,
      latinConversionApplied: conversionResult.hasChanges,
      changes: conversionResult.changes,
      steps: {
        trim: { from: sampleName, to: trimmed },
        uppercase: { from: trimmed, to: upperCase },
        latinConversion: { 
          from: upperCase, 
          to: conversionResult.converted,
          changes: conversionResult.changes
        }
      }
    };
  }
}

module.exports = { LatinToCyrillicConverter };