'use strict';
// Policy as code: rules for paths, per AI agent, in .fixlock/config.json → "rules". No git or disk here, so
// the CLI, the hooks, the MCP server and the GitHub App all apply them the same way.
//
//   "rules": [
//     { "name": "billing", "paths": ["src/billing/**"], "ai": "block", "approval": "lead",
//       "reason": "Money moves here: a person writes these changes." },
//     { "name": "migrations", "paths": ["db/migrations/**"], "agents": ["cursor", "copilot"], "ai": "ask" },
//     { "name": "auth", "paths": ["src/auth/**"], "approval": "lead", "aiOnly": true }
//   ]
//
// ai        what an AI agent may do before editing a matching file: "allow" | "warn" | "ask" | "block"
//           (Claude Code, Cursor and Windsurf hooks, and the MCP server's fixlock_check_edit)
// agents    which agents the "ai" level and "aiOnly" apply to (default: all). Ids: claude-code, cursor,
//           windsurf, copilot, codex, gemini, devin, aider, jules
// approval  what a PR that changes a matching file needs: "none" | "lead" (any lead) | "approvers"
// approvers GitHub/GitLab usernames or team names who can approve (with approval "approvers", or added to leads)
// aiOnly    only ask for approval when AI-written commits (by the agents above) changed the files
// reason    shown to the agent and in the PR comment

const RANK = { allow: 0, warn: 1, ask: 2, block: 3 };
const AGENTS = ['claude-code', 'cursor', 'windsurf', 'copilot', 'codex', 'gemini', 'devin', 'aider', 'jules'];

/** A glob ("src/**", "*.sql", "db/migrations/*.ts") as a RegExp over repo-relative paths. */
function globToRe(glob) {
  let g = String(glob).replace(/^\.?\//, '');
  if (g.endsWith('/')) g += '**';
  if (!g.includes('/')) g = `**/${g}`; // like .gitignore: "*.sql" matches in any folder
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // "src/billing" (no wildcard) also covers everything under it
  return new RegExp(`^${re}${/[*?]/.test(g) ? '' : '(?:/.*)?'}$`);
}

const toPosix = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
const rulesOf = (cfg) => (Array.isArray(cfg.rules) ? cfg.rules : []).filter((r) => r && Array.isArray(r.paths) && r.paths.length);
const covers = (rule, file) => rule.paths.some((p) => globToRe(p).test(toPosix(file)));
const forAgent = (rule, agent) => !rule.agents || !rule.agents.length || rule.agents.includes('*') || (agent && rule.agents.includes(agent));
const ruleName = (r) => r.name || r.paths.join(', ');

/** Rules whose paths cover this file. */
function matching(cfg, file) { return rulesOf(cfg).filter((r) => covers(r, file)); }

/**
 * Before an AI edit: the strictest "ai" level for this file and agent.
 * Returns null, or { level, rule, message }.
 */
function editRule(cfg, file, agent) {
  let best = null;
  for (const r of matching(cfg, file)) {
    if (!r.ai || !(r.ai in RANK) || r.ai === 'allow' || !forAgent(r, agent)) continue;
    if (!best || RANK[r.ai] > RANK[best.level]) best = { level: r.ai, rule: r };
  }
  if (!best) return null;
  const r = best.rule;
  const who = r.agents && r.agents.length && !r.agents.includes('*') ? r.agents.join(', ') : 'AI assistants';
  const what = { warn: 'may edit with care', ask: 'must ask the developer before editing', block: 'must not edit' }[best.level];
  best.message = `• Rule "${ruleName(r)}" (${r.paths.join(', ')}): ${who} ${what} these files.${r.reason ? `\n  Why: ${r.reason}` : ''}`;
  return best;
}

/** Which AI agent wrote a commit, from its author and Co-authored-by trailers. null for people. */
function agentOf(commit) {
  const text = `${commit.authorName || ''} <${commit.authorEmail || ''}>\n${commit.body || ''}`;
  const trailers = text.split('\n').filter((l, i) => i === 0 || /^\s*co-authored-by:/i.test(l)).join('\n');
  const pairs = [
    ['claude-code', /anthropic\.com|\bclaude\b/i],
    ['cursor', /cursoragent@cursor\.com|cursor\s*agent|\bcursor\.com\b/i],
    ['copilot', /\bcopilot\b|copilot-swe-agent/i],
    ['codex', /\bcodex\b|chatgpt-codex|@openai\.com/i],
    ['devin', /devin-ai-integration|\bdevin\b/i],
    ['windsurf', /windsurf|codeium|cascade/i],
    ['gemini', /\bgemini\b/i],
    ['jules', /google-labs-jules|\bjules\b/i],
    ['aider', /\baider\b/i],
  ];
  for (const [id, re] of pairs) if (re.test(trailers)) return id;
  return null;
}

/**
 * Rules a change trips in a PR: findings that need approval.
 * changes: [{ file, from }]; aiFiles: Map file → Set of agent ids that changed it (null when unknown).
 */
function ruleFindings(cfg, changes, { aiFiles = null } = {}) {
  const out = [];
  for (const r of rulesOf(cfg)) {
    if (!r.approval || r.approval === 'none') continue;
    let files = changes.filter((ch) => covers(r, ch.file) || (ch.from && covers(r, ch.from))).map((ch) => ch.file);
    if (r.aiOnly) {
      if (!aiFiles) continue; // we can't tell who wrote what
      files = files.filter((f) => [...(aiFiles.get(f) || [])].some((a) => forAgent(r, a)));
    }
    files = [...new Set(files)];
    if (!files.length) continue;
    const agents = aiFiles ? [...new Set(files.flatMap((f) => [...(aiFiles.get(f) || [])]))] : [];
    out.push({
      kind: 'rule', rule: r, files, agents,
      file: files[0],
      msg: `${files.length === 1 ? files[0] : `${files.length} files`} changed under rule "${ruleName(r)}"${r.aiOnly && agents.length ? ` by AI (${agents.join(', ')})` : ''}`,
    });
  }
  return out;
}

module.exports = { RANK, AGENTS, globToRe, matching, editRule, agentOf, ruleFindings, ruleName };
