const formatters = new Map();
const DEFAULT_POLICY = Object.freeze({enabled:false,timezone:'Europe/Moscow',days:[1,2,3,4,5,6,7],startTime:'22:00',endTime:'07:00',finishPolicy:'pause',maxWorkers:2,chunkSize:16,revision:0});
function formatter(timezone) {
  if(!formatters.has(timezone)) {
    if(formatters.size>128)formatters.clear();
    formatters.set(timezone,new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
  }
  return formatters.get(timezone);
}
function windowAt(now,policy) {
  const p=Object.fromEntries(formatter(policy.timezone).formatToParts(now).map(x=>[x.type,x.value]));
  const minute=Number(p.hour)*60+Number(p.minute), parse=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
  const start=parse(policy.startTime),end=parse(policy.endTime),cross=start>end;
  const anchor=new Date(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day)));
  if(cross&&minute<end)anchor.setUTCDate(anchor.getUTCDate()-1);
  const day=anchor.getUTCDay()||7;
  const open=policy.days.includes(day)&&(cross?(minute>=start||minute<end):(minute>=start&&minute<end));
  return {open,key:anchor.toISOString().slice(0,10)+':'+policy.revision};
}
function nextWindows(now,policy,count=3) {
  const result=[],seen=new Set();
  for(let t=Math.floor(now.getTime()/60000)*60000;t<now.getTime()+29*86400000&&result.length<count;t+=60000) {
    const w=windowAt(new Date(t),policy);
    if(w.open&&!seen.has(w.key)){seen.add(w.key);result.push(new Date(t).toISOString());}
  }
  return result;
}
function fromDB(row) {
  return row?{enabled:row.enabled,timezone:row.timezone,days:row.days,startTime:row.start_time,endTime:row.end_time,finishPolicy:row.finish_policy,maxWorkers:row.max_workers,chunkSize:row.chunk_size,revision:Number(row.revision)}:{...DEFAULT_POLICY,days:[...DEFAULT_POLICY.days]};
}
module.exports={DEFAULT_POLICY,windowAt,nextWindows,fromDB,formatter};
