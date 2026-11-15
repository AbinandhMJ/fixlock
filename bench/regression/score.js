#!/usr/bin/env node
// Collect what each code review bot said on the Regression Bench pull requests, and score it.
//
//   node bench/regression/score.js --repo you/regression-bench
//
// Reads bench/regression/harness.json (written by publish.js) to know which PR is a regression and
// which is a control. For every bot that reviewed (any account whose login ends in [bot]), and for the
// fixlock check run, it records whether it raised a concern on the PR's changed lines:
//   auto verdict "flagged"  = an inline comment on the changed lines, a "changes requested" review,
//                             or a failing check run; or a comment that quotes code from the undone lines
//   auto verdict "silent"   = it reviewed but raised nothing there
// An AI review can flag a regression in its own words, so a person confirms each verdict in
// bench/regression/grades.json ({ "<pr number>": { "<bot>": "flagged" | "silent" } }); confirmed
// verdicts win over automatic ones. A reviewer that never reviewed (rate limits, plan limits) is graded
// "not-run" and reported as such, never as 0. Writes bench/regression/reviews.md and reviews.json.
//
// fixlock's own PR comment is skipped (its check run is the verdict), and so are check runs that never
// fail on any PR (they carry no verdict).
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const H = JSON.parse(fs.readFileSync(path.join(__dirname, 'harness.json'), 'utf8'));
const REPO = opt('repo', H.repo);
const { api, all } = require('./github');
const CASES = path.join(__dirname, '.cases');
const gradesFile = path.join(__dirname, 'grades.json');
const grades = fs.existsSync(gradesFile) ? JSON.parse(fs.readFileSync(gradesFile, 'utf8')) : {};

/** Line numbers (new file) changed by the PR, and the code lines it removed. */
function changes(id, kind) {
  const base = fs.readFileSync(path.join(CASES, id, 'base'), 'utf8').split('\n');
  const after = fs.readFileSync(path.join(CASES, id, kind === 'regression' ? 'regressed' : 'control'), 'utf8').split('\n');
  let a = 0; while (a < base.length && a < after.length && base[a] === after[a]) a++;
  let b = 0; while (b < base.length - a && b < after.length - a && base[base.length - 1 - b] === after[after.length - 1 - b]) b++;
  const removed = base.slice(a, base.length - b).map((l) => l.trim()).filter((l) => l.length > 8);
  return { from: a + 1, to: Math.max(a + 1, after.length - b), removed };
}

const isBot = (u) => u && (u.type === 'Bot' || /\[bot\]$/.test(u.login));
const SKIP = new Set(['fixlock-by-algotricz[bot]']);

(async () => {
  const rows = [];
  for (const p of H.prs) {
    if (!p.number) continue;
    const ch = changes(p.case, p.kind);
    const pr = `/repos/${REPO}/pulls/${p.number}`;
    const [inline, reviews, comments] = await Promise.all([all(`${pr}/comments`), all(`${pr}/reviews`), all(`/repos/${REPO}/issues/${p.number}/comments`)]);
    const head = (await api('GET', pr)).head.sha;
    const checks = await all(`/repos/${REPO}/commits/${head}/check-runs`);
    const bots = {};
    const add = (login, flagged, text, inlineComment = false) => {
      const b = bots[login] || (bots[login] = { flagged: false, inline: 0, excerpts: [] });
      b.flagged = b.flagged || flagged;
      if (inlineComment) b.inline++;
      if (text && b.excerpts.length < 2) b.excerpts.push(text.replace(/\s+/g, ' ').slice(0, 220));
    };
    const quotesRemoved = (text) => ch.removed.some((l) => (text || '').includes(l));
    for (const c of inline.filter((x) => isBot(x.user))) {
      const line = c.line || c.original_line || 0;
      add(c.user.login, line >= ch.from - 2 && line <= ch.to + 2, c.body, true);
    }
    for (const r of reviews.filter((x) => isBot(x.user))) add(r.user.login, r.state === 'CHANGES_REQUESTED' || (p.kind === 'regression' && quotesRemoved(r.body)), r.body);
    for (const c of comments.filter((x) => isBot(x.user))) add(c.user.login, p.kind === 'regression' && quotesRemoved(c.body), c.body);
    for (const c of checks.filter((x) => x.app && x.status === 'completed')) add(`check: ${c.name} (${c.app.slug})`, c.conclusion === 'failure', c.output && c.output.title);
    for (const [login, b] of Object.entries(bots)) {
      if (SKIP.has(login)) continue;
      // A failing/passing check is a deterministic verdict; bots' comments need a person's reading.
      const confirmed = (grades[p.number] && grades[p.number][login]) || (login.startsWith('check: ') ? (b.flagged ? 'flagged' : 'silent') : null);
      rows.push({ pr: p.number, case: p.case, kind: p.kind, bot: login, auto: b.flagged ? 'flagged' : 'silent', verdict: confirmed || (b.flagged ? 'flagged' : 'silent'), confirmed: !!confirmed, commented: b.inline > 0, excerpts: b.excerpts });
    }
  }

  // Check runs that never fail anywhere carry no verdict.
  const failingChecks = new Set(rows.filter((r) => r.bot.startsWith('check: ') && r.auto === 'flagged').map((r) => r.bot));
  const kept = rows.filter((r) => !r.bot.startsWith('check: ') || failingChecks.has(r.bot));
  // Per bot: regressions flagged, controls flagged (false alarms), controls with other comments (noise).
  const table = {};
  for (const r of kept) {
    const t = table[r.bot] || (table[r.bot] = { regression: [0, 0], control: [0, 0], noise: 0, notRun: 0, unconfirmed: 0 });
    if (r.verdict === 'not-run') { t.notRun++; continue; }
    t[r.kind][1]++;
    if (r.verdict === 'flagged') t[r.kind][0]++;
    else if (r.kind === 'control' && r.commented) t.noise++;
    if (!r.confirmed) t.unconfirmed++;
  }
  fs.writeFileSync(path.join(__dirname, 'reviews.json'), JSON.stringify({ repo: REPO, scored: new Date().toISOString(), note: grades._note || null, table, rows: kept }, null, 2) + '\n');
  const md = `# Regression Bench: reviews on ${REPO}

| Reviewer | Regressions flagged | False alarms on controls | Other comments on controls | Verdicts not confirmed |
|---|---|---|---|---|
${Object.entries(table).map(([bot, t]) => (t.notRun && !t.regression[1] ? `| ${bot} | not run on ${t.notRun} PRs | | | |` : `| ${bot} | ${t.regression[0]} of ${t.regression[1]} | ${t.control[0]} of ${t.control[1]} | ${t.noise} | ${t.unconfirmed} |`)).join('\n')}

Confirm or correct a verdict in \`bench/regression/grades.json\`, e.g. \`{ "12": { "coderabbitai[bot]": "flagged" } }\`, then run score.js again.

## Every review

| PR | Case | Kind | Reviewer | Verdict | What it said |
|---|---|---|---|---|---|
${kept.map((r) => `| [#${r.pr}](https://github.com/${REPO}/pull/${r.pr}) | ${r.case} | ${r.kind} | ${r.bot} | ${r.verdict}${r.confirmed ? '' : ' (auto)'} | ${r.excerpts.join(' / ').replace(/\|/g, '\\|')} |`).join('\n')}
`;
  fs.writeFileSync(path.join(__dirname, 'reviews.md'), md);
  console.log(md.split('\n## Every review')[0]);
})().catch((e) => { console.error(e.message); process.exit(1); });
