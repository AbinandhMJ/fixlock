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
  for (const c of ['npx prettier --check .', 'npx eslint --fix', 'echo fixlock'])
    ok(!cli.isOurs(c), `not fixlock's: ${c}`);

  // init in a Python repo: every generated file uses the scoped command
  const py = repo('py', { 'app.py': 'def f(x):\n    if x is None:\n        return 0\n    return x\n' });
  const run = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'fixlock.js'), ...args], { cwd: py, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@b.c', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@b.c' } });
  const out = run('init', '--yes');
  ok(/Nothing to install/.test(out) && !/npm i -D/.test(out), 'init in a Python repo: no "npm i -D" instruction', out);
  const scoped = `npx -y @abinandhmj/fixlock@${pin}`;
  const settingsFile = path.join(py, '.claude', 'settings.json');
  const hooks = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8')).hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command));
  ok(hooks().includes(`${scoped} hook claude`), 'Claude Code hook uses the scoped command', hooks().join('\n'));
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
