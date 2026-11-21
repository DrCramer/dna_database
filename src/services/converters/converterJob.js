const {GeneticExcelConverterService,ConversionError}=require('./geneticExcelConverterService');
const {FORMAT,LEGACY_FORMAT,SPARSE_FORMAT,packConverterPreview}=require('../../utils/converterPreviewTransport');
const {geneMapperExportResult}=require('./geneMapperSourceAdapter');
const {normalizedExcelFilename}=require('../../utils/normalizedExcelLayout');
const JSZip=require('jszip');
function legacyResult(result){const ids=new Set(result.files.filter(f=>!f.geneMapper).map(f=>f.id)),profiles=result.profiles.filter(p=>p.sources.every(s=>ids.has(s.fileId)));return {...result,profiles,canImport:profiles.length>0&&!result.issues.some(i=>i.hard&&(ids.has(i.fileId)||i.profileKey&&profiles.some(p=>p.key===i.profileKey)))};}
async function executeConverterJob({files,options,panels,operation},converter=new GeneticExcelConverterService()) {
  if (operation === 'preview-object') {
    const { objectPreviewKey, ...settings } = options;
    const objectPreview = converter.convertObject(files, settings, panels, objectPreviewKey);
    return { bytes: new TextEncoder().encode(JSON.stringify({ objectPreview })), mime: 'application/json', auditFiles: [] };
  }
  const result=converter.convert(files,options,panels); // Presence/frequency checks are intentionally disabled.
  const legacy=legacyResult(result);
  result.legacyCanImport=legacy.canImport;result.legacyCanUpload=legacy.canImport&&legacy.profiles.every(p=>p.year!=null);
  const auditFiles=result.files.filter(f=>f.geneMapper).map(f=>({fileId:f.id,filename:f.name,year:f.year,panels:f.geneMapper.panelNames,summary:f.geneMapper.summary,haploidDuplicatesConfirmed:options.files?.[f.id]?.confirmHaploidDuplicates===true,excludedObjects:f.geneMapper.samples.filter(s=>!s.exportable).map(s=>({name:s.sampleName,category:s.classification,status:s.status}))}));
  if(operation==='preview'){
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
