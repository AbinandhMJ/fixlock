'use strict';
// Editor-independent logic for the fixlock VS Code extension: finds the fixlock repo for a file,
// loads its config/registry, and works out where each lock sits in the current (possibly unsaved)
// text and whether it is still intact. Uses the bundled fixlock engine; never shells out.
const fs = require('fs');
const path = require('path');

const engine = (name) => require(path.join(__dirname, 'fixlock', 'src', name));

/** Closest ancestor of `dir` containing .fixlock/config.json or .fixlock/registry.json, or null. */
function findRoot(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.fixlock', 'registry.json')) || fs.existsSync(path.join(d, '.fixlock', 'config.json'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }

/** Config + registry for a repo root, merged with fixlock's defaults (same rules as the CLI). */
function loadState(root) {
  const { DEFAULT_CONFIG } = engine('store.js');
  const raw = readJson(path.join(root, '.fixlock', 'config.json'), {});
  const cfg = {
    ...DEFAULT_CONFIG, ...raw,
    team: raw.team || [],
    policies: { ...DEFAULT_CONFIG.policies, ...(raw.policies || {}) },
    matching: { ...DEFAULT_CONFIG.matching, ...(raw.matching || {}) },
  };
  const reg = readJson(path.join(root, '.fixlock', 'registry.json'), { locks: [] });
  if (reg.fixes && !reg.locks) reg.locks = reg.fixes.map((f) => ({ type: 'bug', ...f }));
  return { root, cfg, locks: reg.locks || [] };
}

/** Repo-relative POSIX path of an absolute file. */
function relPath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/**
 * Locks in `rel` and their state in `text`.
 * Returns [{ lock, range: [firstLine, lastLine] | null (1-based), status: "intact"|"renamed"|"changed",
 *            renames, missing, owner, approvers, policy }]
 */
function analyze(state, rel, text) {
  const L = engine('locks.js');
  const team = engine('team.js');
  const lines = text.split('\n');
  return state.locks.filter((l) => l.file === rel).map((lock) => {
    const v = L.verifyLock(lock, text, { mode: state.cfg.matching.mode, file: rel });
    const at = L.locate(lock, lines);
    const range = at.length ? [Math.min(...at), Math.max(...at)] : null;
    const policy = state.cfg.policies[lock.type] || state.cfg.policies.bug;
    return {
      lock, range, status: v.status, renames: v.renames, missing: v.missing,
      owner: team.handle(team.find(state.cfg, lock.owner)) || lock.owner,
      approvers: team.approvers(state.cfg, lock).map(team.handle),
      policy,
    };
  });
}

/** Markdown shown when hovering a locked line. */
function hoverText(item) {
  const { lock } = item;
  const kind = lock.type === 'feature' ? 'feature' : 'bug fix';
  let md = `**🔒 ${lock.id}** ${escape(lock.title)} _(${kind}, owner ${escape(item.owner)})_\n\n`;
  if (lock.reason && lock.reason !== lock.title) md += `**Why it exists:** ${escape(lock.reason)}\n\n`;
  if (lock.issue) md += `**Issue:** ${escape(lock.issue)}\n\n`;
  if (item.status === 'changed') md += '⚠️ **Your current edits change this locked code.** The PR will need approval';
  else if (item.status === 'renamed') md += `ℹ️ Renamed inside the lock (logic kept): ${item.renames.map(([a, b]) => `\`${a}\` → \`${b}\``).join(', ')}. Approval may be needed`;
  else md += 'Changing what this code does needs approval';
  md += item.approvers.length ? ` from ${item.approvers.map(escape).join(' or ')}.` : '.';
  md += `\n\nAI edits: **${item.policy.onEdit}** · PR approval: **${item.policy.approval}**`;
  return md;
}

/** Problems-panel entry for a lock the current text breaks, or null. */
function diagnostic(item) {
  if (item.status === 'intact') return null;
  const { lock } = item;
  if (item.status === 'renamed') {
    return { severity: 'info', message: `fixlock ${lock.id} "${lock.title}": renamed inside a locked ${lock.type === 'feature' ? 'feature' : 'fix'} (${item.renames.map(([a, b]) => `${a} → ${b}`).join(', ')}). Logic looks the same.` };
  }
  const gone = item.missing.slice(0, 3).map((l) => l.trim()).join(' | ');
  return {
    severity: 'warning',
    message: `fixlock ${lock.id} "${lock.title}" (owner ${item.owner}): this edit changes locked code${gone ? ` — ${gone}` : ''}. ` +
      (item.approvers.length ? `The PR will need approval from ${item.approvers.join(' or ')}.` : 'The PR will be flagged.'),
  };
}

function escape(s) { return String(s || '').replace(/([\\`*_{}[\]()#+!|<>])/g, '\\$1'); }

/** All locks of a repo for a picker: [{ label, description, detail, file }] */
function pickItems(state) {
  const team = engine('team.js');
  return state.locks.map((l) => ({
    label: `🔒 ${l.id} ${l.title}`,
    description: l.file,
    detail: [l.type === 'feature' ? 'feature' : 'bug fix', `owner ${team.handle(team.find(state.cfg, l.owner)) || l.owner}`, l.reason && l.reason !== l.title ? l.reason : null, l.issue].filter(Boolean).join(' · '),
    lock: l,
  }));
}

/** Which CLI to run: the repo's own installed fixlock (keeps versions in step), else the bundled one. */
function cliPath(root, override) {
  if (override) return override;
  const local = path.join(root || '', 'node_modules', '@abinandhmj', 'fixlock', 'bin', 'fixlock.js');
  if (root && fs.existsSync(local)) return local;
  return path.join(__dirname, 'fixlock', 'bin', 'fixlock.js');
}

module.exports = { findRoot, loadState, relPath, analyze, hoverText, diagnostic, pickItems, cliPath };
