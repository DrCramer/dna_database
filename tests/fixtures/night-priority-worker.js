const {parentPort,workerData}=require('node:worker_threads');
setTimeout(()=>parentPort.postMessage({done:true}),workerData.delay);
