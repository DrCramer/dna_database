const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeTxtFiles, sampleRows, sampleLocusCount, assignedRoles, withoutTxtFile } = require('../src/utils/probabilitySampleLibrary');
const sample = (id, name, selectable = true) => ({ sourceType: 'txt', sourceId: id, displayName: name, selectable,
  proof: 'SYNTHETIC-PROOF-' + id, loci: { TH01: ['7','9'], D5S818: ['11','11'], AMEL: ['X','Y'], SRY: ['SRY'], FGA: [] }, qualityFlags: [] });
const first = { fileId: 'content-a', filename: 'run.txt', samples: [sample('a:one','SYN-Родитель'),sample('a:two','SYN-Ребёнок'),sample('a:control','NC',false)] };
const second = { fileId: 'content-b', filename: 'run.txt', samples: [sample('b:three','SYN-Отец')] };

test('Одна общая библиотека сохраняет все образцы и подписи; повтор файла не дублирует карточки', () => {
  const input = JSON.stringify(first);
  const updated = { ...first, samples: first.samples.map(s => ({ ...s, proof: s.proof + '-RENEWED' })) };
  const merged = mergeTxtFiles([first,second],[updated]);
  assert.equal(merged.length,2);assert.equal(merged[0],updated);assert.equal(merged[1],second);
  assert.equal(sampleRows(merged).length,3);assert.equal(sampleRows(merged,'',true).length,4);
  assert.equal(sampleRows(merged)[0].sample.proof,updated.samples[0].proof);
  assert.equal(JSON.stringify(first),input,'исходный объект не изменяется');
});
test('Одинаковые имена файлов разных форезов не объединяются; поиск работает по образцу и файлу', () => {
  const rows=sampleRows([first,second]);
  assert.equal(rows[2].fileLabel,'run.txt (2)');assert.equal(rows[2].sample.sourceId,'b:three');
  assert.equal(sampleRows([first,second],'  ребёнок ')[0].sample.sourceId,'a:two');
  assert.equal(sampleRows([first,second],'RUN.TXT').length,3);assert.equal(sampleRows([first,second],'missing').length,0);
  assert.equal(sampleLocusCount(first.samples[0],'TRIO'),2,'половые и пустые локусы не входят в счётчик');
});
test('Назначения относятся к точному образцу и активному режиму; удаление файла очищает только связанные роли', () => {
  const profiles={mother:first.samples[0],child:first.samples[1],father:second.samples[0],object:first.samples[0],object1:{sourceType:'manual',sourceId:null}};
  assert.deepEqual(assignedRoles(profiles,['mother','child','father'],'a:one'),['mother']);
  const next=withoutTxtFile([first,second],profiles,first.fileId);
  assert.equal(next.files.length,1);assert.equal(next.profiles.mother,null);assert.equal(next.profiles.child,null);assert.equal(next.profiles.object,null);
  assert.equal(next.profiles.father,profiles.father);assert.equal(next.profiles.object1,profiles.object1);assert.equal(profiles.child,first.samples[1]);
});
