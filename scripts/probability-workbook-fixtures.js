#!/usr/bin/env node
// Local audit only: never executes VBA or uses real profile inputs as fixtures.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { LociTypeDetector } = require('../src/utils/lociTypeDetector');
const detector = new LociTypeDetector();
const cases = [
  { id: 'ident-homo', mode: 'IDENT', loci: { D1S1656: [[13, 13], [13, 13]] } },
  { id: 'ident-hetero', mode: 'IDENT', loci: { D1S1656: [[13, 14], [14, 13]] } },
  { id: 'ident-microvariant', mode: 'IDENT', loci: { TH01: [[9, 9.3], [9.3, 9]] } },
  { id: 'ident-frequency-fallback', mode: 'IDENT', loci: { D1S1656: [[999, 999], [999, 999]] } },
  { id: 'ident-multiple', mode: 'IDENT', loci: { D1S1656: [[13, 14], [13, 14]], TH01: [[9.3, 9.3], [9.3, 9.3]] } },
  { id: 'trio-homo', mode: 'TRIO', loci: { D1S1656: [[13, 14], [13, 13], [13, 15]] } },
  { id: 'trio-obligate', mode: 'TRIO', loci: { D1S1656: [[13, 13], [13, 14], [14, 15]] } },
  { id: 'trio-ambiguous-one', mode: 'TRIO', loci: { D1S1656: [[13, 14], [13, 14], [13, 15]] } },
  { id: 'trio-ambiguous-both', mode: 'TRIO', loci: { D1S1656: [[13, 14], [13, 14], [13, 14]] } },
  { id: 'trio-mutation-one', mode: 'TRIO', loci: { D1S1656: [[13, 13], [13, 14], [15, 16]] } },
  { id: 'trio-mutation-two', mode: 'TRIO', loci: { D1S1656: [[13, 14], [13, 14], [15, 16]] } },
  { id: 'trio-incompatible-mother', mode: 'TRIO', loci: { D1S1656: [[15, 16], [13, 14], [13, 14]] } },
  { id: 'trio-absent-mother', mode: 'TRIO', loci: { D1S1656: [[0, 0], [13, 14], [13, 14]] } },
  { id: 'trio-multiple', mode: 'TRIO', loci: { D1S1656: [[13, 13], [13, 14], [14, 15]], TH01: [[9, 9.3], [9, 9.3], [9.3, 9.3]] } }
];
const summaryCells = { IDENT: ['G7', 'G8', 'G9', 'G10', 'G11'], TRIO: ['G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13'] };
function createFixtures(source, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const raw = fs.readFileSync(source);
  const original = XLSX.read(raw, { cellFormula: true, cellNF: true });
  const manifest = { sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'), engine: null, cases: [] };
  const fixtures = [...cases.map(c => ({ ...c, model: 'original-workbook' })),
    ...cases.filter(c => c.mode === 'TRIO').map(c => ({ ...c, id: 'formula-sheet-' + c.id, model: 'formula-sheet-mu' }))];
  for (const fixture of fixtures) {
    const workbook = XLSX.utils.book_new();
    for (const name of ['IDENT', 'TRIO', 'IDENT_AN', 'TRIO_AN', 'R_ident', 'R_TRIO', 'FREQ']) {
      const sheet = structuredClone(original.Sheets[name]);
      for (const [address, cell] of Object.entries(sheet)) {
        if (address.startsWith('!')) continue;
        if (cell.f) {
          if (name === 'TRIO_AN' && fixture.model === 'formula-sheet-mu' && /^AK\d+$/.test(address))
            cell.f = cell.f.replace(/\b1\/AH/g, '0.999/AH');
          delete cell.v; delete cell.w;
        }
      }
      if (['IDENT', 'TRIO'].includes(name)) {
        for (let row = name === 'IDENT' ? 17 : 18; row <= 688; row++) for (const col of ['D', 'E', 'G', 'H', 'J', 'K']) sheet[col + row] = { t: 'n', v: 0 };
      }
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    }
    const input = workbook.Sheets[fixture.mode];
    for (const [locus, genotypes] of Object.entries(fixture.loci)) {
      const address = Object.keys(input).find(a => /^C\d+$/.test(a) && detector.getCanonicalLocusName(input[a].v) === locus);
      if (!address) throw new Error('Input locus missing: ' + locus);
      const row = Number(address.slice(1));
      const columns = fixture.mode === 'IDENT' ? [['D', 'E']] : [['D', 'E'], ['G', 'H'], ['J', 'K']];
      columns.forEach((pair, index) => pair.forEach((col, allele) => { input[col + row] = { t: 'n', v: genotypes[index][allele] }; }));
    }
    XLSX.writeFile(workbook, path.join(directory, fixture.id + '.xlsx'), { bookType: 'xlsx' });
    manifest.cases.push(fixture);
  }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
function readRecalculated(directory, out) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  manifest.engine = process.env.PROBABILITY_ORACLE_ENGINE || 'LibreOffice Calc 24.2.7.2 420(Build:2)';
  manifest.microsoftExcelValidated = false;
  manifest.trioDecision = 'User selected 1-mu from formula sheet; original workbook fixtures retained';
  for (const fixture of manifest.cases) {
    const workbook = XLSX.readFile(path.join(directory, 'recalculated', fixture.id + '.xlsx'), { cellNF: true });
    const sheet = workbook.Sheets[fixture.mode === 'IDENT' ? 'R_ident' : 'R_TRIO'];
    fixture.report = Object.fromEntries(summaryCells[fixture.mode].map(a => [a, { value: sheet[a]?.v, format: sheet[a]?.z, text: sheet[a]?.w }]));
    const calculationSheet = workbook.Sheets[fixture.mode + '_AN'];
    fixture.locusResults = Object.fromEntries(Object.keys(fixture.loci).map(locus => {
      const address = Object.keys(calculationSheet).find(a => /^A\d+$/.test(a) && detector.getCanonicalLocusName(calculationSheet[a].v) === locus);
      const row = Number(address.slice(1));
      const factorAddresses = fixture.mode === 'IDENT' ? ['AF' + (row - 1), 'AF' + (row + 63)] : ['AN' + (row - 1), 'AN' + (row + 59)];
      const factors = factorAddresses.map(a => ({ address: a, value: calculationSheet[a]?.v }));
      const product = factors.reduce((p, f) => p * f.value, 1);
      return [locus, { factors, value: fixture.mode === 'IDENT' ? 1 / product : product }];
    }));
    fixture.summary = fixture.mode === 'IDENT'
      ? { count: sheet.G7?.v, index: sheet.G8?.v, reciprocal: sheet.G9?.v }
      : { count: sheet.G7?.v, index: sheet.G8?.v, reciprocal: sheet.G9?.v, probability: sheet.G10?.v, mismatches: sheet.G13?.v };
  }
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
}
if (require.main === module) {
  const [operation, first, second] = process.argv.slice(2);
  if (operation === 'create' && first && second) createFixtures(first, second);
  else if (operation === 'read' && first && second) readRecalculated(first, second);
  else if (operation === 'compare' && first && second) compareResults(first, second);
  else throw new Error('Usage: probability-workbook-fixtures.js create SOURCE.xlsm TEMP_DIR | read TEMP_DIR OUTPUT.json');
}
function compareResults(oracle, out) {
  const golden = JSON.parse(fs.readFileSync(oracle));
  const { calculate, ROLES } = require('../src/services/probability/ProbabilityCalculationService');
  const results = golden.cases.filter(c => c.mode === 'IDENT' || c.model === 'formula-sheet-mu').map(c => {
    const actual = calculate({ mode: c.mode, participants: ROLES[c.mode].map((role, i) => ({ role, sourceType: 'manual', displayName: role,
      loci: Object.fromEntries(Object.entries(c.loci).map(([locus, genotypes]) => [locus, genotypes[i]])) })) });
    if (!actual.summary) return { id: c.id, input: c.loci, status: actual.status, diagnostics: actual.rows.map(r => ({ locus: r.locus, status: r.status })) };
    const comparisons = [['index', actual.summary.indexText, c.report.G8.text],
      ['probability', actual.summary.probabilityText, c.mode === 'IDENT' ? c.report.G10.text : c.report.G11.text],
      ['complement', actual.summary.complementText, c.mode === 'IDENT' ? c.report.G11.text : c.report.G12.text]];
    return { id: c.id, input: c.loci, mode: c.mode, reference: actual.reference, expected: c.summary, actual: actual.summary,
      absoluteIndexDifference: Math.abs(actual.summary.index - c.summary.index),
      relativeIndexDifference: Math.abs((actual.summary.index - c.summary.index) / c.summary.index),
      loci: actual.rows.map(r => ({ locus: r.locus, expected: c.locusResults?.[r.locus], value: r.value, frequencies: r.frequencies, branch: r.branch })),
      displayDifferences: comparisons.filter(([field, a, b]) => a !== b).map(([field, actual, expected]) => ({ field, actual, expected })) };
  });
  fs.writeFileSync(out, JSON.stringify({ engine: golden.engine, microsoftExcelValidated: false, sourceSha256: golden.sourceSha256, results }, null, 2) + '\n');
}
module.exports = { cases, createFixtures, readRecalculated, compareResults };
