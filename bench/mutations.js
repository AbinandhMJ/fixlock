'use strict';
// Edits applied to the code of a lock, for the accuracy benchmark.
//   benign  – change how the code looks, not what it does. A lock should stay intact.
//   rename  – a consistent rename of a local variable. Should be reported, not treated as a revert.
//   harmful – change what the code does. A lock must catch it.
// Each mutation gets the file's lines, the lock's [first, last] line range (0-based, inclusive) and
// the language family, and returns the new file text, or null when it doesn't apply to this lock.
const S = require('../src/structural');

// A line counts as code when a token starts on it; comment lines and the inside of block comments or
// doc strings don't, so edits never land there (they'd be meaningless as "harmful" edits).
const codeCache = new WeakMap();
let current = null; // [lines, fam] of the mutation being applied
function codeLines(lines, fam) {
  if (!codeCache.has(lines)) codeCache.set(lines, new Set(S.tokenize(lines.join('\n'), fam).filter((t) => t.k !== 'str').map((t) => t.line - 1)));
  return codeCache.get(lines);
}
const isCodeLine = (lines, i) => current && codeLines(current[0], current[1]).has(i);
// Lines where a token starts (blank lines can go before them without landing inside a string).
const startCache = new WeakMap();
function tokenStarts(lines, fam) {
  if (!startCache.has(lines)) startCache.set(lines, new Set(S.tokenize(lines.join('\n'), fam).map((t) => t.line - 1)));
  return startCache.get(lines);
}
// Lines holding a regex literal: quote and bracket edits there would change the regex itself.
const hasRegex = (lines, i) => current && current[1] === 'c' && S.tokenize(lines[i], 'c').some((t) => t.k === 'str' && t.v.startsWith('/'));
const isComment = (l, i, lines) => (lines && i !== undefined ? !isCodeLine(lines, i) : /^\s*(\/\/|\/?\*|#)/.test(l));
const indentOf = (l) => l.match(/^\s*/)[0];
const join = (lines) => lines.join('\n');
const commentFor = (fam) => (fam === 'hash' ? '#' : '//');

/** Replace the first match of `re` in a code (non-comment) line of the range, outside trailing comments. */
function inRange(lines, [a, b], re, fn, opts = {}) {
  for (let i = a; i <= b; i++) {
    const l = lines[i];
    if (isComment(l, i, lines)) continue;
    if (opts.noRegex && hasRegex(lines, i)) continue;
    const code = l.replace(/\s(\/\/|#)\s.*$/, '');
    const m = code.match(re);
    if (!m) continue;
    const out = lines.slice();
    out[i] = l.slice(0, m.index) + fn(m) + l.slice(m.index + m[0].length);
    return join(out);
  }
  return null;
}

/* ---------------- benign ---------------- */
const benign = {
  'add comments': (lines, [a, b], fam) => {
    const out = lines.slice();
    const c = commentFor(fam);
    out.splice(b + 1, 0, `${indentOf(lines[b])}${c} reviewed: keep this`);
    let first = a; while (first <= b && isComment(out[first], first, lines)) first++;
    if (first > b) return null;
    out[first] = `${out[first]}  ${c} important`;
    out.splice(a, 0, `${indentOf(lines[a])}${c} NOTE: see the linked issue`);
    return join(out);
  },
  'blank lines': (lines, [a, b], fam) => {
    if (b === a) return null;
    const out = lines.slice(); const starts = tokenStarts(lines, fam); let n = 0;
    for (let i = b; i > a; i--) if (starts.has(i) && isCodeLine(lines, i - 1)) { out.splice(i, 0, ''); n++; }
    if (!n) return null;
    return join(out);
  },
  'wrap long line': (lines, [a, b]) => {
    // Break a line after "(" or "," while a bracket is open: valid in JS/TS, Python, Go, Java, …
    let best = -1;
    for (let i = a; i <= b; i++) if (!isComment(lines[i], i, lines) && !hasRegex(lines, i) && (best === -1 || lines[i].length > lines[best].length)) best = i;
    if (best === -1) return null;
    const l = lines[best];
    let depth = 0; let q = null; let cut = -1;
    for (let k = 0; k < l.length; k++) {
      const ch = l[k];
      if (q) { if (ch === '\\') k++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if ((ch === '/' && l[k + 1] === '/') || ch === '#') break;
      if ('([{'.includes(ch)) { depth++; if (ch === '(' && /\S/.test(l.slice(k + 1)) && l[k + 1] !== ')') cut = k + 1; }
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ',' && depth > 0) cut = k + 1;
      if (cut !== -1 && depth > 0 && k > l.length / 3) break;
    }
    if (cut <= 0 || !/\S/.test(l.slice(cut))) return null;
    const out = lines.slice();
    out.splice(best, 1, l.slice(0, cut).replace(/\s+$/, ''), indentOf(l) + '    ' + l.slice(cut).trim());
    return join(out);
  },
  'swap quote style': (lines, range, fam, file) => {
    if (!/\.(m?[jt]sx?|cjs|cts|mts)$/.test(file || '')) return null; // ' and " mean the same only in JS/TS
    return inRange(lines, range, /'([^'"\\\n]*)'|"([^'"\\\n]*)"/, (m) => (m[1] !== undefined ? `"${m[1]}"` : `'${m[2]}'`), { noRegex: true });
  },
  'drop semicolons': (lines, [a, b]) => {
    const out = lines.slice(); let n = 0;
    for (let i = a; i <= b; i++) if (!isComment(out[i], i, lines) && /;\s*$/.test(out[i]) && !/\bfor\s*\(/.test(out[i])) { out[i] = out[i].replace(/;\s*$/, ''); n++; }
    return n ? join(out) : null;
  },
  'reindent': (lines, [a, b], fam) => {
    if (fam === 'hash') return null; // indentation is meaningful in Python
    const out = lines.slice();
    for (let i = a; i <= b; i++) out[i] = out[i].replace(/^(\s*)/, (s) => s.replace(/\t/g, '    ') + '  ');
    return join(out);
  },
};

/* ---------------- rename ---------------- */
/** Rename one local identifier used in the lock, everywhere in the file (whole words, outside strings). */
function rename(lines, [a, b], fam) {
  const region = lines.slice(a, b + 1).join('\n');
  const toks = S.tokenize(region, fam);
  const counts = new Map();
  toks.forEach((t) => { if (t.k === 'id' && t.v.length >= 3 && !/^[A-Z]/.test(t.v)) counts.set(t.v, (counts.get(t.v) || 0) + 1); });
  const all = join(lines);
  // A name that is also used as a member (obj.name), an object key ({ name: … }) or a keyword argument
  // (f(name=…)) somewhere in the file isn't a pure local: renaming it would change behaviour.
  const esc = (n) => n.replace(/\$/g, '\\$');
  const notLocal = (n) => new RegExp(`(\\.|\\?\\.|->|::)\\s*${esc(n)}\\b|[{,]\\s*${esc(n)}\\s*:|[(,]\\s*${esc(n)}\\s*=(?!=)`).test(all);
  const pick = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n).find((n) => !notLocal(n));
  if (!pick) return null;
  const re = new RegExp(`\\b${esc(pick)}\\b`, 'g');
  // replace outside string literals only
  const out = all.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1|[^"'`]+|["'`]/g, (chunk) => (/^["'`]/.test(chunk) && chunk.length > 1 ? chunk : chunk.replace(re, `${pick}Renamed`)));
  return out === all ? null : out;
}

/* ---------------- harmful ---------------- */
const FLIPS = [['!==', '==='], ['===', '!=='], ['!=', '=='], ['==', '!='], ['<=', '<'], ['>=', '>'], [' < ', ' <= '], [' > ', ' >= ']];
const harmful = {
  'flip comparison': (lines, range) => {
    for (const [from, to] of FLIPS) {
      const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const r = inRange(lines, range, new RegExp(from.startsWith(' ') ? esc : `(?<![=!<>])${esc}(?![=>])`), () => to);
      if (r) return r;
    }
    return null;
  },
  'swap and/or': (lines, range, fam) => inRange(lines, range, fam === 'hash' ? /\b(and|or)\b/ : /&&|\|\|/, (m) => ({ '&&': '||', '||': '&&', and: 'or', or: 'and' })[m[0]]),
  'drop negation': (lines, range, fam) => inRange(lines, range, fam === 'hash' ? /\bnot\s+/ : /!(?![=])/, () => ''),
  'change number': (lines, range) => inRange(lines, range, /(?<![\w.$])\d+(?![\w.])/, (m) => String(+m[0] + 1)),
  'change string': (lines, range) => inRange(lines, range, /(["'])([^"'\\\n]+)\1/, (m) => `${m[1]}${m[2]}_x${m[1]}`),
  'change field': (lines, range) => inRange(lines, range, /(?<!\.)\.([a-zA-Z_]\w{2,})\b(?!\s*\()/, (m) => `.${m[1]}Other`),
  'delete a line': (lines, [a, b]) => {
    // remove the code line with the most tokens (the heart of the fix)
    let best = -1; let n = 0;
    for (let i = a; i <= b; i++) {
      if (isComment(lines[i], i, lines)) continue;
      const k = (lines[i].match(/[\w$]+|[^\s\w]/g) || []).length;
      if (k > n && !/^\s*[})\]]*[;,]?\s*$/.test(lines[i]) && !/[{([]\s*$/.test(lines[i])) { n = k; best = i; }
    }
    if (best === -1 || n < 3) return null;
    const out = lines.slice(); out.splice(best, 1); return join(out);
  },
};

/** Run a mutation (sets the context used to tell code lines from comments). */
function apply(fn, lines, range, fam, file) {
  current = [lines, fam];
  try { return fn(lines, range, fam, file); } finally { current = null; }
}

module.exports = { benign, rename, harmful, apply };
