const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const databaseUrl=process.env.REMEDIATION_TEST_DATABASE_URL;
test('Аудит: экспорт, контаминация, отзыв refresh/WebSocket и служебные маршруты',{skip:!databaseUrl},async t=>{
 assert.match(new URL(databaseUrl).pathname,/^\/dna_remediation_test(?:_|$)/);process.env.DATABASE_URL=databaseUrl;process.env.NODE_ENV='test';process.env.JWT_SECRET='synthetic-remediation-secret-not-production-20261109';
 process.env.ENCRYPTION_KEY_PATH=path.join(require('node:os').tmpdir(),'dna-remediation-'+randomUUID()+'.key');fs.writeFileSync(process.env.ENCRYPTION_KEY_PATH,require('crypto').randomBytes(32),{mode:0o600});
 const interval=global.setInterval;global.setInterval=(...a)=>interval(...a).unref();
 const {query,pool}=require('../src/config/database'),User=require('../src/models/User'),auth=require('../src/services/security/authService'),ws=require('../src/services/infrastructure/websocketService');
 const app=require('../src/server');global.setInterval=interval;app.locals.pool=pool;const server=require('node:http').createServer(app);ws.initialize(server);server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>ws.io.close(r));server.closeAllConnections();await require('../src/routes/bayesian').close();await pool.end();fs.rmSync(process.env.ENCRYPTION_KEY_PATH,{force:true});});const base='http://127.0.0.1:'+server.address().port;
 await t.test('Миграция 035 сохраняет UTC-срок старых сессий и повторяется безопасно',async()=>{
  await query("ALTER TABLE user_sessions ALTER COLUMN expires_at TYPE timestamp USING expires_at AT TIME ZONE 'UTC'");
  const id=randomUUID(),date='2026-12-01T10:00:00.000Z';await query('INSERT INTO user_sessions(id,token_hash,expires_at) VALUES($1,$2,$3)',[id,'synthetic-utc',date]);
  const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/035_session_refresh_tokens.sql'),'utf8');await query(migration);await query(migration);
  assert.equal((await query('SELECT expires_at FROM user_sessions WHERE id=$1',[id])).rows[0].expires_at.toISOString(),date);await query('DELETE FROM user_sessions WHERE id=$1',[id]);
 });
 const org=async name=>(await query('INSERT INTO organizations(name) VALUES($1) RETURNING id',[name])).rows[0].id;
 const oa=await org('SYNTHETIC-A'),ob=await org('SYNTHETIC-B');const dept=async id=>(await query("INSERT INTO departments(name,organization_id) VALUES('Генетические экспертизы',$1) RETURNING id",[id])).rows[0].id;const da=await dept(oa),db=await dept(ob);
 const hash=await require('bcryptjs').hash('SyntheticFix!12345',4);
 async function account(role,orgId=oa,departmentId=da){const id=(await query('INSERT INTO users(username,password_hash,role,organization_id,department_id) VALUES($1,$2,$3,$4,$5) RETURNING id',['synthetic_'+randomUUID().slice(0,8),hash,role,orgId,departmentId])).rows[0].id;await query('INSERT INTO user_departments(user_id,department_id,is_primary) VALUES($1,$2,true)',[id,departmentId]);const u=await User.findById(id);await u.getAccessibleDepartments();return u;}
 const viewer=await account('viewer'),analyst=await account('user_analyst'),admin=await account('admin'),foreign=await account('user_analyst',ob,db);
 async function session(u){const sid=randomUUID(),accessToken=auth.generateToken(u,sid),refreshToken=auth.generateRefreshToken(u,sid);await auth.createSession(u.id,accessToken,'127.0.0.1','synthetic-remediation',refreshToken);return{accessToken,refreshToken};}
 const sessions=new Map();for(const u of [viewer,analyst,admin,foreign])sessions.set(u.id,await session(u));
 async function call(url,u=admin,body,token){return fetch(base+url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+(token||sessions.get(u.id).accessToken),'X-Active-Department-Id':u.department_id,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
 const data={TH01:['12','13'],D5S818:['11','12'],D21S11:['29','30']};
 async function profile(u,name){return(await query("INSERT INTO dna_profiles(user_id,organization_id,department_id,sample_name,internal_number,year,str_data,is_active,profile_type,import_format) VALUES($1,$2,$3,$4,$4,2026,$5,true,'user','genetic') RETURNING id",[u.id,u.organization_id,u.department_id,name,JSON.stringify(data)])).rows[0].id;}
 const own=await profile(analyst,'SYNTHETIC-OWN'),other=await profile(foreign,'SYNTHETIC-FOREIGN');
 for(const[u,id]of [[analyst,own],[foreign,other]])await query("INSERT INTO profile_contamination_log(reference_profile_id,matched_profile_id,match_type,matching_loci_count,total_loci_compared,match_percentage,department_id,searched_by,reference_import_number,reference_year) VALUES($1,$1,'full_match',3,3,100,$2,$3,'SYNTHETIC',2026)",[id,u.department_id,u.id]);
 await t.test('Все статистические маршруты используют серверный scope; подмена departmentId и UUID отклоняется',async()=>{
  const r=await call('/api/contamination-stats/history',analyst);assert.equal(r.status,200);const rows=(await r.json()).data;assert.equal(rows.length,1);assert.equal(rows[0].department_id,da);
  assert.equal((await call('/api/contamination-stats/history?departmentId='+db,analyst)).status,403);
  assert.equal((await call('/api/contamination-stats/profile/'+other,analyst)).status,403);
  for(const route of ['by-import','by-period']){const r=await call('/api/contamination-stats/'+route,analyst);assert.equal(r.status,200);assert.equal((await r.json()).data[0].total_searches,'1');}
 });
 await t.test('Наблюдатель не пишет анализы; аналитик не читает чужие профили/историю; свой анализ работает',async()=>{
  assert.equal((await call('/api/staff-contamination/analyze',viewer,{sampleProfileId:other})).status,403);
  for(const route of ['/api/staff-contamination/history/'+other])assert.equal((await call(route,analyst)).status,403);
  assert.equal((await call('/api/staff-contamination/analyze',analyst,{sampleProfileId:other})).status,403);
  assert.equal((await call('/api/staff-contamination/bulk-analyze',analyst,{sampleProfileIds:[own,other]})).status,403);
  assert.equal((await call('/api/staff-contamination/analyze',analyst,{sampleProfileId:own})).status,200);
  assert.equal((await query('SELECT COUNT(*)::int n FROM contamination_analysis WHERE sample_profile_id=$1',[other])).rows[0].n,0);
 });
 await t.test('Скачивание строго по ID/владельцу/отделению; старые файлы без реестра не выдаются',async()=>{
  const dir=path.join(process.cwd(),'exports');fs.mkdirSync(dir,{recursive:true});const {ExportRegistry}=require('../src/services/audit/exportRegistry'),registry=new ExportRegistry(dir);const id=randomUUID();fs.writeFileSync(path.join(dir,'Экспорт синтетический.xlsx'),'SYNTHETIC');
  await registry.register(id,'Экспорт синтетический.xlsx',{userId:foreign.id,departmentId:db,organizationId:ob});
  assert.equal((await call('/api/export/download/'+id,analyst)).status,403);assert.equal((await call('/api/export/download/'+randomUUID(),viewer)).status,404);assert.equal((await call('/api/export/download/synthetic',viewer)).status,404);
  const r=await call('/api/export/download/'+id,foreign);assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/filename\*=UTF-8/);assert.equal(await r.text(),'SYNTHETIC');
 });
 await t.test('Refresh ротируется атомарно; повторное использование отзывает семейство, logout-all отзывает refresh',async()=>{
  const p=await session(analyst);const rotated=await call('/api/auth/refresh',analyst,{refreshToken:p.refreshToken});assert.equal(rotated.status,200);const next=(await rotated.json()).data;
  assert.ok(next.refreshToken);assert.notEqual(next.refreshToken,p.refreshToken);
  assert.equal((await call('/api/auth/refresh',analyst,{refreshToken:p.refreshToken})).status,401);
  assert.equal((await call('/api/auth/me',analyst,null,next.accessToken)).status,401);
  const expired=await session(analyst);await query("UPDATE user_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[require('crypto').createHash('sha256').update(expired.accessToken).digest('hex')]);
  await require('../src/services/infrastructure/scheduledJobService').triggerSessionCleanup();assert.equal((await call('/api/auth/refresh',analyst,{refreshToken:expired.refreshToken})).status,200);
  const fresh=await session(analyst);assert.equal((await call('/api/auth/logout-all',analyst,{},fresh.accessToken)).status,200);
  assert.equal((await call('/api/auth/refresh',analyst,{refreshToken:fresh.refreshToken})).status,401);
  sessions.set(analyst.id,await session(analyst));
 });
 await t.test('Одновременный refresh и logout-all не оставляют активную сессию',async()=>{
  const p=await session(analyst);await Promise.allSettled([auth.refreshToken(p.refreshToken,'127.0.0.1','concurrent'),auth.invalidateAllUserSessions(analyst.id)]);
  assert.equal((await query('SELECT COUNT(*)::int n FROM user_sessions WHERE user_id=$1 AND is_active=true',[analyst.id])).rows[0].n,0);sessions.set(analyst.id,await session(analyst));
 });
 const {io}=require('socket.io-client');
 function socket(token){return io(base,{auth:{token},transports:['websocket'],reconnection:false,forceNew:true});}
 async function connected(s,label='socket'){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket timeout')),5000);s.once('connect',()=>{clearTimeout(timer);resolve();});s.once('connect_error',e=>{clearTimeout(timer);reject(Error(label+': '+e.message));});});}
 await t.test('WebSocket не принимает refresh/отозванную сессию, отключается по exp и logout',async()=>{
  const p=await session(analyst),bad=socket(p.refreshToken);await assert.rejects(()=>connected(bad));bad.disconnect();
  const invalid=socket(auth.generateToken(analyst));await assert.rejects(()=>connected(invalid));invalid.disconnect();
  const valid=socket(p.accessToken);assert.ok(await auth.validateSession(p.accessToken),'valid session exists');await connected(valid,'valid access');const disconnected=new Promise(r=>valid.once('disconnect',r));await auth.invalidateSession(p.accessToken);await disconnected;assert.equal(valid.connected,false);
  const old=auth.jwtExpiresIn;auth.jwtExpiresIn='2s';const short=await session(analyst);auth.jwtExpiresIn=old;const expiring=socket(short.accessToken);await connected(expiring,'short access');await new Promise(r=>expiring.once('disconnect',r));assert.equal(expiring.connected,false);expiring.disconnect();sessions.set(analyst.id,await session(analyst));
 });
 await t.test('Ручная проверка защищена, Bayesian API достижим, чужой профиль запрещён',async()=>{
  assert.equal((await fetch(base+'/health/persistence/verify',{method:'POST'})).status,401);
  assert.equal((await call('/health/persistence/verify',viewer,{})).status,403);
  assert.equal((await call('/health/persistence/verify',admin,{})).status,200);
  assert.notEqual((await call('/api/bayesian/population',admin)).status,404);
  assert.equal((await call('/api/bayesian/compare',analyst,{profile1Id:own,profile2Id:other,populationId:'synthetic'})).status,403);
 });
});
