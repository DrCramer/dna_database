const ExcelJS = require('exceljs');
const { getAnalysisLoci, profileLoci } = require('../../utils/analysisLoci');
const { orderNormalizedLoci } = require('../../utils/normalizedExcelLayout');
const { formatLocusValue, normalizeMatchColors } = require('../../utils/locusComparisonPresentation');
const { staffComparisonGroups, getStaffLocusPresentation, getStaffSamplePresentation } = require('../../utils/staffComparisonPresentation');

const argb = color => `FF${color.slice(1).toUpperCase()}`;
const fill = color => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(color) } });
function foreground(color) {
  if (!color) return 'FF142019';
  const [r, g, b] = color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? 'FF142019' : 'FFFFFFFF';
}
function text(cell, value) {
  // Explicit strings (including strings beginning with '=') are XLSX text,
  // never ExcelJS formula/hyperlink objects supplied by uploaded metadata.
  cell.value = String(value ?? '');
  cell.numFmt = '@';
}
function locusCell(cell, raw, presentation) {
  text(cell, formatLocusValue(raw) || '—');
  const color = foreground(presentation.backgroundColor);
  cell.font = { name: 'Calibri', size: 11, color: { argb: color } };
  if (presentation.backgroundColor) cell.fill = fill(presentation.backgroundColor);
  if (presentation.alleles.some(allele => allele.matched)) {
    const runs = [];
    presentation.alleles.forEach((allele, index) => {
      if (index) runs.push({ text: ',', font: { color: { argb: color } } });
      runs.push({ text: allele.value, font: allele.matched
        ? { color: { argb: argb(presentation.colors.partialMatchAllele) }, bold: true, underline: true }
        : { color: { argb: color } } });
    });
    cell.value = { richText: runs };
  }
}

class StaffContaminationExcelExportService {
  async createWorkbookBuffer({ result, colors }) {
    const groups = staffComparisonGroups(result.staff || [], result.staffProfiles);
    if (!groups.length) throw Object.assign(new Error('Нет найденных контаминаций сотрудников для выгрузки.'), { status: 400 });
    if (1 + groups.reduce((count, group) => count + 1 + group.matches.length, 0) > 1048576) {
      throw Object.assign(new Error('Результат превышает число строк листа Excel. Выполните поиск для меньшего количества объектов.'), { status: 413 });
    }
    const palette = normalizeMatchColors(colors), ignoredLoci = new Set(result.parameters?.staffOptions?.ignoredLoci ?? result.parameters?.ignoredLoci ?? []);
    const loci = orderNormalizedLoci(getAnalysisLoci(groups.flatMap(group => [group.reference, ...group.matches])));
    const headers = ['Роль', 'Объект / сотрудник', '№ регистрации', 'Год', 'Оценка', 'Совпавшие локусы', ...loci];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DNA Database';
    const sheet = workbook.addWorksheet('Контаминации');
    sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];
    sheet.properties.defaultRowHeight = 24;
    sheet.columns = headers.map((header, i) => ({ width: [16, 32, 22, 10, 14, 20][i] || Math.max(12, header.length + 2) }));
    sheet.addRow(headers);
    sheet.getRow(1).height = 34;
    sheet.getRow(1).eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF17212B' } };
      cell.fill = fill('#E8EEF4');
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    function addRow(values, raw, presentations, reference = false) {
      const row = sheet.addRow([]);
      values.forEach((value, i) => {
        const cell = row.getCell(i + 1);
        if (typeof value === 'number' && Number.isFinite(value)) cell.value = value;
        else text(cell, value);
        cell.font = { name: 'Calibri', size: 11, bold: reference, color: { argb: 'FF142019' } };
        if (reference) cell.fill = fill('#EAF2F8');
      });
      loci.forEach((locus, i) => locusCell(row.getCell(7 + i), raw[locus], presentations[locus]));
      row.eachCell((cell, column) => {
        cell.alignment = { horizontal: column === 2 ? 'left' : 'center', vertical: 'middle', wrapText: column <= 3 };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFD7DEE5' } }, right: { style: 'hair', color: { argb: 'FFD7DEE5' } } };
      });
      row.height = Math.max(24, ...values.slice(0, 3).map((value, i) => Math.ceil(String(value ?? '').length / Math.max(1, sheet.getColumn(i + 1).width - 2)) * 15 + 8));
    }
    for (const group of groups) {
      const reference = profileLoci(group.reference);
      const comparisons = group.matches.map(match => {
        const data = profileLoci(match), evidence = new Map((match.staffEvidence.detailedMatches || []).map(detail => [detail.locus, detail]));
        const cells = Object.fromEntries(loci.map(locus => [locus, getStaffLocusPresentation({
          sampleData: reference[locus], staffData: data[locus], detail: evidence.get(locus), locus, ignoredLoci, colors: palette
        })]));
        return { match, data, cells };
      });
      const sampleCells = Object.fromEntries(loci.map(locus => [locus, getStaffSamplePresentation({ sampleData: reference[locus], comparisons: comparisons.map(item => item.cells[locus]), colors: palette })]));
      addRow(['Объект', group.reference.internal_number ?? 'Без номера', '', group.reference.year ?? '—', '—', '—'], reference, sampleCells, true);
      for (const { match, data, cells } of comparisons) {
        const score = match.staffEvidence.finalScore ?? match.staffEvidence.score ?? match.staffEvidence.contaminationScore ?? '—';
        addRow(['Сотрудник', match.full_name, match.internal_number, match.year ?? '—', score, Object.values(cells).filter(cell => cell.status === 'full').length], data, cells);
      }
    }
    const legend = workbook.addWorksheet('Обозначения');
    legend.columns = [{ width: 35 }, { width: 100 }];
    for (const [label, value, color] of [
      ['Полное совпадение', 'Классификация алгоритма контаминации (зелёные локусы входят в счётчик).', palette.fullMatch],
      ['Частичное совпадение', 'Классификация алгоритма контаминации, включая смеси и выпадение аллелей.', palette.partialMatch],
      ['Нет совпадения', 'Алгоритм не нашёл учтённых совпавших аллелей.', palette.noMatch],
      ['Подчёркнутые аллели', 'Аллели, учтённые алгоритмом; выделены в строке объекта и сотрудника.'],
      ['Строка объекта', 'Объединяет учтённые аллели всех найденных сотрудников этого объекта.'],
      ['Без подсветки', 'Нет данных, локус исключён или не участвовал в сравнении.'],
      ['Исключённые локусы', [...ignoredLoci].join(', ') || 'Нет'],
      ['Результат поиска', result.id || ''],
      ...(groups.some(group => group.reference.normalizedEvidenceOnly || group.matches.some(match => match.normalizedEvidenceOnly))
        ? [['Старый результат', 'Показаны аллели из сохранённых деталей анализа. Для полного исходного профиля со специальными значениями выполните поиск заново.']] : [])
    ]) {
      const row = legend.addRow([]);
      text(row.getCell(1), label); text(row.getCell(2), value);
      row.getCell(1).font = { bold: true, color: { argb: foreground(color) } };
      if (color) row.getCell(1).fill = fill(color);
      row.alignment = { vertical: 'middle', wrapText: true };
      row.height = 36;
    }
    return workbook.xlsx.writeBuffer();
  }
}
module.exports = { StaffContaminationExcelExportService };
