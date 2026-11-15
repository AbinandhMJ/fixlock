'use strict';
// GitHub REST calls for the Regression Bench scripts. Uses the GitHub CLI (`gh api`) when it's installed
// and logged in, so no token handling is needed; otherwise fetch with GITHUB_TOKEN.
const { execFileSync, spawnSync } = require('child_process');

const API = process.env.GITHUB_API || 'https://api.github.com';
const hasGh = () => process.env.FIXLOCK_BENCH_FETCH !== '1' && spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0; // gh handles auth and reports its own login errors

function viaGh(method, path, body) {
  const args = ['api', '-X', method, path.replace(/^\//, ''), '-H', 'Accept: application/vnd.github+json'];
  if (body) args.push('--input', '-');
  const r = spawnSync('gh', args, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${method} ${path}: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

async function viaFetch(method, path, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Log in with `gh auth login`, or set GITHUB_TOKEN.');
  const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fixlock-regression-bench', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

let useGh;
/** api(method, path, body?) → parsed JSON */
async function api(method, path, body) {
  if (useGh === undefined) useGh = hasGh();
  return useGh ? viaGh(method, path, body) : viaFetch(method, path, body);
}

/** Every page of a list endpoint. Check-run lists come back as { check_runs: [...] }. */
async function all(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const items = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const list = Array.isArray(items) ? items : (items && items.check_runs) || [];
    out.push(...list);
    if (list.length < 100) return out;
  }
}

module.exports = { api, all, execFileSync };
