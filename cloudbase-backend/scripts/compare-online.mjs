import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.argv[2];
if (!baseline) throw Error('Usage: node scripts/compare-online.mjs <extracted-online-directory>');
assert.deepEqual(fs.readFileSync(path.join(root, 'haoqiu-vlm/task-store.js')), fs.readFileSync(path.join(baseline, 'haoqiu-vlm/task-store.js')));

function normalizer(dir) {
  const filename = path.join(dir, 'dist/index.js');
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  let initializer;
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) if (decl.name.getText(ast) === 'normalizeCallEvent') initializer = decl.initializer.getText(ast);
  }
  assert.ok(initializer, 'normalizeCallEvent must exist');
  return vm.runInNewContext(`(${initializer})`);
}
const expected = normalizer(baseline), actual = normalizer(root);
for (const event of [null, {}, { httpMethod: 'POST', path: '/a', body: '{}' },
  { __http: true, method: 'POST', path: '/api/v1/instant-analysis', body: { upload_id: 'task_test' } },
  { __http: true, method: 'DELETE', path: '/a', origin: 'https://example.com', headers: { authorization: 'test' }, body: '{' }]) {
  assert.equal(JSON.stringify(actual(event)), JSON.stringify(expected(event)));
}

async function dispatch(dir, env, invokeResult = 0) {
  const calls = [];
  const exports = {};
  class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
  const sandbox = { exports, process: { env }, require: name => {
    if (name === 'tencentcloud-sdk-nodejs-scf') return { scf: { v20180416: { Client: class {
      constructor(config) { calls.push(config); }
      async Invoke(input) { calls.push(input); return { RequestId: 'offline-request', Result: { InvokeResult: invokeResult } }; }
    } } } };
    if (name === './config') return { loadTencentCredentials: () => ({ SecretId: 'fixture-id', SecretKey: 'fixture-key', SecurityToken: 'fixture-token' }) };
    if (name === './types') return { ApiError };
    throw Error('Unexpected dependency: ' + name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'dist/src/dispatch.js'), 'utf8'), sandbox);
  try { return JSON.stringify({ result: await exports.dispatchAnalysis('rc_fixture'), calls }); }
  catch (error) { return JSON.stringify({ error: { status: error.status, code: error.code, message: error.message }, calls }); }
}
const env = { VLM_SCF_NAMESPACE: 'fixture-env', VLM_SCF_FUNCTION: 'haoqiu-vlm', VLM_WORKER_TOKEN: 'fixture-worker' };
for (const [settings, result] of [[env, 0], [env, 1], [{}, 0]]) assert.equal(await dispatch(root, settings, result), await dispatch(baseline, settings, result));
console.log('Online comparison passed: identical shared store; 5 transport cases; 3 dispatch cases.');
console.log('Full index.js intentionally differs: preserved main history/TTL/CDN behavior, removed GPU routes, and single dispatch with 202 fallback. See docs/BACKEND_BACKFILL.md.');
