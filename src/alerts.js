'use strict';
// Slack / Microsoft Teams / webhook alerts from `fixlock check --alert` (the Action's `alert: true`).
//
// Where: FIXLOCK_SLACK_WEBHOOK (Slack incoming webhook), FIXLOCK_TEAMS_WEBHOOK (a Teams "Workflows"
// webhook: "Post to a channel when a webhook request is received"), FIXLOCK_ALERT_WEBHOOK (any URL: JSON).
// Webhook URLs are secrets, so they come from the environment, never from .fixlock/config.json.
//
// What (cfg.alerts.on): "blocked" a change needs a lock owner's / lead's approval
//                       "approved" it was approved      "satisfied" its linked test vouched for it
//                       "test-failed" a lock's test fails        "ai-broken" the AI review says the fix looks broken
//                       "merged-blocked" a PR was merged while still blocked
// Each PR alerts once per change of state: the state is kept, hidden, in the fixlock PR comment.
const STATE_RE = /<!-- fixlock-state (\{[\s\S]*?\}) -->/;
const DEFAULT_ON = ['blocked', 'approved', 'test-failed', 'ai-broken', 'merged-blocked'];

const keyOf = (f) => (f.kind === 'rule' ? `rule:${f.rule.name || f.rule.paths.join(',')}` : f.registry ? `${f.lock.id}:registry` : f.lock.id);

/** The state to remember for this run: { key: "blocked" | "approved" | ..., "key#test": "failed", ... }. */
function stateOf(findings) {
  const s = {};
  for (const f of findings.filter((x) => x.kind === 'lock' || x.kind === 'rule')) {
    s[keyOf(f)] = f.status;
    if (f.test) s[`${keyOf(f)}#test`] = f.test.status;
    if (f.judge) s[`${keyOf(f)}#ai`] = f.judge.verdict;
  }
  return s;
}

const stateComment = (state) => `\n<!-- fixlock-state ${JSON.stringify(state)} -->\n`;
function readState(body) {
  const m = STATE_RE.exec(String(body || ''));
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

/** What changed since the last run, as alert events: [{ type, finding }]. prev null = first run. */
function events(findings, prev) {
  const out = [];
  const was = prev || {};
  for (const f of findings.filter((x) => x.kind === 'lock' || x.kind === 'rule')) {
    const k = keyOf(f);
    if (f.status === 'blocked' && was[k] !== 'blocked') out.push({ type: 'blocked', finding: f });
    if (f.status === 'approved' && was[k] === 'blocked') out.push({ type: 'approved', finding: f });
    if (f.status === 'satisfied' && was[k] !== 'satisfied') out.push({ type: 'satisfied', finding: f });
    if (f.test && f.test.status === 'failed' && was[`${k}#test`] !== 'failed') out.push({ type: 'test-failed', finding: f });
    if (f.judge && f.judge.verdict === 'broken' && was[`${k}#ai`] !== 'broken') out.push({ type: 'ai-broken', finding: f });
  }
  return out;
}

const LABEL = {
  blocked: 'needs approval', approved: 'approved', satisfied: 'its test still passes',
  'test-failed': 'its test fails', 'ai-broken': 'AI review: the fix looks broken', 'merged-blocked': 'merged while blocked',
};

function lineFor(e, team) {
  const f = e.finding;
  if (!f) return `${e.key}: ${LABEL[e.type]}`;
  const who = (f.approvers || []).map((a) => (a.slack ? `<@${a.slack}>` : team.handle(a))).filter(Boolean).join(' or ');
  const what = f.kind === 'rule' ? `rule "${f.rule.name || f.rule.paths.join(', ')}" (${f.files.length === 1 ? f.files[0] : `${f.files.length} files`})` : f.registry ? `${f.lock.id} "${f.lock.title}" ${f.registry === 'removed' ? 'removed from' : 'changed in'} ${f.file}` : `${f.lock.id} "${f.lock.title}" in ${f.file}`;
  return `${what}: ${LABEL[e.type]}${e.type === 'blocked' && who ? ` from ${who}` : ''}`;
}

/** One message for this run. pr: { url, title, number, author }. */
function compose(evts, pr, team) {
  const worst = evts.some((e) => e.type === 'merged-blocked') ? 'merged-blocked' : evts.some((e) => e.type === 'test-failed' || e.type === 'ai-broken') ? 'broken' : evts.some((e) => e.type === 'blocked') ? 'blocked' : 'ok';
  const title = {
    'merged-blocked': `fixlock: ${pr.number ? `${pr.number} ` : ''}was merged while a locked fix still needed approval`,
    broken: `fixlock: ${pr.number ? `${pr.number} ` : ''}looks like it breaks a locked fix`,
    blocked: `fixlock: ${pr.number ? `${pr.number} ` : ''}changes a locked fix and needs approval`,
    ok: `fixlock: ${pr.number ? `${pr.number} ` : ''}locked changes cleared`,
  }[worst];
  return { title, lines: evts.map((e) => lineFor(e, team)), worst };
}

const slackPayload = (msg, pr) => {
  const head = pr.url ? `<${pr.url}|${msg.title}>` : msg.title;
  const sub = [pr.title && `"${pr.title}"`, pr.author && `by ${pr.author}`].filter(Boolean).join(' ');
  const text = `*${head}*${sub ? `\n${sub}` : ''}\n${msg.lines.map((l) => `• ${l}`).join('\n')}`;
  return { text: `${msg.title}${sub ? `: ${sub}` : ''}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
};

const teamsPayload = (msg, pr) => ({
  type: 'message',
  attachments: [{
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [
        { type: 'TextBlock', text: msg.title, weight: 'Bolder', wrap: true, color: msg.worst === 'ok' ? 'Good' : 'Attention' },
        ...(pr.title ? [{ type: 'TextBlock', text: `"${pr.title}"${pr.author ? ` by ${pr.author}` : ''}`, isSubtle: true, wrap: true }] : []),
        ...msg.lines.map((l) => ({ type: 'TextBlock', text: `- ${l.replace(/<@[A-Z0-9]+>/g, '')}`, wrap: true })),
      ],
      actions: pr.url ? [{ type: 'Action.OpenUrl', title: 'Open the pull request', url: pr.url }] : [],
    },
  }],
});

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
}

/** Send to every configured sink. Returns [{ to, ok, error? }]. */
async function send(evts, pr, cfg, team, env = process.env) {
  const on = new Set(((cfg.alerts || {}).on) || DEFAULT_ON);
  const wanted = evts.filter((e) => on.has(e.type));
  if (!wanted.length) return [];
  const msg = compose(wanted, pr, team);
  const sinks = [
    ['slack', env.FIXLOCK_SLACK_WEBHOOK, () => slackPayload(msg, pr)],
    ['teams', env.FIXLOCK_TEAMS_WEBHOOK, () => teamsPayload(msg, pr)],
    ['webhook', env.FIXLOCK_ALERT_WEBHOOK, () => ({ source: 'fixlock', title: msg.title, pr, events: wanted.map((e) => ({ type: e.type, text: lineFor(e, team) })) })],
  ].filter(([, url]) => url);
  const results = [];
  for (const [to, url, payload] of sinks) {
    try { await postJson(url, payload()); results.push({ to, ok: true }); } catch (e) { results.push({ to, ok: false, error: e.message }); }
  }
  return results;
}

const configured = (env = process.env) => !!(env.FIXLOCK_SLACK_WEBHOOK || env.FIXLOCK_TEAMS_WEBHOOK || env.FIXLOCK_ALERT_WEBHOOK);

module.exports = { DEFAULT_ON, stateOf, stateComment, readState, events, compose, slackPayload, teamsPayload, send, configured, keyOf };
