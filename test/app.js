'use strict';
// GitHub App (app/worker.mjs) end to end against a fake GitHub API: signed webhooks in, check runs and
// PR comments out. No network.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

// Node 18 has Web Crypto but not as a global (Workers and Node 20+ do).
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = crypto.webcrypto;

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

const PAY_BASE = 'def pay(amount):\n    if amount <= 0:\n        raise ValueError("bad")\n    return charge(amount)\n';
const PAY_REVERTED = 'def pay(amount):\n    return charge(amount)\n';
const PAY_REFORMATTED = 'def pay(amount):\n    if amount<=0:  # guard\n        raise ValueError( "bad" )\n    return charge(amount)\n';

const CONFIG = JSON.stringify({
  project: 'shop',
  team: [
    { name: 'Ravi', github: 'ravi', emails: ['ravi@example.com'], role: 'lead' },
    { name: 'Abi', github: 'abi', emails: ['abi@example.com'], role: 'developer' },
  ],
  policies: { bug: { onEdit: 'ask', approval: 'owner' }, feature: { onEdit: 'warn', approval: 'owner-or-lead' } },
});
const REGISTRY = JSON.stringify({ version: 2, locks: [{
  id: 'FIX-001', type: 'bug', title: 'never charge zero', reason: 'Refunds of 0 crashed the ledger', file: 'pay.py',
  snippet: ['    if amount <= 0:', '        raise ValueError("bad")'], owner: 'Ravi', issue: null, test: null, date: '2026-11-01',
}] });

/** A tiny in-memory GitHub. */
function fakeGitHub() {
  const st = {
    files: {}, // `${repo}@${sha}:${path}` → text
    prFiles: [], reviews: [], comments: [], checkRuns: [], tokens: 0, nextId: 1, prs: {},
  };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  async function handler(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const auth = (init.headers && init.headers.Authorization) || '';
    const body = init.body ? JSON.parse(init.body) : null;
    const p = url.pathname;
    let m;
    if (method === 'POST' && (m = p.match(/^\/app\/installations\/(\d+)\/access_tokens$/))) {
      // the app's JWT: header.payload.signature, RS256, iss = APP_ID
      const [h, pl] = auth.replace('Bearer ', '').split('.');
      const head = JSON.parse(Buffer.from(h, 'base64url')); const claims = JSON.parse(Buffer.from(pl, 'base64url'));
      if (head.alg !== 'RS256' || claims.iss !== '1234') return json({ message: 'bad jwt' }, 401);
      st.tokens++;
      return json({ token: `inst-${m[1]}` }, 201);
    }
    if (!auth.startsWith('Bearer inst-')) return json({ message: 'no installation token' }, 401);
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/))) {
      const k = `${m[1]}@${url.searchParams.get('ref')}:${decodeURIComponent(m[2])}`;
      if (k in st.files) return new Response(st.files[k]);
      const dir = `${k}/`;
      const inDir = Object.keys(st.files).filter((f) => f.startsWith(dir) && !f.slice(dir.length).includes('/'));
      if (inDir.length) return json(inDir.map((f) => ({ name: f.slice(dir.length), path: f.split(':').slice(1).join(':'), type: 'file' })));
      return json({ message: 'Not Found' }, 404);
    }
    const page = (list) => { const n = +(url.searchParams.get('page') || 1); return json(list.slice((n - 1) * 100, n * 100)); };
    if ((m = p.match(/\/pulls\/(\d+)\/files$/))) return page(st.prFiles);
    if ((m = p.match(/\/pulls\/(\d+)\/reviews$/))) return page(st.reviews);
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/))) return json(st.prs[m[2]]);
    if (p.endsWith('/check-runs') && method === 'POST') { st.checkRuns.push(body); return json({ id: st.nextId++ }, 201); }
    if ((m = p.match(/\/issues\/(\d+)\/comments$/))) {
      if (method === 'POST') { const c = { id: st.nextId++, body: body.body }; st.comments.push(c); return json(c, 201); }
      return page(st.comments);
    }
    if ((m = p.match(/\/issues\/comments\/(\d+)$/)) && method === 'PATCH') {
      const c = st.comments.find((x) => x.id === +m[1]); c.body = body.body; return json(c);
    }
    return json({ message: `unhandled ${method} ${p}` }, 500);
  }
  return { st, handler };
}

function pullRequest(n = 7, head = 'h1', author = 'abi') {
  return {
    number: n, state: 'open', user: { login: author },
    base: { ref: 'main', sha: 'b1', repo: { full_name: 'acme/shop' } },
    head: { ref: 'feature', sha: head, repo: { full_name: 'acme/shop' } },
  };
}

(async () => {
  const worker = (await import(pathToFileURL(path.join(__dirname, '..', 'app', 'worker.mjs')))).default;
  const { pkcs8, verifySignature } = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'github.mjs')));

  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const env = { APP_ID: '1234', PRIVATE_KEY: pkcs1, WEBHOOK_SECRET: 'shh', GITHUB_API: 'https://gh.test' };

  // PKCS#1 → PKCS#8 wrapping matches Node's own PKCS#8 export
  const nodePkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  ok(Buffer.from(pkcs8(pkcs1)).equals(nodePkcs8), 'PKCS#1 key converted to PKCS#8 exactly like Node does');
  ok(Buffer.from(pkcs8(pkcs1.replace(/\n/g, '\\n'))).equals(nodePkcs8), 'key pasted with literal \\n still works');

  const sign = (body, secret = 'shh') => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  ok(await verifySignature('shh', '{"a":1}', sign('{"a":1}')), 'valid signature accepted');
  ok(!(await verifySignature('shh', '{"a":1}', sign('{"a":2}'))), 'signature for another body rejected');
  ok(await verifySignature('shh\n', '{"a":1}', sign('{"a":1}')) && await verifySignature('  shh ', '{"a":1}', sign('{"a":1}')), 'secret with a stray newline or spaces still matches');

  const gh = fakeGitHub();
  global.fetch = gh.handler;
  const send = async (event, payload, { secret = 'shh', raw } = {}) => {
    const body = raw || JSON.stringify(payload);
    const pending = [];
    const res = await worker.fetch(new Request('https://app.test/webhook', {
      method: 'POST', body, headers: { 'x-github-event': event, 'x-hub-signature-256': sign(body, secret), 'content-type': 'application/json' },
    }), env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    return res;
  };
  const setFiles = (repoAtSha, files) => { for (const [k, v] of Object.entries(files)) gh.st.files[`${repoAtSha}:${k}`] = v; };
  const base = { '.fixlock/config.json': CONFIG, '.fixlock/registry.json': REGISTRY, 'pay.py': PAY_BASE };
  setFiles('acme/shop@b1', base);
  const lastCheck = () => gh.st.checkRuns[gh.st.checkRuns.length - 1];

  // Basics
  ok((await worker.fetch(new Request('https://app.test/'), env, { waitUntil() {} })).status === 200, 'GET / answers (health check)');
  ok((await send('pull_request', { action: 'opened' }, { secret: 'wrong' })).status === 401, 'bad signature → 401, nothing done');
  ok((await send('ping', { zen: 'hi' })).status === 200, 'ping → 200');
  const r401 = await send('ping', {}, { secret: 'other' });
  ok(r401.status === 401 && /don't match/.test(await r401.text()), 'mismatched secret: 401 that says the secrets differ');
  const noSecret = await worker.fetch(new Request('https://app.test/webhook', { method: 'POST', body: '{}', headers: { 'x-github-event': 'ping', 'x-hub-signature-256': sign('{}') } }), { ...env, WEBHOOK_SECRET: '' }, { waitUntil() {} });
  ok(noSecret.status === 500 && /not set/.test(await noSecret.text()), 'secret missing on the Worker: 500 that says so');
  const noHeader = await worker.fetch(new Request('https://app.test/webhook', { method: 'POST', body: '{}', headers: { 'x-github-event': 'ping' } }), env, { waitUntil() {} });
  ok(noHeader.status === 401 && /set a webhook secret on the GitHub App/.test(await noHeader.text()), 'no signature header: 401 that says the app has no secret');
  ok(gh.st.checkRuns.length === 0, 'no check runs yet');

  // 1. PR that doesn't touch the locked file → success, no comment
  setFiles('acme/shop@h0', { ...base, 'README.md': 'hi' });
  gh.st.prFiles = [{ filename: 'README.md', status: 'modified' }];
  let res = await send('pull_request', { action: 'opened', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h0') });
  ok(res.status === 202, 'webhook accepted with 202');
  ok(lastCheck().name === 'fixlock' && lastCheck().head_sha === 'h0' && lastCheck().conclusion === 'success', 'unrelated PR: fixlock check passes');
  ok(/All 1 locks intact/.test(lastCheck().output.title), 'check title says the locks are intact');
  ok(gh.st.comments.length === 0, 'clean PR: no comment');

  // 2. PR that reformats the locked lines → still success (structural matching)
  setFiles('acme/shop@h2', { ...base, 'pay.py': PAY_REFORMATTED });
  gh.st.prFiles = [{ filename: 'pay.py', status: 'modified' }];
  await send('pull_request', { action: 'synchronize', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h2') });
  ok(lastCheck().conclusion === 'success', 'reformatting the locked lines does not fail the check');

  // 3. PR by Abi that removes the fix → failure + comment naming Ravi
  setFiles('acme/shop@h3', { ...base, 'pay.py': PAY_REVERTED });
  await send('pull_request', { action: 'synchronize', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h3') });
  ok(lastCheck().head_sha === 'h3' && lastCheck().conclusion === 'failure', 'reverted fix: check fails');
  ok(/1 locked change\(s\) need approval/.test(lastCheck().output.title), 'check title counts the blocked locks');
  ok(gh.st.comments.length === 1, 'one PR comment posted');
  const c1 = gh.st.comments[0].body;
  ok(c1.includes('<!-- fixlock-app -->') && c1.includes('Needs approval: FIX-001') && c1.includes('@ravi'), 'comment names the lock and who must approve');
  ok(c1.includes('Refunds of 0 crashed the ledger'), 'comment explains why the lock exists');
  ok(!/[\u{1F300}-\u{1FAFF}✅❌⚠]/u.test(c1), 'comment has no emojis');

  // 4. Someone else approves → still failure; Ravi approves → success, same comment edited
  gh.st.reviews = [{ user: { login: 'someone' }, state: 'APPROVED' }];
  gh.st.prs['7'] = pullRequest(7, 'h3');
  await send('pull_request_review', { action: 'submitted', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: { number: 7 } });
  ok(lastCheck().conclusion === 'failure', "a non-owner's approval doesn't clear the lock");
  gh.st.reviews.push({ user: { login: 'Ravi' }, state: 'APPROVED' });
  await send('pull_request_review', { action: 'submitted', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: { number: 7 } });
  ok(lastCheck().conclusion === 'success', "the owner's approval clears the lock");
  ok(gh.st.comments.length === 1 && gh.st.comments[0].body.includes('Approved: FIX-001'), 'the same comment is updated, not a new one');
  gh.st.reviews.push({ user: { login: 'ravi' }, state: 'CHANGES_REQUESTED' });
  await send('pull_request_review', { action: 'submitted', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: { number: 7 } });
  ok(lastCheck().conclusion === 'failure', "the owner's later 'changes requested' counts, not the earlier approval");

  // 5. The PR author is the owner → approved without a review
  gh.st.reviews = [];
  await send('pull_request', { action: 'reopened', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h3', 'ravi') });
  ok(lastCheck().conclusion === 'success', "the lock owner's own PR passes");

  // 6. A PR can't approve itself by deleting the lock from the registry
  setFiles('acme/shop@h4', { ...base, 'pay.py': PAY_REVERTED, '.fixlock/registry.json': JSON.stringify({ version: 2, locks: [] }) });
  gh.st.prFiles = [{ filename: 'pay.py', status: 'modified' }, { filename: '.fixlock/registry.json', status: 'modified' }];
  await send('pull_request', { action: 'synchronize', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h4') });
  ok(lastCheck().conclusion === 'failure', "deleting the lock in the same PR doesn't bypass it (locks come from the base branch)");

  // 7. Renamed file: the lock follows it
  setFiles('acme/shop@h5', { ...base, 'billing/pay.py': PAY_REVERTED, 'pay.py': undefined });
  delete gh.st.files['acme/shop@h5:pay.py'];
  gh.st.prFiles = [{ filename: 'billing/pay.py', previous_filename: 'pay.py', status: 'renamed' }];
  await send('pull_request', { action: 'synchronize', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h5') });
  ok(lastCheck().conclusion === 'failure' && lastCheck().output.summary.includes('billing/pay.py'), 'lock follows a renamed file');
  setFiles('acme/shop@h6', { ...base, 'billing/pay.py': PAY_BASE });
  delete gh.st.files['acme/shop@h6:pay.py'];
  await send('pull_request', { action: 'synchronize', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h6') });
  ok(lastCheck().conclusion === 'success', 'moving the file with the fix intact passes');

  // 8. "Re-run" button on the check
  gh.st.prs['7'] = pullRequest(7, 'h3');
  gh.st.prFiles = [{ filename: 'pay.py', status: 'modified' }];
  const before = gh.st.checkRuns.length;
  await send('check_run', { action: 'rerequested', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, check_run: { name: 'fixlock', pull_requests: [{ number: 7 }] } });
  ok(gh.st.checkRuns.length === before + 1 && lastCheck().conclusion === 'failure', 'Re-run reruns the check on the current head');

  // 9. Repo without fixlock → neutral, with a pointer to set it up
  await send('pull_request', { action: 'opened', installation: { id: 99 }, repository: { full_name: 'acme/other' }, pull_request: { ...pullRequest(3, 'x1'), base: { ref: 'main', sha: 'x0', repo: { full_name: 'acme/other' } }, head: { ref: 'f', sha: 'x1', repo: { full_name: 'acme/other' } } } });
  ok(lastCheck().conclusion === 'neutral' && /not set up/.test(lastCheck().output.title), 'repo without .fixlock: neutral check that says how to set up');

  // 10. Broken registry → neutral with the error, never a crash
  setFiles('acme/bad@z0', { '.fixlock/config.json': CONFIG, '.fixlock/registry.json': '{oops' });
  await send('pull_request', { action: 'opened', installation: { id: 99 }, repository: { full_name: 'acme/bad' }, pull_request: { ...pullRequest(1, 'z1'), base: { ref: 'main', sha: 'z0', repo: { full_name: 'acme/bad' } }, head: { ref: 'f', sha: 'z1', repo: { full_name: 'acme/bad' } } } });
  ok(lastCheck().conclusion === 'neutral' && /registry\.json is not valid JSON/.test(lastCheck().output.summary), 'invalid registry: neutral check with the reason');

  // 11. Events that shouldn't do anything
  const n = gh.st.checkRuns.length;
  await send('pull_request', { action: 'labeled', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h3') });
  await send('pull_request', { action: 'edited', changes: { title: {} }, installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: pullRequest(7, 'h3') });
  await send('issues', { action: 'opened', installation: { id: 99 } });
  gh.st.prs['7'] = { ...pullRequest(7, 'h3'), state: 'closed' };
  await send('pull_request_review', { action: 'submitted', installation: { id: 99 }, repository: { full_name: 'acme/shop' }, pull_request: { number: 7 } });
  ok(gh.st.checkRuns.length === n, 'labels, title edits, other events and closed PRs are ignored');

  // 12. The repo runs the fixlock Action: the App stays quiet (one check, one comment per PR)
  setFiles('acme/both@w0', { ...base, '.github/workflows/ci.yml': 'jobs: {}', '.github/workflows/fixlock.yml': 'jobs:\n  fixlock:\n    steps:\n      - uses: AbinandhMJ/fixlock@v0.7.1\n' });
  setFiles('acme/both@w1', { ...base, 'pay.py': PAY_REVERTED });
  gh.st.prFiles = [{ filename: 'pay.py', status: 'modified' }];
  const before12 = [gh.st.checkRuns.length, gh.st.comments.length];
  await send('pull_request', { action: 'opened', installation: { id: 99 }, repository: { full_name: 'acme/both' }, pull_request: { ...pullRequest(9, 'w1'), base: { ref: 'main', sha: 'w0', repo: { full_name: 'acme/both' } }, head: { ref: 'f', sha: 'w1', repo: { full_name: 'acme/both' } } } });
  ok(gh.st.checkRuns.length === before12[0] && gh.st.comments.length === before12[1], 'repo already running the fixlock Action: the App posts no check and no comment');
  setFiles('acme/other2@v0', { ...base, '.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4\n' });
  setFiles('acme/other2@v1', { ...base, 'pay.py': PAY_REVERTED });
  await send('pull_request', { action: 'opened', installation: { id: 99 }, repository: { full_name: 'acme/other2' }, pull_request: { ...pullRequest(10, 'v1'), base: { ref: 'main', sha: 'v0', repo: { full_name: 'acme/other2' } }, head: { ref: 'f', sha: 'v1', repo: { full_name: 'acme/other2' } } } });
  ok(lastCheck().head_sha === 'v1' && lastCheck().conclusion === 'failure', 'other workflows in the repo: the App still checks');

  // 13. Nobody can approve: the owner has no GitHub username → the comment says so and how to fix it
  setFiles('acme/nogh@n0', { ...base, '.fixlock/config.json': JSON.stringify({ team: [{ name: 'Ravi', github: null, emails: ['ravi@example.com'], role: 'lead' }] }) });
  setFiles('acme/nogh@n1', { ...base, 'pay.py': PAY_REVERTED });
  await send('pull_request', { action: 'opened', installation: { id: 99 }, repository: { full_name: 'acme/nogh' }, pull_request: { ...pullRequest(11, 'n1'), base: { ref: 'main', sha: 'n0', repo: { full_name: 'acme/nogh' } }, head: { ref: 'f', sha: 'n1', repo: { full_name: 'acme/nogh' } } } });
  ok(lastCheck().conclusion === 'failure' && /has no GitHub or GitLab username/.test(lastCheck().output.summary) && /fixlock team add --name "Ravi" --github <username>/.test(lastCheck().output.summary), 'owner without a GitHub username: the check explains why nobody can approve and how to fix it');

  console.log(`GITHUB APP PASS (${passed} checks)`);
})().catch((e) => { console.error(e); console.error('GITHUB APP FAIL'); process.exit(1); });
