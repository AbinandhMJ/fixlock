#!/usr/bin/env node
// How fixlock is launched from the files it writes: the repo's own install in JS projects, the scoped
// npm package (pinned) everywhere else, never the bare name "fixlock". Re-installing hooks replaces
// fixlock's old entries and keeps other tools' hooks.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cli = require('../src/cli');

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures++; console.log(`FAIL ${msg}\n${extra}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-cli-'));
const repo = (name, files = {}) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  return fs.realpathSync(dir);
};

try {
  const pin = cli.pin();
  ok(cli.pin('0.6.3') === '0.6' && cli.pin('1.4.0') === '1' && cli.pin('12.0.1') === '12', 'pin: 0.x → minor, 1+ → major');

  const goRepo = repo('go', { 'go.mod': 'module x\n' });
  ok(cli.command(goRepo) === `npx -y @abinandhmj/fixlock@${pin}`, 'Go repo (no package.json): scoped npx, pinned', cli.command(goRepo));
  ok(cli.human(goRepo) === 'npx @abinandhmj/fixlock', 'Go repo: people are told the scoped name');

  const jsOther = repo('js-other', { 'package.json': JSON.stringify({ devDependencies: { prettier: '3' } }) });
  ok(cli.command(jsOther) === `npx -y @abinandhmj/fixlock@${pin}`, 'JS repo without fixlock installed: scoped npx too');

  const jsRepo = repo('js', { 'package.json': JSON.stringify({ devDependencies: { '@abinandhmj/fixlock': '^0.6.0' } }) });
  ok(cli.command(jsRepo) === 'npx --no-install fixlock' && cli.human(jsRepo) === 'npx fixlock', 'JS repo that installs fixlock: the local copy');

  for (const c of ['npx --no-install fixlock hook claude', 'npx -y @abinandhmj/fixlock hook claude', 'npx -y @abinandhmj/fixlock@0.5 hook claude', 'npx fixlock check --staged || true'])
    ok(cli.isOurs(c), `recognised as fixlock's: ${c}`);
  for (const c of ['fixlock hook claude', '/home/a/.local/bin/fixlock check --staged || true', 'C:\\tools\\fixlock.exe hook claude'])
    ok(cli.isOurs(c), `recognised as fixlock's (native command): ${c}`);
  for (const c of ['npx prettier --check .', 'npx eslint --fix', 'echo fixlock', 'fixlockx hook claude'])
    ok(!cli.isOurs(c), `not fixlock's: ${c}`);

  // the native command (pip / pipx / uv): recorded as "launcher", or FIXLOCK_LAUNCHER on one machine
  const nat = repo('native', { '.fixlock/config.json': JSON.stringify({ launcher: 'fixlock' }), 'package.json': '{}' });
  ok(cli.command(nat) === 'fixlock' && cli.human(nat) === 'fixlock', 'launcher "fixlock": hooks and messages use the native command');
  process.env.FIXLOCK_LAUNCHER = 'fixlock';
  ok(cli.command(goRepo) === 'fixlock', 'FIXLOCK_LAUNCHER=fixlock overrides on one machine');
  delete process.env.FIXLOCK_LAUNCHER;
  ok(cli.defaultLauncher(goRepo) === null, 'init from Node (npx) records no launcher');

  // init in a Python repo: every generated file uses the scoped command
  const py = repo('py', { 'app.py': 'def f(x):\n    if x is None:\n        return 0\n    return x\n' });
  const identity = (dir) => { execFileSync('git', ['-C', dir, 'config', 'user.email', 'a@b.c']); execFileSync('git', ['-C', dir, 'config', 'user.name', 'A']); }; // CI runners have none
  identity(py);
  const run = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'fixlock.js'), ...args], { cwd: py, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: '', GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@b.c', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@b.c' } });
  const out = run('init', '--yes');
  ok(/Nothing to install/.test(out) && !/npm i -D/.test(out), 'init in a Python repo: no "npm i -D" instruction', out);
  const scoped = `npx -y @abinandhmj/fixlock@${pin}`;
  const settingsFile = path.join(py, '.claude', 'settings.json');
  const hooks = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8')).hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command));
  ok(hooks().includes(`${scoped} hook claude`), 'Claude Code hook uses the scoped command', hooks().join('\n'));
  const gitHook = (n) => { try { return fs.readFileSync(path.join(py, '.git', 'hooks', n), 'utf8'); } catch { return ''; } };
  ok(gitHook('pre-commit').includes(`${scoped} check --staged`) && gitHook('post-commit').includes(`${scoped} autolock`), 'init --yes installs the git hooks (commit warning + auto-lock), like the interactive default');
  ok(/No GitHub username for A\b/.test(out) && /team add --name "A" --github <username> --email a@b\.c --role lead/.test(out), 'init --yes without a GitHub username says how to add it', out);

  // init --yes with the GitHub CLI logged in: the lead gets their username; --no-git-hooks skips hooks
  const py2 = repo('py2', { 'app.py': 'x = 1\n' });
  identity(py2);
  const out2 = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'fixlock.js'), 'init', '--yes', '--no-git-hooks'], { cwd: py2, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'octocat', GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@b.c', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@b.c' } });
  const team2 = JSON.parse(fs.readFileSync(path.join(py2, '.fixlock', 'config.json'), 'utf8')).team;
  ok(team2[0].github === 'octocat' && !/No GitHub username/.test(out2), 'init --yes takes the GitHub username from the GitHub CLI', JSON.stringify(team2));
  ok(!fs.existsSync(path.join(py2, '.git', 'hooks', 'pre-commit')), '--no-git-hooks: no git hooks');
  const mcp = JSON.parse(fs.readFileSync(path.join(py, '.mcp.json'), 'utf8'));
  ok(JSON.stringify(mcp).includes(`@abinandhmj/fixlock@${pin}`), 'MCP config uses the scoped command', JSON.stringify(mcp));
  const rules = fs.readFileSync(path.join(py, 'CLAUDE.md'), 'utf8');
  ok(rules.includes(`${scoped} why`) && !/`npx fixlock /.test(rules), 'AI rules never tell the assistant to run the bare `npx fixlock`', rules.slice(0, 600));

  // an older hook entry is replaced, other tools' hooks are kept
  const st = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  st.hooks.PreToolUse.push({ matcher: 'Edit', hooks: [{ type: 'command', command: 'npx --no-install fixlock hook claude' }] });
  st.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'npx prettier --check .' }] });
  fs.writeFileSync(settingsFile, JSON.stringify(st));
  run('install-claude-hook');
  const after = hooks();
  ok(after.filter((c) => / hook claude$/.test(c)).length === 1 && after.includes(`${scoped} hook claude`), 'reinstall: one fixlock hook, the current one', after.join('\n'));
  ok(after.includes('npx prettier --check .'), 'reinstall: other tools\' hooks are kept');

  run('install-hook');
  const pre = fs.readFileSync(path.join(py, '.git', 'hooks', 'pre-commit'), 'utf8');
  ok(pre.includes(`${scoped} check --staged`), 'git pre-commit hook uses the scoped command', pre);
  // quickstart: one command, no questions, in a GitHub repo with a past fix
  const qs = path.join(tmp, 'qs');
  fs.mkdirSync(qs);
  const genv = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', GIT_AUTHOR_NAME: 'Abi', GIT_AUTHOR_EMAIL: 'abi@x.com', GIT_COMMITTER_NAME: 'Abi', GIT_COMMITTER_EMAIL: 'abi@x.com' };
  const gq = (...a) => execFileSync('git', a, { cwd: qs, env: genv, encoding: 'utf8' });
  gq('init', '-q'); gq('config', 'user.email', 'abi@x.com'); gq('config', 'user.name', 'Abi'); gq('remote', 'add', 'origin', 'git@github.com:acme/shop.git');
  fs.writeFileSync(path.join(qs, 'pay.py'), 'def pay(amount):\n    return charge(amount)\n');
  gq('add', '.'); gq('commit', '-qm', 'init');
  fs.writeFileSync(path.join(qs, 'pay.py'), 'def pay(amount):\n    if amount <= 0:\n        raise ValueError("amount must be positive")\n    return charge(amount)\n');
  fs.mkdirSync(path.join(qs, 'tests')); fs.writeFileSync(path.join(qs, 'tests', 'test_pay.py'), 'def test_zero():\n    pass\n');
  gq('add', '.'); gq('commit', '-qm', 'fix: zero charge crashed the ledger (#12)');
  const qrun = (...a) => execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'fixlock.js'), ...a], { cwd: qs, encoding: 'utf8', env: genv });
  const qout = qrun('quickstart');
  const qreg = JSON.parse(fs.readFileSync(path.join(qs, '.fixlock', 'registry.json'), 'utf8'));
  ok(qreg.locks.length === 1 && qreg.locks[0].file === 'pay.py', 'quickstart locks the past fix it is sure about', qout);
  ok(JSON.parse(fs.readFileSync(path.join(qs, '.fixlock', 'config.json'), 'utf8')).team[0].github === 'abi', 'quickstart: lead with GitHub username');
  const wf = fs.readFileSync(path.join(qs, '.github', 'workflows', 'fixlock.yml'), 'utf8');
  ok(wf.includes(`AbinandhMJ/fixlock@v${require('../package.json').version}`) && /pull_request_review/.test(wf), 'quickstart adds the PR check workflow, pinned to this version', wf);
  ok(fs.existsSync(path.join(qs, '.git', 'hooks', 'pre-commit')) && fs.existsSync(path.join(qs, 'CLAUDE.md')) && fs.existsSync(path.join(qs, '.claude', 'settings.json')), 'quickstart: git hooks, AI rules and the Claude Code hook');
  ok(/fixlock is set up/.test(qout) && /git add -A && git commit/.test(qout) && !/synced/.test(qout), 'quickstart prints one summary ending with the commit command', qout);
  const qout2 = qrun('quickstart');
  ok(/Already set up/.test(qout2) && /a workflow already runs fixlock/.test(qout2) && JSON.parse(fs.readFileSync(path.join(qs, '.fixlock', 'registry.json'), 'utf8')).locks.length === 1, 'quickstart again: keeps the config, adds no duplicate lock or workflow', qout2);
  // A repo set up by the GitHub App: quickstart adds hooks and AI rules, but no workflow (the App checks PRs)
  const app = path.join(tmp, 'app');
  fs.mkdirSync(path.join(app, '.fixlock'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: app }); execFileSync('git', ['-C', app, 'remote', 'add', 'origin', 'https://github.com/acme/app.git']);
  fs.writeFileSync(path.join(app, '.fixlock', 'config.json'), JSON.stringify({ project: 'app', team: [{ name: 'Abi', github: 'abi', emails: ['abi@x.com'], role: 'lead' }], prCheck: 'github-app' }));
  fs.writeFileSync(path.join(app, '.fixlock', 'registry.json'), JSON.stringify({ version: 2, locks: [] }));
  const aout = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'fixlock.js'), 'quickstart'], { cwd: app, encoding: 'utf8', env: genv });
  ok(/PR check: the fixlock GitHub App/.test(aout) && !fs.existsSync(path.join(app, '.github', 'workflows', 'fixlock.yml')), 'quickstart in a repo the GitHub App set up: no extra workflow', aout);
  ok(fs.existsSync(path.join(app, '.git', 'hooks', 'pre-commit')) && fs.existsSync(path.join(app, 'CLAUDE.md')) && JSON.parse(fs.readFileSync(path.join(app, '.fixlock', 'config.json'), 'utf8')).team.length === 1, 'quickstart in an existing setup: keeps the team, installs hooks and AI rules');
  let notGit = '';
  try { execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'fixlock.js'), 'quickstart'], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-')), encoding: 'utf8', stdio: 'pipe', env: genv }); } catch (e) { notGit = String(e.stderr); }
  ok(/inside a git repository/.test(notGit), 'quickstart outside git: says to git init', notGit);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : '\nCLI PASS');
process.exit(failures ? 1 : 0);
