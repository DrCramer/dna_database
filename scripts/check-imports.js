#!/usr/bin/env node
// Проверяет относительные импорты, включая модули вне production entry point.
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@babel/parser');

const root = path.resolve(__dirname, '..');
function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'consolidated') return []; // Локальный игнорируемый архив.
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
const files = ['src', 'frontend/src', 'tests', 'scripts']
  .flatMap(directory => filesUnder(path.join(root, directory)))
  .filter(file => /\.jsx?$/.test(file));
files.push(path.join(root, 'webpack.config.js'));

let imports = 0;
const missing = [];
function visit(node, file) {
  if (!node || typeof node !== 'object') return;
  let source;
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) {
    source = node.source;
  }
  if (node.type === 'CallExpression' && (node.callee.name === 'require'
    || node.callee.type === 'Import'
    || (node.callee.type === 'MemberExpression' && node.callee.object.name === 'require'
      && node.callee.property.name === 'resolve'))) {
    source = node.arguments[0];
  }
  if (source?.type === 'StringLiteral' && /^\.\.?\//.test(source.value)) {
    imports++;
    const target = path.resolve(path.dirname(file), source.value);
    const candidates = [target, ...['.js', '.jsx', '.json', '.css', '.node'].map(ext => target + ext),
      path.join(target, 'index.js'), path.join(target, 'package.json')];
    if (!candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
      missing.push(`${path.relative(root, file)}:${source.loc.start.line}: ${source.value}`);
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, file));
    else if (value && typeof value === 'object') visit(value, file);
  }
}
for (const file of files) {
  visit(parse(fs.readFileSync(file, 'utf8'), { sourceType: 'unambiguous', plugins: ['jsx'] }).program, file);
}
if (missing.length) {
  console.error(`Неразрешённые импорты (${missing.length}):\n${missing.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Import checks passed: ${files.length} JS files, ${imports} relative imports.`);
}
