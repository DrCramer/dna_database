// Общие правила специальных токенов для импорта и вычислений.
function normalizeSpecialAllele(value) {
  const token = String(value ?? '').trim().toUpperCase();
  if (/^(?:OL|O\.L\.?|OFF\s*LADDER)$/.test(token)) return '?';
  if (/^\*+$/.test(token)) return '*';
  if (token === '?' || token === 'F') return token;
  return null;
}

function isSpecialAllele(value) { return normalizeSpecialAllele(value) !== null; }
function isMissingAllele(value) { return value == null || /^[\s\-—–.]*$/.test(String(value)); }
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

function amelogeninTokens(value) {
  const normalized = String(value ?? '').replace(/\s+/g, '').toUpperCase().replace(/Х/g, 'X').replace(/У/g, 'Y');
  return normalized.split(/[,;/]/).flatMap(token => /^[XY]{1,2}$/.test(token) ? [...token] : [normalizeSpecialAllele(token) || token]).filter(Boolean);
}

module.exports = { normalizeSpecialAllele, isSpecialAllele, isMissingAllele, isCertainNumericAllele, normalizeSrySignal, alleleTokens, informativeAlleles, amelogeninTokens };
