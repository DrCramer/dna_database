const ExcelJS = require('exceljs');
const { getAnalysisLoci, profileLoci } = require('../utils/analysisLoci');
const {
  normalizeHexColor,
  normalizeMatchColors,
  getLocusComparisonPresentation,
  formatLocusValue
} = require('../utils/locusComparisonPresentation');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function profileKey(profile) {
  return profile.id ? `db:${profile.id}` : `temporary:${profile.temporaryId}`;
}

function objectIdentifier(profile, genetic) {
  if (genetic) return String(profile.internal_number ?? profile.internalNumber ?? '').trim();
  return String(profile.internal_number ?? profile.internalNumber ?? profile.sample_name ?? profile.sampleName ?? '').trim();
}

function displayIdentifier(profile, genetic) {
  const object = objectIdentifier(profile, genetic);
  const sample = String(profile.sample_name ?? profile.sampleName ?? '').trim();
  if (genetic) return object || sample || '(без номера)';
  return [object, sample].filter(Boolean).join(' / ') || '(без номера)';
}

function escapeFormulaText(value) {
  const text = value == null ? '' : String(value);
  // ExcelJS writes strings as shared/inline strings; this guard also protects
  // workbooks opened by spreadsheet software that guesses formula types.
  return /^[\s\u0000-\u001f]*[=+@]/.test(text) ? `'${text}` : text;
}

function setText(cell, value) {
  cell.value = escapeFormulaText(value);
  cell.numFmt = '@';
}

function setBaseSheetStyles(sheet, { headerRow = 1, firstColumnWidth = 24, locusStartColumn = 2 } = {}) {
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.properties.defaultRowHeight = 22;
  const header = sheet.getRow(headerRow);
  header.height = 26;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF17212B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF9AA8B5' } } };
  });
  sheet.getColumn(1).width = firstColumnWidth;
  for (let column = locusStartColumn; column <= sheet.columnCount; column += 1) {
    const headerText = String(sheet.getRow(headerRow).getCell(column).value || '');
    sheet.getColumn(column).width = Math.min(22, Math.max(12, headerText.length + 2));
  }
}

function applyBodyCellStyle(cell) {
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.border = {
    top: { style: 'hair', color: { argb: 'FFD7DEE5' } },
    bottom: { style: 'hair', color: { argb: 'FFD7DEE5' } },
    left: { style: 'hair', color: { argb: 'FFD7DEE5' } },
    right: { style: 'hair', color: { argb: 'FFD7DEE5' } }
  };
}

function toArgb(hex) {
  return `FF${normalizeHexColor(hex, '#000000').slice(1)}`;
}

function setComparisonCell(cell, rawValue, presentation, { highlight, highlightAlleles }) {
  setText(cell, formatLocusValue(rawValue));
  applyBodyCellStyle(cell);
  if (highlight && presentation.backgroundColor) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(presentation.backgroundColor) } };
  }
  if (highlightAlleles && presentation.status === 'partial' && presentation.alleles.some(allele => allele.matched)) {
    const runs = [];
    presentation.alleles.forEach((allele, index) => {
      if (index) runs.push({ text: ',', font: { color: { argb: 'FF000000' } } });
      runs.push({
        text: String(allele.value),
        font: allele.matched
          ? { color: { argb: toArgb(presentation.colors.partialMatchAllele) }, bold: true }
          : { color: { argb: 'FF000000' } }
      });
    });
    if (runs.length) cell.value = { richText: runs };
  }
}

function validateOptions(options = {}) {
  const scope = options.scope || 'all';
  if (!['all', 'reference'].includes(scope)) throw new Error('Неизвестная область экспорта.');
  return {
    scope,
    referenceKey: typeof options.referenceKey === 'string' ? options.referenceKey : null,
    includeReferences: options.includeReferences !== false,
    includeHighlights: options.includeHighlights !== false,
    highlightAlleles: options.highlightAlleles !== false,
    includeComparisons: options.includeComparisons !== false,
    includeAnalysis: options.includeAnalysis !== false,
    locusMode: options.locusMode === 'visible' ? 'visible' : 'all',
    visibleLoci: Array.isArray(options.visibleLoci) ? options.visibleLoci.map(String).slice(0, 500) : [],
    colors: normalizeMatchColors(options.colors)
  };
}

function filterPairs(pairs, options) {
  if (options.scope === 'all') return pairs;
  if (!options.referenceKey) throw new Error('Выберите эталон для экспорта его группы совпадений.');
  return pairs.filter(pair => profileKey(pair.reference) === options.referenceKey);
}

function addLegendRow(sheet, label, color, status) {
  const row = sheet.addRow([label, status]);
  setText(row.getCell(1), label);
  setText(row.getCell(2), status);
  if (color) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(color) } };
}

class DuplicateExcelExportService {
  async createWorkbookBuffer({ comparisons, metadata = {}, options = {} }) {
    const opts = validateOptions(options);
    const pairs = filterPairs(comparisons, opts);
    if (!pairs.length) throw new Error('Нет найденных дубликатов для выгрузки.');

    const genetic = metadata.importFormat === 'genetic';
    const profiles = new Map();
    for (const pair of pairs) {
      for (const profile of [pair.reference, pair.matched]) {
        if (profile && (profile.id || profile.temporaryId)) profiles.set(profileKey(profile), profile);
      }
    }

    const includedProfiles = [...profiles.values()].filter(profile => opts.includeReferences || pairs.some(pair => profileKey(pair.matched) === profileKey(profile)));
    const allLoci = getAnalysisLoci([...profiles.values()].map(profile => ({
      ...profile,
      loci: profileLoci(profile),
      panel: profile.panel
    })));
    const selectedLoci = opts.locusMode === 'visible'
      ? allLoci.filter(locus => opts.visibleLoci.includes(locus))
      : allLoci;
    const loci = selectedLoci;
    if (!loci.length) throw new Error('В выбранном наборе нет локусов для экспорта. Выберите все локусы или включите нужные локусы в анализ.');
    const colors = opts.colors;
    const duplicateIdentifiers = new Map();
    for (const profile of includedProfiles) {
      const identifier = genetic ? `${profile.year ?? ''}:${objectIdentifier(profile, true)}` : objectIdentifier(profile, false);
      if (!identifier) continue;
      duplicateIdentifiers.set(identifier, (duplicateIdentifiers.get(identifier) || 0) + 1);
    }
    const conflictingIds = [...duplicateIdentifiers].filter(([, count]) => count > 1).map(([identifier]) => identifier);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DNA Database';
    workbook.created = new Date();
    workbook.modified = workbook.created;
    workbook.properties.date1904 = false;

    const profilesSheet = workbook.addWorksheet('Профили');
    const geneticHeaders = ['Объект', 'Год', ...loci];
    const emergencyHeaders = ['№ присвоенный в/ч', 'Привоз', 'Год', 'Sample Name', ...loci];
    const profileHeaders = genetic ? geneticHeaders : emergencyHeaders;
    profilesSheet.addRow(profileHeaders);
    for (const profile of includedProfiles) {
      const raw = profileLoci(profile);
      const rowValues = genetic
        ? [objectIdentifier(profile, true), profile.year ?? '', ...loci.map(locus => formatLocusValue(raw[locus]))]
        : [profile.sample_name ?? profile.sampleName ?? '', profile.import_number ?? profile.importNumber ?? '', profile.year ?? '', profile.internal_number ?? profile.internalNumber ?? '', ...loci.map(locus => formatLocusValue(raw[locus]))];
      const row = profilesSheet.addRow(rowValues.map(escapeFormulaText));
      row.eachCell((cell, column) => {
        setText(cell, rowValues[column - 1]);
        applyBodyCellStyle(cell);
      });
    }
    profilesSheet.autoFilter = { from: 'A1', to: profilesSheet.getRow(1).getCell(profileHeaders.length).address };
    setBaseSheetStyles(profilesSheet, { firstColumnWidth: 24, locusStartColumn: genetic ? 2 : 5 });
    for (let column = genetic ? 2 : 5; column <= profilesSheet.columnCount; column += 1) {
      profilesSheet.getColumn(column).numFmt = '@';
    }

    if (opts.includeComparisons) {
      const comparisonsSheet = workbook.addWorksheet('Сравнения');
      const fixedHeaders = ['Роль', 'Объект', 'Эталон', 'Совпавшие локусы'];
      comparisonsSheet.addRow([...fixedHeaders, ...loci]);
      pairs.forEach(pair => {
        const reference = pair.reference;
        const matched = pair.matched;
        const refLabel = displayIdentifier(reference, genetic);
        const refRow = comparisonsSheet.addRow([
          'Эталон', refLabel, refLabel, '',
          ...loci.map(locus => formatLocusValue(profileLoci(reference)[locus]))
        ]);
        refRow.eachCell((cell, column) => {
          setText(cell, refRow.getCell(column).value);
          applyBodyCellStyle(cell);
        });
        refRow.getCell(2).font = { bold: true, color: { argb: 'FF244C68' } };
        refRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2F8' } };

        const matchedPresentations = new Map(loci.map(locus => [locus, getLocusComparisonPresentation({
          referenceData: profileLoci(reference)[locus],
          comparedData: profileLoci(matched)[locus],
          matchedLoci: pair.matchedLoci,
          details: pair.details,
          locus,
          ignoredLoci: pair.ignoredLoci || metadata.ignoredLoci || [],
          colors
        })]));
        const fullMatchCount = [...matchedPresentations.values()].filter(presentation => presentation.status === 'full').length;
        const matchedRow = comparisonsSheet.addRow([
          'Совпавший профиль', displayIdentifier(matched, genetic), refLabel, fullMatchCount,
          ...loci.map(locus => formatLocusValue(profileLoci(matched)[locus]))
        ]);
        matchedRow.eachCell((cell, column) => {
          if (column <= fixedHeaders.length) {
            setText(cell, matchedRow.getCell(column).value);
            applyBodyCellStyle(cell);
            return;
          }
          const locus = loci[column - fixedHeaders.length - 1];
          const presentation = matchedPresentations.get(locus);
          setComparisonCell(matchedRow.getCell(column), profileLoci(matched)[locus], presentation, {
            highlight: opts.includeHighlights,
            highlightAlleles: opts.highlightAlleles
          });
        });
      });
      comparisonsSheet.autoFilter = { from: 'A1', to: comparisonsSheet.getRow(1).getCell(fixedHeaders.length + loci.length).address };
      setBaseSheetStyles(comparisonsSheet, { firstColumnWidth: 12, locusStartColumn: fixedHeaders.length + 1 });
      comparisonsSheet.getColumn(1).width = 22;
      comparisonsSheet.getColumn(2).width = 24;
      comparisonsSheet.getColumn(3).width = 24;
      comparisonsSheet.getColumn(4).width = 18;
      for (let column = fixedHeaders.length + 1; column <= comparisonsSheet.columnCount; column += 1) comparisonsSheet.getColumn(column).numFmt = '@';
    }

    if (opts.includeAnalysis) {
      const summary = workbook.addWorksheet('Сводка');
      summary.addRow(['Параметр', 'Значение']);
      const uniqueReferences = new Set(pairs.map(pair => profileKey(pair.reference)));
      const uniqueProfiles = new Set(pairs.flatMap(pair => [profileKey(pair.reference), profileKey(pair.matched)]));
      const uniqueAlgorithms = [...new Set(pairs.map(pair => pair.algorithm).filter(Boolean))];
      const uniqueModes = [...new Set(metadata.searchModes || [metadata.searchMode].filter(Boolean))];
      const summaryRows = [
        ['Дата анализа', metadata.searchedAt || new Date().toISOString()],
        ['Отделение', metadata.departmentName || ''],
        ['Режим поиска', uniqueModes.join(', ')],
        ['Алгоритм', uniqueAlgorithms.join(', ')],
        ['Минимум совпадений', metadata.minMatches ?? ''],
        ['Настройки duplicate_v5', metadata.duplicateSettings ? JSON.stringify(metadata.duplicateSettings) : ''],
        ['Найдено пар', pairs.length],
        ['Уникальных профилей', uniqueProfiles.size],
        ['Эталонных профилей', uniqueReferences.size],
        ['Локусов', loci.length],
        ['Групп', uniqueReferences.size]
      ];
      for (const rowValues of summaryRows) {
        const row = summary.addRow(rowValues);
        row.eachCell(cell => {
          if (cell.value != null) setText(cell, cell.value);
          applyBodyCellStyle(cell);
        });
      }
      summary.addRow([]);
      summary.addRow(['Легенда', 'Статус']);
      const legendHeader = summary.lastRow;
      legendHeader.font = { bold: true };
      addLegendRow(summary, 'Полное совпадение', opts.includeHighlights ? colors.fullMatch : null, 'Все информативные аллели совпали');
      addLegendRow(summary, 'Частичное совпадение', opts.includeHighlights ? colors.partialMatch : null, 'Есть общие аллели; статус алгоритма учитывается');
      addLegendRow(summary, 'Совпавший аллель', opts.highlightAlleles ? colors.partialMatchAllele : null, 'Отдельный фрагмент Rich Text');
      addLegendRow(summary, 'Несовпадение', opts.includeHighlights ? colors.noMatch : null, 'Нет общих информативных аллелей');
      addLegendRow(summary, 'Нет данных / не сравнивался', null, 'Нейтральное оформление');
      if (conflictingIds.length) {
        summary.addRow([]);
        summary.addRow(['Внимание', `Идентификаторы объектов повторяются у разных профилей: ${conflictingIds.join(', ')}. Сверьте лист «Профили» перед повторным импортом; номера не менялись.`]);
      }
      summary.getColumn(1).width = 34;
      summary.getColumn(2).width = 80;
      summary.views = [{ state: 'frozen', ySplit: 1 }];
      summary.getRow(1).font = { bold: true };
    }

    return workbook.xlsx.writeBuffer();
  }
}

module.exports = { DuplicateExcelExportService, XLSX_MIME, validateOptions, escapeFormulaText, profileKey, displayIdentifier };
