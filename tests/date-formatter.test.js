const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDateOnlyRu, formatDateRu, formatTimeRu, formatFileTimestampRu, exportDateFieldsRu } = require('../src/utils/dateFormatter');

test('Даты отображаются в московском часовом поясе с днём перед месяцем и 24-часовым временем', () => {
  const timestamp = '2026-11-22T21:04:59.007Z';
  assert.equal(formatDateOnlyRu(timestamp), '23.11.2026');
  assert.equal(formatDateRu(timestamp), '23.11.2026 00:04');
  assert.equal(formatDateRu('2026-11-22 21:04:59', true), '23.11.2026 00:04:59');
  assert.equal(formatDateRu('2026-11-22T17:30:00+03:00'), '22.11.2026 17:30');
  assert.equal(formatTimeRu(new Date(timestamp)), '00:04');
  assert.equal(formatFileTimestampRu(timestamp), '23.11.2026_00-04-59-007');
});

test('Календарные даты, старые русские подписи и JSON экспорта сохраняют смысл', () => {
  assert.equal(formatDateRu('2026-11-22'), '22.11.2026');
  assert.equal(formatDateRu('22.11.2026, 18:07:51'), '22.11.2026 18:07');
  assert.equal(formatDateRu('2026-02-31'), null);
  assert.equal(formatDateRu(null), null);
  assert.equal(formatDateRu('unknown'), null);
  const payload = { createdAt: new Date('2026-11-22T21:00:00Z'), details: { analysis_time: 12, sourceDate: '2026-09-10', notes: '2026-09-10' } };
  assert.deepEqual(JSON.parse(JSON.stringify(payload, exportDateFieldsRu)), {
    createdAt: '23.11.2026 00:00:00', details: { analysis_time: 12, sourceDate: '10.09.2026', notes: '2026-09-10' }
  });
  assert.equal(payload.createdAt.toISOString(), '2026-11-22T21:00:00.000Z');
});
