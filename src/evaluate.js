'use strict';
// The heart of `fixlock check`, with no git and no disk: give it file contents and it says which locks a
// change touches, who must approve, and what the PR comment says. Used by the CLI and by the GitHub App
// (a Cloudflare Worker), so both always judge a PR the same way.
const L = require('./locks');
const team = require('./team');

const policyOf = (cfg, lock) => cfg.policies[lock.type] || cfg.policies.bug;

/**
 * Locks that are changed in the new version of the code.
 * read(file)  → new content, or null if the file is gone
 * good(file)  → known-good (base) content; only asked for locks that don't record their siblings
 * renames     → { oldPath: newPath } so a lock follows its file
 * only        → optional Set of paths: check just the locks in these files (or renamed from them)
 */
async function lockFindings(cfg, reg, { read, good, renames = {}, only = null }) {
  const match = cfg.matching || {};
  const findings = [];
  for (const lock of reg.locks) {
    const target = renames[lock.file] || lock.file;
    if (only && !only.has(lock.file) && !only.has(target)) continue;
    const content = await read(target);
    const before = lock.siblings === undefined && content !== null && good ? await good(lock.file) : undefined;
    const v = L.verifyLock(lock, content, { mode: match.mode, file: target, before });
    if (v.status === 'changed') findings.push({ kind: 'lock', lock, file: target, missing: v.missing, renamed: [], copies: v.copies || null, deleted: content === null });
    else if (v.status === 'renamed' && match.renames !== 'allow') findings.push({ kind: 'lock', lock, file: target, missing: [], renamed: v.renames, deleted: false });
  }
  return findings;
}

/** Changed files under cfg.protectedPaths: warnings only. changes: [{ file, from }] */
function pathFindings(cfg, changes) {
  const out = [];
  for (const ch of changes) {
    const hit = (cfg.protectedPaths || []).find((pp) => ch.file.startsWith(pp) || (ch.from || '').startsWith(pp));
    if (hit) out.push({ kind: 'path', file: ch.file, msg: `${ch.file} changed (protected path ${hit})` });
  }
  return out;
}

const renameWarnOnly = (cfg, f) => f.renamed && f.renamed.length && ((cfg.matching || {}).renames || 'warn') === 'warn';

/** Lock findings that someone has to approve (so it's worth asking GitHub for the PR's reviews). */
function needingApproval(cfg, findings) {
  return findings.filter((f) => f.kind === 'lock' && !renameWarnOnly(cfg, f) && policyOf(cfg, f.lock).approval !== 'none');
}

/**
 * Set f.status on each lock finding: "warn" | "approved" | "blocked".
 * approvers: Set of lowercase GitHub logins whose latest review is APPROVED; author: PR author's login.
 * Returns the blocked findings.
 */
function applyApprovals(cfg, findings, { approvers = new Set(), author = '' } = {}) {
  const who = String(author || '').toLowerCase();
  for (const f of findings.filter((x) => x.kind === 'lock')) {
    const pol = policyOf(cfg, f.lock);
    f.approvers = team.approvers(cfg, f.lock);
    const gh = f.approvers.map((a) => (a.github || '').toLowerCase()).filter(Boolean);
    if (pol.approval === 'none' || renameWarnOnly(cfg, f)) f.status = 'warn';
    else if (gh.some((u) => approvers.has(u))) f.status = 'approved';
    else if (who && gh.includes(who)) f.status = 'approved';
    else f.status = 'blocked';
  }
  return findings.filter((f) => f.status === 'blocked');
}

/** Latest review state per reviewer → Set of logins (lowercase) whose latest review is APPROVED. */
function approvedBy(reviews) {
  const latest = {};
  for (const r of reviews || []) if (r.user && r.state !== 'COMMENTED') latest[r.user.login.toLowerCase()] = r.state;
  return new Set(Object.keys(latest).filter((u) => latest[u] === 'APPROVED'));
}

/** The PR comment. */
function toMarkdown(cfg, findings, base) {
  if (!findings.length) return `### fixlock: all clear\nEvery locked fix and feature is intact (base \`${base}\`).\n`;
  const blocked = findings.filter((f) => f.status === 'blocked');
  let md = `### fixlock: ${blocked.length ? `${blocked.length} locked change(s) need approval` : 'review notes'}\n\n`;
  for (const f of findings) {
    if (f.kind === 'path') { md += `- **Warning:** ${f.msg}\n`; continue; }
    if (f.kind === 'stable') { md += `- **Rewrite of working code:** ${f.msg}. Check this was intended.\n`; continue; }
    const label = { blocked: 'Needs approval', approved: 'Approved', warn: 'Changed' }[f.status];
    md += `- **${label}: ${f.lock.id}** ${f.lock.title} (${f.lock.type}) — \`${f.file}\`\n`;
    if (f.lock.reason && f.lock.reason !== f.lock.title) md += `  - Why it exists: ${f.lock.reason}\n`;
    if (f.missing.length) md += `  - Removed/rewritten: ${f.missing.map((l) => '`' + l.trim().replace(/`/g, "'") + '`').join(', ')}\n`;
    if (f.renamed && f.renamed.length) md += `  - Renamed inside the lock (logic kept): ${f.renamed.map(([a, b]) => '`' + a + '` → `' + b + '`').join(', ')}\n`;
    if (f.status === 'blocked') md += `  - **Approve this PR as ${f.approvers.map(team.handle).join(' or ')}** to accept the change, or restore the lines.\n`;
    if (f.tracker) md += `  - Tracker: ${f.tracker}\n`;
  }
  return md;
}

module.exports = { lockFindings, pathFindings, needingApproval, applyApprovals, approvedBy, toMarkdown };
