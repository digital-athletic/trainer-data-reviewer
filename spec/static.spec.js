import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { APP } from './helpers.js';

function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((n) => {
    const p = join(dir, n.name);
    if (n.isDirectory()) return jsFiles(p);
    return n.name.endsWith('.js') ? [p] : [];
  });
}

const INDEX = join(APP, 'index.html');
const CORE = join(APP, 'js', 'core');

test('static: index.html loads module scripts and no external src or href', { skip: !existsSync(INDEX) && 'index.html is missing' }, () => {
  const html = readFileSync(INDEX, 'utf8');
  assert.match(html, /<script[^>]*type\s*=\s*["']module["']/i);
  assert.doesNotMatch(html, /<script(?![^>]*type\s*=\s*["']module["'])[^>]*\ssrc\s*=/i);
  assert.doesNotMatch(html, /(src|href)\s*=\s*["']\s*(https?:)?\/\//i);
  assert.doesNotMatch(html, /\bvar\s/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self';/);
  assert.doesNotMatch(html, /\sstyle\s*=|<style|<script>/i);
});

test('static: no file under js/ uses eval, var, an external fetch or the old namespace', () => {
  const files = jsFiles(join(APP, 'js'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const name = relative(APP, f);
    assert.doesNotMatch(text, /\beval\(/, name);
    assert.doesNotMatch(text, /\bvar\s/, name);
    assert.doesNotMatch(text, /fetch\(\s*[`'"](https?:)?\/\//, name);
    assert.doesNotMatch(text, /globalThis\.CDR|module\.exports|\brequire\(/, name);
    assert.doesNotMatch(text, /eslint-disable|@ts-ignore/, name);
  }
});

test('static: core files are ES modules with named exports and only relative imports', () => {
  for (const f of jsFiles(CORE)) {
    const text = readFileSync(f, 'utf8');
    const name = relative(APP, f);
    assert.match(text, /^export (const|function|async function|class) /m, name);
    assert.doesNotMatch(text, /^export default/m, name);
    for (const [, spec] of text.matchAll(/^import .* from '([^']+)';$/gm)) {
      assert.match(spec, /^\.\/[\w-]+\.js$/, `${name} imports ${spec}`);
    }
  }
});

test('static: only config.js knows the target repository paths', () => {
  for (const f of jsFiles(CORE)) {
    if (f.endsWith('config.js')) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /athlete-mobile|\.spec\.ts|user_exercises/, relative(APP, f));
  }
});
