'use strict';
const fs = require('fs');
const path = require('path');
const repoRoot = () => require('./git').repoRoot(); // loaded on use (the GitHub App has no git)

const DIR = '.fixlock';

const { DEFAULT_CONFIG, mergeConfig, normalizeRegistry } = require('./config');

function root() { return repoRoot(); }
function p(...parts) { return path.join(root(), DIR, ...parts); }
function ensureDir() { fs.mkdirSync(p(), { recursive: true }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }

function loadConfig() { return mergeConfig(readJson(p('config.json'), {})); }
function saveConfig(cfg) { ensureDir(); fs.writeFileSync(p('config.json'), JSON.stringify(cfg, null, 2) + '\n'); }
function configExists() { return fs.existsSync(p('config.json')); }

function loadRegistry() {
  return normalizeRegistry(readJson(p('registry.json'), { version: 2, locks: [] }));
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
