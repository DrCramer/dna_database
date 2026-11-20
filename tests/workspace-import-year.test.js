const test = require('node:test');
const assert = require('node:assert/strict');
const { groupRowsWithoutYearByExpertise } = require('../src/utils/workspaceImportMetadata');
const { geneticObjectKey } = require('../src/utils/profileImportFormat');

test('Год по экспертизе заполняется только у выбранных генетических объектов без года', () => {
  const object = (objectNumber, fields) => ({ objectNumber, year: null, expertiseType: 'ug', included: true, ...fields });
  const rows = [
    object('431-1'),
    object('431-2', { expertiseType: null }),
    object(' 431-57 ', { expertiseType: 'gr' }),
    object('431'),
    object('431-7', { year: 2023 }),
    object('431-8', { included: false }),
    object('431-9', { provenance: { classification: { included: false } } }),
    object('431-10', { expertiseType: 'chs' }),
    object('431-G', { expertiseType: 'staff' }),
    object('4310-1'),
    object('0431-1'),
    object('1431-1'),
    object('')
  ];
  const groups = groupRowsWithoutYearByExpertise(rows);
  assert.deepEqual([...groups.keys()], ['431', '4310', '0431', '1431']);
  assert.deepEqual(groups.get(geneticObjectKey(' 431 ')).rows, rows.slice(0, 4));
  assert(groups.get('431').rows.every(row => row.year === null));
});
