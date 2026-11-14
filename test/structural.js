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

// Found by the accuracy benchmark (bench/run.js):
// 1. an unterminated quote (here inside a regex literal) must not shift the line numbers after it
ok(S.verify(['if (a) {', 'b();'], "const re = /[\\'\"]/g;\nx();\n\nif (a) {\n b();\n}", 'a.js').lines.join('-') === '4-5', 'line numbers stay right after a quote inside a regex');
// 2. renames must be believable: old names gone nearby, snippet long enough to be distinctive
const OPTS = ['  var opts = options || {};'];
ok(S.verify(OPTS, 'function f(options) {\n  var opts = options && {};\n  var view = this.cache || {};\n}', 'a.js').status === 'changed', 'swapped || is not excused as a "rename" of some other line');
ok(S.verify(['  var len;'], 'function f() {\n  var size;\n}', 'a.js').status === 'changed', 'a tiny snippet is never matched by renaming');
ok(S.verify(['const m = /;\\s*charset=(?:"([^"]+)"|([^;,]+))/i.exec(t);', 'x();'], 'const m = /;\\s*charset=(?:"([^"]+)"|([^;,]+))/i.exec(t)\nx()', 'a.ts').status === 'intact', 'quotes inside a regex literal are not strings');
ok(S.verify(['    fn(null, null)'], 'if (!user) return fn(null, null)\nx()\nif (ok) {\n    fn(null, null)\n}', 'a.js').lines.join('-') === '4-4', 'prefers the match on its own line over the same tokens inside another line');
ok(S.verify(['this.#cache.clear();'], 'this.#store.clear()', 'a.ts').status === 'changed', 'renaming a private field (#cache → #store) is a change');
ok(S.verify(['const r = a / b / c;'], 'const r = a / b / c', 'a.ts').status === 'intact' && S.verify(['const r = a / b / c;'], 'const r = a / b * c', 'a.ts').status === 'changed', 'division is not mistaken for a regex');
ok(S.verify(['type A = Promise<Uint8Array<ArrayBuffer>>;'], 'type A = Promise<\n  Uint8Array<ArrayBuffer>\n>', 'a.ts').status === 'intact', 'nested generics split by a formatter are intact');
const SWAP = ['  if (!isAdmin || role !== "admin") {', '    return deny(403);'];
ok(S.verify(SWAP, 'function f(isAdmin, isGuest, role) {\n  log(isAdmin);\n  if (!isGuest || role !== "admin") {\n    return deny(403);\n  }\n}', 'a.js').status === 'changed', 'isAdmin → isGuest while isAdmin is still used nearby is a change, not a rename');
ok(S.verify(SWAP, 'function f(admin, role) {\n  if (!admin || role !== "admin") {\n    return deny(403);\n  }\n}', 'a.js').status === 'renamed', 'a real rename (old name gone) is still a rename');
// 3. duplicate code: removing the locked copy is caught even when an identical copy remains
const DUP = 'function a(fn) {\n  if (!user) return fn(null, null)\n}\nfunction b(fn) {\n  if (!user) return fn(null, null)\n}\n';
const dupLock = L.withCopies({ file: 'a.js', snippet: ['  if (!user) return fn(null, null)'] }, DUP);
ok(dupLock.copies === 2, 'withCopies records identical copies');
ok(L.verifyLock(dupLock, DUP).status === 'intact', 'both copies there: intact');
const oneLeft = L.verifyLock(dupLock, DUP.replace('  if (!user) return fn(null, null)\n}\nfunction b', '  return fn(null, null)\n}\nfunction b'));
ok(oneLeft.status === 'changed' && oneLeft.copies && oneLeft.copies.found === 1, 'one copy changed: caught, with the copy count', JSON.stringify(oneLeft));
ok(L.withCopies({ file: 'a.js', snippet: ['  if (!user) return fn(null, null)'] }, 'if (!user) return fn(null, null)').copies === undefined, 'single copy: no copies field');

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
