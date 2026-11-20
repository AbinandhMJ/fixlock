'use strict';
// Pre-edit hooks for Cursor and Windsurf (Devin Desktop), next to the Claude Code one in hook.js. They stop
// the agent before it writes over a locked fix, using the same decision as Claude Code (hook.evaluate):
//   lock policy "block" or "ask" → the edit is refused, with a message that says which fix and why;
//   "warn" → allowed.
// Neither editor can ask the developer mid-edit the way Claude Code does, so "ask" works like this: the
// agent explains the change, and if the developer agrees they run `fixlock allow FIX-001` (30 minutes by
// default) and the agent tries again. Shell hooks refuse `fixlock allow`, `fixlock remove` and
// `--no-verify` when the agent runs them, so only a person can unlock.
//
// Cursor: .cursor/hooks.json → preToolUse (file tools) and beforeShellExecution; reply {"permission": ...}.
// Windsurf / Devin Desktop: .devin/hooks.json and .windsurf/hooks.json → pre_write_code and pre_run_command;
// exit code 2 blocks, with the reason on stderr.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pick = (o, keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const PATH_KEYS = ['file_path', 'path', 'target_file', 'filePath', 'file', 'targetFile'];
const OLD_KEYS = ['old_string', 'old_str', 'oldString', 'old_text', 'search'];
const NEW_KEYS = ['new_string', 'new_str', 'newString', 'new_text', 'replace'];
const CONTENT_KEYS = ['contents', 'content', 'file_text', 'text', 'code'];

/** Apply [{old, new, all}] edits to text. A missing old string (or an empty one in an empty file) means "write". */
function applyEdits(before, edits) {
  let after = before;
  for (const e of edits) {
    const o = e.old == null ? '' : String(e.old);
    const n = e.new == null ? '' : String(e.new);
    if (!o) { after = after ? after + n : n; continue; }
    after = e.all ? after.split(o).join(n) : after.replace(o, () => n);
  }
  return after;
}

const readFile = (file) => (fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : '');

/**
 * A proposed change from a file tool's input, in the shape hook.evaluate wants: { file, before, after }.
 * Returns { unknown: true, file } when there's a file but fixlock can't tell what the tool will write.
 */
const WRITES = /write|edit|replace|patch|delete|remove|create|insert|apply|rename|move/i;

function changeFromInput(toolName, input, base) {
  if (!WRITES.test(String(toolName || ''))) return null; // reads, searches, tasks: nothing to judge
  const raw = pick(input, PATH_KEYS);
  if (!raw || typeof raw !== 'string') return null;
  const file = path.resolve(base || process.cwd(), raw);
  const before = readFile(file);
  if (/delete|remove/i.test(toolName || '')) return { file, before, after: '' };
  const content = pick(input, CONTENT_KEYS);
  if (typeof content === 'string' && pick(input, OLD_KEYS) === undefined) return { file, before, after: content };
  const list = pick(input, ['edits', 'changes', 'replacements']);
  const edits = Array.isArray(list) ? list : (pick(input, OLD_KEYS) !== undefined || pick(input, NEW_KEYS) !== undefined ? [input] : null);
  if (!edits) return { unknown: true, file, before };
  return { file, before, after: applyEdits(before, edits.map((e) => ({ old: pick(e, OLD_KEYS), new: pick(e, NEW_KEYS), all: !!pick(e, ['replace_all', 'replaceAll', 'all']) }))) };
}

/* ---------------- fixlock allow: the developer's OK, per clone, for a while ---------------- */

function allowFile(cwd = process.cwd()) {
  try {
    const dir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.resolve(cwd, dir, 'fixlock-allow.json');
  } catch { return null; }
}

/** Lock ids the developer has OK'd and that haven't run out: { [id]: expiresAtMs }. */
function allowed(cwd) {
  const f = allowFile(cwd);
  if (!f) return {};
  try {
    const all = JSON.parse(fs.readFileSync(f, 'utf8'));
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, t]) => t > now));
  } catch { return {}; }
}

function allow(ids, minutes = 30, cwd) {
  const f = allowFile(cwd);
  if (!f) throw new Error('Run this inside the git repository.');
  const cur = allowed(cwd);
  const until = Date.now() + minutes * 60e3;
  for (const id of ids) cur[id.toUpperCase()] = until;
  fs.writeFileSync(f, JSON.stringify(cur, null, 2));
  return until;
}

function clearAllowed(cwd) {
  const f = allowFile(cwd);
  if (f && fs.existsSync(f)) fs.unlinkSync(f);
}

/* ---------------- decisions ---------------- */

/** Commands an agent must not run: unlocking is the developer's call. */
const FORBIDDEN = [
  { re: /\bfixlock(?:@[\w.^~-]+)?(?:\.js)?["']?\s+(allow|remove|rm)\b/i, why: 'Only the developer can unlock or remove a fixlock lock.' },
  { re: /\bgit\s+(commit|push)\b[^|;&]*--no-verify\b/i, why: 'Skipping the git hooks (--no-verify) skips fixlock\'s checks.' },
];
function shellDecision(command) {
  for (const f of FORBIDDEN) if (f.re.test(String(command || ''))) return { deny: true, reason: `fixlock: ${f.why} Ask the developer to run it themselves if it's needed.` };
  return { deny: false };
}

/**
 * Decide an edit: { deny: false } or { deny: true, reason }. Locks the developer allowed are skipped;
 * the working-code guard only warns here (these editors have no "ask the developer" step).
 */
function editDecision(change, agent) {
  const hook = require('./hook');
  const s = require('./store');
  if (!s.configExists()) return { deny: false };
  const ok = allowed();
  if (change.unknown) {
    const L = require('./locks');
    const rel = L.repoRel(s.root(), change.file);
    const cfg = s.loadConfig();
    const rule = require('./rules').editRule(cfg, rel, agent);
    if (rule && (rule.level === 'block' || (rule.level === 'ask' && !ok[`RULE:${require('./rules').ruleName(rule.rule)}`.toUpperCase()]))) {
      return { deny: true, short: `fixlock stopped an AI edit to ${rel} (rule "${require('./rules').ruleName(rule.rule)}").`, reason: `fixlock: ${rule.message}\nThis edit was stopped.` };
    }
    const locks = s.loadRegistry().locks.filter((l) => l.file === rel && !ok[l.id.toUpperCase()] && ['ask', 'block'].includes((cfg.policies[l.type] || cfg.policies.bug).onEdit));
    if (!locks.length) return { deny: false };
    return { deny: true, short: `fixlock stopped an AI edit to ${rel}, which holds ${locks.map((l) => l.id).join(', ')}.`, reason: `fixlock: ${rel} holds locked ${locks.length > 1 ? 'fixes' : 'fix'} ${locks.map((l) => `${l.id} "${l.title}"`).join(', ')}, and fixlock couldn't see which lines this edit changes. Edit around the locked lines (see fixlock_why), or ask the developer.` };
  }
  const r = hook.evaluate(change, { agent });
  if (!r) return { deny: false };
  const blocking = r.locks.filter((l) => (l.level === 'block' || l.level === 'ask') && !ok[String(l.id).toUpperCase()]);
  // A team rule for this path (policy as code): "block" always stops; "ask" stops until the developer allows it.
  if (r.rule && (r.rule.level === 'block' || (r.rule.level === 'ask' && !ok[`RULE:${r.rule.name}`.toUpperCase()]))) {
    const rel = require('./locks').repoRel(require('./store').root(), change.file);
    return {
      deny: true,
      short: `fixlock stopped an AI edit to ${rel}: rule "${r.rule.name}" ${r.rule.level === 'block' ? 'keeps AI out of these files' : 'says to ask first'}.${r.rule.level === 'ask' ? ` If the change is intended, run: fixlock allow "rule:${r.rule.name}"` : ''}`,
      reason: `${r.reason}\n${r.rule.level === 'ask' ? `This edit was stopped. Explain the change to the developer; if they agree, they run \`fixlock allow "rule:${r.rule.name}"\` and you try again. Don't run that command yourself.` : 'This edit was stopped. Leave this file to a person.'}`,
    };
  }
  if (!blocking.length) return { deny: false, note: r.reason };
  const ids = blocking.map((l) => l.id).join(' ');
  const askOnly = blocking.every((l) => l.level === 'ask');
  const names = blocking.map((l) => `${l.id} "${l.title}" (owner ${(l.approvers && l.approvers[0]) || l.owner})`).join(', ');
  return {
    deny: true,
    short: `fixlock stopped an AI edit to the locked ${blocking.length > 1 ? 'fixes' : 'fix'} ${names}.${askOnly ? ` If the change is intended, run: fixlock allow ${ids}` : ''}`,
    reason: `${r.reason}\n${askOnly
      ? `This edit was stopped. Explain to the developer which lines you want to change and why. If they agree, they run \`fixlock allow ${ids}\` (it lasts 30 minutes) and you try again. Don't run that command yourself.`
      : `This edit was stopped: the lock policy says AI must not change these lines. Leave them as they are and build around them; a person can change them with approval in the PR.`}`,
  };
}

const readStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };
const chdirTo = (dir) => { try { if (dir && fs.existsSync(dir)) process.chdir(dir); } catch { /* stay */ } };

/** `fixlock hook cursor`: preToolUse (file tools) and beforeShellExecution. Always answers with JSON. */
function runCursor() {
  let out = { permission: 'allow' };
  try {
    const input = JSON.parse(readStdin() || '{}');
    const ev = input.hook_event_name || '';
    const root = (input.workspace_roots && input.workspace_roots[0]) || input.cwd;
    if (ev === 'beforeShellExecution' || input.tool_name === 'Shell') {
      const d = shellDecision(input.command || (input.tool_input || {}).command);
      if (d.deny) out = { permission: 'deny', user_message: d.reason, agent_message: d.reason };
    } else {
      const change = changeFromInput(input.tool_name, input.tool_input || {}, input.cwd || root);
      if (change) {
        chdirTo(path.dirname(change.file));
        const d = editDecision(change, 'cursor');
        if (d.deny) out = { permission: 'deny', user_message: d.short || d.reason.split('\n')[0], agent_message: d.reason };
      }
    }
  } catch { /* a broken hook must never stop anyone working */ }
  process.stdout.write(JSON.stringify(out));
}

/** `fixlock hook windsurf`: pre_write_code and pre_run_command. Exit 2 with the reason on stderr blocks. */
function runWindsurf() {
  let d = { deny: false };
  try {
    const input = JSON.parse(readStdin() || '{}');
    const ev = input.agent_action_name || '';
    const t = input.tool_info || {};
    if (ev === 'pre_run_command') d = shellDecision(t.command_line || t.command);
    else if (ev === 'pre_write_code') {
      const change = changeFromInput('edit', t, t.cwd);
      if (change) { chdirTo(path.dirname(change.file)); d = editDecision(change, 'windsurf'); }
    }
  } catch { d = { deny: false }; }
  if (d.deny) { process.stderr.write(d.reason + '\n'); process.exitCode = 2; }
}

module.exports = { applyEdits, changeFromInput, shellDecision, editDecision, allow, allowed, clearAllowed, runCursor, runWindsurf };
