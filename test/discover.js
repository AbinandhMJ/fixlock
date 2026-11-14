#!/usr/bin/env node
// fixlock discover: builds a repo whose history looks like a real team's (few Conventional Commits,
// a fix that was reverted and re-applied, fixes with tests, noise) and checks what gets found.
'use strict';
const cleanEnv = require('./env');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/discover');

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures++; console.log(`FAIL ${msg}\n${extra}`); }
};

/* ---------- unit ---------- */
ok(JSON.stringify(D.parseSelection('1-3,5', 6)) === '[0,1,2,4]', 'parseSelection: ranges and lists');
ok(D.parseSelection('all', 3).length === 3 && D.parseSelection('none', 3).length === 0 && D.parseSelection('', 3).length === 0, 'parseSelection: all / none / empty');
ok(JSON.stringify(D.parseSelection('2, 9', 3)) === '[1]', 'parseSelection: ignores numbers out of range');
let threw = false; try { D.parseSelection('first', 3); } catch { threw = true; }
ok(threw, 'parseSelection: rejects nonsense');
ok(D.guardsIn(['if (!items || items.length === 0) return 0;']).includes('null/empty check'), 'guardsIn: null/empty check');
ok(D.guardsIn(['try {', '} catch (e) {']).includes('error handling'), 'guardsIn: error handling');
ok(D.guardsIn(['const x = a + b;']).length === 0, 'guardsIn: plain code has no guards');
ok(D.confidence(8) === 'high' && D.confidence(5) === 'medium' && D.confidence(2) === 'low', 'confidence bands');

/* ---------- a repo with a realistic history ---------- */
const CLI = path.join(__dirname, '..', 'bin', 'fixlock.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-discover-'));
const app = path.join(tmp, 'app');
const env = { ...cleanEnv(), NO_COLOR: '1' };
const git = (...a) => execFileSync('git', a, { cwd: app, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true }); fs.writeFileSync(path.join(app, f), body); };
const commit = (msg) => { git('add', '-A'); git('commit', '-qm', msg); return git('rev-parse', 'HEAD').trim(); };
const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: app, encoding: 'utf8', env, input: '' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

const cart = (body) => `export function total(items) {\n${body}  return items.reduce((s, i) => s + i.price * i.qty, 0);\n}\n`;
const pay = (body) => `export async function charge(order, gateway) {\n${body}  const res = await gateway.charge(order.id, order.amount);\n  return res.id;\n}\n`;
const date = (body) => `export function sapDate(d) {\n${body}}\n`;

try {
  execFileSync('git', ['init', '-q', '-b', 'main', app]);
  git('config', 'user.email', 'abi@example.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
  put('src/cart.js', cart(''));
  put('src/pay.js', pay(''));
  put('src/date.js', date('  return d.toISOString();\n'));
  put('src/legacy.js', 'export const v = 1;\n');
  put('README.md', '# shop\n');
  commit('initial shop');

  // 1. an unconventional fix that came with a test
  put('src/cart.js', cart('  if (!items || items.length === 0) return 0;\n'));
  put('test/cart.test.js', 'test("empty cart", () => expect(total([])).toBe(0));\n');
  commit('Handle empty cart in total (crash on checkout)');

  // 2. a fix that was reverted and had to be re-applied
  put('src/pay.js', pay('  if (order.charged) return order.chargeId; // idempotent: never charge twice\n'));
  const p1 = commit('Prevent double charge on retry #42');
  git('revert', '--no-edit', p1);
  git('revert', '--no-edit', 'HEAD');

  // 3. a conventional fix
  put('src/date.js', date('  const p = (n) => String(n).padStart(2, "0");\n  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;\n'));
  commit('fix: SAP B1 rejects ISO timestamps for DocDate');

  // 4. noise
  put('README.md', '# shop\n\nA small shop.\n');
  commit('update readme');
  put('src/legacy.js', 'export const v = 2;\n');
  commit('refactor: bump legacy constant');
  put('src/util.js', 'export const sum = (a, b) => a + b;\n');
  commit('add sum helper');

  // 5. a fix whose code was later replaced entirely: nothing left to lock
  put('src/legacy.js', 'export const v = 2;\nif (!globalThis.x) throw new Error("x");\n');
  commit('fix crash when x missing');
  put('src/legacy.js', 'export const v = 3;\n');
  commit('rewrite legacy module');

  const init = cli('init', '--yes');
  ok(init.code === 0, 'init', init.out);
  git('add', '-A'); git('commit', '-qm', 'chore: add fixlock');

  /* JSON: what is found and why */
  let r = cli('discover', '--json');
  let res; try { res = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { res = { found: [] }; }
  const by = (file) => res.found.find((f) => f.file === file);
  ok(r.code === 0 && res.scanned >= 10, 'discover --json scans the history', r.out);

  const p = by('src/pay.js');
  ok(p && p.confidence === 'high' && p.signals.some((s) => /re-applied/.test(s)) && p.title === 'Prevent double charge on retry #42',
    'reverted-then-re-applied fix: high confidence, original title', JSON.stringify(p));
  ok(p && p.snippet.some((l) => /order\.charged/.test(l)), 'reapplied fix: locks the restored guard line');
  ok(res.found[0] && res.found[0].file === 'src/pay.js', 'the re-applied fix ranks first', JSON.stringify(res.found.map((f) => [f.file, f.score])));

  const ct = by('src/cart.js');
  ok(ct && ct.signals.some((s) => /handle/.test(s)) && ct.signals.some((s) => /came with a test/.test(s)) && ct.signals.some((s) => /null\/empty check/.test(s)) && ct.test === 'test/cart.test.js',
    'unconventional fix found from its message, test and guard', JSON.stringify(ct));
  ok(ct && ct.lines[0] === 2 && ct.lines[1] === 2, 'only the fix line is suggested, not the whole function', JSON.stringify(ct && ct.lines));

  const dt = by('src/date.js');
  ok(dt && dt.signals.includes('fix commit') && dt.signals.some((s) => /format\/encoding|small/.test(s)), 'conventional fix found too', JSON.stringify(dt));

  ok(!by('README.md') && !by('src/util.js'), 'noise commits are not suggested');
  ok(!by('src/legacy.js'), 'a fix whose code no longer exists is not suggested');
  ok(!res.found.some((f) => /^Revert/.test(f.title)), 'revert commits themselves are never suggested');

  /* non-interactive without --apply: lists, locks nothing */
  r = cli('discover');
  ok(r.code === 0 && /Found \d+ block\(s\) from \d+ past fix/.test(r.out) && /--apply/.test(r.out), 'without a terminal: lists and explains --apply', r.out);
  ok(JSON.parse(fs.readFileSync(path.join(app, '.fixlock', 'registry.json'), 'utf8')).locks.length === 0, '…and locks nothing');

  /* --min filters */
  r = cli('discover', '--json', '--min', '7');
  const high = JSON.parse(r.out.slice(r.out.indexOf('{'))).found;
  ok(high.length >= 1 && high.every((f) => f.score >= 7), '--min keeps only stronger candidates');

  /* --apply locks them */
  r = cli('discover', '--apply');
  const reg = JSON.parse(fs.readFileSync(path.join(app, '.fixlock', 'registry.json'), 'utf8'));
  const payLock = reg.locks.find((l) => l.file === 'src/pay.js');
  const cartLock = reg.locks.find((l) => l.file === 'src/cart.js');
  ok(r.code === 0 && reg.locks.length === res.found.length, '--apply locks every suggestion', r.out);
  ok(payLock && payLock.source.discovered && payLock.source.signals.length && payLock.owner && /re-applied/.test(payLock.reason) && /^Prevent double charge/.test(payLock.reason), 'locks record why they were suggested', JSON.stringify(payLock));
  ok(cartLock && cartLock.test === 'test/cart.test.js', 'the fix\'s test is linked to the lock');

  /* re-running finds nothing new */
  r = cli('discover', '--json');
  ok(JSON.parse(r.out.slice(r.out.indexOf('{'))).found.length === 0, 'already-locked fixes are not suggested again');

  /* and the locks work: undoing the double-charge guard fails CI */
  git('add', '-A'); git('commit', '-qm', 'chore(fixlock): lock past fixes');
  git('checkout', '-q', '-b', 'feature');
  put('src/pay.js', pay(''));
  r = cli('check', '--base', 'main');
  ok(r.code === 1 && /Prevent double charge/.test(r.out), 'a discovered lock blocks the regression in CI', r.out);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : '\nDISCOVER PASS');
process.exit(failures ? 1 : 0);
