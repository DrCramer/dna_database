const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { GeneticExcelConverterService } = require("../src/services/converters/geneticExcelConverterService");
const { detectSourceFormat, NGS_FORMAT } = require("../src/services/converters/geneticSourceDetector");
const { parseNgsAstrWorkbook, suggestObjectNumber } = require("../src/services/converters/ngsAstrExcelParser");
const { ExcelService } = require("../src/services/converters/excelService");
const { LociTypeDetector } = require('../src/utils/lociTypeDetector');
const { getAnalysisLoci } = require('../src/utils/analysisLoci');
const { GenotypePanel } = require('../src/models/GenotypePanel');
const resultHeaders = ['#Type', 'Locus', 'Allele Coverage (Count) Ratio', 'Genotype', 'QC Flag', 'Total Depth of Coverage', 'Allele Depth of Coverage'];
const detailHeaders = ['#Type', 'Locus', 'Allele', 'Flanking SNP', 'QC Flag', 'Proportion', 'Coverage', 'Structure', 'Repeat Region', 'Upstream Flanking Region', 'Downstream Flanking Region'];
const standard = [
  { locus: 'TH01', genotype: '9,9.3' },
  { locus: 'D5S818', genotype: '11,12' },
  { locus: 'D21S11', genotype: '29,30' },
  { locus: 'AMELX', genotype: 'X', type: 'SEXUAL' },
  { locus: 'AMELY', genotype: 'Y', type: 'SEXUAL' }
];
function workbook(entries = standard, { detail = true, reorder = false, extraDetail = [] } = {}) {
  const book = XLSX.utils.book_new();
  let results = [resultHeaders, ...entries.map(entry => [entry.type || 'ASTR', entry.locus, '75.52%', entry.genotype, entry.qc ?? 'Pass', entry.coverage ?? 100, 'not genotype'])];
  let details = [detailHeaders, ...entries.flatMap(entry => (entry.details || [...new Set(entry.genotype.split(',').filter(value => value !== '-'))].map(allele => ({ allele }))).map(row => [row.type || entry.type || 'ASTR', entry.locus, row.allele, row.flankingSnp || '', row.qc ?? 'Pass', '50%', row.coverage ?? 50, row.structure || '', row.sequence || '', row.upstream || '', row.downstream || ''])), ...extraDetail];
  if (reorder) { results = results.map(row => [...row].reverse()); details = details.map(row => [...row].reverse()); results[0] = results[0].map(name => ` ${name.toUpperCase()} `); details[0] = details[0].map(name => ` ${name.toLowerCase()} `); }
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(results), reorder ? ' result ' : 'Result');
  if (detail) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(details), reorder ? 'DETAIL' : 'Detail');
  return book;
}
function source(entries = standard, options = {}) {
  return { originalname: options.name || 'r2.251-3_20260714.ASTR+.xlsx', buffer: XLSX.write(workbook(entries, options), { type: 'buffer', bookType: 'xlsx' }) };
}
function confirmed(converter, files, overrides = {}, panels = []) {
  const initial = converter.convert(files, {}, panels);
  const options = { files: Object.fromEntries(initial.files.map((file, index) => [file.id, { year: 2026, objectNumber: `251-${index + 1}`, objectConfirmed: true, ...overrides }])) };
  return { options, result: converter.convert(files, options, panels) };
}
function record(result, locus, index = 0) { return result.files[index].ngs.records.find(entry => entry.locus === locus); }
function decide(converter, files, options, result, locus, decision) {
  options.cells = { ...options.cells, [record(result, locus).cell.id]: { ...decision, reason: 'Решение эксперта', timestamp: '2026-10-13T08:00:00.000Z' } };
  return converter.convert(files, options);
}

test('NGS определяется содержимым, устойчив к регистру и перестановке; обычный Excel остаётся legacy', () => {
  for (const reorder of [false, true]) {
    const book = workbook(standard, { reorder });
    const detection = detectSourceFormat(book);
    assert.equal(detection.format, NGS_FORMAT); assert.equal(detection.confidence, 'HIGH');
    const parsed = parseNgsAstrWorkbook(book, detection);
    assert.equal(parsed.records.find(row => row.locus === 'TH01').rawGenotype, '9,9.3');
  }
  const old = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(old, XLSX.utils.aoa_to_sheet([['Объект', 'TH01', 'D5S818']]));
  assert.equal(detectSourceFormat(old).format, 'LEGACY_TABLE');
});

test('Один NGS-файл — один объект; filename предлагает номер, но не подтверждает его', () => {
  const converter = new GeneticExcelConverterService(), files = [source()];
  const initial = converter.convert(files);
  assert.equal(initial.files[0].ngs.suggestedObjectNumber, '251-3');
  assert.equal(initial.canImport, false); assert(initial.issues.some(issue => issue.code === 'NGS_OBJECT_REQUIRED'));
  assert.throws(() => converter.export(initial), /ошибки/);
  assert.equal(suggestObjectNumber('20260714.xlsx'), ''); assert.equal(suggestObjectNumber('ASTR+.xlsx'), '');
  assert.equal(suggestObjectNumber('r2_20260714.ASTR+.xlsx'), '');
  const { result } = confirmed(converter, files, { objectNumber: '251-3' });
  assert.equal(result.canUpload, true, JSON.stringify(result.issues));
  assert.equal(result.profiles.length, 1); assert.equal(result.profiles[0].objectNumber, '251-3');
  assert.deepEqual(result.profiles[0].strData.TH01, ['9', '9.3']);
  assert.deepEqual(result.profiles[0].strData.AMEL, ['X', 'Y']);
  assert(!result.sourceLoci.includes('AMELX'));
});

test('Нет Detail или AMELY: нет ложного подтверждения, Y и гомозигота не добавляются', () => {
  const converter = new GeneticExcelConverterService();
  const limited = confirmed(converter, [source(standard, { detail: false })]).result;
  assert.equal(limited.canImport, false); assert(limited.issues.some(issue => issue.code === 'NGS_DETAIL_MISSING'));
  const files = [source(standard.filter(entry => entry.locus !== 'AMELY'))];
  const { options, result } = confirmed(converter, files);
  assert.equal(result.canImport, false); assert(result.issues.some(issue => issue.code === 'NGS_AMEL_INCOMPLETE'));
  assert.deepEqual(result.profiles[0].strData.AMEL, ['X']);
  const reviewed = decide(converter, files, options, result, 'AMEL', { action: 'keep' });
  assert(reviewed.canImport); assert.deepEqual(reviewed.profiles[0].strData.AMEL, ['X']);
});

test('Low Coverage + Failed + пустой Genotype сохраняет пустую ячейку и исходное QC', () => {
  const converter = new GeneticExcelConverterService();
  const { result } = confirmed(converter, [source([...standard, { locus: 'D19S433', genotype: '-', qc: 'Low Coverage', coverage: 0, details: [{ allele: '-', qc: 'Failed', coverage: 0 }] }])]);
  assert(result.canImport, JSON.stringify(result.issues)); assert.deepEqual(result.profiles[0].strData.D19S433, []);
  assert.equal(record(result, 'D19S433').qc.status, 'MISSING');
  const audit = result.profiles[0].audit.find(entry => entry.locus === 'D19S433');
  assert.equal(audit.ngs.resultRows[0].qcFlag, 'Low Coverage'); assert.equal(audit.ngs.detailRows[0].qcFlag, 'Failed');
});

test('Смесь не обрезается; два Pass — только предложение; явное решение сохраняет полный аудит', async () => {
  const converter = new GeneticExcelConverterService();
  const files = [source([...standard, { locus: 'D18S51', genotype: '7,9,13.2,16,18', qc: 'Imbalance;Stutter', details: [
    { allele: '7', qc: 'Imbalance', coverage: 110 }, { allele: '9', qc: 'Stutter', coverage: 84 }, { allele: '13.2', qc: 'Stutter', coverage: 84 }, { allele: '16', coverage: 540 }, { allele: '18', coverage: 480 }
  ] }])];
  const { options, result } = confirmed(converter, files);
  assert.equal(result.canImport, false); assert.deepEqual(result.profiles[0].strData.D18S51, ['7', '9', '13.2', '16', '18']);
  assert.equal(record(result, 'D18S51').qc.suggestedValue, '16,18');
  const kept = decide(converter, files, options, result, 'D18S51', { action: 'keep' });
  assert(kept.canImport); assert(kept.profiles[0].audit.find(entry => entry.locus === 'D18S51').ngs.multiAllelicConfirmed);
  const parsedKept = await new ExcelService().parseExcelFile(converter.export(kept), 'multi.xlsx', { importFormat: 'genetic' });
  assert.deepEqual([...parsedKept[0].strData.D18S51], ['7', '9', '13.2', '16', '18']);
  const chosen = decide(converter, files, options, result, 'D18S51', { action: 'manual', value: '16,18' });
  assert(chosen.canImport); assert.deepEqual(chosen.profiles[0].strData.D18S51, ['16', '18']);
  const audit = chosen.profiles[0].audit.find(entry => entry.locus === 'D18S51');
  assert.equal(audit.ngs.rawGenotype, '7,9,13.2,16,18'); assert.equal(audit.ngs.detailRows.length, 5);
  assert.equal(audit.userDecision.timestamp, '2026-10-13T08:00:00.000Z');
  assert(audit.ngs.qc.issues.some(issue => issue.code === 'NGS_QC_WARNING'));
});

test('NGS сохраняет одиночную аллель и исходную гомозиготную пару в XLSX', () => {
  const converter = new GeneticExcelConverterService(), files = [source([...standard, { locus: 'D10S1435', genotype: '12' }])];
  const { options, result } = confirmed(converter, files);
  assert(result.canUpload, JSON.stringify(result.issues));
  assert.deepEqual(result.profiles[0].strData.D10S1435, ['12']);
  assert.equal(record(result, 'D10S1435').rawGenotype, '12');
  const sheet = XLSX.read(converter.export(result), { type: 'buffer' }).Sheets['Импорт'];
  assert.equal(XLSX.utils.sheet_to_json(sheet)[0].D10S1435, '12');
  const pair = confirmed(converter, [source([...standard, { locus: 'D10S1435', genotype: '12,12' }])]).result;
  assert(pair.canUpload, JSON.stringify(pair.issues));
  assert.deepEqual(pair.profiles[0].strData.D10S1435, ['12', '12']);
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(converter.export(pair), { type: 'buffer' }).Sheets['Импорт'])[0].D10S1435, '12,12');
  const homo = decide(converter, files, options, result, 'D10S1435', { action: 'homozygous' });
  assert(homo.canImport); assert.deepEqual(homo.profiles[0].strData.D10S1435, ['12', '12']);
  const unknown = decide(converter, files, options, result, 'D10S1435', { action: 'unknown' });
  assert(unknown.canImport); assert.deepEqual(unknown.profiles[0].strData.D10S1435, ['12', '?']);
});

test('NGS: одиночное значение сохраняется, но сомнительный QC требует подтверждения', () => {
  for (const qc of ['Low Coverage', 'Imbalance', '']) {
    const converter = new GeneticExcelConverterService();
    const files = [source([...standard, { locus: 'D10S1435', genotype: '12', qc }])];
    const { options, result } = confirmed(converter, files);
    assert.equal(result.canImport, false, qc);
    assert.deepEqual(result.profiles[0].strData.D10S1435, ['12']);
    assert(record(result, 'D10S1435').cell.hard);
    const kept = decide(converter, files, options, result, 'D10S1435', { action: 'keep' });
    assert(kept.canUpload, JSON.stringify(kept.issues));
    assert.deepEqual(kept.profiles[0].strData.D10S1435, ['12']);
    assert.equal(XLSX.utils.sheet_to_json(XLSX.read(converter.export(kept), { type: 'buffer' }).Sheets['Импорт'])[0].D10S1435, '12');
  }
});

test('Stutter, неизвестный QC, Failed с genotype, различия Result/Detail требуют проверки', () => {
  const converter = new GeneticExcelConverterService();
  const cases = [
    { qc: 'Unfamiliar Flag' }, { qc: 'Failed' },
    { details: [{ allele: '7.2', qc: 'Stutter' }, { allele: '13.2' }] },
    { details: [{ allele: '7.2' }, { allele: '14.2' }] }
  ];
  for (const entry of cases) {
    const { result } = confirmed(converter, [source([...standard, { locus: 'D18S51', genotype: '7.2,13.2', ...entry }])]);
    assert(!result.canImport); assert(record(result, 'D18S51').cell.hard);
    assert.deepEqual(result.profiles[0].strData.D18S51, ['7.2', '13.2']);
  }
});

test('Sequence-варианты одной длиновой аллели не образуют гомозиготу и не теряются', () => {
  const converter = new GeneticExcelConverterService();
  const { result } = confirmed(converter, [source([...standard, { locus: 'VWA', genotype: '15,16', details: [{ allele: '15', sequence: 'ATCT' }, { allele: '15', sequence: 'ATCC' }, { allele: '16', sequence: 'ATCTATCT' }] }])]);
  assert(!result.canImport); assert.equal(record(result, 'vWA').detailRows.length, 3);
  assert.deepEqual(result.profiles[0].strData.vWA, ['15', '16']);
  assert(record(result, 'vWA').qc.issues.some(issue => issue.code === 'NGS_SEQUENCE_VARIANTS'));
});

test('Все 111 ASTR, AMEL, aliases и новые STR проходят панель, импорт и анализ', async () => {
  const converter = new GeneticExcelConverterService();
  const extra = require('./fixtures/ngs-astr-marker-names');
  assert.equal(extra.length, 111);
  const detector = new LociTypeDetector();
  const files = [source([...extra.map(locus => ({ locus, genotype: '7.2,13.2' })), ...standard.filter(entry => entry.type === 'SEXUAL')])];
  const panel = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Проверенная панель', lociOrder: ['Penta E', 'AMEL', 'AC001348B', 'TH01'] };
  const { result } = confirmed(converter, files, { panelId: panel.id }, [panel]);
  assert(result.canUpload, JSON.stringify(result.issues));
  assert.equal(result.files[0].ngs.resultCount, 113);
  assert.deepEqual(result.files[0].ngs.locusReport.unknown, []);
  assert.equal(result.sourceLoci.length, 112);
  assert.equal(result.profiles[0].detectedPanelId, panel.id);
  const buffer = converter.export(result, { hideEmptyLoci: true }), book = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['Импорт'], { header: 1 })[0].slice(0, 5), ['Объект', 'Год', 'Penta E', 'AC001348B', 'TH01']);
  const sheet = book.Sheets['Импорт'];
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
  assert(sheet['!cols'][headers.indexOf('DYS391')].hidden);
  assert(!sheet['!cols'][headers.indexOf('AMEL')].hidden);
  assert.deepEqual(book.SheetNames, ['Импорт']);
  assert.deepEqual(book.Workbook.Sheets.filter(sheet => !sheet.Hidden).map(sheet => sheet.name), ['Импорт']);
  const [parsed] = await new ExcelService().parseExcelFile(buffer, 'normalized.xlsx', { importFormat: 'genetic' });
  for (const name of extra) assert.deepEqual(parsed.strData[detector.getCanonicalLocusName(name)], ['7.2', '13.2']);
  assert.equal(parsed.metadata.conversion, undefined);
  assert.equal(result.profiles[0].detectedPanelId, panel.id);
  assert.equal(result.profiles[0].sources[0].sourceFormat, NGS_FORMAT);
  assert.equal(result.profiles[0].audit.find(entry => entry.locus === 'TH01').ngs.rawGenotype, '7.2,13.2');
  assert.deepEqual(parsed.strData.AMEL, ['X', 'Y']);
  const analysisLoci = getAnalysisLoci([{ ...parsed, panel }]);
  for (const name of extra) assert(analysisLoci.includes(detector.getCanonicalLocusName(name)));
  const catalog = GenotypePanel.catalog();
  for (const name of extra) assert.equal(catalog.find(entry => entry.name === detector.getCanonicalLocusName(name)).type, name === 'SE33' ? 'OTHER' : 'STR');
});

test('NGS SEXUAL SRY с текстовым сигналом проходит экспорт и штатный импорт', async () => {
  const converter = new GeneticExcelConverterService();
  const files = [source([...standard, { locus: 'SRY', genotype: 'SRY', type: 'SEXUAL' }])];
  const { result } = confirmed(converter, files);
  assert(result.canUpload, JSON.stringify(result.issues));
  assert.deepEqual(result.profiles[0].strData.SRY, ['SRY']);
  const [profile] = await new ExcelService().parseExcelFile(converter.export(result), 'sry-ngs.xlsx', { importFormat: 'genetic' });
  assert.deepEqual(profile.strData.SRY, ['SRY']);
  const audit = result.profiles[0].audit.find(entry => entry.locus === 'SRY');
  assert.equal(audit.ngs.rawGenotype, 'SRY');
  assert.equal(audit.ngs.detailRows[0].allele, 'SRY');
});

test('Пустой QC не означает Pass, даже при согласованных Result и Detail', () => {
  const converter = new GeneticExcelConverterService(), files = [source(standard.map(entry => ({ ...entry, qc: '' })))];
  const { options, result } = confirmed(converter, files);
  assert(!result.canImport);
  assert(record(result, 'TH01').qc.issues.some(issue => issue.code === 'NGS_UNKNOWN_QC'));
  options.cells = Object.fromEntries(result.files[0].ngs.records.map(entry => [entry.cell.id, { action: 'keep', reason: 'Проверены исходные сигналы' }]));
  assert(converter.convert(files, options).canImport);
});

test('Неизвестный локус блокирует экспорт; явное исключение сохраняет исходные данные в аудите', async () => {
  const converter = new GeneticExcelConverterService(), files = [source([...standard, { locus: 'D99S999999', genotype: '9,10' }])];
  const { options, result } = confirmed(converter, files);
  assert(!result.canImport); assert(result.issues.some(issue => issue.code === 'NGS_UNKNOWN_LOCUS'));
  assert.deepEqual(result.files[0].ngs.locusReport.unknown, ['D99S999999']);
  const column = result.files[0].columns.find(column => column.header === 'D99S999999');
  options.files[result.files[0].id].columns = { [column.index]: { ignore: true } };
  const reviewed = converter.convert(files, options); assert(reviewed.canImport);
  const [parsed] = await new ExcelService().parseExcelFile(converter.export(reviewed), 'normalized.xlsx', { importFormat: 'genetic' });
  assert.equal(reviewed.profiles[0].audit.find(entry => entry.code === 'NGS_LOCUS_EXCLUDED').ngs.originalLocus, 'D99S999999');
  assert.equal(parsed.metadata.conversion, undefined);
});

test('Пакет NGS и legacy: разные объекты сохраняются, одинаковые не перезаписываются', () => {
  const converter = new GeneticExcelConverterService();
  const a = source(), b = source(standard.map(entry => entry.locus === 'TH01' ? { ...entry, genotype: '10,11' } : entry), { name: 'r2.251-4_20260714.ASTR+.xlsx' });
  const { options, result } = confirmed(converter, [a, b]);
  assert(result.canImport); assert.equal(result.profiles.length, 2);
  options.files[result.files[1].id].objectNumber = '251-1';
  const conflict = converter.convert([a, b], options);
  assert(!conflict.canImport); assert.equal(conflict.summary.conflicts, 1);
  assert.equal(conflict.conflicts[0].variants.length, 2);
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Объект', 'TH01', 'D5S818', 'D21S11'], ['legacy-1', '7,9', '11,12', '29,30']]));
  const legacy = { originalname: 'legacy.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) };
  const mixed = confirmed(converter, [a, legacy]).result;
  assert(mixed.canUpload); assert.equal(mixed.profiles.length, 2); assert.equal(mixed.files[1].sourceFormat, 'LEGACY_TABLE');
});

test('Структурные ошибки и маркеры только в Detail не маскируются', () => {
  const noResult = workbook(); delete noResult.Sheets.Result; noResult.SheetNames.shift();
  assert.equal(parseNgsAstrWorkbook(noResult, detectSourceFormat(noResult)).structuralIssues[0].code, 'NGS_RESULT_MISSING');
  const invalid = workbook(); invalid.Sheets.Result.E1.v = 'Unknown QC header';
  assert(parseNgsAstrWorkbook(invalid, detectSourceFormat(invalid)).structuralIssues.some(issue => issue.code === 'NGS_INVALID_HEADER'));
  const converter = new GeneticExcelConverterService();
  const { result } = confirmed(converter, [source(standard, { extraDetail: [['ASTR', 'D18S51', '16', '', 'Pass', '100%', 100]] })]);
  assert(!result.canImport); assert.deepEqual(result.profiles[0].strData.D18S51, []);
});

test('Смена решений повторно использует разобранный NGS и не изменяет исходник', t => {
  const converter = new GeneticExcelConverterService(), input = source(), original = Buffer.from(input.buffer);
  const read = XLSX.read; let reads = 0;
  t.mock.method(XLSX, 'read', (...args) => { reads++; return read(...args); });
  const { options, result } = confirmed(converter, [input]);
  decide(converter, [input], options, result, 'TH01', { action: 'manual', value: '10,11' });
  assert.equal(reads, 1); assert.deepEqual(input.buffer, original);
  assert.equal(record(converter.convert([input]), 'TH01').rawGenotype, '9,9.3');
});

test('Пакет 100 NGS сохраняет независимые объекты; лимит 101 не обходится', () => {
  const converter = new GeneticExcelConverterService();
  const original = source();
  const files = Array.from({ length: 100 }, (_, index) => ({ ...original, originalname: `r2.251-${index + 1}_20260714.ASTR+.xlsx` }));
  const { result } = confirmed(converter, files);
  assert.equal(result.profiles.length, 100); assert(result.canUpload);
  assert.equal(new Set(result.profiles.map(profile => profile.objectNumber)).size, 100);
  assert.throws(() => converter.convert([...files, original]), /100/);
});

test('AMEL: Detail другого сигнала не подтверждает Result; сомнительные структуры выбираются явно', () => {
  const book = workbook(standard);
  const rows = XLSX.utils.sheet_to_json(book.Sheets.Detail, { header: 1 });
  const x = rows.find(row => row[1] === 'AMELX'), y = rows.find(row => row[1] === 'AMELY');
  x[2] = 'Y'; y[2] = 'X';
  book.Sheets.Detail = XLSX.utils.aoa_to_sheet(rows);
  const parsed = parseNgsAstrWorkbook(book, detectSourceFormat(book));
  assert(parsed.records.find(row => row.locus === 'AMEL').qc.issues.some(issue => issue.code === 'NGS_RESULT_DETAIL_CONFLICT'));
  const ambiguous = workbook();
  XLSX.utils.book_append_sheet(ambiguous, ambiguous.Sheets.Result, ' Result ');
  assert(detectSourceFormat(ambiguous).ambiguous);
  assert.equal(detectSourceFormat(ambiguous, { sheetName: 'Result' }).ambiguous, false);
  const old = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(old, XLSX.utils.aoa_to_sheet([['Объект', '#Type', 'QC Flag', 'TH01', 'D5S818', 'AMEL']]), 'Result');
  assert.equal(detectSourceFormat(old).format, 'LEGACY_TABLE');
});
