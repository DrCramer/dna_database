const { parseGeneMapperTxt } = require('../converters/geneMapperTxtParser');
const { applyGeneMapperCell } = require('../converters/geneMapperSourceAdapter');
const { normalizeLoci, ProbabilityError, diploid } = require('./ProbabilityCalculationService');
const { isProbabilityAutosomalStr } = require('../../utils/probabilityLoci');
const { createHash } = require('node:crypto');
function previewTxt(files) {
  if (!files.length) throw new ProbabilityError('Выберите TXT-файл.');
  return files.map(file => {
    const source = parseGeneMapperTxt(file.buffer, { filename: file.originalname });
    const fileId = createHash('sha256').update(file.buffer).digest('hex');
    return { fileId, filename: file.originalname, sampleTypeInferred: source.sampleTypeInferred, summary: source.summary, samples: source.samples.map(sample => {
      const loci = Object.create(null), qualityFlags = [];
      for (const record of sample.records) {
        const locus = record.locus || record.originalLocus;
        const cell = applyGeneMapperCell(record, locus, null, {});
        const parsed = diploid(cell.alleles);
        const expandHomozygote = record.locus && isProbabilityAutosomalStr(locus)
          && cell.alleles.length === 1 && !parsed.code;
        const expandStar = record.locus && isProbabilityAutosomalStr(locus) && parsed.starHomozygote;
        const knownAllele = cell.alleles.find(a => a !== '*');
        const alleles = expandStar ? [knownAllele, knownAllele] : expandHomozygote ? [cell.alleles[0], cell.alleles[0]] : cell.alleles;
        if (expandStar) qualityFlags.push({ locus, code: 'STAR_HOMOZYGOTE', hard: false,
          message: 'Числовая аллель со * представлена гомозиготной парой по принятому правилу; исходная запись сохранена.' });
        if (expandHomozygote) qualityFlags.push({ locus, code: 'HOMOZYGOTE_EXPANDED', hard: false,
          message: 'Одиночная аутосомная аллель представлена парой одинаковых значений; исходная запись сохранена.' });
        if (Object.hasOwn(loci, locus) && JSON.stringify(loci[locus]) !== JSON.stringify(alleles))
          qualityFlags.push({ locus, code: 'REPEATED_MARKER', hard: true, message: 'Повторный маркер с отличающимся результатом' });
        else loci[locus] = alleles;
        for (const event of cell.events) qualityFlags.push({ locus, code: event.code, hard: event.hard === true, message: event.reason });
      }
      return { sourceType: 'txt', sourceId: `${fileId}:${sample.sampleName}`, displayName: sample.sampleName,
        filename: file.originalname, sampleName: sample.sampleName, year: source.suggestedYear, sampleTypeInferred: source.sampleTypeInferred,
        rawLoci: sample.records.map(r => ({ locus: r.originalLocus, alleles: r.originalAlleleFields, sourceRow: r.sourceRow, status: r.status })),
        loci, qualityFlags, classification: sample.classification.category, selectable: sample.included && !sample.empty };
    }) };
  });
}
function databaseSource(row) {
  // Use only data already selected through ProfileAccessService.getScope.
  const data = typeof row.str_data === 'string' ? JSON.parse(row.str_data) : row.str_data;
  const normalized = normalizeLoci(data || {});
  const source = { sourceType: 'database', sourceId: row.id, displayName: row.internal_number || row.sample_name || 'Объект',
    year: row.year, expertiseNumber: row.sample_name, loci: normalized.loci, rawLoci: data,
    qualityFlags: normalized.conflicts.map(locus => ({ locus, code: 'ALIAS_CONFLICT', hard: true, message: 'Разные значения под именами одного локуса' })) };
  source.sourceDigest = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  return source;
}
module.exports = { previewTxt, databaseSource };
