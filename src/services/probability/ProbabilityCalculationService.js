const reference = require('./data/workbook-reference.json');
const { LociTypeDetector } = require('../../utils/lociTypeDetector');
const { alleleTokens } = require('../../utils/alleleTokens');
const { hasAllProbabilityGenotypes } = require('../../utils/probabilityLocusSelection');
const { isProbabilityLocus } = require('../../utils/probabilityLoci');
const { SSF } = require('xlsx');
const exactDecimal = require('./exactDecimal');
const detector = new LociTypeDetector();
const FORMULA_VERSION = 'probability-2.5.1-a29-all-ident-star-homo-3';
// User decision: use the formula sheet, not the conflicting TRIO_AN numerator 1.
const TRIO_MATCH_NUMERATOR = 1 - 0.001;
const ROLES = Object.freeze({ IDENT: ['object'], TRIO: ['mother', 'child', 'father'] });
const ROLE_LABELS = { object: 'Исследуемый генотип', object1: 'Объект 1', object2: 'Объект 2',
  mother: 'Аллели неоспариваемого родителя', child: 'Аллели ребёнка', father: 'Аллели оспариваемого родителя' };
class ProbabilityError extends Error {
  constructor(message, code = 'INVALID_PROBABILITY_INPUT', status = 400) { super(message); this.code = code; this.status = status; }
}
function participantRoles(mode, participants) {
  if (typeof mode !== 'string' || !Object.hasOwn(ROLES, mode) || !Array.isArray(participants)
    || participants.some(p => !p || typeof p !== 'object' || Array.isArray(p))) throw new ProbabilityError('Укажите режим и всех участников.');
  // Older clients and immutable snapshots used two matching IDENT profiles.
  const roles = mode === 'IDENT' && participants.length === 2 ? ['object1', 'object2'] : ROLES[mode];
  if (participants.length !== roles.length || roles.some(role => participants.filter(p => p.role === role).length !== 1))
    throw new ProbabilityError('Укажите всех участников с уникальными ролями.');
  return roles;
}
function canonical(name) { return detector.getCanonicalLocusName(name) || String(name).trim(); }
function normalizeLoci(loci) {
  if (!loci || typeof loci !== 'object' || Array.isArray(loci) || Object.keys(loci).length > 510) throw new ProbabilityError('Некорректная таблица локусов.');
  const result = Object.create(null), conflicts = [];
  for (const [original, value] of Object.entries(loci)) {
    if (original.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(original)) throw new ProbabilityError('Некорректное имя локуса.');
    const scalar = v => v == null || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && v.length <= 200;
    const bounded = Array.isArray(value) ? value.length <= 5 && value.every(scalar)
      : value && typeof value === 'object' ? Object.keys(value).every(k => ['allele1', 'allele2'].includes(k)) && Object.values(value).every(scalar)
      : scalar(value);
    if (!bounded) throw new ProbabilityError('Некорректная структура генотипа.');
    const name = canonical(original);
    const tokens = alleleTokens(value);
    if (tokens.length > 5 || tokens.some(t => t.length > 50)) throw new ProbabilityError('Превышен допустимый размер генотипа.');
    if (Object.hasOwn(result, name) && JSON.stringify(result[name]) !== JSON.stringify(tokens)) conflicts.push(name);
    else result[name] = tokens;
  }
  return { loci: result, conflicts };
}
function diploid(value) {
  const tokens = alleleTokens(value);
  if (!tokens.length) return { code: 'EMPTY', message: 'Нет генотипа' };
  if (tokens.length > 2) return { code: 'MIXTURE', message: 'Более двух аллелей: модель смеси не поддерживается' };
  // Explicit user rule for this calculation module only: a numeric allele
  // paired with '*' is treated as a homozygote. Other uncertain calls stay blocked.
  const starHomozygote = tokens.length === 2 && tokens.filter(a => a === '*').length === 1
    && tokens.some(a => /^\d+(?:\.\d+)?$/.test(a) && Number(a) > 0);
  if (starHomozygote) {
    const allele = String(Number(tokens.find(a => a !== '*')));
    return { alleles: [allele, allele], starHomozygote: true };
  }
  if (tokens.some(a => !/^\d+(?:\.\d+)?$/.test(a) || Number(a) <= 0)) return { code: 'UNCERTAIN', message: 'Неопределённые или нечисловые аллели' };
  const alleles = tokens.map(a => String(Number(a)));
  return { alleles: alleles.length === 1 ? [alleles[0], alleles[0]] : alleles };
}
function frequency(locus, allele, data = reference.frequencies, allowMinimum = true) {
  const table = data[locus];
  if (!table) throw new ProbabilityError('Нет частот для локуса', 'NO_FREQUENCY');
  const exact = Object.hasOwn(table, allele);
  const value = exact ? table[allele] : allowMinimum ? Math.min(...Object.values(table)) : undefined;
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new ProbabilityError('Нет допустимой частоты аллели', 'NO_FREQUENCY');
  return { allele, value, origin: exact ? 'FREQ' : 'locus_minimum' };
}
function sameGenotype(a, b) { return [...a].sort().join('|') === [...b].sort().join('|'); }
function presence(p) { return 2 * p - p * p; }
// Per-locus formulas from the workbook. calculate() applies the agreed TRIO
// numerator and includes every supported IDENT locus, beyond the truncated PRODUCT.
function workbookLocus(mode, genotypes, locus, data = reference.frequencies) {
  if (mode === 'IDENT') {
    if (genotypes.length === 2 && !sameGenotype(...genotypes)) throw new ProbabilityError('IDENT: генотипы различаются; модель несовпадения в книге не определена', 'IDENT_MISMATCH');
    const [a, b] = genotypes[0];
    const frequencies = [frequency(locus, a, data), ...(a === b ? [] : [frequency(locus, b, data)])];
    const q = a === b ? frequencies[0].value ** 2 : 2 * frequencies[0].value * frequencies[1].value;
    return { value: 1 / q, q, branch: a === b ? 'IDENT_HOMO' : 'IDENT_HETERO', frequencies, mismatch: false,
      formula: a === b ? '1 / p²' : '1 / (2pq)', variant: a === b ? 'I' : 'II' };
  }
  const [mother, child, father] = genotypes;
  if (!mother.some(a => child.includes(a))) throw new ProbabilityError('Нет общего аллеля матери и ребёнка: вариант не валидирован', 'MATERNAL_INCOMPATIBILITY');
  let candidates;
  if (child[0] === child[1]) candidates = [child[0]];
  else {
    candidates = [...new Set(child.filter(a => !mother.includes(a)))];
    if (!candidates.length) candidates = [...new Set(child)];
  }
  const paternalAlleles = candidates.filter(allele => father.includes(allele));
  const mismatch = paternalAlleles.length === 0;
  // The workbook mutation lookup uses exact frequencies, unlike match branches.
  const frequencies = candidates.map(a => frequency(locus, a, data, !mismatch));
  const [p, q] = frequencies.map(f => f.value);
  const denominator = candidates.length === 1 ? presence(p) : presence(p) + presence(q) - 2 * p * q;
  const value = mismatch ? 0.001 / (1 - denominator) : 1 / denominator;
  if (!Number.isFinite(value) || value < 0 || denominator <= 0 || denominator > 1) throw new ProbabilityError('Недопустимый знаменатель расчёта', 'INVALID_DENOMINATOR');
  return { value, branch: `TRIO_${candidates.length === 1 ? 'ONE' : 'TWO'}_${mismatch ? 'MUTATION' : 'MATCH'}`, frequencies, mismatch,
    // TRIO_AN U/W select the child allele matching the disputed parent. R/S
    // remain the candidates for the frequency denominator (including Y/Z).
    formulaAlleles: candidates, paternalAlleles, paternalAllelesAmbiguous: paternalAlleles.length > 1,
    paternalAlleleStatus: mismatch ? 'MUTATION' : paternalAlleles.length > 1 ? 'AMBIGUOUS' : 'MATCH',
    variant: candidates.length === 1 ? 'I' : 'II',
    formula: mismatch ? (candidates.length === 1 ? 'μ / [1 − (2p − p²)]' : 'μ / [1 − (2p − p² + 2q − q² − 2pq)]')
      : (candidates.length === 1 ? '1 / (2p − p²)' : '1 / (2p − p² + 2q − q² − 2pq)') };
}
function scientific(log, digits = 4) {
  if (log === -Infinity) return '0';
  let exponent = Math.floor(log / Math.LN10);
  let mantissa = Number(Math.exp(log - exponent * Math.LN10).toFixed(digits));
  if (mantissa >= 10) { mantissa /= 10; exponent++; }
  return `${mantissa.toFixed(digits)}E${exponent >= 0 ? '+' : '-'}${String(Math.abs(exponent)).padStart(2, '0')}`;
}
function boundedDisplay(text, maximum, below, above) {
  // Test the final display value: rounding to 15 significant digits or to the
  // report's decimal places can reach 0/1/100 even when the raw value has not.
  const displayed = Number(text.replace('%', ''));
  return displayed >= maximum ? above : displayed <= 0 ? below : text;
}
function fixedProbability(p, decimals, percent = false) {
  const rounded = exactDecimal.roundForDisplay(p), suffix = percent ? '%' : '';
  const text = SSF.format('0.' + '0'.repeat(decimals) + suffix, rounded);
  // SSF 0.20.3 can concatenate scientific notation with a fixed decimal mask
  // for tiny percentages (e.g. "1e-13.000…%"). Keep those values fixed-point.
  return Number.isFinite(Number(text.replace('%', ''))) ? text
    : (rounded * (percent ? 100 : 1)).toFixed(decimals) + suffix;
}
function probabilityText(p, mode = 'IDENT') {
  if (mode === 'TRIO') return boundedDisplay(
    fixedProbability(p, 13, true), 100,
    '<0,0000000000001%', '>99,9999999999999%');
  return boundedDisplay(`${exactDecimal.roundForDisplay(p * 100).toFixed(14).replace(/\.?0+$/, '')}%`, 100,
    '<0.00000000000001%', '>99.9999999999999%');
}
function probabilityDisplay(summary, mode) {
  return {
    probabilityText: probabilityText(summary.probability, mode),
    probabilityFractionText: boundedDisplay(
      fixedProbability(summary.probability, 13), 1,
      '<0,0000000000001', '>0,9999999999999'),
    complementText: mode === 'IDENT' ? probabilityText(summary.complement) : boundedDisplay(
      fixedProbability(summary.complement, 14, true), 100,
      '<0,00000000000001%', '>99,9999999999999%')
  };
}
function calculate(input) {
  const { mode, participants, includedLoci } = input;
  const activeRoles = participantRoles(mode, participants);
  if (includedLoci != null && (!Array.isArray(includedLoci) || includedLoci.length > 510 || includedLoci.some(l => typeof l !== 'string' || l.length > 100))) throw new ProbabilityError('Некорректный список локусов.');
  const normalized = activeRoles.map(role => {
    const source = participants.filter(p => p.role === role);
    if (source.length !== 1) throw new ProbabilityError('Роли участников должны быть уникальны.');
    const p = source[0], normalized = normalizeLoci(p.loci);
    return { ...p, loci: normalized.loci, conflicts: normalized.conflicts };
  });
  const names = [...new Set(normalized.flatMap(p => Object.keys(p.loci)))];
  const selected = includedLoci == null ? null : new Set(includedLoci.map(canonical));
  const order = Object.keys(reference.frequencies);
  names.sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
  });
  const rows = names.map(locus => {
    const genotypes = normalized.map(p => p.loci[locus] || []);
    const supported = isProbabilityLocus(locus, mode);
    const filled = hasAllProbabilityGenotypes(genotypes);
    const enabled = supported && (selected ? selected.has(locus) : filled);
    const row = { locus, genotypes, enabled, selectable: supported, frequencies: [], value: null, status: 'EXCLUDED', message: filled ? 'Исключён' : 'Неполные генотипы', mismatch: false };
    if (!supported) return { ...row, status: 'NON_AUTOSOMAL', message: 'Не рассчитывается: неподдерживаемый аутосомной моделью маркер' };
    if (!enabled) return row;
    if (normalized.some(p => p.conflicts.includes(locus))) return { ...row, status: 'ALIAS_CONFLICT', message: 'Разные значения одного локуса под несколькими именами' };
    if (normalized.some(p => (p.qualityFlags || []).some(f => f.locus === locus && f.hard))) return { ...row, status: 'QUALITY_REVIEW', message: 'Требуется проверка качества источника' };
    const parsed = genotypes.map(diploid);
    const error = parsed.find(p => p.code);
    if (error) return { ...row, status: error.code, message: error.message };
    try {
      if (mode === 'TRIO' && !reference.trioLoci.includes(locus) || mode === 'IDENT' && !reference.identLoci.includes(locus))
        throw new ProbabilityError('Локус отсутствует в расчётной таблице исходной книги', 'UNVALIDATED_LOCUS');
      const locusResult = workbookLocus(mode, parsed.map(p => p.alleles), locus);
      if (mode === 'TRIO' && !locusResult.mismatch) {
        locusResult.value *= TRIO_MATCH_NUMERATOR;
        locusResult.formula = locusResult.formula.replace(/^1 \//, '(1−μ) /');
      }
      const genotypeAdjustments = parsed.flatMap((p, index) => p.starHomozygote ? [{
        role: activeRoles[index], code: 'STAR_HOMOZYGOTE', original: genotypes[index], alleles: p.alleles
      }] : []);
      return { ...row, ...locusResult, genotypes: genotypes.map((original, index) => parsed[index].starHomozygote ? parsed[index].alleles : original), genotypeAdjustments, status: 'OK',
        message: [locusResult.frequencies.some(f => f.origin === 'locus_minimum') ? 'Минимальная частота локуса из FREQ' : locusResult.mismatch ? 'Мутационная ветвь μ=0.001' : 'Учтён',
          ...(genotypeAdjustments.length ? ['Аллель со * учтена как гомозигота'] : [])].join('; ') };
    } catch (error) {
      if (!(error instanceof ProbabilityError)) throw error;
      return { ...row, status: error.code, message: error.message, mismatch: error.code === 'IDENT_MISMATCH' };
    }
  });
  const counted = rows.filter(r => r.enabled && r.status === 'OK');
  const blocked = rows.filter(r => r.enabled && r.status !== 'OK');
  let summary = null;
  if (counted.length && !blocked.length) {
    const excelOrder = mode === 'IDENT' ? reference.identLoci : reference.trioLoci;
    const factors = [...counted].sort((a, b) => a.variant.localeCompare(b.variant) || excelOrder.indexOf(a.locus) - excelOrder.indexOf(b.locus));
    const logIndex = factors.reduce((sum, r) => sum + Math.log(r.value), 0);
    // FREQ consists of finite decimals. Exact fractions prevent a binary-rounding
    // boundary from changing the last printed percentage digit. Logarithms remain
    // available for scientific presentation when the combined index overflows.
    const { index, reciprocal, probability, complement } = exactDecimal.summary(mode, factors);
    summary = { lociCount: counted.length, mismatches: counted.filter(r => r.mismatch).length, logIndex,
      index: Number.isFinite(index) ? index : null, reciprocal: Number.isFinite(reciprocal) ? reciprocal : null,
      indexText: Number.isFinite(index) && index > 0 ? SSF.format(mode === 'IDENT' ? '0.0000E+00' : '0.00000000E+00', index) : scientific(logIndex, 8),
      reciprocalText: Number.isFinite(reciprocal) && reciprocal > 0 ? SSF.format(mode === 'IDENT' ? '0.0000E+00' : '0.00000000E+00', reciprocal) : scientific(-logIndex, 8), probability, complement,
      ...probabilityDisplay({ probability, complement }, mode),
      indexLabel: mode === 'IDENT' ? 'CLR — индекс идентичности' : 'CPI — индекс родительства',
      probabilityLabel: mode === 'IDENT' ? 'P — вероятность идентичности' : 'PP — вероятность родительства' };
  }
  return { mode, formulaVersion: FORMULA_VERSION, reference: { id: reference.id, label: reference.label, sourceSha256: reference.sourceSha256 },
    validation: { status: 'recalculated_in_calc', engine: 'LibreOffice Calc 24.2.7.2', microsoftExcel: false, trioNumerator: '1-mu (user decision)',
      identHeterozygotes: 'all supported loci; original PRODUCT range extended' },
    parameters: { mutationProbability: 0.001, priorProbability: 0.5, starAlleleRule: 'numeric,* -> numeric,numeric' },
    participants: normalized, includedLoci: rows.filter(r => r.enabled).map(r => r.locus), excludedLoci: rows.filter(r => !r.enabled).map(r => r.locus),
    rows, summary, status: summary ? 'calculated' : blocked.length ? 'blocked' : 'empty', blockedLoci: blocked.map(r => r.locus),
    createdAt: new Date().toISOString() };
}
module.exports = { calculate, workbookLocus, normalizeLoci, diploid, canonical, frequency, scientific, probabilityText, probabilityDisplay, ProbabilityError, ROLES, ROLE_LABELS, FORMULA_VERSION, participantRoles };
