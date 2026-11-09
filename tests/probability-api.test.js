const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const { randomBytes,randomUUID }=require('node:crypto');
const createRouter=require('../src/routes/probability');
const { ProbabilityStore }=require('../src/services/probability/ProbabilityStore');
const dept='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333',profile='44444444-4444-4444-8444-444444444444';
const synthetic={id:profile,internal_number:'SYNTHETIC-1',sample_name:'SYNTHETIC',year:2026,str_data:{D1S1656:['13','13'],AMEL:['X','Y']}};
function manual(){return{mode:'IDENT',participants:['object1','object2'].map(role=>({role,sourceType:'manual',displayName:role,manualOverrides:{D1S1656:'13'}}))};}
test('Probability API: department scope, every profile, sealed TXT, immutable saved results and exports',async t=>{
 const rows=new Map(),calls=[],key=randomBytes(32);
 const query=async(sql,params)=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT id,name,organization_id FROM departments'))return{rows:[{id:params[0],organization_id:org,name:params[0]===dept?'Генетические экспертизы':'ЧС'}]};
  if(sql.startsWith('SELECT dp.id')){assert.ok(sql.includes('dp.department_id = $1 AND dp.organization_id = $2 AND dp.user_id = $3'));assert.deepEqual(params.slice(0,3),[dept,org,user]);if(sql.includes('ILIKE'))return{rows:[synthetic]};return{rows:params.at(-1)===profile?[synthetic]:[]};}
  if(sql.includes('INSERT INTO probability_calculations')){rows.set(params[0],{id:params[0],user_id:params[1],department_id:params[2],organization_id:params[3],mode:params[4],snapshot_encrypted:params[7],created_at:new Date().toISOString()});return{rows:[]};}
  if(sql.startsWith('SELECT id,snapshot_encrypted')){const r=rows.get(params[0]);return{rows:r&&r.user_id===params[1]&&r.department_id===params[2]&&r.organization_id===params[3]?[r]:[]};}
  if(sql.startsWith('SELECT id,mode'))return{rows:[...rows.values()].filter(r=>r.user_id===params[0]&&r.department_id===params[1]&&r.organization_id===params[2]).map(({snapshot_encrypted,...r})=>r)};
  throw new Error('Unexpected SQL');
 };
 const store=new ProbabilityStore(query,key),app=express();app.use(express.json({limit:'2mb'}));
 app.use('/api/probability',createRouter({silent:true,query,store,authenticate:(req,res,next)=>{
  if(!req.get('Authorization'))return res.status(401).end();req.user={id:req.get('X-Test-User')||user,role:req.get('X-Test-Role')||'user_analyst'};req.activeDepartmentId=req.get('X-Active-Department-Id');next();
 },getScope:async({userId,activeDepartmentId})=>({clause:'dp.department_id = $1 AND dp.organization_id = $2 AND dp.user_id = $3',params:[activeDepartmentId,org,userId]})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const base='http://127.0.0.1:'+server.address().port+'/api/probability';
 const request=(path,body,headers={})=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer synthetic-test-only','X-Active-Department-Id':dept,...(!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 await t.test('authorization and department restrictions',async()=>{
  assert.equal((await fetch(base+'/configuration')).status,401);
  assert.equal((await request('/configuration',null,{'X-Test-Role':'viewer'})).status,403);
  assert.equal((await request('/configuration',null,{'X-Active-Department-Id':randomUUID()})).status,403);
  assert.equal((await request('/configuration',null,{'X-Active-Department-Id':''})).status,403);
 });
 await t.test('scoped search and profile selection; forged data cannot override database source',async()=>{
  assert.equal((await request('/profile-search?q=SYNTHETIC')).status,200);
  const found=await request('/profiles/'+profile);assert.equal(found.status,200);assert.deepEqual((await found.json()).loci.D1S1656,['13','13']);
  assert.equal((await request('/profiles/'+randomUUID())).status,404);
  const i=manual();i.participants[1]={role:'object2',sourceType:'database',sourceId:profile,loci:{D1S1656:['99']}};
  const r=await request('/calculate',i);assert.equal(r.status,200);assert.equal((await r.json()).status,'calculated');
  i.participants[1].sourceDigest='stale-source-digest';assert.equal((await request('/calculate',i)).status,409);
  delete i.participants[1].sourceDigest;i.participants[1].sourceId=randomUUID();assert.equal((await request('/calculate',i)).status,404);
 });
 await t.test('Один TXT с тремя образцами: один preview, отдельные роли TRIO, сохранение и XLSX',async()=>{
  const txt=['Sample Name\tMarker\tAllele 1\tAllele 2',
    'SYN-MOTHER\tD5S818\t11\t12','SYN-CHILD\tD5S818\t11\t12','SYN-FATHER\tD5S818\t11\t11',
    'SYN-MOTHER\tTH01\t7\t9','SYN-CHILD\tTH01\t7\t9','SYN-FATHER\tTH01\t7\t7'].join('\n');
  const form=new FormData();form.append('files',new Blob([txt]),'synthetic-trio.txt');
  const preview=await request('/txt/preview',form);assert.equal(preview.status,200);const sources=(await preview.json()).files[0].samples;
  assert.equal(sources.length,3);assert.ok(sources.every(s=>s.selectable&&s.proof));
  const input={mode:'TRIO',includedLoci:['D5S818','TH01'],participants:['mother','child','father'].map((role,i)=>({...sources[i],role}))};
  const response=await request('/calculations',input);assert.equal(response.status,201);const saved=await response.json();
  assert.equal(saved.status,'calculated');assert.equal(new Set(saved.participants.map(p=>p.sourceId)).size,3);
  assert.deepEqual(saved.rows.find(row=>row.locus==='D5S818').paternalAlleles,['11']);
  assert.deepEqual((await(await request('/calculations/'+saved.id)).json()).participants,saved.participants);
  const frozenXlsx=await request('/calculations/'+saved.id+'/export?format=xlsx');assert.equal(frozenXlsx.status,200);
  assert.equal(frozenXlsx.headers.get('content-disposition'),'attachment; filename="Probability_SYN-MOTHER_SYN-CHILD_SYN-FATHER.xlsx"');
  const currentXlsx=await request('/export',input);assert.equal(currentXlsx.status,200);
  assert.equal(currentXlsx.headers.get('content-disposition'),frozenXlsx.headers.get('content-disposition'));
 });
 let proof;
 await t.test('incomplete loci are off by default in calculate/save/report; forcing one still blocks export',async()=>{
  const input={mode:'TRIO',participants:['mother','child','father'].map(role=>({role,sourceType:'manual',displayName:'Synthetic '+role,
   manualOverrides:{D1S1656:'13',TH01:role==='father'?'':'9.3'}}))};
  const response=await request('/calculations',input);assert.equal(response.status,201);const saved=await response.json();
  assert.equal(saved.status,'calculated');assert.equal(saved.summary.lociCount,1);assert.deepEqual(saved.excludedLoci,['TH01']);
  assert.deepEqual(saved.report.rows.map(row=>row[0]),['D1S1656']);
  const frozen=await(await request('/calculations/'+saved.id)).json();assert.deepEqual(frozen.includedLoci,['D1S1656']);
  const forced={...input,includedLoci:['D1S1656','TH01']};
  const blocked=await(await request('/calculate',forced)).json();assert.equal(blocked.status,'blocked');
  assert.equal((await request('/export',forced)).status,409);
 });
 await t.test('TXT single homozygote fills both alleles through sealed source, save and report',async()=>{
  const form=new FormData();form.append('files',new Blob(['Sample Name\tMarker\tAllele 1\tAllele 2\nSYN-SINGLE\tD1S1656\t13\t\nSYN-SINGLE\tDYS391\t10\t\n']),'single.txt');
  const preview=await request('/txt/preview',form);assert.equal(preview.status,200);const sample=(await preview.json()).files[0].samples[0];
  assert.deepEqual(sample.loci.D1S1656,['13','13']);assert.deepEqual(sample.loci.DYS391,['10']);
  const i={mode:'IDENT',participants:[{role:'object',sourceType:'txt',proof:sample.proof}],includedLoci:['D1S1656']};
  const response=await request('/calculations',i);assert.equal(response.status,201);const saved=await response.json();
  assert.deepEqual(saved.participants[0].loci.D1S1656,['13','13']);
  assert.deepEqual(saved.participants[0].sourceSnapshot.rawLoci[0].alleles,['13','','','','']);
  assert.deepEqual(saved.report.rows[0].slice(1,3),['13','13']);
  const reopened=await(await request('/calculations/'+saved.id)).json();assert.deepEqual(reopened.participants,saved.participants);
 });
 await t.test('single-genotype IDENT is the default API contract and saves one source',async()=>{
  const configuration=await(await request('/configuration')).json();assert.deepEqual(configuration.modes.IDENT,['object']);
  const input={mode:'IDENT',participants:[{role:'object',sourceType:'manual',displayName:'Synthetic single',manualOverrides:{D1S1656:'13,14'}}]};
  const calculated=await request('/calculate',input);assert.equal(calculated.status,200);const c=await calculated.json();
  assert.equal(c.status,'calculated');assert.equal(c.participants.length,1);assert.deepEqual(c.report.columns.slice(1,3),['','']);
  const savedResponse=await request('/calculations',input);assert.equal(savedResponse.status,201);const saved=await savedResponse.json();
  const reopened=await(await request('/calculations/'+saved.id)).json();assert.equal(reopened.participants.length,1);assert.deepEqual(reopened.summary,c.summary);
  assert.equal((await request('/export',input)).status,200);
  const db=await request('/calculate',{mode:'IDENT',participants:[{role:'object',sourceType:'database',sourceId:profile,loci:{D1S1656:['99']}}]});
  assert.equal(db.status,200);assert.deepEqual((await db.json()).participants[0].loci.D1S1656,['13','13']);
 });
 await t.test('IDENT supports the extended heterozygote set and sealed TXT star homozygotes with immutable raw calls',async()=>{
  const frequencies=require('../src/services/probability/data/workbook-reference.json').frequencies;
  const calls=['D19S253','D15S659','D3S3045','D10S1435'].map(locus=>['SYN-EXTENDED',locus,
   ...Object.entries(frequencies[locus]).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([allele])=>allele)].join('\t'));
  const form=new FormData();form.append('files',new Blob(['Sample Name\tMarker\tAllele 1\tAllele 2\n'+
   calls.join('\n')+'\nSYN-EXTENDED\tD21S11\t30\t*\n']),'synthetic-extended.txt');
  const preview=await request('/txt/preview',form);assert.equal(preview.status,200);const sample=(await preview.json()).files[0].samples[0];
  assert.deepEqual(sample.loci.D21S11,['30','30']);assert.equal(sample.rawLoci.at(-1).alleles[1],'*');
  const input={mode:'IDENT',participants:[{role:'object',sourceType:'txt',proof:sample.proof}]};
  const response=await request('/calculations',input);assert.equal(response.status,201);const c=await response.json();
  assert.equal(c.status,'calculated');assert.equal(c.summary.lociCount,5);assert.ok(c.rows.every(row=>row.status==='OK'));
  assert.deepEqual(c.report.rows.find(row=>row[0]==='D21S11').slice(1,3),['30','30']);
  assert.equal(c.participants[0].sourceSnapshot.rawLoci.at(-1).alleles[1],'*');
  const reopened=await(await request('/calculations/'+c.id)).json();assert.deepEqual(reopened.rows,c.rows);assert.deepEqual(reopened.summary,c.summary);
  assert.equal((await request('/calculations/'+c.id+'/export?format=xlsx')).status,200);
  assert.equal((await request('/calculate',{...input,formulaVersion:'probability-2.5.1-a29-formula-sheet-mu-2'})).status,409);
 });
 await t.test('three separately previewed TXT files retain their own TRIO sources and paternal candidates',async()=>{
  const participants=[];
  for(const [role,alleles]of [['mother',['13','13']],['child',['13','14']],['father',['14','15']]]){
   const body=new FormData();body.append('files',new Blob(['Sample Name\tMarker\tAllele 1\tAllele 2\nSYN-'+role+'\tD1S1656\t'+alleles.join('\t')+'\n']),role+'.txt');
   const response=await request('/txt/preview',body);assert.equal(response.status,200);const file=(await response.json()).files[0];
   participants.push({role,sourceType:'txt',proof:file.samples[0].proof});
  }
  const response=await request('/calculate',{mode:'TRIO',participants});assert.equal(response.status,200);const c=await response.json();
  assert.equal(c.status,'calculated');assert.deepEqual(c.participants.map(p=>p.filename),['mother.txt','child.txt','father.txt']);
  assert.deepEqual(c.rows[0].paternalAlleles,['14']);assert.equal(c.rows[0].paternalAllelesAmbiguous,false);
  assert.deepEqual(c.report.columns.slice(1,4),['Аллели неоспариваемого родителя','Аллели ребёнка','Аллели оспариваемого родителя']);
  const invalid={mode:'IDENT',participants:[{role:'object',sourceType:'txt',proof:participants[0].proof}]};
  assert.equal((await request('/calculate',invalid,{'X-Test-User':randomUUID()})).status,403);
 });
 await t.test('paternal display excludes the absent father allele while saved/exported LR stays on the workbook branch',async()=>{
  const i={mode:'TRIO',participants:['mother','child','father'].map((role,index)=>({role,sourceType:'manual',displayName:'Synthetic '+role,
   manualOverrides:{D5S818:index===2?'11,11':'11,12'}}))};
  const response=await request('/calculations',i);assert.equal(response.status,201);const c=await response.json();
  assert.deepEqual(c.rows[0].paternalAlleles,['11']);assert.equal(c.rows[0].paternalAlleleStatus,'MATCH');
  assert.deepEqual(c.rows[0].formulaAlleles,['11','12']);assert.equal(c.rows[0].frequencies.length,2);
  const reopened=await(await request('/calculations/'+c.id)).json();assert.deepEqual(reopened.rows,c.rows);
  assert.equal((await request('/calculations/'+c.id+'/export?format=xlsx')).status,200);
 });
 await t.test('TXT preview signs samples, no source profile insert; mixed sources calculate',async()=>{
  const body=new FormData();body.append('files',new Blob(['Sample Name\tSample Type\tMarker\tAllele 1\tAllele 2\nSYNTHETIC-TXT\tSample\tD1S1656\t13\t13\nPC\tPositive Control\tD1S1656\t13\t13\n']),'synthetic.txt');
  const response=await request('/txt/preview',body);assert.equal(response.status,200);const f=await response.json();
  proof=f.files[0].samples[0].proof;assert.ok(proof);assert.equal(f.files[0].samples[1].proof,undefined);
  const i=manual();i.participants[0]={role:'object1',sourceType:'txt',proof};i.participants[1]={role:'object2',sourceType:'database',sourceId:profile};
  const calculated=await request('/calculate',i);assert.equal(calculated.status,200);assert.equal((await calculated.json()).status,'calculated');
  assert.ok(!calls.some(c=>/INSERT INTO dna_profiles/.test(c.sql)));
  assert.equal((await request('/calculate',i,{'X-Test-User':randomUUID()})).status,403);
  i.participants[0].proof=proof+'x';assert.equal((await request('/calculate',i)).status,400);
 });
 await t.test('encrypted snapshots stay unchanged, owner/dept guarded, XLSX has no auth token',async()=>{
  const response=await request('/calculations',manual());assert.equal(response.status,201);const saved=await response.json();
  assert.ok(saved.id);const encrypted=rows.get(saved.id).snapshot_encrypted;assert.ok(!encrypted.includes('D1S1656'));assert.ok(!encrypted.includes('object1'));
  assert.deepEqual((await(await request('/calculations/'+saved.id)).json()).summary,saved.summary);
  assert.equal((await request('/calculations/'+saved.id,null,{'X-Test-User':randomUUID()})).status,404);
  assert.equal((await request('/calculations/'+saved.id+'/export?format=xlsx',null,{'X-Test-User':randomUUID()})).status,404);
  const xlsx=await request('/calculations/'+saved.id+'/export?format=xlsx');assert.equal(xlsx.status,200);assert.match(xlsx.headers.get('content-type'),/spreadsheetml/);
  const report=await(await request('/calculations/'+saved.id+'/export?format=report')).json();assert.ok(!JSON.stringify(report).includes('synthetic-test-only'));
  const listing=await(await request('/calculations')).json();assert.equal(listing.calculations[0].snapshot_encrypted,undefined);
  const sealed=store.seal({x:1});const tampered=JSON.parse(sealed);tampered.data=Buffer.from('forged').toString('base64');assert.throws(()=>store.open(JSON.stringify(tampered)));
 });
 await t.test('saved legacy 100% is corrected in API/report presentation without rewriting the encrypted snapshot',async()=>{
  const c=await(await request('/calculate',manual())).json();delete c.report;
  c.summary.probability=1-Number.EPSILON/2;c.summary.complement=Number.EPSILON/2;
  c.summary.probabilityText='100%';c.summary.probabilityFractionText='1';c.summary.complementText='0%';
  const saved=await store.save({userId:user,departmentId:dept,organizationId:org},c),encrypted=rows.get(saved.id).snapshot_encrypted;
  const reopened=await(await request('/calculations/'+saved.id)).json();
  assert.match(reopened.summary.probabilityText,/^>/);assert.match(reopened.summary.probabilityFractionText,/^>/);
  assert.equal(reopened.summary.probability,c.summary.probability);assert.equal(reopened.summary.index,c.summary.index);
  assert.deepEqual(reopened.report.summaryRows.find(r=>r.key==='probability').values,[reopened.summary.probabilityFractionText,reopened.summary.probabilityText]);
  const report=await(await request('/calculations/'+saved.id+'/export?format=report')).json();
  assert.deepEqual(report.summaryRows,reopened.report.summaryRows);
  assert.equal((await request('/calculations/'+saved.id+'/export?format=xlsx')).status,200);
  assert.equal(rows.get(saved.id).snapshot_encrypted,encrypted);assert.equal(store.open(encrypted).summary.probabilityText,'100%');
 });
 await t.test('invalid roles, fake versions, unknown inputs and blocked exports reject clearly',async()=>{
  const i=manual();i.participants[1].role='object1';assert.equal((await request('/calculate',i)).status,400);
  assert.equal((await request('/calculate',{...manual(),referenceId:'forged'})).status,409);
  const blocked=manual();blocked.participants[0].manualOverrides.D1S1656='?';assert.equal((await request('/export',blocked)).status,409);
 });
});
