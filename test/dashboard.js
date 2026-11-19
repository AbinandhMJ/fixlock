'use strict';
// Team dashboard (app/): GitHub sign-in, access control, data and pages, against a fake GitHub. No network.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = crypto.webcrypto;

let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 1500)}` : ''}`); console.error('DASHBOARD FAIL'); process.exit(1); } passed++; };

const CONFIG = JSON.stringify({ team: [
  { name: 'Ravi', github: 'ravi', emails: ['ravi@example.com'], role: 'lead' },
  { name: 'Meena', github: null, emails: ['meena@example.com'], role: 'developer' },
] });
const REGISTRY = JSON.stringify({ version: 2, locks: [
  { id: 'FIX-001', type: 'bug', title: 'never charge zero', file: 'pay.py', snippet: ['    if amount <= 0:', '        raise ValueError("bad")'], owner: 'Ravi', test: 'tests/test_pay.py' },
  { id: 'FIX-002', type: 'bug', title: 'retry on timeout', file: 'net.py', snippet: ['    for attempt in range(3):', '        resp = send()'], owner: 'Meena' },
] });
const FILES = {
  'acme/shop@main:.fixlock/config.json': CONFIG,
  'acme/shop@main:.fixlock/registry.json': REGISTRY,
  'acme/shop@main:pay.py': 'def pay(amount):\n    if amount <= 0:\n        raise ValueError("bad")\n    return charge(amount)\n',
  'acme/shop@main:net.py': 'def call():\n    return send()\n', // FIX-002's lines are gone on main → needs re-lock
};
const CHECKS = {
  h7: [{ status: 'completed', conclusion: 'failure', completed_at: '2026-11-18T10:00:00Z', html_url: 'https://gh.test/c/1', output: { title: '1 locked change(s) need approval' } }],
  c5: [
    { status: 'completed', conclusion: 'failure', completed_at: '2026-11-17T09:00:00Z', html_url: 'https://gh.test/c/2', output: { title: '1 locked change(s) need approval' } },
    { status: 'completed', conclusion: 'success', completed_at: '2026-11-17T10:00:00Z', html_url: 'https://gh.test/c/3', output: { title: '1 locked change(s), all approved' } },
  ],
  c6: [{ status: 'completed', conclusion: 'success', completed_at: '2026-11-16T10:00:00Z', html_url: 'https://gh.test/c/4', output: { title: 'All 2 locks intact' } }],
};
const calls = [];

async function fakeFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
  calls.push(`${method} ${url.host}${url.pathname}`);
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  if (url.host === 'gh.test' && url.pathname === '/login/oauth/access_token') {
    const body = JSON.parse(init.body);
    return json(body.code === 'good' && body.client_secret === 'csecret' ? { access_token: 'user-ravi' } : { error: 'bad_verification_code' });
  }
  const p = url.pathname;
  if (p === '/user') return auth === 'Bearer user-ravi' ? json({ login: 'ravi' }) : json({}, 401);
  if (p === '/user/installations') return auth === 'Bearer user-ravi' ? json({ installations: [{ id: 99, app_id: 1234, account: { login: 'acme' } }, { id: 77, app_id: 999, account: { login: 'other-app' } }] }) : json({ message: 'Bad credentials' }, 401);
  if (p === '/user/installations/99/repositories') return json({ repositories: url.searchParams.get('page') === '1' ? [
    { full_name: 'acme/shop', default_branch: 'main', private: true, html_url: 'https://gh.test/acme/shop' },
    { full_name: 'acme/plain', default_branch: 'main', private: false, html_url: 'https://gh.test/acme/plain' },
  ] : [] });
  if (p === '/app/installations/99/access_tokens') return json({ token: 'inst-99' }, 201);
  if (!auth.startsWith('Bearer inst-')) return json({ message: `no installation token for ${p}` }, 401);
  let m;
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/))) {
    const k = `${m[1]}@${url.searchParams.get('ref')}:${decodeURIComponent(m[2])}`;
    return k in FILES ? new Response(FILES[k]) : json({ message: 'Not Found' }, 404);
  }
  if (p === '/repos/acme/shop/pulls') {
    if (url.searchParams.get('state') === 'open') return json([{ number: 7, title: 'refactor: simplify <script>alert(1)</script>', html_url: 'https://gh.test/acme/shop/pull/7', user: { login: 'meena' }, head: { sha: 'h7' }, draft: false }]);
    return json([
      { number: 5, title: 'port billing from v1', html_url: 'https://gh.test/acme/shop/pull/5', merged_at: '2026-11-17T11:00:00Z', closed_at: '2026-11-17T11:00:00Z', head: { sha: 'c5' } },
      { number: 6, title: 'docs', html_url: 'https://gh.test/acme/shop/pull/6', merged_at: '2026-11-16T11:00:00Z', closed_at: '2026-11-16T11:00:00Z', head: { sha: 'c6' } },
    ]);
  }
  if ((m = p.match(/^\/repos\/acme\/shop\/commits\/(\w+)\/check-runs$/))) return json({ check_runs: CHECKS[m[1]] || [] });
  return json({ message: `unhandled ${p}` }, 500);
}

(async () => {
  global.fetch = fakeFetch;
  const worker = (await import(pathToFileURL(path.join(__dirname, '..', 'app', 'worker.mjs')))).default;
  const { seal, unseal } = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'session.mjs')));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = {
    APP_ID: '1234', PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }), WEBHOOK_SECRET: 'shh',
    CLIENT_ID: 'Iv1.abc', CLIENT_SECRET: 'csecret', SESSION_SECRET: 'session-secret-123', GITHUB_API: 'https://api.gh.test', GITHUB_WEB: 'https://gh.test',
  };
  const get = (p, cookie = '', e = env) => worker.fetch(new Request(`https://app.test${p}`, { headers: cookie ? { cookie } : {} }), e, { waitUntil() {} });
  const setCookies = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).filter(Boolean);

  // Session sealing
  const sealed = await seal('k1', { a: 1 });
  ok((await unseal('k1', sealed)).a === 1 && (await unseal('k2', sealed)) === null && (await unseal('k1', sealed.slice(0, -3) + 'AAA')) === null, 'session cookie: decrypts with its secret only, tampering is rejected');

  // Not configured → a page that says what's missing
  let res = await get('/dashboard', '', { ...env, CLIENT_ID: '' });
  ok(res.status === 503 && /CLIENT_ID/.test(await res.text()), 'dashboard not configured: 503 saying which settings are missing');

  // Signed out → sign-in page
  res = await get('/dashboard');
  const landing = await res.text();
  ok(res.status === 401 && landing.includes('href="/login"') && /Sign in with GitHub/.test(landing), 'signed out: sign-in page');
  ok(/default-src 'none'/.test(res.headers.get('content-security-policy')) && res.headers.get('cache-control') === 'private, no-store', 'pages send a strict CSP and no-store');

  // Sign in
  res = await get('/login');
  const loc = new URL(res.headers.get('location'));
  const stateCookie = setCookies(res).find((c) => c.startsWith('fixlock_oauth_state='));
  ok(res.status === 302 && loc.host === 'gh.test' && loc.pathname === '/login/oauth/authorize' && loc.searchParams.get('client_id') === 'Iv1.abc' && loc.searchParams.get('redirect_uri') === 'https://app.test/auth/callback', 'login redirects to GitHub with the app\'s client id and callback');
  ok(/HttpOnly/.test(stateCookie) && /Secure/.test(stateCookie) && /SameSite=Lax/.test(stateCookie), 'state cookie is HttpOnly, Secure, SameSite=Lax');
  const state = loc.searchParams.get('state');
  const stateValue = stateCookie.split(';')[0];
  res = await get(`/auth/callback?code=good&state=wrong`, stateValue);
  ok(res.status === 400, 'callback with a different state is refused (CSRF)');
  res = await get(`/auth/callback?code=bad&state=${state}`, stateValue);
  ok(res.status === 400, 'callback with a code GitHub rejects is refused');
  res = await get(`/auth/callback?code=good&state=${state}`, stateValue);
  const sessionCookie = setCookies(res).find((c) => c.startsWith('fixlock_session=') && !/Max-Age=0/.test(c));
  ok(res.status === 302 && res.headers.get('location') === '/dashboard' && sessionCookie && /HttpOnly/.test(sessionCookie), 'good callback: session cookie set, back to the dashboard');
  ok(!sessionCookie.includes('user-ravi'), "the GitHub token isn't readable in the cookie (encrypted)");
  const cookie = sessionCookie.split(';')[0];

  // Overview
  res = await get('/dashboard', cookie);
  let page = await res.text();
  ok(res.status === 200 && page.includes('@ravi') && page.includes('href="/dashboard/acme/shop"'), 'overview lists the repositories the person can see', page);
  ok(/1 PRs waiting for approval/.test(page) && /1 recently stopped/.test(page) && /1 to re-lock/.test(page), 'overview shows each repo\'s waiting PRs, stopped PRs and locks to re-lock', page);
  ok(/Not set up yet[^]*acme\/plain/.test(page), 'repos without .fixlock are listed as not set up');
  ok(!page.includes('other-app'), "installations of other apps aren't shown");

  // Repo page
  res = await get('/dashboard/acme/shop', cookie);
  page = await res.text();
  ok(res.status === 200 && page.includes('FIX-001') && page.includes('never charge zero') && page.includes('FIX-002'), 'repo page lists the locks', page);
  ok(/FIX-002[^]*Needs re-lock/.test(page) && /FIX-001[^]*Intact/.test(page), "locks are checked against the default branch (FIX-002's lines are gone: needs re-lock)");
  ok(/#7[^]*Needs approval/.test(page) && page.includes('1 locked change(s) need approval'), 'open PR blocked by fixlock: needs approval');
  ok(/#5 port billing from v1[^]*approved, then merged/.test(page) && !/#6 docs/.test(page), 'recently stopped: PR #5 blocked then approved; PR #6 never stopped is left out');
  ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !page.includes('<script>alert(1)'), 'PR titles are escaped');
  ok(/FIX-001[^]*test-linked/.test(page) && /1\/2<\/b>locks proved by a test/.test(page) && /fixlock relock --changed/.test(page), 'repo page: test-linked locks, the proved count, and the relock command', page);
  ok(/Meena has no GitHub username/.test(page) && /no GitHub username/.test(page), 'warns when someone who owns locks has no GitHub username');

  // Access control
  res = await get('/dashboard/acme/secret', cookie);
  ok(res.status === 404 && !calls.some((c) => c.includes('acme/secret')), "a repo the person can't see: 404, and fixlock never reads it");
  res = await get('/dashboard/acme/shop', cookie.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')));
  ok(res.status === 401, 'tampered session cookie: signed out');
  const expired = `fixlock_session=${encodeURIComponent(await seal(env.SESSION_SECRET, { token: 'user-ravi', login: 'ravi', exp: Date.now() - 1000 }))}`;
  res = await get('/dashboard', expired);
  ok(res.status === 401, 'expired session: signed out');

  // Sign out
  res = await get('/logout', cookie);
  ok(res.status === 302 && setCookies(res).some((c) => /^fixlock_session=;/.test(c) && /Max-Age=0/.test(c)), 'sign out clears the session');

  // Webhooks still work alongside
  res = await worker.fetch(new Request('https://app.test/'), env, { waitUntil() {} });
  ok(res.status === 200 && /dashboard/.test(await res.text()), 'health check still answers and points to the dashboard');

  console.log(`DASHBOARD PASS (${passed} checks)`);
})().catch((e) => { console.error(e); console.error('DASHBOARD FAIL'); process.exit(1); });
