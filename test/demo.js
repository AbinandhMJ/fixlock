#!/usr/bin/env node
// The demo is part of the product's first impression: make sure every step still shows what it promises.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const cleanEnv = require('./env');

const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'fixlock.js'), 'demo', '--fast'], { encoding: 'utf8', env: { ...cleanEnv(), NO_COLOR: '1' }, cwd: require('os').tmpdir() });
const out = r.stdout + r.stderr;
const checks = [
  ['exits 0', r.status === 0],
  ['step 1: fix is auto-locked with its issue', /FIX-001 auto-locked .* linear:ENG-12/.test(out)],
  ['step 1: lock reason comes from the commit body', /Why it exists: SAP B1 Service Layer rejects ISO timestamps/.test(out)],
  ['step 2: AI gets "ask the developer"', /verdict: ASK THE DEVELOPER FIRST/.test(out)],
  ['step 3: commit warning, not a block', /Heads up: 1 locked change/.test(out)],
  ['step 4: CI blocks the PR', /✖ 1 locked change\(s\) without approval/.test(out) && /exit 1/.test(out)],
  ['step 5: owner approval unblocks', /APPROVED\s+FIX-001/.test(out) && /exit 0/.test(out)],
  ['no stray errors', !/Error|undefined|NaN/.test(out)],
];
let bad = 0;
for (const [name, pass] of checks) { console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); if (!pass) bad++; }
if (bad) console.log(out);
console.log(bad ? 'DEMO FAIL' : 'DEMO PASS');
process.exit(bad ? 1 : 0);
