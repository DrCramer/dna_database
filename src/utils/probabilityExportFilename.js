const MAX_FILENAME_BYTES = 240;
const encoder = new TextEncoder();
function component(value, fallback) {
  return String(value || '').normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-').replace(/^[._-]+|[._-]+$/g, '') || fallback;
}
function truncate(value, bytes) {
  let result = '';
  for (const character of value) {
    if (encoder.encode(result + character).length > bytes) break;
    result += character;
  }
  return result.replace(/[._-]+$/g, '');
}
function probabilityExportFilename(calculation) {
  const participants = calculation?.participants || [];
  if (!participants.length) return 'Probability.xlsx';
  const budget = Math.floor((MAX_FILENAME_BYTES - encoder.encode('Probability_.xlsx').length - participants.length + 1) / participants.length);
  const names = participants.map((participant, index) => {
    const fallback = `Объект-${index + 1}`;
    const name = participant.sampleName || (participant.displayName === 'Ручной ввод' ? '' : participant.displayName);
    return truncate(component(name, fallback), budget) || fallback;
  });
  return `Probability_${names.join('_')}.xlsx`;
}
module.exports = { probabilityExportFilename };
