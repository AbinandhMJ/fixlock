'use strict';
const fs = require('fs');
const g = require('./git');

/** "owner/repo" from GITHUB_REPOSITORY or the origin remote URL. */
function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = (g.git(['remote', 'get-url', 'origin'], { allowFail: true }) || '').trim();
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

/** PR number from --pr, Jenkins (CHANGE_ID) or GitHub Actions event payload. */
function prNumber(arg) {
  if (arg && arg !== true) return String(arg);
  if (process.env.CHANGE_ID) return process.env.CHANGE_ID;
  if (process.env.GITHUB_EVENT_PATH) {
    try { return String(JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request.number); } catch { /* not a PR */ }
  }
  return null;
}

/**
 * GitHub usernames whose latest review on the PR is APPROVED.
 * Returns { approvers: Set, source, error? }
 */
async function prApprovers(prArg) {
  if (process.env.FIXLOCK_TEST_APPROVERS !== undefined) {
    return { approvers: new Set(process.env.FIXLOCK_TEST_APPROVERS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)), source: 'test' };
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const pr = prNumber(prArg);
  const slug = repoSlug();
  if (!token || !pr || !slug) return { approvers: new Set(), source: 'none' };
  const api = process.env.FIXLOCK_GITHUB_API || 'https://api.github.com';
  try {
    const res = await fetch(`${api}/repos/${slug}/pulls/${pr}/reviews?per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fixlock' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const latest = {};
    for (const r of await res.json()) if (r.user && r.state !== 'COMMENTED') latest[r.user.login.toLowerCase()] = r.state;
    return { approvers: new Set(Object.keys(latest).filter((u) => latest[u] === 'APPROVED')), source: `github ${slug}#${pr}`, pr, slug };
  } catch (e) {
    return { approvers: new Set(), source: 'github', error: e.message };
  }
}

module.exports = { prApprovers, prNumber, repoSlug };
