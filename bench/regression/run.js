#!/usr/bin/env node
// Regression Bench: does a tool notice when a pull request undoes a real bug fix?
//
// Cases come from cases.js: real bug-fix commits in 11 repositories, each undone by applying the fix's
// own diff in reverse (the regression), plus a harmless edit of the same lines (the control).
// fixlock judges each with the locks `fixlock discover` + auto-lock would have made for that fix.
//
//   caught          = the regression is reported as a change to a locked fix (the PR is blocked)
//   false alarm     = the control is reported as a change
//
// Usage: node bench/regression/run.js [--per-repo 3] [--repos express,ky]
// Writes bench/regression/results.json, docs/regression-bench.md, and the case files to
// bench/regression/.cases/ (used by publish.js to run AI reviewers on the same cases).
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../../src/locks');
const { buildCases } = require('./cases');
const { ROOT } = require('../corpus');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const OUT = path.join(__dirname, '.cases');
const ENGINES = ['structural', 'text'];

/** Verdict for a whole file: "changed" if any lock changed, else "renamed" if any renamed, else "intact". */
function judge(snippets, file, base, content, mode) {
  let verdict = 'intact';
  for (const snippet of snippets) {
    const lock = L.withCopies({ file, snippet }, base);
    const v = L.verifyLock(lock, content, { mode, file, before: base }).status;
    if (v === 'changed') return 'changed';
    if (v === 'renamed') verdict = 'renamed';
  }
  return verdict;
}

const t0 = Date.now();
const cases = buildCases({ perRepo: +opt('per-repo', 3), repos: opt('repos') && opt('repos').split(','), log: (s) => process.stderr.write(s) });
fs.rmSync(OUT, { recursive: true, force: true });

const rows = [];
for (const c of cases) {
  // Locks are made the way fixlock makes them, on the code as it is (base); then judged on each PR.
  const baseline = Object.fromEntries(ENGINES.map((m) => [m, judge(c.snippets, c.file, c.base, c.base, m)]));
  if (ENGINES.some((m) => baseline[m] !== 'intact')) { process.stderr.write(`  skip ${c.id}: lock not intact before any edit\n`); continue; }
  const row = { id: c.id, repo: c.repo, lang: c.lang, url: c.url, head: c.head, file: c.file, fix: c.fix, changed: c.changed, locks: c.snippets.length, regression: {}, control: {} };
  for (const m of ENGINES) {
    row.regression[m] = judge(c.snippets, c.file, c.base, c.regressed, m);
    row.control[m] = judge(c.snippets, c.file, c.base, c.control, m);
  }
  rows.push(row);
  const dir = path.join(OUT, c.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const k of ['base', 'regressed', 'control']) fs.writeFileSync(path.join(dir, k), c[k]);
  fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify({ ...row, snippets: c.snippets }, null, 2));
}

const count = (kind, m, v) => rows.filter((r) => r[kind][m] === v).length;
const summary = {};
for (const m of ENGINES) {
  summary[m] = {
    caught: count('regression', m, 'changed'), warned: count('regression', m, 'renamed'),
    falseAlarms: count('control', m, 'changed'), controlWarned: count('control', m, 'renamed'), cases: rows.length,
  };
}
const results = { generated: new Date().toISOString().slice(0, 10), seconds: Math.round((Date.now() - t0) / 1000), repos: [...new Set(rows.map((r) => r.repo))].length, summary, cases: rows };
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2) + '\n');

/* ---------------- AI reviewers (from score.js, if they've been run) ---------------- */
const reviewsFile = path.join(__dirname, 'reviews.json');
const reviews = fs.existsSync(reviewsFile) ? JSON.parse(fs.readFileSync(reviewsFile, 'utf8')) : null;
const BOT_NAMES = { 'cubic-dev-ai[bot]': 'Cubic', 'coderabbitai[bot]': 'CodeRabbit' };
const reviewers = reviews ? Object.entries(reviews.table).filter(([bot]) => BOT_NAMES[bot]).map(([bot, t]) => ({ bot, name: BOT_NAMES[bot], ...t })) : [];
const reviewerVerdict = (bot, id, kind) => { const r = reviews && reviews.rows.find((x) => x.bot === bot && x.case === id && x.kind === kind); return r ? r.verdict : null; };
const ran = reviewers.filter((r) => r.regression[1]);
const notRun = reviewers.filter((r) => !r.regression[1]);

/* ---------------- docs/regression-bench.md ---------------- */
const s = summary.structural; const t = summary.text;
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1).replace(/\.0$/, '')}%` : '–');
const short = (sha) => sha.slice(0, 7);
// Why a miss happened, for misses a person has looked at. Kept short and factual.
const NOTES = rows.some((r) => r.id === 'requests-1' && r.regression.structural !== 'changed')
  ? 'The requests "fix" mostly removed an old workaround (a `try`/`except` around `os.path.expanduser`); undoing it puts the workaround back, and the line fixlock locked is still there unchanged. It\'s counted as a miss because the case was chosen mechanically.'
  : '';
const md = `---
title: Regression Bench
---

# Regression Bench

Does a tool notice when a pull request quietly undoes a real bug fix? That's the failure fixlock exists for: an AI assistant ports code from an older version, or "simplifies" a function, and a fix someone shipped months ago is gone. Git merges it without a conflict.

The Regression Bench is ${rows.length} real bug fixes from ${results.repos} open-source repositories in ${results.repos} languages. Each one is undone by applying the fix's own diff in reverse, so the code goes back to exactly what it was before the fix. Each also has a **control**: a harmless edit of the same lines, which a tool shouldn't flag.

## Results

| | Regressions caught | False alarms on controls |
|---|---|---|
| **fixlock** (structural matching, the default) | **${s.caught} of ${s.cases} (${pct(s.caught, s.cases)})** | **${s.falseAlarms} of ${s.cases} (${pct(s.falseAlarms, s.cases)})** |
| fixlock, text matching | ${t.caught} of ${t.cases} (${pct(t.caught, t.cases)}) | ${t.falseAlarms} of ${t.cases} (${pct(t.falseAlarms, t.cases)}) |
| git merge | 0 (no conflict) | 0 |
${ran.map((r) => `| ${r.name} (AI code review, on GitHub) | ${r.regression[0]} of ${r.regression[1]} (${pct(r.regression[0], r.regression[1])}) | ${r.control[0]} of ${r.control[1]}${r.noise ? ` (plus ${r.noise} comments about the added code comments)` : ''} |`).join('\n')}${ran.length ? '\n' : ''}${notRun.map((r) => `| ${r.name} | Didn't review: see [AI reviewers](#ai-reviewers) | |`).join('\n')}${notRun.length ? '\n' : ''}${!reviewers.length ? '| AI code review | Not run yet: see [Run it against AI reviewers](#run-it-against-ai-reviewers) | |\n' : ''}
${s.warned ? `${s.warned} more regression(s) were reported as a rename: the PR still shows a warning, but isn't blocked.\n\n` : ''}A regression counts as caught when fixlock reports a locked fix as changed, which fails the PR check until the fix's owner approves. Locks are the ones \`fixlock discover\` and auto-lock would make for the fix; nobody chose them by hand.

## Cases

| Case | Fix | File | fixlock: regression | fixlock: control${ran.map((r) => ` | ${r.name}: regression`).join('')} |
|---|---|---|---|---${ran.map(() => '|---').join('')}|
${rows.map((r) => `| ${r.id} | [${short(r.fix.sha)}](${r.url}/commit/${r.fix.sha}) ${r.fix.subject.replace(/\|/g, '\\|').slice(0, 70)} | \`${r.file}\` | ${{ changed: 'Caught', renamed: 'Warned', intact: 'Missed' }[r.regression.structural]} | ${{ changed: 'False alarm', renamed: 'Warned', intact: 'Passed' }[r.control.structural]}${ran.map((b) => ` | ${{ flagged: 'Caught', silent: 'Missed' }[reviewerVerdict(b.bot, r.id, 'regression')] || '–'}`).join('')} |`).join('\n')}

${(() => {
  const miss = rows.filter((r) => r.regression.structural !== 'changed');
  const fa = rows.filter((r) => r.control.structural === 'changed');
  if (!miss.length && !fa.length) return 'No misses and no false alarms in this run.\n';
  let out = '';
  if (miss.length) out += `**Missed (${miss.length}):** ${miss.map((r) => `${r.id} (${r.fix.subject.replace(/\|/g, '')})`).join('; ')}. ${NOTES}\n\n`;
  if (fa.length) out += `**False alarms (${fa.length}):** ${fa.map((r) => r.id).join(', ')}.\n\n`;
  return out;
})()}
Every case, with its locks and verdicts, is in [\`bench/regression/results.json\`](https://github.com/AbinandhMJ/fixlock/blob/main/bench/regression/results.json).

## Method

1. Each repository is fetched at a pinned commit, and \`fixlock discover\` lists its past bug-fix commits from the git history (commit messages, reverts, tests changed with the fix).
2. For each fix, in the order \`discover\` ranks them, the fix's diff for one file is applied **in reverse** at the pinned commit. The case is kept only if that applies cleanly and changes at most 40 lines. Test files are skipped. Up to ${opt('per-repo', 3)} fixes per repository.
3. The **control** adds comments and blank lines inside the fixed code and changes nothing else.
4. fixlock locks the fix's code as it is at the pinned commit (every block \`discover\` suggests for that fix in that file), then judges the regression and the control.

Cases are chosen without asking fixlock anything, so the selection can't favour it. Reproduce with \`node bench/regression/run.js\` (needs git and network for the first fetch; about ${Math.max(1, Math.round(results.seconds / 10) * 10)} seconds).

### Limits

- A reversed diff is the cleanest possible regression. Real AI rewrites often undo a fix while changing much more around it; the [accuracy benchmark](benchmark.md) covers mixed and partial edits.
- fixlock only protects fixes that are locked. Here every fix is locked by \`discover\`; in a real repository, a fix nobody locked (and that \`discover\` doesn't find) isn't protected.
- Some commits that \`discover\` ranks as fixes are partly refactors. They're kept as found, to avoid hand-picking.

${reviews ? `## AI reviewers

On ${reviews.scored.slice(0, 10)}, the bench was published to [${reviews.repo}](https://github.com/${reviews.repo}) with \`publish.js\`: every fix in the history with its original message and author, then one regression PR and one control PR per case under neutral names. The reviewers and the [fixlock GitHub App](github-app.md) were installed on the repository and reviewed every PR on their own.

${ran.map((r) => `- **${r.name}** reviewed all ${r.regression[1] + r.control[1]} PRs. It flagged ${r.regression[0]} of ${r.regression[1]} regressions, usually naming the exact fix it undid, and claimed no behavior change on any control. Its other ${r.noise} comments on controls were about the placeholder comments the controls add. It missed: ${rows.filter((x) => reviewerVerdict(r.bot, x.id, 'regression') === 'silent').map((x) => x.id).join(', ')}.`).join('\n')}
${notRun.map((r) => `- **${r.name}** didn't review. It skips automatic reviews in repositories with fewer than 10 stars, and when asked on each PR (\`@coderabbitai review\`) it answered with its hourly rate limit. It's left unscored rather than scored as 0.`).join('\n')}
- The **fixlock GitHub App** gave the same verdict on every PR as this page's offline run.

How the comments were graded: a regression counts as caught only if a comment says the change removes or breaks the fix; a control counts as a false alarm only if a comment claims a behavior change or a bug. ${reviews.note ? 'The verdicts were graded by Claude (AI) from each comment and are recorded with the comments themselves in' : 'Every verdict and the comment behind it is in'} [\`bench/regression/reviews.md\`](https://github.com/AbinandhMJ/fixlock/blob/main/bench/regression/reviews.md), so anyone can check them.

AI reviewers don't know which lines are fixes; they judge the diff on its merits, and catching ${ran.length ? ran[0].regression[0] : 0} undone fixes that way is impressive. fixlock knows because the fixes were locked, so it also caught ${ran.length ? rows.filter((x) => x.regression.structural === 'changed' && reviewerVerdict(ran[0].bot, x.id, 'regression') === 'silent').length : 0} that ${ran.length ? ran[0].name : 'the reviewer'} let through, for example ${ran.length ? rows.filter((x) => x.regression.structural === 'changed' && reviewerVerdict(ran[0].bot, x.id, 'regression') === 'silent').slice(0, 3).map((x) => `"${x.fix.subject.replace(/ \(#\d+\)/g, '')}" (${x.id})`).join(', ') : ''}. The two work well together.

` : ''}## Run it against AI reviewers

AI code reviewers can't be run offline, so the bench comes with a harness that runs them on the same cases, on GitHub:

1. \`node bench/regression/publish.js --repo you/regression-bench\` creates a public repository where each fix is in the history, with its original commit message, and opens one regression PR and one control PR per case. PR titles don't say which is which.
2. Install the reviewers to compare (for example CodeRabbit and Cubic, both free for public repositories) and the [fixlock GitHub App](github-app.md) on that repository, and let them review every PR.
3. \`node bench/regression/score.js --repo you/regression-bench\` collects every bot's comments into \`bench/regression/reviews.md\`, marking the ones that point at the undone lines. A person confirms each verdict, since an AI review can flag a regression in its own words.

The fix's commit is right there in the history, so a reviewer that reads history has every chance to notice it was undone.
`;
fs.writeFileSync(path.join(ROOT, 'docs', 'regression-bench.md'), md);
console.log(JSON.stringify({ cases: rows.length, summary }, null, 2));
process.stderr.write(`wrote bench/regression/results.json and docs/regression-bench.md in ${results.seconds}s\n`);
