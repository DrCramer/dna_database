const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const yieldError=()=>Object.assign(Error('Ручной поиск имеет приоритет.'),{code:'BACKGROUND_YIELD'});
class SearchCpuCoordinator {
  constructor(pool){this.pool=pool;}
  async acquire({signal,priority,onLost}) {
    const id=randomUUID(),token=randomUUID(),rank=priority==='background'?1:0;
    await this.pool.query("INSERT INTO workspace_search_cpu_requests(id,priority,lease_until) VALUES($1,$2,now()+interval '40 seconds')",[id,rank]);
    let timer,busy=false,renewed=0;
    const release=async()=>{
      clearInterval(timer);
      await this.pool.query('UPDATE workspace_search_cpu_lease SET request_id=NULL,token=NULL,lease_until=NULL WHERE request_id=$1 AND token=$2',[id,token]);
      await this.pool.query('DELETE FROM workspace_search_cpu_requests WHERE id=$1',[id]);
    };
    try {
      for(;;) {
        if(signal?.aborted)throw signal.reason;
        if(Date.now()-renewed>5000){await this.pool.query("UPDATE workspace_search_cpu_requests SET lease_until=now()+interval '40 seconds' WHERE id=$1",[id]);renewed=Date.now();}
        const c=await this.pool.connect();let acquired=false;
        try {
          await c.query('BEGIN');
          const lease=(await c.query('SELECT *,lease_until IS NULL OR lease_until<=now() available FROM workspace_search_cpu_lease WHERE id=true FOR UPDATE')).rows[0];
          if(!lease)throw Error('CPU_COORDINATOR_MISSING');
          if(lease.available) {
            const first=(await c.query('SELECT id FROM workspace_search_cpu_requests WHERE lease_until>now() ORDER BY priority,created_at,id LIMIT 1')).rows[0];
            if(first?.id===id){await c.query("UPDATE workspace_search_cpu_lease SET request_id=$1,token=$2,lease_until=now()+interval '40 seconds' WHERE id=true",[id,token]);acquired=true;}
          }
          await c.query('COMMIT');
        }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
        if(acquired)break;
        await delay(150,undefined,{signal});
      }
      timer=setInterval(async()=>{
        if(busy)return;busy=true;
        try {
          const r=await this.pool.query("UPDATE workspace_search_cpu_lease SET lease_until=now()+interval '40 seconds' WHERE request_id=$1 AND token=$2 AND lease_until>now() RETURNING id",[id,token]);
          if(!r.rowCount)throw Error('CPU_LEASE_LOST');
          await this.pool.query("UPDATE workspace_search_cpu_requests SET lease_until=now()+interval '40 seconds' WHERE id=$1",[id]);
          if(rank===1&&(await this.pool.query('SELECT 1 FROM workspace_search_cpu_requests WHERE priority=0 AND lease_until>now() LIMIT 1')).rowCount)onLost(yieldError());
        }catch(e){onLost(e);}finally{busy=false;}
      },1000);timer.unref();
      return release;
    }catch(e){await release();throw signal?.aborted?signal.reason:e;}
  }
}
module.exports={SearchCpuCoordinator,yieldError};
