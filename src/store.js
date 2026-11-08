'use strict';
const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./git');

const DIR = '.fixlock';

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
};

function root() { return repoRoot(); }
function p(...parts) { return path.join(root(), DIR, ...parts); }
function ensureDir() { fs.mkdirSync(p(), { recursive: true }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }

function loadConfig() {
  const raw = readJson(p('config.json'), {});
  return { ...DEFAULT_CONFIG, ...raw, policies: { ...DEFAULT_CONFIG.policies, ...(raw.policies || {}) },
    stableCode: { ...DEFAULT_CONFIG.stableCode, ...(raw.stableCode || {}) }, autoLock: { ...DEFAULT_CONFIG.autoLock, ...(raw.autoLock || {}) } };
}
function saveConfig(cfg) { ensureDir(); fs.writeFileSync(p('config.json'), JSON.stringify(cfg, null, 2) + '\n'); }
function configExists() { return fs.existsSync(p('config.json')); }

function loadRegistry() {
  const reg = readJson(p('registry.json'), { version: 2, locks: [] });
  if (reg.fixes && !reg.locks) { reg.locks = reg.fixes.map((f) => ({ type: 'bug', ...f })); delete reg.fixes; } // v0.1 migration
  reg.version = 2;
  return reg;
}
function saveRegistry(reg) {
  ensureDir();
  reg.locks.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(p('registry.json'), JSON.stringify(reg, null, 2) + '\n');
}
function nextId(reg, type) {
  const prefix = type === 'feature' ? 'FEAT' : 'FIX';
  const n = reg.locks.filter((l) => l.id.startsWith(prefix))
    .reduce((m, l) => Math.max(m, parseInt(l.id.replace(/\D/g, ''), 10) || 0), 0);
  return `${prefix}-${String(n + 1).padStart(3, '0')}`;
}

module.exports = { DIR, DEFAULT_CONFIG, root, loadConfig, saveConfig, configExists, loadRegistry, saveRegistry, nextId };
