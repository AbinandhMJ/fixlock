// GitHub plumbing for the fixlock GitHub App: webhook signatures, the app's JWT, installation tokens and
// a small REST client. Web Crypto and fetch only, so it runs on Cloudflare Workers (and Node 20+ in tests).

const enc = new TextEncoder();

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)));

/** Constant-time comparison of two strings. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Is `signature` (the X-Hub-Signature-256 header) right for this raw body? */
export async function verifySignature(secret, body, signature) {
  secret = String(secret || '').trim(); // a pasted secret often carries a trailing newline or space
  if (!secret || !signature || !signature.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  const hex = [...mac].map((x) => x.toString(16).padStart(2, '0')).join('');
  return same(`sha256=${hex}`, signature);
}

/* ---- private key: GitHub hands out PKCS#1 PEM ("BEGIN RSA PRIVATE KEY"); Web Crypto wants PKCS#8 ---- */

function derLength(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}
const der = (tag, content) => [tag, ...derLength(content.length), ...content];

function pemBytes(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

/** PKCS#8 DER bytes for a PEM private key, PKCS#1 or PKCS#8. Secrets pasted with literal "\n" work too. */
export function pkcs8(pem) {
  const text = String(pem).replace(/\\n/g, '\n').trim();
  const bytes = pemBytes(text);
  if (!/BEGIN RSA PRIVATE KEY/.test(text)) return bytes; // already PKCS#8
  const rsaEncryption = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return new Uint8Array(der(0x30, [0x02, 0x01, 0x00, ...der(0x30, rsaEncryption), ...der(0x04, [...bytes])]));
}

/** The app's own JWT (valid ~9 minutes), used to get installation tokens. */
export async function appJwt(appId, privateKey, now = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('pkcs8', pkcs8(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({ iat: now - 60, exp: now + 540, iss: String(appId) })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

/** A small GitHub REST client. */
export function client(token, api = 'https://api.github.com') {
  const gh = { calls: 0 }; // requests made, to stay inside the Worker's per-request subrequest limit
  async function request(method, path, body, accept = 'application/vnd.github+json') {
    gh.calls++;
    const res = await fetch(path.startsWith('http') ? path : api + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'User-Agent': 'fixlock-app', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }
  async function json(method, path, body) {
    const res = await request(method, path, body);
    if (!res.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  }
  return Object.assign(gh, {
    get: (path) => json('GET', path),
    post: (path, body) => json('POST', path, body),
    patch: (path, body) => json('PATCH', path, body),
    /** Every page of a list endpoint (100 per page, at most `max` items). */
    async all(path, max = 3000) {
      const out = [];
      for (let page = 1; out.length < max; page++) {
        const items = await json('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
        out.push(...items);
        if (items.length < 100) break;
      }
      return out;
    },
    /** A directory's entries at a commit ([{ name, path, type }]), or [] if it isn't there. */
    async list(repo, path, ref) {
      const p = path.split('/').map(encodeURIComponent).join('/');
      const res = await request('GET', `/repos/${repo}/contents/${p}?ref=${encodeURIComponent(ref)}`);
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`GitHub GET contents ${path}: ${res.status}`);
      const items = await res.json();
      return Array.isArray(items) ? items : [];
    },
    /** A file's text at a commit, or null if it isn't there. */
    async file(repo, path, ref) {
      const p = path.split('/').map(encodeURIComponent).join('/');
      const res = await request('GET', `/repos/${repo}/contents/${p}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw+json');
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub GET contents ${path}: ${res.status}`);
      return res.text();
    },
  });
}

/** An installation token for the repo the webhook came from. */
export async function installationClient(env, installationId) {
  const jwt = await appJwt(env.APP_ID, env.PRIVATE_KEY);
  const api = env.GITHUB_API || 'https://api.github.com';
  const { token } = await client(jwt, api).post(`/app/installations/${installationId}/access_tokens`);
  return client(token, api);
}
