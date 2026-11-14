#!/usr/bin/env node
// Structural matching: unit tests for the tokenizer/matcher, then a real `fixlock check` in a throwaway
// repo showing that reformatting passes, a rename warns, and a logic change still blocks.
'use strict';
const cleanEnv = require('./env');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../src/structural');
const L = require('../src/locks');

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures++; console.log(`FAIL ${msg}\n${extra}`); }
};

/* ---------------- unit ---------------- */
const SNIP = ['  if (!user || user.role !== "admin") {', '    return res.status(403).json({ error: "forbidden" });'];
const ORIG = 'function guard(user, res) {\n' + SNIP.join('\n') + '\n  }\n}\n';
const v = (content, file = 'src/guard.ts', snip = SNIP) => S.verify(snip, content, file);

ok(v(ORIG).status === 'intact', 'unchanged code is intact');
ok(v(ORIG).lines.join('-') === '2-3', 'reports where the lock sits', JSON.stringify(v(ORIG)));
ok(v("function guard(user, res) {\n  if (!user || user.role !== 'admin')\n  {\n    return res\n      .status(403)\n      .json({ error: 'forbidden', });\n  }\n}\n").status === 'intact',
  'reformatted (line wrapping, quotes, trailing comma) is intact');
ok(v('function guard(user, res) {\n  // only admins\n  if (!user /* anon */ || user.role !== "admin") { // check\n    return res.status(403).json({ error: "forbidden" })\n  }\n}\n').status === 'intact',
  'added comments and a dropped semicolon are intact');
ok(v('function g(u, r) { if (!user || user.role !== "admin") { return res.status(403).json({ error: "forbidden" }); } }').status === 'intact',
  'collapsed onto one line is intact');

const ren = v('function guard(account, reply) {\n  if (!account || account.role !== "admin") {\n    return reply.status(403).json({ error: "forbidden" });\n  }\n}\n');
ok(ren.status === 'renamed' && ren.renames.some(([a, b]) => a === 'user' && b === 'account') && ren.renames.some(([a, b]) => a === 'res' && b === 'reply'),
  'consistent variable rename → renamed, with the mapping', JSON.stringify(ren));

ok(v(ORIG.replace('user.role', 'user.type')).status === 'changed', 'renaming a field (user.role → user.type) is a change');
ok(v(ORIG.replace('error:', 'message:')).status === 'changed', 'renaming an object key is a change');
ok(v(ORIG.replace('!==', '===')).status === 'changed', 'flipped comparison is a change');
ok(v(ORIG.replace('403', '401')).status === 'changed', 'changed status code is a change');
ok(v(ORIG.replace('!user || ', '')).status === 'changed', 'dropped null check is a change');
ok(v(ORIG.replace('"admin"', '"Admin"')).status === 'changed', 'changed string literal is a change');
ok(v('function guard() { return next(); }').status === 'changed', 'removed code is a change');
ok(v('if (!user || user.role !== "admin") {\n  return res.status(403).json({ error: "forbidden" });\n}').status === 'intact', 'code moved elsewhere in the file is intact');
ok(v('if (!a || b.role !== "admin") {\n  return res.status(403).json({ error: "forbidden" });\n}').status === 'changed',
  'two different variables where there was one is a change, not a rename');

// Python (hash comments, triple-quoted strings)
const PY = ['    if amount <= 0:', '        raise ValueError("amount must be positive")'];
ok(S.verify(PY, "def pay(amount):\n    # validate first\n    if amount <= 0:  # guard\n        raise ValueError('amount must be positive')\n", 'pay.py').status === 'intact', 'python: comments + quote style are intact');
ok(S.verify(PY, 'def pay(amount):\n    if amount < 0:\n        raise ValueError("amount must be positive")\n', 'pay.py').status === 'changed', 'python: <= → < is a change');
ok(S.verify(['x = "# not a comment"'], 'x = "# not a comment"\n', 'a.py').status === 'intact', 'python: # inside a string is not a comment');

// Java / Go use the same family
ok(S.verify(['if (order.getTotal() > LIMIT) {', 'throw new LimitException(order);'],
  'class A { void f(Order order) {\n  if (order.getTotal() > LIMIT)\n    { throw new LimitException(order); }\n} }', 'A.java').status === 'intact', 'java: reformat is intact');
ok(S.verify(['if err != nil {', 'return fmt.Errorf("load: %w", err)'],
  'func f() error {\n\tif err != nil {\n\t\treturn fmt.Errorf("load: %w", err)\n\t}\n}', 'f.go').status === 'intact', 'go: tabs vs spaces is intact');

// Unsupported languages fall back to text
ok(S.verify(['x'], 'x', 'README.md').status === 'unsupported', 'unknown file type → unsupported (text fallback)');
const mdLock = { file: 'notes.md', snippet: ['Do not ship on Fridays'] };
ok(L.verifyLock(mdLock, '# Notes\nDo not  ship on Fridays\n').status === 'intact' && L.verifyLock(mdLock, '# Notes\n').status === 'changed', 'text fallback still works for unsupported files');
ok(L.verifyLock({ file: 'a.ts', snippet: SNIP }, 'if (!user || user.role !== \'admin\') {\n return res.status(403).json({ error: \'forbidden\' })\n}', { mode: 'text' }).status === 'changed',
  'matching.mode "text" keeps the old behaviour');
ok(L.verifyLock({ file: 'a.ts', snippet: SNIP }, null).status === 'changed', 'deleted file is a change');

// locate() finds reformatted locks (used by `why` and the MCP server)
ok(L.locate({ file: 'a.ts', snippet: SNIP }, "x()\nif (!user ||\n    user.role !== 'admin') {\n  return res.status(403).json({ error: 'forbidden' })\n}".split('\n')).join(',') === '2,3,4', 'locate() follows reformatted code');

/* ---------------- CLI: fixlock check in a real repo ---------------- */
const CLI = path.join(__dirname, '..', 'bin', 'fixlock.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-structural-'));
const app = path.join(tmp, 'app');
const FILE = 'src/guard.ts';
const git = (...a) => execFileSync('git', a, { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (body) => { fs.mkdirSync(path.join(app, 'src'), { recursive: true }); fs.writeFileSync(path.join(app, FILE), body); };
const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: app, encoding: 'utf8', env: { ...cleanEnv(), NO_COLOR: '1' } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const check = () => cli('check', '--base', 'main', '--json');
const parse = (r) => { try { return JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { return { findings: [], raw: r.out }; } };

try {
  execFileSync('git', ['init', '-q', '-b', 'main', app]);
  git('config', 'user.email', 'abi@example.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
  write(ORIG);
  git('add', '.'); git('commit', '-qm', 'init');
  const init = cli('init', '--yes');
  ok(init.code === 0, 'init', init.out);
  const cfgFile = path.join(app, '.fixlock', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.team = [{ name: 'Abi', github: 'abinandhmj', emails: ['abi@example.com'], role: 'lead' }];
  cfg.stableCode = { enabled: false };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  const mark = cli('mark', FILE, '2-3', '-m', 'only admins may reach this endpoint', '--title', 'admin guard');
  ok(mark.code === 0, 'lock the guard', mark.out);
  git('add', '-A'); git('commit', '-qm', 'fix: admin guard');
  git('checkout', '-q', '-b', 'feature');

  write("function guard(user, res) {\n  if (!user || user.role !== 'admin')\n  {\n    return res\n      .status(403)\n      .json({ error: 'forbidden', });\n  }\n}\n");
  let r = check();
  ok(r.code === 0 && parse(r).findings.length === 0, 'check: a reformatted lock is clean', r.out);

  write(ORIG.replace(/user/g, 'account'));
  r = check();
  const f = parse(r).findings[0] || {};
  ok(r.code === 0 && f.status === 'warn' && f.renamed && f.renamed[0][0] === 'user', 'check: a renamed lock warns but does not block', r.out);

  cfg.matching = { renames: 'block' };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  r = check();
  ok(r.code === 1 && (parse(r).findings[0] || {}).status === 'blocked', 'check: matching.renames "block" makes renames need approval', r.out);
  cfg.matching = { renames: 'warn' };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

  write(ORIG.replace('!==', '==='));
  r = check();
  ok(r.code === 1 && (parse(r).findings[0] || {}).status === 'blocked', 'check: a real logic change still blocks', r.out);

  // AI pre-edit hook (Claude Code) sees the same thing
  const hook = (after) => {
    const input = JSON.stringify({ tool_name: 'Write', cwd: app, tool_input: { file_path: path.join(app, FILE), content: after } });
    const h = spawnSync(process.execPath, [CLI, 'hook', 'claude'], { cwd: app, input, encoding: 'utf8', env: { ...cleanEnv(), NO_COLOR: '1', GIT_AUTHOR_EMAIL: 'dev2@example.com', GIT_COMMITTER_EMAIL: 'dev2@example.com' } });
    return h.stdout || '';
  };
  git('config', 'user.email', 'dev2@example.com'); // not the owner, so the policy applies
  write(ORIG);
  ok(!/removes\/rewrites/.test(hook("function guard(user, res) {\n  if (!user || user.role !== 'admin') { return res.status(403).json({ error: 'forbidden' }) }\n}\n")), 'hook: reformatting is not reported as a rewrite');
  ok(/permissionDecision/.test(hook(ORIG.replace('403', '200'))), 'hook: a logic change asks/blocks');
  ok(/renames inside the locked code/.test(hook(ORIG.replace(/res\b/g, 'reply'))), 'hook: a rename is explained as a rename');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : '\nSTRUCTURAL PASS');
process.exit(failures ? 1 : 0);
