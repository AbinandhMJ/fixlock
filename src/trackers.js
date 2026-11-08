'use strict';
// Tracker sync. Issue refs look like "linear:ENG-123", "clickup:86abc12", "notion:<page-id>", or a bare id
// (uses config.tracker.type). Tokens come from env: LINEAR_API_KEY, CLICKUP_TOKEN, NOTION_TOKEN.
// Bugasura, Jira, etc.: use type "webhook" pointed at Zapier/Make/n8n or your own endpoint.

const env = (k) => process.env[k];

async function http(method, url, headers, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
  return json;
}

function need(name) {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const adapters = {
  async linear(id, status, comment) {
    const url = env('FIXLOCK_LINEAR_URL') || 'https://api.linear.app/graphql';
    const h = { Authorization: need('LINEAR_API_KEY') };
    const gql = async (query, variables) => {
      const r = await http('POST', url, h, { query, variables });
      if (r.errors) throw new Error(`Linear: ${r.errors.map((e) => e.message).join('; ')}`);
      return r.data;
    };
    const d = await gql('query($id:String!){issue(id:$id){id team{states{nodes{id name}}}}}', { id });
    if (!d.issue) throw new Error(`Linear issue ${id} not found`);
    if (status) {
      const st = d.issue.team.states.nodes.find((s) => s.name.toLowerCase() === status.toLowerCase());
      if (!st) throw new Error(`Linear state "${status}" not found (have: ${d.issue.team.states.nodes.map((s) => s.name).join(', ')})`);
      await gql('mutation($id:String!,$s:String!){issueUpdate(id:$id,input:{stateId:$s}){success}}', { id: d.issue.id, s: st.id });
    }
    if (comment) await gql('mutation($id:String!,$b:String!){commentCreate(input:{issueId:$id,body:$b}){success}}', { id: d.issue.id, b: comment });
  },

  async clickup(id, status, comment) {
    const base = env('FIXLOCK_CLICKUP_URL') || 'https://api.clickup.com/api/v2';
    const h = { Authorization: need('CLICKUP_TOKEN') };
    if (status) await http('PUT', `${base}/task/${id}`, h, { status });
    if (comment) await http('POST', `${base}/task/${id}/comment`, h, { comment_text: comment, notify_all: false });
  },

  async notion(id, status, comment, cfg) {
    const base = env('FIXLOCK_NOTION_URL') || 'https://api.notion.com/v1';
    const h = { Authorization: `Bearer ${need('NOTION_TOKEN')}`, 'Notion-Version': '2022-06-28' };
    const prop = cfg.statusProperty || 'Status';
    const kind = cfg.statusPropertyType || 'status'; // or "select"
    if (status) await http('PATCH', `${base}/pages/${id}`, h, { properties: { [prop]: { [kind]: { name: status } } } });
    if (comment) await http('POST', `${base}/comments`, h, { parent: { page_id: id }, rich_text: [{ text: { content: comment } }] });
  },

  async webhook(id, status, comment, cfg, payload) {
    const url = cfg.url || env('FIXLOCK_WEBHOOK_URL');
    if (!url) throw new Error('tracker.url (or FIXLOCK_WEBHOOK_URL) is not set');
    const h = env('FIXLOCK_WEBHOOK_SECRET') ? { 'X-Fixlock-Secret': env('FIXLOCK_WEBHOOK_SECRET') } : {};
    await http('POST', url, h, { issue: id, status, message: comment, ...payload });
  },
};

function parseRef(ref, cfg) {
  if (!ref) return null;
  const m = String(ref).match(/^(linear|clickup|notion|webhook|bugasura):(.+)$/i);
  if (m) return { type: m[1].toLowerCase() === 'bugasura' ? 'webhook' : m[1].toLowerCase(), id: m[2] };
  return cfg && cfg.type ? { type: cfg.type, id: String(ref) } : null;
}

/**
 * event: "fixed" (lock registered) | "regression" (CI found the lock reverted)
 * Returns a short result string; never throws (tracker problems must not break CI).
 */
async function sync(cfg, lock, event, context = {}) {
  const tcfg = cfg.tracker || {};
  const ref = parseRef(lock.issue, tcfg);
  if (!ref) return null;
  const status = event === 'fixed' ? (tcfg.onFix ?? null) : (tcfg.onRegression ?? null);
  const comment = event === 'fixed'
    ? `🔒 Locked by fixlock as ${lock.id} — ${lock.file}. Future PRs that revert this ${lock.type === 'feature' ? 'feature' : 'fix'} will be flagged.`
    : `⚠️ fixlock: ${lock.id} "${lock.title}" was reverted${context.pr ? ` in PR #${context.pr}` : ''}${context.branch ? ` (branch ${context.branch})` : ''}${context.author ? ` by ${context.author}` : ''}. The bug may be back.`;
  try {
    await adapters[ref.type](ref.id, status, comment, tcfg, { event, lock: { id: lock.id, title: lock.title, type: lock.type, file: lock.file, owner: lock.owner }, ...context });
    return `${ref.type}:${ref.id} → ${status || 'commented'}`;
  } catch (e) {
    return `${ref.type}:${ref.id} sync failed: ${e.message}`;
  }
}

module.exports = { sync, parseRef, adapters };
