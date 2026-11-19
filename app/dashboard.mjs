// Data for the fixlock team dashboard, read live from GitHub (no database): which repositories the
// signed-in person can see, and for each one its locks, their state on the default branch, open pull
// requests with their fixlock check, and recent pull requests fixlock stopped.
import { client, installationClient } from './github.mjs';
import config from '../src/config.js';
import L from '../src/locks.js';
import team from '../src/team.js';

const CACHE_SECONDS = 300;
const MAX_REPOS = 50;

/** Every page of an endpoint whose list sits under `key` ({ total_count, <key>: [...] }). */
async function pages(gh, path, key, max = 500) {
  const out = [];
  for (let page = 1; out.length < max; page++) {
    const r = await gh.get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const items = (key ? r[key] : r) || [];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

/**
 * The installations of this app the person can see, with the repositories they can access in each.
 * GitHub answers this from the person's own token, so nobody sees a repository they couldn't open.
 */
export async function visibleRepos(env, userToken) {
  const user = client(userToken, env.GITHUB_API || 'https://api.github.com');
  const installs = await pages(user, '/user/installations', 'installations', 100);
  const out = [];
  for (const inst of installs) {
    if (env.APP_ID && inst.app_id && String(inst.app_id) !== String(env.APP_ID)) continue;
    const repos = await pages(user, `/user/installations/${inst.id}/repositories`, 'repositories', MAX_REPOS);
    out.push({ installation: inst.id, account: inst.account && inst.account.login, repos: repos.map((r) => ({ full_name: r.full_name, default_branch: r.default_branch, private: r.private, html_url: r.html_url })) });
  }
  return out;
}

/** Latest fixlock check run on a commit, and whether any fixlock run on it failed. */
async function fixlockChecks(gh, repo, sha) {
  const r = await gh.get(`/repos/${repo}/commits/${sha}/check-runs?check_name=fixlock&per_page=100`);
  const runs = (r.check_runs || []).filter((c) => c.status === 'completed').sort((a, b) => (a.completed_at < b.completed_at ? -1 : 1));
  if (!runs.length) return null;
  const last = runs[runs.length - 1];
  return { conclusion: last.conclusion, title: (last.output && last.output.title) || '', url: last.html_url, everFailed: runs.some((c) => c.conclusion === 'failure') };
}

/** Everything the dashboard shows for one repository. */
export async function repoSummary(gh, repo) {
  const ref = repo.default_branch || 'main';
  const name = repo.full_name;
  const rawCfg = await gh.file(name, '.fixlock/config.json', ref);
  if (rawCfg === null) return { repo: name, url: repo.html_url, private: repo.private, setUp: false };
  let cfg, reg;
  try {
    cfg = config.mergeConfig(JSON.parse(rawCfg));
    const rawReg = await gh.file(name, '.fixlock/registry.json', ref);
    reg = config.normalizeRegistry(rawReg === null ? null : JSON.parse(rawReg));
  } catch (e) {
    return { repo: name, url: repo.html_url, private: repo.private, setUp: true, error: `.fixlock/ is not valid JSON: ${e.message}` };
  }

  // Locks, and whether each still matches the default branch. A changed one was edited on purpose
  // (approved) or outside the PR check, and should be locked again on its new lines.
  const files = new Map();
  const read = (f) => { if (!files.has(f)) files.set(f, gh.file(name, f, ref)); return files.get(f); };
  const locks = [];
  for (const lock of reg.locks) {
    const content = await read(lock.file);
    const v = content === null ? { status: 'changed' } : L.verifyLock(lock, content, { mode: (cfg.matching || {}).mode, file: lock.file });
    const owner = team.find(cfg, lock.owner);
    locks.push({
      id: lock.id, type: lock.type, title: lock.title, file: lock.file, issue: lock.issue || null,
      owner: team.handle(owner) || lock.owner || '', ownerHasGithub: !!(owner && owner.github), ownerOnTeam: !!owner,
      test: lock.test || null, expires: lock.expires || null, expired: !!lock.expires && lock.expires < new Date().toISOString().slice(0, 10),
      approvers: team.approvers(cfg, lock).map(team.handle).filter(Boolean),
      state: content === null ? 'file missing' : v.status === 'changed' ? 'needs re-lock' : v.status === 'renamed' ? 'renamed' : 'intact',
    });
  }

  const open = (await gh.get(`/repos/${name}/pulls?state=open&sort=updated&direction=desc&per_page=30`)) || [];
  const openPrs = [];
  for (const pr of open) {
    const check = await fixlockChecks(gh, name, pr.head.sha);
    openPrs.push({ number: pr.number, title: pr.title, url: pr.html_url, author: pr.user && pr.user.login, draft: pr.draft, check });
  }

  // Recently closed PRs that fixlock stopped at least once on their final commit.
  const closed = (await gh.get(`/repos/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=20`)) || [];
  const stopped = [];
  for (const pr of closed) {
    const check = await fixlockChecks(gh, name, pr.head.sha);
    if (!check || !check.everFailed) continue;
    stopped.push({
      number: pr.number, title: pr.title, url: pr.html_url, merged: !!pr.merged_at, closedAt: pr.closed_at,
      outcome: check.conclusion === 'success' ? (pr.merged_at ? 'approved, then merged' : 'approved, not merged') : pr.merged_at ? 'merged while blocked' : 'closed without merging',
    });
  }

  const noGithub = cfg.team.filter((m) => !m.github && m.role !== 'reviewer').map((m) => m.name);
  return {
    repo: name, url: repo.html_url, private: repo.private, setUp: true, defaultBranch: ref,
    team: cfg.team.map((m) => ({ name: m.name, github: m.github || null, role: m.role })),
    noGithub, locks, openPrs, stopped,
    counts: {
      locks: locks.length,
      needsRelock: locks.filter((l) => l.state === 'needs re-lock' || l.state === 'file missing').length,
      expired: locks.filter((l) => l.expired).length,
      orphaned: locks.filter((l) => l.owner && !l.ownerOnTeam).length,
      withTests: locks.filter((l) => l.test).length,
      blocked: openPrs.filter((p) => p.check && p.check.conclusion === 'failure').length,
      stopped: stopped.length,
      overrides: stopped.filter((s) => s.outcome.startsWith('approved')).length,
    },
  };
}

/** A repository's summary, cached for a few minutes (Cloudflare's edge cache) to spare GitHub's API. */
export async function cachedSummary(env, installation, repo, fresh = false) {
  const store = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = new Request(`https://fixlock-dashboard.cache/${installation}/${repo.full_name}`);
  if (store && !fresh) {
    const hit = await store.match(key);
    if (hit) return hit.json();
  }
  const gh = await installationClient(env, installation);
  const summary = { ...(await repoSummary(gh, repo)), checkedAt: new Date().toISOString() };
  if (store) await store.put(key, new Response(JSON.stringify(summary), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_SECONDS}` } }));
  return summary;
}
