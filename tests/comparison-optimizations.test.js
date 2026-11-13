const test = require('node:test');
const assert = require('node:assert/strict');
const { compareTaskProfiles, compareDepartmentProfiles } = require('../src/services/profiles/taskComparisonService');
const { runProfileSearch } = require('../src/services/profiles/searchWorkerExecutor');
const Analyzer = require('../src/services/contamination/staffContaminationAnalyzer');
const { syntheticProfiles } = require('../scripts/benchmark-task-search');
const { calculateContaminationScoreV5 } = require('../src/utils/contaminationAlgorithm');
const { informativeAlleles } = require('../src/utils/alleleTokens');
const { compareStaffProfiles } = require('../src/services/contamination/staffComparisonService');
const { createSelfExclusionCounter } = require('../src/services/profiles/exactCandidateIndex');

test('Indexed logical comparison counts preserve strict self exclusions without a quadratic scan', () => {
  const profiles=[{id:'SYN',sample_name:'25',internal_number:'001',year:2026},
    {id:'SYN',sample_name:'25',internal_number:'001',year:2026},
    {id:undefined,sample_name:null,internal_number:'001',year:'2026'},
    {id:NaN,sample_name:null,internal_number:'001',year:NaN},{}];
  for(const mode of ['task','master_array','workspace_master']) {
    const count=createSelfExclusionCounter(profiles,mode);
    for(const a of profiles) assert.equal(count(a),profiles.filter(b=>mode==='task'?a.id===b.id:mode==='master_array'&&a.sample_name===b.sample_name&&a.internal_number===b.internal_number&&a.year===b.year).length);
  }
});

test('Exact candidate index equals exhaustive search: mixtures, special values, microvariants, years, scopes, zero thresholds', () => {
  const profiles = syntheticProfiles(125);
  const values = [['10'], ['10','10'], ['10','11'], ['11','10'], ['10','10','11'], ['10','?'], ['9.3','11'], ['SRY'], ['*','F'], '10,10', { allele1:'10', allele2:'10' }, []];
  profiles.forEach((p,i) => {
    p.str_data = Object.fromEntries(['DYS391','TH01','SRY','rs771783753','DXS6795','FGA'].map((l,j)=>[l, values[(i+j*7)%values.length]]));
    if (i % 9 === 0) p.str_data.EXTRA_LOCUS = ['11','12.2'];
    p.sample_name = String(i%4); p.year = 2025+i%2;
  });
  profiles.push({ ...profiles[0], id:profiles[1].id, year:2024 });
  const original = structuredClone(profiles);
  for (const compare of [compareTaskProfiles, compareDepartmentProfiles]) {
    for (const searchMode of ['task','master_array','workspace_master','department_tasks']) {
      for (const minMatches of [0,1,3,7,99]) {
        const input = { referenceProfiles:profiles.slice(0,15), compareProfiles:profiles, ignoredLoci:['FGA'], searchMode, minMatches };
        const expected=compare({ ...input, useCandidateIndex:false }), actual=compare(input);
        assert.deepEqual(actual.results,expected.results, `${compare.name} ${searchMode} ${minMatches}`);
        assert.equal(actual.comparisons,expected.comparisons);
        assert(actual.candidateComparisons<=expected.candidateComparisons);
      }
    }
  }
  assert.deepEqual(profiles,original);
});

test('Sparse exact index skips impossible pairs and preserves worker partition order, while dense matches preserve full export', async () => {
  const profiles=syntheticProfiles(130);
  const input={referenceProfiles:profiles,compareProfiles:profiles,minMatches:15};
  const exhaustive=compareTaskProfiles({...input,useCandidateIndex:false});
  const indexed=await runProfileSearch(input,{minParallelComparisons:0});
  assert.deepEqual(indexed.results,exhaustive.results);
  assert.equal(indexed.comparisons,exhaustive.comparisons);
  assert(indexed.candidateComparisons < indexed.comparisons/10);
  const dense=profiles.map(p=>({...p,str_data:profiles[0].str_data}));
  const many={referenceProfiles:[dense[0]],compareProfiles:dense,searchMode:'workspace_master'};
  const direct=compareTaskProfiles({...many,useCandidateIndex:false});
  const parallel=await runProfileSearch(many,{minParallelComparisons:0});
  assert.deepEqual(parallel.results,direct.results);
  assert.equal(parallel.results[0].exportMatches.length,130);
});

test('Deferred staff details preserve v1.5/v4/v5, rounded threshold boundaries and custom penalties', async () => {
  const profiles=syntheticProfiles(12), staff=syntheticProfiles(16).map((p,i)=>({...p,id:'staff-'+i,full_name:'Synthetic '+i,staff_id:'SYN-'+i}));
  profiles[0].str_data={TH01:['9.3','9.3'],FGA:['30','*'],SRY:['SRY'],DYS391:['10']};
  staff[0].str_data={TH01:['9.3'],FGA:['30','30'],SRY:['SRY'],DYS391:['10']};
  const before=structuredClone({profiles,staff});
  const slow=new Analyzer(null,{quiet:true,cacheAlleles:true});
  const fast=new Analyzer(null,{quiet:true,cacheAlleles:true,optimizeComparisons:true});
  for(const algorithm of ['v1.5','v4','v5']) for(const threshold of [0,5.5,9.995,10,10.005]) {
    const opts={useV4Algorithm:algorithm==='v4',useV5Algorithm:algorithm==='v5',threshold,ignoredLoci:['SRY'],
      locusWeights:{TH01:1.2345,FGA:2,DYS391:0},matchCoefficients:{fullMatch:1,partialMatch:0.4,penalty:0.2,inclusiveDropout:0.85,overInclusiveMix:0.7}};
    for(const p of profiles) assert.deepEqual(await fast.detectStaffContamination(p,staff,opts),await slow.detectStaffContamination(p,staff,opts));
  }
  assert.deepEqual({profiles,staff},before);
});

test('Prepared v5 and score-only mode keep scores, rare-rule decisions, locus order and immutable alleles', () => {
  const samples=[{TH01:'9.3,9.3',SE33:['28.2','?'],D12S391:['18.3'],D1S1656:['16.3','18'],AMEL:['X','Y']},
    {TH01:['7','7','9.3'],SE33:['28.2','28.2'],D12S391:['18.3','19'],D1S1656:['16.3'],SRY:['SRY']}];
  const before=structuredClone(samples);
  for(const a of samples) for(const b of samples) {
    const parse=p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,informativeAlleles(v)]));
    const expected=calculateContaminationScoreV5(a,b,new Set(['AMEL']));
    const prepared=calculateContaminationScoreV5(parse(a),parse(b),new Set(['AMEL']),{prepared:true});
    assert.deepEqual(prepared,expected);
    const score=calculateContaminationScoreV5(parse(a),parse(b),new Set(['AMEL']),{prepared:true,includeDetails:false});
    assert.deepEqual({...score,locusDetails:[]},{...expected,locusDetails:[]});
  }
  assert.deepEqual(samples,before);
});

test('Dense staff matches switch to one pass; zero threshold preserves every match', async () => {
  const sample=syntheticProfiles(1)[0];
  const staff=Array.from({length:80},(_,i)=>({...sample,id:'SYN-'+i}));
  for(const version of ['v4','v5']) for(const threshold of [0,1]) {
    const options={useV5Algorithm:version==='v5',useV4Algorithm:version==='v4',threshold};
    const slow=new Analyzer(null,{quiet:true,cacheAlleles:true});
    const fast=new Analyzer(null,{quiet:true,cacheAlleles:true,optimizeComparisons:true});
    assert.deepEqual(await fast.detectStaffContamination(sample,staff,options),await slow.detectStaffContamination(sample,staff,options));
    assert.equal(fast.detailAttempts,threshold===0?0:32);
  }
});

test('v4 prefilter uses rounded scores; returned v5 evidence cannot mutate the parsed cache', async () => {
  const p={id:'SYN',str_data:{TH01:['9.3','9.3']}},s={...p,id:'SYN-staff'};
  const analyzer=new Analyzer(null,{quiet:true,cacheAlleles:true,optimizeComparisons:true});
  const accepted=await analyzer.detectStaffContamination(p,[s],{useV5Algorithm:false,useV4Algorithm:true,threshold:10,locusWeights:{TH01:0.9996}});
  assert.equal(accepted[0].finalScore,10);
  const rejected=await analyzer.detectStaffContamination(p,[s],{useV5Algorithm:false,useV4Algorithm:true,threshold:10.002,locusWeights:{TH01:1.0004}});
  assert.equal(rejected.length,0);
  const options={threshold:0,useV5Algorithm:true};
  const expected=await analyzer.detectStaffContamination(p,[s],options);
  const changed=await analyzer.detectStaffContamination(p,[s],options);
  changed[0].detailedMatches[0].sampleAlleles.push('999');
  changed[0].detailedMatches[0].staffAlleles.push('999');
  assert.deepEqual(await analyzer.detectStaffContamination(p,[s],options),expected);
});

test('Staff schema cache preserves panel order and differing self exclusions with partitioned references', async () => {
  const references=syntheticProfiles(5).map((p,i)=>({...p,metadata:{panelLociOrder:i%2?['FGA','TH01']:['TH01','FGA']}}));
  references[4].str_data={...references[4].str_data,UNKNOWN_LOCUS:['12','13']};
  const staff=references.map((p,i)=>({...p,id:'SYN-staff-'+i,registration_number:'SYN-'+i,year:2026}));
  staff[0].metadata={panelLociOrder:['UNKNOWN_ONLY_IN_STAFF']};
  staff[0].str_data={...staff[0].str_data,UNKNOWN_ONLY_IN_STAFF:['11']};
  const excludedStaffIds=references.map((p,i)=>[p.id,i%2?[]:[staff[0].id]]);
  const options={threshold:0,useV5Algorithm:true};
  const result=await compareStaffProfiles({referenceProfiles:references,staffProfiles:staff,excludedStaffIds,options});
  const analyzer=new Analyzer(null,{quiet:true,cacheAlleles:true});
  for(let i=0;i<references.length;i++) {
    const chosen=staff.filter(s=>!excludedStaffIds[i][1].includes(s.id));
    const expected=(await analyzer.detectStaffContamination(references[i],chosen,options)).map(m=>({...m,registrationNumber:staff.find(s=>s.id===m.staffId).registration_number,staffYear:2026}));
    assert.deepEqual(result.results[i].matches,expected);
  }
});
