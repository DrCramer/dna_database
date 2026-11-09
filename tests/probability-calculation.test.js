const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, workbookLocus, ROLES, frequency, probabilityText, probabilityDisplay } = require('../src/services/probability/ProbabilityCalculationService');
const golden = require('./fixtures/probability-excel-golden.json');
const extendedGolden = require('./fixtures/probability-ident-extended-golden.json');
const { previewTxt } = require('../src/services/probability/ProbabilitySources');
const { reportData, exportXlsx } = require('../src/services/probability/probabilityReport');
const ExcelJS = require('exceljs');
const { calculationLoci, isProbabilityLocus } = require('../src/utils/probabilityLoci');
const reference = require('../src/services/probability/data/workbook-reference.json');
function input(fixture) {
  return { mode: fixture.mode, participants: ROLES[fixture.mode].map((role,index) => ({ role, sourceType:'manual', displayName:role,
    loci: Object.fromEntries(Object.entries(fixture.loci).map(([locus,genotypes]) => [locus,genotypes[index]])) })) };
}
function close(actual, expected) {
  // The recalculated XLSX stores 15 significant decimal digits. Verify 13
  // significant digits (including accumulation), tighter than printed CLR .000E.
  assert.ok(Math.abs(actual-expected) <= Math.abs(expected)*5e-13, `${actual} != ${expected}`);
}
test('Probability display never rounds finite model probabilities to absolute 0%, 100% or fraction 1',()=>{
  const nearOne=1-Number.EPSILON/2;
  for(const mode of ['IDENT','TRIO']){
    for(const p of [nearOne,1])assert.match(probabilityText(p,mode),/^>99[.,]9999999999999%$/);
    for(const p of [0,1e-18])assert.match(probabilityText(p,mode),/^<0[.,]0+1%$/);
    assert.match(probabilityText(1e-15,mode),/^0[.,]0000000000001(?:0+)?%$/);
  }
  for(const p of [0.99999999999996,nearOne,1]){
    const display=probabilityDisplay({probability:p,complement:1e-18},'TRIO');
    assert.equal(display.probabilityFractionText,'>0,9999999999999');
    assert.equal(display.complementText,'<0,00000000000001%');
  }
  const low=probabilityDisplay({probability:1e-18,complement:nearOne},'TRIO');
  assert.equal(low.probabilityFractionText,'<0,0000000000001');
  assert.equal(low.complementText,'>99,9999999999999%');
  assert.equal(probabilityText(0.5,'IDENT'),'50%');
  assert.deepEqual(probabilityDisplay({probability:0.5,complement:0.5},'TRIO'),{
    probabilityText:'50.0000000000000%',probabilityFractionText:'0.5000000000000',complementText:'50.00000000000000%'
  });
});
test('Probability boundaries agree across full calculations, saved report presentation and XLSX without changing snapshots',async()=>{
  for(const [mode,mutation]of [['IDENT',false],['TRIO',false],['TRIO',true]]){
    const calculation=calculate({mode,participants:ROLES[mode].map(role=>({role,displayName:'Synthetic '+role,
      loci:Object.fromEntries(calculationLoci[mode].map(locus=>{
        const alleles=Object.entries(reference.frequencies[locus]).sort((a,b)=>a[1]-b[1]);
        const allele=alleles[mutation&&role==='father'?1:0][0];return[locus,[allele,allele]];
      }))
    }))});
    assert.equal(calculation.status,'calculated');
    assert.match(calculation.summary.probabilityText,mutation?/^</:/^>/);
    assert.match(calculation.summary.complementText,mutation?/^>/:/^</);
    // Simulate bad display strings in an older stored snapshot. Its numbers,
    // loci and formula version must remain unchanged when it is displayed.
    calculation.summary.probabilityText=mutation?'0%':'100%';
    calculation.summary.probabilityFractionText=mutation?'0':'1';
    calculation.summary.complementText=mutation?'100%':'0%';
    const before=JSON.stringify(calculation),expected=probabilityDisplay(calculation.summary,mode),report=reportData(calculation);
    assert.deepEqual(report.summaryRows.find(r=>r.key==='probability').values,[expected.probabilityFractionText,expected.probabilityText]);
    assert.deepEqual(report.summaryRows.find(r=>r.key==='complement').values,[expected.complementText]);
    const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(calculation));
    const sheet=book.getWorksheet(mode==='TRIO'?'R_TRIO':'R_ident'),text=[];
    sheet.eachRow(row=>row.eachCell(cell=>text.push(cell.value)));
    for(const value of Object.values(expected))assert.ok(text.includes(value),value);
    let probabilityRow;book.getWorksheet('Числовые данные').eachRow(row=>{if(row.getCell(1).value==='Вероятность')probabilityRow=row;});
    assert.equal(probabilityRow.getCell(2).value,expected.probabilityFractionText);
    assert.equal(JSON.stringify(calculation),before);
  }
});
for (const fixture of golden.cases.filter(c => (c.mode==='IDENT'||c.model==='formula-sheet-mu')&&!/absent-mother|incompatible-mother/.test(c.id))) {
  test('Probability recalculated workbook: '+fixture.id, () => {
    const result=calculate(input(fixture));
    assert.equal(result.status,'calculated'); close(result.summary.index,fixture.summary.index);
    close(result.summary.reciprocal,fixture.summary.reciprocal); assert.equal(result.summary.lociCount,fixture.summary.count);
    if(fixture.mode==='TRIO'){close(result.summary.probability,fixture.summary.probability);assert.equal(result.summary.mismatches,fixture.summary.mismatches);}
    assert.equal(result.validation.microsoftExcel,false);
    assert.equal(result.summary.indexText,fixture.report.G8.text);
    assert.equal(result.summary.reciprocalText,fixture.report.G9.text);
    for(const row of result.rows)close(row.value,fixture.locusResults[row.locus].value);
  });
}
test('TRIO original vs requested numerator: expected difference is explicit, not silently called Excel parity',()=>{
  const c=golden.cases.find(c=>c.id==='trio-obligate');
  const i=input(c), genotypes=i.participants.map(p=>p.loci.D1S1656.map(String));
  close(workbookLocus('TRIO',genotypes,'D1S1656').value,c.summary.index);
  close(calculate(i).summary.index,c.summary.index*0.999);
});
test('AMEL and all non-autosomal/unsupported markers never change counts, LR or PP',()=>{
  const base=input(golden.cases.find(c=>c.id==='trio-homo')), expected=calculate(base).summary;
  for(const p of base.participants)Object.assign(p.loci,{AMEL:['X','Y'],SRY:['SRY'],DYS391:['10'],DXS6795:['12'],Yindel:['2'],Unknown:['12']});
  const result=calculate({...base,includedLoci:['D1S1656','AMEL','SRY','DYS391','DXS6795','Yindel','Unknown']});
  assert.deepEqual(result.summary,expected);
  for(const row of result.rows.filter(r=>r.locus!=='D1S1656')){assert.equal(row.selectable,false);assert.equal(row.enabled,false);}
});
test('Workbook locus allowlists include OTHER autosomal markers and exclude sex/SNP markers without calculation frequencies',()=>{
  assert.deepEqual(calculationLoci.IDENT,reference.identLoci.filter(l=>reference.frequencies[l]));
  assert.deepEqual(calculationLoci.TRIO,reference.trioLoci.filter(l=>reference.frequencies[l]));
  for(const mode of ['IDENT','TRIO'])for(const locus of ['AMEL','DYS391','SRY','DXS6795','Yindel','Rs771783753','Rs2032678'])assert.equal(isProbabilityLocus(locus,mode),false,locus);
  for(const locus of ['SE33','LPL','F13A01','F13B','FESFPS']){
    const alleles=Object.keys(reference.frequencies[locus]).slice(0,2),p=frequency(locus,alleles[0]).value,q=frequency(locus,alleles[1]).value;
    const ident=calculate({mode:'IDENT',participants:[{role:'object',loci:{[locus]:alleles}}]});
    assert.equal(ident.status,'calculated',locus);close(ident.summary.index,1/(2*p*q));
    const trio=calculate({mode:'TRIO',participants:ROLES.TRIO.map(role=>({role,loci:{[locus]:alleles}}))});
    assert.equal(trio.status,'calculated',locus);close(trio.summary.index,0.999/((2*p-p*p)+(2*q-q*q)-2*p*q));
    const source=previewTxt([{originalname:'synthetic.txt',buffer:Buffer.from('Sample Name\tMarker\tAllele 1\tAllele 2\nSYN\t'+locus+'\t'+alleles[0]+'\t\n')}])[0].samples[0];
    assert.deepEqual(source.loci[locus],[alleles[0],alleles[0]]);assert.equal(source.rawLoci[0].alleles[1],'');
  }
});
test('Aliases, input order, single homozygotes, and excluded loci preserve source inputs',()=>{
  const i=input(golden.cases.find(c=>c.id==='ident-multiple'));
  i.participants[0].loci={THO1:['9.3'],D1S1656:[13,14]};
  const before=JSON.stringify(i), full=calculate(i);
  assert.equal(full.status,'calculated');assert.equal(full.summary.lociCount,2);
  const one=calculate({...i,includedLoci:['TH01']});close(one.summary.index,1/frequency('TH01','9.3').value**2);
  assert.equal(one.summary.lociCount,1);assert.equal(JSON.stringify(i),before);
  assert.deepEqual(calculate({...i,includedLoci:[]}).summary,null);
});
test('Uncertain, mixed, empty, alias conflict and IDENT mismatch block chosen loci',()=>{
  for(const alleles of [['?'],['OL'],[],['13','14','15']]) {
    const i=input(golden.cases[0]);i.participants[0].loci.D1S1656=alleles;i.includedLoci=['D1S1656'];
    assert.equal(calculate(i).status,'blocked');assert.equal(calculate(i).summary,null);
  }
  const i=input(golden.cases[0]);i.participants=[{...i.participants[0],role:'object1'},{...i.participants[0],role:'object2',loci:{D1S1656:['14']}}];assert.equal(calculate(i).rows[0].status,'IDENT_MISMATCH');
  const alias=input(golden.cases.find(c=>c.id==='ident-microvariant'));alias.participants[0].loci.THO1=['8'];
  assert.equal(calculate(alias).rows[0].status,'ALIAS_CONFLICT');
});
test('TRIO defaults to loci present in every participant; explicit selection still validates missing and uncertain calls',()=>{
  for(const missing of ROLES.TRIO){
    const i={mode:'TRIO',participants:ROLES.TRIO.map(role=>({role,loci:{D1S1656:['13'],TH01:role===missing?[]:['9.3']}}))};
    const result=calculate(i);assert.equal(result.status,'calculated');assert.equal(result.summary.lociCount,1);
    assert.deepEqual(result.excludedLoci,['TH01']);assert.equal(result.rows.find(r=>r.locus==='TH01').message,'Неполные генотипы');
    const forced=calculate({...i,includedLoci:['D1S1656','TH01']});assert.equal(forced.status,'blocked');assert.deepEqual(forced.blockedLoci,['TH01']);
    i.participants.find(p=>p.role===missing).loci.TH01=['9.3'];assert.equal(calculate(i).summary.lociCount,2);
    assert.equal(calculate({...i,includedLoci:['D1S1656']}).summary.lociCount,1);
    i.participants.find(p=>p.role===missing).loci.TH01=['?'];assert.equal(calculate(i).status,'blocked');
    i.participants.find(p=>p.role===missing).loci.TH01=['-'];assert.equal(calculate(i).summary.lociCount,1);
  }
  const ident=calculate({mode:'IDENT',participants:[{role:'object',loci:{D1S1656:['13'],TH01:[]}}]});
  assert.equal(ident.status,'calculated');assert.deepEqual(ident.includedLoci,['D1S1656']);
});
test('Maternal incompatibility/absence remain explicitly blocked',()=>{
  for(const id of ['trio-absent-mother','trio-incompatible-mother'])assert.equal(calculate(input(golden.cases.find(c=>c.id===id))).status,'blocked');
});
test('IDENT includes every supported heterozygote, including the original workbook truncated PRODUCT tail',()=>{
  const loci=Object.fromEntries(calculationLoci.IDENT.map(locus=>[locus,Object.entries(reference.frequencies[locus]).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([a])=>a)]));
  let expected=1;
  for(const [locus,alleles]of Object.entries(loci)){
    const c=calculate({mode:'IDENT',participants:[{role:'object',loci:{[locus]:alleles}}]});
    assert.equal(c.status,'calculated',locus);assert.equal(c.rows[0].variant,'II',locus);
    const factor=1/(2*frequency(locus,alleles[0]).value*frequency(locus,alleles[1]).value);close(c.summary.index,factor);expected*=factor;
  }
  const c=calculate({mode:'IDENT',participants:[{role:'object',loci}]});
  assert.equal(c.status,'calculated');assert.equal(c.summary.lociCount,58);close(c.summary.index,expected);
  for(const locus of ['D19S253','D15S659','D3S3045','D10S1435','D5S2800'])assert.equal(c.rows.find(r=>r.locus===locus).status,'OK',locus);
  assert.match(c.formulaVersion,/all-ident-star-homo-3$/);
});
for(const fixture of extendedGolden.cases)test('IDENT independently recalculated expanded workbook: '+fixture.id,()=>{
  const c=calculate({mode:'IDENT',participants:[{role:'object',loci:fixture.loci}]});
  assert.equal(c.status,'calculated');assert.equal(c.summary.lociCount,fixture.count);close(c.summary.index,fixture.index);
});
test('Probability treats only a numeric allele paired with * as a homozygote, preserving the input and audit trail',()=>{
  for(const value of ['30,*','*,30',['30','*'],['*','30'],['9.3','*']]){
    const allele=JSON.stringify(value).includes('9.3')?'9.3':'30',locus=allele==='9.3'?'TH01':'D21S11';
    for(const mode of ['IDENT','TRIO'])for(const starredRole of ROLES[mode]){
      const i={mode,participants:ROLES[mode].map(role=>({role,loci:{[locus]:role===starredRole?value:[allele,allele]}}))};
      const before=JSON.stringify(i),c=calculate(i),ordinary=calculate({mode,participants:ROLES[mode].map(role=>({role,loci:{[locus]:[allele,allele]}}))});
      assert.equal(c.status,'calculated');assert.deepEqual(c.summary,ordinary.summary);assert.deepEqual(c.rows[0].genotypes,ordinary.rows[0].genotypes);
      assert.equal(c.rows[0].genotypeAdjustments[0].role,starredRole);assert.equal(c.rows[0].genotypeAdjustments[0].code,'STAR_HOMOZYGOTE');
      assert.deepEqual(c.participants.find(p=>p.role===starredRole).loci[locus],require('../src/utils/alleleTokens').alleleTokens(value));
      assert.equal(JSON.stringify(i),before);
    }
  }
  for(const alleles of [['*'],['*','*'],['?','30'],['OL','30'],['*','?'],['0','*'],['30','31','*'],['30','**']]){
    const c=calculate({mode:'IDENT',participants:[{role:'object',loci:{D21S11:alleles}}]});assert.equal(c.status,'blocked',JSON.stringify(alleles));
  }
});
test('TXT star homozygotes retain raw fields, agree with repeated paired calls and export the calculated genotype',async()=>{
  const text='Sample Name\tMarker\tAllele 1\tAllele 2\tAllele 3\n'+
    'SYN\tD21S11\t30\t*\t\nSYN\tD21S11\t30\t30\t\nSYN\tTH01\t*\t9.3\t\n'+
    'SYN\tDYS391\t10\t*\t\nSYN\tAMEL\tX\t*\t\nSYN\tD5S818\t11\t?\t\nSYN\tD2S441\t10\t11\t*\n';
  const sample=previewTxt([{originalname:'synthetic-stars.txt',buffer:Buffer.from(text)}])[0].samples[0];
  assert.deepEqual(sample.loci.D21S11,['30','30']);assert.deepEqual(sample.loci.TH01,['9.3','9.3']);
  assert.deepEqual(sample.rawLoci[0].alleles,['30','*','','','']);assert.deepEqual(sample.rawLoci[2].alleles,['*','9.3','','','']);
  assert.equal(sample.qualityFlags.some(f=>f.code==='REPEATED_MARKER'),false);
  assert.deepEqual(sample.qualityFlags.filter(f=>f.code==='STAR_HOMOZYGOTE').map(f=>f.locus),['D21S11','TH01']);
  for(const [locus,expected]of [['DYS391',['10','*']],['AMEL',['X','*']],['D5S818',['11','?']],['D2S441',['10','11','*']]])assert.deepEqual(sample.loci[locus],expected);
  const c=calculate({mode:'IDENT',participants:[{...sample,role:'object'}],includedLoci:['D21S11','TH01']});
  assert.equal(c.status,'calculated');const before=JSON.stringify(c),report=reportData(c);
  assert.deepEqual(report.rows.find(r=>r[0]==='D21S11').slice(1,3),['30','30']);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(c));let found;
  book.getWorksheet('R_ident').eachRow(row=>{if(row.getCell(1).value==='D21S11')found=row;});
  assert.equal(found.getCell(2).value,'30');assert.equal(found.getCell(3).value,'30');assert.equal(JSON.stringify(c),before);
});
test('Frequency version, locus minimum and missing mutation frequency have explicit provenance',()=>{
  const r=calculate(input(golden.cases.find(c=>c.id==='ident-frequency-fallback')));
  assert.equal(r.rows[0].frequencies[0].origin,'locus_minimum');assert.ok(r.reference.id);assert.ok(r.reference.sourceSha256);
  const i=input(golden.cases.find(c=>c.id==='trio-obligate'));i.participants[1].loci.D1S1656=[13,999];
  assert.equal(calculate(i).rows[0].status,'NO_FREQUENCY');
  assert.throws(()=>frequency('not-a-reference','10'),/частот/);
});
test('GeneMapper parser/adapter are reused: normal, controls, repeated marker and OL',()=>{
  const text='Sample Name\tSample Type\tMarker\tAllele 1\tAllele 2\tStatus\nS1\tSample\tTHO1\t9.3\t9.3\tAnalyzed\nS1\tSample\tAMEL\tX\tY\tAnalyzed\nS1\tSample\tTH01\t8\t9\tAnalyzed\nS2\tSample\tD1S1656\tOL\t13\tAnalyzed\nPC\tPositive Control\tTH01\t9\t9\tAnalyzed\n';
  const files=previewTxt([{originalname:'synthetic.txt',buffer:Buffer.from(text)}]);
  const s=files[0].samples.find(s=>s.displayName==='S1');assert.ok(s.loci.TH01);assert.ok(s.qualityFlags.some(f=>f.code==='REPEATED_MARKER'&&f.hard));
  assert.equal(files[0].samples.find(s=>s.displayName==='PC').selectable,false);
  assert.ok(files[0].samples.find(s=>s.displayName==='S2').loci.D1S1656.includes('?'));
  assert.equal(files[0].samples.find(s=>s.displayName==='S2').rawLoci[0].alleles[0],'OL');
});
test('IDENT uses one genotype and exports its two alleles, with legacy pair calculations preserved',async()=>{
  for(const alleles of [['13'],['13','13'],['13','14']]){
    const source={role:'object',sourceType:'manual',displayName:'Synthetic genotype',loci:{D1S1656:alleles}};
    const before=JSON.stringify(source),single=calculate({mode:'IDENT',participants:[source]});
    const pair=calculate({mode:'IDENT',participants:['object1','object2'].map(role=>({...source,role}))});
    assert.equal(single.status,'calculated');assert.deepEqual(single.summary,pair.summary);
    assert.equal(single.participants.length,1);assert.equal(JSON.stringify(source),before);
    const report=reportData(single);assert.deepEqual(report.columns.slice(1,3),['','']);
    assert.deepEqual(report.rows[0].slice(1,3),[alleles[0],alleles[1]||'']);
    const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(single));
    const sheet=book.getWorksheet('R_ident');let header;
    sheet.eachRow(row=>{if(row.getCell(1).value==='Локус')header=row;});
    assert.ok(header);assert.equal(sheet.getRow(header.number+1).getCell(2).value,alleles[0]);
    assert.equal(sheet.getRow(header.number+1).getCell(3).value,alleles[1]||'');
  }
  assert.throws(()=>calculate({mode:'IDENT',participants:[{role:'object2',loci:{}}]}),/рол/);
});
test('TRIO displayed paternal alleles account for the disputed parent; workbook frequency candidates remain separate',()=>{
  for(const [id,expected]of [['trio-homo',['13']],['trio-obligate',['14']],['trio-ambiguous-one',['13']],
    ['trio-ambiguous-both',['13','14']],['trio-mutation-one',[]],['trio-mutation-two',[]]]){
    const i=input(golden.cases.find(c=>c.id===id)),before=JSON.stringify(i),r=calculate(i);
    assert.equal(r.status,'calculated');assert.deepEqual(r.rows[0].paternalAlleles,expected,id);
    assert.equal(r.rows[0].paternalAllelesAmbiguous,expected.length>1);
    assert.deepEqual(r.rows[0].frequencies.map(f=>f.allele),r.rows[0].formulaAlleles);
    assert.equal(r.rows[0].paternalAlleleStatus,!expected.length?'MUTATION':expected.length>1?'AMBIGUOUS':'MATCH');
    const reversed=calculate({...i,participants:i.participants.map(p=>({...p,loci:{D1S1656:[...p.loci.D1S1656].reverse()}}))});
    assert.deepEqual([...reversed.rows[0].paternalAlleles].sort(),[...expected].sort());
    close(reversed.summary.index,r.summary.index);assert.equal(JSON.stringify(i),before);
  }
  const micro=calculate(input(golden.cases.find(c=>c.id==='trio-multiple')));
  assert.deepEqual(micro.rows.find(r=>r.locus==='TH01').paternalAlleles,['9.3']);
  const invalid=calculate(input(golden.cases.find(c=>c.id==='trio-incompatible-mother')));
  assert.equal(invalid.rows[0].paternalAlleles,undefined);
});
test('D5S818 regression: 11,12 / 11,12 / 11,11 displays only 11; LR retains the original two-frequency branch',()=>{
  for(const [father,expected]of [[['11','11'],['11']],[['12','12'],['12']],[['11','12'],['11','12']],
    [['11','13'],['11']],[['12','13'],['12']],[['13','14'],[]]]){
    const i={mode:'TRIO',participants:ROLES.TRIO.map((role,index)=>({role,loci:{D5S818:[['11','12'],['11','12'],father][index]}}))};
    const before=JSON.stringify(i),r=calculate(i),row=r.rows[0];
    assert.equal(r.status,'calculated');assert.deepEqual(row.paternalAlleles,expected);
    assert.deepEqual(row.formulaAlleles,['11','12']);assert.equal(row.variant,'II');
    const p=frequency('D5S818','11').value,q=frequency('D5S818','12').value;
    const denominator=(2*p-p*p)+(2*q-q*q)-2*p*q;
    close(row.value,expected.length?0.999/denominator:0.001/(1-denominator));
    assert.equal(JSON.stringify(i),before);
    for(const participant of i.participants)participant.loci.D5S818.reverse();
    const reversed=calculate(i);assert.deepEqual([...reversed.rows[0].paternalAlleles].sort(),[...expected].sort());
    close(reversed.summary.index,r.summary.index);
  }
});
test('Probability: short GeneMapper TXT preserves source values and excludes named controls',()=>{
  const text='Sample Name\tMarker\tAllele 1\tAllele 2\tAllele 3\tAllele 4\tAllele 5\t\n'+
    'S1\tTHO1\t9.3\t9.3\t\t\t\t\nS1\tD1S1656\t13\t\t\t\t\t\n'+
    'S2\tFGA\t20\t21\t22\t23\t24\t\nS2\tSE33\tOL\t22.2\t\t\t\t\n'+
    'PC\tTH01\t9\t9\t\t\t\t\nAllelic Ladder\tTH01\t9\t9\t\t\t\t\n';
  const file=previewTxt([{originalname:'20260508_synthetic.txt',buffer:Buffer.from(text)}])[0];
  assert.equal(file.sampleTypeInferred,true);
  const s1=file.samples.find(s=>s.displayName==='S1'),s2=file.samples.find(s=>s.displayName==='S2');
  assert.equal(s1.selectable,true);assert.equal(s1.year,2026);assert.equal(s1.sampleTypeInferred,true);
  assert.deepEqual(s1.loci.TH01,['9.3','9.3']);assert.deepEqual(s1.loci.D1S1656,['13','13']);
  assert.deepEqual(s1.rawLoci[1].alleles,['13','','','','']);
  assert.deepEqual(s2.loci.FGA,['20','21','22','23','24']);
  assert.deepEqual(s2.loci.SE33,['?','22.2']);assert.equal(s2.rawLoci[1].alleles[0],'OL');
  assert.ok(s2.qualityFlags.some(flag=>flag.code==='OFF_LADDER'));
  assert.deepEqual(file.samples.filter(s=>!s.selectable).map(s=>s.displayName),['PC','Allelic Ladder']);
});
test('TXT single autosomal alleles expand to homozygotes in IDENT/TRIO and exports, with raw calls retained',async()=>{
  const markers=[['D1S1656',['13']],['THO1',['9.3']],['TPOX',['8','8']],['FGA',['20','21','22']],
    ['SE33',['OL']],['D2S441',['?']],['D5S818',[]],['DYS391',['10']],['SRY',['SRY']],['AMEL',['X']],
    ['DXS6795',['12']],['Rs771783753',['2']],['UnknownLocus',['12']]];
  const text='Sample Name\tMarker\tAllele 1\tAllele 2\tAllele 3\n'+markers.map(([l,a])=>['SYN-SINGLE',l,...a].join('\t')).join('\n');
  const sample=previewTxt([{originalname:'synthetic-single.txt',buffer:Buffer.from(text)}])[0].samples[0];
  assert.deepEqual(sample.loci.D1S1656,['13','13']);assert.deepEqual(sample.loci.TH01,['9.3','9.3']);
  for(const [l,expected]of [['TPOX',['8','8']],['FGA',['20','21','22']],['SE33',['?']],['D2S441',['?']],
    ['D5S818',[]],['DYS391',['10']],['SRY',['SRY']],['AMEL',['X']],['DXS6795',['12']],['Rs771783753',['2']],['UnknownLocus',['12']]])assert.deepEqual(sample.loci[l],expected,l);
  assert.deepEqual(sample.rawLoci[0].alleles,['13','','','','']);
  assert.deepEqual(sample.rawLoci[1].alleles,['9.3','','','','']);
  assert.deepEqual(sample.qualityFlags.filter(f=>f.code==='HOMOZYGOTE_EXPANDED').map(f=>f.locus),['D1S1656','TH01']);
  const ident=calculate({mode:'IDENT',participants:[{...sample,role:'object'}],includedLoci:['D1S1656','TH01','TPOX']});
  assert.equal(ident.status,'calculated');assert.deepEqual(reportData(ident).rows.find(r=>r[0]==='D1S1656').slice(1,3),['13','13']);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(ident));let row;
  book.getWorksheet('R_ident').eachRow(r=>{if(r.getCell(1).value==='D1S1656')row=r;});
  assert.equal(row.getCell(2).value,'13');assert.equal(row.getCell(3).value,'13');
  const trio=calculate({mode:'TRIO',participants:ROLES.TRIO.map(role=>({...sample,role})),includedLoci:['D1S1656']});
  assert.equal(trio.status,'calculated');assert.deepEqual(trio.rows.find(r=>r.locus==='D1S1656').genotypes,[['13','13'],['13','13'],['13','13']]);
});
test('TXT equivalent single/paired homozygote calls do not conflict; different calls still require review',()=>{
  const text='Sample Name\tMarker\tAllele 1\tAllele 2\nSYN\tD1S1656\t13\t\nSYN\tD1S1656\t13\t13\n';
  const sample=previewTxt([{originalname:'synthetic-repeat.txt',buffer:Buffer.from(text)}])[0].samples[0];
  assert.deepEqual(sample.loci.D1S1656,['13','13']);assert.equal(sample.rawLoci.length,2);
  assert.equal(sample.qualityFlags.some(f=>f.code==='REPEATED_MARKER'),false);
  const conflicting=previewTxt([{originalname:'synthetic-conflict.txt',buffer:Buffer.from(text+'SYN\tD1S1656\t14\t\n')}])[0].samples[0];
  assert.ok(conflicting.qualityFlags.some(f=>f.code==='REPEATED_MARKER'&&f.hard));
});
test('Static XLSX report includes only calculated loci, full precision and snapshot metadata, no formulas',async()=>{
  const i=input(golden.cases[0]);for(const p of i.participants)p.loci.AMEL=['X','Y'];
  const calculation=calculate(i), report=reportData(calculation);assert.equal(report.rows.length,1);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(calculation));
  assert.ok(book.getWorksheet('R_ident'));assert.ok(book.getWorksheet('Параметры'));assert.ok(book.getWorksheet('Числовые данные'));
  book.eachSheet(sheet=>sheet.eachRow(row=>row.eachCell(cell=>assert.notEqual(cell.type,ExcelJS.ValueType.Formula))));
  const values=book.getWorksheet('Числовые данные');assert.equal(values.getCell('B2').value,calculation.rows.find(r=>r.status==='OK').value);
});
test('A4 report groups variant I/II and puts the matching disputed-parent allele first without changing LR',async()=>{
  const c=calculate({mode:'TRIO',participants:ROLES.TRIO.map((role,i)=>({role,displayName:'Synthetic '+role,loci:{
    D5S818:[['11','12'],['11','12'],['12','12']][i],D1S1656:[['13','13'],['13','14'],['14','15']][i]
  }}))});
  const before=JSON.stringify(c),report=reportData(c);
  assert.equal(report.layoutVersion,3);assert.equal(report.presentation.widthMm,180);assert.equal(report.presentation.paginate,false);
  assert.deepEqual(report.sections.map(s=>s.id),['I','II']);
  assert.equal(report.sections[0].rows[0][0],'D1S1656');assert.equal(report.sections[0].rows[0][1],'14');
  assert.deepEqual(report.sections[0].rows.map(row=>row[0]),['D1S1656','D5S818']);
  assert.deepEqual(report.sections[1].rows.map(row=>row[0]),['D1S1656','D5S818']);
  assert.deepEqual(report.sections[0].rows[1],['D5S818','нет','0.0000']);
  assert.deepEqual(report.sections[1].rows[0],['D1S1656','нет','0.0000','нет','0.0000']);
  assert.deepEqual(report.sections[1].rows[1].filter((_,i)=>[0,1,3].includes(i)),['D5S818','12','11']);
  assert.equal(report.summaryRows.find(r=>r.key==='probability').values.length,2);
  assert.equal(report.summaryRows.find(r=>r.key==='index').values[0],c.summary.indexText);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(c));const sheet=book.getWorksheet('R_TRIO');
  assert.equal(sheet.pageSetup.paperSize,9);assert.equal(sheet.pageSetup.orientation,'portrait');assert.equal(sheet.pageSetup.fitToWidth,1);
  assert.ok(sheet.model.merges.includes('A1:P1'));assert.ok(sheet.pageSetup.printArea);
  const cells=[];sheet.eachRow(row=>row.eachCell(cell=>{cells.push(cell.value);assert.notEqual(cell.type,ExcelJS.ValueType.Formula);}));
  assert.ok(cells.includes('ВВОДНЫЕ ГЕНОТИПИЧЕСКИЕ ДАННЫЕ'));assert.equal(JSON.stringify(c),before);
  sheet.eachRow(row=>{if(['D1S1656','D5S818'].includes(row.getCell(1).value))assert.equal(row.getCell(1).value,row.getCell(9).value);});
});
test('Continuous TRIO report aligns every locus in workbook order and keeps mutation factors outside print placeholders',async()=>{
  const input={mode:'TRIO',participants:ROLES.TRIO.map((role,i)=>({role,loci:{
    TH01:[['9','9.3'],['9','9.3'],['12','12']][i],D1S1656:[['13','13'],['13','14'],['15','16']][i]
  }}))};
  const c=calculate(input),before=JSON.stringify(c),report=reportData(c);
  assert.equal(c.summary.mismatches,2);assert.equal(c.summary.lociCount,2);
  assert.deepEqual(report.sections[0].rows,[['D1S1656','нет','0.0000'],['TH01','нет','0.0000']]);
  assert.deepEqual(report.sections[1].rows,[['D1S1656','нет','0.0000','нет','0.0000'],['TH01','нет','0.0000','нет','0.0000']]);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(c));
  let numericRow;book.getWorksheet('Числовые данные').eachRow(row=>{if(row.getCell(1).value==='D1S1656')numericRow=row;});
  assert.ok(JSON.parse(numericRow.getCell(4).value).every(f=>f.value>0));assert.equal(JSON.stringify(c),before);
  const full=calculate({mode:'TRIO',participants:ROLES.TRIO.map(role=>({role,loci:Object.fromEntries([...calculationLoci.TRIO].reverse().map(l=>[l,['13','14']]))}))});
  const whole=reportData(full);assert.equal(full.summary.lociCount,58);
  for(const section of whole.sections)assert.deepEqual(section.rows.map(row=>row[0]),calculationLoci.TRIO);
  assert.equal(whole.rows.length,58);assert.equal(whole.presentation.paginate,false);
});
module.exports={input};
test('IDENT preserves a positive scientific reciprocal below Number range in report and XLSX',async()=>{
 const loci=Object.fromEntries(calculationLoci.IDENT.map(l=>{const a=Object.entries(reference.frequencies[l]).sort((a,b)=>a[1]-b[1])[0][0];return[l,[a,a]];}));
 const c=calculate({mode:'IDENT',participants:[{role:'object',loci}]});assert.equal(c.summary.reciprocal,0);assert.match(c.summary.reciprocalText,/^[1-9]\.\d+E-337$/);
 const report=reportData(c);assert.equal(report.summaryRows.find(r=>r.key==='reciprocal').values[0],c.summary.reciprocalText);
 const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(c));const values=[];book.getWorksheet('R_ident').eachRow(r=>r.eachCell(cell=>values.push(cell.value)));assert.ok(values.includes(c.summary.reciprocalText));
});
