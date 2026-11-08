'use strict';
// Auto-lock: turn fix / feature commits into locks, for new commits (post-commit hook) and for history (backfill).
const fs = require('fs');
const path = require('path');
const g = require('./git');
const s = require('./store');
const team = require('./team');
const { norm, trivial } = require('./locks');

const DEFAULTS = {
  enabled: true,
  bugPattern: '^(fix|bugfix|hotfix)(\\(.+\\))?!?:|\\b(fix(e[sd])?|bug|hotfix|issue)\\b',
  featurePattern: '^feat(\\(.+\\))?!?:',
  lockFeatures: true,
  maxLines: 40, // groups bigger than this are skipped (lock them manually)
  ignore: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.fixlock/', 'CHANGELOG.md', '.md', '.json', '.lock', '.svg', '.png', '.jpg'],
};

function options(cfg) { return { ...DEFAULTS, ...(cfg.autoLock || {}) }; }

function kindOf(subject, o) {
  if (/^(chore|docs|style|test|tests|ci|build|release)(\(.+\))?!?:/i.test(subject)) return null;
  if (new RegExp(o.featurePattern, 'i').test(subject)) return o.lockFeatures ? 'feature' : null;
  if (new RegExp(o.bugPattern, 'i').test(subject)) return 'bug';
  return null;
}

function issueFrom(subject, cfg) {
  const type = cfg.tracker && cfg.tracker.type;
  const cu = subject.match(/\bCU-([a-z0-9]+)\b/i);
  if (cu) return `clickup:${cu[1]}`;
  const key = subject.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  if (key) return type === 'linear' || !type ? `linear:${key[1]}` : `${type}:${key[1]}`;
  return null;
}

function cleanTitle(subject) {
  return subject.replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(/\s*\[[A-Z][A-Z0-9]+-\d+\]\s*/, ' ').trim() || subject;
}

const ignored = (file, o) => o.ignore.some((p) => (p.startsWith('.') && !p.includes('/') ? file.endsWith(p) : file.includes(p)));

/** Candidate locks from commits. commits: [{ sha, subject, email }] */
function candidates(commits, cfg, reg) {
  const o = options(cfg);
  const out = []; const skipped = [];
  const blameCache = new Map();
  const shas = new Map(commits.map((c) => [c.sha, c]));
  const files = new Set();
  for (const c of commits) {
    const list = g.git(['show', '--name-only', '--pretty=format:', c.sha], { allowFail: true }) || '';
    list.split('\n').filter(Boolean).forEach((f) => files.add(f));
  }
  for (const file of files) {
    if (ignored(file, o) || !fs.existsSync(path.join(s.root(), file))) continue;
    if (!blameCache.has(file)) blameCache.set(file, g.blameFull('HEAD', file));
    const rows = blameCache.get(file);
    // group consecutive lines from the same fix/feature commit (blank/brace lines don't break a group)
    let group = null;
    const flush = () => {
      if (!group) return;
      const snippet = group.lines.filter((l) => !trivial(l));
      if (snippet.length) {
        const c = shas.get(group.sha);
        const dup = reg.locks.concat(out).some((l) => l.file === file && snippet.filter((x) => l.snippet.some((y) => norm(y) === norm(x))).length >= Math.ceil(snippet.length / 2));
        if (dup) { /* already locked */ } else if (snippet.length > o.maxLines) skipped.push(`${file}: ${snippet.length} lines from "${c.subject}" (over maxLines ${o.maxLines}) — lock the key lines with fixlock mark`);
        else out.push({ file, snippet, commit: c, start: group.start, end: group.end, type: kindOf(c.subject, o) });
      }
      group = null;
    };
    for (const r of rows) {
      const own = shas.has(r.sha);
      if (own && group && group.sha === r.sha) { group.lines.push(r.text); group.end = r.line; continue; }
      if (!own && group && trivial(r.text)) continue;
      flush();
      if (own) group = { sha: r.sha, lines: [r.text], start: r.line, end: r.line };
    }
    flush();
  }
  return { out, skipped };
}

/** commits to scan: { commit: sha } | { since: ref } | { all: true } */
function listCommits(sel, cfg) {
  const o = options(cfg);
  const args = ['log', '--no-merges', '--pretty=format:%H%x1f%s%x1f%ae%x1e'];
  if (sel.commit) args.push('-1', sel.commit);
  else if (sel.since) args.push(`${sel.since}..HEAD`);
  else args.push(`-${sel.max || 300}`);
  const out = g.git(args, { allowFail: true }) || '';
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, subject, email] = r.split('\x1f');
    return { sha, subject, email: (email || '').toLowerCase() };
  }).filter((c) => kindOf(c.subject, o));
}

function toLocks(cands, cfg, reg) {
  return cands.map((cd) => {
    const owner = team.find(cfg, cd.commit.email);
    const lock = {
      id: s.nextId(reg, cd.type), type: cd.type, title: cleanTitle(cd.commit.subject),
      reason: `Auto-locked from commit ${cd.commit.sha.slice(0, 7)}: ${cd.commit.subject}`,
      file: cd.file, snippet: cd.snippet, owner: owner ? owner.github || owner.name : cd.commit.email,
      issue: issueFrom(cd.commit.subject, cfg), test: null, date: new Date().toISOString().slice(0, 10),
      source: { commit: cd.commit.sha, auto: true },
    };
    reg.locks.push(lock);
    return lock;
  });
}

module.exports = { DEFAULTS, options, kindOf, issueFrom, candidates, listCommits, toLocks };
