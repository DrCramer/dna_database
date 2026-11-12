const {randomUUID}=require('node:crypto');
const Joi=require('joi');
const {WorkspaceApprovalService}=require('./workspaceApprovalService');
const {requireUser,err}=require('./workspaceService');
const {hash}=require('../../utils/objectImportV2');
const {WORKSPACE_WRITE_ROLES}=require('../../utils/objectTypes');
const {runProfileSearch}=require('../profiles/searchWorkerExecutor');
const {runStaffSearch}=require('../contamination/staffSearchWorkerExecutor');
const {seal,unseal}=require('./workspaceCrypto');
const {ALGORITHM_VERSION}=require('./workspaceSearchService');
const {DEFAULT_POLICY,fromDB,windowAt,nextWindows,formatter}=require('./nightWindow');
const activeStates=['queued','running','paused','paused_window','retry_wait'];
const canManage=user=>['admin','system_administrator'].includes(user.role);
const policySchema=Joi.object({enabled:Joi.boolean().required(),timezone:Joi.string().max(100).required(),
  days:Joi.array().min(1).max(7).unique().items(Joi.number().integer().min(1).max(7)).required(),
  startTime:Joi.string().pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/).required(),endTime:Joi.string().pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/).required(),
  finishPolicy:Joi.string().valid('pause','finish').required(),maxWorkers:Joi.number().integer().min(1).max(16).required(),
  chunkSize:Joi.number().integer().min(1).max(64).required(),expectedRevision:Joi.number().integer().min(0).required()}).options({convert:false});

class NightSearchService {
  constructor(pool,{clock=()=>new Date(),searchService}={}) {
    this.pool=pool;this.clock=clock;this.searchService=searchService||new WorkspaceApprovalService(pool);
    this.stopped=false;this.scheduling=false;this.processing=null;this.controller=null;
    this.planned=new Map();
  }
  async ready(){return !!(await this.pool.query("SELECT to_regclass('workspace_search_jobs') IS NOT NULL ready")).rows[0].ready;}
  async assertReady(){if(!await this.ready())throw err('Сначала примените миграцию 040.',503,'NIGHT_SCHEMA_REQUIRED');}
  admin(user){requireUser(user);if(!canManage(user))throw err('Настройки доступны администратору организации.',403);}
  async policy(organizationId,c=this.pool){return fromDB((await c.query('SELECT * FROM workspace_night_policies WHERE organization_id=$1',[organizationId])).rows[0]);}
  async getPolicy(user){requireUser(user);await this.assertReady();const p=await this.policy(user.organization_id);return {policy:p,canManage:canManage(user),nextWindows:nextWindows(this.clock(),p),windowOpen:windowAt(this.clock(),p).open};}
  async savePolicy(user,input) {
    this.admin(user);await this.assertReady();const checked=policySchema.validate(input);
    if(checked.error||input.startTime===input.endTime)throw err('Проверьте расписание: начало и окончание должны различаться.');
    try{formatter(input.timezone);}catch{throw err('Укажите действительный часовой пояс IANA.');}
    const p=checked.value;
    await this.searchService.transaction(async c=>{
      const prior=(await c.query('SELECT revision FROM workspace_night_policies WHERE organization_id=$1 FOR UPDATE',[user.organization_id])).rows[0];
      if(Number(prior?.revision||0)!==p.expectedRevision)throw err('Расписание уже изменено. Обновите страницу.',409,'POLICY_CONFLICT');
      if(prior)await c.query(`UPDATE workspace_night_policies SET enabled=$2,timezone=$3,days=$4,start_time=$5,end_time=$6,finish_policy=$7,max_workers=$8,chunk_size=$9,revision=revision+1,updated_by=$10,updated_at=now() WHERE organization_id=$1`,[user.organization_id,p.enabled,p.timezone,p.days,p.startTime,p.endTime,p.finishPolicy,p.maxWorkers,p.chunkSize,user.id]);
      else {
        const r=await c.query(`INSERT INTO workspace_night_policies(organization_id,enabled,timezone,days,start_time,end_time,finish_policy,max_workers,chunk_size,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING revision`,[user.organization_id,p.enabled,p.timezone,p.days,p.startTime,p.endTime,p.finishPolicy,p.maxWorkers,p.chunkSize,user.id]);
        if(!r.rowCount)throw err('Расписание уже изменено. Обновите страницу.',409,'POLICY_CONFLICT');
      }
    });
    return this.getPolicy(user);
  }
  async workspaces(organizationId) {
    return (await this.pool.query(`SELECT w.id,w.owner_id,w.analysis_parameters,
      (w.analysis_parameters ? 'staffOptions') configured,
      (SELECT count(*)::int FROM dna_profiles p WHERE p.workspace_id=w.id AND p.user_id=w.owner_id AND p.organization_id=w.organization_id AND p.is_active=true) profile_count,
      EXISTS(SELECT 1 FROM workspace_search_runs r JOIN workspace_reference_versions v ON v.organization_id=w.organization_id
        WHERE r.workspace_id=w.id AND r.owner_id=w.owner_id AND r.organization_id=w.organization_id AND r.state='complete'
        AND r.algorithm_version=$2 AND r.workspace_revision=w.analysis_revision AND r.master_revision=v.master_revision AND r.staff_revision=v.staff_revision
        AND r.parameters=w.analysis_parameters AND NOT EXISTS(SELECT 1 FROM dna_profiles p
          WHERE p.workspace_id=w.id AND p.user_id=w.owner_id AND p.organization_id=w.organization_id AND p.is_active=true
          AND NOT EXISTS(SELECT 1 FROM workspace_search_profiles sp WHERE sp.search_run_id=r.id AND sp.profile_id=p.id AND sp.analysis_revision=p.analysis_revision AND sp.state<>'PENDING'))) fresh
      FROM personal_workspaces w JOIN users u ON u.id=w.owner_id AND u.organization_id=w.organization_id JOIN organizations o ON o.id=w.organization_id
      WHERE w.organization_id=$1 AND u.is_active=true AND o.is_active=true AND u.role::text=ANY($3::text[]) ORDER BY w.id`,[organizationId,ALGORITHM_VERSION,WORKSPACE_WRITE_ROLES])).rows;
  }
  async preview(user){this.admin(user);await this.assertReady();const rows=(await this.workspaces(user.organization_id)).filter(w=>w.profile_count);return {workspaces:rows.length,profiles:rows.reduce((n,w)=>n+w.profile_count,0),current:rows.filter(w=>w.fresh).length,settingsRequired:rows.filter(w=>!w.configured).length,needed:rows.filter(w=>w.configured&&!w.fresh).length};}
  async enqueue(organizationId,policy,windowKey,origin) {
    for(const w of await this.workspaces(organizationId)) {
      if(!w.profile_count||!w.configured||w.fresh)continue;
      await this.searchService.transaction(async c=>{
        const r=await c.query(`INSERT INTO workspace_search_jobs(organization_id,owner_id,workspace_id,window_key,origin,policy_revision,parameters)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[organizationId,w.owner_id,w.id,windowKey,origin,policy.revision,JSON.stringify(w.analysis_parameters)]);
        if(r.rowCount)await c.query("INSERT INTO workspace_search_job_events(job_id,state,reason) VALUES($1,'queued',$2)",[r.rows[0].id,origin]);
      });
    }
    return {queued:(await this.pool.query('SELECT count(*)::int count FROM workspace_search_jobs WHERE organization_id=$1 AND window_key=$2',[organizationId,windowKey])).rows[0].count};
  }
  async trial(user,key){this.admin(user);await this.assertReady();if(!Joi.string().guid().required().validate(key).error)return this.enqueue(user.organization_id,await this.policy(user.organization_id),'trial:'+key,'trial');throw err('Нужен UUID ключа повтора.');}
  async jobs(user,organization=false,id=null) {
    requireUser(user);await this.assertReady();if(organization)this.admin(user);
    return {canManage:canManage(user),jobs:(await this.pool.query(`SELECT j.id,j.owner_id,j.origin,j.state,j.stage,j.completed,j.total,j.attempt,j.failures,j.waiting_reason,j.error_code,j.created_at,j.updated_at,j.completed_at,j.heartbeat_at,j.next_retry_at,
      CASE WHEN j.owner_id=$2 THEN j.result_run_id END result_run_id,COALESCE(NULLIF(u.display_name,''),u.username) owner_name
      FROM workspace_search_jobs j JOIN users u ON u.id=j.owner_id AND u.organization_id=j.organization_id
      WHERE j.organization_id=$1 AND ($3::boolean OR j.owner_id=$2) AND ($4::uuid IS NULL OR j.id=$4) ORDER BY j.created_at DESC,j.id DESC LIMIT 100`,[user.organization_id,user.id,organization,id])).rows};
  }
  async control(user,id,action) {
    requireUser(user);await this.assertReady();if(!['pause','resume','cancel','retry'].includes(action))throw err('Неизвестная команда.');
    return this.searchService.transaction(async c=>{
      const j=(await c.query('SELECT * FROM workspace_search_jobs WHERE id=$1 AND organization_id=$2 AND (owner_id=$3 OR $4) FOR UPDATE',[id,user.organization_id,user.id,canManage(user)])).rows[0];
      if(!j)throw err('Задание недоступно.',404);
      let state=j.state;
      if(action==='cancel'&&activeStates.includes(state))state='cancelled';
      if(action==='pause'&&activeStates.includes(state))state='paused';
      if(action==='resume'&&['paused','paused_window'].includes(state)||action==='retry'&&['failed','cancelled'].includes(state))state='queued';
      if(state===j.state)return {id,state};
      await c.query(`UPDATE workspace_search_jobs SET state=$2,waiting_reason=$3,lease_token=NULL,lease_until=NULL,next_retry_at=now(),updated_at=now(),failures=CASE WHEN $4 THEN 0 ELSE failures END WHERE id=$1`,[id,state,action==='pause'?'USER_PAUSED':null,action==='retry']);
      await c.query('INSERT INTO workspace_search_job_events(job_id,state,reason) VALUES($1,$2,$3)',[id,state,action]);
      return {id,state};
    });
  }
  async claim() {
    return this.searchService.transaction(async c=>{
      const candidates=(await c.query(`SELECT j.* FROM workspace_search_jobs j WHERE
        (j.state IN('queued','retry_wait','paused_window') OR j.state='running' AND j.lease_until<now()) AND j.next_retry_at<=now()
        ORDER BY j.created_at,j.id LIMIT 20 FOR UPDATE SKIP LOCKED`)).rows;
      for(const j of candidates) {
        const p=await this.policy(j.organization_id,c);
        if(j.origin==='scheduled'&&(!p.enabled||!windowAt(this.clock(),p).open&&!(p.finishPolicy==='finish'&&j.attempt>0))) {
          await c.query("UPDATE workspace_search_jobs SET state='paused_window',waiting_reason='WINDOW_CLOSED',next_retry_at=now()+interval '15 seconds',updated_at=now() WHERE id=$1",[j.id]);continue;
        }
        if(j.state==='running'&&j.search_run_id)await c.query("UPDATE workspace_search_runs SET state='failed',error_code='LEASE_EXPIRED',completed_at=now() WHERE id=$1 AND origin='night' AND state='running'",[j.search_run_id]);
        const token=randomUUID();
        const r=(await c.query(`UPDATE workspace_search_jobs SET state='running',lease_token=$2,lease_until=now()+interval '40 seconds',heartbeat_at=now(),attempt=attempt+1,waiting_reason=NULL,error_code=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[j.id,token])).rows[0];
        await c.query("INSERT INTO workspace_search_job_events(job_id,state,reason) VALUES($1,'running',$2)",[j.id,j.state==='running'?'LEASE_RECOVERED':'CLAIMED']);
        return {...r,policy:p};
      }
      return null;
    });
  }
  async guard(job,c=this.pool,{lock=false,expected}={}) {
    const j=(await c.query(`SELECT j.*,u.role actor_role,w.analysis_revision current_workspace_revision,v.master_revision current_master_revision,v.staff_revision current_staff_revision
      FROM workspace_search_jobs j JOIN users u ON u.id=j.owner_id AND u.organization_id=j.organization_id
      JOIN organizations o ON o.id=j.organization_id JOIN personal_workspaces w ON w.id=j.workspace_id AND w.owner_id=j.owner_id AND w.organization_id=j.organization_id
      LEFT JOIN workspace_reference_versions v ON v.organization_id=j.organization_id
      WHERE j.id=$1 AND j.organization_id=$2 AND j.owner_id=$3 AND j.workspace_id=$4 AND j.lease_token=$5
      AND j.state='running' AND j.lease_until>now() AND u.is_active=true AND o.is_active=true AND u.role::text=ANY($6::text[])
      AND EXISTS(SELECT 1 FROM workspace_configuration WHERE id=true AND enabled=true)
      ${lock?'FOR UPDATE OF j':''}`,[job.id,job.organization_id,job.owner_id,job.workspace_id,job.lease_token,WORKSPACE_WRITE_ROLES])).rows[0];
    if(!j)throw err('Задание остановлено или права изменены.',409,'JOB_STOPPED');
    const p=await this.policy(j.organization_id,c);
    if(j.origin==='scheduled'&&(!p.enabled||p.finishPolicy==='pause'&&!windowAt(this.clock(),p).open))throw err('Окно запуска закрыто.',409,'WINDOW_CLOSED');
    if(p.revision!==job.policy.revision)throw err('Расписание изменилось.',409,'POLICY_CHANGED');
    if(expected&&(j.current_workspace_revision!==expected.workspace_revision||j.current_master_revision!==expected.master_revision||j.current_staff_revision!==expected.staff_revision))throw err('Входные данные изменились.',409,'SEARCH_STALE');
    return {id:j.owner_id,organization_id:j.organization_id,role:j.actor_role,is_active:true};
  }
  async process(job) {
    const controller=new AbortController();this.controller=controller;let expected,manifest,profileCount=0,lastProgress=0,lastStage,heartBusy=false;
    const check=c=>this.guard(job,c||this.pool,{expected});
    const heartbeat=setInterval(async()=>{
      if(heartBusy)return;heartBusy=true;
      try{await check();const r=await this.pool.query("UPDATE workspace_search_jobs SET lease_until=now()+interval '40 seconds',heartbeat_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id",[job.id,job.lease_token]);if(!r.rowCount)throw err('Аренда потеряна.',409,'JOB_STOPPED');}catch(e){controller.abort(e);}finally{heartBusy=false;}
    },1000);heartbeat.unref();
    const progress=p=>{
      const now=Date.now();if(lastStage===p.stage&&now-lastProgress<1000&&p.completed!==p.total)return;
      lastStage=p.stage;lastProgress=now;
      this.pool.query("UPDATE workspace_search_jobs SET stage=$3,completed=$4,total=$5,waiting_reason=$6,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running'",[job.id,job.lease_token,p.stage,Math.max(0,Math.floor(p.completed||0)),Math.max(0,Math.floor(p.total||0)),p.status==='queued'?'CPU_QUEUE':null]).catch(()=>controller.abort(err('БД недоступна.',503,'DATABASE_UNAVAILABLE')));
    };
    const chunks=async(stage,input,options,runner)=>{
      const total=input.referenceProfiles.length,results=[];let comparisons=0,candidateComparisons=0;
      for(let start=0,index=0;start<Math.max(1,total);start+=job.policy.chunkSize,index++) {
        await check();if(controller.signal.aborted)throw controller.signal.reason;
        const refs=input.referenceProfiles.slice(start,start+job.policy.chunkSize);
        let part=(await this.pool.query('SELECT encrypted_result FROM workspace_search_job_chunks WHERE job_id=$1 AND organization_id=$2 AND owner_id=$3 AND manifest=$4 AND stage=$5 AND chunk_index=$6',[job.id,job.organization_id,job.owner_id,manifest,stage,index])).rows[0];
        if(part)part=unseal(part.encrypted_result);
        else {
          const maxWorkers=job.policy.finishPolicy==='finish'&&!windowAt(this.clock(),job.policy).open?1:job.policy.maxWorkers;
          part=await runner({...input,referenceProfiles:refs},{...options,signal:controller.signal,priority:'background',maxWorkers,minParallelComparisons:0,
            onProgress:p=>progress({stage,status:p.status,completed:start+Math.floor(refs.length*(p.total?Math.min(1,p.completed/p.total):0)),total,unit:'objects'})});
          await this.searchService.transaction(async c=>{
            await this.guard(job,c,{lock:true,expected});
            await c.query(`INSERT INTO workspace_search_job_chunks(job_id,organization_id,owner_id,manifest,stage,chunk_index,encrypted_result) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(job_id,stage,chunk_index) DO NOTHING`,[job.id,job.organization_id,job.owner_id,manifest,stage,index,seal(part)]);
          });
        }
        results.push(...part.results);comparisons+=part.comparisons;candidateComparisons+=part.candidateComparisons||0;
        progress({stage,status:'running',completed:Math.min(start+refs.length,total),total,unit:'objects'});
      }
      return {results,comparisons,candidateComparisons,mode:'background-checkpointed',workerCount:Math.min(require('../profiles/searchWorkerExecutor').workerLimit(),job.policy.maxWorkers)};
    };
    try {
      const user=await check();
      await this.searchService.fullSearch(user,[],{},controller.signal,progress,{
        readSavedParameters:true,allProfiles:true,
        prepare:async data=>{
          expected=data.run;
          profileCount=data.profiles.length;
          manifest=hash({workspace:job.workspace_id,organization:job.organization_id,owner:job.owner_id,workspaceRevision:expected.workspace_revision,masterRevision:expected.master_revision,staffRevision:expected.staff_revision,parameters:data.parameters,algorithm:data.algorithmVersion,profiles:data.profiles,snapshot:data.snapshot,chunkSize:job.policy.chunkSize});
          await this.searchService.transaction(async c=>{
            await this.guard(job,c,{lock:true,expected});
            if(job.manifest!==manifest)await c.query('DELETE FROM workspace_search_job_chunks WHERE job_id=$1',[job.id]);
            await c.query('UPDATE workspace_search_jobs SET manifest=$3,parameters=$4 WHERE id=$1 AND lease_token=$2',[job.id,job.lease_token,manifest,JSON.stringify(data.parameters)]);
          });
        },
        created:async id=>{
          await check();await this.pool.query("UPDATE workspace_search_runs SET origin='night' WHERE id=$1",[id]);
          const r=await this.pool.query("UPDATE workspace_search_jobs SET search_run_id=$3 WHERE id=$1 AND lease_token=$2 AND state='running'",[job.id,job.lease_token,id]);if(!r.rowCount)throw err('Задание остановлено.',409,'JOB_STOPPED');
        },
        profiles:(stage,input,options)=>chunks(stage,input,options,runProfileSearch),
        staff:(input,options)=>chunks('staff',input,options,runStaffSearch),
        beforeCommit:async c=>{await this.guard(job,c,{lock:true,expected});if(controller.signal.aborted)throw controller.signal.reason;},
        complete:async(c,id)=>{
          const r=await c.query("UPDATE workspace_search_jobs SET state='complete',stage='complete',completed=$4,total=$4,result_run_id=$3,completed_at=now(),updated_at=now(),waiting_reason=NULL,lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2 AND state='running'",[job.id,job.lease_token,id,profileCount]);
          if(!r.rowCount)throw err('Аренда потеряна.',409,'JOB_STOPPED');
          await c.query('DELETE FROM workspace_search_job_chunks WHERE job_id=$1',[job.id]);
          await c.query("INSERT INTO workspace_search_job_events(job_id,state,reason) VALUES($1,'complete','ALL_STAGES_COMMITTED')",[job.id]);
        }
      });
    }catch(error) {
      const e=controller.signal.aborted?controller.signal.reason:error,code=e?.code||'SEARCH_FAILED';
      const pause=['WINDOW_CLOSED'].includes(code),yielded=['BACKGROUND_YIELD','POLICY_CHANGED','NIGHT_SHUTDOWN'].includes(code);
      const state=pause?'paused_window':yielded?'queued':code==='JOB_STOPPED'?'cancelled':job.failures+1>=3||['SETTINGS_REQUIRED','NO_PROFILES'].includes(code)?'failed':'retry_wait';
      await this.searchService.transaction(async c=>{
        const r=await c.query(`UPDATE workspace_search_jobs SET state=$3,waiting_reason=$4,error_code=$4,failures=failures+$5,next_retry_at=now()+($6*interval '1 second'),lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' RETURNING id`,[job.id,job.lease_token,state,code,pause||yielded?0:1,yielded?2:pause?15:Math.min(300,15*2**job.failures)]);
        if(r.rowCount)await c.query('INSERT INTO workspace_search_job_events(job_id,state,reason) VALUES($1,$2,$3)',[job.id,state,code]);
      });
    }finally{clearInterval(heartbeat);this.controller=null;}
  }
  async tick() {
    if(this.stopped||this.scheduling)return;this.scheduling=true;
    try {
      if(!(await this.pool.query('SELECT enabled FROM workspace_configuration WHERE id=true')).rows[0]?.enabled)return;
      await this.pool.query(`UPDATE workspace_search_jobs j SET state='cancelled',waiting_reason='ACCESS_REVOKED',lease_token=NULL,lease_until=NULL,updated_at=now()
        WHERE j.state=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.id=j.owner_id AND u.organization_id=j.organization_id AND u.is_active=true AND o.is_active=true AND u.role::text=ANY($2::text[]))`,[activeStates,WORKSPACE_WRITE_ROLES]);
      for(const row of (await this.pool.query('SELECT * FROM workspace_night_policies WHERE enabled=true')).rows) {
        const p=fromDB(row),window=windowAt(this.clock(),p);
        const key=row.organization_id+':'+window.key;
        if(window.open&&Date.now()-(this.planned.get(key)||0)>60000){await this.enqueue(row.organization_id,p,window.key,'scheduled');if(this.planned.size>1000)this.planned.clear();this.planned.set(key,Date.now());}
      }
      if(!this.processing&&!this.stopped) {
        const job=await this.claim();
        if(job)this.processing=this.process(job).catch(()=>require('../../utils/logger').logger.error('NIGHT_JOB_STORAGE_FAILED')).finally(()=>{this.processing=null;});
      }
      await this.pool.query("DELETE FROM workspace_search_cpu_requests WHERE lease_until<now()-interval '1 day'");
      await this.pool.query("DELETE FROM workspace_search_job_chunks c USING workspace_search_jobs j WHERE c.job_id=j.id AND j.state IN('failed','cancelled','complete') AND j.updated_at<now()-interval '7 days'");
    }finally{this.scheduling=false;}
  }
  async start(){if(!await this.ready())return false;this.stopped=false;this.timer=setInterval(()=>this.tick().catch(()=>require('../../utils/logger').logger.error('NIGHT_TICK_FAILED')),3000);this.timer.unref();await this.tick();return true;}
  async stop(){this.stopped=true;clearInterval(this.timer);this.controller?.abort(err('Перезапуск исполнителя.',409,'NIGHT_SHUTDOWN'));await this.processing;}
}
module.exports={NightSearchService,policySchema,canManage,DEFAULT_POLICY};
