// Sign-in for the fixlock dashboard: "Sign in with GitHub" through the fixlock GitHub App's own OAuth
// (its Client ID and client secret), and an encrypted, HTTP-only session cookie holding the user's
// GitHub token. The dashboard only ever shows repositories that token can access.
//
// Needs: CLIENT_ID (var), CLIENT_SECRET and SESSION_SECRET (secrets).

const enc = new TextEncoder();
const dec = new TextDecoder();
const COOKIE = 'fixlock_session';
const STATE_COOKIE = 'fixlock_oauth_state';
const SESSION_HOURS = 8; // GitHub App user tokens expire after 8 hours

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function key(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`fixlock-session:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypt a JSON value (AES-GCM, random IV) → "iv.ciphertext" (base64url). */
export async function seal(secret, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), enc.encode(JSON.stringify(value)));
  return `${b64u(iv)}.${b64u(ct)}`;
}

/** Decrypt a sealed value; null if it was tampered with, made with another secret, or is malformed. */
export async function unseal(secret, token) {
  try {
    const [iv, ct] = String(token).split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await key(secret), unb64u(ct));
    return JSON.parse(dec.decode(pt));
  } catch { return null; }
}

export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/** The signed-in user ({ token, login, exp }) or null. */
export async function currentUser(request, env) {
  const raw = cookies(request)[COOKIE];
  if (!raw || !env.SESSION_SECRET) return null;
  const s = await unseal(env.SESSION_SECRET, raw);
  return s && s.exp > Date.now() ? s : null;
}

export function configured(env) {
  return !!(env.CLIENT_ID && env.CLIENT_SECRET && env.SESSION_SECRET);
}

/** Start sign-in: send the browser to GitHub with a one-time state value. */
export function login(request, env, next = '/dashboard') {
  const origin = new URL(request.url).origin;
  const state = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const url = new URL(`${env.GITHUB_WEB || 'https://github.com'}/login/oauth/authorize`);
  url.searchParams.set('client_id', env.CLIENT_ID);
  url.searchParams.set('redirect_uri', `${origin}/auth/callback`);
  url.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: [
    ['location', url.toString()],
    ['set-cookie', cookie(STATE_COOKIE, `${state}|${next.startsWith('/') ? next : '/dashboard'}`, 600)],
  ] });
}

/** GitHub sends the browser back here: check the state, swap the code for a user token, set the session. */
export async function callback(request, env) {
  const url = new URL(request.url);
  const [state, next] = (cookies(request)[STATE_COOKIE] || '').split('|');
  if (!state || url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
    return new Response('Sign-in expired or was started elsewhere. Go back to /dashboard and try again.\n', { status: 400 });
  }
  const res = await fetch(`${env.GITHUB_WEB || 'https://github.com'}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'fixlock-app' },
    body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, code: url.searchParams.get('code'), redirect_uri: `${url.origin}/auth/callback` }),
  });
  const data = res.ok ? await res.json() : {};
  if (!data.access_token) return new Response('GitHub did not accept the sign-in. Try again.\n', { status: 400 });
  const userRes = await fetch(`${env.GITHUB_API || 'https://api.github.com'}/user`, { headers: { Authorization: `Bearer ${data.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fixlock-app' } });
  const user = userRes.ok ? await userRes.json() : null;
  if (!user || !user.login) return new Response('Could not read your GitHub account. Try again.\n', { status: 400 });
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const sealed = await seal(env.SESSION_SECRET, { token: data.access_token, login: user.login, exp });
  return new Response(null, { status: 302, headers: [
    ['location', next && next.startsWith('/') ? next : '/dashboard'],
    ['set-cookie', cookie(COOKIE, sealed, SESSION_HOURS * 3600)],
    ['set-cookie', cookie(STATE_COOKIE, '', 0)],
  ] });
}

export function logout() {
  return new Response(null, { status: 302, headers: [['location', '/'], ['set-cookie', cookie(COOKIE, '', 0)]] });
}
