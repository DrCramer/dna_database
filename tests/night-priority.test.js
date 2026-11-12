const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {executeWorkerRanges}=require('../src/services/profiles/searchWorkerExecutor');
test('Manual search interrupts background workers, runs first, and releases the CPU queue',async()=>{
  const workerPath=path.join(__dirname,'fixtures/night-priority-worker.js');
  let running;
  const started=new Promise(r=>running=r);
  const background=executeWorkerRanges({workerPath,count:1,priority:'background',createInput:()=>({delay:30000}),onProgress:p=>{if(p.status==='running')running();}});
  const rejected=assert.rejects(background,e=>e.code==='BACKGROUND_YIELD');await started;
  const manual=await executeWorkerRanges({workerPath,count:1,createInput:()=>({delay:1})});
  await rejected;assert.equal(manual[0].done,true);
  assert.equal((await executeWorkerRanges({workerPath,count:1,priority:'background',createInput:()=>({delay:1})}))[0].done,true);
});
