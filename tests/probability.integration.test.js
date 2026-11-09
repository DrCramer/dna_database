const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const databaseUrl=process.env.PROBABILITY_TEST_DATABASE_URL;
test('Probability integration: PostgreSQL, real authenticate, scope and encrypted snapshots',{skip:!databaseUrl},async t=>{
 assert.match(new URL(databaseUrl).pathname,/^\/dna_probability_test(?:_|$)/);
 process.env.DATABASE_URL=databaseUrl;process.env.NODE_ENV='test';process.env.JWT_SECRET='synthetic-probability-integration-secret-2026';
 process.env.ENCRYPTION_KEY_PATH='/tmp/dna-probability-integration-'+randomUUID()+'.key';
 const {query,pool}=require('../src/config/database');
 const interval=global.setInterval;global.setInterval=(...args)=>interval(...args).unref();
 const auth=require('../src/services/security/authService'),User=require('../src/models/User'),createRouter=require('../src/routes/probability');
 global.setInterval=interval;
 const express=require('express'),app=express();app.use(express.json());app.use('/api/probability',createRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();require('fs').rmSync(process.env.ENCRYPTION_KEY_PATH,{force:true});});
 const org=(await query('INSERT INTO organizations(name) VALUES ($1) RETURNING id',['Probability synthetic '+randomUUID()])).rows[0].id;
 const otherOrg=(await query('INSERT INTO organizations(name) VALUES ($1) RETURNING id',['Foreign synthetic '+randomUUID()])).rows[0].id;
 async function department(name,organization=org){return(await query('INSERT INTO departments(name,organization_id) VALUES ($1,$2) RETURNING id',[name,organization])).rows[0].id;}
 const dept=await department('Генетические экспертизы'),otherDept=await department('Другое отделение'),emergency=await department('ЧС'),foreign=await department('Генетические экспертизы',otherOrg);
 async function account(role){
  const id=(await query('INSERT INTO users(username,password_hash,role,organization_id,department_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',['synthetic-'+randomUUID(),'unused-synthetic-hash',role,org,dept])).rows[0].id;
  for(const d of [dept,otherDept,emergency])await query('INSERT INTO user_departments(user_id,department_id,is_primary) VALUES ($1,$2,$3)',[id,d,d===dept]);
  const token=auth.generateToken(await User.findById(id));await auth.createSession(id,token,'127.0.0.1','synthetic probability integration');return{id,token};
 }
 const analyst=await account('user_analyst'),other=await account('user_analyst'),viewer=await account('viewer'),admin=await account('admin');
 async function profile(owner,departmentId=dept,organizationId=org){return(await query(`INSERT INTO dna_profiles(user_id,department_id,organization_id,sample_name,internal_number,year,str_data,is_active,profile_type,import_format)
 VALUES ($1,$2,$3,'SYNTHETIC',$4,2026,$5,true,'user','genetic') RETURNING id`,[owner.id,departmentId,organizationId,'SYN-'+randomUUID(),JSON.stringify({D1S1656:['13','13'],AMEL:['X','Y']})])).rows[0].id;}
 const own=await profile(analyst),stranger=await profile(other),wrongDept=await profile(analyst,otherDept),wrongOrg=await profile(analyst,foreign,otherOrg);
 const base='http://127.0.0.1:'+server.address().port+'/api/probability';
 const request=(path,body,user=analyst,departmentId=dept)=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+user.token,'X-Active-Department-Id':departmentId,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const input=id=>({mode:'IDENT',participants:[{role:'object1',sourceType:'database',sourceId:id},{role:'object2',sourceType:'manual',displayName:'Synthetic second object',manualOverrides:{D1S1656:'13'}}]});
 await t.test('real authentication, department membership, and every source enforce the existing access policy',async()=>{
  assert.equal((await fetch(base+'/configuration')).status,401);
  assert.equal((await request('/configuration',null,viewer)).status,403);
  assert.equal((await request('/configuration',null,analyst,emergency)).status,403);
  assert.equal((await request('/configuration',null,analyst,foreign)).status,403);
  const search=await request('/profile-search?q=SYN-');assert.equal(search.status,200);assert.deepEqual((await search.json()).profiles.map(p=>p.id),[own]);
  for(const id of [stranger,wrongDept,wrongOrg])assert.equal((await request('/calculate',input(id))).status,404);
  assert.equal((await request('/calculate',input(wrongOrg),admin)).status,404);
 });
 await t.test('store uses real encrypted column; snapshots survive profile changes and cross-user reads/exports fail',async()=>{
  const response=await request('/calculations',input(own));assert.equal(response.status,201,await response.clone().text());const saved=await response.json();assert.equal(saved.summary.lociCount,1);
  const encrypted=(await query('SELECT snapshot_encrypted FROM probability_calculations WHERE id=$1',[saved.id])).rows[0].snapshot_encrypted;
  assert.ok(!encrypted.includes('D1S1656'));assert.equal(JSON.parse(encrypted).algorithm,'aes-256-gcm');
  await query('UPDATE dna_profiles SET str_data=$1 WHERE id=$2',[JSON.stringify({D1S1656:['14','14']}),own]);
  const reopened=await request('/calculations/'+saved.id);assert.equal(reopened.status,200);assert.deepEqual((await reopened.json()).summary,saved.summary);
  for(const path of ['/calculations/'+saved.id,'/calculations/'+saved.id+'/export?format=xlsx']){
   assert.equal((await request(path,null,other)).status,404);assert.equal((await request(path,null,analyst,otherDept)).status,403);
  }
  const xlsx=await request('/calculations/'+saved.id+'/export?format=xlsx');assert.equal(xlsx.status,200);assert.ok((await xlsx.arrayBuffer()).byteLength>1000);
  const rows=(await query('SELECT str_data FROM dna_profiles WHERE id=$1',[own])).rows;assert.deepEqual(rows[0].str_data,{D1S1656:['14','14']});
 });
});
