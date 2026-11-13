const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),compression=require('compression');
const {streamWorkspaceSearch}=require('../src/services/workspace/workspaceSearchStream');

async function server(t,service) {
  const app=express();app.use(compression());app.use(express.json());
  app.post('/stream',async(req,res)=>{
    req.user={id:'SYN-user',organization_id:'SYN-org',role:'user_analyst'};
    await streamWorkspaceSearch(req,res,service,req.body);
  });
  const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
  t.after(async()=>{s.closeAllConnections();await new Promise(r=>s.close(r));});
  return 'http://127.0.0.1:'+s.address().port+'/stream';
}
const request={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:['SYN'],parameters:{}})};
test('Progress is flushed before result with compression enabled; terminal frame follows the committed result',async t=>{
  let finish;
  const url=await server(t,{async fullSearch(_user,_ids,_params,_signal,progress){
    progress({stage:'internal',status:'running',completed:0,total:4,unit:'objects'});
    await new Promise(resolve=>finish=resolve);
    progress({stage:'complete',status:'running'});return{id:'SYN-result'};
  }});
  const response=await fetch(url,request),reader=response.body.getReader();
  assert.match(response.headers.get('cache-control'),/no-transform/);
  assert.equal(response.headers.get('content-encoding'),null);
  const first=await reader.read(),decoder=new TextDecoder();
  const start=decoder.decode(first.value);assert.match(start, /"type":"progress"/);assert.doesNotMatch(start, /"type":"result"/);
  finish();let rest='';for(;;){const {value,done}=await reader.read();if(done)break;rest+=decoder.decode(value);}
  const frames=(start+rest).trim().split('\n').map(line=>JSON.parse(line));assert.equal(frames.at(-1).type,'result');assert.equal(frames.at(-1).result.id,'SYN-result');
});
test('Client disconnect aborts the calculation; streamed errors expose a safe message and no result',async t=>{
  let stopped;
  const cancelled=new Promise(r=>stopped=r);
  const url=await server(t,{async fullSearch(_user,_ids,_params,signal,progress){
    progress({stage:'staff',status:'running',completed:0,total:10});
    await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{stopped(true);reject(signal.reason);},{once:true}));
  }});
  const controller=new AbortController(),response=await fetch(url,{...request,signal:controller.signal});
  await response.body.getReader().read();controller.abort();
  const timer=setTimeout(()=>stopped(false),2000);assert.equal(await cancelled,true);clearTimeout(timer);
  const failure=await server(t,{async fullSearch(){throw Error('SYN-private-diagnostic');}});
  const frames=(await(await fetch(failure,request)).text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(frames.at(-1).type,'error');assert.equal(frames.at(-1).status,500);
  assert(!JSON.stringify(frames).includes('private-diagnostic'));assert(!frames.some(f=>f.type==='result'));
});
