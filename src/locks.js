'use strict';
const fs = require('fs');
const path = require('path');
const structural = require('./structural');

const norm = (l) => l.replace(/\s+/g, ' ').trim();
const trivial = (l) => /^[\s{}()[\];,]*$/.test(l);
const toPosix = (f) => f.split(path.sep).join('/');

/** Real path, following symlinks and Windows 8.3 short names; works for files that don't exist yet. */
function realish(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs); } catch { /* not there yet */ }
  const parent = path.dirname(abs);
  return parent === abs ? abs : path.join(realish(parent), path.basename(abs));
}

/** Repo-relative POSIX path for a file given absolute or relative to the cwd. "../x" means outside the repo. */
function repoRel(root, file) {
  return toPosix(path.relative(realish(root), realish(file)));
}

/** Line numbers (1-based) where a lock's snippet lines currently sit in `lines`. */
function locate(lock, lines) {
  const n = lines.map(norm);
  const found = [];
  let from = 0;
  for (const s of lock.snippet.map(norm)) {
    let i = n.indexOf(s, from);
    if (i === -1) i = n.indexOf(s);
    if (i !== -1) { found.push(i + 1); from = i + 1; }
  }
  if (found.length < lock.snippet.length) {
    // Reformatted or renamed code: the text no longer lines up, but the structure may.
    const r = structural.verify(lock.snippet, lines.join('\n'), lock.file);
    if (r.lines) return Array.from({ length: r.lines[1] - r.lines[0] + 1 }, (_, k) => r.lines[0] + k);
  }
  return found;
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
    const r = structural.verify(lock.snippet, content, opts.file || lock.file);
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
  const before = change.before ?? (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '');
  const lines = before.split('\n');
  const out = [];
  for (const lock of locks) {
    const at = locate(lock, lines);
    if (change.after !== undefined) {
      const v = verifyLock(lock, change.after, { mode: opts.mode, file: rel });
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

module.exports = { repoRel, realish, spanLines, norm, trivial, locate, missingLines, verifyLock, affected, toPosix };
