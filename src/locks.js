'use strict';
const fs = require('fs');
const path = require('path');

const norm = (l) => l.replace(/\s+/g, ' ').trim();
const trivial = (l) => /^[\s{}()[\];,]*$/.test(l);
const toPosix = (f) => f.split(path.sep).join('/');

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
  return found;
}

function missingLines(lock, content) {
  const set = new Set(content.split('\n').map(norm));
  return lock.snippet.filter((l) => !set.has(norm(l)));
}

function locksForFile(reg, root, file) {
  const rel = toPosix(path.isAbsolute(file) ? path.relative(root, file) : file);
  return { rel, locks: reg.locks.filter((l) => l.file === rel) };
}

/**
 * Which locks does a proposed change touch?
 * change: { file, before (full old content), after (full new content) } OR { file, startLine, endLine }
 * Returns [{ lock, lines: [n], removed: [snippet lines that would disappear] }]
 */
function affected(reg, root, change) {
  const { rel, locks } = locksForFile(reg, root, change.file);
  if (!locks.length) return [];
  const abs = path.join(root, rel);
  const before = change.before ?? (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '');
  const lines = before.split('\n');
  const out = [];
  for (const lock of locks) {
    const at = locate(lock, lines);
    if (change.after !== undefined) {
      const removed = missingLines(lock, change.after);
      const touched = change.touched ? at.filter((n) => n >= change.touched[0] && n <= change.touched[1]) : [];
      if (removed.length || touched.length) out.push({ lock, lines: at, removed });
    } else {
      const hit = at.filter((n) => n >= change.startLine && n <= change.endLine);
      if (hit.length) out.push({ lock, lines: at, removed: [] });
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

module.exports = { spanLines, norm, trivial, locate, missingLines, affected, toPosix };
