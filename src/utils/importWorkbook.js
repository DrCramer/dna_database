const XLSX = require('xlsx');
const { orderNormalizedLoci } = require('./normalizedExcelLayout');
const { isMissingAllele } = require('./alleleTokens');
const { formatExportLocusValue } = require('./exportAlleles');

const ASSIGNED_HEADER = '№ присвоенный в в/ч № 522 ЦПООП Северо-Кавказского военного округа, г. Ростов-на-Дону';
const MASTER_EXPORT_FORMAT = 'MASTER_ARRAY_EXPORT';

function createImportWorkbook({ profiles, loci, importFormat = 'genetic', sourceFormat, hideEmptyLoci = false }) {
  const book = XLSX.utils.book_new();
  if (sourceFormat) book.Custprops = { DNAProfileSourceFormat: sourceFormat };
  const exportLoci = orderNormalizedLoci(loci);
  const emergency = importFormat === 'emergency';
  const metadataColumns = emergency ? 4 : 2;
  const headers = [...(emergency ? [ASSIGNED_HEADER, 'Привоз', 'Год', 'Sample Name'] : ['Объект', 'Год']), ...exportLoci];
  const rows = [headers, ...profiles.map(profile => [
    ...(emergency ? [profile.emergency.assignedNumber, profile.emergency.shippingNumber, profile.year ?? '', profile.objectNumber] : [profile.objectNumber, profile.year ?? '']),
    ...exportLoci.map(locus => formatExportLocusValue(profile.strData[locus], locus))
  ])];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const columns = headers.map((header, index) => ({ wch: Math.min(40, Math.max(12, header.length + 2)), hidden: hideEmptyLoci && index >= metadataColumns }));
  rows.slice(1).forEach((row, rowIndex) => row.forEach((value, column) => {
    // Явные строковые ячейки: =, +, @ и управляющие символы не становятся формулами.
    const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: column });
    sheet[address] = { t: 's', v: String(value ?? ''), z: '@' };
    if (!isMissingAllele(value)) {
      columns[column].hidden = false;
      columns[column].wch = Math.max(columns[column].wch, Math.min(40, String(value).length + 2));
    }
  }));
  sheet['!cols'] = columns;
  XLSX.utils.book_append_sheet(book, sheet, 'Импорт');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
}

module.exports = { createImportWorkbook, ASSIGNED_HEADER, MASTER_EXPORT_FORMAT };
