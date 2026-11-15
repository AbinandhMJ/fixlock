#!/usr/bin/env node
// fixlock accuracy benchmark.
//
// For each repo in corpus.json (pinned to a commit): lock its real past fixes with `fixlock discover`,
// then edit each lock's code in ways that keep or change what it does, and ask both matchers
// (text, structural) whether the lock is still intact.
//
//   false positive  = a benign edit (formatter, comments, wrapping, quotes…) reported as a change
//   detection       = a harmful edit (flipped condition, changed value, deleted line…) reported as a change
//
// Usage: node bench/run.js [--repos express,ky] [--locks 80] [--no-formatters]
// Writes bench/results.json and docs/benchmark.md. Needs git and network for the first clone.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const L = require('../src/locks');
const S = require('../src/structural');
const M = require('./mutations');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const CLI = path.join(ROOT, 'bin', 'fixlock.js');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'))
  .filter((r) => !opt('repos') || opt('repos').split(',').includes(r.name));
const MAX_LOCKS = +opt('locks', 80);
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' };

/* ---------------- corpus ---------------- */
const { checkout, discoverLocks } = require('./corpus');

/* ---------------- formatters ---------------- */
const have = (cmd) => spawnSync(cmd, cmd === 'gofmt' ? ['-l'] : ['--version'], { encoding: 'utf8', input: '' }).status === 0;
const FORMATTERS = [];
if (!flag('no-formatters')) {
  const prettier = have('prettier') ? ['prettier'] : ['npx', '--yes', 'prettier@3'];
  const runPrettier = (extra) => (text, file) => {
    const p = spawnSync(prettier[0], [...prettier.slice(1), '--stdin-filepath', file, ...extra], { input: text, encoding: 'utf8', maxBuffer: 64 << 20 });
    return p.status === 0 ? p.stdout : null;
  };
  const js = /\.(m?[jt]sx?|cjs|cts|mts)$/;
  FORMATTERS.push({ name: 'prettier (narrow, single quotes, no semicolons)', applies: (f) => js.test(f), run: runPrettier(['--print-width', '40', '--single-quote', '--no-semi', '--tab-width', '4', '--trailing-comma', 'all']) });
  FORMATTERS.push({ name: 'prettier (wide, double quotes)', applies: (f) => js.test(f), run: runPrettier(['--print-width', '120', '--trailing-comma', 'none', '--arrow-parens', 'avoid']) });
  if (have('black')) {
    const runBlack = (len) => (text) => { const p = spawnSync('black', ['-q', '-l', String(len), '--skip-magic-trailing-comma', '-'], { input: text, encoding: 'utf8' }); return p.status === 0 ? p.stdout : null; };
    FORMATTERS.push({ name: 'black (line length 40)', applies: (f) => f.endsWith('.py'), run: runBlack(40) });
    FORMATTERS.push({ name: 'black (line length 120)', applies: (f) => f.endsWith('.py'), run: runBlack(120) });
  }
  if (have('gofmt')) {
    // gofmt re-indents with tabs and re-aligns; run it on code first re-indented with spaces
    FORMATTERS.push({ name: 'gofmt (after re-indenting with spaces)', applies: (f) => f.endsWith('.go'), run: (text) => {
      const p = spawnSync('gofmt', [], { input: text.replace(/^\t+/gm, (t) => '  '.repeat(t.length)), encoding: 'utf8' });
      return p.status === 0 ? p.stdout : null;
    } });
  }
}

/* ---------------- run ---------------- */
const engines = ['text', 'structural'];
function judge(lock, content, file) {
  const r = {};
  for (const mode of engines) r[mode] = L.verifyLock(lock, content, { mode, file }).status;
  return r;
}

const rows = new Map(); // key: kind|name -> { kind, name, n, text: {changed, renamed}, structural: {...}, langs:Set, examples: [] }
function record(kind, name, verdict, ex) {
  const key = `${kind}|${name}`;
  if (!rows.has(key)) rows.set(key, { kind, name, n: 0, langs: new Set(), text: { changed: 0, renamed: 0 }, structural: { changed: 0, renamed: 0 }, misses: [] });
  const row = rows.get(key);
  row.n++; row.langs.add(ex.lang);
  for (const mode of engines) if (verdict[mode] !== 'intact') row[mode][verdict[mode]]++;
  const wrong = kind === 'harmful' ? verdict.structural !== 'changed' : verdict.structural === 'changed';
  if (wrong && row.misses.length < 8) row.misses.push({ repo: ex.repo, file: ex.file, lines: ex.lines, verdict: verdict.structural, before: ex.before, after: ex.after });
}

const repos = [];
const t0 = Date.now();
for (const r of corpus) {
  process.stderr.write(`${r.name}\n`);
  const dir = checkout(r);
  const found = discoverLocks(dir, r);
  let used = 0; const skipped = { language: 0, locate: 0, baseline: 0 };
  const fmtCache = new Map();
  for (const f of found) {
    if (used >= MAX_LOCKS) break;
    const fam = S.family(f.file);
    if (!fam) { skipped.language++; continue; }
    const content = fs.readFileSync(path.join(dir, f.file), 'utf8').replace(/\r\n/g, '\n');
    const lock = L.withCopies({ file: f.file, snippet: f.snippet }, content); // as fixlock records it
    const lines = content.split('\n');
    const at = L.locate(lock, lines);
    if (at.length < f.snippet.length) { skipped.locate++; continue; }
    const base = judge(lock, content, f.file);
    if (base.text !== 'intact' || base.structural !== 'intact') { skipped.baseline++; continue; }
    used++;
    const range = [Math.min(...at) - 1, Math.max(...at) - 1];
    const ex = (after) => ({ repo: r.name, lang: r.lang, file: f.file, lines: [range[0] + 1, range[1] + 1], before: f.snippet.join('\n'), after: after.split('\n').slice(Math.max(0, range[0] - 1), range[1] + 4).join('\n') });
    const apply = (kind, name, fn) => {
      const after = M.apply(fn, lines, range, fam, f.file);
      if (after === null || after === content) return;
      record(kind, name, judge(lock, after, f.file), ex(after));
    };
    for (const [name, fn] of Object.entries(M.benign)) apply('benign', name, fn);
    for (const fmt of FORMATTERS) {
      if (!fmt.applies(f.file)) continue;
      const key = `${fmt.name}|${f.file}`;
      if (!fmtCache.has(key)) fmtCache.set(key, fmt.run(content, f.file));
      const after = fmtCache.get(key);
      if (!after || after.replace(/\s+$/, '') === content.replace(/\s+$/, '')) continue;
      record('formatter', fmt.name, judge(lock, after, f.file), { repo: r.name, lang: r.lang, file: f.file, lines: [range[0] + 1, range[1] + 1], before: f.snippet.join('\n'), after: '(whole file reformatted)' });
    }
    apply('rename', 'rename a local variable', M.rename);
    for (const [name, fn] of Object.entries(M.harmful)) apply('harmful', name, fn);
  }
  repos.push({ name: r.name, url: r.url, sha: r.sha, lang: r.lang, discovered: found.length, locks: used, skipped });
  process.stderr.write(`  ${found.length} discovered, ${used} benchmarked\n`);
}

/* ---------------- report ---------------- */
const list = [...rows.values()].map((x) => ({ ...x, langs: [...x.langs].sort() }));
const sum = (kinds, mode, what) => list.filter((x) => kinds.includes(x.kind)).reduce((s, x) => s + x[mode][what], 0);
const count = (kinds) => list.filter((x) => kinds.includes(x.kind)).reduce((s, x) => s + x.n, 0);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '–');
const benignN = count(['benign', 'formatter']);
const harmfulN = count(['harmful']);
const renameN = count(['rename']);
const summary = {
  locks: repos.reduce((s, r) => s + r.locks, 0),
  edits: benignN + harmfulN + renameN,
  falsePositives: { text: sum(['benign', 'formatter'], 'text', 'changed'), structural: sum(['benign', 'formatter'], 'structural', 'changed'), of: benignN },
  renames: { textBlocked: sum(['rename'], 'text', 'changed'), structuralBlocked: sum(['rename'], 'structural', 'changed'), structuralWarned: sum(['rename'], 'structural', 'renamed'), of: renameN },
  detection: { text: sum(['harmful'], 'text', 'changed'), structural: sum(['harmful'], 'structural', 'changed'), structuralWarnedOnly: sum(['harmful'], 'structural', 'renamed'), of: harmfulN },
};
const pkg = require('../package.json');
let rev = ''; try { rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
const version = rev ? `${pkg.version}+${rev}` : pkg.version;
const results = { fixlock: version, date: new Date().toISOString().slice(0, 10), seconds: Math.round((Date.now() - t0) / 1000), repos, summary, rows: list };
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2) + '\n');

const fp = summary.falsePositives; const det = summary.detection; const rn = summary.renames;
const tableRows = (kinds) => list.filter((x) => kinds.includes(x.kind)).sort((a, b) => b.n - a.n).map((x) =>
  `| ${x.name} | ${x.langs.join(', ')} | ${x.n} | ${pct(x.text.changed, x.n)} | ${pct(x.structural.changed, x.n)} |`).join('\n');
const misses = list.flatMap((x) => x.misses.map((m) => ({ ...m, kind: x.kind, name: x.name })));
const md = `---
title: Accuracy benchmark
---

# Accuracy benchmark

How often does fixlock get it wrong? We locked real bug fixes from real projects, edited each lock in ways that do and don't change what the code does, and checked every verdict.

For real bug fixes undone in full, as an AI port from older code would do, see the [Regression Bench](regression-bench.md).

## Results

| | Text matching (≤ 0.5) | Structural matching (0.6+) |
|---|---|---|
| **False positives**: harmless edits flagged as a change | **${pct(fp.text, fp.of)}** (${fp.text} of ${fp.of}) | **${pct(fp.structural, fp.of)}** (${fp.structural} of ${fp.of}) |
| **Detection**: harmful edits caught | ${pct(det.text, det.of)} (${det.text} of ${det.of}) | **${pct(det.structural, det.of)}** (${det.structural} of ${det.of}) |
| **Variable renames** blocked as a change | ${pct(rn.textBlocked, rn.of)} | ${pct(rn.structuralBlocked, rn.of)} (${pct(rn.structuralWarned, rn.of)} reported as a rename) |

${summary.locks} locks · ${summary.edits} edits · ${repos.length} repositories · fixlock ${version} · ${results.date}

## Corpus

Locks are the past fixes \`fixlock discover\` suggests for each repository (score 4+, the default), up to ${MAX_LOCKS} per repo.

| Repository | Language | Commit | Fixes discovered | Locks benchmarked |
|---|---|---|---|---|
${repos.map((r) => `| [${r.name}](${r.url.replace(/\.git$/, '')}) | ${r.lang} | \`${r.sha.slice(0, 7)}\` | ${r.discovered} | ${r.locks} |`).join('\n')}

## Harmless edits (should not be flagged)

| Edit | Languages | Edits | Text flags | Structural flags |
|---|---|---|---|---|
${tableRows(['benign', 'formatter'])}

## Harmful edits (must be caught)

| Edit | Languages | Edits | Text catches | Structural catches |
|---|---|---|---|---|
${tableRows(['harmful'])}

## Renames

Renaming a local variable everywhere in the file keeps the logic but can hide a swap (\`isAdmin\` → \`isGuest\`). Structural matching reports it as a **rename**: a warning by default, configurable with [\`matching.renames\`](configuration.md#matching). Text matching blocks it as a change.

| Edit | Languages | Edits | Text: blocked | Structural: blocked | Structural: reported as rename |
|---|---|---|---|---|---|
${list.filter((x) => x.kind === 'rename').map((x) => `| ${x.name} | ${x.langs.join(', ')} | ${x.n} | ${pct(x.text.changed, x.n)} | ${pct(x.structural.changed, x.n)} | ${pct(x.structural.renamed, x.n)} |`).join('\n')}

## Where structural matching gets it wrong

${(() => {
  const label = (m) => (m.kind === 'harmful'
    ? (m.verdict === 'renamed' ? 'Warned as a rename, not blocked' : 'Missed')
    : m.kind === 'rename' ? 'Rename blocked as a change' : 'False positive');
  const order = { harmful: 0, benign: 1, formatter: 1, rename: 2 };
  const shown = misses.slice().sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 14);
  return shown.length ? shown.map((m) => `- **${label(m)}: ${m.name}** in ${m.repo} \`${m.file}:${m.lines.join('-')}\``).join('\n') : 'No mistakes in this run.';
})()}

A harmful edit "warned as a rename" means the remaining code had the same shape as the lock with different names, so fixlock reported a rename instead of a change: the PR still shows a warning. A rename is blocked as a change when the lock is very short (under 4 code tokens) or the old name is still used nearby; that's deliberate, because those are the cases where a "rename" is often a different variable.

Full details for every case are in [\`bench/results.json\`](https://github.com/AbinandhMJ/fixlock/blob/main/bench/results.json).

## Method

1. Each repository is fetched at the pinned commit and \`fixlock discover\` picks its past fixes. A lock is used only if both matchers agree it is intact before any edit.
2. Each lock gets every edit that applies to it. Edits only touch the lock's own lines, except renames and formatters, which change the whole file.
   - **Harmless**: add comments, add blank lines, wrap a long line inside brackets, swap \`'\` / \`"\` (JS/TS), drop semicolons (JS/TS), re-indent (not Python); Prettier with two opposite configs (JS/TS), Black at line length 40 and 120 (Python), gofmt (Go).
   - **Harmful**: flip a comparison, swap \`&&\`/\`||\` (\`and\`/\`or\`), drop a negation, change a number, change a string, read a different field, delete the main line of the fix.
3. Both matchers judge the edited file. A harmless edit judged *changed* is a false positive. A harmful edit judged anything but *changed* is a miss.

Reproduce: \`node bench/run.js\` (needs git, network for the first fetch, and optionally prettier, black and gofmt on PATH). Runs in about ${Math.max(1, Math.round(results.seconds / 10) * 10)} seconds.

### Limits

These are mechanical edits, not a sample of real pull requests; real changes mix several edits at once. Formatter results depend on the formatter versions. A consistent rename that changes meaning (\`isAdmin\` → \`isGuest\`) is reported as a rename, not blocked, unless \`matching.renames\` is set to \`block\`.
`;
fs.writeFileSync(path.join(ROOT, 'docs', 'benchmark.md'), md);
console.log(JSON.stringify(summary, null, 2));
console.error(`wrote bench/results.json and docs/benchmark.md in ${results.seconds}s`);
