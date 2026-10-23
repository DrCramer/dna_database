const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { prepareMasterExport, decodeMasterRow, requireExportAdmin } = require('../src/services/converters/masterArrayExcelExportService');
const { createImportWorkbook, MASTER_EXPORT_FORMAT, ASSIGNED_HEADER } = require('../src/utils/importWorkbook');
const { ExcelService } = require('../src/services/converters/excelService');
const { LociTypeDetector, ALL_LOCI } = require('../src/utils/lociTypeDetector');
const { isSexLocus } = require('../src/utils/normalizedExcelLayout');
const { validateGeneticHeaders } = require('../src/utils/profileImportFormat');
const { FileValidationService } = require('../src/services/converters/fileValidationService');
const excel = new ExcelService();
const data = { TH01: ['9.3', '9.3'], D5S818: ['8', '8'], D21S11: ['21.2', '29'] };
const row = (id, extras = {}) => ({ id, year: 2026, sample_name: '258', internal_number: `258-${id}`, import_number: '12', str_data: structuredClone(data), metadata: {}, ...extras });
const workbook = (prepared, importFormat = 'genetic', hideEmptyLoci = true) => createImportWorkbook({ profiles: prepared.profiles, loci: prepared.loci, importFormat, hideEmptyLoci, sourceFormat: MASTER_EXPORT_FORMAT });

test('Мастер-экспорт: 620 записей, полный номер, текстовые аллели и настоящий round-trip XLSX', async () => {
  const rows = Array.from({ length: 620 }, (_, index) => row(index + 1));
  const original = structuredClone(rows);
  const result = prepareMasterExport(rows, 'genetic');
  assert.equal(result.summary.exportable, 620);
  assert.equal(result.summary.needsReview, 0);
  const buffer = workbook(result);
  assert(new FileValidationService().validateFile(buffer, 'master.xlsx', { importFormat: 'genetic' }).valid);
  const book = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  assert.deepEqual(book.SheetNames, ['Импорт']);
  const sheet = book.Sheets['Импорт'];
  assert.equal(sheet.A1.v, 'Объект'); assert.equal(sheet.B1.v, 'Год');
  const records = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.equal(records.length, 621); assert.equal(records[1][0], '258-1'); assert.equal(records[2][0], '258-2');
  assert(validateGeneticHeaders(records[0]).valid);
  const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: records[0].indexOf('TH01') })];
  assert.equal(cell.v, '9.3,9.3'); assert.equal(cell.t, 's'); assert.equal(cell.z, '@'); assert.equal(cell.f, undefined);
  const parsed = await excel.parseExcelFile(buffer, 'master.xlsx', { importFormat: 'genetic' });
  assert.equal(parsed.length, 620); assert.equal(parsed[0].sampleName, '258');
  assert.deepEqual(parsed[0].strData, data);
  assert.deepEqual(rows, original);
});

test('Все локусы и панели, одиночные вызовы, спецтокены и половые локусы сохраняются без потерь', async () => {
  const detector = new LociTypeDetector();
  const loci = Object.fromEntries(ALL_LOCI.map(name => [name, name === 'SRY' ? ['SRY'] : detector.detectLocusType(name) === 'Y_INDEL' ? ['1'] : detector.detectLocusType(name) === 'AMELOGENIN' ? ['X', 'Y'] : detector.detectLocusType(name) === 'SNP' ? ['A', 'T'] : ['8', '8']]));
  Object.assign(loci, { TH01: ['?'], D5S818: ['*'], D21S11: ['F'], FGA: ['20', '21.2', '22'], D3S1358: ['12'], Yindel: ['1'], DYS391: ['10'] });
  const result = prepareMasterExport([row(1, { str_data: loci, metadata: { panelLociOrder: ['D3S1358', 'TH01', 'SRY'] } }), row(2)], 'genetic');
  assert.equal(result.summary.needsReview, 0, JSON.stringify(result.summary.reasons));
  assert.equal(result.loci.length, ALL_LOCI.length);
  const firstSex = result.loci.findIndex(isSexLocus);
  assert(result.loci.slice(firstSex).every(isSexLocus));
  assert.equal(result.loci[0], 'D3S1358');
  const parsed = await excel.parseExcelFile(workbook(result), 'all-loci.xlsx', { importFormat: 'genetic' });
  for (const [locus, alleles] of Object.entries(loci)) {
    const compact = locus === 'DXS6795' || /^RS\d+$/i.test(locus);
    assert.deepEqual(parsed[0].strData[locus], compact && alleles.length === 2 && alleles[0] === alleles[1] ? [alleles[0]] : alleles, locus);
  }
});

test('ЧС: реальные legacy-заголовки и обратное сопоставление полей', async () => {
  const source = row(1, { sample_name: '5678', internal_number: '258-1', import_number: '12' });
  const result = prepareMasterExport([source], 'emergency');
  assert.equal(result.summary.needsReview, 0, JSON.stringify(result.summary.reasons));
  const output = workbook(result, 'emergency');
  assert(new FileValidationService().validateFile(output, 'emergency.xlsx', { importFormat: 'emergency' }).valid);
  const sheet = XLSX.read(output).Sheets['Импорт'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.deepEqual(rows[0].slice(0, 4), [ASSIGNED_HEADER, 'Привоз', 'Год', 'Sample Name']);
  assert.deepEqual(rows[1].slice(0, 4), ['5678', '12', '2026', '258-1']);
  const [parsed] = await excel.parseExcelFile(output, 'emergency.xlsx', { importFormat: 'emergency' });
  assert.equal(parsed.sampleName, '5678'); assert.equal(parsed.importNumber, '12'); assert.equal(parsed.internalNumber, '258-1');
  assert.deepEqual(parsed.strData, data);
  assert.equal(prepareMasterExport([row(2, { import_number: null })], 'emergency').summary.exportable, 0);
  assert.equal(prepareMasterExport([row(2, { import_number: 'неизвестно' })], 'emergency').summary.exportable, 0);
  for (const year of [1900, 2100]) {
    const edge = prepareMasterExport([{ ...source, year }], 'emergency');
    const [restored] = await excel.parseExcelFile(workbook(edge, 'emergency'), 'year.xlsx', { importFormat: 'emergency' });
    assert.equal(restored.year, year);
  }
});

test('Исторические проблемы и конфликты не исправляются и не скрываются дедупликацией', () => {
  const rows = [row(1), row(2, { year: null }), row(3, { internal_number: '' }), row(4, { str_data: { UNKNOWN: ['7'] } }), row(5, { str_data: { ...data, TH01: ['=1+1'] } }), row(6, { internal_number: '258-1' }), row(7, { internal_number: '258-7', year: 2025 }), row(8, { str_data: { ...data, th01: ['7', '9'] } })];
  const result = prepareMasterExport(rows, 'genetic');
  assert.equal(result.summary.exportable, 1); assert.equal(result.summary.needsReview, 7); assert.equal(result.summary.canExport, false);
  assert(result.summary.reasons.filter(reason => reason.problems.some(problem => problem.code === 'DUPLICATE_OBJECT_YEAR')).length === 2);
  const only = prepareMasterExport(rows, 'genetic', { exportValidOnly: true });
  assert.equal(only.summary.totalExportRows, 1); assert.equal(only.summary.canExport, true);
  assert(!JSON.stringify(result.summary).includes('strData'));
  assert.equal(prepareMasterExport([], 'genetic').summary.canExport, false);
});

test('Пустые локусы только скрываются, метаданные всегда видимы; формулы остаются текстом', () => {
  const source = row(1, { internal_number: '=1+1', str_data: { ...data, SRY: [] } });
  const result = prepareMasterExport([source], 'genetic', { includeCatalogLoci: true });
  assert.equal(result.summary.exportable, 1);
  const book = XLSX.read(workbook(result), { cellStyles: true });
  const sheet = book.Sheets['Импорт'];
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
  assert.equal(sheet.A2.t, 's'); assert.equal(sheet.A2.v, '=1+1'); assert.equal(sheet.A2.f, undefined);
  assert(!sheet['!cols'][0].hidden); assert(!sheet['!cols'][1].hidden);
  assert(sheet['!cols'][headers.indexOf('SRY')].hidden);
  assert(!sheet['!cols'][headers.indexOf('TH01')].hidden);
});

test('Административная роль проверяется отдельно; зашифрованные строки читаются без обновления', () => {
  for (const role of ['admin', 'system_administrator']) assert.doesNotThrow(() => requireExportAdmin({ role }));
  for (const role of ['department_head', 'user_analyst', 'viewer', 'analyst']) assert.throws(() => requireExportAdmin({ role }), { status: 403 });
  const { encryptBytes } = require('../src/services/security/cryptoPrimitives');
  const key = Buffer.alloc(32, 7), encrypted = encryptBytes(JSON.stringify(data), key, 'aes-256-gcm');
  const original = row(1, { str_data: {}, str_data_encrypted: JSON.stringify({ algorithm: 'aes-256-gcm', iv: encrypted.iv.toString('base64'), data: encrypted.data.toString('base64'), authTag: encrypted.authTag.toString('base64') }) });
  assert.deepEqual(decodeMasterRow(original, key).str_data, data);
  assert.deepEqual(original.str_data, {});
});
