#!/usr/bin/env node
// Weekly adoption numbers for fixlock, posted to a "Weekly metrics" issue by .github/workflows/metrics.yml.
//
//   node scripts/metrics.js            → collect, print the report (Markdown), post it if GITHUB_TOKEN is set
//   node scripts/metrics.js --dry-run  → collect and print, post nothing
//
// Sources (each is optional: a source that fails shows as "n/a" instead of failing the run):
//   npm downloads (last 7 days), PyPI downloads (last 7 days, without mirrors), GitHub stars, forks and
//   open issues, VS Code Marketplace installs, Open VSX downloads.
// Each report hides its numbers in an HTML comment, so next week's report can show the change.
'use strict';

const REPO = process.env.GITHUB_REPOSITORY || 'AbinandhMJ/fixlock';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const TITLE = 'Weekly metrics';
const MARK = /<!-- metrics: ({[^]*?}) -->/;

const METRICS = [
  ['npm', 'npm downloads (7 days)'],
  ['pypi', 'PyPI downloads (7 days)'],
  ['stars', 'GitHub stars'],
  ['forks', 'GitHub forks'],
  ['issues', 'Open issues and PRs'],
  ['vscode', 'VS Code Marketplace installs (total)'],
  ['openvsx', 'Open VSX downloads (total)'],
];

async function json(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': 'fixlock-metrics', ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}
const gh = (path, opts = {}) => json(API + path, { ...opts, headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}), ...(opts.headers || {}) } });

const SOURCES = {
  npm: async () => (await json('https://api.npmjs.org/downloads/point/last-week/@abinandhmj/fixlock')).downloads,
  pypi: async () => (await json('https://pypistats.org/api/packages/fixlock/recent?period=week')).data.last_week,
  github: async () => { const r = await gh(`/repos/${REPO}`); return { stars: r.stargazers_count, forks: r.forks_count, issues: r.open_issues_count }; },
  vscode: async () => {
    const r = await json('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.2-preview.1' },
      body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: 'algotricz.fixlock' }] }], flags: 0x100 }),
    });
    const stat = r.results[0].extensions[0].statistics.find((s) => s.statisticName === 'install');
    return stat ? stat.value : 0;
  },
  openvsx: async () => (await json('https://open-vsx.org/api/algotricz/fixlock')).downloadCount,
};

async function collect() {
  const out = {};
  const errors = [];
  await Promise.all(Object.entries(SOURCES).map(async ([name, fn]) => {
    try {
      const v = await fn();
      if (v && typeof v === 'object') Object.assign(out, v); else out[name] = v;
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }));
  return { values: out, errors };
}

/** The report: a table with this week's numbers and the change since the last report. */
function report(values, previous, date, errors = []) {
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : 'n/a');
  const delta = (k) => {
    if (typeof values[k] !== 'number' || !previous || typeof previous[k] !== 'number') return '';
    const d = values[k] - previous[k];
    return d === 0 ? '0' : `${d > 0 ? '+' : ''}${d.toLocaleString('en-US')}`;
  };
  const rows = METRICS.map(([k, label]) => `| ${label} | ${fmt(values[k])} | ${delta(k)} |`).join('\n');
  return `### fixlock metrics, week of ${date}

| Metric | This week | Change since last report |
|---|---|---|
${rows}
${errors.length ? `\nNot available this week: ${errors.map((e) => e.split(':')[0]).join(', ')}.\n` : ''}
<!-- metrics: ${JSON.stringify(values)} -->
`;
}

/** Numbers from the most recent earlier report, if any. */
function previousValues(comments) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const m = MARK.exec(comments[i].body || '');
    if (m) { try { return JSON.parse(m[1]); } catch { /* skip */ } }
  }
  return null;
}

async function main() {
  const dry = process.argv.includes('--dry-run') || !process.env.GITHUB_TOKEN;
  const { values, errors } = await collect();
  const date = new Date().toISOString().slice(0, 10);
  if (dry) { console.log(report(values, null, date, errors)); if (errors.length) console.error(errors.join('\n')); return; }

  // One long-running issue holds every weekly report.
  let issue = (await gh(`/repos/${REPO}/issues?state=all&labels=metrics&per_page=10`)).find((i) => i.title === TITLE && !i.pull_request);
  if (!issue) {
    issue = await gh(`/repos/${REPO}/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: TITLE, labels: ['metrics'], body: 'Adoption numbers for fixlock, posted every Monday by the Metrics workflow (scripts/metrics.js). Subscribe to get them by email.' }) });
  }
  const comments = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/repos/${REPO}/issues/${issue.number}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const body = report(values, previousValues(comments), date, errors);
  await gh(`/repos/${REPO}/issues/${issue.number}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
  console.log(body);
  if (process.env.GITHUB_STEP_SUMMARY) require('fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  if (errors.length) console.error(`Some sources failed:\n${errors.join('\n')}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { report, previousValues, METRICS };
