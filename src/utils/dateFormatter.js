const timeZone = 'Europe/Moscow';
const calendar = new Intl.DateTimeFormat('ru-RU', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
});
const clock = new Intl.DateTimeFormat('ru-RU', {
  timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const clockWithSeconds = new Intl.DateTimeFormat('ru-RU', {
  timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
const isoCalendarDate = /^(\d{4})-(\d{2})-(\d{2})$/;
const russianDate = /^(\d{2}\.\d{2}\.\d{4})(?:,? (\d{2}:\d{2})(?::(\d{2}))?)?$/;
const unzonedTimestamp = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

function asDate(value) {
  if (value == null || value === '') return null;
  const input = typeof value === 'string' && unzonedTimestamp.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateOnlyRu(value) {
  if (typeof value === 'string') {
    const local = russianDate.exec(value);
    if (local) return local[1];
    const iso = isoCalendarDate.exec(value);
    if (iso) return asDate(value)?.toISOString().slice(0, 10) === value ? `${iso[3]}.${iso[2]}.${iso[1]}` : null;
  }
  const date = asDate(value);
  return date ? calendar.format(date) : null;
}

function formatTimeRu(value, withSeconds = false) {
  const local = typeof value === 'string' && russianDate.exec(value);
  if (local) return local[2] ? local[2] + (withSeconds && local[3] ? ':' + local[3] : '') : null;
  const date = asDate(value);
  return date ? (withSeconds ? clockWithSeconds : clock).format(date) : null;
}

function formatDateRu(value, withSeconds = false) {
  const day = formatDateOnlyRu(value);
  if (!day || typeof value === 'string' && isoCalendarDate.test(value)) return day;
  const time = formatTimeRu(value, withSeconds);
  return time ? `${day} ${time}` : day;
}

function formatFileTimestampRu(value = new Date()) {
  const date = asDate(value);
  if (!date) return null;
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${calendar.format(date)}_${clockWithSeconds.format(date).replaceAll(':', '-')}-${milliseconds}`;
}

// Use only when serializing a downloadable report. API and stored timestamps stay machine-readable.
function exportDateFieldsRu(key, value) {
  if (!/^(?:timestamp|lastUpdated|last_login|(?:analysis|created|updated|completed|started|finished|resolved|submitted|decided|generated|export|exported|search|searched|upload|uploaded|firstFound|lastFound|expires|processing|collection|source|start|end)_?(?:date|timestamp|at))$/i.test(key)) return value;
  const original = this[key];
  return formatDateRu(original, true) ?? value;
}

module.exports = { formatDateRu, formatDateOnlyRu, formatTimeRu, formatFileTimestampRu, exportDateFieldsRu };
