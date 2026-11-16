// Opt-in wire format. Preserve all diagnostics while transmitting shared audit
// entries and reference evaluations once. No genotype normalization happens here.
const FORMAT = 'compact-v1';
function packConverterPreview(result) {
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
  return {previewFormat:FORMAT,data:{...rest,issues:issues.map(entry),conflicts:conflicts.map(entry),profiles:profiles.map(profile=>({...profile,audit:profile.audit.map(entry)}))},entries,evaluations};
}
function unpackConverterPreview(payload) {
  if(payload.previewFormat!==FORMAT)return payload;
  const {data,entries,evaluations}=payload;
  const restored=entries.map(value=>({...value}));
  entries.forEach((value,index)=>{
    if(value.reference){const {evaluation,...extra}=value.reference;restored[index].reference={...evaluations[evaluation],...extra};}
    if(value.variants)restored[index].variants=value.variants.map(id=>restored[id]);
  });
  return {...data,issues:data.issues.map(id=>restored[id]),conflicts:data.conflicts.map(id=>restored[id]),profiles:data.profiles.map(profile=>({...profile,audit:profile.audit.map(id=>restored[id])}))};
}
module.exports={FORMAT,packConverterPreview,unpackConverterPreview};
