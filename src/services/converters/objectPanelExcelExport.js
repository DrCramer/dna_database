const ExcelJS = require('exceljs');
const { panels, allLociPanel } = require('../../data/objectExportPanels.json');
const { formatDateOnlyRu } = require('../../utils/dateFormatter');
const { LociTypeDetector } = require('../../utils/lociTypeDetector');
const { formatLocusValue } = require('../../utils/locusComparisonPresentation');

const detector = new LociTypeDetector();
const MAX_CELL_TEXT = 32767;

class ObjectPanelExportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function locusKey(name) {
  return (detector.getCanonicalLocusName(name) || detector.normalizeName(name)).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function genotypeText(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = { allele1: value.allele1 ?? value.Allele1 ?? value.a1, allele2: value.allele2 ?? value.Allele2 ?? value.a2 };
  }
  return formatLocusValue(value) || '-';
}

function colorHeader(row, fill, fontColor) {
  for (const column of [1, 2]) {
    const cell = row.getCell(column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    if (cell.value != null) cell.font = { bold: true, ...(fontColor && { color: { argb: fontColor } }) };
  }
}

async function createObjectPanelWorkbook(object, selection, exportedAt = new Date()) {
  const selected = typeof selection === 'string' ? [selection] : selection;
  if (!Array.isArray(selected) || !selected.length || selected.length > Object.keys(panels).length + 1 ||
      new Set(selected).size !== selected.length ||
      selected.some(name => typeof name !== 'string' || name !== allLociPanel && !Object.hasOwn(panels, name))) {
    throw new ObjectPanelExportError('Выберите одну или несколько доступных панелей для Excel.');
  }

  let data = object.str_data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  const loci = data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data) : [];
  const indexed = new Map();
  const conflicts = new Set();
  for (const [locus, value] of loci) {
    const key = locusKey(locus);
    const genotype = genotypeText(value);
    if (genotype === '-') continue;
    if (indexed.has(key) && indexed.get(key) !== genotype) conflicts.add(key);
    indexed.set(key, genotype);
  }

  const objectName = String(object.internal_number || object.sample_name || object.fullName || 'Объект')
    .replace(/^\.__pending__[0-9a-f]{32}_/i, '').replace(/_\d{6,8}genetic marker report$/i, '');
  const worksheetName = objectName.replace(/[:\\/\[\]*?\u0000-\u001f]/g, '_').trim()
    .slice(0, 31).replace(/[\uD800-\uDBFF]$/u, '').replace(/^'+|'+$/g, '').trim();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(worksheetName && !/^history$/i.test(worksheetName) ? worksheetName : 'Объект');
  sheet.getColumn(1).width = 25;
  sheet.getColumn(2).width = 30;

  for (const [index, panel] of selected.entries()) {
    const rows = panel === allLociPanel ? loci.map(([locus, value]) => [locus, genotypeText(value)])
      : panels[panel].map(locus => {
        const key = locusKey(locus);
        if (conflicts.has(key)) throw new ObjectPanelExportError(`В записи есть разные значения для локуса «${locus}». Сверьте его в карточке объекта.`, 409);
        return [locus, indexed.get(key) ?? '-'];
      });
    if (rows.some(([locus, genotype]) => locus.length > MAX_CELL_TEXT || genotype.length > MAX_CELL_TEXT)) {
      throw new ObjectPanelExportError('Значение локуса превышает допустимую длину ячейки Excel.', 422);
    }
    if (index) sheet.addRow([]);
    colorHeader(sheet.addRow([panel]), 'FFD0D8FF');
    colorHeader(sheet.addRow(['Locus', 'Genotype']), 'FF4361EE', 'FFFFFFFF');
    sheet.addRows(rows);
  }

  const [day, month, year] = formatDateOnlyRu(exportedAt).split('.');
  const panelName = selected[0] === 'A29+' ? 'A29' : selected[0];
  const suffix = selected.length === 1 ? panelName : [day, month, year.slice(-2)].join('-');
  const clean = value => value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/^[ .]+|[ .]+$/g, '');
  const stem = `${clean(objectName) || 'Объект'}_${clean(suffix)}`;
  const filename = Buffer.from(stem).subarray(0, 240).toString('utf8').replace(/[ .\uFFFD]+$/u, '') + '.xlsx';
  return { filename, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

module.exports = { createObjectPanelWorkbook, ObjectPanelExportError };
