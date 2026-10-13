const test = require('node:test');
const assert = require('node:assert/strict');
const { orderNormalizedLoci, normalizedExcelFilename } = require('../src/utils/normalizedExcelLayout');

test('Половые локусы завершают экспорт, порядок внутри групп сохраняется', () => {
  const source = ['AMEL', 'TH01', 'DYS391', 'D5S818', 'Yindel', 'D19S433', 'SRY', 'Rs771783753', 'DXS6795', 'FGA', 'Rs2032678'];
  assert.deepEqual(orderNormalizedLoci(source), ['TH01', 'D5S818', 'D19S433', 'FGA', 'Rs2032678', 'AMEL', 'DYS391', 'Yindel', 'SRY', 'Rs771783753', 'DXS6795']);
  assert.equal(source[0], 'AMEL');
});

test('Имя Excel образуется из номеров объектов и их годов', () => {
  assert.equal(normalizedExcelFilename([{ objectNumber: '250-1', year: 2026 }, { objectNumber: '250-11x (2)_a', year: 2026 }]), '250-2026.xlsx');
  assert.equal(normalizedExcelFilename([{ objectNumber: '251-1', year: 2026 }, { objectNumber: '250-2', year: 2026 }]), '250-2026_251-2026.xlsx');
  assert.equal(normalizedExcelFilename([{ objectNumber: '250-1', year: 2025 }, { objectNumber: '250-2', year: 2026 }]), '250-2025_250-2026.xlsx');
  assert.equal(normalizedExcelFilename([{ objectNumber: '250-1', year: null }]), '250-без-года.xlsx');
  const many = normalizedExcelFilename(Array.from({ length: 100 }, (_, i) => ({ objectNumber: `${i + 250}-1`, year: 2026 })));
  assert.equal(many, '250-2026_251-2026_252-2026_и-еще-97.xlsx');
  const unsafe = normalizedExcelFilename([{ objectNumber: '../../250\r\n"-1', year: 2026 }]);
  assert(!/[\r\n"/\\]/.test(unsafe));
});
