#!/usr/bin/env node
/* Structural checks for the shared UI contract. Run with development dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const { parse } = require('@babel/parser');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'frontend/src');
const manifest = path.join(source, 'styles/index.css');
const styles = new Set();
const owners = new Map();
const animations = new Map();
const definitions = new Set();
const references = new Set();

function visitStyle(file) {
  assert(fs.existsSync(file), `Missing stylesheet: ${file}`);
  assert(!styles.has(file), `Stylesheet imported twice: ${file}`);
  styles.add(file);
  const css = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
  css.walkAtRules('import', (rule) => {
    const match = rule.params.match(/^['"]([^'"]+)['"]$/);
    assert(match, `Unexpected CSS import: ${rule.params}`);
    visitStyle(path.resolve(path.dirname(file), match[1]));
  });
  css.walkRules((rule) => {
    if (rule.parent.name?.endsWith('keyframes')) return;
    for (const selector of rule.selectors) {
      const owner = owners.get(selector);
      assert(!owner || owner === file, `Conflicting selector ${selector}: ${owner} / ${file}`);
      owners.set(selector, file);
    }
  });
  css.walkAtRules('keyframes', (rule) => {
    assert(!animations.has(rule.params), `Duplicate animation: ${rule.params}`);
    animations.set(rule.params, file);
  });
  css.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) definitions.add(decl.prop);
    for (const match of decl.value.matchAll(/var\((--[\w-]+)\)/g)) references.add(match[1]);
  });
}

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'consolidated') return []; // Local, ignored archive of old code.
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

assert(!fs.existsSync(path.join(source, 'styles/styles')), 'Duplicate design system exists');
visitStyle(manifest);
for (const reference of references) assert(definitions.has(reference), `Undefined token: ${reference}`);
for (const file of filesUnder(source).filter((file) => file.endsWith('.css'))) {
  assert(styles.has(file), `Stylesheet outside the manifest: ${file}`);
}

for (const file of [...filesUnder(source), ...filesUnder(path.join(root, 'src/components/bayesian'))]) {
  if (!file.endsWith('.js')) continue;
  const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration' && statement.source.value.endsWith('.css')) {
      assert(file === path.join(source, 'index.js') && statement.source.value === './styles/index.css',
        `Component CSS import makes load order implicit: ${file}`);
    }
  }
}

const tokens = fs.readFileSync(path.join(source, 'styles/base/variables.css'), 'utf8');
for (const [name, value] of [['page-max-width', 1400], ['control-height-sm', 36],
  ['control-height-md', 42], ['control-height-lg', 48]]) {
  assert(tokens.includes(`--${name}: ${value}px;`), `Shared size contract changed: ${name}`);
}
assert(fs.readFileSync(path.join(source, 'App-fixed.js'), 'utf8')
  .match(/path="\/analysis"\s+element=\{\s*<ProtectedRoute[^>]*\bfluid\b/),
  'Analysis must use the fluid PageShell');
assert(fs.readFileSync(path.join(source, 'styles/layout/grid.css'), 'utf8')
  .match(/\.page-shell-fluid\s*\{[^}]*max-width:\s*none/), 'Fluid shell must have no width cap');

console.log(`UI checks passed: ${styles.size} stylesheets, ${owners.size} selectors, ${animations.size} animations.`);
