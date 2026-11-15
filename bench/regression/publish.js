#!/usr/bin/env node
// Put the Regression Bench on GitHub so AI code reviewers can be measured on exactly the same cases.
//
//   node bench/regression/run.js                                   (builds the cases first)
//   node bench/regression/publish.js --repo you/regression-bench   (an EMPTY public repo you created)
//   node bench/regression/publish.js --dry-run                     (build the repo locally, push nothing)
//
// The bench repo's main branch has, for every case, the file as it was before the fix and then the fix
// itself as a separate commit, with the fix's original message and author. fixlock locks are added the
// way `fixlock discover` suggested them. Then each case gets two pull requests with the same neutral
// title: one that undoes the fix (regression) and one that only adds comments (control). Branch names
// and titles don't tell them apart; which is which is saved in bench/regression/harness.json.
//
// Pushing uses your normal git credentials. Opening PRs uses the GitHub CLI (`gh auth login`), or GITHUB_TOKEN.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { CACHE, corpus } = require('../corpus');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const DRY = args.includes('--dry-run');
const REPO = opt('repo');
const CASES = path.join(__dirname, '.cases');
const { api } = require('./github');
if (!DRY && !/^[\w.-]+\/[\w.-]+$/.test(REPO || '')) { console.error('Usage: publish.js --repo owner/name   (or --dry-run)'); process.exit(2); }
if (!fs.existsSync(CASES)) { console.error('No cases yet: run node bench/regression/run.js first.'); process.exit(2); }

const BOT = { GIT_COMMITTER_NAME: 'Regression Bench', GIT_COMMITTER_EMAIL: 'regression-bench@users.noreply.github.com' };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-bench-'));
const git = (a, env = {}) => execFileSync('git', a, { cwd: work, encoding: 'utf8', env: { ...process.env, ...BOT, GIT_AUTHOR_NAME: BOT.GIT_COMMITTER_NAME, GIT_AUTHOR_EMAIL: BOT.GIT_COMMITTER_EMAIL, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
const write = (rel, text) => { const p = path.join(work, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

const cases = fs.readdirSync(CASES).sort().map((id) => {
  const dir = path.join(CASES, id);
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
  for (const k of ['base', 'regressed', 'control']) c[k] = fs.readFileSync(path.join(dir, k), 'utf8');
  c.path = `cases/${id}/${c.file}`;
  return c;
});
const repos = corpus().filter((r) => cases.some((c) => c.repo === r.name));

git(['init', '-q', '-b', 'main']);

/* ---- main: README, licenses, then each case: before the fix → the fix (original message and author) ---- */
write('README.md', `# Regression Bench

Does a code review tool notice when a pull request quietly undoes a real bug fix?

This repository holds ${cases.length} real bug fixes from ${repos.length} open-source projects. For each one, \`cases/<case>/\` has the file as it was **before** the fix, then the fix itself as its own commit with the original message and author. Then two pull requests per case change the file again. Some undo the fix, some don't. Reviewers see the full history.

Built by [fixlock](https://abinandhmj.github.io/fixlock/regression-bench) (a product of Algotricz) to compare tools on the same cases. Method and results: https://abinandhmj.github.io/fixlock/regression-bench

Please don't merge the pull requests: they are the test cases.

## Sources and licenses

Each file is copied from its project at a pinned commit and remains under that project's license, included in \`licenses/\`. Changes: the files were moved under \`cases/\`, and the pull requests edit them as described above.

${repos.map((r) => `- **${r.name}**: ${r.url.replace(/\.git$/, '')} at \`${r.sha.slice(0, 7)}\` (license in \`licenses/${r.name}/\`)`).join('\n')}
`);
for (const r of repos) {
  const src = path.join(CACHE, r.name);
  for (const f of fs.readdirSync(src).filter((f) => /(licen[cs]e|copying|notice)/i.test(f))) {
    if (fs.statSync(path.join(src, f)).isFile()) write(`licenses/${r.name}/${f}`, fs.readFileSync(path.join(src, f), 'utf8'));
  }
}
git(['add', '-A']);
git(['commit', '-q', '-m', 'chore: Regression Bench: sources and licenses']);

for (const c of cases) {
  write(c.path, c.regressed);
  git(['add', '-A']);
  git(['commit', '-q', '-m', `chore(${c.id}): import ${c.file} from ${c.repo}`, '-m', `${c.url}/blob/${c.head}/${c.file}, as it was before ${c.url}/commit/${c.fix.sha}`]);
  // The fix, credited to its original author.
  const meta = execFileSync('git', ['log', '-1', '--format=%an%x1f%ae%x1f%aI%x1f%B', c.fix.sha], { cwd: path.join(CACHE, c.repo), encoding: 'utf8' }).split('\x1f');
  write(c.path, c.base);
  git(['add', '-A']);
  git(['commit', '-q', '-m', meta[3].trim(), '-m', `(${c.id}) Original commit: ${c.url}/commit/${c.fix.sha}`],
    { GIT_AUTHOR_NAME: meta[0], GIT_AUTHOR_EMAIL: meta[1], GIT_AUTHOR_DATE: meta[2] });
}

// fixlock: every fix locked as `fixlock discover` suggested, owned by a bench maintainer (so only they can approve).
write('.fixlock/config.json', JSON.stringify({
  project: 'regression-bench',
  team: [{ name: 'Bench maintainer', github: null, emails: ['regression-bench@users.noreply.github.com'], role: 'lead' }],
  policies: { bug: { onEdit: 'ask', approval: 'owner' }, feature: { onEdit: 'warn', approval: 'owner-or-lead' } },
}, null, 2) + '\n');
let n = 0;
write('.fixlock/registry.json', JSON.stringify({ version: 2, locks: cases.flatMap((c) => c.snippets.map((snippet) => ({
  id: `FIX-${String(++n).padStart(3, '0')}`, type: 'bug', title: c.fix.subject, reason: `${c.fix.subject} (${c.url}/commit/${c.fix.sha.slice(0, 7)})`,
  file: c.path, snippet, owner: 'Bench maintainer', issue: null, test: null, date: '2026-11-15',
}))) }, null, 2) + '\n');
git(['add', '-A']);
git(['commit', '-q', '-m', 'chore: lock the fixes with fixlock']);

/* ---- one regression PR and one control PR per case, in a shuffled order, with neutral names ---- */
let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const prs = cases.flatMap((c) => [{ c, kind: 'regression', content: c.regressed }, { c, kind: 'control', content: c.control }])
  .map((p) => ({ ...p, k: rand() })).sort((a, b) => a.k - b.k)
  .map((p, i) => ({ ...p, branch: `change-${String(i + 1).padStart(2, '0')}` }));
for (const p of prs) {
  git(['checkout', '-q', '-b', p.branch, 'main']);
  write(p.c.path, p.content);
  git(['commit', '-q', '-am', `refactor(${p.c.id}): tidy up ${path.basename(p.c.file)}`]);
}
git(['checkout', '-q', 'main']);

const harness = { repo: REPO || null, built: new Date().toISOString(), cases: cases.length, prs: prs.map((p) => ({ branch: p.branch, case: p.c.id, kind: p.kind, file: p.c.path })) };
const save = () => fs.writeFileSync(path.join(__dirname, 'harness.json'), JSON.stringify(harness, null, 2) + '\n');

if (DRY) {
  save();
  console.log(`Built ${prs.length} PR branches for ${cases.length} cases in ${work} (dry run, nothing pushed).`);
  process.exit(0);
}

(async () => {
  const gh = api;
  const repo = await gh('GET', `/repos/${REPO}`);
  if (repo.private) throw new Error(`${REPO} is private. Use a public repository so free reviewer plans apply and anyone can check the results.`);
  if (repo.size > 0) throw new Error(`${REPO} isn't empty. Create a new, empty repository for the bench.`);

  git(['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  process.stderr.write('pushing main and the PR branches…\n');
  git(['push', '-q', 'origin', 'main']);
  for (let i = 0; i < prs.length; i += 20) git(['push', '-q', 'origin', ...prs.slice(i, i + 20).map((p) => p.branch)]);

  for (const p of prs) {
    const pr = await gh('POST', `/repos/${REPO}/pulls`, { title: `refactor(${p.c.id}): tidy up ${path.basename(p.c.file)}`, head: p.branch, base: 'main', body: `Tidies up \`${p.c.file}\` (case ${p.c.id}).` });
    p.number = pr.number;
    harness.prs.find((x) => x.branch === p.branch).number = pr.number;
    save();
    process.stderr.write(`  #${pr.number} ${p.branch}\n`);
    await new Promise((r) => setTimeout(r, 4000)); // stay under GitHub's limit on creating content
  }
  save();
  console.log(`Opened ${prs.length} pull requests on ${REPO}. Install the reviewers and the fixlock GitHub App, wait for their reviews, then run score.js.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
