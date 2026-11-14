'use strict';
// Structural matching: decides whether a lock's code is still there by comparing tokens instead of
// raw text. Formatting, comments, quote style, semicolons, trailing commas and line wrapping are
// ignored; a consistent rename of identifiers is reported as "renamed" rather than "changed".
// Zero dependencies: a small tokenizer per language family. Files in languages it doesn't know
// fall back to the original text matching (see locks.js).

const path = require('path');

const FAMILIES = {
  c: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.java', '.go', '.cs', '.kt', '.kts',
    '.rs', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.swift', '.scala', '.dart', '.groovy', '.vue', '.svelte'],
  hash: ['.py', '.rb', '.sh', '.bash', '.zsh', '.r', '.pl', '.ex', '.exs', '.yml', '.yaml', '.toml'],
  php: ['.php'],
};
const BY_EXT = new Map(Object.entries(FAMILIES).flatMap(([fam, exts]) => exts.map((e) => [e, fam])));

/** Language family for a file name, or null when structural matching isn't supported. */
function family(file) { return BY_EXT.get(path.extname(String(file || '')).toLowerCase()) || null; }

// Words that are never treated as renameable identifiers (union across supported languages).
const KEYWORDS = new Set(('abstract and as assert async await base break case catch class const continue def default defer ' +
  'del delete do elif else end enum except export extends false final finally fn for foreach from func function ' +
  'get go if impl implements import in instanceof interface is lambda let loop match mod module mut namespace ' +
  'new nil none not null of or override package pass private protected pub public raise readonly record ref ' +
  'require return select self set static struct super switch this throw throws trait true try type typeof ' +
  'undefined unless until use val var void when where while with yield True False None nullptr elsif begin ' +
  'rescue ensure then fun object companion sealed data inline internal lateinit unsafe crate dyn where').split(' '));

// Punctuation that a lock snippet may leave out (lines made only of these are not stored) or that a
// reformat may add/remove without changing behaviour.
const SKIPPABLE = new Set(['{', '}', '(', ')', '[', ']', ';', ',']);
// No ">>" / ">>>": closing generics (Promise<Array<T>>) may be split across lines by a formatter, so ">"
// is always its own token. A shift reads as "> >" on both sides, which compares the same.
const OPS = ['...', '===', '!==', '**=', '<<=', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=',
  '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '::', '->', ':='];

/**
 * Tokens of `src`: [{ k: kind, v: value, line }] with comments and whitespace dropped.
 * kind: "id" (renameable identifier), "prop" (member name / object key), "kw", "str", "num", "op".
 */
function tokenize(src, fam) {
  const out = [];
  const s = String(src).replace(/\r\n?/g, '\n');
  let i = 0; let line = 1;
  const n = s.length;
  const hashComments = fam === 'hash' || fam === 'php';
  const push = (k, v, at) => out.push({ k, v, line: at });
  while (i < n) {
    const ch = s[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') { i++; continue; }
    // comments
    if (fam !== 'hash' && ch === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (fam !== 'hash' && ch === '/' && s[i + 1] === '*') {
      i += 2; while (i < n && !(s[i] === '*' && s[i + 1] === '/')) { if (s[i] === '\n') line++; i++; }
      i += 2; continue;
    }
    if (hashComments && ch === '#' && !(fam === 'php' && s[i + 1] === '[')) { while (i < n && s[i] !== '\n') i++; continue; }
    // regex literals (JS/TS): /…/flags where an expression can start, so quotes inside aren't strings
    if (fam === 'c' && ch === '/' && regexCanStart(out[out.length - 1])) {
      let j = i + 1; let inClass = false; let ok = false;
      while (j < n && s[j] !== '\n') {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '[') inClass = true;
        else if (s[j] === ']') inClass = false;
        else if (s[j] === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        j++; while (j < n && /[a-z]/i.test(s[j])) j++;
        push('str', s.slice(i, j), line); i = j; continue;
      }
    }
    // strings (quote style is normalized: 'a' and "a" are the same token)
    if (ch === '"' || ch === "'" || ch === '`') {
      const at = line;
      const triple = fam === 'hash' && s.startsWith(ch.repeat(3), i);
      const q = triple ? ch.repeat(3) : ch;
      i += q.length;
      let v = ''; let closed = true;
      while (i < n && !s.startsWith(q, i)) {
        if (s[i] === '\\' && i + 1 < n) { v += s[i] + s[i + 1]; if (s[i + 1] === '\n') line++; i += 2; continue; }
        if (s[i] === '\n') { if (!triple && ch !== '`') { closed = false; break; } line++; }
        v += s[i]; i++;
      }
      // An unterminated quote (e.g. inside a regex literal) ends at the newline, which still counts as a line.
      if (closed) i += q.length;
      push('str', v.replace(/\\(["'`])/g, '$1'), at);
      continue;
    }
    // numbers (1_000 == 1000)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i; while (j < n && /[0-9a-zA-Z_.]/.test(s[j])) j++;
      push('num', s.slice(i, j).replace(/_/g, '').toLowerCase(), line); i = j; continue;
    }
    // identifiers / keywords
    if (/[A-Za-z_$À-￿]/.test(ch)) {
      let j = i + 1; while (j < n && /[A-Za-z0-9_$À-￿]/.test(s[j])) j++;
      const w = s.slice(i, j);
      push(KEYWORDS.has(w) ? 'kw' : 'id', w, line); i = j; continue;
    }
    // operators and punctuation
    const op = OPS.find((o) => s.startsWith(o, i)) || ch;
    push('op', op, line); i += op.length;
  }
  // Member names (obj.role, obj?.role, a::b, a->b) and object keys ({ role: x }) are fixed names:
  // renaming them reads or writes a different field, which changes behaviour.
  out.forEach((t, k) => {
    if (t.k !== 'id') return;
    const prev = out[k - 1]; const next = out[k + 1];
    if (prev && prev.k === 'op' && ['.', '?.', '::', '->', '#'].includes(prev.v)) t.k = 'prop'; // #name: JS private member
    else if (next && next.v === ':' && prev && (prev.v === '{' || prev.v === ',')) t.k = 'prop';
  });
  // A trailing comma before a closing bracket is formatting, not behaviour.
  return out.filter((t, k) => !(t.v === ',' && t.k === 'op' && out[k + 1] && [')', ']', '}'].includes(out[k + 1].v)));
}

const REGEX_AFTER_KW = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
/** Can a "/" here start a regex literal (rather than divide)? */
function regexCanStart(prev) {
  if (!prev) return true;
  if (prev.k === 'op') return ![')', ']', '}', '++', '--'].includes(prev.v);
  if (prev.k === 'kw') return REGEX_AFTER_KW.has(prev.v);
  return false;
}

function skippable(t) { return t.k === 'op' && SKIPPABLE.has(t.v); }

/**
 * Try to find `need` (snippet tokens) in `have` (file tokens) starting at file index `start`.
 * Tokens must appear in order; between them the file may only contain skippable punctuation.
 * Skippable snippet tokens that aren't in the file are tolerated too (a reformat may drop them).
 * With rename=true identifiers may differ, as long as the mapping is consistent both ways.
 * Returns { last (index of the last matched file token), map } or null.
 */
function matchAt(need, have, start, rename) {
  const fwd = new Map(); const back = new Map();
  let j = start; let last = start;
  for (let i = 0; i < need.length; i++) {
    const a = need[i];
    while (j < have.length && skippable(have[j]) && !(skippable(a) && have[j].v === a.v)) j++;
    if (j >= have.length) { if (skippable(a)) continue; return null; }
    const b = have[j];
    if (a.k === b.k && a.v === b.v && !(rename && a.k === 'id' && fwd.has(a.v) && fwd.get(a.v) !== b.v)) {
      if (a.k === 'id') { if (back.has(b.v) && back.get(b.v) !== a.v) return null; fwd.set(a.v, b.v); back.set(b.v, a.v); }
      last = j; j++; continue;
    }
    if (rename && a.k === 'id' && b.k === 'id') {
      if ((fwd.has(a.v) && fwd.get(a.v) !== b.v) || (back.has(b.v) && back.get(b.v) !== a.v)) return null;
      fwd.set(a.v, b.v); back.set(b.v, a.v); last = j; j++; continue;
    }
    if (skippable(a)) continue; // snippet punctuation the new code no longer has
    return null;
  }
  return { last, map: fwd };
}

/** All non-overlapping matches of `need` in `have` (accept(m) can reject a match). */
function findAll(need, have, rename, accept) {
  const first = need.findIndex((t) => !skippable(t));
  if (first === -1) return [];
  const rest = need.slice(first);
  const out = [];
  for (let j = 0; j < have.length; j++) {
    if (have[j].k !== need[first].k) continue;
    if (!rename && have[j].v !== need[first].v) continue;
    const m = matchAt(rest, have, j, rename);
    if (!m) continue;
    const hit = { start: j, ...m };
    if (accept && !accept(hit)) continue;
    out.push(hit);
    j = m.last;
  }
  return out;
}

/**
 * A rename is believable only when the snippet is long enough to be distinctive, and the old names are
 * gone from the code around it (a real rename renames every use). Otherwise a different piece of code
 * that merely has the same shape, or a swap like isAdmin → isGuest with isAdmin still in use, would pass.
 */
function plausibleRename(need, have) {
  const significant = need.filter((t) => !skippable(t)).length;
  return (m) => {
    const renamed = [...m.map].filter(([a, b]) => a !== b).map(([a]) => a);
    if (!renamed.length) return true;
    if (significant < 4) return false;
    // Short snippets match lots of code by shape alone, so their old names must be gone from the whole
    // file; longer ones only from the code around the match.
    const lo = significant < 8 ? -Infinity : have[m.start].line - 40;
    const hi = significant < 8 ? Infinity : have[m.last].line + 40;
    for (let k = 0; k < have.length; k++) {
      const t = have[k];
      if (t.line < lo) continue;
      if (t.line > hi) break;
      if (k >= m.start && k <= m.last) continue;
      if (t.k === 'id' && renamed.includes(t.v)) return false;
    }
    return true;
  };
}

/** How many copies of the snippet the content holds (same tokens). */
function count(snippet, content, file) {
  const fam = family(file);
  if (!fam || content === null || content === undefined) return 0;
  const need = tokenize(snippet.join('\n'), fam);
  if (!need.some((t) => !skippable(t))) return 0;
  return findAll(need, tokenize(content, fam), false).length;
}

/**
 * Is a lock's snippet still present in `content`?
 * Returns { engine, status, lines: [first, last] | null, renames: [[old, new]] }
 *   status: "intact"   — same tokens (formatting, comments, quotes may differ)
 *           "renamed"  — same structure, identifiers consistently renamed
 *           "changed"  — the code is gone or behaves differently (or, with opts.copies, fewer copies remain)
 *           "unsupported" — language not supported; caller should use text matching
 */
function verify(snippet, content, file, opts = {}) {
  const fam = family(file);
  if (!fam) return { engine: 'text', status: 'unsupported', lines: null, renames: [] };
  if (content === null || content === undefined) return { engine: 'structural', status: 'changed', lines: null, renames: [] };
  const need = tokenize(snippet.join('\n'), fam);
  if (!need.some((t) => !skippable(t))) return { engine: 'structural', status: 'unsupported', lines: null, renames: [] };
  const have = tokenize(content, fam);
  const span = (m) => [have[m.start].line, have[m.last].line];
  // With several matches, report the one that covers whole lines: "fn(null, null)" on its own line,
  // not the same tokens inside "if (!user) return fn(null, null)".
  const aligned = (m) => (m.start === 0 || have[m.start - 1].line !== have[m.start].line) && (m.last === have.length - 1 || have[m.last + 1].line !== have[m.last].line);
  const best = (list) => list.find(aligned) || list[0];
  const copies = Math.max(1, opts.copies || 1);
  const exact = findAll(need, have, false);
  if (exact.length >= copies) return { engine: 'structural', status: 'intact', lines: span(best(exact)), renames: [], found: exact.length };
  const all = findAll(need, have, true, plausibleRename(need, have));
  if (all.length >= copies) {
    const ren = all.find((m) => [...m.map].some(([a, b]) => a !== b)) || all[0];
    return { engine: 'structural', status: 'renamed', lines: span(ren), renames: [...ren.map].filter(([a, b]) => a !== b), found: all.length };
  }
  // Fewer copies than when the lock was made: one of them was changed or removed.
  return { engine: 'structural', status: 'changed', lines: all.length ? span(best(all)) : null, renames: [], found: all.length, copies };
}

module.exports = { family, tokenize, verify, count };
