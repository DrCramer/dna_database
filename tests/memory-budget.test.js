const test = require('node:test'), assert = require('node:assert/strict');
const {workerCapacity, backgroundAllowed, assertSearchMemory, MiB} = require('../src/services/infrastructure/memoryBudget');
test('Memory pressure bounds workers by both host and container and pauses night work', () => {
  const s = (host, container) => ({hostAvailable: host === null ? null : host * MiB, containerAvailable: container === null ? null : container * MiB});
  assert.equal(workerCapacity(s(4096,1024)),3);
  assert.equal(workerCapacity(s(512,2048)),1);
  assert.equal(workerCapacity(s(null,null)),16);
  assert.equal(backgroundAllowed(s(4096,1024)),true);
  assert.equal(backgroundAllowed(s(512,2048)),false);
  assert.equal(backgroundAllowed(s(4096,512)),false);
  assert.throws(()=>assertSearchMemory(s(128,2048)), e=>e.code==='SEARCH_MEMORY_PRESSURE'&&e.status===503);
  assert.throws(()=>assertSearchMemory(s(4096,128)), e=>e.status===503);
  assert.doesNotThrow(()=>assertSearchMemory(s(1024,1024)));
});
test('Build memory guard refuses low memory without starting or stopping services', () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dna-memory-'));
  try {
    const file=path.join(dir,'meminfo');
    for(const [mib,status] of [[512,1],[2048,0]]) {
      fs.writeFileSync(file,`MemTotal: 8000000 kB\nMemAvailable: ${mib*1024} kB\n`);
      const r=spawnSync('bash',[path.join(__dirname,'../scripts/check-build-memory.sh'),file],{encoding:'utf8'});
      assert.equal(r.status,status,r.stderr);assert.match(r.stdout+r.stderr,new RegExp(String(mib)));
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
