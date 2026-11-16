// Opt-in wire format. Preserve all diagnostics while transmitting shared audit
// entries and reference evaluations once. No genotype normalization happens here.
const LEGACY_FORMAT = 'compact-v1', FORMAT = 'compact-v2';
function packLegacyPreview(result) {
  const entries = [], evaluations = [], byObject = new WeakMap(), byId = new Map(), byEvaluation = new WeakMap();
  const equal = (a,b) => {const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>a[key]===b[key]);};
  function entry(value) {
    if (byObject.has(value)) return byObject.get(value);
    const siblings=byId.get(value.id)||[];
    const prior=siblings.find(item=>equal(item.value,value));
    if(prior){byObject.set(value,prior.index);return prior.index;}
    const index=entries.length;
    entries.push(null);byObject.set(value,index);
    siblings.push({value,index});byId.set(value.id,siblings);
    const {reference,variants,...data}=value;
    if(reference){
      const {decision,appliedValue,...core}=reference;
      let evaluation=byEvaluation.get(reference.candidates);
      if(evaluation===undefined){evaluation=evaluations.length;evaluations.push(core);if(reference.candidates)byEvaluation.set(reference.candidates,evaluation);}
      data.reference={evaluation,...(Object.hasOwn(reference,'decision')?{decision}:{}),...(Object.hasOwn(reference,'appliedValue')?{appliedValue}:{})};
    }
    if(variants)data.variants=variants.map(entry);
    entries[index]=data;return index;
  }
  const {profiles,issues,conflicts,...rest}=result;
  return {previewFormat:LEGACY_FORMAT,data:{...rest,issues:issues.map(entry),conflicts:conflicts.map(entry),profiles:profiles.map(profile=>({...profile,audit:profile.audit.map(entry)}))},entries,evaluations};
}
function packConverterPreview(result,format=FORMAT) {
  const packed=packLegacyPreview(result);
  if(format===LEGACY_FORMAT)return packed;
  const contexts=[],details=[],contextIds=new Map(),detailIds=new Map();
  const intern=(value,values,index,limit=Infinity)=>{const key=JSON.stringify(value);if(index.has(key))return index.get(key);const id=values.length;values.push(value);if(index.size<limit)index.set(key,id);return id;};
  const entries=packed.entries.map(value=>{
    const context={},body={},common={};
    for(const key of Object.keys(value).sort()){
      if(['fileId','sourceFile','sourceSheet'].includes(key))context[key]=value[key];
      else if(['id','sourceRow','column','objectNumber','profileKey','variants'].includes(key))body[key]=value[key];
      else common[key]=value[key];
    }
    return [intern(context,contexts,contextIds),intern(common,details,detailIds,8192),body];
  });
  return {...packed,previewFormat:FORMAT,entries,contexts,details};
}
function unpackConverterPreview(payload) {
  if(![FORMAT,LEGACY_FORMAT].includes(payload.previewFormat))return payload;
  const {data,entries,evaluations}=payload;
  const restored=entries.map(value=>payload.previewFormat===FORMAT?{...payload.contexts[value[0]],...payload.details[value[1]],...value[2]}:{...value});
  restored.forEach(value=>{
    if(value.reference){const {evaluation,...extra}=value.reference;value.reference={...evaluations[evaluation],...extra};}
    if(value.variants)value.variants=value.variants.map(id=>restored[id]);
  });
  return {...data,issues:data.issues.map(id=>restored[id]),conflicts:data.conflicts.map(id=>restored[id]),profiles:data.profiles.map(profile=>({...profile,audit:profile.audit.map(id=>restored[id])}))};
}
module.exports={FORMAT,LEGACY_FORMAT,packConverterPreview,unpackConverterPreview};
