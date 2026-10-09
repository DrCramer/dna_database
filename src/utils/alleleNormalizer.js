const { LociTypeDetector, LOCI_TYPES } = require('./lociTypeDetector');
const { normalizeSpecialAllele, isSpecialAllele, isMissingAllele, isCertainNumericAllele, amelogeninTokens } = require('./alleleTokens');
const detector = new LociTypeDetector();
const hardStatuses = new Set(['ERROR', 'NEEDS_REVIEW', 'CONFLICT']);

function normalizeAlleleValue(rawValue, locus, decision) {
  const raw = String(rawValue ?? '');
  const type = detector.detectLocusType(locus);
  const canonicalLocus = detector.getCanonicalLocusName(locus);
  const haploid = type === LOCI_TYPES.Y_CHROMOSOME || type === LOCI_TYPES.Y_INDEL || canonicalLocus === 'Yindel';
  const events = [];
  const add = (code, status, reason, suggestions = []) => events.push({ code, status, hard: hardStatuses.has(status), reason, suggestions });
  let value = raw.trim();
  let explicitSingle = false;
  if (decision) {
    const action = decision.action;
    if (action === 'missing') value = '';
    else if (action === 'unknown') { value = isCertainNumericAllele(value) && !haploid ? `${value},?` : '?'; explicitSingle = true; }
    else if (action === 'homozygous') {
      if (!isCertainNumericAllele(value) || haploid || type === LOCI_TYPES.AMELOGENIN) add('INVALID_DECISION', 'ERROR', 'Гомозиготность можно подтвердить только для одной числовой аллели диплоидного локуса.');
      else value = `${value},${value}`;
    } else if (action === 'split_dot') {
      if (haploid || !/^\d+\.\d{2,}$/.test(value)) add('INVALID_DECISION', 'ERROR', 'Разделение точкой доступно только для диплоидного локуса с неоднозначной записью A.B.');
      else value = value.replace('.', ',');
    } else if (action === 'keep') { explicitSingle = true; }
    else if (action === 'manual' && typeof decision.value === 'string' && decision.value.length <= 500) value = decision.value;
    else add('INVALID_DECISION', 'ERROR', 'Некорректное решение для ячейки.');
    add('USER_DECISION', 'AUTO_FIXED', 'Применено явное решение пользователя.');
  }
  if (value.length > 500) add('VALUE_TOO_LONG', 'ERROR', 'Значение аллели слишком длинное.');
  if (isMissingAllele(value)) {
    if (raw !== '') add('MISSING_VALUE', 'AUTO_FIXED', 'Обозначение отсутствующего результата заменено пустой ячейкой.');
    return finish([], events);
  }
  if (/\d\s+\d/.test(value)) add('AMBIGUOUS_SPACE', 'NEEDS_REVIEW', 'Пробел между цифрами неоднозначен: введите аллели вручную.');
  if (/\s/.test(value) || /[/;]/.test(value)) add('SEPARATORS', 'AUTO_FIXED', 'Нормализованы пробелы и разделители аллелей.');
  value = value.replace(/\s+/g, '').replace(/[/;]/g, ',');
  let tokens = type === LOCI_TYPES.AMELOGENIN ? amelogeninTokens(value) : value.split(',');
  if (type === LOCI_TYPES.AMELOGENIN && tokens.join(',') !== value) add('AMEL', 'AUTO_FIXED', 'AMEL приведён к отдельным аллелям X/Y.');
  tokens = tokens.map(token => {
    const special = normalizeSpecialAllele(token);
    if (special !== null) {
      if (special !== token) add(special === '?' ? 'OFF_LADDER' : 'SPECIAL_CANONICAL', 'AUTO_FIXED', special === '?' ? 'Off Ladder сохранён как неизвестная аллель ?.' : 'Канонизирован специальный токен.');
      add('SPECIAL_ALLELE', 'WARNING', `Специальное значение ${special}; оно не используется как обычная числовая аллель.`);
      return special;
    }
    if (isMissingAllele(token)) { add('PARTIAL_MISSING', 'AUTO_FIXED', 'Отсутствующая аллель в паре сохранена как ?.'); return '?'; }
    if (type === LOCI_TYPES.AMELOGENIN || type === LOCI_TYPES.SNP || type === LOCI_TYPES.INDEL) return token.toUpperCase();
    return token;
  });
  const ambiguousDot = !haploid && type !== LOCI_TYPES.AMELOGENIN && tokens.length === 1 && /^\d+\.\d{2,}$/.test(tokens[0]);
  if (ambiguousDot && !explicitSingle) add('AMBIGUOUS_DOT', 'NEEDS_REVIEW', 'Возможно, точка использована как разделитель аллелей.', [tokens[0].replace('.', ','), tokens[0]]);
  if (tokens.length === 1 && isCertainNumericAllele(tokens[0]) && !haploid && type !== LOCI_TYPES.AMELOGENIN) {
    if (!ambiguousDot || explicitSingle) {
      const allele = tokens[0];
      tokens = [allele, '?'];
      if (!explicitSingle) add('SINGLE_DIPLOID', 'NEEDS_REVIEW', 'Одиночная аллель в диплоидном локусе: подтвердите гомозиготу или неизвестную вторую аллель.', [`${allele},${allele}`, `${allele},?`]);
    }
  }
  const knownToken = token => isSpecialAllele(token) || /^\d+(?:\.\d+)?(?:\?)?$/.test(token)
    || (type === LOCI_TYPES.AMELOGENIN && /^[XY](?:\?)?$/.test(token))
    || (type === LOCI_TYPES.SNP && /^[ATCG]$/.test(token))
    || (type === LOCI_TYPES.INDEL && /^[+-]?\d+[ATCG]*$/.test(token));
  if (tokens.some(token => !knownToken(token))) add('UNKNOWN_ALLELE', 'ERROR', 'Неизвестное значение аллели: требуется явное решение пользователя.');
  const validation = detector.validateAlleles(locus, tokens);
  if (!validation.isValid) add('INVALID_ALLELE', 'ERROR', 'Значение не прошло проверку типа локуса.');
  if (tokens.length > 2) add('MULTI_ALLELIC', 'WARNING', haploid ? 'В гаплоидном локусе обнаружено несколько аллелей: возможна смесь или аномалия.' : 'Обнаружено более двух аллелей: возможная смесь, контаминация или триаллельный профиль.');
  else if (haploid && tokens.length > 1) add('MULTI_Y_ALLELIC', 'WARNING', 'В гаплоидном локусе обнаружено несколько аллелей: возможна смесь или аномалия.');
  return finish(tokens, events);
}

function finish(alleles, events) {
  const priority = ['ERROR', 'NEEDS_REVIEW', 'CONFLICT', 'WARNING', 'AUTO_FIXED'];
  return { alleles, normalizedValue: alleles.join(','), events, status: priority.find(status => events.some(event => event.status === status)) || 'OK', hard: events.some(event => event.hard) };
}

// Синтаксические кандидаты: референсы и частоты оцениваются отдельным сервисом.
function alleleCandidates(rawValue, locus) {
  const normalized = normalizeAlleleValue(rawValue, locus);
  const ambiguous = normalized.events.some(event => event.code === 'AMBIGUOUS_DOT');
  if (ambiguous) {
    const value = String(rawValue).trim();
    return [{ value, alleles: [value], decision: { action: 'keep' } },
      { value: value.replace('.', ','), alleles: value.split('.'), decision: { action: 'split_dot' } }];
  }
  return [{ value: normalized.normalizedValue, alleles: normalized.alleles, decision: null }];
}
module.exports = { normalizeAlleleValue, alleleCandidates };
