const XLSX = require('xlsx');
const { createHash } = require('node:crypto');
const { LociTypeDetector } = require('../utils/lociTypeDetector');
const { normalizeObjectName, geneticObjectKey } = require('../utils/profileImportFormat');
const { normalizeAlleleValue } = require('../utils/alleleNormalizer');
const { informativeAlleles } = require('../utils/alleleTokens');
const { metadataSheet, CONVERSION_META_SHEET } = require('../utils/geneticConversionMetadata');
const sourceDetector = require('./geneticSourceDetector');

class ConversionError extends Error {
  constructor(message, code = 'CONVERSION_ERROR', status = 400) { super(message); this.code = code; this.status = status; }
}

function exportMetadata(payload) {
  try { return metadataSheet(payload); }
  catch (error) { throw new ConversionError(error.message, 'CONVERSION_EXPORT_LIMIT', 413); }
}

const hard = status => ['ERROR', 'NEEDS_REVIEW', 'CONFLICT'].includes(status);
const sameAlleles = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

class GeneticExcelConverterService {
  constructor() { this.detector = new LociTypeDetector(); }

  convert(files, options = {}, panels = []) {
    if (!Array.isArray(files) || !files.length || files.length > 20) throw new ConversionError('Выберите от 1 до 20 Excel-файлов.');
    if (files.some(file => !Buffer.isBuffer(file?.buffer))) throw new ConversionError('Некорректные файлы.');
    if (files.reduce((sum, file) => sum + file.buffer.length, 0) > 50 * 1024 * 1024) throw new ConversionError('Общий размер файлов превышает 50 МиБ.');
    if (!options || typeof options !== 'object' || Array.isArray(options) || JSON.stringify(options).length > 2 * 1024 * 1024) throw new ConversionError('Некорректные или слишком большие настройки конвертации.');
    for (const key of ['files', 'cells', 'conflicts', 'objects', 'rows']) if (options[key] != null && (typeof options[key] !== 'object' || Array.isArray(options[key]))) throw new ConversionError('Некорректные настройки решений.');
    if (options.rules != null && (!Array.isArray(options.rules) || options.rules.length > 1000 || options.rules.some(rule => !rule || typeof rule !== 'object' || typeof rule.code !== 'string'))) throw new ConversionError('Некорректные массовые правила.');
    if (options.objects && Object.values(options.objects).some(value => typeof value !== 'string')) throw new ConversionError('Номер объекта должен быть строкой.');
    const result = { version: 1, files: [], profiles: [], catalogLoci: this.detector.getAllSupportedLoci(), sourceLoci: [], detectedPanels: [], issues: [], conflicts: [], summary: {} };
    const objects = new Map();
    let originalRows = 0, unchanged = 0, fixed = 0;
    const issue = data => result.issues.push({ hard: hard(data.status), ...data });
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      if (!/\.(?:xlsx|xls)$/i.test(file.originalname || '') || !Buffer.isBuffer(file.buffer) || file.buffer.length > 10 * 1024 * 1024) throw new ConversionError('Поддерживаются .xlsx/.xls размером до 10 МиБ на файл.');
      if (!(file.buffer[0] === 0x50 && file.buffer[1] === 0x4b || file.buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])))) throw new ConversionError('Содержимое файла не соответствует Excel .xlsx/.xls.');
      const fileId = `${fileIndex}-${createHash('sha256').update(file.buffer).digest('hex').slice(0, 20)}`;
      const settings = options.files?.[fileId] || {};
      if (typeof settings !== 'object' || Array.isArray(settings) || settings.columns != null && (typeof settings.columns !== 'object' || Array.isArray(settings.columns))) throw new ConversionError('Некорректные настройки файла.');
      const info = { id: fileId, name: file.originalname, sheets: [], sheet: null, headerRow: null, objectColumn: null, objectCandidates: [], sourceLoci: [], rowCount: 0, detectedPanelId: null, panelCandidates: [], columns: [] };
      result.files.push(info);
      let workbook;
      try { workbook = XLSX.read(Buffer.from(file.buffer), { type: 'buffer', cellDates: false, sheetRows: 20001 }); }
      catch { throw new ConversionError(`Не удалось прочитать файл ${file.originalname}.`); }
      info.sheets = sourceDetector.meaningfulSheets(workbook);
      const preferred = info.sheets.filter(name => name.trim().toLowerCase() === 'sbt_horizont');
      info.sheet = settings.sheetName || (preferred.length === 1 ? preferred[0] : info.sheets.length === 1 ? info.sheets[0] : null);
      const base = { fileId, sourceFile: info.name, sourceSheet: info.sheet || '', sourceRow: null, objectNumber: '', locus: '', rawValue: '', normalizedValue: '' };
      if (!info.sheet || !info.sheets.includes(info.sheet)) { issue({ ...base, id: `${fileId}:sheet`, code: 'SELECT_SHEET', status: 'NEEDS_REVIEW', reason: 'Выберите содержательный лист Excel.' }); continue; }
      const sheet = workbook.Sheets[info.sheet];
      let rows;
      try { rows = sourceDetector.readRows(sheet); } catch (error) { throw new ConversionError(error.message); }
      info.headerCandidates = sourceDetector.headerCandidates(rows);
      info.sampleRows = rows.slice(0, 30).map((row, index) => ({ row: index + 1, values: row.slice(0, 12).map(value => String(value).slice(0, 100)) }));
      const headersFound = info.headerCandidates;
      const tied = headersFound.length > 1 && headersFound[0].lociCount === headersFound[1].lociCount && headersFound[0].hasObject === headersFound[1].hasObject;
      info.headerRow = settings.headerRow ?? (!tied ? headersFound[0]?.row : null);
      if (!Number.isInteger(info.headerRow) || info.headerRow < 1 || info.headerRow > rows.length) { issue({ ...base, sourceSheet: info.sheet, id: `${fileId}:header`, code: 'SELECT_HEADER', status: 'NEEDS_REVIEW', reason: 'Не найдена однозначная строка заголовков с минимум тремя локусами. Укажите строку.' }); continue; }
      const headers = [...rows[info.headerRow - 1]];
      const width = Math.max(...rows.map(row => row.length));
      while (headers.length < width) headers.push('');
      const dataRows = rows.slice(info.headerRow).filter(row => row.some(value => String(value).trim() !== ''));
      info.rowCount = dataRows.length;
      info.objectCandidates = sourceDetector.objectCandidates(headers, dataRows);
      info.objectColumn = settings.objectColumn ?? sourceDetector.chooseObjectColumn(info.objectCandidates, dataRows);
      info.columns = headers.map((value, index) => ({ index, letter: XLSX.utils.encode_col(index), header: String(value ?? ''), locus: this.detector.getCanonicalLocusName(value), ignored: false }));
      if (!Number.isInteger(info.objectColumn) || info.objectColumn < 0 || info.objectColumn >= headers.length) { issue({ ...base, sourceSheet: info.sheet, sourceRow: info.headerRow, id: `${fileId}:object`, code: 'SELECT_OBJECT', status: 'NEEDS_REVIEW', reason: 'Выберите колонку полного номера объекта; значения колонок-кандидатов различаются либо колонка не найдена.' }); continue; }
      info.objectHeader = String(headers[info.objectColumn] ?? '');
      const mapped = [];
      for (const column of info.columns) {
        if (column.index === info.objectColumn) continue;
        const choice = settings.columns?.[column.index];
        if (choice?.ignore === true || (!choice && (sourceDetector.isServiceColumn(column.header) || info.objectCandidates.some(candidate => candidate.index === column.index && dataRows.every(row => normalizeObjectName(row[column.index]) === normalizeObjectName(row[info.objectColumn])))))) { column.ignored = true; continue; }
        if (choice?.locus) column.locus = this.detector.getCanonicalLocusName(choice.locus);
        const hasData = dataRows.some(row => String(row[column.index] ?? '').trim() !== '');
        if (!column.locus && (!column.header.trim() && !hasData)) { column.ignored = true; continue; }
        if (!column.locus) {
          column.suggestions = sourceDetector.suggestLoci(column.header);
          issue({ ...base, sourceSheet: info.sheet, sourceRow: info.headerRow, id: `${fileId}:column:${column.index}`, column: column.index, code: 'UNKNOWN_LOCUS', status: 'ERROR', rawValue: column.header, reason: 'Неизвестный столбец: сопоставьте с локусом или явно игнорируйте.', suggestions: column.suggestions });
          continue;
        }
        mapped.push(column);
      }
      for (const [column, choice] of Object.entries(settings.columns || {})) issue({ ...base, sourceSheet: info.sheet, sourceRow: info.headerRow, id: `${fileId}:mapping:${column}`, code: 'COLUMN_DECISION', status: 'AUTO_FIXED', rawValue: headers[Number(column)] || '', normalizedValue: choice.ignore ? 'Игнорировать' : choice.locus || '', reason: 'Явное решение о колонке источника.', userDecision: choice });
      info.sourceLoci = [...new Set(mapped.map(column => column.locus))];
      if (info.sourceLoci.length < 3) { issue({ ...base, sourceSheet: info.sheet, id: `${fileId}:loci`, code: 'INSUFFICIENT_LOCI', status: 'ERROR', reason: 'В источнике нужно минимум три распознанных локуса.' }); continue; }
      info.panelCandidates = sourceDetector.panelCandidates(info.sourceLoci, panels);
      const exact = info.panelCandidates.filter(panel => panel.exact);
      if (settings.panelId && !panels.some(panel => panel.id === settings.panelId)) throw new ConversionError('Выбранная панель недоступна в активном отделении.', 'PANEL_NOT_FOUND', 404);
      info.detectedPanelId = settings.panelId === '' ? null : settings.panelId || (exact.length === 1 ? exact[0].id : null);
      info.panelLoci = panels.find(panel => panel.id === info.detectedPanelId)?.lociOrder || [];
      for (let index = info.headerRow; index < rows.length; index++) {
        const row = rows[index];
        if (!row.some(value => String(value).trim() !== '')) continue;
        originalRows++;
        if (originalRows > 50000) throw new ConversionError('Превышен лимит 50 000 исходных строк. Разделите загрузку.');
        const objectCell = sheet[XLSX.utils.encode_cell({ r: index, c: info.objectColumn })];
        const rowId = `${fileId}:${info.sheet}:${index + 1}`;
        if (options.rows?.[rowId]?.ignore === true) { issue({ ...base, sourceSheet: info.sheet, sourceRow: index + 1, id: rowId, status: 'AUTO_FIXED', code: 'IGNORED_ROW', reason: 'Строка исключена пользователем.', userDecision: { ignore: true } }); continue; }
        const objectId = `${rowId}:object`;
        const rawObject = String((objectCell?.t === 'n' ? objectCell.w || objectCell.v : row[info.objectColumn]) ?? '');
        const objectNumber = normalizeObjectName(options.objects?.[objectId] ?? rawObject);
        const source = { ...base, sourceSheet: info.sheet, sourceRow: index + 1, objectNumber };
        if (!objectNumber || objectNumber.length > 100) { issue({ ...source, id: objectId, code: 'INVALID_OBJECT', status: 'ERROR', reason: 'Укажите полный номер объекта длиной до 100 символов.' }); continue; }
        const key = geneticObjectKey(objectNumber);
        if (!objects.has(key)) objects.set(key, { objectNumber, sourceLoci: new Set(), panelIds: new Set(), sources: [], variants: new Map(), audit: [] });
        const object = objects.get(key);
        if (rawObject !== objectNumber) { const entry = { ...source, id: objectId, rawValue: rawObject, normalizedValue: objectNumber, status: 'AUTO_FIXED', code: options.objects?.[objectId] != null ? 'OBJECT_DECISION' : 'OBJECT_NORMALIZED', hard: false, reason: options.objects?.[objectId] != null ? 'Полный номер объекта исправлен пользователем.' : 'Убраны лишние пробелы в полном номере объекта.', userDecision: options.objects?.[objectId] != null ? { value: objectNumber } : null }; issue(entry); object.audit.push(entry); }
        object.sources.push({ fileId, file: info.name, sheet: info.sheet, row: index + 1, headerRow: info.headerRow, objectColumn: info.objectColumn, sourceLoci: info.sourceLoci, detectedPanelId: info.detectedPanelId });
        info.sourceLoci.forEach(locus => object.sourceLoci.add(locus));
        if (info.detectedPanelId) object.panelIds.add(info.detectedPanelId);
        for (const column of mapped) {
          const locus = column.locus;
          const cellId = `${fileId}:${info.sheet}:${index + 1}:${column.index}`;
          const rawValue = String(row[column.index] ?? '');
          const actualCell = sheet[XLSX.utils.encode_cell({ r: index, c: column.index })];
          const original = normalizeAlleleValue(rawValue, locus);
          const originalCode = actualCell?.f && actualCell.v == null ? 'FORMULA_WITHOUT_RESULT' : original.events.find(event => event.hard)?.code || original.events[0]?.code || 'OK';
          const rule = options.rules?.find?.(rule => rule?.fileId === fileId && rule.code === originalCode && rule.rawValue === rawValue && rule.locusType === this.detector.detectLocusType(locus));
          const decision = options.cells?.[cellId] || rule?.decision;
          const normalized = decision ? normalizeAlleleValue(rawValue, locus, decision) : original;
          const cell = { ...source, id: cellId, locus, column: column.index, rawValue, normalizedValue: normalized.normalizedValue, status: normalized.status, hard: normalized.hard, code: normalized.events.find(event => event.hard)?.code || normalized.events[0]?.code || 'OK', reason: normalized.events.map(event => event.reason).join(' '), events: normalized.events, alleles: normalized.alleles, userDecision: decision || null };
          if (actualCell?.f && actualCell.v == null) Object.assign(cell, { status: 'ERROR', hard: true, code: 'FORMULA_WITHOUT_RESULT', reason: 'Формула не содержит сохранённого результата. Пересчитайте исходный файл или задайте значение вручную.' });
          if (decision && actualCell?.f && actualCell.v == null && !normalized.hard) Object.assign(cell, { status: normalized.status, hard: false, code: 'USER_DECISION', reason: 'Пользователь явно задал результат вместо формулы.' });
          if (cell.status === 'OK') unchanged++; else { issue(cell); object.audit.push(cell); if (cell.events.some(event => event.status === 'AUTO_FIXED')) fixed++; }
          if (!object.variants.has(locus)) object.variants.set(locus, []);
          object.variants.get(locus).push(cell);
        }
      }
    }
    for (const [key, object] of objects) {
      const strData = Object.fromEntries(result.catalogLoci.map(locus => [locus, []]));
      for (const [locus, variants] of object.variants) {
        const rank = cell => !cell.alleles.length ? 0 : !informativeAlleles(cell.alleles).length ? 1 : cell.alleles.some(allele => !informativeAlleles([allele]).length) || cell.hard ? 2 : 3;
        const sorted = [...variants].sort((a, b) => rank(b) - rank(a));
        const best = sorted[0];
        const bestKnown = informativeAlleles(best.alleles);
        const conflicting = sorted.filter(cell => rank(cell) >= 2 && (rank(cell) === rank(best) ? !sameAlleles(cell.alleles, best.alleles) : informativeAlleles(cell.alleles).some(allele => !bestKnown.includes(allele))));
        const conflictId = `merge:${key}:${locus}`;
        const decision = options.conflicts?.[conflictId];
        let selected = best.alleles;
        if (conflicting.length || decision) {
          let resolved = false, manualError = '';
          if (decision?.sourceId) {
            const chosen = variants.find(cell => cell.id === decision.sourceId && !cell.hard);
            if (chosen) { selected = chosen.alleles; resolved = true; }
          } else if (decision?.action === 'manual') {
            const normalized = normalizeAlleleValue(decision.value, locus);
            selected = normalized.alleles;
            if (!normalized.hard) resolved = true;
            else manualError = normalized.events.map(event => event.reason).join(' ');
          }
          const conflict = { id: conflictId, objectNumber: object.objectNumber, locus, status: resolved ? 'AUTO_FIXED' : 'CONFLICT', hard: !resolved, code: conflicting.length ? 'REPEATED_RESULT' : 'MANUAL_RESULT', reason: manualError || (resolved ? (conflicting.length ? 'Конфликт повторного исследования разрешён пользователем.' : 'Итоговое значение изменено пользователем.') : 'Разные результаты повторного исследования: выберите источник или введите значение.'), variants: variants.filter(cell => cell.alleles.length), normalizedValue: selected.join(','), userDecision: decision || null, sourceFile: '', sourceSheet: '', sourceRow: null, rawValue: '' };
          result.conflicts.push(conflict); issue(conflict); object.audit.push(conflict);
        } else if (variants.length > 1 && variants.some(cell => cell.alleles.length)) {
          const entry = { id: conflictId, objectNumber: object.objectNumber, locus, status: 'AUTO_FIXED', hard: false, code: 'MERGE', reason: variants.every(cell => sameAlleles(cell.alleles, best.alleles)) ? 'Одинаковые результаты объединены; сохранены все источники.' : 'Значение дополнено полноценным результатом из другого источника.', variants, normalizedValue: selected.join(','), sourceFile: best.sourceFile, sourceSheet: best.sourceSheet, sourceRow: best.sourceRow, rawValue: variants.map(cell => cell.rawValue).join(' → ') };
          issue(entry); object.audit.push(entry);
        }
        strData[locus] = selected;
      }
      const populatedLoci = result.catalogLoci.filter(locus => strData[locus].length);
      if (!populatedLoci.length) issue({ id: `empty:${key}`, objectNumber: object.objectNumber, status: 'ERROR', code: 'EMPTY_PROFILE', hard: true, reason: 'В объекте нет ни одного результата генотипирования.' });
      if (object.panelIds.size > 1) { const entry = { id: `panels:${key}`, objectNumber: object.objectNumber, locus: '', sourceFile: '', sourceSheet: '', sourceRow: null, rawValue: '', normalizedValue: '', status: 'WARNING', code: 'MIXED_PANELS', hard: false, reason: 'Источники относятся к разным панелям; панель не назначена. При необходимости выберите её в обычной загрузке.' }; issue(entry); object.audit.push(entry); }
      const sourceLoci = [...object.sourceLoci];
      result.profiles.push({ objectNumber: object.objectNumber, strData, sourceLoci, populatedLoci, detectedPanelId: object.panelIds.size === 1 ? [...object.panelIds][0] : null,
        panelLoci: object.panelIds.size === 1 ? panels.find(panel => panel.id === [...object.panelIds][0])?.lociOrder || [] : [], sources: object.sources, audit: object.audit });
    }
    result.sourceLoci = result.catalogLoci.filter(locus => result.files.some(file => file.sourceLoci.includes(locus)));
    result.detectedPanels = result.files.filter(file => file.detectedPanelId).map(file => ({ fileId: file.id, panelId: file.detectedPanelId }));
    if (!result.profiles.length && !result.issues.some(item => item.hard)) issue({ id: 'empty', status: 'ERROR', code: 'EMPTY_FILE', hard: true, reason: 'Не найдено ни одного объекта.' });
    result.summary = { files: files.length, sheets: result.files.filter(file => file.sheet).length, originalRows, uniqueObjects: result.profiles.length, sourceLoci: result.sourceLoci.length, unchanged, autoFixed: fixed,
      warnings: result.issues.filter(item => item.status === 'WARNING').length, unresolved: result.issues.filter(item => item.hard && item.status !== 'CONFLICT').length, conflicts: result.conflicts.filter(item => item.hard).length };
    result.canImport = result.profiles.length > 0 && !result.issues.some(item => item.hard);
    return result;
  }

  export(result) {
    if (!result.canImport) throw new ConversionError('Сначала разрешите все ошибки и конфликты.', 'UNRESOLVED_CONVERSION', 409);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Объект', ...result.catalogLoci], ...result.profiles.map(profile => [profile.objectNumber, ...result.catalogLoci.map(locus => profile.strData[locus].join(','))])]), 'Импорт');
    const auditHeaders = ['Файл', 'Лист', 'Строка', 'Объект', 'Локус', 'Исходное', 'Результат', 'Статус', 'Причина', 'Решение пользователя'];
    const auditRows = result.issues.flatMap(item => item.variants ? item.variants.map(variant => [variant.sourceFile, variant.sourceSheet, variant.sourceRow, item.objectNumber, item.locus, variant.rawValue, item.normalizedValue, item.status, item.reason, item.userDecision ? JSON.stringify(item.userDecision) : '']) : [[item.sourceFile || '', item.sourceSheet || '', item.sourceRow || '', item.objectNumber || '', item.locus || '', item.rawValue || '', item.normalizedValue || '', item.status, item.reason, item.userDecision ? JSON.stringify(item.userDecision) : '']]);
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([auditHeaders, ...auditRows]), 'Проверка');
    const fileDecisions = new Map();
    for (const issue of result.issues) if (['COLUMN_DECISION', 'IGNORED_ROW'].includes(issue.code)) {
      if (!fileDecisions.has(issue.fileId)) fileDecisions.set(issue.fileId, []);
      fileDecisions.get(issue.fileId).push(issue);
    }
    const profiles = result.profiles.map(profile => ({ objectNumber: profile.objectNumber, sourceLoci: profile.sourceLoci, detectedPanelId: profile.detectedPanelId, sources: profile.sources, audit: [...profile.audit, ...[...new Set(profile.sources.map(source => source.fileId))].flatMap(fileId => fileDecisions.get(fileId) || [])] }));
    if (profiles.some(profile => JSON.stringify(profile).length > 1024 * 1024)) throw new ConversionError('Журнал одного объекта слишком большой. Разделите исходные файлы.');
    XLSX.utils.book_append_sheet(book, exportMetadata({ createdAt: new Date().toISOString(), converterVersion: '1.0', sourceLoci: result.sourceLoci, sourceFiles: result.files.map(file => ({ name: file.name, sheet: file.sheet, headerRow: file.headerRow, objectColumn: file.objectColumn, sourceLoci: file.sourceLoci, detectedPanelId: file.detectedPanelId })), decisions: result.issues.filter(issue => ['COLUMN_DECISION','IGNORED_ROW'].includes(issue.code)), profiles }), CONVERSION_META_SHEET);
    book.Workbook = { Sheets: book.SheetNames.map(name => ({ name, Hidden: name === CONVERSION_META_SHEET ? 1 : 0 })) };
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
  }
}

module.exports = { GeneticExcelConverterService, ConversionError };
