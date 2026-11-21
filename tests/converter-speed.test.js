const test=require('node:test'),assert=require('node:assert/strict'),X=require('xlsx');
const {GeneticExcelConverterService}=require('../src/services/converters/geneticExcelConverterService');
const {ConverterWorkerExecutor}=require('../src/services/converters/converterWorkerExecutor');
const {executeConverterJob}=require('../src/services/converters/converterJob');
const {ConverterUploadCache}=require('../src/services/converters/converterUploadCache');
const {unpackConverterPreview,packConverterPreview}=require('../src/utils/converterPreviewTransport');
const {updateConverterYear}=require('../src/utils/converterYearMetadata');
const {applyConverterObjectPreview}=require('../src/utils/converterObjectPreview');
function fixture(){const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.json_to_sheet([
  {'Sample Name':'SYN-1',TH01:'9.3',TPOX:'8,8',D21S11:'30,*'},
  {'Sample Name':'SYN-1',TH01:'7,9.3',TPOX:'8,8',D21S11:'30,*'},
  {'Sample Name':'SYN-2',TH01:'7,9.3',TPOX:'8,8',D21S11:'30,*'}]),'Data');
  X.utils.book_append_sheet(b,X.utils.json_to_sheet([{'Sample Name':'SYN-other',TH01:'7,9.3',TPOX:'8,8',D21S11:'30,31'}]),'Other');return {originalname:'SYN.xlsx',buffer:X.write(b,{type:'buffer',bookType:'xlsx'})};}

test('Year metadata exactly matches reconversion, including conflicts, decisions and special alleles',()=>{
  const c=new GeneticExcelConverterService(),files=[fixture()];const fileId=c.convert(files).files[0].id;
  let options={files:{[fileId]:{sheetName:'Data'}}},result=c.convert(files,options);
  const conflict=result.conflicts[0];assert(conflict);
  options={...options,conflicts:{[conflict.id]:{sourceId:conflict.variants[0].id}}};result=c.convert(files,options);
  const strData=result.profiles.map(p=>p.strData);
  for(const year of [2026,2027,null]){
    const next=updateConverterYear(result,options,fileId,year);assert(next);
    assert.deepEqual(next.result,c.convert(files,next.options));
    assert.deepEqual(next.result.profiles.map(p=>p.strData),strData);
    assert.equal(next.result.profiles[0].strData,strData[0]);
    result=next.result;options=next.options;
  }
  assert.equal(updateConverterYear({...result,files:[...result.files,...result.files]},options,fileId,2026),null);
  assert.equal(updateConverterYear(result,options,fileId,2101),null);
});

test('Parsed workbook is reused across sheet and year selection; wire formats retain all diagnostics',()=>{
  const c=new GeneticExcelConverterService(),f=fixture();
  const a=c.readSource(f.buffer,{},f.originalname),b=c.readSource(f.buffer,{sheetName:'Other',year:2026},f.originalname);
  assert.equal(a.workbook,b.workbook);assert.equal(c.workbookCache.size,1);
  const id=c.convert([f]).files[0].id,preview=c.convert([f],{files:{[id]:{sheetName:'Data'}}});
  for(const format of ['compact-v1','compact-v2','compact-v3'])assert.deepEqual(unpackConverterPreview(packConverterPreview(preview,format)),preview);
  const sheet=a.workbook.Sheets.Data;
  assert.equal(c.readSheetRows(sheet,true),c.readSheetRows(sheet,true));
});

test('Converter upload cache isolates scopes and evicts old and expired files', async t => {
  const cache = new ConverterUploadCache({ maxBytes: 6, maxEntries: 3 });
  t.after(() => { for (const id of cache.entries.keys()) cache.remove(id); });
  const files = text => [{originalname: 'SYN.xlsx', buffer: Buffer.from(text)}];
  const firstFiles = files('aaa');
  const first = cache.put('user-1:org-1', firstFiles);
  const second = cache.put('user-2:org-1', files('bbb'));
  assert.equal(cache.get(first, 'user-2:org-1'), null);
  assert.equal(cache.get(first, 'user-1:org-2'), null);
  assert.equal(cache.get(first, 'user-1:org-1'), firstFiles);
  const third = cache.put('user-1:org-1', files('ccc'));
  assert(third);
  assert.equal(cache.get(second, 'user-2:org-1'), null);
  assert.equal(cache.put('user-1:org-1', files('too large')), null);
  const shortLived = new ConverterUploadCache({ ttlMs: 30 });
  const expiring = shortLived.put('user-1:org-1', firstFiles);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(shortLived.get(expiring, 'user-1:org-1'), null);
  assert.equal(shortLived.bytes, 0);
});

test('Excel preview summarizes placeholders without losing edits, merge evidence or real errors', () => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([
    ['Объект', 'Год', 'TH01', 'D8S1179', 'FGA'],
    ['SYN-1', 2026, '—', 'YF', '−'],
    ['SYN-1', 2026, '7,9.3', '—', '−'],
    ['SYN-2', 2026, '—', '—', '—']
  ]), 'Data');
  const input = { originalname:'SYN.xlsx', buffer:X.write(book,{type:'buffer',bookType:'xlsx'}) };
  const converter = new GeneticExcelConverterService(), options = { allowEmptyExcelProfiles:true };
  const full = converter.convert([input],options);
  const fga = full.issues.find(issue => issue.code === 'MISSING_VALUE' && issue.objectNumber === 'SYN-2' && issue.locus === 'FGA');
  const edit = { ...options, cells:{[fga.id]:{action:'manual',value:'21,24'}} };
  const edited = converter.convert([input],edit);
  const compact = converter.convert([input],{...edit,summarizeMissingCells:true});
  assert.deepEqual(compact.profiles.map(profile => profile.strData),edited.profiles.map(profile => profile.strData));
  assert.deepEqual(compact.summary,edited.summary);
  assert.equal(compact.canImport,false);
  assert(!compact.issues.some(issue => issue.code === 'MISSING_VALUE' && !issue.userDecision));
  assert(compact.issues.some(issue => issue.hard && issue.locus === 'D8S1179' && issue.sourceCell === 'D2'));
  assert(compact.issues.some(issue => issue.id === fga.id && issue.userDecision?.value === '21,24'));
  assert(compact.issues.some(issue => issue.code === 'MERGE' && issue.variants.some(variant => variant.rawValue === '—')));
});

test('Single-object preview recalculates all sources of the chosen year and leaves unrelated errors in place', async () => {
  const excel = (name, data) => {
    const book = X.utils.book_new();
    X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([
      ['Объект', 'Год', 'TH01', 'D8S1179', 'FGA'], ...data
    ]), 'Data');
    return { originalname:name, buffer:X.write(book,{type:'buffer',bookType:'xlsx'}) };
  };
  const files = [
    excel('first.xlsx',[
      ['SYN-1',2026,'11.12','12,13','21,24'],
      ['SYN-1',2025,'7,9.3','12,13','21,24'],
      ['SYN-OTHER',2026,'7,9.3','YF','21,24']
    ]),
    excel('repeat.xlsx', [['SYN-1',2026,'11,12','12,13','21,24']])
  ];
  const converter = new GeneticExcelConverterService(), options = { allowEmptyExcelProfiles:true };
  const preview = async settings => {
    const result = await executeConverterJob({files,options:settings,operation:'preview'},converter);
    return JSON.parse(Buffer.from(result.bytes).toString('utf8'));
  };
  const initial = await preview(options);
  const issue = initial.issues.find(item=>item.ruleCode==='AMBIGUOUS_DOT');
  const edited = { ...options, cells:{[issue.id]:{action:'split_dot'}} };
  const normalized = converter.normalize.bind(converter);
  let processedCells = 0;
  converter.normalize = (...args) => { processedCells++; return normalized(...args); };
  const response = await executeConverterJob({files,options:{...edited,objectPreviewKey:issue.profileKey},operation:'preview-object'},converter);
  const { objectPreview: patch } = JSON.parse(Buffer.from(response.bytes));
  assert.equal(processedCells,7);
  assert.equal(patch.profile.sources.length,2);
  assert.deepEqual(patch.profile.strData.TH01,['11','12']);
  const updated = applyConverterObjectPreview(initial,patch);
  const full = await preview(edited);
  const sorted = items => [...items].sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual({...updated,issues:sorted(updated.issues),conflicts:sorted(updated.conflicts)},{...full,issues:sorted(full.issues),conflicts:sorted(full.conflicts)});
  assert.equal(updated.canImport,false);
  assert.equal(updated.legacyCanUpload,false);
  assert.equal(updated.profiles[1],initial.profiles[1]);
  assert(updated.issues.some(item=>item.objectNumber==='SYN-OTHER'&&item.hard));
});

test('Worker reuses parsed data, yields the event loop, cancels and recovers without occurrence checks',async t=>{
  const pool=new ConverterWorkerExecutor({idleMs:1000});t.after(()=>pool.close());
  const f=fixture(),input={files:[f],options:{previewFormat:'compact-v2',lazyFiles:true},panels:[],operation:'preview'};
  const first=await pool.run(input),identity=pool.worker,initial=unpackConverterPreview(JSON.parse(first.bytes));
  const fileId=initial.files[0].id;
  input.options.files={[fileId]:{sheetName:'Other',year:2026}};input.options.reference={enabled:true};
  let tick=false;setImmediate(()=>{tick=true;});
  const response=await pool.run(input);assert(tick);assert.equal(pool.worker,identity);
  const data=unpackConverterPreview(JSON.parse(response.bytes));assert.equal(data.profiles.length,1);
  assert(!data.issues.some(i=>/REFERENCE|FREQUENCY/.test(i.code)));
  assert(!data.profiles.some(p=>p.audit.some(i=>i.reference)));
  const expected=data.profiles[0].strData.TH01;
  const exported=await pool.run({...input,operation:'export'});
  const book=X.read(exported.bytes,{type:'buffer'});assert.deepEqual(book.SheetNames,['Импорт']);
  const rows=X.utils.sheet_to_json(book.Sheets['Импорт']);assert.equal(rows[0].TH01,expected.join(','));
  const controller=new AbortController();
  const pending=pool.run(input,controller.signal);controller.abort(Error('SYN cancellation'));
  await assert.rejects(pending,/SYN cancellation/);
  const active=new AbortController();
  const running=pool.run(input,active.signal);setImmediate(()=>active.abort(Error('SYN active cancellation')));
  await assert.rejects(running,/SYN active cancellation/);
  assert.equal((await pool.run(input)).mime,'application/json');
});

test('GeneMapper preview is lazy; separate export retains the chosen year and genotype',async()=>{
  const f={originalname:'SYN.txt',buffer:Buffer.from('Sample Name\tMarker\tAllele 1\tAllele 2\nSYN-1\tTH01\t7\t9.3\nSYN-1\tTPOX\t8\t8\nSYN-1\tD21S11\t30\t31\n')};
  const input={files:[f],options:{previewFormat:'compact-v2',lazyFiles:true},panels:[],operation:'preview'};
  const initial=unpackConverterPreview(JSON.parse(Buffer.from((await executeConverterJob(input)).bytes)));
  assert(initial.files[0].geneMapper);const fileId=initial.files[0].id;
  assert(initial.preparedFiles[0].ready);assert(!initial.preparedFiles[0].base64);
  const local=updateConverterYear(initial,input.options,fileId,2026);assert(local);
  const updated=unpackConverterPreview(JSON.parse(Buffer.from((await executeConverterJob({...input,options:{...local.options,previewFormat:'compact-v2',lazyFiles:true}})).bytes)));
  assert.deepEqual(local.result,updated);
  const output=await executeConverterJob({...input,operation:'export',options:{...local.options,export:{fileId}}});
  const workbook=X.read(output.bytes,{type:'buffer'}),rows=X.utils.sheet_to_json(workbook.Sheets['Импорт']);
  assert.equal(rows[0].TH01,'7,9.3');assert(Object.values(rows[0]).map(String).includes('2026'));
});

test('Memory refusal releases the shared CPU budget and a later conversion succeeds',async t=>{
  const pool=new ConverterWorkerExecutor();t.after(()=>pool.close());
  const memory=require('../src/services/infrastructure/memoryBudget'),allowed=memory.backgroundAllowed;
  const input={files:[fixture()],options:{lazyFiles:true,previewFormat:'compact-v2'},panels:[],operation:'preview'};
  try{memory.backgroundAllowed=()=>false;await assert.rejects(pool.run(input),e=>e.code==='CONVERTER_MEMORY_BUSY'&&e.status===429);assert.equal(pool.worker,null);}
  finally{memory.backgroundAllowed=allowed;}
  assert.equal((await pool.run(input)).mime,'application/json');
});

test('Converter preempts a background calculation and allows the night queue to resume',async t=>{
  const pool=new ConverterWorkerExecutor();t.after(()=>pool.close());
  const {executeWorkerRanges}=require('../src/services/profiles/searchWorkerExecutor');
  const workerPath=require('node:path').join(__dirname,'fixtures/night-priority-worker.js');
  let start;const started=new Promise(resolve=>{start=resolve;});
  const background=executeWorkerRanges({workerPath,count:1,priority:'background',createInput:()=>({delay:30000}),onProgress:p=>{if(p.status==='running')start();}});
  const yielded=assert.rejects(background,error=>error.code==='BACKGROUND_YIELD');await started;
  assert.equal((await pool.run({files:[fixture()],options:{lazyFiles:true,previewFormat:'compact-v2'},panels:[],operation:'preview'})).mime,'application/json');
  await yielded;
  assert.equal((await executeWorkerRanges({workerPath,count:1,priority:'background',createInput:()=>({delay:1})}))[0].done,true);
});
