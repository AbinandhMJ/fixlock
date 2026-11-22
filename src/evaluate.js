'use strict';
// The heart of `fixlock check`, with no git and no disk: give it file contents and it says which locks a
// change touches, who must approve, and what the PR comment says. Used by the CLI and by the GitHub App
// (a Cloudflare Worker), so both always judge a PR the same way.
const L = require('./locks');
const team = require('./team');
const rules = require('./rules');

const policyOf = (cfg, lock) => cfg.policies[lock.type] || cfg.policies.bug;
const today = () => new Date().toISOString().slice(0, 10);
/** A lock past its "expires" date only warns: its owner chose to stop guarding it then. */
const expired = (lock, on = today()) => !!lock.expires && lock.expires < on;

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
    if (v.status === 'changed') findings.push({ kind: 'lock', lock, file: target, missing: v.missing, renamed: [], copies: v.copies || null, deleted: content === null, expired: expired(lock) });
    else if (v.status === 'renamed' && match.renames !== 'allow') findings.push({ kind: 'lock', lock, file: target, missing: [], renamed: v.renames, deleted: false, expired: expired(lock) });
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
  return findings.filter((f) => f.kind === 'rule' || (f.kind === 'lock' && !renameWarnOnly(cfg, f) && !f.expired && policyOf(cfg, f.lock).approval !== 'none'));
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
    // Usernames on the code host: GitHub, or GitLab (a member's gitlab field, else their github one).
    const gh = f.approvers.flatMap((a) => [a.github, a.gitlab, a.bitbucket]).map((u) => String(u || '').toLowerCase()).filter(Boolean);
    if (pol.approval === 'none' || renameWarnOnly(cfg, f) || f.expired) f.status = 'warn';
    else if (gh.some((u) => approvers.has(u))) f.status = 'approved';
    else if (who && gh.includes(who)) f.status = 'approved';
    else f.status = 'blocked';
    if (f.status === 'blocked' && !gh.length) f.unapprovable = unapprovable(f.approvers);
  }
  // Rules (policy as code): a lead, or the rule's own approvers.
  for (const f of findings.filter((x) => x.kind === 'rule')) {
    f.approvers = ruleApprovers(cfg, f.rule);
    const names = f.approvers.flatMap((a) => [a.github, a.gitlab, a.bitbucket]).map((u) => String(u || '').toLowerCase()).filter(Boolean);
    f.status = names.some((u) => approvers.has(u)) || (who && names.includes(who)) ? 'approved' : 'blocked';
    if (f.status === 'blocked' && !names.length) f.unapprovable = f.approvers.length ? unapprovable(f.approvers) : `Nobody can approve rule "${rules.ruleName(f.rule)}": the team has no lead and the rule lists no approvers.`;
  }
  return findings.filter((f) => f.status === 'blocked');
}

/** Who can approve a rule: its approvers (people or usernames), plus the leads unless approval is "approvers". */
function ruleApprovers(cfg, rule) {
  const listed = (rule.approvers || []).map((x) => team.find(cfg, String(x).replace(/^@/, '')) || { name: String(x), github: String(x).replace(/^@/, ''), emails: [], role: 'reviewer' });
  const leads = rule.approval === 'approvers' ? [] : cfg.team.filter((m) => m.role === 'lead');
  return [...new Set([...listed, ...leads])];
}

/**
 * Test-linked locks: results = { [testFile]: { status, command, output } } from src/tests.js; changed = Set
 * of files the change touches. A blocked lock whose test passes, and wasn't itself changed, is satisfied
 * (cfg.tests.satisfies). Sets f.test on each lock finding with a test. Returns the findings still blocked.
 */
function applyTests(cfg, findings, results, changed = new Set()) {
  const satisfies = ((cfg.tests || {}).satisfies) !== false;
  for (const f of findings.filter((x) => x.kind === 'lock' && x.lock.test && results[x.lock.test])) {
    const r = results[f.lock.test];
    const touched = changed.has(f.lock.test);
    f.test = { file: f.lock.test, status: r.status === 'passed' && touched ? 'changed' : r.status, command: r.command, output: r.output };
    if (f.test.status === 'passed' && satisfies && f.status === 'blocked') f.status = 'satisfied';
  }
  return findings.filter((f) => f.status === 'blocked');
}

/** One line on a lock's test result, for the PR comment and the terminal. */
function testNote(t) {
  if (!t) return '';
  const name = `\`${t.file}\``;
  return {
    passed: `Its test ${name} still passes and isn't changed here, so the fix holds after this change.`,
    changed: `Its test ${name} passes, but this change also edits the test, so the test can't stand in for an approval.`,
    failed: `**Its test ${name} fails**: the fix looks broken by this change.`,
    timeout: `Its test ${name} timed out.`,
    missing: `Its test ${name} doesn't exist any more.`,
    'no-runner': `Its test ${name} wasn't run: fixlock doesn't know the command. Set \`tests.commands\` in \`.fixlock/config.json\`.`,
  }[t.status] || '';
}

/** The AI reviewer's note (kept here so the evaluator stays free of network code). */
function judgeNote(jd) {
  if (!jd) return '';
  if (jd.verdict === 'error') return `AI review couldn't run (${jd.explanation}).`;
  const head = { preserved: 'AI review: the fix looks preserved', broken: '**AI review: the fix looks broken**', unsure: 'AI review: unsure' }[jd.verdict] || 'AI review';
  return `${head}${jd.model ? ` (${jd.model})` : ''}. ${jd.explanation} This is advice; the lock still needs its owner's approval.`;
}

/** Why nobody can approve a lock on GitHub, and how to fix it. */
function unapprovable(approvers) {
  if (!approvers.length) return 'Nobody can approve this: the lock has no owner on the team and the team has no lead. Add one with `fixlock team add --name "…" --github <username> --role lead`, or restore the lines.';
  const names = approvers.map((m) => m.name);
  const m = approvers[0];
  const cmd = `fixlock team add --name "${m.name}" --github <username>${m.emails && m.emails[0] ? ` --email ${m.emails[0]}` : ''} --role ${m.role}`;
  return `${names.join(' and ')} ${names.length > 1 ? 'have' : 'has'} no GitHub or GitLab username in \`.fixlock/config.json\`, so this can't be approved in the PR. Add it with \`${cmd}\` (or \`--gitlab <username>\`), or restore the lines.`;
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
  if (!blocked.length && findings.length && findings.every((f) => f.status === 'satisfied')) {
    let ok = `### fixlock: locked code changed, and its tests still pass\n\n`;
    for (const f of findings) ok += `- **Test passes: ${f.lock.id}** ${f.lock.title} (${f.lock.type}) — \`${f.file}\`\n  - ${testNote(f.test)}\n`;
    return ok;
  }
  let md = `### fixlock: ${blocked.length ? `${blocked.length} locked change(s) need approval` : 'review notes'}\n\n`;
  for (const f of findings) {
    if (f.kind === 'path') { md += `- **Warning:** ${f.msg}\n`; continue; }
    if (f.kind === 'stable') { md += `- **Rewrite of working code:** ${f.msg}. Check this was intended.\n`; continue; }
    if (f.kind === 'rule') {
      md += `- **${f.status === 'approved' ? 'Approved' : 'Needs approval'}: rule "${rules.ruleName(f.rule)}"** — ${f.msg}\n`;
      if (f.rule.reason) md += `  - Why: ${f.rule.reason}\n`;
      if (f.files.length > 1) md += `  - Files: ${f.files.slice(0, 10).map((x) => `\`${x}\``).join(', ')}${f.files.length > 10 ? ', …' : ''}\n`;
      if (f.status === 'blocked' && f.unapprovable) md += `  - ${f.unapprovable}\n`;
      else if (f.status === 'blocked') md += `  - **Approve this PR as ${f.approvers.map(team.handle).join(' or ')}** to accept it.\n`;
      continue;
    }
    const label = { blocked: 'Needs approval', approved: 'Approved', warn: 'Changed', satisfied: 'Test passes' }[f.status];
    md += `- **${label}: ${f.lock.id}** ${f.lock.title} (${f.lock.type}) — \`${f.file}\`\n`;
    if (f.lock.reason && f.lock.reason !== f.lock.title) md += `  - Why it exists: ${f.lock.reason}\n`;
    if (f.missing.length) md += `  - Removed/rewritten: ${f.missing.map((l) => '`' + l.trim().replace(/`/g, "'") + '`').join(', ')}\n`;
    if (f.renamed && f.renamed.length) md += `  - Renamed inside the lock (logic kept): ${f.renamed.map(([a, b]) => '`' + a + '` → `' + b + '`').join(', ')}\n`;
    if (f.test) md += `  - ${testNote(f.test)}\n`;
    if (f.test && f.test.status === 'failed' && f.test.output) md += `  <details><summary>Test output</summary>\n\n\`\`\`\n${f.test.output.replace(/\`\`\`/g, "'''")}\n\`\`\`\n</details>\n`;
    if (f.judge) md += `  - ${judgeNote(f.judge)}\n`;
    if (f.expired) md += `  - This lock expired on ${f.lock.expires}, so changing it only warns. Remove it, or extend it with \`fixlock review ${f.lock.id} --keep\`.\n`;
    if (f.status === 'blocked' && f.unapprovable) md += `  - ${f.unapprovable}\n`;
    else if (f.status === 'blocked') md += `  - **Approve this PR as ${f.approvers.map(team.handle).join(' or ')}** to accept the change, or restore the lines.\n`;
    if (f.tracker) md += `  - Tracker: ${f.tracker}\n`;
  }
  return md;
}

module.exports = { ruleApprovers, lockFindings, pathFindings, needingApproval, applyApprovals, applyTests, testNote, judgeNote, expired, approvedBy, toMarkdown };
