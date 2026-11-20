const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { LociTypeDetector, Y_INDEL_LOCI } = require('../src/utils/lociTypeDetector');
const { normalizeAlleleValue } = require('../src/utils/alleleNormalizer');
const { informativeAlleles } = require('../src/utils/alleleTokens');
const { ExcelService } = require('../src/services/converters/excelService');
const { FileValidationService } = require('../src/services/converters/fileValidationService');
const { GeneticExcelConverterService } = require('../src/services/converters/geneticExcelConverterService');
const { parseFiles } = require('../src/services/workspace/importSourceService');
const { FORMAT, validateObject } = require('../src/utils/objectImportV2');
const { createImportWorkbook } = require('../src/utils/importWorkbook');
const { validateReferenceImport } = require('../src/utils/alleleReferenceImport');

const detector = new LociTypeDetector();
const specials = ['*', '**', '?', 'F', 'OL'];
function file(withYear = true) {
  const headers = ['Объект', ...(withYear ? ['Год'] : []), 'TH01', 'D5S818', 'D21S11', ...Y_INDEL_LOCI];
  const rows = specials.map((value, i) => [`SYN-${i + 1}`, ...(withYear ? [2026] : []), '7,9', '11,12', '29,30', value, value, `1,${value}`]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Профили');
  return { originalname: 'SYN.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) };
}

test('Y-InDel принимает служебные обозначения, но не превращает их в обычные аллели', () => {
  for (const locus of Y_INDEL_LOCI) {
    for (const special of specials) {
      for (const alleles of [[special], ['1', special]]) {
        const before = structuredClone(alleles);
        const checked = detector.validateAlleles(locus.toUpperCase(), alleles);
        assert.equal(checked.isValid, true);
        assert(checked.warnings.length > 0);
        assert.deepEqual(alleles, before);
        const normalized = normalizeAlleleValue(alleles.join(','), locus);
        assert.equal(normalized.hard, false);
        assert(normalized.events.some(event => event.code === 'SPECIAL_ALLELE'));
        assert.deepEqual(informativeAlleles(normalized.alleles), alleles.length === 1 ? [] : ['1']);
      }
    }
    for (const invalid of ['0', '3', '12', '1.2', 'A', 'SRY', '1?', '(1)', 'not-an-allele']) {
      assert.equal(detector.validateAlleles(locus, [invalid]).isValid, false, `${locus}: ${invalid}`);
      assert.equal(normalizeAlleleValue(invalid, locus).hard, true);
    }
  }
});

test('Предварительная проверка и старый Excel-импорт согласованно принимают спецтокены Y-InDel', async () => {
  const source = file();
  const checked = new FileValidationService().validateFile(source.buffer, source.originalname, { importFormat: 'genetic' });
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  const profiles = await new ExcelService().parseExcelFile(source.buffer, source.originalname, { importFormat: 'genetic' });
  assert.equal(profiles.length, specials.length);
  for (const [i, profile] of profiles.entries()) {
    assert.deepEqual(profile.strData[Y_INDEL_LOCI[0]], [specials[i]]);
    assert.deepEqual(profile.strData[Y_INDEL_LOCI[1]], [specials[i]]);
    assert.deepEqual(profile.strData[Y_INDEL_LOCI[2]], ['1', specials[i]]);
    assert.deepEqual(informativeAlleles(profile.strData[Y_INDEL_LOCI[0]]), []);
  }
});

test('Личный массив и конвертер сохраняют спецзначения Y-InDel при повторном экспорте V2', () => {
  const source = file();
  const converter = new GeneticExcelConverterService();
  const converted = converter.convert([file(false)], {}, []);
  assert.equal(converted.canImport, true, JSON.stringify(converted.issues));
  const rows = parseFiles([source]).rows;
  assert.equal(rows.length, specials.length);
  for (const [i, row] of rows.entries()) {
    row.expertiseType = 'ug';
    assert.equal(row.sourceIssues.length, 0);
    assert.deepEqual(validateObject(row), []);
    for (const locus of Y_INDEL_LOCI) assert.deepEqual(row.strData[locus], converted.profiles[i].strData[locus]);
    assert.equal(row.provenance.alleleOrigins.find(origin => origin.locus === Y_INDEL_LOCI[0]).raw, specials[i]);
  }
  const exported = createImportWorkbook({ profiles: rows, loci: Object.keys(rows[0].strData), sourceFormat: FORMAT });
  const roundTrip = parseFiles([{ originalname: 'SYN-roundtrip.xlsx', buffer: exported }]);
  for (const [i, row] of roundTrip.rows.entries()) {
    assert.deepEqual(row.strData, rows[i].strData);
    assert.deepEqual(validateObject(row), []);
    assert.equal(row.sourceIssues.length, 0);
  }
});

test('Служебные значения не становятся референсными аллелями Y-InDel в справочнике', () => {
  for (const value of [...specials, '3', 'A']) assert.throws(() => validateReferenceImport({
    name: 'SYN reference', type: 'OBSERVED_REFERENCE', sourceTitle: 'Synthetic test',
    sourceUrl: 'https://example.invalid/synthetic', sourceVersion: 'fixture-1', confirmed: true,
    format: 'json', content: JSON.stringify({ values: [{ locus: Y_INDEL_LOCI[0], allele: value }] })
  }), error => error.code === 'INVALID_REFERENCE_ROWS');
});
