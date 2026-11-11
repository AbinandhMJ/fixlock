'use strict';
// Claude Code PreToolUse hook: runs before Edit / MultiEdit / Write.
// Prints a decision so the developer (and the AI) know which fix/feature the edit would affect.
const fs = require('fs');
const path = require('path');
const s = require('./store');
const team = require('./team');
const { affected, norm, spanLines } = require('./locks');
const stable = require('./stable');
const g = require('./git');

const RANK = { warn: 1, ask: 2, block: 3 };

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function lineRange(content, needle) {
  const i = content.indexOf(needle);
  if (i < 0 || !needle) return null;
  return spanLines(content, i, needle);
}

/** Build {file, before, after, touched} from a Claude tool call. */
function changeFrom(input) {
  const t = input.tool_input || {};
  const file = t.file_path;
  if (!file) return null;
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (input.tool_name === 'Write') return { file, before, after: t.content || '' };
  const edits = input.tool_name === 'MultiEdit' ? (t.edits || []) : [t];
  let after = before;
  let lo = Infinity; let hi = -Infinity;
  for (const e of edits) {
    const r = lineRange(after, e.old_string || '');
    if (r) { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); }
    after = e.replace_all ? after.split(e.old_string).join(e.new_string) : after.replace(e.old_string, () => e.new_string);
  }
  return { file, before, after, touched: lo <= hi ? [lo, hi] : null };
}

function lockLines(cfg, hits) {
  return hits.map(({ lock, lines, removed, level }) => {
    const owner = team.find(cfg, lock.owner);
    const appr = team.approvers(cfg, lock).map(team.handle).join(' or ') || 'the team lead';
    const where = lines.length ? `lines ${Math.min(...lines)}-${Math.max(...lines)}` : 'its locked lines';
    const kind = lock.type === 'feature' ? 'feature' : 'bug fix';
    let m = `• ${lock.id} "${lock.title}" (${kind} by ${team.handle(owner) || lock.owner}) — ${lock.file} ${where}`;
    if (lock.reason && lock.reason !== lock.title) m += `\n  Why it exists: ${lock.reason}`;
    m += removed.length ? `\n  This edit removes/rewrites: ${removed.map((l) => l.trim()).join(' | ')}` : '\n  This edit touches those lines (they are kept).';
    if (level === 'block') m += `\n  Policy: AI must NOT change these lines. A human change needs PR approval from ${appr}.`;
    else if (level === 'ask') m += `\n  Policy: confirm with the developer; the PR will need approval from ${appr}.`;
    else m += `\n  Policy: warning only${(cfg.policies[lock.type] || {}).approval !== 'none' ? `; the PR will need approval from ${appr}` : ''}.`;
    return m;
  });
}

function message(cfg, hits, person, stableSum, file) {
  const parts = lockLines(cfg, hits);
  if (stableSum) parts.push(stable.describe(stableSum, file));
  const what = hits.length && stableSum ? 'locked and already-working code'
    : hits.length ? (hits.length === 1 ? 'a locked ' + (hits[0].lock.type === 'feature' ? 'feature' : 'bug fix') : hits.length + ' locked fixes/features')
      : 'code that already works';
  return `🔒 fixlock: heads up${person.name ? ' ' + String(person.name).split(/[ @]/)[0] : ''} — this change affects ${what}${hits.length ? ', which may bring back old behaviour' : ' and may change how it behaves'}:\n${parts.join('\n')}\n` +
    'AI: do not rewrite working code silently. Tell the developer exactly which lines you want to change and why, and only continue if they agree. Otherwise leave these lines as they are and build around them.';
}

/**
 * Decide what a proposed edit means. change: { file, before, after, touched? }
 * Returns null (nothing to report) or { level: "warn"|"ask"|"block", reason, locks: [...], stable: summary|null }.
 * Must be called with cwd inside the repo.
 */
function evaluate(change) {
  if (!s.configExists()) return null;
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const person = team.current(cfg);
  const hits = affected(reg, s.root(), change)
    .filter((h) => !team.exempt(cfg, h.lock, person))
    .map((h) => {
      const pol = (cfg.policies[h.lock.type] || cfg.policies.bug).onEdit;
      return { ...h, level: h.removed.length ? pol : 'warn' };
    });

  // Working-code guard: committed lines (someone else's, or your own older ones) being deleted/rewritten.
  let stableSum = null; let stableLevel = null;
  const sc = cfg.stableCode || {};
  if (sc.enabled !== false && change.before) {
    const rel = path.relative(s.root(), path.resolve(change.file));
    const lockedText = new Set(hits.flatMap((h) => h.lock.snippet.map(norm)));
    const removed = stable.removedLines(change.before, change.after).filter((r) => !lockedText.has(norm(r.text)));
    if (removed.length >= (sc.minLines || 1)) {
      const found = stable.stableRemovals(removed, g.blameFull(null, rel), person, sc);
      if (found.length >= (sc.minLines || 1)) { stableSum = stable.summarize(cfg, found, team); stableLevel = sc.onEdit || 'ask'; }
    }
  }
  if (!hits.length && !stableSum) return null;
  const level = [...hits.map((h) => h.level), stableLevel].filter(Boolean).reduce((m, l) => (RANK[l] > RANK[m] ? l : m), 'warn');
  const file = path.relative(s.root(), path.resolve(change.file)).split(path.sep).join('/');
  return {
    level,
    reason: message(cfg, hits, person, stableSum, file),
    locks: hits.map((h) => ({ id: h.lock.id, title: h.lock.title, type: h.lock.type, owner: h.lock.owner, level: h.level,
      lines: h.lines, removed: h.removed, approvers: team.approvers(cfg, h.lock).map(team.handle) })),
    stable: stableSum,
  };
}

function run() {
  try {
    const input = JSON.parse(readStdin() || '{}');
    if (!['Edit', 'MultiEdit', 'Write'].includes(input.tool_name)) return;
    if (input.cwd) process.chdir(input.cwd);
    const change = changeFrom(input);
    if (!change) return;
    const r = evaluate(change);
    if (!r) return;
    const out = r.level === 'warn'
      ? { systemMessage: r.reason }
      : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: r.level === 'block' ? 'deny' : 'ask', permissionDecisionReason: r.reason } };
    process.stdout.write(JSON.stringify(out));
  } catch {
    // A broken hook must never stop someone from working.
  }
}

module.exports = { run, changeFrom, message, evaluate };
