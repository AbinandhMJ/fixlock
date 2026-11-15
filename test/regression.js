#!/usr/bin/env node
// Regression Bench building blocks (bench/regression/cases.js), offline on a tiny repository with a
// real fix commit: undoing the fix must give back the pre-fix code, the control must keep the code,
// and fixlock must judge them as caught / not flagged.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { reverseFix, controlEdit } = require('../bench/regression/cases');
const L = require('../src/locks');

let passed = 0;
const ok = (cond, msg) => { if (!cond) { console.error(`FAIL ${msg}`); console.error('REGRESSION BENCH FAIL'); process.exit(1); } passed++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-regbench-'));
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } });
git('init', '-q', '-b', 'main');
const before = 'def charge(amount):\n    total = amount * 100\n    return total\n\n\ndef refund(amount):\n    return -amount\n';
const fixed = 'def charge(amount):\n    if amount <= 0:\n        raise ValueError("amount must be positive")\n    total = amount * 100\n    return total\n\n\ndef refund(amount):\n    return -amount\n';
fs.writeFileSync(path.join(dir, 'pay.py'), before);
git('add', '-A'); git('commit', '-qm', 'init');
fs.writeFileSync(path.join(dir, 'pay.py'), fixed);
git('commit', '-qam', 'fix: reject charges of zero or less');
const fixSha = git('rev-parse', 'HEAD').trim();
// Later work on the same file, so the reverse diff has to apply on top of newer code.
const later = fixed.replace('    return -amount\n', '    # refunds are negative charges\n    return -amount\n');
fs.writeFileSync(path.join(dir, 'pay.py'), later);
git('commit', '-qam', 'docs: comment refunds');

const regressed = reverseFix(dir, fixSha, 'pay.py');
ok(regressed === later.replace('    if amount <= 0:\n        raise ValueError("amount must be positive")\n', ''), 'undoing the fix gives the pre-fix code on top of later changes');
ok(fs.readFileSync(path.join(dir, 'pay.py'), 'utf8') === later, 'the working tree is left untouched');
ok(reverseFix(dir, 'deadbeef', 'pay.py') === null, 'unknown commit → no case');

const snippet = ['    if amount <= 0:', '        raise ValueError("amount must be positive")'];
const control = controlEdit(later, snippet, 'pay.py');
ok(control && control !== later && control.includes('if amount <= 0:') && control.includes('raise ValueError("amount must be positive")'), 'control keeps the fix and changes something');
const code = (t) => t.split('\n').map((l) => l.replace(/#.*$/, '').trimEnd()).filter(Boolean).join('\n');
ok(code(control) === code(later), 'control only adds comments and blank lines');

const lock = L.withCopies({ file: 'pay.py', snippet }, later);
ok(L.verifyLock(lock, regressed, { file: 'pay.py', before: later }).status === 'changed', 'fixlock catches the undone fix');
ok(L.verifyLock(lock, control, { file: 'pay.py', before: later }).status === 'intact', 'fixlock leaves the control alone');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`REGRESSION BENCH PASS (${passed} checks)`);
