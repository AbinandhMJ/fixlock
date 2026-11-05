'use strict';
const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./git');

const DIR = '.fixlock';
const REGISTRY = 'registry.json';
const CONFIG = 'config.json';

const DEFAULT_CONFIG = {
  // Lines last written by these authors may not be deleted/rewritten without approval.
  protectedAuthors: [],
  // Glob-ish path prefixes; changes here are always reported.
  protectedPaths: ['src/app/core/', 'src/app/shared/'],
  // Agent instruction files kept in sync with the registry.
  agentFiles: ['CLAUDE.md', 'AGENTS.md'],
  // What fails the check: "fix" = registered fix reverted, "author" = protected author's lines removed,
  // "path" = protected path changed.
  failOn: ['fix', 'author'],
  // Ignore removed lines that are blank or only braces/brackets.
  ignoreTrivialLines: true,
};

function root() { return repoRoot(); }
function p(...parts) { return path.join(root(), DIR, ...parts); }

function ensureDir() { fs.mkdirSync(p(), { recursive: true }); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadConfig() { return { ...DEFAULT_CONFIG, ...readJson(p(CONFIG), {}) }; }
function saveConfig(cfg) { ensureDir(); fs.writeFileSync(p(CONFIG), JSON.stringify(cfg, null, 2) + '\n'); }

function loadRegistry() { return readJson(p(REGISTRY), { version: 1, fixes: [] }); }
function saveRegistry(reg) {
  ensureDir();
  reg.fixes.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(p(REGISTRY), JSON.stringify(reg, null, 2) + '\n');
}

function nextId(reg) {
  const n = reg.fixes.reduce((m, f) => Math.max(m, parseInt(f.id.replace(/\D/g, ''), 10) || 0), 0);
  return `FIX-${String(n + 1).padStart(3, '0')}`;
}

module.exports = { DEFAULT_CONFIG, root, loadConfig, saveConfig, loadRegistry, saveRegistry, nextId, DIR };
