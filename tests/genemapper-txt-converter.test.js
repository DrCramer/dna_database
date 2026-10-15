const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { parseGeneMapperTxt, suggestGeneMapperYear } = require('../src/services/converters/geneMapperTxtParser');
const { GeneticExcelConverterService } = require('../src/services/converters/geneticExcelConverterService');
const { geneMapperExportResult } = require('../src/services/converters/geneMapperSourceAdapter');
const { detectSourceFormat, GENEMAPPER_FORMAT } = require('../src/services/converters/geneticSourceDetector');
const { geneMapperExportFilename } = require('../src/utils/normalizedExcelLayout');
const { ExcelService } = require('../src/services/converters/excelService');
const { FileValidationService } = require('../src/services/converters/fileValidationService');
const converter = new GeneticExcelConverterService();
const headers = ['Status', 'Sample Name', 'Sample Type', 'Panel', 'Cap', 'Marker', 'Allele 1', 'Allele 2', 'Allele 3', 'Allele 4', 'Allele 5', ''];
function tsv(records, custom = headers, separator = '\r\n') {
  return Buffer.from([custom.join('\t'), ...records.map(record => custom.map(header => record[header] || '').join('\t'))].join(separator));
}
function row(marker, alleles, patch = {}) {
  return { Status: 'Analyzed', 'Sample Name': '265-27', 'Sample Type': 'Sample', Panel: 'Synthetic panel', Cap: '1', Marker: marker,
    ...Object.fromEntries(alleles.map((allele, index) => [`Allele ${index + 1}`, allele])), ...patch };
}
const basic = () => [row('TH01', ['7', '9.3']), row('TPOX', ['8', '8']), row('D21S11', ['29', '30'])];
const file = (records = basic(), originalname = '10-09-2026_образцы.txt') => ({ originalname, buffer: tsv(records) });
function convert(source, settings = {}, options = {}, panels = []) {
  const initial = converter.convert([source]);
  return converter.convert([source], { ...options, files: { [initial.files[0].id]: { year: 2026, ...settings } } }, panels);
}
function output(result) { return geneMapperExportResult(result, result.files[0].id); }

test('GeneMapper: TAB, trailing TAB, CRLF/LF, BOM, порядок и дополнительные столбцы', () => {
  for (const separator of ['\r\n', '\n']) for (const bom of ['', '\uFEFF']) {
    const custom = ['Extra', ...headers.slice().reverse().map(header => header.toUpperCase())];
    const records = basic().map(record => Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toUpperCase(), value])));
    const buffer = Buffer.concat([Buffer.from(bom), tsv(records, custom, separator)]);
    const parsed = parseGeneMapperTxt(buffer);
    assert.equal(parsed.samples.length, 1); assert.equal(parsed.samples[0].records.length, 3);
    assert.equal(detectSourceFormat(buffer).format, GENEMAPPER_FORMAT);
    assert.deepEqual(parsed.samples[0].records[0].rawAlleles, ['7', '9.3']);
  }
});
test('GeneMapper: строгая кодировка, безопасный выбор Windows-1251, UTF-16 BOM, повреждённый TXT', () => {
  assert.equal(parseGeneMapperTxt(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tsv(basic()).toString(), 'utf16le')])).encoding, 'utf-16le');
  const cp = Buffer.from(tsv(basic()).toString().replace('265-27', 'X65-27')); cp[cp.indexOf('X65-27')] = 0xc0;
  assert.throws(() => parseGeneMapperTxt(cp), /кодировк/);
  assert.equal(parseGeneMapperTxt(cp, { encoding: 'windows-1251' }).samples[0].sampleName, 'А65-27');
  for (const buffer of [Buffer.from('not GeneMapper\t12\t13'), Buffer.from('Sample Name\tMarker\tAllele 1'), Buffer.from([0, 1, 2]), Buffer.from('"unfinished')]) assert.throws(() => parseGeneMapperTxt(buffer));
  assert.throws(() => parseGeneMapperTxt(tsv(basic(), [...headers, 'Sample Name'])), /распознать|Повторяющ/);
  assert.throws(() => converter.convert([{ originalname: 'fake.txt', buffer: Buffer.from('arbitrary text') }]), /GeneMapper TXT/);
  assert.throws(() => converter.convert([{ originalname: 'fake.xlsx', buffer: tsv(basic()) }]), /не соответствует Excel/);
});
test('GeneMapper: все пять аллелей, гомозиготы, микроаллели, пустые локусы и специальные значения', async () => {
  const records = [...basic(), row('D19S433', ['14', '15', '17']), row('D18S51', ['12', '13', '14', '15']), row('FGA', ['20', '21', '22', '23', '24']),
    row('AMEL', ['X', 'Y']), row('D5S818', []), row('D13S317', ['11']), row('SE33', ['22.2', 'OL']), row('D2S441', ['*', '?']), row('D7S820', ['F'])];
  const result = convert(file(records)); const profile = result.profiles[0];
  assert.deepEqual(profile.strData.TPOX, ['8', '8']); assert.deepEqual(profile.strData.D19S433, ['14', '15', '17']);
  assert.equal(profile.strData.FGA.length, 5); assert.deepEqual(profile.strData.SE33, ['22.2', '?']);
  assert.deepEqual(profile.strData.D5S818, []); assert.deepEqual(profile.strData.D13S317, ['11']);
  assert(profile.audit.some(entry => entry.geneMapper?.rawAlleles.includes('OL') && entry.events.some(event => event.code === 'OFF_LADDER')));
  const selected = output(result), buffer = converter.export(selected);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Импорт']);
  assert.equal(workbook.Custprops.DNAProfileSourceFormat, GENEMAPPER_FORMAT);
  assert(new FileValidationService().validateFile(buffer, selected.filename, { importFormat: 'genetic' }).valid);
  const parsed = await new ExcelService().parseExcelFile(buffer, selected.filename, { importFormat: 'genetic' });
  for (const locus of selected.exportLoci) assert.deepEqual(parsed[0].strData[locus], profile.strData[locus], locus);
  assert.equal(parsed[0].internalNumber, '265-27'); assert.equal(parsed[0].year, 2026);
});
test('GeneMapper: Y и Y-InDel сохраняются; сведение одинаковых вызовов требует подтверждения', () => {
  const names = ['DYS391', 'Yindel', 'rs199815934', 'rs759551978', 'rs771783753'];
  const source = file([...basic(), ...names.map(name => row(name, ['2', '2']))]);
  for (const confirm of [false, true]) {
    const result = convert(source, { confirmHaploidDuplicates: confirm });
    for (const name of ['DYS391', 'Yindel', 'rs199815934', 'rs759551978', 'Rs771783753']) assert.deepEqual(result.profiles[0].strData[name], confirm ? ['2'] : ['2', '2']);
    assert.deepEqual(result.profiles[0].strData.TPOX, ['8', '8']);
  }
  const mixed = file([...basic(), row('DYS391', ['10', '11']), ...basic().map(record => ({ ...record, 'Sample Name': '265-28' }))]);
  const result = convert(mixed); assert.equal(result.preparedFiles[0].profiles, 1);
  const issue = result.issues.find(issue => issue.code === 'GENEMAPPER_HAPLOID_VALUES'); assert(issue.hard);
  const resolved = convert(mixed, {}, { cells: { [issue.id]: { action: 'keep' } } });
  assert.equal(resolved.preparedFiles[0].profiles, 2); assert.deepEqual(resolved.profiles[0].strData.DYS391, ['10', '11']);
});
test('GeneMapper: контроли и лестницы исключаются; точный PC_Rt можно переклассифицировать', () => {
  const records = basic();
  for (const name of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'Ladder', 'ladder', 'NC', 'PC', 'PC_Rt']) records.push(row('TH01', ['7', '9'], { 'Sample Name': name }));
  for (const type of ['Allelic Ladder', 'Negative Control', 'Positive Control']) records.push(row('TH01', ['7'], { 'Sample Name': type, 'Sample Type': type }));
  records.push(...basic().map(record => ({ ...record, 'Sample Name': 'PC-265-real' })));
  records.push(...basic().map(record => ({ ...record, 'Sample Name': 'empty', 'Allele 1': '', 'Allele 2': '' })));
  records.push(row('TH01', ['7'], { 'Sample Name': 'unknown', 'Sample Type': 'Other' }));
  const source = file(records); const result = convert(source);
  assert.deepEqual(output(result).profiles.map(profile => profile.objectNumber), ['265-27', 'PC-265-real']);
  assert.equal(result.files[0].geneMapper.samples.find(sample => sample.sampleName === 'empty').reason, 'Образец без результатов генотипирования');
  assert.equal(convert(source, { samples: { PC_Rt: { include: true } } }).preparedFiles[0].profiles, 3);
  assert.equal(convert(source, { samples: { 'Allelic Ladder': { include: true } } }).preparedFiles[0].profiles, 2);
  const serviceMarker = convert(file([...basic(), row('Ladder-only-marker', ['12'], { 'Sample Name': 'Ladder', 'Sample Type': 'Allelic Ladder' })]));
  assert.equal(serviceMarker.preparedFiles[0].ready, true);
  assert(serviceMarker.issues.some(issue => issue.code === 'GENEMAPPER_SERVICE_MARKER'));
  assert.equal(convert(file([row('TH01', []), row('TPOX', []), row('D21S11', [])])).preparedFiles[0].ready, false);
});
test('GeneMapper: повторные результаты требуют решения; исходные строки сохранены', () => {
  const source = file([...basic(), row('TH01', ['7', '9.3']), row('TH01', ['7', '10'])]);
  const result = convert(source); const conflict = result.conflicts.find(issue => issue.hard);
  assert(conflict); assert.equal(result.preparedFiles[0].ready, false);
  const resolved = convert(source, {}, { conflicts: { [conflict.id]: { sourceId: conflict.variants[0].id } } });
  assert.equal(resolved.preparedFiles[0].ready, true);
  assert.equal(resolved.profiles[0].audit.filter(entry => entry.geneMapper && entry.locus === 'TH01').length, 3);
});
test('GeneMapper: панели по имени и точному составу, неизвестные локусы не теряются', () => {
  const panel = { id: 'synthetic', name: 'GlobalFiler', lociOrder: ['TH01', 'TPOX', 'D21S11'] };
  const source = file(basic().map(record => ({ ...record, Panel: 'GlobalFiler_Panel_v1' })));
  assert.equal(convert(source, {}, {}, [panel]).profiles[0].detectedPanelId, panel.id);
  assert.equal(convert(source, {}, {}, [{ ...panel, lociOrder: ['TH01'] }]).profiles[0].detectedPanelId, null);
  assert.equal(convert(source, {}, {}, [{ ...panel, name: 'Different' }]).profiles[0].detectedPanelId, null);
  assert.equal(convert(source, { panelId: panel.id }, {}, [{ ...panel, name: 'Different' }]).profiles[0].detectedPanelId, panel.id);
  const unknown = file([...basic(), row('TypoLocus', ['12'])]);
  const result = convert(unknown); assert(result.issues.some(issue => issue.code === 'UNKNOWN_LOCUS' && issue.hard));
  const column = result.files[0].columns.find(column => column.header === 'TypoLocus');
  assert.equal(convert(unknown, { columns: { [column.index]: { locus: 'D5S818' } } }).preparedFiles[0].ready, true);
  const mixed = file([...basic(), row('TH01', ['7', '9.3'], { Panel: 'Other' })]);
  assert.equal(convert(mixed).preparedFiles[0].ready, false);
  assert.equal(convert(mixed, { samples: { '265-27': { panelId: panel.id } } }, {}, [panel]).preparedFiles[0].ready, true);
  const separatePanels = [panel, { id: 'second', name: 'Second', lociOrder: ['D5S818', 'FGA', 'D19S433'] }];
  const separate = file([...basic().map(record => ({ ...record, Panel: 'GlobalFiler_Panel_v1' })),
    ...['D5S818', 'FGA', 'D19S433'].map(marker => row(marker, ['12', '13'], { 'Sample Name': '265-28', Panel: 'Second' }))]);
  const resolvedPanels = convert(separate, {}, {}, separatePanels);
  assert.deepEqual(resolvedPanels.profiles.map(profile => profile.detectedPanelId), ['synthetic', 'second']);
  assert(resolvedPanels.profiles.every(profile => profile.sourceLoci.length === 3));
});
test('GeneMapper: отдельные источники не объединяются; имена и даты безопасны', () => {
  const result = converter.convert([file(), file(), file(basic(), '10-09-2026_образцы (2).txt')]);
  assert.equal(result.profiles.length, 3); assert.equal(new Set(result.preparedFiles.map(file => file.filename)).size, 3);
  const caseNames = convert(file([...basic(), ...basic().map(record => ({ ...record, 'Sample Name': '265-27a' })), ...basic().map(record => ({ ...record, 'Sample Name': '265-27A' }))]));
  assert.equal(caseNames.profiles.length, 3);
  assert.equal(result.preparedFiles[0].filename, '10-09-2026_образцы.xlsx');
  assert.equal(geneMapperExportFilename('../../опасное\\имя.txt'), 'имя.xlsx');
  for (const name of ['07-10-26_GF-1.txt', '10-09-2026_PGlplus.txt', '02-10-2026_PGplus_1.txt']) assert.equal(suggestGeneMapperYear(name), 2026);
  assert.equal(suggestGeneMapperYear('31-02-2026.txt'), null); assert.equal(suggestGeneMapperYear('no-date.txt'), null);
  const formula = convert(file(basic().map(record => ({ ...record, 'Sample Name': '=1+1' }))));
  const book = XLSX.read(converter.export(output(formula)), { type: 'buffer' });
  assert.equal(book.Sheets['Импорт'].A2.t, 's'); assert.equal(book.Sheets['Импорт'].A2.f, undefined);
  assert.throws(() => convert(file(basic().map(record => ({ ...record, 'Sample Name': 'X'.repeat(101) })))), /100/);
});
test('GeneMapper ЧС: без обязательных метаданных экспорта нет; корректная legacy-схема проходит импорт', async () => {
  const source = file();
  assert.equal(convert(source, {}, { importFormat: 'emergency' }).preparedFiles[0].ready, false);
  const result = convert(source, { shippingNumber: '25', samples: { '265-27': { assignedNumber: '1234' } } }, { importFormat: 'emergency' });
  const selected = output(result), buffer = converter.export(selected);
  assert(new FileValidationService().validateFile(buffer, selected.filename, { importFormat: 'emergency' }).valid);
  const parsed = await new ExcelService().parseExcelFile(buffer, selected.filename, { importFormat: 'emergency' });
  assert.equal(parsed.length, 1); assert.equal(parsed[0].internalNumber, '265-27'); assert.equal(parsed[0].sampleName, '1234');
  assert.equal(parsed[0].year, 2026); assert.deepEqual(parsed[0].strData.TH01, ['7', '9.3']);
});
test('Три реальных GeneMapper TXT: отдельные XLSX и полный round-trip каждой принятой аллели', { skip: !process.env.GENEMAPPER_SAMPLE_DIR }, async () => {
  const expected = [ ['07-10-26_GF-1_SS-GTZ.txt', 24, 96, 76], ['10-09-2026_PGlplus.txt', 30, 91, 87], ['02-10-2026_PGplus_1.txt', 30, 92, 55] ];
  for (const [name, loci, samples, included] of expected) {
    const source = { originalname: name, buffer: fs.readFileSync(path.join(process.env.GENEMAPPER_SAMPLE_DIR, name)) };
    const result = convert(source); const selected = output(result);
    assert.equal(result.files[0].geneMapper.summary.totalSamples, samples); assert.equal(selected.profiles.length, included);
    assert.equal(selected.exportLoci.length, loci); assert.equal(selected.filename, name.replace(/\.txt$/i, '.xlsx'));
    const buffer = converter.export(selected);
    const parsed = await new ExcelService().parseExcelFile(buffer, selected.filename, { importFormat: 'genetic' });
    assert.equal(parsed.length, included);
    for (const profile of selected.profiles) {
      const actual = parsed.find(item => item.internalNumber === profile.objectNumber); assert(actual); assert.equal(actual.year, 2026);
      for (const locus of selected.exportLoci) assert.deepEqual(actual.strData[locus], profile.strData[locus], `${name}: ${locus}`);
    }
  }
});
