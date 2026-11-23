const test = require('node:test');
const assert = require('node:assert/strict');
const { getStaffLocusPresentation: cell, getStaffSamplePresentation, staffComparisonGroups } = require('../src/utils/staffComparisonPresentation');
const baseline = require('./fixtures/staff-search-baseline.json');

test('Подсветка staff следует v1.5/v4/v5, различает выпадение/смесь/несовпадение и учитывает кратность', () => {
  const v4 = cell({sampleData:['12','13','14'],staffData:['12','13'],locus:'TH01',detail:{isFullMatch:true,explainedAlleles:['12','13']}});
  assert.equal(v4.status,'full');
  const dropout = cell({sampleData:['12'],staffData:['12','13'],locus:'TH01',detail:{isFullMatch:false,matchType:'inclusiveDropout',explainedAlleles:['12']}});
  assert.equal(dropout.status,'partial');assert.deepEqual(dropout.alleles.map(a=>a.matched),[true,false]);
  const mixture = cell({sampleData:['11','12','13'],staffData:['12','12'],locus:'TH01',detail:{isFullMatch:false,matchType:'overInclusiveMix',explainedAlleles:['12']}});
  assert.deepEqual(mixture.alleles.map(a=>a.matched),[true,false]);
  const ref = getStaffSamplePresentation({sampleData:['12','12','13'],comparisons:[dropout,dropout]});
  assert.deepEqual(ref.alleles.map(a=>a.matched),[true,false,false]);
  assert.equal(cell({sampleData:['12'],staffData:['12'],locus:'TH01'}).status,'not_compared');
  assert.equal(cell({sampleData:['12'],staffData:['12'],locus:'TH01',ignoredLoci:['TH01'],detail:{isFullMatch:true,explainedAlleles:['12']}}).backgroundColor,null);
  assert.equal(cell({sampleData:['*','**','?'],staffData:['12'],locus:'TH01',detail:{isFullMatch:true,explainedAlleles:['12']}}).status,'no_data');
});

test('Эталонные результаты старых алгоритмов определяют те же полные и частичные ячейки без изменения исходных аллелей', () => {
  let checked=0;
  for (const record of baseline.records) for (const group of record.expected) {
    const sample=record.input.referenceProfiles.find(p=>p.id===group.profileId);
    for(const match of group.matches) {
      const staff=record.input.staffProfiles.find(p=>p.id===match.staffId);
      for(const detail of match.detailedMatches) {
        const input={sampleData:sample.str_data[detail.locus],staffData:staff.str_data[detail.locus],locus:detail.locus,detail};
        const before=structuredClone(input);const p=cell(input);
        const informative=require('../src/utils/alleleTokens').informativeAlleles;
        if(informative(input.sampleData).length&&informative(input.staffData).length&&informative(detail.explainedAlleles).length) {
          assert.equal(p.status,detail.isFullMatch?'full':'partial');checked++;
        }
        assert.deepEqual(input,before);
      }
    }
  }
  assert(checked>10);
});

test('Снимки сохраняют специальные значения и не берут изменённые генотипы из рабочей таблицы; старый результат использует свои детали', () => {
  const evidence={staffId:'s',staffName:'SYN',registrationNumber:'007-G',detailedMatches:[{locus:'TH01',sampleAlleles:['12'],staffAlleles:['12','13'],explainedAlleles:['12'],isFullMatch:false}]};
  const group={profileId:'p',reference:{id:'p',internal_number:'SYN-P',str_data:{TH01:['12','?','**']}},matches:[evidence]};
  const staff={id:'s',internal_number:'007-G',full_name:'SYN',str_data:{TH01:['12','13','*']}};
  const before=structuredClone([group,staff]);
  const [result]=staffComparisonGroups([group,{profileId:'empty',matches:[]}],[staff]);
  assert.deepEqual(result.reference.str_data.TH01,['12','?','**']);
  assert.deepEqual(result.matches[0].loci.TH01,['12','13','*']);
  assert.deepEqual([group,staff],before);
  const [legacy]=staffComparisonGroups([{profileId:'old',matches:[evidence]}]);
  assert.equal(legacy.reference.normalizedEvidenceOnly,true);
  assert.deepEqual(legacy.reference.loci.TH01,['12']);
  assert.deepEqual(legacy.matches[0].loci.TH01,['12','13']);
});

test('Отсутствующий регистрационный номер не заменяется техническим staff_id', () => {
  const group = { profileId: 'p', matches: [{ staffId: 's', staffIdentifier: 'workspace-private-id', staffName: 'Тестовый А. А.', detailedMatches: [] }] };
  assert.equal(staffComparisonGroups([group], [{ id: 's', internal_number: '', full_name: 'Тестовый А. А.', str_data: {} }])[0].matches[0].internal_number, '');
  assert.equal(staffComparisonGroups([group])[0].matches[0].internal_number, '');
});
