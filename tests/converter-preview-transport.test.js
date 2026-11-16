const test=require('node:test'),assert=require('node:assert/strict'),X=require('xlsx');
const {packConverterPreview,unpackConverterPreview}=require('../src/utils/converterPreviewTransport');
const {AlleleReferenceService}=require('../src/services/profiles/alleleReferenceService');
const {GeneticExcelConverterService}=require('../src/services/converters/geneticExcelConverterService');
const clone=value=>JSON.parse(JSON.stringify(value));
test('Compact preview preserves audits, conflicts, evidence, decisions and genotypes exactly',()=>{
  const service=new AlleleReferenceService({sets:[{id:'SYN',type:'OBSERVED_REFERENCE',values:[{locus:'TH01',allele:'7'},{locus:'TH01',allele:'9.3'}]}]});
  const core=service.evaluate('7,9.3','TH01',null),cell={id:'SYN:cell',locus:'TH01',rawValue:'7,9.3',reference:{...core,decision:null,appliedValue:'7,9.3'},events:[],hard:false};
  const other={...cell,id:'SYN:other',rawValue:'30,*',alleles:['30','*','?']};
  const conflict={id:'SYN:conflict',variants:[cell,other],hard:true,reason:'SYN conflict'};
  const input={files:[],profiles:[{id:'SYN-profile',strData:{TH01:['7','9.3'],D21S11:['30','*','?'],DYS391:['10']},audit:[cell,other,conflict]}],issues:[{...cell},conflict],conflicts:[conflict]};
  assert.deepEqual(unpackConverterPreview(clone(packConverterPreview(input))),clone(input));
  const changed={...cell,hard:true,reason:'SYN different audit representation'};
  const distinct={...input,profiles:[{audit:[cell,changed]}]};
  assert.deepEqual(unpackConverterPreview(clone(packConverterPreview(distinct))),clone(distinct));
  assert.equal(unpackConverterPreview(input),input,'Unversioned API responses remain compatible');
});
test('Reference evaluation cache is request-local, bounded and respects explicit reference selection',()=>{
  const first=new AlleleReferenceService(),other=new AlleleReferenceService();
  assert.equal(first.evaluate('7,9.3','TH01',null),first.evaluate('7,9.3','TH01',null));
  assert.notEqual(first.evaluate('7,9.3','TH01',null),other.evaluate('7,9.3','TH01',null));
  assert.throws(()=>first.evaluate('7,9.3','TH01',null,''));
  assert.throws(()=>first.evaluate('7,9.3','TH01',null,null));
  for(let i=0;i<4100;i++)first.evaluate(String(i),'TH01',null);
  assert(first.evaluationCache.size<=4096);
});
test('Large multi-sheet previews avoid duplicated evidence without losing a single issue',()=>{
  const loci=['TH01','TPOX','D21S11','D3S1358','vWA','FGA','D13S317','D7S820','D16S539','CSF1PO','D8S1179','D18S51'];
  const book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.json_to_sheet(Array.from({length:1000},(_,i)=>({'Sample Name':'SYN-'+i,...Object.fromEntries(loci.map(l=>[l,'12 / 13']))}))),'SYN-Data');X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['SYN notes']]),'SYN-Notes');
  const source={originalname:'SYN.xlsx',buffer:X.write(book,{type:'buffer',bookType:'xlsx'})},converter=new GeneticExcelConverterService(),initial=converter.convert([source]);
  const result=converter.convert([source],{files:{[initial.files[0].id]:{sheetName:'SYN-Data'}}},[],new AlleleReferenceService());
  const packed=packConverterPreview(result),full=JSON.stringify(result),small=JSON.stringify(packed);
  assert.equal(result.profiles.length,1000);assert(result.issues.length>=12000);
  assert(Buffer.byteLength(small)<Buffer.byteLength(full)/2);
  assert.deepEqual(unpackConverterPreview(JSON.parse(small)),JSON.parse(full));
});
