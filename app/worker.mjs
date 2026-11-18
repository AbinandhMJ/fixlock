// fixlock GitHub App: a Cloudflare Worker that receives GitHub webhooks and runs the fixlock check on every
// pull request, with nothing to install in the repository except its .fixlock/ folder.
//
// Secrets (wrangler secret put …): APP_ID, PRIVATE_KEY (the app's .pem), WEBHOOK_SECRET.
// Team dashboard (/dashboard), optional: CLIENT_ID, CLIENT_SECRET, SESSION_SECRET.
// Setup PRs on install need the Contents: Read and write permission. Optional vars: AUTO_SETUP=off,
// SUBREQUEST_BUDGET (default 45; raise it on the Workers Paid plan).
// Optional vars: GITHUB_API / GITHUB_WEB (GitHub Enterprise Server API and web URLs).
import { verifySignature, installationClient, client } from './github.mjs';
import { publish, CHECK_NAME } from './review.mjs';
import * as session from './session.mjs';
import * as pages from './pages.mjs';
import { visibleRepos, cachedSummary } from './dashboard.mjs';
import { proposeSetup } from './setup.mjs';

const SECURITY = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cache-control': 'private, no-store',
};
const html = (body, status = 200) => new Response(body, { status, headers: SECURITY });

/** Run tasks with at most `n` at a time. */
async function limit(n, items, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/** "Set up" on the dashboard: open the setup PR, if the person can push to the repository. */
async function dashboardSetup(request, env, url) {
  // Session cookies are SameSite=Lax (not sent on cross-site POSTs); also insist on our own Origin.
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden\n', { status: 403 });
  if (!session.configured(env)) return html(pages.landing(false), 503);
  const user = await session.currentUser(request, env);
  if (!user) return html(pages.landing(true), 401);
  const m = url.pathname.match(/^\/dashboard\/setup\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return new Response('Not found\n', { status: 404 });
  const full = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`.toLowerCase();
  const groups = await visibleRepos(env, user.token);
  let found = null;
  for (const g of groups) { const r = g.repos.find((x) => x.full_name.toLowerCase() === full); if (r) found = { g, r }; }
  if (!found) return html(pages.layout('Not found', '<h1>Not found</h1><p>This repository doesn\'t exist, the fixlock GitHub App isn\'t installed on it, or you don\'t have access to it.</p>', user), 404);
  const mine = await client(user.token, env.GITHUB_API || 'https://api.github.com').get(`/repos/${found.r.full_name}`);
  const p = mine.permissions || {};
  if (!(p.admin || p.maintain || p.push)) return html(pages.layout('Not allowed', `<h1>Not allowed</h1><p>Setting up fixlock opens a pull request, so it needs write access to ${pages.esc(found.r.full_name)}. Ask a maintainer to press Set up.</p><p><a href="/dashboard">Back</a></p>`, user), 403);
  const gh = await installationClient(env, found.g.installation);
  let res;
  try { res = await proposeSetup(gh, found.r.full_name, { installer: user.login, force: true, budget: budgetOf(env) - 2, appUrl: url.origin }); } catch (e) {
    if (/: 403/.test(e.message)) return html(pages.layout('Permission needed', '<h1>The App can\'t open pull requests yet</h1><p>Setting up needs the fixlock GitHub App to have <b>Contents: Read and write</b>. An owner of the account accepts the new permission on GitHub, under Settings, Applications, fixlock.</p><p><a href="/dashboard">Back</a></p>', user), 403);
    throw e;
  }
  if (res.url) return Response.redirect(res.url, 303);
  return html(pages.layout('Nothing to do', `<h1>Nothing to set up</h1><p>${pages.esc(found.r.full_name)}: ${pages.esc(res.reason || res.status)}.</p><p><a href="/dashboard">Back</a></p>`, user));
}

/** The team dashboard: /dashboard, /dashboard/<owner>/<repo>, /login, /auth/callback, /logout. */
async function dashboard(request, env, url) {
  const p = url.pathname;
  if (p === '/logout') return session.logout();
  if (!session.configured(env)) return html(pages.landing(false), 503);
  if (p === '/login') return session.login(request, env, url.searchParams.get('next') || '/dashboard');
  if (p === '/auth/callback') return session.callback(request, env);
  const user = await session.currentUser(request, env);
  if (!user) return html(pages.landing(true), 401);

  let groups;
  try { groups = await visibleRepos(env, user.token); } catch (e) {
    if (/: 401/.test(e.message)) return session.login(request, env, p); // token expired or revoked: sign in again
    throw e;
  }
  const fresh = url.searchParams.get('refresh') === '1';
  const m = p.match(/^\/dashboard\/([^/]+)\/([^/]+)\/?$/);
  if (m) {
    const full = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`.toLowerCase();
    for (const g of groups) {
      const repo = g.repos.find((r) => r.full_name.toLowerCase() === full);
      if (repo) return html(pages.repoPage(user, await cachedSummary(env, g.installation, repo, fresh)));
    }
    return html(pages.layout('Not found', '<h1>Not found</h1><p>This repository doesn\'t exist, the fixlock GitHub App isn\'t installed on it, or you don\'t have access to it.</p>', user), 404);
  }
  if (p !== '/dashboard' && p !== '/dashboard/') return new Response('Not found\n', { status: 404 });
  const withSummaries = [];
  for (const g of groups) withSummaries.push({ account: g.account, summaries: await limit(4, g.repos, (r) => cachedSummary(env, g.installation, r, fresh)) });
  return html(pages.overview(user, withSummaries));
}

const PR_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);
const REVIEW_ACTIONS = new Set(['submitted', 'dismissed', 'edited']);

/** The pull request a webhook is about, if it should be (re)checked. Returns { pr } or { prNumber, repo } or null. */
export function target(event, payload) {
  if (event === 'pull_request') {
    if (PR_ACTIONS.has(payload.action) || (payload.action === 'edited' && payload.changes && payload.changes.base)) return { pr: payload.pull_request };
    return null;
  }
  if (event === 'pull_request_review' && REVIEW_ACTIONS.has(payload.action)) return { prNumber: payload.pull_request.number, repo: payload.repository.full_name };
  if (event === 'check_run' && payload.action === 'rerequested' && payload.check_run.name === CHECK_NAME) {
    const pr = (payload.check_run.pull_requests || [])[0];
    return pr ? { prNumber: pr.number, repo: payload.repository.full_name } : null;
  }
  return null;
}

/** The Worker's per-request subrequest limit, minus the installation token request. */
const budgetOf = (env) => Number(env.SUBREQUEST_BUDGET || 45) - 1;

/**
 * Installed on new repositories: open a "Set up fixlock" PR in each one without .fixlock/, as long as the
 * request budget allows (the rest can be set up from the dashboard). AUTO_SETUP=off turns this off.
 */
async function setupInstalled(env, payload, appUrl) {
  if (String(env.AUTO_SETUP || '').toLowerCase() === 'off') return;
  const repos = payload.repositories || payload.repositories_added || [];
  if (!repos.length) return;
  const gh = await installationClient(env, payload.installation.id);
  const budget = budgetOf(env);
  for (const r of repos) {
    if (budget - gh.calls < 20) { console.log(`fixlock setup: request budget used; ${r.full_name} and later repos can be set up from the dashboard`); break; }
    try {
      const res = await proposeSetup(gh, r.full_name, { installer: payload.sender && payload.sender.login, budget, appUrl });
      console.log(`fixlock setup ${r.full_name}: ${res.status}${res.url ? ` ${res.url}` : ''}${res.reason ? ` (${res.reason})` : ''}`);
    } catch (e) {
      console.error(`fixlock setup ${r.full_name} failed${/: 403/.test(e.message) ? ' (the App needs Contents: Read and write to open setup PRs)' : ''}:`, e.message);
    }
  }
}

async function handle(env, event, payload, appUrl) {
  if ((event === 'installation' && payload.action === 'created') || (event === 'installation_repositories' && payload.action === 'added')) return setupInstalled(env, payload, appUrl);
  const t = target(event, payload);
  if (!t || !payload.installation) return;
  const gh = await installationClient(env, payload.installation.id);
  // For reviews and re-runs, fetch the PR fresh: its head may have moved since the event.
  const pr = t.pr || await gh.get(`/repos/${t.repo}/pulls/${t.prNumber}`);
  if (pr.state && pr.state !== 'open') return;
  await publish(gh, pr);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if (/^\/(dashboard|login|logout|auth\/callback)(\/|$)/.test(url.pathname)) {
        try { return await dashboard(request, env, url); } catch (e) {
          console.error('fixlock dashboard:', e);
          return html(pages.layout('Error', `<h1>Something went wrong</h1><p>${pages.esc(String(e.message || e).slice(0, 300))}</p><p><a href="/dashboard">Try again</a></p>`), 500);
        }
      }
      return new Response('fixlock GitHub App is running. Team dashboard: /dashboard · https://abinandhmj.github.io/fixlock/github-app\n', { headers: { 'content-type': 'text/plain' } });
    }
    if (request.method === 'POST' && url.pathname.startsWith('/dashboard/setup/')) {
      try { return await dashboardSetup(request, env, url); } catch (e) {
        console.error('fixlock dashboard setup:', e);
        return html(pages.layout('Error', `<h1>Something went wrong</h1><p>${pages.esc(String(e.message || e).slice(0, 300))}</p><p><a href="/dashboard">Try again</a></p>`), 500);
      }
    }
    if (request.method !== 'POST' || (url.pathname !== '/' && url.pathname !== '/webhook')) return new Response('Not found\n', { status: 404 });

    const body = await request.text();
    // Say exactly what's wrong: GitHub shows this text under the delivery's Response tab.
    if (!String(env.WEBHOOK_SECRET || '').trim()) {
      console.error('fixlock: WEBHOOK_SECRET is not set on this Worker');
      return new Response('WEBHOOK_SECRET is not set on this Worker. Run: npx wrangler secret put WEBHOOK_SECRET\n', { status: 500 });
    }
    const signature = request.headers.get('x-hub-signature-256');
    if (!signature) return new Response('No X-Hub-Signature-256 header: set a webhook secret on the GitHub App\n', { status: 401 });
    if (!(await verifySignature(env.WEBHOOK_SECRET, body, signature))) {
      console.warn(`fixlock: signature mismatch (${request.headers.get('x-github-event')}, ${body.length} bytes)`);
      return new Response("Bad signature: the GitHub App's webhook secret and this Worker's WEBHOOK_SECRET don't match\n", { status: 401 });
    }
    const event = request.headers.get('x-github-event');
    if (event === 'ping') return new Response('pong\n');
    let payload;
    try { payload = JSON.parse(body); } catch { return new Response('Bad JSON\n', { status: 400 }); }

    // GitHub waits at most 10 s for an answer; do the work after replying.
    ctx.waitUntil(handle(env, event, payload, url.origin).catch((e) => console.error(`fixlock: ${event} failed`, e)));
    return new Response('Accepted\n', { status: 202 });
  },
};
