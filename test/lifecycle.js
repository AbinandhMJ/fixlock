'use strict';
// Test-linked locks and the lock lifecycle (link, test, check --run-tests, relock, handover, review),
// end to end in real git repositories. Uses node --test, so nothing needs installing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'fixlock.js');
let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2500)}` : ''}`); console.error('LIFECYCLE FAIL'); process.exit(1); } passed++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-life-'));
const env = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_ACTIONS: '', CI: '' };
const repo = path.join(tmp, 'shop');
fs.mkdirSync(repo);
const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' }).trim();
const fx = (...a) => spawnSync(process.execPath, [BIN, ...a], { cwd: repo, env, encoding: 'utf8' });
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const reg = () => JSON.parse(fs.readFileSync(path.join(repo, '.fixlock', 'registry.json'), 'utf8'));
const cfgFile = path.join(repo, '.fixlock', 'config.json');

const PAY = `function pay(amount) {
  if (amount <= 0) {
    throw new Error('amount must be positive');
  }
  return { charged: amount };
}
module.exports = { pay };
`;
const TEST = `const test = require('node:test');
const assert = require('node:assert');
const { pay } = require('../src/pay');
test('a charge of zero is refused', () => { assert.throws(() => pay(0)); });
test('a normal charge works', () => { assert.deepStrictEqual(pay(5), { charged: 5 }); });
`;

try {
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'abi@x.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false'); // keep LF on Windows runners
  write('src/pay.js', PAY); write('test/pay.test.js', TEST); write('package.json', '{"name":"shop","private":true}\n');
  git('add', '.'); git('commit', '-qm', 'init');
  let r = fx('init', '--yes', '--no-git-hooks');
  ok(r.status === 0, 'init', r.stderr);
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.team.push({ name: 'Ravi', github: 'ravi', emails: ['ravi@x.com'], role: 'developer' });
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

  // mark with --test and --expires validation
  r = fx('mark', 'src/pay.js', '2-4', '-m', 'A charge of zero crashed the ledger', '--test', 'test/nope.test.js');
  ok(r.status !== 0 && /Test file not found/.test(r.stderr), 'mark --test refuses a test that does not exist', r.stderr);
  r = fx('mark', 'src/pay.js', '2-4', '-m', 'x', '--expires', '30/06/2027');
  ok(r.status !== 0 && /YYYY-MM-DD/.test(r.stderr), 'mark --expires wants YYYY-MM-DD', r.stderr);
  r = fx('mark', 'src/pay.js', '2-4', '-m', 'A charge of zero crashed the ledger', '--title', 'never charge zero', '--owner', 'ravi');
  ok(r.status === 0 && reg().locks.length === 1, 'mark', r.stdout + r.stderr);

  // link + test
  r = fx('link', 'FIX-001', 'test/pay.test.js');
  ok(r.status === 0 && reg().locks[0].test === 'test/pay.test.js' && /node --test test\/pay\.test\.js/.test(r.stdout), 'link sets the test and shows how it runs', r.stdout + r.stderr);
  r = fx('test');
  ok(r.status === 0 && /✔ FIX-001 never charge zero/.test(r.stdout) && /passed/.test(r.stdout), 'fixlock test: the linked test passes', r.stdout + r.stderr);
  git('add', '.'); git('commit', '-qm', 'chore: lock the zero-charge fix');

  // 1. A refactor that keeps the fix: lines change, the test passes, the test is untouched → satisfied
  git('checkout', '-qb', 'refactor');
  write('src/pay.js', PAY.replace("  if (amount <= 0) {\n    throw new Error('amount must be positive');\n  }\n", "  assertPositive(amount);\n").replace('module.exports', "function assertPositive(n) { if (!(n > 0)) throw new RangeError('amount must be positive'); }\nmodule.exports"));
  git('commit', '-qam', 'refactor: move the guard into a helper');
  r = fx('check', '--base', 'main');
  ok(r.status === 1 && /LOCKED/.test(r.stdout), 'without --run-tests a refactor of locked lines needs approval', r.stdout);
  r = fx('check', '--base', 'main', '--run-tests', '--markdown', path.join(tmp, 'ok.md'));
  ok(r.status === 0 && /TEST OK\s+FIX-001/.test(r.stdout) && /still passes/.test(r.stdout), 'check --run-tests: the test still passes → satisfied, exit 0', r.stdout + r.stderr);
  const md = fs.readFileSync(path.join(tmp, 'ok.md'), 'utf8');
  ok(/locked code changed, and its tests still pass/.test(md) && /Test passes: FIX-001/.test(md), 'PR comment says the test proved the change', md);

  // 2. Removing the fix: the test fails → still blocked, with the failure shown
  git('checkout', '-q', 'main'); git('checkout', '-qb', 'undo');
  write('src/pay.js', PAY.replace("  if (amount <= 0) {\n    throw new Error('amount must be positive');\n  }\n", ''));
  git('commit', '-qam', 'refactor: simplify pay');
  r = fx('check', '--base', 'main', '--run-tests', '--markdown', path.join(tmp, 'bad.md'));
  ok(r.status === 1 && /LOCKED\s+FIX-001/.test(r.stdout) && /Its test test\/pay\.test\.js fails/.test(r.stdout), 'undoing the fix: the test fails and the PR stays blocked', r.stdout);
  ok(/\*\*Its test `test\/pay\.test\.js` fails\*\*/.test(fs.readFileSync(path.join(tmp, 'bad.md'), 'utf8')) && /Test output/.test(fs.readFileSync(path.join(tmp, 'bad.md'), 'utf8')), 'PR comment: failing test and its output');

  // 3. Refactor + editing the test: the test can't vouch for the change
  git('checkout', '-q', 'refactor'); git('checkout', '-qb', 'weaken');
  write('test/pay.test.js', TEST.replace("test('a charge of zero is refused', () => { assert.throws(() => pay(0)); });\n", ''));
  git('commit', '-qam', 'test: drop a test');
  r = fx('check', '--base', 'main', '--run-tests');
  ok(r.status === 1 && /LOCKED\s+FIX-001/.test(r.stdout) && /also edits the test/.test(r.stdout), 'a PR that edits the linked test still needs approval', r.stdout);

  // tests.satisfies: false → the test result is shown but approval is still needed
  git('checkout', '-q', 'refactor');
  const c2 = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); c2.tests = { satisfies: false }; fs.writeFileSync(cfgFile, JSON.stringify(c2, null, 2));
  r = fx('check', '--base', 'main', '--run-tests');
  ok(r.status === 1 && /still passes/.test(r.stdout), 'tests.satisfies false: passing test noted, approval still needed', r.stdout);
  c2.tests = { run: true }; fs.writeFileSync(cfgFile, JSON.stringify(c2, null, 2));
  r = fx('check', '--base', 'main');
  ok(r.status === 0 && /TEST OK/.test(r.stdout), 'tests.run true in the config: no flag needed', r.stdout);
  git('checkout', '-q', '--', '.fixlock/config.json');

  // relock after the approved refactor (now on main)
  git('checkout', '-q', 'main'); git('merge', '-q', '--no-edit', 'refactor');
  r = fx('review');
  ok(/FIX-001/.test(r.stdout) && /needs re-lock/.test(r.stdout), 'review lists the lock whose lines changed', r.stdout);
  r = fx('relock', '--changed');
  ok(r.status === 0 && /none of its lines are left/.test(r.stdout) && /--lines/.test(r.stdout), 'relock --changed: when every locked line was replaced, it asks where the fix is now', r.stdout + r.stderr);
  r = fx('relock', 'FIX-001', '--lines', '1-2', '-m', 'guard moved into assertPositive');
  ok(r.status === 0 && /relocked FIX-001/.test(r.stdout), 'relock --lines', r.stdout + r.stderr);
  const l = reg().locks[0];
  ok(l.snippet.some((x) => x.includes('assertPositive(amount)')) && l.history.length === 1 && l.history[0].snippet.some((x) => x.includes('amount <= 0')) && l.history[0].reason === 'guard moved into assertPositive', 'relock: new lines locked, old ones kept in history', JSON.stringify(l));
  git('commit', '-qam', 'chore: relock');
  r = fx('check', '--base', 'HEAD');
  ok(r.status === 0 && /Clean/.test(r.stdout), 'after relock the lock is intact', r.stdout);
  r = fx('relock', 'FIX-001');
  ok(/already intact/.test(r.stdout), 'relock on an intact lock says so');
  // Part of the lock changed (an approved signature change): automatic relock covers the changed line too
  write('src/pay.js', fs.readFileSync(path.join(repo, 'src/pay.js'), 'utf8').replace('function pay(amount) {', 'function pay(amount, currency = "INR") {'));
  r = fx('relock', '--changed');
  ok(r.status === 0 && /relocked FIX-001\s+src\/pay\.js:1-2/.test(r.stdout) && reg().locks[0].snippet[0].includes('currency'), 'relock --changed: a partly changed lock is relocked over the same lines', r.stdout + JSON.stringify(reg().locks[0].snippet));

  // handover
  r = fx('handover', 'ravi', 'nobody');
  ok(r.status !== 0 && /not in the team/.test(r.stderr), 'handover to someone not on the team is refused');
  r = fx('handover', 'ravi', 'abi', '--remove');
  const after = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  ok(r.status === 0 && reg().locks[0].owner === 'abi' && JSON.stringify(reg().locks[0].previousOwners) === '["ravi"]' && !after.team.some((m) => m.github === 'ravi'), 'handover moves the locks and --remove takes them off the team', r.stdout + r.stderr);

  // review: orphaned, expired, not reviewed lately; --keep settles it
  const rg = reg(); rg.locks[0].owner = 'gone'; rg.locks[0].expires = '2020-01-01'; rg.locks[0].date = '2020-01-01';
  fs.writeFileSync(path.join(repo, '.fixlock', 'registry.json'), JSON.stringify(rg, null, 2));
  const c3 = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); c3.lifecycle = { reviewAfterDays: 180 }; fs.writeFileSync(cfgFile, JSON.stringify(c3, null, 2));
  r = fx('review', '--json');
  const items = JSON.parse(r.stdout);
  ok(items.length === 1 && items[0].why.some((w) => /expired on 2020-01-01/.test(w)) && items[0].why.some((w) => /owner gone isn't on the team/.test(w)) && items[0].why.some((w) => /not reviewed since 2020-01-01/.test(w)), 'review: expired, orphaned and overdue', r.stdout);
  // An expired lock only warns in check
  git('add', '.'); git('commit', '-qm', 'chore: lifecycle'); git('checkout', '-qb', 'expired-change');
  write('src/pay.js', fs.readFileSync(path.join(repo, 'src/pay.js'), 'utf8').replace('  assertPositive(amount);\n', ''));
  git('commit', '-qam', 'refactor: drop the helper call');
  r = fx('check', '--base', 'main');
  ok(r.status === 0 && /WARNING\s+FIX-001/.test(r.stdout) && /expired on 2020-01-01/.test(r.stdout), 'an expired lock only warns', r.stdout);
  git('checkout', '-q', 'main');
  r = fx('review', 'FIX-001', '--keep', '--expires', '2099-12-31');
  ok(r.status === 0 && reg().locks[0].expires === '2099-12-31' && reg().locks[0].reviewed, 'review --keep --expires extends the lock', r.stdout + r.stderr);
  r = fx('review', 'FIX-001', '--keep');
  ok(reg().locks[0].expires === '2099-12-31', '--keep keeps a future expiry');
  r = fx('review', 'FIX-001', '--remove', '--force');
  ok(r.status === 0 && reg().locks.length === 0, 'review --remove removes the lock', r.stdout + r.stderr);
  r = fx('test');
  ok(/No lock has a linked test yet/.test(r.stdout), 'fixlock test with no linked tests says how to link one');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`LIFECYCLE PASS (${passed} checks)`);
