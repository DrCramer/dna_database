const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformFileSync } = require('@babel/core');
const filename = path.resolve(__dirname, '../frontend/src/components/Workspace/WorkspaceDuplicateResults.js');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(transformFileSync(filename, { presets: ['@babel/preset-env', '@babel/preset-react'] }).code, filename);
const Table = compiled.exports.default;
const profile = (id, data) => ({ id, internal_number: 'SYN-' + id, year: 2026, loci: data });
function render(groups, props = {}) { return renderToStaticMarkup(React.createElement(Table, { groups, ...props })); }
function cell(html, locus) { return html.match(new RegExp('<td[^>]*data-locus="' + locus + '"[^>]*>.*?</td>', 'g')).at(-1); }

test('Таблица использует правила основной ветки: полный/частичный/нет данных/исключённый, сохраняя аллели и счётчик зелёных', () => {
  const reference = profile('REF', { TH01: ['7', '9.3'], D5S818: ['11', '12'], D21S11: ['29', '30'], FGA: ['20', '21'], DYS391: ['10'], AMEL: ['X', 'Y'] });
  const match = { ...profile('MATCH', { TH01: ['9.3', '7'], D5S818: ['11', '12.2'], D21S11: ['9', '10'], FGA: ['20', '21'], DYS391: ['10'], AMEL: ['*', '**', '?'] }), matchedLoci: ['TH01', 'FGA', 'DYS391'] };
  const groups = [{ reference, matches: [match] }], before = structuredClone(groups);
  const html = render(groups, { ignoredLoci: ['FGA'] });
  assert.match(cell(html, 'TH01'), /data-status="full"/);
  assert.match(cell(html, 'TH01'), /9\.3,7/);
  assert.match(cell(html, 'D5S818'), /data-status="partial"/);
  assert.match(cell(html, 'D5S818'), /workspace-duplicate-matching-allele[^>]*>11<\/span>/);
  assert.match(cell(html, 'D5S818'), /12\.2/);
  assert.match(cell(html, 'D21S11'), /data-status="no_match"/);
  assert.match(cell(html, 'FGA'), /data-status="not_compared"/);
  assert.doesNotMatch(cell(html, 'FGA'), /duplicate-cell-bg/);
  assert.match(cell(html, 'AMEL'), /data-status="no_data"[^>]*>\*,\*\*,\?/);
  assert.match(cell(html, 'DYS391'), />10<\/td>/);
  assert.match(html, /class="workspace-duplicate-count"[^>]*>2<\/td>/);
  assert.deepEqual(groups, before, 'Display cannot normalize original genotypes');
});

test('V5-статусы совпадают с подсветкой XLSX; старый результат без снимка не получает ложных совпадений', () => {
  const ref = profile('REF', { TH01: ['7', '9'], D21S11: ['30', '31'] });
  const match = { ...profile('V5', { TH01: ['7', '9'], D21S11: ['30', '31'] }), details: { TH01: { status: 'dropout' }, D21S11: { status: 'match' } } };
  let html = render([{ reference: ref, matches: [match] }]);
  assert.match(cell(html, 'TH01'), /data-status="partial"/);
  assert.match(html, /class="workspace-duplicate-count"[^>]*>1<\/td>/);
  html = render([{ reference: { id: 'OLD', internal_number: 'SYN-OLD' }, matches: [match] }]);
  assert.match(html, /нет снимка аллелей эталона/);
  assert.match(cell(html, 'TH01'), /data-status="no_data"/);
  assert.doesNotMatch(cell(html, 'TH01'), /duplicate-cell-bg/);
});

test('Большая выдача ограничивает DOM пятью эталонами и 50 совпадениями, без вывода пустых групп', () => {
  const data = { TH01: ['7', '9'] };
  const groups = Array.from({ length: 100 }, (_, i) => ({ reference: profile('R' + i, data), exportMatches: Array.from({ length: 1000 }, (_, j) => profile('M' + i + '-' + j, data)) }));
  const html = render([{ reference: profile('EMPTY', data), matches: [] }, ...groups]);
  assert.equal((html.match(/class="workspace-duplicate-reference"/g) || []).length, 5);
  assert.equal((html.match(/class="workspace-duplicate-count"/g) || []).length, 250);
  assert.doesNotMatch(html, /SYN-EMPTY|SYN-R5|SYN-M0-50(?:<|"| )/);
  assert.match(html, /Следующие эталоны/);
  assert.match(html, /Следующие совпадения/);
  assert.match(render([{ reference: profile('EMPTY', data), matches: [] }]), /Совпадений не найдено/);
});
