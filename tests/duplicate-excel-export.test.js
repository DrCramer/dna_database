const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { DuplicateExcelExportService } = require('../src/services/duplicateExcelExportService');
const { validateGeneticHeaders } = require('../src/utils/profileImportFormat');

const service = new DuplicateExcelExportService();

function profile(id, internalNumber, loci, sampleName = '258') {
  return { id, internal_number: internalNumber, sample_name: sampleName, year: 2026, loci };
}

test('duplicate XLSX round-trip keeps compact comparison columns, full-match counts, colors and import sheet', async () => {
  const reference = profile('00000000-0000-4000-8000-000000000001', '258-1', {
    TH01: ['7', '9'],
    D5S818: ['11', '12'],
    D21S11: ['29', '30'],
    AMEL: ['X', 'Y']
  });
  const match = profile('00000000-0000-4000-8000-000000000002', '258-2', {
    TH01: ['9', '7'],
    D5S818: ['11', '12.2'],
    D21S11: ['10', '12'],
    AMEL: []
  });
  const secondReference = profile('00000000-0000-4000-8000-000000000003', '259-1', {
    TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30'], AMEL: ['X', 'Y']
  }, '259');
  const secondMatch = profile('00000000-0000-4000-8000-000000000004', '258-3', {
    TH01: ['9', '7'], D5S818: ['11', '12.2'], D21S11: ['10', '12'], AMEL: []
  });
  const customColors = {
    fullMatch: '#11AA22', partialMatch: '#AA7711', partialMatchAllele: '#1133EE', noMatch: '#EE8899'
  };
  const buffer = await service.createWorkbookBuffer({
    comparisons: [
      { reference, matched: match, algorithm: 'duplicate_v5', matchCount: 2, matchPercentage: 67 },
      { reference: secondReference, matched: match, algorithm: 'standard', matchCount: 1 },
      { reference, matched: secondMatch, algorithm: 'standard', matchCount: 2 }
    ],
    metadata: { importFormat: 'genetic', departmentName: 'Генетические экспертизы', minMatches: 1 },
    options: { colors: customColors }
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Профили', 'Сравнения', 'Сводка']);

  const profiles = workbook.getWorksheet('Профили');
  assert.equal(profiles.getCell('A1').value, 'Объект');
  const profileHeaders = profiles.getRow(1).values.slice(1);
  assert.equal(profileHeaders[0], 'Объект');
  assert.equal(profileHeaders[1], 'Год');
  assert.deepEqual([...profileHeaders.slice(2)].sort(), ['AMEL', 'D21S11', 'D5S818', 'TH01']);
  assert.equal(profiles.rowCount, 5, 'each physical profile appears once on the import sheet');
  assert.equal(profiles.getCell('A3').value, '258-2');
  assert.equal(profiles.getCell(3, profileHeaders.indexOf('Год') + 1).value, '2026');
  assert.equal(profiles.getCell(3, profileHeaders.indexOf('D5S818') + 1).value, '11,12.2', 'microvariant text is retained');
  assert.match(profiles.autoFilter, /^A1:/);
  assert.equal(profiles.views[0].state, 'frozen');
  assert.equal(validateGeneticHeaders(profiles.getRow(1).values.slice(1)).valid, true);

  const comparisons = workbook.getWorksheet('Сравнения');
  assert.equal(comparisons.rowCount, 7, 'each pair keeps its own reference and matched rows');
  const comparisonHeaders = comparisons.getRow(1).values.slice(1);
  assert.deepEqual(comparisonHeaders.slice(0, 4), ['Роль', 'Объект', 'Эталон', 'Совпавшие локусы']);
  assert.equal(comparisons.getCell('A2').value, 'Эталон');
  assert.equal(comparisons.getCell('A3').value, 'Совпавший профиль');
  assert.equal(comparisons.getCell('D3').value, '1', 'only the green full-match locus is counted; partial matches are excluded');
  assert.equal(comparisons.getCell('C3').value, '258-1');
  const locusCell = locus => comparisons.getCell(3, comparisonHeaders.indexOf(locus) + 1);
  assert.equal(locusCell('TH01').fill.fgColor.argb, 'FF11AA22', 'unordered full match uses the selected fill');
  assert.equal(locusCell('D5S818').fill.fgColor.argb, 'FFAA7711', 'partial match uses the selected fill');
  const richText = locusCell('D5S818').value;
  assert.deepEqual(richText.richText.map(run => run.text).join(''), '11,12.2');
  assert.equal(richText.richText[0].font.color.argb, 'FF1133EE');
  assert.equal(richText.richText[2].font.color.argb, 'FF000000');
  assert.equal(locusCell('D21S11').fill.fgColor.argb, 'FFEE8899', 'nonmatching alleles use the selected fill');
  assert.equal(locusCell('AMEL').fill.pattern, 'none', 'missing data remains neutral');
  assert.match(comparisons.autoFilter, /^A1:/);

  const summary = workbook.getWorksheet('Сводка');
  assert.equal(summary.getCell('A2').value, 'Дата анализа');
});

test('duplicate XLSX handles 1000 distinct profiles without dropping rows', async () => {
  const reference = profile('00000000-0000-4000-8000-000000000001', 'EXP-1', {
    TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30']
  });
  const comparisons = Array.from({ length: 999 }, (_, index) => ({
    reference,
    matched: profile(`00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`, `EXP-${index + 2}`, {
      TH01: ['9', '7'], D5S818: ['11', '12'], D21S11: ['30', '29']
    }),
    algorithm: 'standard'
  }));
  const buffer = await service.createWorkbookBuffer({ comparisons, metadata: { importFormat: 'genetic' } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.getWorksheet('Профили').rowCount, 1001);
  assert.equal(workbook.getWorksheet('Сравнения').rowCount, 1999);
  assert.equal(workbook.getWorksheet('Профили').getCell('A1001').value, 'EXP-1000');
});

test('ЧС export keeps the legacy first-sheet column order', async () => {
  const reference = profile('00000000-0000-4000-8000-000000000101', 'N-1', {
    TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30']
  });
  const matched = profile('00000000-0000-4000-8000-000000000102', 'N-2', {
    TH01: ['7', '9'], D5S818: ['11', '12'], D21S11: ['29', '30']
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await service.createWorkbookBuffer({
    comparisons: [{ reference, matched }],
    metadata: { importFormat: 'emergency' }
  }));
  const sheet = workbook.getWorksheet('Профили');
  assert.deepEqual(sheet.getRow(1).values.slice(1, 5), ['№ присвоенный в/ч', 'Привоз', 'Год', 'Sample Name']);
  assert.equal(sheet.getCell('A2').value, '258');
  assert.equal(sheet.getCell('D2').value, 'N-1');
});
