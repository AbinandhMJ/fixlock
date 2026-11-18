'use strict';
// One-click setup (app/setup.mjs): the GitHub App opens a "Set up fixlock" PR when it's installed, or when
// someone presses Set up on the dashboard. Against a fake GitHub; no network.
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = crypto.webcrypto;

let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2000)}` : ''}`); console.error('SETUP FAIL'); process.exit(1); } passed++; };

const PAY_FIXED = 'def pay(amount):\n    if amount <= 0:\n        raise ValueError("amount must be positive")\n    return charge(amount)\n';
const commit = (sha, message, login, email, tree = 't-' + sha) => ({ sha, commit: { message, author: { name: login === 'abi' ? 'Abi' : login, email }, tree: { sha: tree } }, author: login ? { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' } : null });

function world() {
  const w = {
    repo: { name: 'shop', default_branch: 'main', archived: false },
    files: { 'pay.py': PAY_FIXED, 'net.py': 'def call():\n    return send()\n' },
    commits: [
      commit('c4', 'docs: readme', 'meena', 'meena@x.com'),
      commit('c3', 'fix: retry on timeout (#9)', 'meena', 'meena@x.com'), // its lines are gone from main → not locked
      commit('c2', 'fix: zero charge crashed the ledger (#12)\n\nRefunds of 0 broke the ledger totals.', 'abi', 'abi@x.com'),
      commit('c1', 'chore: deps', 'dependabot[bot]', 'bot@x.com'),
      commit('c0', 'init', 'abi', 'abi@x.com'),
    ],
    details: {
      c2: { files: [
        { filename: 'pay.py', status: 'modified', additions: 2, patch: '@@ -1,2 +1,4 @@\n def pay(amount):\n+    if amount <= 0:\n+        raise ValueError("amount must be positive")\n     return charge(amount)' },
        { filename: 'tests/test_pay.py', status: 'added', additions: 2, patch: '@@ -0,0 +1,2 @@\n+def test_zero():\n+    pass' },
      ] },
      c3: { files: [
        { filename: 'net.py', status: 'modified', additions: 2, patch: '@@ -1,2 +1,3 @@\n def call():\n+    for attempt in range(3):\n+        resp = send()' },
        { filename: 'tests/test_net.py', status: 'added', additions: 1, patch: '@@ -0,0 +1 @@\n+def test_retry(): pass' },
      ] },
    },
    pulls: [], created: {}, calls: [], userPerms: { push: true },
  };
  w.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    const p = url.pathname;
    w.calls.push(`${method} ${p}`);
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    const body = init.body ? JSON.parse(init.body) : null;
    if (p === '/login/oauth/access_token') return json({ access_token: 'user-abi' });
    if (p === '/user') return json({ login: 'abi' });
    if (p === '/user/installations') return json({ installations: [{ id: 5, app_id: 1234, account: { login: 'acme' } }] });
    if (p === '/user/installations/5/repositories') return json({ repositories: url.searchParams.get('page') === '1' ? [{ full_name: 'acme/shop', default_branch: 'main', html_url: 'https://gh.test/acme/shop' }] : [] });
    if (p === '/app/installations/5/access_tokens') return json({ token: 'inst' }, 201);
    if (auth === 'Bearer user-abi' && p === '/repos/acme/shop') return json({ ...w.repo, permissions: w.userPerms });
    if (auth !== 'Bearer inst') return json({ message: 'Bad credentials' }, 401);
    if (p === '/repos/acme/shop' && method === 'GET') return json(w.repo);
    let m;
    if ((m = p.match(/^\/repos\/acme\/shop\/contents\/(.+)$/))) {
      const f = decodeURIComponent(m[1]);
      return f in w.files ? new Response(w.files[f]) : json({ message: 'Not Found' }, 404);
    }
    if (p === '/repos/acme/shop/pulls' && method === 'GET') {
      const head = url.searchParams.get('head');
      return json(w.pulls.filter((x) => !head || `acme:${x.head}` === head));
    }
    if (p === '/repos/acme/shop/commits') return w.commits.length ? json(w.commits) : json({ message: 'Git Repository is empty.' }, 409);
    if ((m = p.match(/^\/repos\/acme\/shop\/commits\/(\w+)$/))) return json(w.details[m[1]] || { files: [] });
    if (w.denyWrites && method === 'POST') return json({ message: 'Resource not accessible by integration' }, 403);
    if (p === '/repos/acme/shop/git/trees') { w.created.tree = body; return json({ sha: 'tree1' }, 201); }
    if (p === '/repos/acme/shop/git/commits') { w.created.commit = body; return json({ sha: 'commit1' }, 201); }
    if (p === '/repos/acme/shop/git/refs') { w.created.ref = body; return json({ ref: body.ref }, 201); }
    if (p === '/repos/acme/shop/pulls' && method === 'POST') { w.created.pr = body; const pr = { number: 50, html_url: 'https://gh.test/acme/shop/pull/50', state: 'open', head: body.head }; w.pulls.push(pr); return json(pr, 201); }
    return json({ message: `unhandled ${method} ${p}` }, 500);
  };
  return w;
}

(async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { APP_ID: '1234', PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }), WEBHOOK_SECRET: 'shh', CLIENT_ID: 'Iv1', CLIENT_SECRET: 'cs', SESSION_SECRET: 'sess', GITHUB_API: 'https://api.gh.test', GITHUB_WEB: 'https://gh.test' };
  const worker = (await import(pathToFileURL(path.join(__dirname, '..', 'app', 'worker.mjs')))).default;
  const { addedBlocks, teamFrom } = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'setup.mjs')));
  const { seal } = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'session.mjs')));

  // Pure helpers
  const blocks = addedBlocks('@@ -1,3 +1,5 @@\n a\n+b\n+c\n d\n-e\n+f\n@@ -9 +11 @@\n+g');
  ok(JSON.stringify(blocks) === JSON.stringify([['b', 'c'], ['f'], ['g']]), 'addedBlocks: runs of added lines; context and hunks split them', JSON.stringify(blocks));
  const t = teamFrom(world().commits.map((c) => ({ login: c.author && !c.author.login.endsWith('[bot]') ? c.author.login : null, bot: c.author && c.author.login.endsWith('[bot]'), email: c.commit.author.email, name: c.commit.author.name })), 'abi');
  ok(t[0].github === 'abi' && t[0].role === 'lead' && t[0].emails.includes('abi@x.com') && t[1].github === 'meena' && t[1].role === 'developer' && t.length === 2, 'team: installer leads, commit authors are developers, bots left out', JSON.stringify(t));

  // Webhook: installation created
  const send = async (w, event, payload) => {
    global.fetch = w.fetch;
    const body = JSON.stringify(payload);
    const sig = 'sha256=' + crypto.createHmac('sha256', env.WEBHOOK_SECRET).update(body).digest('hex');
    const waits = [];
    const res = await worker.fetch(new Request('https://app.test/webhook', { method: 'POST', body, headers: { 'x-github-event': event, 'x-hub-signature-256': sig } }), env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  const install = { action: 'created', installation: { id: 5 }, sender: { login: 'abi' }, repositories: [{ full_name: 'acme/shop' }] };
  let w = world();
  let res = await send(w, 'installation', install);
  ok(res.status === 202 && w.created.pr, 'installing the App opens a setup PR', w.calls.join('\n'));
  const files = Object.fromEntries(w.created.tree.tree.map((f) => [f.path, f.content]));
  const cfg = JSON.parse(files['.fixlock/config.json']);
  const reg = JSON.parse(files['.fixlock/registry.json']);
  ok(cfg.team[0].github === 'abi' && cfg.team[0].role === 'lead' && cfg.team.some((m) => m.github === 'meena') && cfg.prCheck === 'github-app' && cfg.project === 'shop', 'setup PR config: installer leads, commit authors join, marked as checked by the App', JSON.stringify(cfg.team));
  ok(reg.locks.length === 1 && reg.locks[0].file === 'pay.py' && reg.locks[0].snippet.join('\n').includes('amount <= 0') && reg.locks[0].owner === 'abi' && reg.locks[0].test === 'tests/test_pay.py', 'locks the past fix still on main, owned by its author, with its test', JSON.stringify(reg.locks));
  ok(reg.locks[0].reason.includes('Refunds of 0') && reg.locks[0].issue === null && reg.locks[0].id === 'FIX-001', 'lock reason from the commit body', JSON.stringify(reg.locks[0]));
  ok(!reg.locks.some((l) => l.file === 'net.py'), "a fix whose lines are gone from main isn't locked");
  ok(w.created.ref.ref === 'refs/heads/fixlock/setup' && w.created.commit.parents[0] === 'c4' && w.created.tree.base_tree === 't-c4', 'setup branch from the head of main');
  ok(w.created.pr.base === 'main' && /Set up fixlock: lock 1 past fix$/.test(w.created.pr.title) && /Merge it and the fixlock check turns on/.test(w.created.pr.body) && /npx @abinandhmj\/fixlock quickstart/.test(w.created.pr.body) && /app\.test\/dashboard/.test(w.created.pr.body), 'setup PR title and body', w.created.pr.body);
  ok(!/[\u{1F300}-\u{1FAFF}]/u.test(w.created.pr.body), 'no emojis in the PR body');
  const ghCalls = w.calls.filter((c) => !c.includes('access_tokens')).length;
  ok(ghCalls <= 44, `stays inside the Workers subrequest limit (${ghCalls + 1} requests)`);

  // Again: a PR already exists → nothing new
  const before = w.calls.length;
  await send(w, 'installation_repositories', { action: 'added', installation: { id: 5 }, sender: { login: 'abi' }, repositories_added: [{ full_name: 'acme/shop' }] });
  ok(!w.calls.slice(before).some((c) => c.startsWith('POST /repos')), 'an open setup PR is not opened twice');

  // Closed before → not reopened on install
  w = world(); w.pulls = [{ number: 3, state: 'closed', head: 'fixlock/setup', html_url: 'x' }];
  await send(w, 'installation', install);
  ok(!w.created.pr, 'a setup PR someone closed is not opened again on install');

  // Already set up → nothing
  w = world(); w.files['.fixlock/config.json'] = '{}';
  await send(w, 'installation', install);
  ok(!w.created.pr, 'a repo that already has .fixlock/ gets no setup PR');

  // Empty repo, archived repo, AUTO_SETUP=off
  w = world(); w.commits = [];
  await send(w, 'installation', install);
  ok(!w.created.pr, 'empty repository: skipped');
  w = world();
  global.fetch = w.fetch;
  await worker.fetch(new Request('https://app.test/webhook', { method: 'POST', body: JSON.stringify(install), headers: { 'x-github-event': 'installation', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'shh').update(JSON.stringify(install)).digest('hex') } }), { ...env, AUTO_SETUP: 'off' }, { waitUntil: (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  ok(!w.created.pr, 'AUTO_SETUP=off: no setup PRs');

  // No write permission yet: logged, nothing thrown
  w = world(); w.denyWrites = true;
  res = await send(w, 'installation', install);
  ok(res.status === 202 && !w.created.pr, 'without Contents write permission the install still succeeds (logged)');

  // Dashboard Set up button
  const cookie = `fixlock_session=${encodeURIComponent(await seal(env.SESSION_SECRET, { token: 'user-abi', login: 'abi', exp: Date.now() + 3600e3 }))}`;
  const post = (w2, origin = 'https://app.test') => { global.fetch = w2.fetch; return worker.fetch(new Request('https://app.test/dashboard/setup/acme/shop', { method: 'POST', headers: { cookie, origin } }), env, { waitUntil() {} }); };
  w = world();
  res = await post(w, 'https://evil.test');
  ok(res.status === 403 && !w.created.pr, 'Set up from another site is refused (CSRF)');
  w = world(); w.userPerms = { push: false, pull: true };
  res = await post(w);
  ok(res.status === 403 && /write access/.test(await res.text()) && !w.created.pr, 'Set up without write access to the repo is refused');
  w = world(); w.pulls = [{ number: 3, state: 'closed', head: 'fixlock/setup', html_url: 'x' }];
  res = await post(w);
  ok(res.status === 303 && res.headers.get('location') === 'https://gh.test/acme/shop/pull/50' && /^refs\/heads\/fixlock\/setup-\d+$/.test(w.created.ref.ref), 'Set up opens a new setup PR (even after an earlier one was closed) and goes to it', w.created.ref && w.created.ref.ref);
  w = world(); w.pulls = [{ number: 8, state: 'open', head: 'fixlock/setup', html_url: 'https://gh.test/acme/shop/pull/8' }];
  res = await post(w);
  ok(res.status === 303 && res.headers.get('location') === 'https://gh.test/acme/shop/pull/8' && !w.created.pr, 'Set up with a setup PR already open goes to that PR');

  // Overview shows the button for repos without .fixlock
  w = world();
  global.fetch = w.fetch;
  const page = await (await worker.fetch(new Request('https://app.test/dashboard', { headers: { cookie } }), env, { waitUntil() {} })).text();
  ok(/<form method="post" action="\/dashboard\/setup\/acme\/shop"/.test(page), 'dashboard shows a Set up button for repos without fixlock', page);

  console.log(`SETUP PASS (${passed} checks)`);
})().catch((e) => { console.error(e); console.error('SETUP FAIL'); process.exit(1); });
