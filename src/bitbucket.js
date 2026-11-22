'use strict';
// Bitbucket Cloud pull requests: who approved, who opened it, and one fixlock comment kept up to date. Used
// by `fixlock check` when it runs in a Bitbucket Pipelines pull-request pipeline.
//
// Token: FIXLOCK_BITBUCKET_TOKEN, a repository access token (Repository settings > Access tokens) with the
// "Pull requests: Write" scope. Without one, fixlock can't see approvals: a locked change stays blocked and
// the log says why. Team members are matched by their Bitbucket nickname (`fixlock team add --bitbucket`).

const MARKER = '<!-- fixlock -->';

/** The pull request this pipeline runs for, or null outside Bitbucket PR pipelines. */
function context(env = process.env) {
  if (!env.BITBUCKET_PR_ID || !env.BITBUCKET_REPO_FULL_NAME) return null;
  return {
    api: (env.FIXLOCK_BITBUCKET_API || 'https://api.bitbucket.org/2.0').replace(/\/$/, ''),
    repo: env.BITBUCKET_REPO_FULL_NAME,
    id: env.BITBUCKET_PR_ID,
    token: env.FIXLOCK_BITBUCKET_TOKEN || env.BITBUCKET_TOKEN || '',
    web: env.BITBUCKET_GIT_HTTP_ORIGIN || `https://bitbucket.org/${env.BITBUCKET_REPO_FULL_NAME}`,
    target: env.BITBUCKET_PR_DESTINATION_BRANCH || '',
    pr: null,
  };
}

async function api(ctx, method, path, body) {
  const res = await fetch(`${ctx.api}/repositories/${ctx.repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'fixlock' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Bitbucket API ${res.status} on ${method} ${path}`);
  return res.status === 204 ? null : res.json();
}

async function pullRequest(ctx) {
  if (!ctx.pr) ctx.pr = await api(ctx, 'GET', `/pullrequests/${ctx.id}`);
  return ctx.pr;
}

const who = (u) => String((u && (u.nickname || u.username)) || '').toLowerCase();

/** Bitbucket nicknames (lowercase) who approved: { approvers: Set, source, error? }. */
async function approvers(ctx) {
  if (!ctx.token) return { approvers: new Set(), source: 'bitbucket', error: 'no FIXLOCK_BITBUCKET_TOKEN, so approvals can\'t be read. Add a repository access token (Pull requests: Write) as a secured repository variable.' };
  try {
    const pr = await pullRequest(ctx);
    return { approvers: new Set((pr.participants || []).filter((p) => p.approved).map((p) => who(p.user)).filter(Boolean)), source: `bitbucket #${ctx.id}` };
  } catch (e) {
    return { approvers: new Set(), source: 'bitbucket', error: e.message };
  }
}

async function author(ctx) {
  if (!ctx.token) return '';
  try { return who((await pullRequest(ctx)).author); } catch { return ''; }
}

async function mine(ctx) {
  const page = await api(ctx, 'GET', `/pullrequests/${ctx.id}/comments?pagelen=100`);
  return ((page && page.values) || []).find((cm) => !cm.deleted && String((cm.content || {}).raw || '').startsWith(MARKER)) || null;
}

async function previousBody(ctx) {
  if (!ctx.token) return null;
  try { await pullRequest(ctx); } catch { /* title and author are only nice to have */ }
  try { const cm = await mine(ctx); return cm ? cm.content.raw : null; } catch { return null; }
}

async function upsertComment(ctx, markdown) {
  if (!ctx.token) return { skipped: 'no token' };
  const raw = `${MARKER}\n${markdown}`;
  const cm = await mine(ctx);
  if (cm) { await api(ctx, 'PUT', `/pullrequests/${ctx.id}/comments/${cm.id}`, { content: { raw } }); return { updated: cm.id }; }
  const n = await api(ctx, 'POST', `/pullrequests/${ctx.id}/comments`, { content: { raw } });
  return { created: n && n.id };
}

function prInfo(ctx) {
  return { number: `#${ctx.id}`, title: (ctx.pr && ctx.pr.title) || '', url: `${ctx.web.replace(/\.git$/, '')}/pull-requests/${ctx.id}`, author: ctx.pr && ctx.pr.author ? `@${who(ctx.pr.author)}` : '' };
}

module.exports = { context, approvers, author, upsertComment, previousBody, prInfo, MARKER, name: 'Bitbucket', tokenVar: 'FIXLOCK_BITBUCKET_TOKEN', baseVar: 'BITBUCKET_PR_DESTINATION_BRANCH' };
