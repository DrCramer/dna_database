// Номер реестра ЧС приходит из Excel. Он не является номером объекта/экспертизы.
const ASSIGNED_HEADER = '№ присвоенный в в/ч № 522 ЦПООП Северо-Кавказского военного округа, г. Ростов-на-Дону';
const text = value => String(value ?? '').trim();
function isAssignedNumberHeader(value) {
  return /^(?:№\s*)?присвоенный\s+в\s+в\s*[/\\]\s*ч(?:\s|$)/i.test(text(value));
}
function getAssignedNumber(row = {}) {
  if (Object.hasOwn(row, 'assignedNumber')) return text(row.assignedNumber);
  const provenance = row.provenance || row.metadata?.provenance || {};
  if (Object.hasOwn(provenance, 'assignedNumber')) return text(provenance.assignedNumber);
  const cells = Array.isArray(provenance.legacyColumns) ? provenance.legacyColumns : Object.entries(provenance.legacyCells || {}).map(([header, value]) => ({ header, value }));
  const values = [...new Set(cells.filter(cell => cell && isAssignedNumberHeader(cell.header)).map(cell => text(cell.value)).filter(Boolean))];
  if (values.length) return values.length === 1 ? values[0] : '';
  // В старом формате ЧС sample_name хранил именно присвоенный номер.
  const legacy = provenance.legacy || {};
  if ([row.import_format, row.metadata?.importFormat, legacy.import_format, legacy.metadata?.importFormat].includes('emergency')) {
    return text(row.sample_name ?? legacy.sample_name ?? provenance.sampleName);
  }
  return '';
}
module.exports = { ASSIGNED_HEADER, isAssignedNumberHeader, getAssignedNumber };
