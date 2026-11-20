const {Worker}=require('node:worker_threads'),path=require('node:path');
const {withSearchBudget}=require('../profiles/searchWorkerExecutor');
const {ConversionError}=require('./geneticExcelConverterService');
class ConverterWorkerExecutor {
  constructor({idleMs=60000}={}){this.idleMs=idleMs;this.sequence=0;this.worker=null;}
  async run(input,signal){
    return withSearchBudget({signal,priority:'manual'},active=>{
      if(!require('../infrastructure/memoryBudget').backgroundAllowed())throw new ConversionError('Недостаточно свободной памяти. Повторите после завершения других операций.','CONVERTER_MEMORY_BUSY',429);
      return this.dispatch(input,active);
    });
  }
  dispatch(input,signal){
    clearTimeout(this.timer);
    if(!this.worker){const w=new Worker(path.join(__dirname,'converterWorker.js'),{env:{NODE_ENV:process.env.NODE_ENV||'production',LOG_LEVEL:'warn'},resourceLimits:{maxOldGenerationSizeMb:640}});this.worker=w;w.on('error',()=>{if(this.worker===w)this.worker=null;});w.on('exit',()=>{if(this.worker===w)this.worker=null;});w.unref();}
    const worker=this.worker,id=++this.sequence;worker.ref();
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;cleanup();if(this.worker===worker){worker.unref();this.timer=setTimeout(()=>this.close(),this.idleMs);this.timer.unref();}error?reject(error):resolve(value);};
      const message=result=>{if(result.id!==id)return;if(result.error){const e=result.error;const error=e.expected?new ConversionError(e.message,e.code,e.status):Object.assign(Error('Ошибка обработки файла.'),{name:e.name,locations:e.locations});finish(error);}else finish(null,{...result,bytes:Buffer.from(result.bytes)});};
      const error=e=>finish(e.code==='ERR_WORKER_OUT_OF_MEMORY'?new ConversionError('Превышен лимит памяти конвертера. Обработайте меньше объектов за один раз.','CONVERTER_MEMORY_LIMIT',413):e);
      const exit=code=>finish(signal.aborted?signal.reason:Error(`Converter worker exited (${code})`));
      const abort=()=>{if(this.worker===worker)this.worker=null;cleanup();worker.terminate().then(()=>finish(signal.reason||Error('Операция отменена.')),finish);};
      const cleanup=()=>{worker.off('message',message);worker.off('error',error);worker.off('exit',exit);signal.removeEventListener('abort',abort);};
      worker.on('message',message);worker.once('error',error);worker.once('exit',exit);signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();else try{worker.postMessage({id,input});}catch(e){finish(e);}
    });
  }
  async close(){clearTimeout(this.timer);const worker=this.worker;this.worker=null;if(worker)await worker.terminate();}
}
const converterWorker=new ConverterWorkerExecutor();
module.exports={ConverterWorkerExecutor,converterWorker};
