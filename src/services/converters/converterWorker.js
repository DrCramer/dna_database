const {parentPort}=require('node:worker_threads');
const {GeneticExcelConverterService,ConversionError}=require('./geneticExcelConverterService');
const {executeConverterJob}=require('./converterJob');
const converter=new GeneticExcelConverterService();
parentPort.on('message',async({id,input})=>{
  try{
    const result=await executeConverterJob({...input,files:input.files.map(file=>({...file,buffer:Buffer.from(file.buffer.buffer,file.buffer.byteOffset,file.buffer.byteLength)}))},converter);
    // Exact-sized buffers prevent transferring unrelated bytes from a Buffer pool.
    const bytes=result.bytes.byteOffset===0&&result.bytes.byteLength===result.bytes.buffer.byteLength?result.bytes:new Uint8Array(result.bytes);parentPort.postMessage({id,...result,bytes:bytes.buffer},[bytes.buffer]);
  }catch(e){parentPort.postMessage({id,error:{expected:e instanceof ConversionError,message:e instanceof ConversionError?e.message:undefined,code:e.code,status:e.status,name:e.name,locations:String(e.stack||'').split('\n').slice(1).flatMap(s=>s.match(/(?:src|node_modules)\/[A-Za-z0-9_./-]+:\d+:\d+/g)||[]).slice(0,5)}});}
});
