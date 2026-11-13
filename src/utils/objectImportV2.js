const {
  createHash
} = require('node:crypto');
const {
  LociTypeDetector
} = require('./lociTypeDetector');
const {
  informativeAlleles
} = require('./alleleTokens');
const detector = new LociTypeDetector();
const FORMAT = 'DNA_IMPORT_V2';
const {
  OBJECT_TYPES: TYPES
} = require('./objectTypes');
const FIELDS = Object.freeze({
  objectNumber: 'Объект',
  year: 'Год',
  expertiseType: 'Тип экспертизы',
  fullName: 'ФИО',
  comment: 'Комментарий',
  registrationNumber: '№ рег.',
  legacyDepartment: 'Старое отделение',
  sourceTable: 'Источник записи',
  sourceId: 'Исходный ID',
  legacySampleName: 'Прежнее имя образца',
  legacyImportNumber: 'Старое значение привоза/служебной колонки',
  sourceObjectNumber: 'Исходный номер из файла',
  provenanceJson: 'Происхождение JSON',
  genotypeJson: 'Генотип JSON'
});
function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = value => createHash('sha256').update(stableJSON(value)).digest('hex');
const hasGenotype = data => data && Object.values(data).some(value => informativeAlleles(value).length);
function normalizeType(value) {
  const input = String(value ?? '').trim().toLowerCase();
  return Object.keys(TYPES).find(key => key === input || TYPES[key].toLowerCase() === input) || null;
}
function businessKey(row) {
  if (row.expertiseType === 'staff' && !row.objectNumber) return null;
  return stableJSON([row.expertiseType, row.year, String(row.objectNumber || '').trim().toLocaleLowerCase('ru')]);
}
function analysisHash(row) {
  return hash({
    objectNumber: row.objectNumber,
    year: row.year,
    expertiseType: row.expertiseType,
    strData: row.strData
  });
}
function validateObject(row) {
  const issues = require('./objectTypes').objectMetadataIssues(row);
  const add = (code, message) => issues.push({
    code,
    message
  });
  const data = row.strData;
  if (!data || typeof data !== 'object' || Array.isArray(data)) add('GENOTYPE', 'Генотип должен быть объектом локусов.');else for (const [locus, alleles] of Object.entries(data)) {
    if (!detector.getCanonicalLocusName(locus)) add('LOCUS', `Неизвестный локус: ${locus}.`);
    if (!Array.isArray(alleles) || alleles.length > 100 || alleles.some(value => typeof value !== 'string' || !value || value.length > 500)) add('ALLELES', `Неверная структура аллелей ${locus}.`);else {
      const checked = detector.validateAlleles(locus, alleles);
      if (!checked.isValid) add('ALLELES', `${locus}: ${checked.errors.join('; ')}`);
    }
  }
  return issues;
}
function serializeV2(profile) {
  const provenance = profile.provenance || {};
  return {
    objectNumber: profile.objectNumber ?? '',
    year: profile.year ?? '',
    expertiseType: profile.expertiseType || '',
    fullName: profile.expertiseType === 'staff' ? profile.fullName || '' : '',
    comment: profile.comment || '',
    registrationNumber: profile.expertiseType === 'staff' ? profile.objectNumber || '' : '',
    legacyDepartment: provenance.departmentName || '',
    sourceTable: provenance.table || '',
    sourceId: provenance.id || '',
    legacySampleName: provenance.sampleName ?? '',
    legacyImportNumber: provenance.importNumber ?? '',
    sourceObjectNumber: provenance.sourceObjectNumber ?? profile.objectNumber ?? '',
    provenanceJson: stableJSON(provenance),
    genotypeJson: stableJSON(profile.strData || {})
  };
}
module.exports = {
  FORMAT,
  TYPES,
  FIELDS,
  stableJSON,
  hash,
  hasGenotype,
  normalizeType,
  businessKey,
  analysisHash,
  validateObject,
  serializeV2
};
