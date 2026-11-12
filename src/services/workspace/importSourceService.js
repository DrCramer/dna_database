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
const text = v => String(v ?? '').trim();
const fieldAliases = {
  objectNumber: ['объект', '№ объекта', 'sample name', 'наименование образца'],
  year: ['год', 'год исследования', 'year'],
  expertiseType: ['тип экспертизы', 'категория'],
  fullName: ['фио', 'ф.и.о.', 'фио сотрудника', 'ф.и.о. сотрудника', 'сотрудник', 'full name', 'employee name'],
  registrationNumber: ['№ рег.', '№ рег', '№ регистрации', 'регистрационный номер', 'registration number', 'staff id']
};
const metadataHeaders = new Set([...Object.values(FIELDS), ...Object.values(fieldAliases).flat(), 'Sample Name', 'Наименование образца', '№ Объекта', 'Sample Type', 'Year', 'Год исследования', 'Категория', 'Панель', 'Система', 'Эксперт', 'Место назначения', 'Географическое происхождение', 'Родственные связи', '№ Заключения эксперта', 'Статус проверки', 'ФИО (сотрудник/посетитель)', 'Место рождения', 'Занесение в реестр', 'Дата сдачи образца', 'Привоз'].map(v => String(v).trim().toLowerCase()));
const key = v => text(v).toLowerCase().replace(/\s+/g, ' ');
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
function normalizedCell(raw, locus, row, decision) {
  const result = normalizeAlleleValue(raw, locus, decision);
  if (result.hard) row.sourceIssues.push({
    locus,
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
    const sheetName = workbook.SheetNames.find(n => n.trim().toLowerCase() === 'sbt_horizont') || workbook.SheetNames[0],
      sheet = workbook.Sheets[sheetName];
    if (sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref']);
      if ((range.e.r + 1) * (range.e.c + 1) > 2000000) throw Object.assign(new Error('Таблица превышает 2 миллиона ячеек. Разделите её на несколько файлов; строки не были усечены.'), {
        status: 413
      });
    }
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true
    });
    const unified = workbook.Custprops?.DNAProfileSourceFormat === FORMAT;
    const candidate = sourceDetector.headerCandidates(matrix)[0];
    const explicit = matrix.findIndex(row => {
      const names = row.map(key);
      const hasObject = names.some(name => fieldAliases.objectNumber.includes(name));
      const hasName = names.some(name => fieldAliases.fullName.includes(name));
      const hasRegistration = names.some(name => fieldAliases.registrationNumber.includes(name));
      const hasContext = names.some(name => [...fieldAliases.year, ...fieldAliases.expertiseType].includes(name));
      const hasLoci = row.some(header => detector.getCanonicalLocusName(header));
      return hasObject && (hasContext || hasLoci || hasName || hasRegistration) || (hasName || hasRegistration) && (hasContext || hasLoci || hasName && hasRegistration) || !candidate && names.filter(Boolean).length === 1 && hasName;
    });
    const headerIndex = unified ? 0 : explicit >= 0 ? explicit : candidate ? candidate.row - 1 : -1;
    if (headerIndex < 0) throw Object.assign(new Error('Не найдена поддерживаемая таблица объектов. Используйте конвертер для выбора строки заголовков.'), {
      status: 400
    });
    const headers = matrix[headerIndex];
    const column = (...names) => headers.findIndex(h => names.includes(key(h)));
    const objectIndex = column(...fieldAliases.objectNumber);
    if (objectIndex < 0 && column(...fieldAliases.fullName, ...fieldAliases.registrationNumber) < 0) throw Object.assign(new Error('Не найден полный номер объекта.'), {
      status: 400
    });
    const fieldColumns = name => headers.map((header, index) => (fieldAliases[name] || [FIELDS[name].toLowerCase()]).includes(key(header)) ? index : -1).filter(index => index >= 0);
    for (let index = headerIndex + 1; index < matrix.length; index++) {
      const values = matrix[index];
      if (!values.some(v => text(v))) continue;
      const get = name => fieldColumns(name).map(column => text(values[column])).find(Boolean) || '';
      const objectValue = objectIndex >= 0 ? text(values[objectIndex]) : get('registrationNumber');
      const expertiseType = normalizeType(get('expertiseType'));
      const number = expertiseType === 'staff' && !objectValue ? get('registrationNumber') : objectValue;
      const row = newRow(file, checksum, {
        sheet: sheetName,
        row: index + 1
      }, {
        objectNumber: number,
        sourceSampleName: number || get('fullName'),
        year: get('year') ? Number(get('year')) : null,
        expertiseType,
        fullName: get('fullName'),
        registrationNumber: get('registrationNumber') || null,
        comment: get('comment')
      });
      for (const field of ['fullName', 'registrationNumber']) {
        if (new Set(fieldColumns(field).map(column => text(values[column])).filter(Boolean)).size > 1) row.sourceIssues.push({
          code: 'METADATA_COLUMN_CONFLICT',
          message: `Различаются значения столбцов «${FIELDS[field]}». Проверьте исходный файл.`
        });
      }
      const sampleTypeIndex = column('sample type');
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
      })).filter(item => !detector.getCanonicalLocusName(item.header));
      if (!unified) row.provenance.alleleOrigins = headers.map((header, i) => ({
        locus: detector.getCanonicalLocusName(header),
        raw: String(values[i] ?? '')
      })).filter(item => item.locus);
      if (!unified) row.provenance.legacyCells = Object.fromEntries(headers.map((header, i) => [String(header), String(values[i] ?? '')]).filter(([header]) => !detector.getCanonicalLocusName(header)));
      if (unified) {
        try {
          row.provenance = {
            ...JSON.parse(get('provenanceJson') || '{}'),
            ...row.provenance
          };
        } catch {
          row.sourceIssues.push({
            code: 'PROVENANCE_JSON',
            message: 'Повреждены сведения о происхождении.'
          });
        }
      }
      for (const [col, header] of headers.entries()) {
        const canonical = detector.getCanonicalLocusName(header);
        if (!canonical) {
          if (text(values[col]) && !metadataHeaders.has(key(header)) && !sourceDetector.isServiceColumn(header) && !/^№?\s*присвоенный в в\/ч/i.test(text(header))) row.sourceIssues.push({
            code: 'UNKNOWN_COLUMN',
            message: `Неизвестный столбец «${text(header) || XLSX.utils.encode_col(col)}» с данными. Сопоставьте его в конвертере.`
          });
          continue;
        }
        const locus = unified ? String(header) : canonical;
        const address = XLSX.utils.encode_cell({
          r: index,
          c: col
        });
        if (sheet[address]?.f && sheet[address].v == null) row.sourceIssues.push({
          code: 'FORMULA_WITHOUT_RESULT',
          locus,
          message: `Нет результата формулы ${address}.`
        });
        if (Object.hasOwn(row.strData, locus)) row.sourceIssues.push({
          code: 'DUPLICATE_LOCUS',
          locus,
          message: `Повтор столбца ${locus}.`
        });
        row.strData[locus] = unified ? text(values[col]) ? String(values[col]).split(',') : [] : normalizedCell(values[col], locus, row);
      }
      if (unified) {
        try {
          const data = JSON.parse(get('genotypeJson') || '{}');
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
          for (const [locus, alleles] of Object.entries(data)) if (JSON.stringify(row.strData[locus] || []) !== JSON.stringify(alleles)) row.sourceIssues.push({
            code: 'GENOTYPE_CONFLICT',
            locus,
            message: `Столбец ${locus} отличается от сохранённой структуры аллелей. Подтвердите ручное значение.`
          });
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
  }
  return {
    rows,
    checksums
  };
}
module.exports = {
  parseFiles
};
