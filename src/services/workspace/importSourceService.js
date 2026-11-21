const XLSX = require('xlsx');
const {
  decodeUploadFilename
} = require('../../utils/uploadFilename');
const {
  randomUUID,
  createHash
} = require('node:crypto');
const {
  LociTypeDetector
} = require('../../utils/lociTypeDetector');
const {
  normalizeAlleleValue
} = require('../../utils/alleleNormalizer');
const { isMissingGenotypeCell, normalizeAmelogeninPair } = require('../../utils/alleleTokens');
const {
  FORMAT,
  FIELDS,
  normalizeType
} = require('../../utils/objectImportV2');
const {
  parseGeneMapperTxt,
  classifySample
} = require('../converters/geneMapperTxtParser');
const {
  applyGeneMapperCell
} = require('../converters/geneMapperSourceAdapter');
const {
  parseNgsAstrWorkbook,
  applyNgsDecision,
  suggestObjectNumber
} = require('../converters/ngsAstrExcelParser');
const sourceDetector = require('../converters/geneticSourceDetector');
const detector = new LociTypeDetector();
const { isAssignedNumberHeader, getAssignedNumber } = require('../../utils/emergencyAssignedNumber');
const { COMMENT_HEADERS, isRegistryMetadataHeader } = require('../../utils/workspaceImportMetadata');
const text = v => String(v ?? '').trim();
const key = v => text(v).toLowerCase().replace(/[\s_]+/g, ' ').replace(/№\s*/g, '№ ');
const objectNumberHeaders = [
  'объект', '№ объекта', 'номер объекта', 'полный номер объекта',
  'объект исследования', '№ объекта исследования', 'номер объекта исследования',
  'объект/локус', 'локус/объект', 'object number'
];
const sampleNameHeaders = ['sample name', 'samplename', 'наименование образца'];
const fieldAliases = {
  objectNumber: [...objectNumberHeaders, ...sampleNameHeaders, 'sample', 'sample id',
    'образец', '№ образца', 'номер образца', 'n препарата', '№ препарата', 'номер препарата'],
  year: ['год', 'год исследования', 'year'],
  expertiseType: ['тип экспертизы', 'категория'],
  fullName: ['фио', 'ф.и.о.', 'фио сотрудника', 'ф.и.о. сотрудника', 'сотрудник', 'full name', 'employee name'],
  comment: COMMENT_HEADERS,
  registrationNumber: ['№ рег.', '№ рег', '№ регистрации', 'регистрационный номер', 'registration number', 'staff id']
};
const metadataHeaders = new Set([...Object.values(FIELDS), ...Object.values(fieldAliases).flat(), 'Sample Type', 'Панель', 'Система', 'Эксперт', 'Место назначения', 'Географическое происхождение', 'Родственные связи', '№ Заключения эксперта', 'Статус проверки', 'ФИО (сотрудник/посетитель)', 'Место рождения', 'Занесение в реестр', 'Дата сдачи образца', 'Привоз'].map(key));
const objectIdentityHeaders = new Set([...fieldAliases.objectNumber, ...fieldAliases.fullName, ...fieldAliases.registrationNumber]);
function newRow(file, checksum, location, values = {}) {
  return {
    draftRowId: randomUUID(),
    included: true,
    sourceFileId: checksum,
    sourceFilename: file.originalname,
    sourceSampleName: values.objectNumber || '',
    sourceLocation: location,
    objectNumber: '',
    year: null,
    expertiseType: null,
    fullName: '',
    registrationNumber: null,
    comment: '',
    strData: {},
    sourceIssues: [],
    provenance: {
      checksum,
      sourceFilename: file.originalname,
      sourceFilenameDecoded: true,
      location
    },
    ...values
  };
}
function normalizedCell(raw, locus, row, cell) {
  const result = normalizeAlleleValue(raw, locus);
  if (result.hard) row.sourceIssues.push({
    locus,
    cell,
    rawValue: String(raw ?? ''),
    code: 'ALLELE_REVIEW',
    message: result.events.map(e => e.reason).join(' ')
  });
  return result.alleles;
}
function parseFiles(files) {
  const rows = [],
    checksums = [];
  for (const input of files) {
    const file = {
      ...input,
      originalname: decodeUploadFilename(input.originalname)
    };
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    checksums.push({
      checksum,
      filename: file.originalname,
      filenameDecoded: true
    });
    if (/\.txt$/i.test(file.originalname)) {
      const parsed = parseGeneMapperTxt(file.buffer, {
        filename: file.originalname
      });
      for (const sample of parsed.samples) {
        const row = newRow(file, checksum, {
          lines: sample.records.map(r => r.sourceRow)
        }, {
          objectNumber: sample.sampleName,
          sourceSampleName: sample.sampleName,
          included: sample.classification.included
        });
        row.provenance.classification = sample.classification;
        row.provenance.suggestedYear = parsed.suggestedYear;
        row.provenance.sourceFormat = parsed.sourceFormat;
        if (!sample.classification.included) row.sourceIssues.push({
          code: 'CONTROL',
          message: sample.classification.reason || 'Служебный образец не импортируется.'
        });
        row.provenance.alleleOrigins = sample.records.map(record => ({
          locus: record.originalLocus,
          sourceRow: record.sourceRow,
          raw: record.originalAlleleFields,
          status: record.status,
          panelName: record.panelName
        }));
        for (const record of sample.records) {
          if (!record.locus) {
            row.sourceIssues.push({
              code: 'UNKNOWN_LOCUS',
              message: `Неизвестный маркер ${record.originalLocus}.`
            });
            continue;
          }
          const cell = applyGeneMapperCell(record, record.locus, null, {});
          if (cell.hard) row.sourceIssues.push({
            code: cell.code,
            locus: record.locus,
            message: cell.reason
          });
          if (row.strData[record.locus] && JSON.stringify(row.strData[record.locus]) !== JSON.stringify(cell.alleles)) row.sourceIssues.push({
            code: 'REPEATED_RESULT',
            locus: record.locus,
            message: `Разные результаты повторного исследования ${record.locus}.`
          });else row.strData[record.locus] = cell.alleles;
        }
        rows.push(row);
      }
      continue;
    }
    if (!(file.buffer[0] === 0x50 && file.buffer[1] === 0x4b || file.buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])))) throw Object.assign(new Error('Содержимое файла не соответствует Excel XLSX/XLS.'), {
      status: 400
    });
    const workbook = XLSX.read(file.buffer, {
      type: 'buffer',
      cellDates: false
    });
    const detection = sourceDetector.detectSourceFormat(workbook, {});
    const source = {
      workbook,
      detection,
      ngs: detection.format === sourceDetector.NGS_FORMAT ? parseNgsAstrWorkbook(workbook, detection) : null
    };
    if (source.ngs) {
      const row = newRow(file, checksum, {
        sheet: source.detection.resultSheet
      }, {
        objectNumber: suggestObjectNumber(file.originalname)
      });
      row.provenance.sourceFormat = sourceDetector.NGS_FORMAT;
      row.provenance.alleleOrigins = source.ngs.records.map(record => ({
        locus: record.originalLocus,
        raw: record.rawGenotype,
        qc: record.qc
      }));
      for (const issue of source.ngs.structuralIssues) row.sourceIssues.push({
        code: issue.code,
        message: issue.reason
      });
      for (const record of source.ngs.records) {
        if (!record.locus) {
          row.sourceIssues.push({
            code: 'UNKNOWN_LOCUS',
            message: `Неизвестный маркер ${record.originalLocus}.`
          });
          continue;
        }
        const cell = applyNgsDecision(record, record.locus, null);
        row.strData[record.locus] = cell.alleles;
        if (cell.hard) row.sourceIssues.push({
          code: cell.code,
          locus: record.locus,
          message: cell.reason
        });
      }
      rows.push(row);
      continue;
    }
    for (const row of parseProfileTable(file, checksum, workbook)) rows.push(row);
  }
  return {
    rows,
    checksums
  };
}

const tableOptions = { header: 1, defval: '', raw: false, blankrows: true };

function findProfileHeader(matrix, unified) {
  if (unified) return 0;
  const candidate = sourceDetector.headerCandidates(matrix)[0];
  const explicit = matrix.findIndex(row => {
    const names = row.map(key);
    const hasObject = names.some(name => fieldAliases.objectNumber.includes(name));
    const hasName = names.some(name => fieldAliases.fullName.includes(name));
    const hasRegistration = names.some(name => fieldAliases.registrationNumber.includes(name));
    if (!hasObject && !hasName && !hasRegistration) return false;
    const hasContext = names.some(name => fieldAliases.year.includes(name) || fieldAliases.expertiseType.includes(name));
    const hasLoci = row.some(header => detector.getCanonicalLocusName(header));
    return hasContext || hasLoci || hasObject && (hasName || hasRegistration) ||
      hasName && (hasRegistration || !candidate && names.filter(Boolean).length === 1);
  });
  return explicit >= 0 ? explicit : candidate ? candidate.row - 1 : -1;
}

function readProfileTable(sheet, unified) {
  const parsedRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (sheet['!ref']) {
    const range = sheet['!fullref'] ? XLSX.utils.decode_range(sheet['!fullref']) : parsedRange;
    if (range.e.r > parsedRange.e.r) throw Object.assign(new Error('Лист превышает лимит строк. Разделите исходный файл.'), { status: 413 });
    if ((range.e.r + 1) * (range.e.c + 1) > 2000000) throw Object.assign(new Error('Таблица превышает 2 миллиона ячеек. Разделите её на несколько файлов; строки не были усечены.'), {
      status: 413
    });
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, tableOptions);
  return { matrix, start: parsedRange.s, headerIndex: findProfileHeader(matrix, unified) };
}

function hasImportIdentity(headers) {
  return headers?.some(header => objectIdentityHeaders.has(key(header)));
}

function normalizeTransferAlleles(alleles, canonicalLocus) {
  if (alleles.every(isMissingGenotypeCell)) return [];
  const tokens = alleles.map(allele => isMissingGenotypeCell(allele) ? '?' : allele);
  return canonicalLocus === 'AMEL' ? normalizeAmelogeninPair(tokens) || tokens : tokens;
}

function parseProfileTable(file, checksum, workbook) {
  const rows = [];
  let sheetName = workbook.SheetNames.find(n => n.trim().toLowerCase() === 'sbt_horizont') || workbook.SheetNames[0];
  const unified = workbook.Custprops?.DNAProfileSourceFormat === FORMAT;
  let sheet = workbook.Sheets[sheetName];
  let table = readProfileTable(sheet, unified);
  if (!unified && !hasImportIdentity(table.matrix[table.headerIndex])) {
    // У вспомогательных листов достаточно проверить заголовки, не читая все строки.
    const alternatives = workbook.SheetNames.filter(name => {
      if (name === sheetName) return false;
      const alternative = workbook.Sheets[name];
      if (!alternative['!ref']) return false;
      const range = XLSX.utils.decode_range(alternative['!ref']);
      range.e.r = Math.min(range.e.r, range.s.r + 29);
      const preview = XLSX.utils.sheet_to_json(alternative, { ...tableOptions, range });
      const headers = preview[findProfileHeader(preview, false)];
      return hasImportIdentity(headers) && headers.some(header => detector.getCanonicalLocusName(header));
    });
    if (alternatives.length > 1) {
      const labels = alternatives.slice(0, 5).map(name => `«${name}»`).join(', ');
      throw Object.assign(new Error(`В файле «${file.originalname}» найдено несколько подходящих листов: ${labels}${alternatives.length > 5 ? ' и другие' : ''}. Выберите нужный лист в конвертере.`), {
        status: 400, code: 'IMPORT_SHEET_AMBIGUOUS'
      });
    }
    if (alternatives.length === 1) {
      sheetName = alternatives[0];
      sheet = workbook.Sheets[sheetName];
      table = readProfileTable(sheet, unified);
    }
  }
  const { matrix, start, headerIndex } = table;
  const headers = matrix[headerIndex];
  if (!hasImportIdentity(headers)) {
    const location = `Файл «${file.originalname}», лист «${sheetName}»`;
    const instruction = 'Назовите столбец с полным номером «Объект» или укажите его в конвертере.';
    const message = headers
      ? `${location}, строка ${start.r + headerIndex + 1}: не найден столбец с полным номером объекта. ${instruction}`
      : `${location}: не найдена строка заголовков таблицы объектов. ${instruction}`;
    throw Object.assign(new Error(message), { status: 400, code: headers ? 'IMPORT_OBJECT_COLUMN_REQUIRED' : 'IMPORT_HEADER_REQUIRED' });
  }
  const headerKeys = headers.map(key);
  const canonicalLoci = headers.map(header => detector.getCanonicalLocusName(header));
  const fieldColumns = Object.fromEntries(Object.keys(FIELDS).map(name => [
    name,
    headerKeys.flatMap((header, index) => (name === 'assignedNumber' ? isAssignedNumberHeader(headers[index]) :
      (fieldAliases[name] || [key(FIELDS[name])]).includes(header)) ? [index] : [])
  ]));
  const objectColumns = fieldColumns.objectNumber;
  const objectIndex = objectColumns.find(index => objectNumberHeaders.includes(headerKeys[index])) ??
    objectColumns.find(index => sampleNameHeaders.includes(headerKeys[index])) ?? objectColumns[0];
  const sampleTypeIndex = headerKeys.indexOf('sample type');
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const values = matrix[index];
    if (!values.some(v => text(v))) continue;
    const get = name => {
      const entries = fieldColumns[name].map(column => text(values[column])).filter(Boolean);
      return name === 'comment' ? [...new Set(entries)].join('\n') : entries[0] || '';
    };
    const objectValue = objectIndex !== undefined ? text(values[objectIndex]) : get('registrationNumber');
    const expertiseType = normalizeType(get('expertiseType'));
    const number = expertiseType === 'staff' && !objectValue ? get('registrationNumber') : objectValue;
    const row = newRow(file, checksum, {
      sheet: sheetName,
      row: start.r + index + 1
    }, {
      objectNumber: number,
      sourceSampleName: number || get('fullName'),
      year: get('year') ? Number(get('year')) : null,
      expertiseType,
      fullName: get('fullName'),
      registrationNumber: get('registrationNumber') || null,
      comment: get('comment')
    });
    for (const field of ['fullName', 'registrationNumber', 'assignedNumber', 'year']) {
      if (new Set(fieldColumns[field].map(column => text(values[column])).filter(Boolean)).size > 1) row.sourceIssues.push({
        code: 'METADATA_COLUMN_CONFLICT',
        message: `Различаются значения столбцов «${FIELDS[field]}». Проверьте исходный файл.`
      });
    }
    const classification = classifySample(row.objectNumber || row.fullName, [sampleTypeIndex >= 0 ? text(values[sampleTypeIndex]) : 'Sample']);
    row.provenance.classification = classification;
    if (!classification.included) {
      row.included = false;
      row.sourceIssues.push({
        code: 'CONTROL',
        message: classification.reason
      });
    }
    row.provenance.sourceObjectNumber = row.objectNumber;
    if (!unified) row.provenance.legacyColumns = headers.map((header, i) => ({
      header: String(header),
      value: String(values[i] ?? '')
    })).filter((_, index) => !canonicalLoci[index]);
    if (!unified) row.provenance.alleleOrigins = headers.map((header, i) => ({
      locus: canonicalLoci[i],
      raw: String(values[i] ?? '')
    })).filter(item => item.locus);
    if (!unified) row.provenance.legacyCells = Object.fromEntries(row.provenance.legacyColumns.map(({ header, value }) => [header, value]));
    if (unified) {
      try {
        const provenance = JSON.parse(get('provenanceJson') || '{}');
        if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) throw Error();
        row.provenance = {
          ...provenance,
          ...row.provenance
        };
      } catch {
        row.sourceIssues.push({
          code: 'PROVENANCE_JSON',
          message: 'Повреждены сведения о происхождении.'
        });
      }
    }
    row.assignedNumber = fieldColumns.assignedNumber.length ? get('assignedNumber') : getAssignedNumber({ provenance: row.provenance });
    if (fieldColumns.assignedNumber.length || row.assignedNumber) row.provenance.assignedNumber = row.assignedNumber;
    for (const [col, header] of headers.entries()) {
      const canonical = canonicalLoci[col];
      const cell = XLSX.utils.encode_cell({ r: start.r + index, c: start.c + col });
      if (!canonical) {
        if (text(values[col]) && !metadataHeaders.has(headerKeys[col]) && !sourceDetector.isServiceColumn(header) && !isAssignedNumberHeader(header) && !isRegistryMetadataHeader(header)) row.sourceIssues.push({
          code: 'UNKNOWN_COLUMN',
          column: text(header),
          cell,
          message: `Неизвестный столбец «${text(header) || XLSX.utils.encode_col(col)}» с данными. Сопоставьте его в конвертере.`
        });
        continue;
      }
      const locus = unified ? String(header) : canonical;
      if (sheet[cell]?.f && sheet[cell].v == null) row.sourceIssues.push({
        code: 'FORMULA_WITHOUT_RESULT',
        locus,
        cell,
        message: `Нет результата формулы ${cell}.`
      });
      if (Object.hasOwn(row.strData, locus)) row.sourceIssues.push({
        code: 'DUPLICATE_LOCUS',
        locus,
        cell,
        message: `Повтор столбца ${locus}.`
      });
      if (unified) {
        const value = text(values[col]) ? String(values[col]).split(',') : [];
        row.strData[locus] = normalizeTransferAlleles(value, canonical);
      } else {
        row.strData[locus] = normalizedCell(values[col], locus, row, cell);
      }
    }
    const genotypeJSON = unified ? get('genotypeJson') : '';
    if (genotypeJSON) {
      try {
        const data = JSON.parse(genotypeJSON);
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(alleles => !Array.isArray(alleles) || alleles.some(value => typeof value !== 'string'))) throw Error();
        for (const locus of new Set([...Object.keys(row.strData), ...Object.keys(data)])) {
          if (Object.hasOwn(data, locus)) {
            data[locus] = normalizeTransferAlleles(data[locus], detector.getCanonicalLocusName(locus));
          }
          if (JSON.stringify(row.strData[locus] ?? []) !== JSON.stringify(data[locus] ?? [])) row.sourceIssues.push({
            code: 'GENOTYPE_CONFLICT',
            locus,
            message: `Столбец ${locus} отличается от сохранённой структуры аллелей. Подтвердите ручное значение.`
          });
        }
        row.strData = data;
      } catch {
        row.sourceIssues.push({
          code: 'GENOTYPE_JSON',
          message: 'Повреждена структура генотипа JSON; данные не были отброшены.'
        });
      }
    }
    rows.push(row);
  }
  return rows;
}

module.exports = { parseFiles, parseProfileTable };
