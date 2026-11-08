'use strict';
const { execFileSync } = require('child_process');

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch (e) {
    if (opts.allowFail) return null;
    const msg = (e.stderr || e.message || '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel']).trim();
}

function userEmail() {
  return (git(['config', 'user.email'], { allowFail: true }) || '').trim();
}

function fileAtRef(ref, file) {
  return git(['show', `${ref}:${file}`], { allowFail: true });
}

/** Files changed between base and HEAD (merge-base diff), with status. */
function changedFiles(base) {
  const out = git(['diff', '--name-status', '-M', `${base}...HEAD`]);
  return out.split('\n').filter(Boolean).map((l) => {
    const parts = l.split('\t');
    const status = parts[0][0];
    return status === 'R'
      ? { status, from: parts[1], file: parts[2] }
      : { status, file: parts[1], from: parts[1] };
  });
}

/**
 * Lines removed by the PR, per file, with their line numbers in the merge-base version.
 * Returns { [file]: [{ line, text }] }
 */
function removedLines(base) {
  const mb = git(['merge-base', base, 'HEAD']).trim();
  const out = git(['diff', '-U0', '-M', mb, 'HEAD']);
  const result = {};
  let current = null;
  let oldLine = 0;
  for (const raw of out.split('\n')) {
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4);
      current = p === '/dev/null' ? null : p.replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('+++ ')) continue;
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (hunk) { oldLine = parseInt(hunk[1], 10); continue; }
    if (current && raw.startsWith('-')) {
      (result[current] = result[current] || []).push({ line: oldLine, text: raw.slice(1) });
      oldLine++;
    }
  }
  return { mergeBase: mb, removed: result };
}

/** Author email for each line of a file at a ref. Returns Map(lineNo -> email). */
function blame(ref, file) {
  const out = git(['blame', '--line-porcelain', ref, '--', file], { allowFail: true });
  const map = new Map();
  if (!out) return map;
  let lineNo = null;
  for (const l of out.split('\n')) {
    const h = l.match(/^[0-9a-f]{40} \d+ (\d+)/);
    if (h) { lineNo = parseInt(h[1], 10); continue; }
    if (l.startsWith('author-mail ') && lineNo !== null) {
      map.set(lineNo, l.slice(12).replace(/[<>]/g, '').trim().toLowerCase());
    }
  }
  return map;
}

module.exports = { git, repoRoot, userEmail, fileAtRef, changedFiles, removedLines, blame };

/**
 * Full blame with per-line details. ref = null blames the working tree.
 * Returns [{ line, sha, email, time (unix s), summary, text }]
 */
function blameFull(ref, file) {
  const args = ['blame', '--line-porcelain'];
  if (ref) args.push(ref);
  args.push('--', file);
  const out = git(args, { allowFail: true });
  if (!out) return [];
  const rows = [];
  let cur = null;
  for (const l of out.split('\n')) {
    const h = l.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (h) { cur = { sha: h[1], line: parseInt(h[2], 10) }; continue; }
    if (!cur) continue;
    if (l.startsWith('author-mail ')) cur.email = l.slice(12).replace(/[<>]/g, '').trim().toLowerCase();
    else if (l.startsWith('author-time ')) cur.time = parseInt(l.slice(12), 10);
    else if (l.startsWith('summary ')) cur.summary = l.slice(8);
    else if (l.startsWith('\t')) { cur.text = l.slice(1); rows.push(cur); cur = null; }
  }
  return rows;
}

const UNCOMMITTED = '0000000000000000000000000000000000000000';

module.exports.blameFull = blameFull;
module.exports.UNCOMMITTED = UNCOMMITTED;
