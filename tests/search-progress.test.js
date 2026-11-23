const test = require('node:test'), assert = require('node:assert/strict');
const { runProfileSearch, createRangeProgress } = require('../src/services/profiles/searchWorkerExecutor');
const { runStaffSearch } = require('../src/services/contamination/staffSearchWorkerExecutor');
const { syntheticProfiles } = require('../scripts/benchmark-task-search');
const { readSearchStream } = require('../src/utils/searchProgressProtocol');

test('Worker telemetry reports completed ranges, not a premature final result; calculations stay identical', async () => {
  const profiles = syntheticProfiles(105);
  for (const one of [false,true]) {
    const input = { referenceProfiles: one ? [profiles[0]] : profiles, compareProfiles: profiles, minMatches: 15 };
    const expected = await runProfileSearch(input, { useWorkers:false });
    const events=[];
    const actual = await runProfileSearch(input, { minParallelComparisons:0, onProgress:p=>events.push(p) });
    assert.deepEqual(actual.results,expected.results);
    assert.equal(actual.comparisons,expected.comparisons);
    assert.equal(events[0].status,'queued');
    assert.equal(events.at(-1).completed,one?105:105);
    assert.equal(events.at(-1).unit,one?'candidates':'objects');
    assert(events.every((e,i)=>e.completed>=0&&e.completed<=e.total&&(!i||e.completed>=events[i-1].completed)));
    assert(events.every(e=>!Object.keys(e).some(k=>/id|profile|allele/i.test(k))));
  }
  const input={referenceProfiles:profiles.slice(0,6),staffProfiles:profiles.slice(0,30)};
  const events=[], expected=await runStaffSearch(input,{useWorkers:false});
  const actual=await runStaffSearch(input,{minParallelComparisons:0,onProgress:p=>events.push(p)});
  assert.deepEqual(actual.results,expected.results);
  assert.equal(events.at(-1).completed,6);
});

test('Unequal range sizes sum to actual objects and never move backwards', () => {
  const events=[],report=createRangeProgress({axis:'references',count:3,length:8},p=>events.push(p));
  report({status:'queued'});report({index:2,completed:1,total:3,status:'running'});
  assert.equal(events.at(-1).completed,1);
  report({index:2,completed:0,total:3,status:'running'});
  assert.equal(events.at(-1).completed,1);
  for(let i=0;i<3;i++)report({index:i,completed:1,total:1,status:'running'});
  assert.equal(events.at(-1).completed,8);
});

function response(frames, chunkSize=7) {
  const bytes=new TextEncoder().encode(frames),parts=[];
  for(let i=0;i<bytes.length;i+=chunkSize)parts.push(bytes.slice(i,i+chunkSize));
  return new Response(new ReadableStream({pull(c){const p=parts.shift();if(p)c.enqueue(p);else c.close();}}),{headers:{'Content-Type':'application/x-ndjson'}});
}
test('Client protocol decodes split UTF-8 frames and waits for a complete result', async () => {
  const progress=[], frames=[{type:'progress',progress:{stage:'staff',completed:3,total:8}}, {type:'heartbeat'}, {type:'result',result:{id:'SYN',title:'Синтетический результат'}}];
  const result=await readSearchStream(response(frames.map(f=>JSON.stringify(f)+'\n').join(''),1),p=>progress.push(p));
  assert.equal(result.title,'Синтетический результат');assert.equal(progress.length,1);
});
test('Error, truncated or duplicate terminal frames never become successful UI results', async () => {
  await assert.rejects(readSearchStream(response('{"type":"error","message":"SYN: повторите поиск"}\n')),/SYN: повторите/);
  await assert.rejects(readSearchStream(response('{"type":"progress","progress":{"stage":"staff"}}\n')),/Соединение прервалось/);
  await assert.rejects(readSearchStream(response('{"type":"result","result":')),/некорректный ответ/);
  const result=JSON.stringify({type:'result',result:{id:'SYN'}})+'\n';
  await assert.rejects(readSearchStream(response(result+result)),/порядок ответа/);
  await assert.rejects(readSearchStream(new Response('{"message":"Нет права поиска"}',{status:403})),/Нет права поиска/);
});
