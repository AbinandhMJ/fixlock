'use strict';
// Policy as code: path rules per AI agent. Pure matching, the pre-edit hooks, and `fixlock check` with
// AI-attributed commits, in a real repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const R = require('../src/rules');

const BIN = path.join(__dirname, '..', 'bin', 'fixlock.js');
let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2000)}` : ''}`); console.error('RULES FAIL'); process.exit(1); } passed++; };

// Globs
const m = (g, p) => R.globToRe(g).test(p);
ok(m('src/billing/**', 'src/billing/a/b.ts') && m('src/billing/', 'src/billing/x.js') && m('src/billing', 'src/billing/x.js') && !m('src/billing/**', 'src/billingx/a.ts'), 'folder globs');
ok(m('*.sql', 'db/x/a.sql') && m('*.sql', 'a.sql') && !m('db/*.sql', 'db/x/a.sql') && m('db/**/*.sql', 'db/x/a.sql') && m('db/**/*.sql', 'db/a.sql'), 'file globs, gitignore-style');
ok(m('src/a?.js', 'src/ab.js') && !m('src/a?.js', 'src/abc.js') && m('./docs/**', 'docs/x.md'), '? and a leading ./');

// Agents from commits
ok(R.agentOf({ authorName: 'Abi', authorEmail: 'abi@x.com', body: 'fix: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' }) === 'claude-code', 'Claude Code commit (trailer)');
ok(R.agentOf({ authorName: 'Copilot', authorEmail: '198982749+Copilot@users.noreply.github.com', body: 'Initial plan' }) === 'copilot', 'Copilot agent commit (author)');
ok(R.agentOf({ authorName: 'Abi', authorEmail: 'abi@x.com', body: 'x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>' }) === 'cursor', 'Cursor agent commit');
ok(R.agentOf({ authorName: 'devin-ai-integration[bot]', authorEmail: '158243242+devin-ai-integration[bot]@users.noreply.github.com', body: '' }) === 'devin', 'Devin commit');
ok(R.agentOf({ authorName: 'Abi', authorEmail: 'abi@x.com', body: 'docs: how we use Claude and Cursor' }) === null, 'a person writing about AI is still a person');

// Pre-edit levels
const cfg = { team: [], rules: [
  { name: 'billing', paths: ['src/billing/**'], ai: 'block', approval: 'lead', reason: 'Money moves here.' },
  { name: 'migrations', paths: ['db/**'], agents: ['cursor'], ai: 'ask' },
  { name: 'docs', paths: ['docs/**'], ai: 'allow' },
] };
ok(R.editRule(cfg, 'src/billing/pay.ts', 'claude-code').level === 'block' && /Money moves here/.test(R.editRule(cfg, 'src/billing/pay.ts', 'cursor').message), 'block for every agent, with the reason');
ok(R.editRule(cfg, 'db/001.sql', 'cursor').level === 'ask' && R.editRule(cfg, 'db/001.sql', 'claude-code') === null, 'agent-specific rule applies only to that agent');
ok(R.editRule(cfg, 'docs/a.md', 'cursor') === null && R.editRule(cfg, 'src/app.ts', 'cursor') === null, 'allow and unmatched: nothing');

// A repo
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-rules-'));
const repo = path.join(tmp, 'shop');
fs.mkdirSync(repo);
const env = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_EVENT_PATH: '', GITLAB_CI: '', BITBUCKET_PR_ID: '' };
const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' }).trim();
const fx = (args, extra = {}, input) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', input });
const w = (rel, t) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), t); };
try {
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'abi@x.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
  w('src/billing/pay.js', 'module.exports = (a) => a;\n'); w('src/auth/login.js', 'module.exports = 1;\n'); w('src/app.js', 'x\n');
  git('add', '.'); git('commit', '-qm', 'init');
  fx(['init', '--yes', '--no-git-hooks']);
  const cf = path.join(repo, '.fixlock', 'config.json');
  const c = JSON.parse(fs.readFileSync(cf, 'utf8'));
  c.team.push({ name: 'Lead', github: 'lead', emails: ['lead@x.com'], role: 'lead' }, { name: 'Sec', github: 'sec', emails: [], role: 'reviewer' });
  c.team.find((x) => x.github === 'abi').role = 'developer';
  c.rules = [
    { name: 'billing', paths: ['src/billing/**'], ai: 'block', approval: 'lead', reason: 'Money moves here.' },
    { name: 'auth', paths: ['src/auth/**'], ai: 'ask', approval: 'approvers', approvers: ['sec'], aiOnly: true },
  ];
  fs.writeFileSync(cf, JSON.stringify(c, null, 2));
  git('add', '.'); git('commit', '-qm', 'chore: fixlock rules');

  // Pre-edit: Claude Code hook
  let r = fx(['hook', 'claude'], {}, JSON.stringify({ tool_name: 'Edit', cwd: repo, tool_input: { file_path: path.join(repo, 'src/billing/pay.js'), old_string: 'a;', new_string: 'a * 2;' } }));
  let out = JSON.parse(r.stdout || '{}');
  ok(out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision === 'deny' && /Rule "billing"/.test(out.hookSpecificOutput.permissionDecisionReason) && /Money moves here/.test(out.hookSpecificOutput.permissionDecisionReason), 'Claude Code: an edit under a "block" rule is denied, with the rule and why', r.stdout);
  r = fx(['hook', 'claude'], {}, JSON.stringify({ tool_name: 'Edit', cwd: repo, tool_input: { file_path: path.join(repo, 'src/auth/login.js'), old_string: '1;', new_string: '2;' } }));
  out = JSON.parse(r.stdout || '{}');
  ok(out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision === 'ask', 'Claude Code: "ask" rule asks the developer (native prompt)', r.stdout);
  r = fx(['hook', 'claude'], {}, JSON.stringify({ tool_name: 'Edit', cwd: repo, tool_input: { file_path: path.join(repo, 'src/app.js'), old_string: 'x', new_string: 'y' } }));
  ok(!r.stdout, 'Claude Code: files no rule covers: nothing to say');

  // Pre-edit: Cursor hook, with fixlock allow for "ask" rules
  const cur = (file) => JSON.parse(fx(['hook', 'cursor'], {}, JSON.stringify({ hook_event_name: 'preToolUse', workspace_roots: [repo], tool_name: 'Edit', tool_input: { file_path: path.join(repo, file), old_string: 'module', new_string: 'module' + ' ' } })).stdout);
  ok(cur('src/billing/pay.js').permission === 'deny' && /keeps AI out/.test(cur('src/billing/pay.js').user_message), 'Cursor: "block" rule denies');
  ok(cur('src/auth/login.js').permission === 'deny' && /fixlock allow "rule:auth"/.test(cur('src/auth/login.js').user_message), 'Cursor: "ask" rule denies and says how to allow it');
  r = fx(['allow', 'rule:auth']);
  ok(r.status === 0 && cur('src/auth/login.js').permission === 'allow', 'fixlock allow "rule:auth" lets the agent through', r.stdout + r.stderr);
  r = fx(['allow', 'rule:nope']);
  ok(r.status !== 0 && /No rule "nope"/.test(r.stderr), 'allow refuses an unknown rule');
  fx(['allow', '--clear']);
  ok(cur('src/billing/pay.js').permission === 'deny', 'allow cannot open a "block" rule');

  // CI: a person changes billing → a lead must approve
  git('checkout', '-qb', 'billing');
  w('src/billing/pay.js', 'module.exports = (a) => a * 100;\n');
  git('commit', '-qam', 'feat: cents');
  r = fx(['check', '--base', 'main', '--markdown', path.join(tmp, 'b.md')]);
  ok(r.status === 1 && /RULE\s+src\/billing\/pay\.js changed under rule "billing"/.test(r.stdout) && /needs approval from @lead/.test(r.stdout), 'check: a change under a rule needs a lead', r.stdout);
  ok(/Needs approval: rule "billing"/.test(fs.readFileSync(path.join(tmp, 'b.md'), 'utf8')) && /Why: Money moves here/.test(fs.readFileSync(path.join(tmp, 'b.md'), 'utf8')), 'PR comment explains the rule');
  r = fx(['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: 'lead' });
  ok(r.status === 0 && /APPROVED\s+src\/billing/.test(r.stdout), 'approved by the lead: passes', r.stdout);
  r = fx(['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: 'sec' });
  ok(r.status === 1, "a reviewer who isn't a lead or a listed approver doesn't count");

  // CI: aiOnly rule: a person's change to auth passes; a Claude-written change needs the listed approver
  git('checkout', '-q', 'main'); git('checkout', '-qb', 'auth-human');
  w('src/auth/login.js', 'module.exports = 2;\n');
  git('commit', '-qam', 'fix: login');
  r = fx(['check', '--base', 'main']);
  ok(r.status === 0 && !/auth/.test(r.stdout), 'aiOnly rule: a person\'s change passes', r.stdout);
  git('checkout', '-q', 'main'); git('checkout', '-qb', 'auth-ai');
  w('src/auth/login.js', 'module.exports = 3;\n');
  git('commit', '-qam', 'fix: login\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>');
  r = fx(['check', '--base', 'main']);
  ok(r.status === 1 && /changed under rule "auth" by AI \(claude-code\)/.test(r.stdout) && /needs approval from @sec/.test(r.stdout) && !/@lead/.test(r.stdout.split('rule "auth"')[1] || ''), 'aiOnly rule: an AI-written change needs the rule\'s approver (not the leads)', r.stdout);
  r = fx(['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: 'sec' });
  ok(r.status === 0, 'approved by the listed approver: passes');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`RULES PASS (${passed} checks)`);
