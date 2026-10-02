const XLSX = require('xlsx');
const { logger } = require('../utils/logger');
const { validateGeneticHeaders, normalizeObjectName, getGeneticHeaders } = require('../utils/profileImportFormat');

/**
 * Типы экспертиз
 */
const EXPERTISE_TYPES = {
  GENETIC: 'genetic', // Генетические экспертизы
  EMERGENCY: 'emergency' // ЧС (чрезвычайные ситуации)
};

/**
 * Обязательные столбцы для генетических экспертиз
 */
const GENETIC_REQUIRED_COLUMNS = {
  'Sample Name': { required: true, type: 'string', description: 'Название образца' },
  'Место назначения': { required: false, type: 'string', description: 'Место назначения' },
  'Географическое происхождение': { required: false, type: 'string', description: 'Географическое происхождение' },
  'Родственные связи': { required: false, type: 'string', description: 'Родственные связи (Р или пусто)' },
  '№ Заключения эксперта': { required: true, type: 'string', pattern: /^\d{1,4}-\d{4}$/, description: 'Номер заключения (формат: 1-2025)' },
  'Категория': { required: true, type: 'string', values: ['уг', 'гр'], description: 'Категория (уг или гр)' },
  'Эксперт': { required: true, type: 'string', description: 'ФИО эксперта' },
  'Система': { required: true, type: 'string', description: 'Система анализа' },
  'Статус проверки': { required: false, type: 'string', values: ['проверено', ''], description: 'Статус проверки' },
  'ФИО (сотрудник/посетитель)': { required: false, type: 'string', description: 'ФИО сотрудника/посетителя' },
  'Место рождения': { required: false, type: 'string', description: 'Место рождения' },
  'Занесение в реестр': { required: false, type: 'string', description: 'Занесение в реестр' },
  'Комментарий': { required: false, type: 'string', description: 'Комментарий' },
  'Дата сдачи образца': { required: false, type: 'string', description: 'Дата сдачи образца' }
};

/**
 * Обязательные столбцы для ЧС
 */
const EMERGENCY_REQUIRED_COLUMNS = {
  'Sample Name': { required: true, type: 'string', description: 'Название образца' },
  'Привоз': { required: true, type: 'number', description: 'Номер привоза (только цифры)' },
  '№ присвоенный в в/ч № 522 ЦПООП Северо-Кавказского военного округа, г. Ростов-на-Дону': { 
    required: true, 
    type: 'string', 
    // УБРАЛИ ПАТТЕРН - номера могут содержать любые символы
    description: 'Номер в/ч (любой формат)' 
  }
};

/**
 * Ошибки валидации файлов
 */
class FileValidationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'FileValidationError';
    this.code = code;
    this.details = details;
  }
}

const VALIDATION_ERROR_CODES = {
  INVALID_FILENAME: 'INVALID_FILENAME',
  MISSING_REQUIRED_COLUMN: 'MISSING_REQUIRED_COLUMN',
  INVALID_COLUMN_NAME: 'INVALID_COLUMN_NAME',
  EMPTY_REQUIRED_FIELD: 'EMPTY_REQUIRED_FIELD',
  INVALID_FIELD_FORMAT: 'INVALID_FIELD_FORMAT',
  INVALID_FIELD_VALUE: 'INVALID_FIELD_VALUE',
  EMPTY_FILE: 'EMPTY_FILE'
};

class FileValidationService {
  constructor() {
    this.geneticColumns = GENETIC_REQUIRED_COLUMNS;
    this.emergencyColumns = EMERGENCY_REQUIRED_COLUMNS;
  }

  /**
   * Валидация имени файла
   * @param {string} filename - Имя файла
   * @returns {Object} Результат валидации
   */
  validateFilename(filename) {
    const errors = [];
    
    // Проверка на пробелы в имени файла
    if (filename.includes(' ')) {
      errors.push({
        type: 'filename',
        code: VALIDATION_ERROR_CODES.INVALID_FILENAME,
        message: 'Название файла не должно содержать пробелы',
        details: {
          filename,
          suggestion: filename.replace(/\s+/g, '_')
        }
      });
    }

    // Проверка расширения
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    if (!['.xlsx', '.xls'].includes(ext)) {
      errors.push({
        type: 'filename',
        code: VALIDATION_ERROR_CODES.INVALID_FILENAME,
        message: 'Файл должен иметь расширение .xlsx или .xls',
        details: { filename, extension: ext }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Определение типа экспертизы по столбцам
   * @param {Array} columns - Массив названий столбцов
   * @returns {string} Тип экспертизы
   */
  detectExpertiseType(columns) {
    // Проверяем первый столбец для определения типа
    const firstColumn = columns[0] ? columns[0].toString().trim() : '';
    
    // Проверяем наличие характерных столбцов для ЧС
    const hasEmergencyColumns = columns.some(col => {
      const colName = col ? col.toString().toLowerCase() : '';
      return colName.includes('в/ч') || 
             colName.includes('привоз') || 
             colName.includes('522') ||
             colName.includes('цпооп') ||
             colName.includes('северо-кавказского');
    });
    
    // Дополнительная проверка по первому столбцу
    const firstColumnLower = firstColumn.toLowerCase();
    const isEmergencyByFirstColumn = firstColumnLower.includes('чс') || 
                                   firstColumnLower.includes('emergency') ||
                                   firstColumnLower.includes('катастроф');
    
    if (hasEmergencyColumns || isEmergencyByFirstColumn) {
      return EXPERTISE_TYPES.EMERGENCY;
    }
    
    return EXPERTISE_TYPES.GENETIC;
  }

  /**
   * Валидация структуры Excel файла
   * @param {Buffer} fileBuffer - Буфер файла
   * @param {string} filename - Имя файла
   * @returns {Object} Результат валидации
   */
  validateExcelStructure(fileBuffer, filename, options = {}) {
    const errors = [];
    
    try {
      // Парсинг Excel файла
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      
      if (!sheetName) {
        throw new FileValidationError(
          'Файл не содержит листов данных',
          VALIDATION_ERROR_CODES.EMPTY_FILE
        );
      }

      const worksheet = workbook.Sheets[sheetName];
      const range = options.importFormat === 'genetic' && worksheet['!ref']
        ? { s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(worksheet['!ref']).e } : undefined;
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, ...(range ? { range } : {}) });
      if (range && data.length) data[0] = getGeneticHeaders(data);
      
      if (data.length === 0) {
        throw new FileValidationError(
          'Файл пуст или не содержит данных',
          VALIDATION_ERROR_CODES.EMPTY_FILE
        );
      }

      // Получаем заголовки (первая строка)
      const headers = data[0] || [];
      const dataRows = data.slice(1);

      if (options.importFormat === 'genetic') {
        const validation = validateGeneticHeaders(headers, options.minRequiredLoci || 3);
        errors.push(...validation.errors);
        let actualDataRows = 0;
        if (validation.valid) dataRows.forEach((row, index) => {
          if (row.every(value => !normalizeObjectName(value))) return;
          actualDataRows++;
          const rowNumber = index + 2;
          if (!normalizeObjectName(row[0])) errors.push({ type: 'data', code: 'MISSING_OBJECT', message: `Строка ${rowNumber}: не заполнено обязательное поле «Объект».`, details: { rowNumber } });
          else if (!validation.columns.some(({ index: column }) => !['', '-'].includes(normalizeObjectName(row[column])))) {
            errors.push({ type: 'data', code: 'EMPTY_GENETIC_PROFILE', message: `Строка ${rowNumber}, объект «${normalizeObjectName(row[0])}»: отсутствуют данные генетического профиля.`, details: { rowNumber } });
          }
        });
        return { valid: errors.length === 0, errors, expertiseType: 'genetic', headers, dataRows: dataRows.length,
          actualDataRows, skippedEmptyRows: dataRows.length - actualDataRows, requiredColumns: ['Объект'], recognizedMarkers: validation.recognizedMarkers };
      }
      // Для ЧС явно применяем существующую схему; legacy-эвристика остаётся для остальных отделений.
      const expertiseType = options.importFormat || this.detectExpertiseType(headers);
      const requiredColumns = expertiseType === EXPERTISE_TYPES.EMERGENCY 
        ? this.emergencyColumns 
        : this.geneticColumns;

      // Названия из существующего примера ЧС уже поддерживаются parser.
      const validationHeaders = expertiseType === EXPERTISE_TYPES.EMERGENCY ? headers.map(header => {
        const name = String(header || '').trim().toLowerCase();
        if (name === 'наименование образца') return 'Sample Name';
        if (name.startsWith('присвоенный в в/ч')) return Object.keys(this.emergencyColumns)[2];
        return header;
      }) : headers;
      // Валидация заголовков
      const headerValidation = this.validateHeaders(validationHeaders, requiredColumns);
      errors.push(...headerValidation.errors);

      // Валидация данных
      if (headerValidation.valid) {
        const dataValidation = this.validateData(dataRows, validationHeaders, requiredColumns);
        errors.push(...dataValidation.errors);
        
        // Добавляем информацию о реальном количестве строк с данными
        return {
          valid: errors.length === 0,
          errors,
          expertiseType,
          headers,
          dataRows: dataRows.length,
          actualDataRows: dataValidation.actualDataRows || dataRows.length,
          skippedEmptyRows: dataValidation.skippedEmptyRows || 0,
          requiredColumns: Object.keys(requiredColumns)
        };
      }

      return {
        valid: errors.length === 0,
        errors,
        expertiseType,
        headers,
        dataRows: dataRows.length,
        actualDataRows: 0,
        skippedEmptyRows: dataRows.length,
        requiredColumns: Object.keys(requiredColumns)
      };

    } catch (error) {
      logger.error('Error validating Excel structure:', error);
      
      if (error instanceof FileValidationError) {
        throw error;
      }
      
      throw new FileValidationError(
        'Ошибка чтения Excel файла: ' + error.message,
        VALIDATION_ERROR_CODES.INVALID_FILENAME,
        { originalError: error.message }
      );
    }
  }

  /**
   * Валидация заголовков
   * @param {Array} headers - Заголовки из файла
   * @param {Object} requiredColumns - Обязательные столбцы
   * @returns {Object} Результат валидации
   */
  validateHeaders(headers, requiredColumns) {
    const errors = [];
    const foundColumns = new Set();

    // Проверяем каждый обязательный столбец
    for (const [columnName, config] of Object.entries(requiredColumns)) {
      // Ищем столбец с учетом регистра и пробелов (case-insensitive)
      const found = headers.find(header => {
        if (!header) return false;
        const headerNormalized = header.toString().trim().toLowerCase();
        const columnNormalized = columnName.toLowerCase();
        return headerNormalized === columnNormalized;
      });
      
      if (!found && config.required) {
        errors.push({
          type: 'column',
          code: VALIDATION_ERROR_CODES.MISSING_REQUIRED_COLUMN,
          message: `Отсутствует обязательный столбец: "${columnName}"`,
          details: {
            missingColumn: columnName,
            description: config.description,
            foundHeaders: headers,
            suggestion: this.findSimilarColumn(columnName, headers)
          }
        });
      } else if (found) {
        foundColumns.add(columnName);
      }
    }

    // Проверяем неизвестные столбцы (предупреждения)
    // Исключаем генетические маркеры и известные столбцы
    const knownColumns = Object.keys(requiredColumns).map(col => col.toLowerCase());
    const unknownColumns = headers.filter(header => {
      if (!header) return false;
      const headerStr = header.toString().trim();
      const headerNormalized = headerStr.toLowerCase();
      
      // Проверяем, является ли столбец известным (case-insensitive)
      const isKnownColumn = knownColumns.includes(headerNormalized);
      
      // Проверяем, является ли столбец генетическим маркером
      const isGeneticMarker = this.isGeneticMarker(headerStr);
      
      // Возвращаем true только если столбец неизвестен И не является генетическим маркером
      return !isKnownColumn && !isGeneticMarker;
    });

    if (unknownColumns.length > 0) {
      errors.push({
        type: 'warning',
        code: VALIDATION_ERROR_CODES.INVALID_COLUMN_NAME,
        message: `Найдены неизвестные столбцы: ${unknownColumns.join(', ')}`,
        details: {
          unknownColumns,
          expectedColumns: Object.keys(requiredColumns)
        }
      });
    }

    return {
      valid: errors.filter(e => e.type !== 'warning').length === 0,
      errors,
      foundColumns: Array.from(foundColumns)
    };
  }

  /**
   * Поиск похожего столбца для предложения
   * @param {string} targetColumn - Искомый столбец
   * @param {Array} headers - Доступные заголовки
   * @returns {string|null} Похожий столбец или null
   */
  findSimilarColumn(targetColumn, headers) {
    const target = targetColumn.toLowerCase();
    
    for (const header of headers) {
      if (!header) continue;
      const headerLower = header.toString().toLowerCase();
      
      // Точное совпадение с учетом регистра
      if (headerLower === target) {
        return header.toString();
      }
      
      // Частичное совпадение
      if (headerLower.includes(target) || target.includes(headerLower)) {
        return header.toString();
      }
    }
    
    return null;
  }

  /**
   * Проверка, является ли столбец генетическим маркером
   * @param {string} columnName - Название столбца
   * @returns {boolean} True если это генетический маркер
   */
  isGeneticMarker(columnName) {
    const geneticPatterns = [
      /^D\d+S\d+$/i,        // D3S1358, D21S11, etc.
      /^DYS\d+$/i,          // DYS391, etc.
      /^DXS\d+$/i,          // DXS6795, etc.
      /^rs\d+$/i,           // rs759551978, etc.
      /^(vWA|CSF1PO|TPOX|TH01|FGA|AMEL|SE33)$/i, // Стандартные маркеры
      /^Penta\s*[DE]$/i,    // Penta D, Penta E (с возможными пробелами)
      /^Yindel$/i,          // Y-indel
      /^D\d+S\d+_\d+$/i,    // Варианты с суффиксами
      /^(AMELX?|AMELY?)$/i, // Amelogenin варианты
      /^F13A01$/i,          // F13A01
      /^F13B$/i,            // F13B
      /^FESFPS$/i,          // FESFPS
      /^LPL$/i,             // LPL
      /^Penta\s*[ABCDE]$/i  // Все варианты Penta
    ];
    
    return geneticPatterns.some(pattern => pattern.test(columnName.trim()));
  }

  /**
   * Определение конца реальных данных в файле
   * @param {Array} dataRows - Строки данных
   * @param {Object} requiredColumns - Обязательные столбцы
   * @returns {number} Индекс последней строки с данными
   */
  findLastDataRow(dataRows, requiredColumns) {
    const requiredColumnNames = Object.keys(requiredColumns).filter(col => requiredColumns[col].required);
    
    // Ищем с конца файла первую строку, где заполнен хотя бы один обязательный столбец
    for (let i = dataRows.length - 1; i >= 0; i--) {
      const row = dataRows[i];
      
      if (!row) continue;
      
      // Проверяем, есть ли данные в обязательных столбцах
      // Sample Name всегда в первом столбце (индекс 0)
      const sampleName = row[0];
      
      // Для ЧС проверяем также "Привоз" и номер в/ч
      const hasRequiredData = sampleName && sampleName.toString().trim() !== '';
      
      if (hasRequiredData) {
        console.log(`📊 Найден конец данных на строке ${i + 2} (из ${dataRows.length} строк)`);
        return i + 1; // +1 потому что возвращаем количество строк для обработки
      }
    }
    
    // Если не найдено ни одной строки с данными, возвращаем 0
    console.log(`⚠️ Не найдено строк с данными в файле`);
    return 0;
  }

  /**
   * Валидация данных
   * @param {Array} dataRows - Строки данных
   * @param {Array} headers - Заголовки
   * @param {Object} requiredColumns - Обязательные столбцы
   * @returns {Object} Результат валидации
   */
  validateData(dataRows, headers, requiredColumns) {
    const errors = [];
    
    // Определяем реальный конец данных в файле
    const lastDataRowIndex = this.findLastDataRow(dataRows, requiredColumns);
    const maxRowsToValidate = lastDataRowIndex;
    
    if (maxRowsToValidate === 0) {
      return {
        valid: false,
        errors: [{
          type: 'data',
          code: VALIDATION_ERROR_CODES.EMPTY_FILE,
          message: 'Файл не содержит строк с данными',
          details: {
            totalRows: dataRows.length,
            dataRows: 0
          }
        }],
        processedRows: 0,
        totalRows: dataRows.length,
        actualDataRows: 0
      };
    }
    
    console.log(`🔍 ВАЛИДАЦИЯ ДАННЫХ: обрабатываем ${maxRowsToValidate} строк с данными (из ${dataRows.length} общих строк)`);

    // Для больших файлов показываем прогресс
    const showProgress = maxRowsToValidate > 500;
    let processedRows = 0;

    for (let rowIndex = 0; rowIndex < maxRowsToValidate; rowIndex++) {
      const row = dataRows[rowIndex];
      const actualRowNumber = rowIndex + 2; // +2 потому что индекс с 0 + заголовок

      // Показываем прогресс для больших файлов
      if (showProgress && rowIndex % 100 === 0) {
        console.log(`📊 Валидация: обработано ${rowIndex}/${maxRowsToValidate} строк`);
      }
      processedRows++;

      // Проверяем, есть ли хотя бы одно непустое значение в строке
      const hasAnyData = row.some(cell => {
        if (cell === undefined || cell === null || cell === '') return false;
        if (typeof cell === 'string' && cell.trim() === '') return false;
        return true;
      });
      
      // Если строка полностью пустая, пропускаем её
      if (!hasAnyData) {
        continue;
      }

      // Валидируем каждый столбец в строке
      headers.forEach((header, colIndex) => {
        // Найдем конфигурацию столбца с учетом регистра
        let columnConfig = null;
        let matchedColumnName = null;
        
        if (header) {
          const headerNormalized = header.toString().trim().toLowerCase();
          for (const [columnName, config] of Object.entries(requiredColumns)) {
            if (columnName.toLowerCase() === headerNormalized) {
              columnConfig = config;
              matchedColumnName = columnName;
              break;
            }
          }
        }
        
        if (!columnConfig) return;

        const cellValue = row[colIndex];
        const cellAddress = this.getCellAddress(actualRowNumber, colIndex + 1);

        // Проверка обязательных полей
        if (columnConfig.required && (cellValue === undefined || cellValue === null || cellValue === '')) {
          errors.push({
            type: 'data',
            code: VALIDATION_ERROR_CODES.EMPTY_REQUIRED_FIELD,
            message: `Пустое обязательное поле "${matchedColumnName}" в ячейке ${cellAddress}`,
            details: {
              column: matchedColumnName,
              row: actualRowNumber,
              cellAddress,
              description: columnConfig.description
            }
          });
          return;
        }

        // Пропускаем валидацию если поле пустое и не обязательное
        if (!columnConfig.required && (cellValue === undefined || cellValue === null || cellValue === '')) {
          return;
        }

        // Валидация типа данных
        if (columnConfig.type === 'number' && cellValue !== '' && isNaN(Number(cellValue))) {
          errors.push({
            type: 'data',
            code: VALIDATION_ERROR_CODES.INVALID_FIELD_FORMAT,
            message: `Неверный формат числа в поле "${matchedColumnName}" в ячейке ${cellAddress}`,
            details: {
              column: matchedColumnName,
              row: actualRowNumber,
              cellAddress,
              value: cellValue,
              expectedType: 'число'
            }
          });
        }

        // Валидация паттерна
        if (columnConfig.pattern && cellValue !== '') {
          const stringValue = cellValue.toString();
          if (!columnConfig.pattern.test(stringValue)) {
            errors.push({
              type: 'data',
              code: VALIDATION_ERROR_CODES.INVALID_FIELD_FORMAT,
              message: `Неверный формат поля "${matchedColumnName}" в ячейке ${cellAddress}`,
              details: {
                column: matchedColumnName,
                row: actualRowNumber,
                cellAddress,
                value: cellValue,
                description: columnConfig.description
              }
            });
          }
        }

        // Валидация допустимых значений
        if (columnConfig.values && cellValue !== '') {
          const stringValue = cellValue.toString().toLowerCase();
          const allowedValues = columnConfig.values.map(v => v.toLowerCase());
          if (!allowedValues.includes(stringValue)) {
            errors.push({
              type: 'data',
              code: VALIDATION_ERROR_CODES.INVALID_FIELD_VALUE,
              message: `Недопустимое значение "${cellValue}" в поле "${matchedColumnName}" в ячейке ${cellAddress}`,
              details: {
                column: matchedColumnName,
                row: actualRowNumber,
                cellAddress,
                value: cellValue,
                allowedValues: columnConfig.values
              }
            });
          }
        }
      });
    }

    console.log(`✅ ВАЛИДАЦИЯ ЗАВЕРШЕНА: найдено ${errors.length} ошибок в ${processedRows} строках с данными (пропущено ${dataRows.length - maxRowsToValidate} пустых строк)`);

    return {
      valid: errors.length === 0,
      errors,
      processedRows,
      totalRows: dataRows.length,
      actualDataRows: maxRowsToValidate,
      skippedEmptyRows: dataRows.length - maxRowsToValidate
    };
  }

  /**
   * Получение адреса ячейки в формате Excel (A1, B2, etc.)
   * @param {number} row - Номер строки (1-based)
   * @param {number} col - Номер столбца (1-based)
   * @returns {string} Адрес ячейки
   */
  getCellAddress(row, col) {
    let columnName = '';
    while (col > 0) {
      col--;
      columnName = String.fromCharCode(65 + (col % 26)) + columnName;
      col = Math.floor(col / 26);
    }
    return columnName + row;
  }

  /**
   * Полная валидация файла
   * @param {Buffer} fileBuffer - Буфер файла
   * @param {string} filename - Имя файла
   * @returns {Object} Результат валидации
   */
  validateFile(fileBuffer, filename, options = {}) {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
      expertiseType: null,
      summary: {}
    };

    try {
      // 1. Валидация имени файла
      const filenameValidation = this.validateFilename(filename);
      if (!filenameValidation.valid) {
        results.errors.push(...filenameValidation.errors);
        results.valid = false;
      }

      // 2. Валидация структуры Excel
      const structureValidation = this.validateExcelStructure(fileBuffer, filename, options);
      
      results.expertiseType = structureValidation.expertiseType;
      results.summary = {
        headers: structureValidation.headers,
        dataRows: structureValidation.dataRows,
        actualDataRows: structureValidation.actualDataRows,
        skippedEmptyRows: structureValidation.skippedEmptyRows,
        requiredColumns: structureValidation.requiredColumns
      };

      // Разделяем ошибки и предупреждения
      structureValidation.errors.forEach(error => {
        if (error.type === 'warning') {
          results.warnings.push(error);
        } else {
          results.errors.push(error);
          results.valid = false;
        }
      });

    } catch (error) {
      logger.error('File validation failed:', error);
      results.valid = false;
      results.errors.push({
        type: 'system',
        code: 'VALIDATION_FAILED',
        message: error.message,
        details: error.details || {}
      });
    }

    return results;
  }
}

module.exports = {
  FileValidationService,
  FileValidationError,
  VALIDATION_ERROR_CODES,
  EXPERTISE_TYPES
};