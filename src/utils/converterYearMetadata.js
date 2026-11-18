const {geneticObjectKey,geneticProfileKey}=require('./profileImportFormat');

// A single file cannot acquire new cross-file merges when only its year changes.
// Export still reconverts and validates the original bytes on the server.
function updateConverterYear(result,options,fileId,value){
  if(!result||result.files.length!==1||result.files[0].id!==fileId||result.files[0].hasYearColumn||result.preparedFiles?.some(file=>file.base64))return null;
  const year=value==null||value===''?null:Number(value);
  if(year!==null&&(!Number.isInteger(year)||year<1900||year>2100))return null;
  const source=result.files[0],keys=new Map(result.profiles.map(profile=>[profile.key,
    source.geneMapper&&options.mergeGeneMapperSources!==true?`${fileId}:${year??'legacy'}:${profile.objectNumber}`:
    year===null?`legacy:${geneticObjectKey(profile.objectNumber)}`:geneticProfileKey(year,profile.objectNumber)]));
  const remapId=id=>{
    if(typeof id!=='string')return id;
    if(id.startsWith('merge:')){const end=id.lastIndexOf(':'),old=id.slice(6,end);return keys.has(old)?`merge:${keys.get(old)}${id.slice(end)}`:id;}
    for(const prefix of ['empty:','panels:','year:'])if(id.startsWith(prefix)){const old=id.slice(prefix.length);return keys.has(old)?prefix+keys.get(old):id;}
    return id;
  };
  const seen=new WeakMap();
  const remap=entry=>{
    if(seen.has(entry))return seen.get(entry);
    const id=remapId(entry.id),profileKey=keys.get(entry.profileKey)||entry.profileKey;
    const variants=entry.variants?.map(remap);
    const changed=id!==entry.id||profileKey!==entry.profileKey||variants?.some((v,i)=>v!==entry.variants[i]);
    const next=changed?{...entry,id,...(Object.hasOwn(entry,'profileKey')?{profileKey}:{}),...(variants?{variants}:{})}:entry;
    seen.set(entry,next);return next;
  };
  const nextOptions={...options,files:{...options.files,[fileId]:{...options.files?.[fileId],year}}};
  if(options.conflicts)nextOptions.conflicts=Object.fromEntries(Object.entries(options.conflicts).map(([id,decision])=>[remapId(id),decision]));
  const next={...result,files:[{...source,year,...(source.geneMapper?{yearConfirmed:year!==null}:{})}],
    profiles:result.profiles.map(profile=>({...profile,key:keys.get(profile.key),year,audit:profile.audit.map(remap)})),
    issues:result.issues.map(remap),conflicts:result.conflicts.map(remap),canUpload:result.canImport&&year!==null};
  if(Object.hasOwn(result,'legacyCanUpload'))next.legacyCanUpload=result.legacyCanImport&&year!==null;
  if(result.preparedFiles)next.preparedFiles=result.preparedFiles.map(file=>({...file,canUpload:file.ready&&year!==null}));
  return {result:next,options:nextOptions};
}
module.exports={updateConverterYear};
