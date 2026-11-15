'use strict';
const path = require('path');
const structural = require('./structural');

const norm = (l) => l.replace(/\s+/g, ' ').trim();
const trivial = (l) => /^[\s{}()[\];,]*$/.test(l);
const toPosix = (f) => f.split(path.sep).join('/');

/** Real path, following symlinks and Windows 8.3 short names; works for files that don't exist yet. */
function realish(p) {
  const abs = path.resolve(p);
  try { return require('fs').realpathSync.native(abs); } catch { /* not there yet */ }
  const parent = path.dirname(abs);
  return parent === abs ? abs : path.join(realish(parent), path.basename(abs));
}

/** Repo-relative POSIX path for a file given absolute or relative to the cwd. "../x" means outside the repo. */
function repoRel(root, file) {
  return toPosix(path.relative(realish(root), realish(file)));
}

/**
 * Record how many identical copies of the snippet the file holds when the lock is made, so removing
 * the locked copy isn't hidden by another copy elsewhere in the file.
 */
function withCopies(lock, content) {
  const { copies, siblings } = structural.shape(lock.snippet, content, lock.file);
  if (copies > 1) lock.copies = copies; else delete lock.copies;
  if (siblings > 0) lock.siblings = siblings; else delete lock.siblings;
  return lock;
}

/** Locks made before `siblings` was recorded: count look-alikes in a known-good version of the file. */
function siblingsFrom(lock, goodContent) {
  if (lock.siblings !== undefined || goodContent === null || goodContent === undefined) return lock.siblings || 0;
  return structural.shape(lock.snippet, goodContent, lock.file).siblings;
}

/** Line numbers (1-based) where a lock's snippet lines currently sit in `lines`. */
function locate(lock, lines) {
  // Structural first: it finds the lock as one contiguous block, even when reformatted or renamed.
  // Matching lines one by one as text can pick up a common line ("try:", "return true") far away.
  const r = structural.verify(lock.snippet, lines.join('\n'), lock.file);
  if (r.lines) return Array.from({ length: r.lines[1] - r.lines[0] + 1 }, (_, k) => r.lines[0] + k);
  return locateText(lock, lines);
}

/** Text-only locate: each snippet line, in order, preferring the nearest match after the previous one. */
function locateText(lock, lines) {
  const n = lines.map(norm);
  const snip = lock.snippet.map(norm);
  // Try every place the first line occurs and keep the tightest run of matches.
  let best = [];
  const starts = [];
  n.forEach((l, i) => { if (l === snip[0]) starts.push(i); });
  if (!starts.length) starts.push(0);
  for (const s0 of starts) {
    const found = [];
    let from = s0;
    for (const s of snip) {
      const i = n.indexOf(s, from);
      if (i !== -1) { found.push(i + 1); from = i + 1; }
    }
    const span = found.length ? found[found.length - 1] - found[0] : Infinity;
    const bestSpan = best.length ? best[best.length - 1] - best[0] : Infinity;
    if (found.length > best.length || (found.length === best.length && span < bestSpan)) best = found;
  }
  return best;
}

function missingLines(lock, content) {
  const set = new Set(content.split('\n').map(norm));
  return lock.snippet.filter((l) => !set.has(norm(l)));
}

/**
 * Is a lock still intact in `content`? (null content = file deleted)
 * opts.mode: "structural" (default; falls back to text for unsupported languages) | "text"
 * opts.file: path to judge the language by (defaults to lock.file; differs after a file rename)
 * Returns { status: "intact"|"renamed"|"changed", engine: "structural"|"text",
 *           missing: [snippet lines no longer found as text], renames: [[old, new]], reformatted: bool }
 */
function verifyLock(lock, content, opts = {}) {
  if (content === null || content === undefined) return { status: 'changed', engine: 'text', missing: lock.snippet, renames: [], reformatted: false };
  const missing = missingLines(lock, content);
  if (opts.mode !== 'text') {
    const siblings = opts.siblings !== undefined ? opts.siblings : siblingsFrom(lock, opts.before);
    const r = structural.verify(lock.snippet, content, opts.file || lock.file, { copies: lock.copies, siblings });
    if (r.status === 'changed' && lock.copies > 1 && r.found > 0) {
      return { status: 'changed', engine: r.engine, missing: lock.snippet, renames: [], reformatted: false, copies: { expected: lock.copies, found: r.found } };
    }
    if (r.status === 'intact') return { status: 'intact', engine: r.engine, missing: [], renames: [], reformatted: missing.length > 0 };
    if (r.status === 'renamed') return { status: 'renamed', engine: r.engine, missing, renames: r.renames, reformatted: false };
    if (r.status === 'changed') return { status: 'changed', engine: r.engine, missing: missing.length ? missing : lock.snippet, renames: [], reformatted: false };
  }
  return { status: missing.length ? 'changed' : 'intact', engine: 'text', missing, renames: [], reformatted: false };
}

function locksForFile(reg, root, file) {
  const rel = path.isAbsolute(file) ? repoRel(root, file) : toPosix(file);
  return { rel, locks: reg.locks.filter((l) => l.file === rel) };
}

/**
 * Which locks does a proposed change touch?
 * change: { file, before (full old content), after (full new content) } OR { file, startLine, endLine }
 * Returns [{ lock, lines: [n], removed: [snippet lines that would disappear], renames: [[old, new]] }]
 */
function affected(reg, root, change, opts = {}) {
  const { rel, locks } = locksForFile(reg, root, change.file);
  if (!locks.length) return [];
  const abs = path.join(root, rel);
  const fs = require('fs');
  const before = change.before ?? (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '');
  const lines = before.split('\n');
  const out = [];
  for (const lock of locks) {
    const at = locate(lock, lines);
    if (change.after !== undefined) {
      const v = verifyLock(lock, change.after, { mode: opts.mode, file: rel, before }); // before = the file as it is now
      const removed = v.status === 'changed' ? v.missing : [];
      const renames = v.status === 'renamed' ? v.renames : [];
      const touched = change.touched ? at.filter((n) => n >= change.touched[0] && n <= change.touched[1]) : [];
      if (removed.length || renames.length || touched.length) out.push({ lock, lines: at, removed, renames });
    } else {
      const hit = at.filter((n) => n >= change.startLine && n <= change.endLine);
      if (hit.length) out.push({ lock, lines: at, removed: [], renames: [] });
    }
  }
  return out;
}

/** 1-based [first, last] line numbers that `needle` (found at index i of content) really covers, ignoring leading/trailing line breaks. */
function spanLines(content, i, needle) {
  let a = i; let b = i + needle.length;
  while (a < b && content[a] === '\n') a++;
  while (b > a && content[b - 1] === '\n') b--;
  if (a >= b) return null;
  const start = content.slice(0, a).split('\n').length;
  return [start, start + content.slice(a, b).split('\n').length - 1];
}

module.exports = { repoRel, realish, spanLines, norm, trivial, locate, missingLines, verifyLock, withCopies, siblingsFrom, affected, toPosix };
