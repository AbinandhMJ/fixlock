'use strict';
// A PR can't switch fixlock off for itself or for the next PR: `check` uses the base branch's locks and
// settings, and changes to .fixlock/ need the lock's owner (registry) or a lead (settings). Real git repos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const P = require('../src/policy');
const rules = require('../src/rules');
const E = require('../src/evaluate');
const { mergeConfig } = require('../src/config');

const BIN = path.join(__dirname, '..', 'bin', 'fixlock.js');
let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2500)}` : ''}`); console.error('POLICY FAIL'); process.exit(1); } passed++; };

// ---- Pure
const lock = { id: 'FIX-001', type: 'bug', title: 'never charge zero', reason: 'r', file: 'pay.js', snippet: ['if (amount <= 0) {'], owner: 'ravi', issue: null, test: null, date: '2026-01-01' };
ok(P.changedFields(lock, { ...lock, title: 'x', reason: 'y', history: [1], reviewed: '2026-02-02', release: '1.0.0' }).length === 0, 'title, reason, history, review date and release stamp are harmless');
ok(P.changedFields(lock, { ...lock, test: undefined }).length === 0, 'null and missing are the same');
ok(P.changedFields(lock, { ...lock, owner: 'meena', snippet: [] }).join() === 'owner,snippet', 'owner and code are not');
const baseCfg = mergeConfig({ team: [{ name: 'Abi', github: 'abi', emails: [], role: 'lead' }] });
const baseReg = { version: 2, locks: [lock] };
const same = { config: JSON.stringify(baseCfg), registry: JSON.stringify(baseReg) };
ok(P.policyFindings(baseCfg, baseReg, same).length === 0, 'no change, no finding');
ok(P.policyFindings(baseCfg, baseReg, { ...same, registry: JSON.stringify({ locks: [lock, { ...lock, id: 'FIX-002' }] }) }).length === 0, 'adding a lock needs nobody');
let f = P.policyFindings(baseCfg, baseReg, { ...same, registry: '{ nope' });
ok(f.length === 1 && f[0].registry === 'removed' && /not valid JSON/.test(f[0].note), 'a broken registry counts as removing its locks');
f = P.policyFindings(baseCfg, baseReg, { config: null, registry: null });
ok(f.length === 2 && f.some((x) => x.kind === 'rule' && /deleted/.test(x.msg)), 'deleting .fixlock/ is caught');
ok(rules.editRule(baseCfg, '.fixlock/registry.json', 'cursor').level === 'ask' && rules.editRule(baseCfg, '.fixlock/config.json', 'claude-code').rule.name === 'fixlock-files' && !rules.editRule(baseCfg, 'src/pay.js', 'cursor'), 'AI agents ask before editing .fixlock/ directly');

// ---- End to end
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-policy-'));
const env = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_ACTIONS: '', CI: '', CHANGE_AUTHOR: 'meena' };
delete env.FIXLOCK_TEST_APPROVERS;
const repo = path.join(tmp, 'shop');
fs.mkdirSync(repo);
const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' }).trim();
const fx = (args, extra = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8' });
const cfgFile = path.join(repo, '.fixlock', 'config.json');
const regFile = path.join(repo, '.fixlock', 'registry.json');
const edit = (file, fn) => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); fn(j); fs.writeFileSync(file, JSON.stringify(j, null, 2)); };
const branch = (name) => { git('checkout', '-q', 'main'); git('checkout', '-qb', name); };
const commit = (m) => { git('add', '-A'); git('commit', '-qm', m); };
const PAY = "function pay(amount) {\n  if (amount <= 0) {\n    throw new Error('amount must be positive');\n  }\n  return { charged: amount };\n}\nmodule.exports = { pay };\n";

try {
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'abi@x.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'pay.js'), PAY);
  commit('init');

  // The PR that sets fixlock up: no settings on the base yet, so its own are used
  branch('setup');
  let r = fx(['init', '--yes', '--no-git-hooks']);
  ok(r.status === 0, 'init', r.stderr);
  edit(cfgFile, (c) => { c.team.push({ name: 'Ravi', github: 'ravi', emails: ['ravi@x.com'], role: 'developer' }); });
  r = fx(['mark', 'src/pay.js', '2-4', '-m', 'A charge of zero crashed the ledger', '--title', 'never charge zero', '--owner', 'ravi']);
  ok(r.status === 0, 'mark', r.stdout + r.stderr);
  commit('chore: set up fixlock');
  r = fx(['check', '--base', 'main']);
  ok(r.status === 0 && /1 locks/.test(r.stdout), 'the setup PR is checked with its own settings', r.stdout + r.stderr);
  git('checkout', '-q', 'main'); git('merge', '-q', '--no-edit', 'setup');

  // 1. Remove the lock (code untouched): the owner must approve, or the next PR could change the code freely
  branch('drop-lock');
  edit(regFile, (j) => { j.locks = []; });
  commit('chore: drop a lock');
  r = fx(['check', '--base', 'main', '--markdown', path.join(tmp, 'drop.md')]);
  const md = fs.readFileSync(path.join(tmp, 'drop.md'), 'utf8');
  ok(r.status === 1 && /LOCKED\s+FIX-001/.test(r.stdout) && /lock removed from \.fixlock\/registry\.json/.test(r.stdout) && /@ravi/.test(r.stdout), 'removing a lock needs its owner', r.stdout);
  ok(/This PR removes the lock itself/.test(md) && /undo the change to the lock/.test(md), 'the PR comment says the lock itself is removed', md);
  r = fx(['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: 'ravi' });
  ok(r.status === 0 && /APPROVED\s+FIX-001/.test(r.stdout), 'the owner approves the removal', r.stdout);
  r = fx(['check', '--base', 'main', '--json']);
  ok(JSON.parse(r.stdout).findings.some((x) => x.registry === 'removed' && x.lock === 'FIX-001'), '--json shows it');

  // 2. Weaken it: hand it to yourself and empty the code
  branch('weaken');
  edit(regFile, (j) => { j.locks[0].owner = 'meena'; j.locks[0].snippet = ['return']; });
  commit('chore: tidy lock');
  r = fx(['check', '--base', 'main']);
  ok(r.status === 1 && /lock changed in \.fixlock\/registry\.json: owner, snippet/.test(r.stdout) && /@ravi/.test(r.stdout), 'weakening a lock needs its owner (from the base, not the new one)', r.stdout);

  // 3. Harmless edits and new locks pass
  branch('reword');
  edit(regFile, (j) => { j.locks[0].title = 'Never charge zero or less'; });
  fs.writeFileSync(path.join(repo, 'src', 'refund.js'), "function refund(x) {\n  if (x > 1000) throw new Error('needs a manager');\n  return x;\n}\n");
  commit('feat: refunds');
  r = fx(['mark', 'src/refund.js', '2', '-m', 'big refunds need a manager', '--owner', 'ravi']);
  commit('chore: lock refunds');
  r = fx(['check', '--base', 'main']);
  ok(r.status === 0, 'rewording a lock and adding a new one need nobody', r.stdout);

  // 4. The PR switches the policy off AND changes the locked code: still blocked, plus a settings finding
  branch('switch-off');
  edit(cfgFile, (c) => { c.policies.bug = { ...c.policies.bug, approval: 'none' }; });
  fs.writeFileSync(path.join(repo, 'src', 'pay.js'), PAY.replace("  if (amount <= 0) {\n    throw new Error('amount must be positive');\n  }\n", ''));
  commit('refactor: simplify pay');
  r = fx(['check', '--base', 'main']);
  ok(r.status === 1 && /LOCKED\s+FIX-001/.test(r.stdout) && /RULE\s+\.fixlock\/config\.json changed \(policies\)/.test(r.stdout), "a PR's own settings don't apply to it, and changing them needs a lead", r.stdout);
  r = fx(['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: 'ravi' });
  ok(r.status === 1 && /APPROVED\s+FIX-001/.test(r.stdout) && /needs approval from @abi/.test(r.stdout), 'the owner clears the code, a lead must still approve the settings', r.stdout);
  r = fx(['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: 'ravi,abi' });
  ok(r.status === 0, 'owner and lead approve: passes', r.stdout);

  // 5. Make yourself a lead: the approvers come from the base branch, so it doesn't count
  branch('promote');
  edit(cfgFile, (c) => { c.team.push({ name: 'Meena', github: 'meena', emails: [], role: 'lead' }); });
  commit('chore: add me');
  r = fx(['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: 'meena' });
  ok(r.status === 1 && /changed \(team\)/.test(r.stdout) && /@abi/.test(r.stdout) && !/@meena or/.test(r.stdout), 'adding yourself as a lead in the PR gives you no say over it', r.stdout);

  // 6. Delete .fixlock/ and break the code
  branch('nuke');
  fs.rmSync(path.join(repo, '.fixlock'), { recursive: true, force: true });
  fs.writeFileSync(path.join(repo, 'src', 'pay.js'), 'function pay(a) { return { charged: a }; }\nmodule.exports = { pay };\n');
  commit('chore: cleanup');
  r = fx(['check', '--base', 'main']);
  ok(r.status === 1 && /LOCKED\s+FIX-001/.test(r.stdout) && /deleted/.test(r.stdout), 'deleting .fixlock/ is still checked against the base', r.stdout);

  // 7. Local commits (--staged) keep using the working tree
  branch('local');
  edit(regFile, (j) => { j.locks = []; });
  git('add', '-A');
  r = fx(['check', '--staged']);
  ok(r.status === 0 && /0 locks/.test(r.stdout), 'pre-commit uses the working tree', r.stdout);
  git('reset', '-q', '--hard');

  // Alerts get their own key, so a lock removal and a change to its code alert separately
  ok(require('../src/alerts').keyOf({ kind: 'lock', lock, registry: 'removed' }) === 'FIX-001:registry', 'alert key for a registry change');
  ok(typeof E.expired === 'function', 'evaluate exports expired');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`POLICY PASS (${passed} checks)`);
