// Local packaging only. Upload/deployment is deliberately not part of this script.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.json')], { stdio: 'inherit' });
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'haoqiu-api-backfill-'));
fs.mkdirSync(path.join(output, 'dist/src'), { recursive: true });
fs.mkdirSync(path.join(output, 'haoqiu-vlm'));
const copy = rel => fs.copyFileSync(path.join(root, rel), path.join(output, rel));
for (const rel of ['index.js', 'package.json', 'package-lock.json', 'dist/index.js', 'haoqiu-vlm/task-store.js']) copy(rel);
for (const name of fs.readdirSync(path.join(root, 'src'))) {
  if (name.endsWith('.ts') && !name.endsWith('.d.ts')) copy(`dist/src/${name.slice(0, -3)}.js`);
}
// Copy production packages from the installed lockfile, excluding development tools.
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const [rel, meta] of Object.entries(lock.packages)) {
  if (!rel.startsWith('node_modules/') || meta.dev || !fs.existsSync(path.join(root, rel))) continue;
  fs.cpSync(path.join(root, rel), path.join(output, rel), {
    recursive: true,
    filter: source => source === path.join(root, rel) || path.basename(source) !== 'node_modules'
  });
}
const sharedHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(output, 'haoqiu-vlm/task-store.js'))).digest('hex');
if (sharedHash !== '396f04747add9fe83ccc35b02570fa772ccd450f0801e1276f86b76eaa7f841a') throw Error('Shared store differs from the approved online snapshot');
execFileSync(process.execPath, ['-e', `
  const assert = require('node:assert/strict');
  const app = require('./index.js');
  assert.equal(typeof require('./dist/src/dispatch.js').dispatchAnalysis, 'function');
  assert.equal(typeof require('./dist/src/rc-repository.js').RcRepository, 'function');
  assert.equal(typeof require('./haoqiu-vlm/task-store.js').configuredStore, 'function');
  app.main({httpMethod:'OPTIONS',path:'/'},{}).then(r => {assert.equal(r.statusCode,204); console.log('Isolated package entry check passed');}).catch(e => {console.error(e);process.exitCode=1;});
`], { cwd: output, stdio: 'inherit' });
const files = {};
function inventory(dir, relative = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const name = path.join(relative, entry.name), full = path.join(dir, entry.name);
    if (entry.isDirectory()) inventory(full, name);
    else files[name] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }
}
inventory(output);
fs.writeFileSync(path.join(output, 'source-manifest.json'), JSON.stringify({
  baseCommit: '1322947ed950dc50b010e45101dd5a96d120bce5',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  sharedHash, files
}, null, 2));
console.log(`Local API package: ${output}`);
