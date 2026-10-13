const XLSX = require('xlsx');
const { LociTypeDetector } = require('../utils/lociTypeDetector');
const { normalizeAlleleValue } = require('../utils/alleleNormalizer');
const { isMissingAllele } = require('../utils/alleleTokens');
const { readRows, NGS_FORMAT } = require('./geneticSourceDetector');
const detector = new LociTypeDetector();
const text = value => String(value ?? '').trim();
const key = value => text(value).toUpperCase();
const tokenValues = value => isMissingAllele(text(value)) ? [] : text(value).split(',').map(text);
const canonical = value => /^AMEL[XY]$/i.test(text(value)) ? 'AMEL' : detector.getCanonicalLocusName(text(value));
const diagnostic = (code, reason, hard = true) => ({ code, reason, hard });

function numeric(value) {
  const raw = text(value).replace(/%$/, '');
  return raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

function qcFlags(value) {
  const raw = text(value);
  const tokens = raw.split(/[,;|/\n]+/).map(text).filter(Boolean);
  const known = new Set(['pass', 'stutter', 'imbalance', 'low coverage', 'failed', 'flanking snp']);
  return { raw, tokens, pass: tokens.length > 0 && tokens.every(flag => flag.toLowerCase() === 'pass'),
    unknown: tokens.filter(flag => !known.has(flag.toLowerCase())) };
}

function records(sheet, header, sheetName) {
  const rows = readRows(sheet);
  return rows.slice(header.row).flatMap((row, index) => {
    if (!row.some(value => text(value))) return [];
    const get = name => text(row[header.columns[name]]);
    const sourceRow = header.row + index + 1;
    const formulas = Object.entries(header.columns).filter(([, column]) => sheet[XLSX.utils.encode_cell({ r: sourceRow - 1, c: column })]?.f).map(([name]) => name);
    return [{ sourceSheet: sheetName, sourceRow, type: get('#type'), originalLocus: get('locus'),
      original: Object.fromEntries(Object.keys(header.columns).filter(Boolean).map(name => [name, get(name)])),
      genotype: get('genotype'), allele: get('allele'), qcFlag: get('qc flag'),
      coverage: numeric(get('coverage')), totalCoverage: numeric(get('total depth of coverage')),
      proportion: numeric(get('proportion')), flankingSnp: get('flanking snp'), structure: get('structure'),
      repeatRegion: get('repeat region'), upstream: get('upstream flanking region'), downstream: get('downstream flanking region'), formulas }];
  });
}

function assess(record, detailAvailable) {
  const issues = [];
  const add = (code, reason, hard = true) => { if (!issues.some(item => item.code === code && item.reason === reason)) issues.push(diagnostic(code, reason, hard)); };
  const result = record.resultRows;
  const detail = record.detailRows;
  const rawAlleles = tokenValues(record.rawGenotype);
  const missing = !rawAlleles.length;
  if (!detailAvailable) add('NGS_DETAIL_MISSING', 'Лист Detail отсутствует: согласованность аллелей и QC не подтверждена.', !missing);
  if (!result.length) add('NGS_RESULT_DETAIL_CONFLICT', 'В Detail есть маркер, отсутствующий в Result. Генотип из Detail автоматически не создаётся.');
  if (result.length > 1 && record.locus !== 'AMEL') add('NGS_RESULT_DETAIL_CONFLICT', 'Локус повторяется в Result; проверьте все исходные строки.');
  if (result.some(row => !row.originalLocus) || detail.some(row => !row.originalLocus)) add('NGS_INVALID_LOCUS', 'Строка не содержит название локуса.');
  if (record.locus === 'AMEL') {
    const signals = new Set(result.filter(row => tokenValues(row.genotype).length).map(row => key(row.originalLocus)));
    if (!signals.has('AMELX') || !signals.has('AMELY')) add('NGS_AMEL_INCOMPLETE', 'AMELX/AMELY представлены не полностью. Подтвердите имеющиеся сигналы; отсутствующие не добавляются.');
    if (result.some(row => tokenValues(row.genotype).some(value => value !== key(row.originalLocus).slice(-1)))) add('NGS_AMEL_SIGNAL_CONFLICT', 'Значение сигнала AMEL не соответствует исходному маркеру.');
    if (new Set(result.map(row => key(row.originalLocus))).size !== result.length) add('NGS_RESULT_DETAIL_CONFLICT', 'Один из сигналов AMEL повторяется в Result.');
    if (detailAvailable && result.some(row => tokenValues(row.genotype).some(value => !detail.some(evidence => key(evidence.originalLocus) === key(row.originalLocus) && tokenValues(evidence.allele).includes(value))))) add('NGS_RESULT_DETAIL_CONFLICT', 'Для сигнала AMEL нет подтверждения в Detail того же исходного маркера.');
  }
  for (const row of [...result, ...detail]) {
    const expectedType = /^AMEL[XY]$/i.test(row.originalLocus) ? 'SEXUAL' : 'ASTR';
    const knownName = canonical(row.originalLocus);
    if (key(row.type) === 'ASTR' && knownName && !['STR', 'OTHER'].includes(detector.detectLocusType(knownName))) add('NGS_MARKER_TYPE', `Тип ASTR не соответствует каталогу для ${row.originalLocus}.`);
    if (row.type && key(row.type) !== expectedType) add('NGS_MARKER_TYPE', `Тип ${row.type} у ${row.originalLocus} требует проверки.`);
    if (result.includes(row) && !row.type) add('NGS_MARKER_TYPE', 'В Result отсутствует тип маркера.');
    if (row.formulas.length) add('NGS_FORMULA', 'Исходная строка содержит формулу; проверьте сохранённые значения.');
    const flags = qcFlags(row.qcFlag);
    if (!flags.tokens.length || flags.unknown.length) add('NGS_UNKNOWN_QC', `Неизвестный или пустой QC: «${row.qcFlag}» (${row.sourceSheet}, строка ${row.sourceRow}).`);
    for (const flag of flags.tokens.filter(flag => flag.toLowerCase() !== 'pass')) {
      const lower = flag.toLowerCase();
      add(lower === 'low coverage' ? 'NGS_LOW_COVERAGE' : lower === 'failed' ? 'NGS_FAILED' : 'NGS_QC_WARNING', `${row.sourceSheet}, строка ${row.sourceRow}: ${flag}.`, !missing);
    }
    if (row.flankingSnp && !isMissingAllele(row.flankingSnp)) add('NGS_FLANKING_SNP', 'В Detail отмечено изменение фланкирующей области.', !missing);
    const coverage = result.includes(row) ? row.totalCoverage : row.coverage;
    if (coverage == null || coverage < 0 || !Number.isInteger(coverage) || (!missing && coverage === 0)) add('NGS_LOW_COVERAGE', 'Покрытие отсутствует, некорректно или равно нулю.', !missing);
  }
  if (detailAvailable && result.length && !detail.length && !missing) add('NGS_RESULT_DETAIL_CONFLICT', 'Для заявленного генотипа отсутствуют записи Detail.');
  const declared = new Set(rawAlleles);
  const observed = new Set(detail.flatMap(row => tokenValues(row.allele)));
  if (detailAvailable && [...declared].some(value => !observed.has(value))) add('NGS_RESULT_DETAIL_CONFLICT', 'Не все аллели Result найдены в Detail.');
  if (detail.some(row => qcFlags(row.qcFlag).pass && tokenValues(row.allele).some(value => !declared.has(value)))) add('NGS_RESULT_DETAIL_CONFLICT', 'В Detail есть дополнительные аллели Pass, не указанные в Result.');
  const variants = new Map();
  for (const row of detail) {
    if (!variants.has(row.allele)) variants.set(row.allele, new Set());
    variants.get(row.allele).add(JSON.stringify([row.flankingSnp, row.structure, row.repeatRegion, row.upstream, row.downstream]));
  }
  if ([...variants.values()].some(values => values.size > 1)) add('NGS_SEQUENCE_VARIANTS', 'Одинаковая длиновая аллель имеет разные последовательностные варианты. Проверьте сведение к STR по длине.', !missing);
  if (rawAlleles.length > 2) add('NGS_MULTIALLELIC', 'Более двух аллелей: подтвердите весь набор или явно задайте принятые значения.');
  const passed = [...new Set(detail.filter(row => qcFlags(row.qcFlag).pass && row.coverage > 0).flatMap(row => tokenValues(row.allele)))];
  const suggestedValue = record.locus !== 'AMEL' && rawAlleles.length > 2 && passed.length === 2 && passed.every(value => declared.has(value)) ? passed.join(',') : null;
  return { issues, status: missing ? 'MISSING' : issues.some(item => item.hard) ? 'NEEDS_REVIEW' : issues.length ? 'WARNING' : 'OK',
    originalAlleles: rawAlleles, suggestedValue };
}

function parseNgsAstrWorkbook(workbook, detection) {
  const structuralIssues = [];
  if (detection.ambiguous) structuralIssues.push(diagnostic('NGS_INVALID_HEADER', 'Несколько листов или строк заголовков подходят формату NGS. Выберите источник явно или исправьте неоднозначные заголовки.'));
  if (!detection.resultSheet) structuralIssues.push(diagnostic('NGS_RESULT_MISSING', 'Не найден лист Result.'));
  else if (!detection.resultHeader?.valid) structuralIssues.push(diagnostic('NGS_INVALID_HEADER', 'В Result отсутствуют обязательные заголовки или они повторяются.'));
  if (detection.detailSheet && !detection.detailHeader?.valid) structuralIssues.push(diagnostic('NGS_INVALID_HEADER', 'В Detail отсутствуют обязательные заголовки или они повторяются.'));
  if (structuralIssues.length) return { sourceFormat: NGS_FORMAT, structuralIssues, records: [] };
  const resultRows = records(workbook.Sheets[detection.resultSheet], detection.resultHeader, detection.resultSheet);
  const detailRows = detection.detailSheet ? records(workbook.Sheets[detection.detailSheet], detection.detailHeader, detection.detailSheet) : [];
  const groups = new Map();
  const joinKey = row => {
    const name = canonical(row.originalLocus) || key(row.originalLocus);
    // Тип сохраняется отдельно: несоответствующие маркеры не становятся доказательством QC.
    const type = key(row.type || (/^AMEL[XY]$/i.test(row.originalLocus) ? 'SEXUAL' : 'ASTR'));
    return `${type}:${name}`;
  };
  for (const row of resultRows) {
    const id = joinKey(row);
    if (!groups.has(id)) groups.set(id, { key: id, locus: canonical(row.originalLocus), originalLocus: row.originalLocus, resultRows: [], detailRows: [] });
    groups.get(id).resultRows.push(row);
  }
  for (const row of detailRows) {
    const id = joinKey(row);
    if (!groups.has(id)) groups.set(id, { key: id, locus: canonical(row.originalLocus), originalLocus: row.originalLocus, resultRows: [], detailRows: [] });
    groups.get(id).detailRows.push(row);
  }
  const parsed = [...groups.values()].map(record => {
    const rawGenotype = record.locus === 'AMEL' ? record.resultRows.flatMap(row => tokenValues(row.genotype)).join(',') : record.resultRows[0]?.genotype || '';
    const value = { ...record, rawGenotype };
    return { ...value, qc: assess(value, Boolean(detection.detailSheet)) };
  });
  const originalLoci = [...new Set([...resultRows, ...detailRows].map(row => row.originalLocus))];
  const locusReport = { total: originalLoci.length, supported: [], aliases: [], unknown: [], ambiguous: [] };
  for (const name of originalLoci) {
    const mapped = canonical(name);
    if (!mapped) locusReport.unknown.push(name);
    else if (mapped === name) locusReport.supported.push(name);
    else locusReport.aliases.push({ original: name, canonical: mapped });
  }
  parsed.filter(record => record.resultRows.length > 1 && record.locus !== 'AMEL').forEach(record => locusReport.ambiguous.push(record.originalLocus));
  return { sourceFormat: NGS_FORMAT, structuralIssues, records: parsed, locusReport,
    resultCount: resultRows.length, detailCount: detailRows.length, detailAvailable: Boolean(detection.detailSheet),
    sourceLoci: [...new Set(parsed.map(record => record.locus).filter(Boolean))] };
}

function suggestObjectNumber(filename) {
  return text(filename).match(/^(?:r\d+\.)?(\d+-\d+[a-zа-я]?)_\d{8}\.ASTR\+\.(?:xlsx|xls)$/i)?.[1] || '';
}

// QC подтверждается только решением конкретной ячейки; массовое правило старого формата не снимает проверку NGS.
function applyNgsDecision(record, locus, decision) {
  if (decision && typeof decision === 'object') decision = { ...decision, timestamp: typeof decision.timestamp === 'string' && !Number.isNaN(Date.parse(decision.timestamp)) ? decision.timestamp : new Date().toISOString() };
  const normalized = normalizeAlleleValue(record.rawGenotype, locus, decision);
  const qc = record.qc;
  const reviewed = Boolean(decision) && !normalized.hard;
  const unresolved = normalized.hard || (qc.issues.some(item => item.hard) && !reviewed);
  const reasons = [...qc.issues.map(item => item.reason), ...normalized.events.map(item => item.reason)];
  return { ...normalized, hard: unresolved, status: unresolved ? 'NEEDS_REVIEW' : qc.issues.length ? 'WARNING' : normalized.status,
    code: normalized.hard ? normalized.events.find(event => event.hard).code : qc.issues.find(item => item.hard)?.code || qc.issues[0]?.code || 'NGS_QC_OK',
    reason: reasons.join(' ').slice(0, 3900) || 'Result и Detail согласованы, QC Pass.',
    ngs: { ...record, reviewed, finalGenotype: normalized.normalizedValue, decision: decision || null,
      multiAllelicConfirmed: reviewed && normalized.alleles.length > 2 },
    userDecision: decision || null };
}

module.exports = { parseNgsAstrWorkbook, suggestObjectNumber, applyNgsDecision, qcFlags };
