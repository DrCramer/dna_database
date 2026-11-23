// Общие правила специальных токенов для импорта и вычислений.
function normalizeSpecialAllele(value) {
  const token = String(value ?? '').trim().toUpperCase();
  if (/^(?:OL|O\.L\.?|OFF\s*LADDER)$/.test(token)) return '?';
  if (/^\*+$/.test(token)) return '*';
  if (token === '?' || token === 'F') return token;
  return null;
}

function isSpecialAllele(value) { return normalizeSpecialAllele(value) !== null; }
function isMissingAllele(value) {
  // Дефисы, тире и минус из Excel обозначают пустое значение только сами по себе.
  return value == null || /^[\s.\u2010-\u2015\u2212\uFE63\uFF0D-]*$/.test(String(value));
}
function isMissingGenotypeCell(value) {
  return isMissingAllele(value) || typeof value === 'string' &&
    /[,;/]/.test(value) && value.split(/[,;/]/).every(isMissingAllele);
}
function isCertainNumericAllele(value) { return /^\d+(?:\.\d+)?$/.test(String(value ?? '').trim()); }

// Сигнал SRY допустим только у одноимённого локуса, не у остальных Y-STR.
function normalizeSrySignal(locus, value) {
  return String(locus ?? '').trim().toUpperCase() === 'SRY' && String(value ?? '').trim().toUpperCase() === 'SRY' ? 'SRY' : null;
}

function alleleTokens(value) {
  if (Array.isArray(value)) return value.flatMap(alleleTokens);
  if (value && typeof value === 'object') return alleleTokens([value.allele1, value.allele2]);
  if (value == null) return [];
  return String(value).split(/[,;/\s]+/).map(token => token.trim()).filter(Boolean);
}

function informativeAlleles(value) {
  return alleleTokens(value).filter(token => !isMissingAllele(token) && !isSpecialAllele(token) && !token.includes('?'));
}
// Проверяется исходная запись до удаления служебных токенов. Неизвестная
// вторая аллель не превращает пару в подтверждённую гомозиготу.
function hasUnknownAlleles(value) {
  if (Array.isArray(value)) return value.some(hasUnknownAlleles);
  if (value && typeof value === 'object') return hasUnknownAlleles([value.allele1, value.allele2]);
  if (value == null) return false;
  return String(value).split(/[,;/]/).some(part => isSpecialAllele(part) || /[*?]/.test(part) || alleleTokens(part).some(isSpecialAllele));
}

const cleanAmelogenin = value => String(value ?? '').replace(/\s+/g, '').toUpperCase().replace(/Х/g, 'X').replace(/У/g, 'Y');

// Пара с F сводится к одному символу; F/F остаётся неизвестным.
function normalizeAmelogeninPair(value) {
  const match = /^([XYF])[,;/]?([XYF])$/.exec(cleanAmelogenin(value));
  if (!match) return null;
  const [, first, second] = match;
  if (first === 'F') return [second];
  return second === 'F' ? [first] : [first, second];
}

function amelogeninTokens(value) {
  const pair = normalizeAmelogeninPair(value);
  if (pair) return pair;
  const normalized = cleanAmelogenin(value);
  return normalized.split(/[,;/]/).flatMap(token => /^[XY]{1,2}$/.test(token) ? [...token] : [normalizeSpecialAllele(token) || token]).filter(Boolean);
}

module.exports = { normalizeSpecialAllele, isSpecialAllele, isMissingAllele, isMissingGenotypeCell, isCertainNumericAllele, normalizeSrySignal, alleleTokens, informativeAlleles, hasUnknownAlleles, amelogeninTokens, normalizeAmelogeninPair };
