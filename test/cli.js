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
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : '\nCLI PASS');
process.exit(failures ? 1 : 0);
