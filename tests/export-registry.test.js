const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {ExportRegistry}=require('../src/services/audit/exportRegistry');
test('Экспорт: точный ID, владелец/отделение, перезапуск, срок и защита от symlink',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dna-export-registry-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const registry=new ExportRegistry(directory),id=randomUUID(),owner={userId:randomUUID(),departmentId:randomUUID(),organizationId:randomUUID()};
 await fs.writeFile(path.join(directory,'foreign.xlsx'),'synthetic');await registry.register(id,'foreign.xlsx',owner);
 assert.equal((await new ExportRegistry(directory).get(id,owner)).filename,'foreign.xlsx');
 for(const key of Object.keys(owner))await assert.rejects(()=>registry.get(id,{...owner,[key]:randomUUID()}),{status:403});
 for(const unknown of [randomUUID(),'foreign','../foreign'])await assert.rejects(()=>registry.get(unknown,owner),{status:404});
 const meta=JSON.parse(await fs.readFile(path.join(directory,id+'.json'),'utf8'));await fs.writeFile(path.join(directory,id+'.json'),JSON.stringify({...meta,expiresAt:Date.now()-1}));
 await assert.rejects(()=>registry.get(id,owner),{status:404});
 const symlinkId=randomUUID();await fs.symlink('foreign.xlsx',path.join(directory,'linked.xlsx'));await registry.register(symlinkId,'linked.xlsx',owner);await assert.rejects(()=>registry.get(symlinkId,owner),{status:404});
});
