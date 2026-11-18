// One-click setup: when the fixlock GitHub App is installed on a repository that has no .fixlock/
// folder (or someone presses "Set up" on the dashboard), open a "Set up fixlock" pull request with:
//   - .fixlock/config.json: the person who installed it as lead, recent commit authors as developers;
//   - .fixlock/registry.json: the past fixes fixlock is surest about, found from the commit history
//     with the same scoring as `fixlock discover`, keeping only fixes whose lines are still on the
//     default branch.
// Merging it turns the check on. Everything is read through GitHub's API (no checkout), and the number of
// requests is kept inside the Workers per-request subrequest limit (SUBREQUEST_BUDGET, default 45).
import config from '../src/config.js';
import L from '../src/locks.js';
import team from '../src/team.js';
import discovery from '../src/discover.js';
import auto from '../src/autolock.js';

export const SETUP_BRANCH = 'fixlock/setup';
const MIN_SCORE = 7; // "high" confidence in `fixlock discover`
const MAX_LOCKS = 15;
const PER_COMMIT = 2;
const isBot = (u) => !!u && (u.type === 'Bot' || /\[bot\]$/i.test(u.login || ''));

/** Commits from the API in the shape discover's scoring expects. */
function toCommit(c) {
  const message = (c.commit && c.commit.message) || '';
  const [subject, ...rest] = message.split('\n');
  const body = rest.join('\n').replace(/^\n+/, '');
  const why = body.split(/\n\s*\n/)[0].split('\n').filter((l) => !/^[\w-]+:\s/.test(l) && !/This reverts commit/i.test(l)).join(' ').trim();
  const a = (c.commit && c.commit.author) || {};
  return { sha: c.sha, subject, body, why, email: String(a.email || '').toLowerCase(), name: a.name || '', login: c.author && !isBot(c.author) ? c.author.login : null, bot: isBot(c.author), files: [], added: 0, patches: [] };
}

/** Runs of added lines in a unified diff patch (context lines end a run; removed lines don't). */
export function addedBlocks(patch) {
  const out = [];
  let run = null;
  const end = () => { if (run && run.length) out.push(run); run = null; };
  for (const line of String(patch || '').split('\n')) {
    if (line.startsWith('@@')) { end(); continue; }
    if (line.startsWith('+')) (run = run || []).push(line.slice(1));
    else if (line.startsWith('-')) continue;
    else end();
  }
  end();
  return out;
}

/** Team from the people who committed recently: the installer leads, the others are developers. */
export function teamFrom(commits, installer) {
  const people = new Map();
  for (const c of commits) {
    if (c.bot) continue;
    const key = (c.login || c.email || '').toLowerCase();
    if (!key) continue;
    const p = people.get(key) || { name: c.name || c.login || c.email, github: c.login, emails: new Set(), commits: 0 };
    if (c.email) p.emails.add(c.email);
    p.commits++;
    people.set(key, p);
  }
  const lead = installer && people.get(installer.toLowerCase());
  const members = [];
  if (installer) members.push({ name: lead ? lead.name : installer, github: installer, emails: lead ? [...lead.emails] : [], role: 'lead' });
  for (const [key, p] of [...people].sort((a, b) => b[1].commits - a[1].commits)) {
    if (installer && key === installer.toLowerCase()) continue;
    if (members.length >= 16) break;
    members.push({ name: p.name, github: p.github || null, emails: [...p.emails], role: members.length || installer ? 'developer' : 'lead' });
  }
  return members;
}

/** The past fixes worth locking, read through the API. */
async function findLocks(gh, repo, branch, commits, cfg, budget) {
  // 1. Score every commit on its message alone, and fetch details for the most promising ones.
  const first = discovery.scoreCommits(commits).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score);
  const spare = Math.max(0, budget - gh.calls);
  const detail = first.slice(0, Math.min(12, Math.floor(spare / 2)));
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  for (const x of detail) {
    const d = await gh.get(`/repos/${repo}/commits/${x.commit.sha}`);
    const c = bySha.get(x.commit.sha);
    c.files = (d.files || []).map((f) => f.filename);
    c.added = (d.files || []).reduce((n, f) => n + (f.additions || 0), 0);
    c.patches = (d.files || []).filter((f) => f.patch && f.status !== 'removed').map((f) => ({ file: f.filename, patch: f.patch }));
  }
  // 2. Score again with the files (tests, size), as `fixlock discover` does.
  const fetched = new Set(detail.map((x) => x.commit.sha));
  const scored = discovery.scoreCommits(commits).filter((x) => fetched.has(x.commit.sha));
  const o = auto.options(cfg);
  const files = new Map();
  const found = [];
  for (const x of scored) {
    const c = bySha.get(x.commit.sha);
    const blocks = [];
    for (const { file, patch } of c.patches) {
      if (discovery.TEST_FILE.test(file) || o.ignore.some((p) => (p.startsWith('.') && !p.includes('/') ? file.endsWith(p) : file.includes(p)))) continue;
      for (const lines of addedBlocks(patch)) {
        const snippet = lines.filter((l) => !L.trivial(l));
        if (!snippet.length || snippet.length > o.maxLines || !discovery.hasCode(snippet, file)) continue;
        blocks.push({ file, snippet });
      }
    }
    for (const b of blocks) {
      const guards = discovery.guardsIn(b.snippet);
      b.score = x.score + (guards.length && x.type === 'bug' ? 2 : 0);
      b.signals = [...x.signals, ...(guards.length && x.type === 'bug' ? [`adds a guard (${guards.join(', ')})`] : [])];
      b.guards = guards;
    }
    const best = blocks.filter((b) => b.score >= MIN_SCORE).sort((a, b) => b.score - a.score || b.guards.length - a.guards.length || a.snippet.length - b.snippet.length);
    let kept = 0;
    for (const b of best) {
      if (kept >= PER_COMMIT || found.length >= MAX_LOCKS * 2) break;
      // 3. Only lines still on the default branch, as locked.
      if (!files.has(b.file)) {
        if (gh.calls >= budget - 6) break; // keep enough requests to open the pull request
        files.set(b.file, await gh.file(repo, b.file, branch));
      }
      const content = files.get(b.file);
      if (content === null) continue;
      if (L.verifyLock({ snippet: b.snippet, file: b.file }, content, { mode: (cfg.matching || {}).mode, file: b.file }).status !== 'intact') continue;
      if (found.some((f) => f.file === b.file && b.snippet.filter((l) => f.snippet.some((m) => L.norm(m) === L.norm(l))).length >= Math.ceil(b.snippet.length / 2))) continue;
      found.push({ ...b, commit: x.commit, type: x.type, test: x.tests[0] || null, content });
      kept++;
    }
  }
  found.sort((a, b) => b.score - a.score || a.snippet.length - b.snippet.length);
  const reg = { version: 2, locks: [] };
  for (const f of found.slice(0, MAX_LOCKS)) {
    const owner = team.find(cfg, f.commit.email) || team.find(cfg, bySha.get(f.commit.sha).login);
    const picked = f.signals.filter((s) => !/^(fix commit|feature commit|message says)/.test(s)).slice(0, 2);
    const lock = {
      id: `${f.type === 'feature' ? 'FEAT' : 'FIX'}-${String(reg.locks.filter((l) => l.type === f.type).length + 1).padStart(3, '0')}`,
      type: f.type, title: auto.cleanTitle(f.commit.subject),
      reason: f.commit.why || `${auto.cleanTitle(f.commit.subject)} (commit ${f.commit.sha.slice(0, 7)}${picked.length ? `; ${picked.join('; ')}` : ''})`,
      file: f.file, snippet: f.snippet,
      owner: owner ? owner.github || owner.name : bySha.get(f.commit.sha).login || f.commit.email,
      issue: auto.issueFrom(f.commit.subject, cfg), test: f.test, date: new Date().toISOString().slice(0, 10),
      source: { commit: f.commit.sha, discovered: true, score: f.score, signals: f.signals },
    };
    L.withCopies(lock, f.content);
    reg.locks.push(lock);
  }
  return reg;
}

function prBody(repo, cfg, reg, scanned, appUrl) {
  const n = reg.locks.length;
  const lines = [
    'This sets up [fixlock](https://abinandhmj.github.io/fixlock/) so fixed bugs stay fixed. **Merge it and the fixlock check turns on for every pull request.**',
    '',
    '## What it locks',
    '',
    n ? `fixlock read the last ${scanned} commits and locked the ${n} past fix${n > 1 ? 'es' : ''} it is surest about. A pull request that removes or rewrites these lines fails the **fixlock** check until the lock's owner approves it.` : `fixlock read the last ${scanned} commits and found no past fix it is sure enough about to lock automatically. Lock fixes as you make them: commits starting with \`fix:\` are locked automatically once the git hooks are installed (below), or run \`npx @abinandhmj/fixlock discover\` to review weaker candidates.`,
    '',
  ];
  if (n) {
    lines.push('| Lock | File | Owner | Why |', '|---|---|---|---|');
    for (const l of reg.locks) lines.push(`| ${l.id} ${l.title.replace(/\|/g, '\\|')} | \`${l.file}\` | ${l.owner} | ${(l.source.signals || []).slice(0, 2).join('; ').replace(/\|/g, '\\|')} |`);
    lines.push('', 'Something here shouldn\'t be locked? Delete its entry from `.fixlock/registry.json` in this PR before merging.', '');
  }
  lines.push('## Who approves', '', '| Name | GitHub | Role |', '|---|---|---|');
  for (const m of cfg.team) lines.push(`| ${m.name} | ${m.github ? `@${m.github}` : '(none)'} | ${m.role} |`);
  lines.push('', 'A locked fix can only be changed with its owner\'s approval (features: the owner or a lead). Edit `.fixlock/config.json` to change roles or policies.', '');
  lines.push('## After merging (optional, 1 minute)', '', 'For warnings before a commit, and to tell AI assistants (Claude Code, Cursor, Copilot, Codex) about the locks, run once in your clone:', '', '```bash', 'git pull && npx @abinandhmj/fixlock quickstart', '```', '', 'To stop blocked PRs from merging, make **fixlock** a required status check on the default branch.', '');
  lines.push(`Not now? Close this pull request: fixlock won't open it again. You can set it up later ${appUrl ? `from the [dashboard](${appUrl}/dashboard) ` : ''}or with \`npx @abinandhmj/fixlock quickstart\`.`);
  lines.push('', '<sub>[fixlock](https://abinandhmj.github.io/fixlock/) · fixed stays fixed · a product of Algotricz</sub>');
  return lines.join('\n');
}

/**
 * Open the setup pull request for one repository.
 * opts: { installer: GitHub login of the person setting it up, force: open a new one even if one was
 * closed before (the dashboard button), budget: max requests on `gh` }.
 * Returns { status: 'opened' | 'exists' | 'skipped', url?, reason?, locks? }.
 */
export async function proposeSetup(gh, fullName, opts = {}) {
  const budget = opts.budget || 45;
  const repo = await gh.get(`/repos/${fullName}`);
  if (repo.archived) return { status: 'skipped', reason: 'archived' };
  const branch = repo.default_branch || 'main';
  if ((await gh.file(fullName, '.fixlock/config.json', branch)) !== null) return { status: 'skipped', reason: 'already set up' };
  const owner = fullName.split('/')[0];
  const previous = await gh.get(`/repos/${fullName}/pulls?state=all&head=${encodeURIComponent(`${owner}:${SETUP_BRANCH}`)}&per_page=5`);
  const open = previous.find((p) => p.state === 'open');
  if (open) return { status: 'exists', url: open.html_url };
  if (previous.length && !opts.force) return { status: 'skipped', reason: 'a setup PR was closed before' };

  let list;
  try { list = await gh.get(`/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&per_page=100`); } catch (e) {
    if (/: 409/.test(e.message)) return { status: 'skipped', reason: 'empty repository' };
    throw e;
  }
  if (!list.length) return { status: 'skipped', reason: 'empty repository' };
  const head = list[0];
  const commits = list.map(toCommit);
  const cfg = config.mergeConfig({ project: repo.name, team: teamFrom(commits, opts.installer), prCheck: 'github-app' });
  const reg = await findLocks(gh, fullName, branch, commits, cfg, budget);

  const files = [
    { path: '.fixlock/config.json', content: JSON.stringify(cfg, null, 2) + '\n' },
    { path: '.fixlock/registry.json', content: JSON.stringify(reg, null, 2) + '\n' },
  ];
  const tree = await gh.post(`/repos/${fullName}/git/trees`, { base_tree: head.commit.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) });
  const commit = await gh.post(`/repos/${fullName}/git/commits`, { message: `chore: set up fixlock${reg.locks.length ? ` and lock ${reg.locks.length} past fix(es)` : ''}`, tree: tree.sha, parents: [head.sha] });
  const name = previous.length ? `${SETUP_BRANCH}-${new Date().toISOString().slice(0, 16).replace(/\D/g, '')}` : SETUP_BRANCH;
  await gh.post(`/repos/${fullName}/git/refs`, { ref: `refs/heads/${name}`, sha: commit.sha });
  const pr = await gh.post(`/repos/${fullName}/pulls`, {
    title: reg.locks.length ? `Set up fixlock: lock ${reg.locks.length} past fix${reg.locks.length > 1 ? 'es' : ''}` : 'Set up fixlock',
    head: name, base: branch, body: prBody(fullName, cfg, reg, commits.length, opts.appUrl),
  });
  return { status: 'opened', url: pr.html_url, number: pr.number, locks: reg.locks.length };
}
