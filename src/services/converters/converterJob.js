const {GeneticExcelConverterService,ConversionError}=require('./geneticExcelConverterService');
const {FORMAT,LEGACY_FORMAT,SPARSE_FORMAT,packConverterPreview}=require('../../utils/converterPreviewTransport');
const {geneMapperExportResult}=require('./geneMapperSourceAdapter');
const {normalizedExcelFilename}=require('../../utils/normalizedExcelLayout');
const {createHash}=require('node:crypto');
const {profileSources,selectConverterProfiles,legacyConverterResult}=require('../../utils/converterSelection');
const JSZip=require('jszip');

function selectionFingerprint(result) {
  const hash = createHash('sha256');
  for (const profile of result.profiles) hash.update(JSON.stringify(profileSources(profile))).update('\n');
  return hash.digest('hex');
}

function applyExportSelection(result, selection) {
  if (selection === undefined) return result;
  const { fingerprint, excludedIndices } = selection || {};
  if (!Array.isArray(excludedIndices) || excludedIndices.length > result.profiles.length ||
      excludedIndices.some(index => !Number.isInteger(index) || index < 0 || index >= result.profiles.length) ||
      new Set(excludedIndices).size !== excludedIndices.length) {
    throw new ConversionError('Некорректный выбор объектов. Повторите проверку файлов.');
  }
  if (fingerprint !== selectionFingerprint(result)) {
    throw new ConversionError('Состав объектов изменился. Повторите проверку файлов и проверьте выбор.', 'CONVERTER_SELECTION_CHANGED', 409);
  }
  if (excludedIndices.length === result.profiles.length) {
    throw new ConversionError('Выберите хотя бы один объект для сохранения.');
  }
  return selectConverterProfiles(result, excludedIndices);
}

function auditGeneMapperFiles(result, options, selectionApplied) {
  const selectedSamples = new Map();
  if (selectionApplied) {
    for (const profile of result.profiles) for (const source of profile.sources) {
      if (!source.geneMapper) continue;
      if (!selectedSamples.has(source.fileId)) selectedSamples.set(source.fileId, new Set());
      selectedSamples.get(source.fileId).add(source.geneMapper.sampleName);
    }
  }
  return result.files.filter(file => file.geneMapper).map(file => {
    const selected = selectedSamples.get(file.id);
    const prepared = result.preparedFiles.find(item => item.fileId === file.id);
    const excludedObjects = file.geneMapper.samples.flatMap(sample => {
      const excluded = selectionApplied && sample.exportable && !selected?.has(sample.sampleName);
      if (sample.exportable && !excluded) return [];
      return [{ name: sample.sampleName, category: sample.classification, status: excluded ? 'Снят с выбора' : sample.status }];
    });
    return { fileId: file.id, filename: file.name, year: file.year, panels: file.geneMapper.panelNames,
      summary: { ...file.geneMapper.summary, readyProfiles: prepared.profiles },
      haploidDuplicatesConfirmed: options.files?.[file.id]?.confirmHaploidDuplicates === true, excludedObjects };
  });
}

async function executeConverterJob({files,options,panels,operation},converter=new GeneticExcelConverterService()) {
  if (operation === 'preview-object') {
    const { objectPreviewKey, ...settings } = options;
    const objectPreview = converter.convertObject(files, settings, panels, objectPreviewKey);
    return { bytes: new TextEncoder().encode(JSON.stringify({ objectPreview })), mime: 'application/json', auditFiles: [] };
  }
  if (operation === 'preview-objects') {
    const { objectPreviewKeys, ...settings } = options;
    const patch = converter.convertObjects(files, settings, panels, objectPreviewKeys);
    const objectsPreview = packConverterPreview(patch, SPARSE_FORMAT);
    return { bytes: new TextEncoder().encode(JSON.stringify({ objectsPreview })), mime: 'application/json', auditFiles: [] };
  }
  const converted=converter.convert(files,options,panels); // Presence/frequency checks are intentionally disabled.
  const result=operation==='export'?applyExportSelection(converted,options.export?.profileSelection):converted;
  const legacy=legacyConverterResult(result);
  result.legacyCanImport=legacy.canImport;result.legacyCanUpload=legacy.canUpload;
  const auditFiles=auditGeneMapperFiles(result, options, result !== converted);
  if(operation==='preview'){
    result.selectionFingerprint=selectionFingerprint(result);
    if(options.lazyFiles!==true)for(const f of result.preparedFiles)if(f.ready)f.base64=converter.export(geneMapperExportResult(result,f.fileId),options.export).toString('base64');
    // Original transfer metadata is needed for export, not the preview grid.
    for (const profile of result.profiles) if (profile.transfer) {
      delete profile.provenance;
      delete profile.sourceIssues;
    }
    const preview=[SPARSE_FORMAT,FORMAT,LEGACY_FORMAT].includes(options.previewFormat)?packConverterPreview(result,options.previewFormat):result;
    return {bytes:new TextEncoder().encode(JSON.stringify(preview)),mime:'application/json',auditFiles};
  }
  let output,filename;
  if(options.export?.fileId){try{output=geneMapperExportResult(result,options.export.fileId);}catch(e){throw new ConversionError(e.message,'UNRESOLVED_CONVERSION',409);}filename=output.filename;}
  else if(result.preparedFiles.length&&!options.export?.legacyOnly){const zip=new JSZip(),ready=result.preparedFiles.filter(f=>f.ready);if(!ready.length)throw new ConversionError('Нет допустимых профилей для экспорта.','UNRESOLVED_CONVERSION',409);for(const f of ready)zip.file(f.filename,converter.export(geneMapperExportResult(result,f.fileId),options.export));return {bytes:await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),mime:'application/zip',filename:'GeneMapper_Export.zip',auditFiles};}
  else{output=options.export?.legacyOnly?legacy:result;filename=normalizedExcelFilename(output.profiles);}
  return {bytes:new Uint8Array(converter.export(output,options.export)),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename,auditFiles};
}
module.exports={executeConverterJob};
