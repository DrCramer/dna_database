const XLSX = require('xlsx');
const { LOCI_TYPES, LociTypeDetector } = require('../../utils/lociTypeDetector');
const { normalizeAlleleValue } = require('../../utils/alleleNormalizer');
const { panelCandidates } = require('./geneticSourceDetector');
const { geneMapperExportFilename } = require('../../utils/normalizedExcelLayout');
const detector = new LociTypeDetector();

function panelIdentity(name) {
  const normalized = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^globalfiler(?:panelv\d+)?$/.test(normalized)) return 'globalfiler';
  if (/^(?:sureid)?panglobalplus(?:11hw)?$/.test(normalized)) return 'panglobalplus';
  return normalized;
}

function adaptGeneMapper(source, settings, panels) {
  const markerKeys = source.markers.map(marker => marker.key);
  const rows = [['Объект', ...source.markers.map(marker => marker.header)]];
  const rowMetadata = new Map(), samples = [];
  for (const [sampleIndex, sample] of source.samples.entries()) {
    const choice = settings.samples?.[sample.sampleName] || {};
    const included = !sample.empty && !['ladder', 'control'].includes(sample.classification.category) && (typeof choice.include === 'boolean' ? choice.include : sample.included);
    const candidates = panelCandidates(sample.sourceLoci.filter(locus => detector.getCanonicalLocusName(locus)), panels);
    const exact = candidates.filter(candidate => candidate.exact && sample.panelNames.length === 1 && panelIdentity(candidate.name) === panelIdentity(sample.panelNames[0]));
    const selectedId = choice.panelId ?? (source.panelNames.length <= 1 ? settings.panelId : undefined);
    if (selectedId && !panels.some(panel => panel.id === selectedId)) throw new Error('Выбранная панель образца недоступна в активном отделении.');
    const panelId = selectedId === '' ? null : selectedId || (exact.length === 1 ? exact[0].id : null);
    const status = { sampleName: sample.sampleName, sampleIndex, sampleTypes: sample.sampleTypes, panelNames: sample.panelNames,
      panelId, panelCandidates: candidates, totalLoci: sample.sourceLoci.length,
      markerKeys: sample.sourceLoci,
      populatedLoci: new Set(sample.records.filter(record => record.rawValue).map(record => record.markerKey)).size,
      included, empty: sample.empty, classification: sample.classification.category,
      reason: sample.empty ? 'Образец без результатов генотипирования' : !included ? sample.reason || 'Исключён пользователем' : choice.include === true ? 'Включён по явному решению пользователя' : '',
      multiplePanels: sample.panelNames.length > 1, decision: choice };
    status.emergency = { assignedNumber: String(choice.assignedNumber || '').trim(), shippingNumber: String(choice.shippingNumber ?? settings.shippingNumber ?? '').trim() };
    samples.push(status);
    if (!included) continue;
    const variants = new Map(markerKeys.map(key => [key, []]));
    for (const record of sample.records) variants.get(record.markerKey).push(record);
    const repetitions = Math.max(...[...variants.values()].map(records => records.length));
    for (let index = 0; index < repetitions; index++) {
      const records = markerKeys.map(key => variants.get(key)[index]);
      rows.push([sample.sampleName, ...records.map(record => record?.rawValue || '')]);
      rowMetadata.set(rows.length, { sample: status, records });
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'GeneMapper');
  return { workbook, rowMetadata, preview: { sourceFormat: source.sourceFormat, encoding: source.encoding, suggestedYear: source.suggestedYear,
    panelNames: source.panelNames, originalRows: source.rowCount, samples, summary: { ...source.summary, selectedSamples: samples.filter(sample => sample.included).length } } };
}

function applyGeneMapperCell(record, locus, decision, settings) {
  const normalized = normalizeAlleleValue(record.rawValue, locus, decision);
  const events = [...normalized.events];
  const type = detector.detectLocusType(locus);
  const haploid = [LOCI_TYPES.Y_CHROMOSOME, LOCI_TYPES.Y_INDEL].includes(type) || locus === 'Yindel';
  let alleles = normalized.alleles;
  if (haploid && alleles.length > 1 && !decision) {
    if (new Set(alleles).size === 1 && settings.confirmHaploidDuplicates === true) {
      alleles = [alleles[0]];
      events.push({ code: 'GENEMAPPER_HAPLOID_DUPLICATE', status: 'AUTO_FIXED', hard: false, reason: 'По подтверждённому правилу GeneMapper одинаковые вызовы гаплоидного маркера сведены к одному; исходные значения сохранены.' });
    } else if (new Set(alleles).size > 1) events.push({ code: 'GENEMAPPER_HAPLOID_VALUES', status: 'NEEDS_REVIEW', hard: true, reason: 'Обнаружено несколько различных значений гаплоидного маркера. Требуется проверка.' });
  }
  if (record.status && record.status.toLowerCase() !== 'analyzed') events.push({ code: 'GENEMAPPER_ANALYSIS_STATUS', status: 'WARNING', hard: false, reason: `Статус GeneMapper: ${record.status}. Чтение файла не подтверждает результат исследования.` });
  const status = ['ERROR', 'NEEDS_REVIEW', 'WARNING', 'AUTO_FIXED'].find(status => events.some(event => event.status === status)) || 'OK';
  return { alleles, normalizedValue: alleles.join(','), status, hard: events.some(event => event.hard), events,
    code: events.find(event => event.hard)?.code || events[0]?.code || 'OK', reason: events.map(event => event.reason).join(' '),
    sourceRow: record.sourceRow, geneMapper: record };
}

function finalizeGeneMapper(result) {
  const names = new Map();
  const hardByKey = new Map();
  for (const issue of result.issues.filter(issue => issue.hard && issue.profileKey)) {
    if (!hardByKey.has(issue.profileKey)) hardByKey.set(issue.profileKey, []);
    hardByKey.get(issue.profileKey).push(issue);
  }
  result.preparedFiles = [];
  for (const file of result.files.filter(file => file.geneMapper)) {
    const name = geneMapperExportFilename(file.name);
    let filename = name, count = 1;
    while (names.has(filename.toLowerCase())) filename = name.replace(/\.xlsx$/i, ` (${++count}).xlsx`);
    names.set(filename.toLowerCase(), true);
    const profiles = result.profiles.filter(profile => profile.sources.some(source => source.fileId === file.id));
    const structural = result.issues.some(issue => issue.hard && issue.fileId === file.id && !issue.objectNumber && !issue.geneMapperSampleName);
    const profilesBySample = new Map();
    for (const profile of profiles) for (const source of profile.sources) if (source.fileId === file.id && source.geneMapper) profilesBySample.set(source.geneMapper.sampleName, profile);
    const hardByObject = new Map();
    for (const issue of result.issues.filter(issue => issue.hard && !issue.profileKey && (!issue.fileId || issue.fileId === file.id))) {
      const name = issue.geneMapperSampleName || issue.objectNumber;
      if (!hardByObject.has(name)) hardByObject.set(name, []);
      hardByObject.get(name).push(issue);
    }
    for (const sample of file.geneMapper.samples) {
      const profile = profilesBySample.get(sample.sampleName);
      const issues = [...(hardByKey.get(profile?.key) || []), ...(hardByObject.get(sample.sampleName) || []), ...(profile?.objectNumber !== sample.sampleName ? hardByObject.get(profile?.objectNumber) || [] : [])];
      sample.exportable = Boolean(sample.included && profile && !structural && !issues.length && profile.populatedLoci.length);
      if (profile) sample.populatedLoci = profile.populatedLoci.length;
      sample.warnings = profile?.audit.filter(issue => issue.status === 'WARNING').length || 0;
      sample.status = !sample.included ? 'Исключён' : !sample.exportable ? 'Требует проверки' : sample.populatedLoci < sample.totalLoci ? 'Частичный профиль' : 'Готов';
      if (sample.included && !sample.exportable) sample.reason = structural ? 'Нужно исправить структуру или сопоставление локусов файла' : issues.map(issue => issue.reason).join(' ') || 'В образце не осталось результатов после принятых решений.';
      if (profile) { profile.exportable = sample.exportable; profile.geneMapperSample = sample.sampleName; }
    }
    const eligible = profiles.filter(profile => profile.exportable);
    file.geneMapper.summary.readyProfiles = eligible.length;
    file.geneMapper.summary.partialProfiles = file.geneMapper.samples.filter(sample => sample.included && sample.populatedLoci < sample.totalLoci).length;
    file.geneMapper.summary.warningProfiles = file.geneMapper.samples.filter(sample => sample.included && sample.warnings).length;
    result.preparedFiles.push({ fileId: file.id, filename, profiles: eligible.length, excluded: file.geneMapper.samples.length - eligible.length,
      ready: eligible.length > 0, canUpload: eligible.length > 0 && eligible.every(profile => profile.year != null) && file.yearConfirmed,
      reason: eligible.length ? '' : 'Нет профилей, допустимых к экспорту. Проверьте исключения и нерешённые ошибки.' });
  }
}

function geneMapperExportResult(result, fileId) {
  const file = result.files.find(file => file.id === fileId && file.geneMapper);
  const prepared = result.preparedFiles?.find(file => file.fileId === fileId);
  if (!file || !prepared?.ready) throw new Error('В этом TXT нет профилей, допустимых к экспорту.');
  const profiles = result.profiles.filter(profile => profile.exportable && profile.sources.some(source => source.fileId === fileId));
  return { ...result, sourceFormat: 'GENEMAPPER_TXT', canImport: true, profiles, exportLoci: [...new Set([...profiles.flatMap(profile => profile.panelLoci), ...file.sourceLoci])], filename: prepared.filename };
}

module.exports = { adaptGeneMapper, applyGeneMapperCell, finalizeGeneMapper, geneMapperExportResult };
