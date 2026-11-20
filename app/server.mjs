// Self-hosted fixlock GitHub App and team dashboard: the same code as the Cloudflare Worker (worker.mjs),
// served by Node. Run it with Docker (app/Dockerfile) or `node app/server.mjs`, behind HTTPS.
//
// Settings (environment variables), the same as the Worker's:
//   APP_ID, PRIVATE_KEY (or PRIVATE_KEY_FILE: path to the .pem), WEBHOOK_SECRET
//   CLIENT_ID, CLIENT_SECRET, SESSION_SECRET            team dashboard (optional)
//   GITHUB_API, GITHUB_WEB                              GitHub Enterprise Server (optional)
//   AUTO_SETUP=off                                      no setup pull requests on install
//   PORT (default 8787), HOST (default 0.0.0.0)
//   PUBLIC_URL                                          the https:// address GitHub and browsers use (else from the request)
import http from 'node:http';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import worker from './worker.mjs';

if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;

/** The Workers cache API, in memory: the dashboard caches summaries for a few minutes. */
export function memoryCache(now = () => Date.now()) {
  const store = new Map();
  return {
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires < now()) { store.delete(key); return undefined; }
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    },
    async put(req, res) {
      const key = typeof req === 'string' ? req : req.url;
      const age = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 0);
      if (!age) return;
      if (store.size > 2000) store.delete(store.keys().next().value);
      store.set(key, { body: await res.text(), status: res.status, headers: [...res.headers], expires: now() + age * 1000 });
    },
  };
}
if (typeof globalThis.caches === 'undefined') globalThis.caches = { default: memoryCache() };

/** Settings from the environment. */
export function envFrom(src = process.env) {
  const env = { ...src };
  if (!env.PRIVATE_KEY && env.PRIVATE_KEY_FILE) env.PRIVATE_KEY = fs.readFileSync(env.PRIVATE_KEY_FILE, 'utf8');
  if (env.PRIVATE_KEY) env.PRIVATE_KEY = env.PRIVATE_KEY.replace(/\\n/g, '\n'); // keys pasted on one line
  if (!env.SUBREQUEST_BUDGET) env.SUBREQUEST_BUDGET = '1000'; // no Workers limit here
  return env;
}

/** Node request → Fetch Request, through the worker, back to the Node response. */
export function handler(env, { publicUrl = env.PUBLIC_URL } = {}) {
  const pending = new Set();
  const h = async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket.encrypted ? 'https' : 'http');
      const origin = publicUrl ? publicUrl.replace(/\/$/, '') : `${proto}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost'}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const request = new Request(origin + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const ctx = { waitUntil(p) { const q = Promise.resolve(p).catch((e) => console.error('fixlock:', e)).finally(() => pending.delete(q)); pending.add(q); } };
      const response = await worker.fetch(request, env, ctx);
      const out = {};
      response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
      const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      if (cookies.length) out['set-cookie'] = cookies;
      res.writeHead(response.status, out);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error('fixlock server:', e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('fixlock: internal error\n');
    }
  };
  h.pending = pending;
  return h;
}

/** Start listening. Returns the http.Server. */
export function start(env = envFrom()) {
  const missing = ['APP_ID', 'PRIVATE_KEY', 'WEBHOOK_SECRET'].filter((k) => !env[k]);
  if (missing.length) console.warn(`fixlock: ${missing.join(', ')} not set: webhooks will be refused until they are.`);
  const h = handler(env);
  const server = http.createServer(h);
  server.listen(Number(env.PORT || 8787), env.HOST || '0.0.0.0', () => {
    const a = server.address();
    console.log(`fixlock GitHub App listening on ${a.address}:${a.port}${env.CLIENT_ID ? ' (dashboard: /dashboard)' : ''}`);
  });
  const stop = () => { server.close(); Promise.allSettled([...h.pending]).then(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')))) start();
