'use strict';
// Self-hosted App (app/server.mjs): the Worker code served by Node. Starts the real server process.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 1500)}` : ''}`); console.error('SELFHOST FAIL'); process.exit(1); } passed++; };
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  const S = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'server.mjs')));

  // In-memory cache honours max-age
  let t = 0;
  const cache = S.memoryCache(() => t);
  await cache.put(new Request('https://c/a'), new Response('{"x":1}', { headers: { 'cache-control': 'max-age=300' } }));
  await cache.put(new Request('https://c/b'), new Response('nope'));
  ok((await (await cache.match(new Request('https://c/a'))).json()).x === 1 && !(await cache.match(new Request('https://c/b'))), 'cache: kept with max-age, skipped without');
  t = 301e3;
  ok(!(await cache.match(new Request('https://c/a'))), 'cache: expires');

  // Settings
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-selfhost-'));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  fs.writeFileSync(path.join(tmp, 'app.pem'), pem);
  const e1 = S.envFrom({ PRIVATE_KEY_FILE: path.join(tmp, 'app.pem') });
  ok(e1.PRIVATE_KEY === pem && e1.SUBREQUEST_BUDGET === '1000', 'PRIVATE_KEY_FILE is read; no Workers request limit');
  ok(S.envFrom({ PRIVATE_KEY: pem.replace(/\n/g, '\\n') }).PRIVATE_KEY === pem, 'a key pasted on one line (\\n) works');

  // The real server
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'app', 'server.mjs')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', APP_ID: '1', PRIVATE_KEY_FILE: path.join(tmp, 'app.pem'), WEBHOOK_SECRET: 'shh', CLIENT_ID: 'Iv1', CLIENT_SECRET: 'cs', SESSION_SECRET: 'ss', GITHUB_WEB: 'https://ghe.example.com' },
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 50 && !/listening/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
    ok(new RegExp(`listening on 127\\.0\\.0\\.1:${port} \\(dashboard: /dashboard\\)`).test(log), 'starts and says where', log);
    const url = `http://127.0.0.1:${port}`;
    let r = await fetch(`${url}/`);
    ok(r.status === 200 && /fixlock GitHub App is running/.test(await r.text()), 'health check');
    r = await fetch(`${url}/webhook`, { method: 'POST', body: '{}', headers: { 'x-github-event': 'ping' } });
    ok(r.status === 401, 'unsigned webhook refused');
    const body = JSON.stringify({ zen: 'hi', hook_id: 1 });
    r = await fetch(`${url}/webhook`, { method: 'POST', body, headers: { 'x-github-event': 'ping', 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', 'shh').update(body).digest('hex')}` } });
    ok(r.status >= 200 && r.status < 300, 'signed webhook accepted', `${r.status} ${log}`);
    r = await fetch(`${url}/login`, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'fixlock.acme.internal' } });
    const loc = new URL(r.headers.get('location'));
    ok(r.status === 302 && loc.origin === 'https://ghe.example.com' && loc.searchParams.get('redirect_uri') === 'https://fixlock.acme.internal/auth/callback' && /fixlock_oauth_state=/.test(r.headers.get('set-cookie') || ''), 'dashboard sign-in: GitHub Enterprise URL, callback from the proxy headers, cookie passed through', `${r.status} ${r.headers.get('location')} ${r.headers.get('set-cookie')}`);
    r = await fetch(`${url}/dashboard`);
    ok(r.status === 401 && /Sign in with GitHub/.test(await r.text()), 'dashboard page served');
  } finally {
    proc.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`SELFHOST PASS (${passed} checks)`);
})().catch((e) => { console.error(e); console.error('SELFHOST FAIL'); process.exit(1); });
