const { createHash } = require('node:crypto');
const { LociTypeDetector, LOCI_TYPES } = require('../utils/lociTypeDetector');
const { informativeAlleles } = require('../utils/alleleTokens');
const { alleleCandidates, normalizeAlleleValue } = require('../utils/alleleNormalizer');
const { ReferenceError } = require('../utils/alleleReferenceImport');
const detector = new LociTypeDetector();
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
function referenceSettings(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ReferenceError('Некорректные настройки интеллектуальной проверки.');
  const result = { ladder: true, variants: true, population: true, referenceSetId: 'auto', populationIds: [], ...options };
  for (const key of ['ladder', 'variants', 'population']) if (typeof result[key] !== 'boolean') throw new ReferenceError('Переключатели проверки должны быть логическими значениями.');
  if (!['auto', 'none'].includes(result.referenceSetId) && !uuid.test(result.referenceSetId)) throw new ReferenceError('Некорректная референсная лестница.');
  if (!Array.isArray(result.populationIds) || result.populationIds.length > 100 || result.populationIds.some(id => typeof id !== 'string' || !id || id.length > 50)) throw new ReferenceError('Некорректный список популяций.');
  return result;
}
class AlleleReferenceService {
  constructor({ sets = [], observations = [], panels = [], settings = {} } = {}) {
    this.settings = referenceSettings(settings);
    this.sets = sets.map(set => {
      const index = new Map();
      for (const row of set.values || []) {
        if (!index.has(row.locus)) index.set(row.locus, new Map());
        index.get(row.locus).set(row.allele, row);
      }
      return { ...set, index };
    });
    this.panels = new Map(panels.map(panel => [panel.id, panel]));
    this.populations = new Map();
    for (const row of observations) {
      if (!this.populations.has(row.populationId)) this.populations.set(row.populationId, { name: row.populationName, index: new Map(), rows: [] });
      const population = this.populations.get(row.populationId);
      if (!population.index.has(row.locus)) population.index.set(row.locus, new Map());
      population.index.get(row.locus).set(row.allele, row);
      population.rows.push(row);
    }
    for (const population of this.populations.values()) {
      population.version = createHash('sha256').update(JSON.stringify(population.rows)).digest('hex');
      delete population.rows;
    }
  }
  static async load(scope, settings, panels, loci) {
    const { AlleleReferenceSet } = require('../models/AlleleReferenceSet');
    const PopulationManager = require('./bayesian/PopulationManager');
    settings = referenceSettings(settings);
    const sets = await AlleleReferenceSet.values(await AlleleReferenceSet.list(scope));
    const observations = settings.population && loci.length ? await new PopulationManager().loadObservedRecords(loci, settings.populationIds) : [];
    return new this({ sets, observations, panels, settings });
  }
  ladder(panelId, referenceSetId = this.settings.referenceSetId) {
    if (!['auto', 'none'].includes(referenceSetId) && !uuid.test(referenceSetId)) throw new ReferenceError('Некорректная версия лестницы.');
    if (!this.settings.ladder || referenceSetId === 'none') return { set: null, reason: 'Проверка лестницы отключена.' };
    if (referenceSetId !== 'auto') {
      const set = this.sets.find(set => set.id === referenceSetId && set.type === 'KIT_LADDER');
      if (!set) throw new ReferenceError('Лестница недоступна или деактивирована.', 404, 'REFERENCE_NOT_FOUND');
      return { set, reason: 'Версия выбрана оператором.' };
    }
    const ids = this.panels.get(panelId)?.referenceSetIds || [];
    const sets = this.sets.filter(set => set.type === 'KIT_LADDER' && ids.includes(set.id));
    return { set: sets.length === 1 ? sets[0] : null, reason: sets.length > 1 ? 'С панелью связаны несколько активных лестниц: выберите версию явно.' : sets.length === 1 ? 'Лестница выбрана по подтверждённой связи панели.' : 'Референсная лестница не выбрана. Используется стандартная проверка значений.' };
  }
  describe(panelId, referenceSetId) {
    const choice = this.ladder(panelId, referenceSetId);
    return { referenceSetId: choice.set?.id || null, referenceVersion: choice.set?.sourceVersion || null, referenceName: choice.set?.name || null, reason: choice.reason };
  }
  evaluate(raw, locus, panelId, referenceSetId) {
    const type = detector.detectLocusType(locus);
    const choice = this.ladder(panelId, referenceSetId);
    const sets = [...(choice.set ? [choice.set] : []), ...(this.settings.variants ? this.sets.filter(set => set.type !== 'KIT_LADDER' && (set.type !== 'Y_STR_REFERENCE' || type === LOCI_TYPES.Y_CHROMOSOME)) : [])];
    const populations = this.settings.population && type === LOCI_TYPES.STR && locus !== 'Yindel' ? this.populations : new Map();
    const syntactic = normalizeAlleleValue(raw, locus);
    const ambiguous = syntactic.events.some(event => event.code === 'AMBIGUOUS_DOT');
    const candidates = alleleCandidates(raw, locus).map(candidate => {
      const alleles = [...new Set(informativeAlleles(candidate.alleles))];
      const evidence = [];
      for (const allele of alleles) {
        for (const set of sets) {
          const values = set.index.get(locus), record = values?.get(allele);
          evidence.push({ allele, sourceType: set.type, referenceSetId: set.id, referenceVersion: set.sourceVersion,
            referenceName: set.name, sourceTitle: set.sourceTitle, sourceUrl: set.sourceUrl, contentHash: set.contentHash,
            result: record ? set.type === 'KIT_LADDER' ? 'IN_KIT_LADDER' : set.type === 'OBSERVED_REFERENCE' ? 'OBSERVED_IN_LOCAL_REFERENCE' : 'KNOWN_VARIANT' : values ? 'NOT_REPORTED_IN_REFERENCE' : 'NO_REFERENCE_DATA',
            classification: record?.classification || null, details: record?.metadata || null });
        }
        for (const [populationId, population] of populations) {
          const values = population.index.get(locus), record = values?.get(allele);
          evidence.push({ allele, sourceType: 'POPULATION_DATA', populationId, referenceVersion: population.version,
            referenceName: population.name, result: record?.frequency > 0 ? 'OBSERVED_IN_POPULATION' : values ? 'NOT_OBSERVED_IN_DATASET' : 'NO_REFERENCE_DATA',
            frequency: record ? record.frequency : null, observedAt: record?.updatedAt || null });
        }
      }
      const all = result => alleles.length > 0 && alleles.every(allele => evidence.some(item => item.allele === allele && result.includes(item.result)));
      const inLadder = all(['IN_KIT_LADDER']), knownVariant = all(['KNOWN_VARIANT', 'OBSERVED_IN_LOCAL_REFERENCE']);
      return { ...candidate, confidence: 'UNKNOWN', evidence,
        evidenceLevel: inLadder ? 'IN_KIT_LADDER' : knownVariant ? choice.set ? 'KNOWN_OFF_LADDER_VARIANT' : 'KNOWN_VARIANT' : all(['OBSERVED_IN_POPULATION']) ? 'OBSERVED_IN_POPULATION' : 'NO_REFERENCE_EVIDENCE',
        inLadder: all(['IN_KIT_LADDER']), known: all(['IN_KIT_LADDER', 'KNOWN_VARIANT', 'OBSERVED_IN_LOCAL_REFERENCE']),
        observed: all(['OBSERVED_IN_POPULATION']), hasData: evidence.some(item => item.result !== 'NO_REFERENCE_DATA') };
    });
    let suggested = null, confidence = 'UNKNOWN', status = 'NO_REFERENCE_DATA', reason = 'Для этого значения нет подходящих референсных данных.';
    const known = candidates.filter(candidate => candidate.known);
    const hasData = candidates.some(candidate => candidate.hasData);
    if (ambiguous && known.length > 1) {
      status = 'CONFLICTING_REFERENCE_EVIDENCE'; confidence = 'LOW';
      reason = 'Обе интерпретации поддерживаются справочниками. Референсы не определяют, какое значение записал оператор.';
    } else if (ambiguous && known.length === 1) {
      const preferred = known[0], alternatives = candidates.filter(candidate => candidate !== preferred);
      suggested = preferred;
      const conflicting = alternatives.some(candidate => candidate.observed);
      confidence = conflicting ? 'LOW' : preferred.inLadder ? 'HIGH' : preferred.evidence.filter(item => ['KNOWN_VARIANT', 'OBSERVED_IN_LOCAL_REFERENCE'].includes(item.result)).map(item => item.referenceSetId).filter((id, index, all) => all.indexOf(id) === index).length > 1 ? 'MEDIUM' : 'LOW';
      status = conflicting ? 'CONFLICTING_REFERENCE_EVIDENCE' : 'NEEDS_REVIEW';
      reason = conflicting ? 'Другая интерпретация наблюдалась в популяционной базе. Проверьте обе версии вручную.' : preferred.inLadder ? 'Все аллели предложения точно присутствуют в выбранной лестнице; другая интерпретация не подтверждена доступными данными. Отсутствие записи не доказывает невозможность аллели.' : 'Предложение поддерживают известные варианты или подтверждённые локальные записи. Требуется решение оператора.';
    } else if (!ambiguous && known.length) {
      status = 'VALID_KNOWN_ALLELE'; confidence = known[0].inLadder ? 'HIGH' : 'MEDIUM';
      reason = 'Аллельные значения найдены в справочниках. Это не подтверждает гомозиготность, отсутствие смеси или качество профиля.';
    } else if (hasData) {
      status = candidates.some(candidate => candidate.observed) ? 'OBSERVED_IN_POPULATION' : 'NO_REFERENCE_EVIDENCE';
      confidence = 'LOW'; reason = status === 'OBSERVED_IN_POPULATION' ? 'Есть реальные популяционные записи. Частота не определяет правильность исходного значения и не подтверждает гомозиготность.' : 'Значения не найдены в доступных данных. Это предупреждение, а не доказательство ошибки.';
    }
    for (const candidate of candidates) candidate.confidence = status === 'CONFLICTING_REFERENCE_EVIDENCE' ? 'LOW' : candidate === suggested ? confidence : candidate.known ? (candidate.inLadder ? 'HIGH' : 'MEDIUM') : candidate.hasData ? 'LOW' : 'UNKNOWN';
    return { status, confidence, reason, hasData, ambiguous, candidates, suggestedValue: suggested?.value || null,
      suggestedDecision: suggested?.decision || null, ladder: this.describe(panelId, referenceSetId),
      genotypeRule: locus === 'Yindel' || locus === 'SRY' ? 'SPECIAL_MARKER' : type === LOCI_TYPES.Y_CHROMOSOME ? 'HAPLOTYPE_REFERENCE_ONLY' : 'LOCUS_TYPE_RULES' };
  }
}
module.exports = { AlleleReferenceService, referenceSettings };
