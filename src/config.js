'use strict';
// Default config and how a repo's .fixlock/config.json is merged over it. No disk access, so the
// GitHub App (a Cloudflare Worker) can use it too.

const DEFAULT_CONFIG = {
  project: '',
  // Team: who is who. github = GitHub username (used for PR approvals), emails = git commit emails.
  team: [], // { name, github, emails: [], role: "lead" | "developer" | "reviewer" }
  // What happens when someone (or their AI) changes locked lines, per lock type.
  //   onEdit:   "warn"  – show the warning, allow the edit
  //             "ask"   – AI must ask the human before editing (Claude Code hook)
  //             "block" – AI may not edit these lines; humans need approval in the PR
  //   approval: who must approve the PR in CI: "owner" | "lead" | "owner-or-lead" | "none"
  policies: {
    bug: { onEdit: 'ask', approval: 'owner' },
    feature: { onEdit: 'warn', approval: 'owner-or-lead' },
  },
  // Paths where every change is reported (warning only).
  protectedPaths: [],
  // AI coding tools the team uses; fixlock writes each one's native rules file. See `fixlock tools`.
  aiTools: undefined,
  changelog: true,
  // Working-code guard: AI edits that delete/rewrite committed, working lines must be confirmed.
  //   counts lines committed by someone else, or by you more than olderThanDays ago.
  stableCode: { enabled: true, onEdit: 'ask', olderThanDays: 7, minLines: 3 },
  // Auto-lock lines from fix:/feat: commits (post-commit hook) — see src/autolock.js for all options.
  autoLock: { enabled: true, lockFeatures: true, maxLines: 40 },
  // Optional tracker sync. Tokens come from env vars, never from this file.
  tracker: null, // { type: "linear"|"clickup"|"notion"|"webhook", onFix: "Done", onRegression: "Reopened", ... }
  ignoreTrivialLines: true,
  // How locks are compared with the current code.
  //   mode:    "structural" – compare tokens: formatting, comments, quote style and line wrapping don't count
  //                           as changes (JS/TS, Python, Java, Go, C#, Kotlin, Rust, … – other files use text)
  //            "text"       – compare lines of text (whitespace-insensitive), as before v0.6
  //   renames: what a consistent rename of variables inside a lock means: "allow" | "warn" | "ask" | "block"
  matching: { mode: 'structural', renames: 'warn' },
};

function mergeConfig(raw = {}) {
  return { ...DEFAULT_CONFIG, ...raw, policies: { ...DEFAULT_CONFIG.policies, ...(raw.policies || {}) },
    stableCode: { ...DEFAULT_CONFIG.stableCode, ...(raw.stableCode || {}) }, autoLock: { ...DEFAULT_CONFIG.autoLock, ...(raw.autoLock || {}) },
    matching: { ...DEFAULT_CONFIG.matching, ...(raw.matching || {}) } };
}

/** registry.json contents → { version: 2, locks } (handles the v0.1 "fixes" format). */
function normalizeRegistry(reg) {
  reg = reg || { version: 2, locks: [] };
  if (reg.fixes && !reg.locks) { reg.locks = reg.fixes.map((f) => ({ type: 'bug', ...f })); delete reg.fixes; } // v0.1 migration
  if (!reg.locks) reg.locks = [];
  reg.version = 2;
  return reg;
}

module.exports = { DEFAULT_CONFIG, mergeConfig, normalizeRegistry };
