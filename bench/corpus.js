'use strict';
// The pinned benchmark corpus: fetch a repo at its commit and find its past fixes. Shared by the accuracy
// benchmark (run.js) and the Regression Bench (regression/).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const CLI = path.join(ROOT, 'bin', 'fixlock.js');
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' };
const corpus = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));

function checkout(r) {
  const dir = path.join(CACHE, r.name);
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    git('init', '-q'); git('remote', 'add', 'origin', r.url);
  }
  let head = '';
  try { head = git('rev-parse', 'HEAD'); } catch { /* fresh */ }
  if (head !== r.sha) {
    process.stderr.write(`  fetching ${r.name} @ ${r.sha.slice(0, 7)} (depth ${r.depth})…\n`);
    git('fetch', '-q', '--depth', String(r.depth), 'origin', r.sha);
    git('checkout', '-q', '-f', r.sha);
  }
  git('clean', '-qfdx', '-e', '.fixlock');
  git('checkout', '-q', '-f', '.');
  if (!fs.existsSync(path.join(dir, '.fixlock', 'config.json'))) {
    execFileSync(process.execPath, [CLI, 'init', '--yes'], { cwd: dir, env, stdio: 'ignore' });
    git('checkout', '-q', '-f', '.'); git('clean', '-qfd', '-e', '.fixlock');
  }
  return dir;
}

function discoverLocks(dir, r) {
  const out = execFileSync(process.execPath, [CLI, 'discover', '--json', '--max', String(r.depth - 1)], { cwd: dir, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  return JSON.parse(out.slice(out.indexOf('{'))).found;
}


module.exports = { ROOT, CACHE, CLI, env, corpus, checkout, discoverLocks };
