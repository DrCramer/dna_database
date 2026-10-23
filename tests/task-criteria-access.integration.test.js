const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

const databaseUrl=process.env.CRITERIA_TEST_DATABASE_URL;
test('Сравнение сотрудников: реальные PostgreSQL/authenticate, назначение задачи и границы отделения', {skip:!databaseUrl}, async t=>{
  assert.match(new URL(databaseUrl).pathname,/^\/dna_criteria_test(?:_|$)/);
  process.env.DATABASE_URL=databaseUrl; process.env.NODE_ENV='test'; process.env.JWT_SECRET='isolated-criteria-test-jwt-secret-2026';
  const {query,pool}=require('../src/config/database');
  const User=require('../src/models/User');
  const interval=global.setInterval;global.setInterval=(...args)=>interval(...args).unref();
  const auth=require('../src/services/security/authService');const router=require('../src/routes/genotypeAnalysisRoutes');global.setInterval=interval;
  const express=require('express');const app=express();app.use(express.json());app.locals.pool=pool;app.use('/analysis',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();});
  const suffix=randomUUID().slice(0,8);
  const org=(await query('INSERT INTO organizations(name) VALUES ($1) RETURNING id',['Criteria fixture '+suffix])).rows[0].id;
  const foreignOrg=(await query('INSERT INTO organizations(name) VALUES ($1) RETURNING id',['Foreign criteria fixture '+suffix])).rows[0].id;
  const department=async (organization,name='Генетические экспертизы')=>(await query('INSERT INTO departments(name,organization_id) VALUES ($1,$2) RETURNING id',[name,organization])).rows[0].id;
  const dept=await department(org),otherDept=await department(org,'ЧС'),foreignDept=await department(foreignOrg);
  async function user(role){const id=(await query('INSERT INTO users(username,password_hash,role,organization_id,department_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',[role+randomUUID(),'synthetic-unused-password-hash',role,org,dept])).rows[0].id;
    await query('INSERT INTO user_departments(user_id,department_id,is_primary) VALUES ($1,$2,true)',[id,dept]);
    const token=auth.generateToken(await User.findById(id));await auth.createSession(id,token,'127.0.0.1','criteria fixture');return{id,token};}
  const a=await user('user_analyst'),b=await user('user_analyst'),admin=await user('admin');
  async function task(owner,departmentId=dept,status='in_progress',active=true){return(await query(`INSERT INTO tasks(department_id,created_by,assigned_to_user,title,target_sample,data_source,status,is_active)
    VALUES ($1,$2,$2,'Synthetic criteria task','{}','new_array',$3,$4) RETURNING id`,[departmentId,owner.id,status,active])).rows[0].id;}
  const source=await task(a),target=await task(b),completed=await task(b,dept,'completed'),inactive=await task(b,dept,'in_progress',false),other=await task(b,otherDept),foreign=await task(b,foreignDept);
  const data={TH01:['8','8'],DYS391:['10'],Rs771783753:['1'],DXS6795:['12']};
  const pair={TH01:['8','8'],DYS391:['10','10'],Rs771783753:['1','1'],DXS6795:['12','12']};
  async function profile(taskId,owner,strData,departmentId=dept,organizationId=org,active=true){return(await query(`INSERT INTO dna_profiles(user_id,department_id,organization_id,task_id,sample_name,internal_number,year,str_data,is_active,import_format)
    VALUES ($1,$2,$3,$4,'258',$5,2026,$6,$7,'genetic') RETURNING id`,[owner.id,departmentId,organizationId,taskId,'OBJ-'+randomUUID(),JSON.stringify(strData),active])).rows[0].id;}
  await profile(source,a,data); const matched=await profile(target,b,pair);
  await profile(completed,b,pair);await profile(inactive,b,pair);await profile(other,b,pair,otherDept);await profile(foreign,b,pair,foreignDept,foreignOrg);
  await profile(target,b,pair,otherDept);await profile(target,b,pair,dept,foreignOrg);await profile(target,b,pair,dept,org,false);
  await profile(source,a,pair,otherDept);
  const before=JSON.stringify((await query('SELECT row_to_json(dp) FROM dna_profiles dp ORDER BY id')).rows);
  const base='http://127.0.0.1:'+server.address().port+'/analysis';
  async function call(path,account=a,body={}){return fetch(base+'/'+path,{method:'POST',headers:{Authorization:'Bearer '+account.token,'X-Active-Department-Id':dept,'Content-Type':'application/json'},body:JSON.stringify({taskId:source,minMatches:4,...body})});}
  await t.test('Сотрудник сравнивает свою задачу с активной задачей другого сотрудника, только в своём отделении',async()=>{
    for(const useWorkers of [false,true]){const response=await call('department-tasks-search',a,{useWorkers});assert.equal(response.status,200,await response.clone().text());
      const result=await response.json();assert.equal(result.stats.compareProfilesCount,1);assert.deepEqual(result.results[0].matches.map(m=>m.id),[matched]);assert.equal(result.results[0].matches[0].matchingLoci,4);}
    const response=await call('department-profiles');assert.equal(response.status,200);assert.deepEqual((await response.json()).profiles.map(p=>p.id),[matched]);
    const within=await call('task-search');assert.equal(within.status,200);assert.equal((await within.json()).totalAnalyzed,1);
  });
  await t.test('Подмена исходной задачи и выход из активного отделения запрещены до выдачи генотипов',async()=>{
    for(const path of ['task-search','department-tasks-search','department-profiles']){
      assert.equal((await call(path,a,{taskId:target})).status,403);
      for(const taskId of [other,foreign]) assert.equal((await call(path,admin,{taskId})).status,403);
      assert.equal((await call(path,a,{taskId:randomUUID()})).status,404);
      assert.equal((await call(path,a,{taskId:inactive})).status,404);
    }
  });
  await t.test('Некорректные критерии отклоняются; исходные профили и назначения не изменяются',async()=>{
    for(const body of [{taskId:'258'},{minMatches:0},{minMatches:'4'},{ignoredLoci:'TH01'},{comparisonAlgorithm:'invalid'},{duplicateSettings:{minPercentage:101}}])
      assert.equal((await call('department-tasks-search',a,body)).status,400);
    assert.equal(JSON.stringify((await query('SELECT row_to_json(dp) FROM dna_profiles dp ORDER BY id')).rows),before);
    assert.equal((await query('SELECT assigned_to_user FROM tasks WHERE id=$1',[target])).rows[0].assigned_to_user,b.id);
  });
});
