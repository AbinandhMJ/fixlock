'use strict';
// GitLab merge requests: who approved, who opened it, and one fixlock comment kept up to date. Used by
// `fixlock check` when it runs in a GitLab merge request pipeline (see ci/gitlab/fixlock.gitlab-ci.yml).
//
// Token: FIXLOCK_GITLAB_TOKEN (or GITLAB_TOKEN), a project access token with the "api" scope and the
// Reporter role (Developer to post the comment). Without one, fixlock can't see approvals: a locked change
// then stays blocked, and the job log says why. Works with GitLab.com and self-managed (CI_API_V4_URL).

const MARKER = '<!-- fixlock -->';

/** The merge request this pipeline runs for, or null outside GitLab MR pipelines. */
function context(env = process.env) {
  if (!env.GITLAB_CI || !env.CI_MERGE_REQUEST_IID || !env.CI_PROJECT_ID) return null;
  return {
    api: (env.CI_API_V4_URL || 'https://gitlab.com/api/v4').replace(/\/$/, ''),
    project: env.CI_PROJECT_ID,
    iid: env.CI_MERGE_REQUEST_IID,
    token: env.FIXLOCK_GITLAB_TOKEN || env.GITLAB_TOKEN || '',
    triggeredBy: env.GITLAB_USER_LOGIN || '',
  };
}

async function api(ctx, method, path, body) {
  const res = await fetch(`${ctx.api}/projects/${encodeURIComponent(ctx.project)}${path}`, {
    method,
    headers: { 'PRIVATE-TOKEN': ctx.token, 'Content-Type': 'application/json', 'User-Agent': 'fixlock' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitLab API ${res.status} on ${method} ${path}`);
  return res.status === 204 ? null : res.json();
}

/** GitLab usernames (lowercase) who approved the MR: { approvers: Set, source, error? }. */
async function approvers(ctx) {
  if (!ctx.token) return { approvers: new Set(), source: 'gitlab', error: 'no FIXLOCK_GITLAB_TOKEN, so approvals can\'t be read. Add a project access token (api scope) as a masked CI/CD variable.' };
  try {
    const a = await api(ctx, 'GET', `/merge_requests/${ctx.iid}/approvals`);
    return { approvers: new Set((a.approved_by || []).map((x) => String((x.user || {}).username || '').toLowerCase()).filter(Boolean)), source: `gitlab !${ctx.iid}` };
  } catch (e) {
    return { approvers: new Set(), source: 'gitlab', error: e.message };
  }
}

/** Who opened the MR (their own approval of their own locks counts, as on GitHub). */
async function author(ctx) {
  if (!ctx.token) return '';
  try { return String(((await api(ctx, 'GET', `/merge_requests/${ctx.iid}`)).author || {}).username || ''); } catch { return ''; }
}

/** Post the fixlock comment, or edit the one already there. */
async function upsertComment(ctx, markdown) {
  if (!ctx.token) return { skipped: 'no token' };
  const body = `${MARKER}\n${markdown}`;
  const notes = await api(ctx, 'GET', `/merge_requests/${ctx.iid}/notes?per_page=100&sort=asc`);
  const mine = (notes || []).find((n) => !n.system && String(n.body || '').startsWith(MARKER));
  if (mine) { await api(ctx, 'PUT', `/merge_requests/${ctx.iid}/notes/${mine.id}`, { body }); return { updated: mine.id }; }
  const n = await api(ctx, 'POST', `/merge_requests/${ctx.iid}/notes`, { body });
  return { created: n && n.id };
}

module.exports = { context, approvers, author, upsertComment, MARKER };
