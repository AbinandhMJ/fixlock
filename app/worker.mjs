// fixlock GitHub App: a Cloudflare Worker that receives GitHub webhooks and runs the fixlock check on every
// pull request, with nothing to install in the repository except its .fixlock/ folder.
//
// Secrets (wrangler secret put …): APP_ID, PRIVATE_KEY (the app's .pem), WEBHOOK_SECRET.
// Optional var: GITHUB_API (GitHub Enterprise Server API URL).
import { verifySignature, installationClient } from './github.mjs';
import { publish, CHECK_NAME } from './review.mjs';

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

async function handle(env, event, payload) {
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
      return new Response('fixlock GitHub App is running. https://abinandhmj.github.io/fixlock/github-app\n', { headers: { 'content-type': 'text/plain' } });
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
    ctx.waitUntil(handle(env, event, payload).catch((e) => console.error(`fixlock: ${event} failed`, e)));
    return new Response('Accepted\n', { status: 202 });
  },
};
