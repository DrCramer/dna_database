const { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: delay } = require('node:timers/promises');
class MaintenanceGate {
  constructor() { this.context = new AsyncLocalStorage(); this.closed = false; this.epoch = 0; this.requests = 0; this.queries = 0; }
  error() { return Object.assign(Error('Идёт обслуживание базы данных. Повторите операцию после его завершения.'), {status:503,code:'DATABASE_MAINTENANCE'}); }
  middleware(req,res,next) {
    if (req.path.startsWith('/admin/database-maintenance')) return this.allow(next);
    if (this.closed) return res.status(503).set('Retry-After','5').json({code:'DATABASE_MAINTENANCE',message:this.error().message});
    this.requests++; let finished=false;
    const release=()=>{if(!finished){finished=true;this.requests--;}};
    res.once('finish',release);res.once('close',release);
    this.context.run({epoch:this.epoch},next);
  }
  allow(fn) { return this.context.run({bypass:true},fn); }
  normal(fn) { return this.context.run({epoch:this.epoch},fn); }
  close() { if(this.closed)throw this.error();this.closed=true;this.epoch++; }
  open() { this.closed=false; }
  async drain(timeout=60000) {const until=Date.now()+timeout;while(this.requests||this.queries){if(Date.now()>until)throw Object.assign(Error('Текущие операции ещё не завершены. Очистка не выполнена. Повторите позже.'),{status:409});await delay(50);}}
  attach(pool) {
    const gate=this;
    pool.on('connect',client=>{
      const original=client.query;
      client.query=function(...args){
        const context=gate.context.getStore(),sql=String(args[0]?.text||args[0]);
        const rollback=/^\s*ROLLBACK\s*;?\s*$/i.test(sql);
        if(!rollback&&!context?.bypass&&(gate.closed||context?.epoch!=null&&context.epoch!==gate.epoch)) {
          const error=gate.error(),callback=args[args.length-1];
          if(typeof callback==='function'){queueMicrotask(()=>callback(error));return;}
          return Promise.reject(error);
        }
        gate.queries++;let done=false;const finish=()=>{if(!done){done=true;gate.queries--;}};
        const last=args.length-1;
        if(typeof args[last]==='function'){const callback=args[last];args[last]=(...values)=>{finish();callback(...values);};}
        try {const result=original.apply(this,args);if(result?.then)return result.finally(finish);return result;}
        catch(error){finish();throw error;}
      };
    });
  }
}
const maintenanceGate=new MaintenanceGate();
module.exports={MaintenanceGate,maintenanceGate};
