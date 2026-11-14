'use strict';
// Structural matching: decides whether a lock's code is still there by comparing tokens instead of
// raw text. Formatting, comments, quote style, semicolons, trailing commas and line wrapping are
// ignored; a consistent rename of identifiers is reported as "renamed" rather than "changed".
// Zero dependencies: a small tokenizer per language family. Files in languages it doesn't know
// fall back to the original text matching (see locks.js).

const LANG = require('./languages');

/** Language id for a file name (see languages.js), or null when structural matching isn't supported. */
function family(file) { return LANG.detect(file); }

// Punctuation that a lock snippet may leave out (lines made only of these are not stored) or that a
// reformat may add/remove without changing behaviour.
const SKIPPABLE = new Set(['{', '}', '(', ')', '[', ']', ';', ',']);
// No ">>" / ">>>": closing generics (Promise<Array<T>>) may be split across lines by a formatter, so ">"
// is always its own token. A shift reads as "> >" on both sides, which compares the same.
const OPS = ['...', '===', '!==', '**=', '<<=', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=',
  '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '::', '->', ':='];
// Indentation tokens for languages where indentation is logic (Python, YAML, Nim, Sass…). Several dedents
// in a row become one token: a snippet can't know how deep the code around it goes.
const INDENT = '⇥'; const DEDENT = '⇤';
// Languages where f(name=value) passes a named argument: "name" is fixed, not a renameable variable.
const NAMED_ARGS = new Set(['python', 'r', 'julia', 'kotlin', 'scala', 'fsharp', 'nim']);
const ID_START = /[A-Za-z_$À-￿]/;
const ID_CHAR = /[A-Za-z0-9_$À-￿]/;
// Markup text: words and punctuation, no strings or comments (an apostrophe in "Don't" isn't a quote).
const TEXT = { id: 'text', line: [], block: [], quotes: [], multiline: [], kw: new Set() };

/**
 * Tokens of `src` in language `fam`: [{ k: kind, v: value, line }] with comments and whitespace dropped.
 * kind: "id" (renameable identifier), "prop" (member name / object key / attribute), "kw", "str", "num", "op".
 */
function tokenize(src, fam) {
  const spec = typeof fam === 'object' && fam ? fam : LANG.spec(fam);
  if (!spec) throw new Error(`fixlock: unknown language "${fam}"`);
  const s = String(src).replace(/\r\n?/g, '\n');
  return finish(spec.markup ? markup(s, spec) : code(s, spec), spec);
}

function finish(out, spec) {
  // Member names (obj.role, obj?.role, a::b, a->b, #private) and object keys ({ role: x }) are fixed
  // names: renaming them reads or writes a different field, which changes behaviour.
  out.forEach((t, k) => {
    if (t.k !== 'id') return;
    const prev = out[k - 1]; const next = out[k + 1];
    // CONSTANT_CASE names are constants or enum values: swapping one (ADMIN → USER) changes behaviour.
    if (/^[A-Z][A-Z0-9_]+$/.test(t.v)) t.k = 'prop';
    else if (prev && prev.k === 'op' && ['.', '?.', '::', '->', '#'].includes(prev.v)) t.k = 'prop';
    else if (next && next.v === ':' && prev && (prev.v === '{' || prev.v === ',')) t.k = 'prop';
    else if (NAMED_ARGS.has(spec.id) && next && next.v === '=' && prev && (prev.v === '(' || prev.v === ',')) t.k = 'prop';
  });
  // A trailing comma before a closing bracket is formatting, not behaviour. So is the leading | or & that
  // formatters put before the first member of a wrapped TypeScript union / intersection type.
  return out.filter((t, k) => !(t.v === ',' && t.k === 'op' && out[k + 1] && [')', ']', '}'].includes(out[k + 1].v))
    && !(spec.id === 'ts' && (t.v === '|' || t.v === '&') && t.k === 'op' && out[k - 1] && out[k - 1].k === 'op' && [':', '=', '(', '<', ',', '|', '&', '=>'].includes(out[k - 1].v)));
}

/** Code tokenizer driven by a language spec. opts.text: markup text (words are content, not names). */
function code(s, spec, opts = {}) {
  const out = [];
  const n = s.length;
  const text = !!opts.text;
  let i = 0; let line = 1; let lineBegin = 0; let lineStart = true; let depth = 0;
  const stack = [];
  const push = (k, v, at = line) => { out.push({ k, v, line: at }); };
  const indentHere = () => {
    let col = 0;
    for (let k = lineBegin; k < n && (s[k] === ' ' || s[k] === '\t'); k++) col += s[k] === '\t' ? 4 : 1;
    if (!stack.length) { stack.push(col); return; }
    const top = stack[stack.length - 1];
    if (col > top) { stack.push(col); push('op', INDENT); }
    else if (col < top) {
      while (stack.length && stack[stack.length - 1] > col) stack.pop();
      if (!stack.length || stack[stack.length - 1] < col) stack.push(col);
      if (!out.length || out[out.length - 1].v !== DEDENT) push('op', DEDENT);
    }
  };
  const newline = () => { line++; lineBegin = i + 1; lineStart = true; };
  const lineCommentOk = (p) => {
    if (p === '#' && spec.id === 'php' && s[i + 1] === '[') return false;            // PHP 8 attribute
    if (p === '#' && spec.hashSpace) return i === lineBegin || /\s/.test(s[i - 1]) || s[i - 1] === ';';
    if (p === ';' && spec.id === 'ini') return i === lineBegin || /\s/.test(s[i - 1]);
    if (p === '//' && spec.css && s[i - 1] === ':') return false;                       // url(http://…)
    return true;
  };
  const readString = (q, prefix, multi) => {
    const at = line;
    i += q.length;
    let v = ''; let closed = true;
    while (i < n && !s.startsWith(q, i)) {
      if (s[i] === '\\' && i + 1 < n && !prefix.raw) { v += s[i] + s[i + 1]; if (s[i + 1] === '\n') { line++; lineBegin = i + 2; } i += 2; continue; }
      if (s[i] === '\n') { if (!multi) { closed = false; break; } line++; lineBegin = i + 1; }
      v += s[i]; i++;
    }
    if (closed) i += q.length;
    // Rust: a backslash at the end of a line skips the newline and the next line's indentation
    if (spec.id === 'rust') v = v.replace(/\\\n[ \t]*/g, '');
    push('str', (prefix.tag || '') + v.replace(/\\(["'`])/g, '$1'), at);
  };
  const readUntil = (close, tag) => { // raw strings: content up to `close`, no escapes
    const at = line; let v = '';
    while (i < n && !s.startsWith(close, i)) { if (s[i] === '\n') { line++; lineBegin = i + 1; } v += s[i]; i++; }
    i += close.length;
    push('str', tag + v, at);
  };

  while (i < n) {
    const ch = s[i];
    if (ch === '\n') { newline(); i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') { i++; continue; }
    if (ch === '\\' && s[i + 1] === '\n') { line++; lineBegin = i + 2; i += 2; continue; } // line continuation
    if (!text) {
      const blk = spec.block.find(([o]) => s.startsWith(o, i) && (o[0] !== '=' || i === lineBegin));
      if (blk) {
        const [o, c, nests] = blk; let d = 1; i += o.length;
        while (i < n && d > 0) {
          if (s.startsWith(c, i)) { d--; i += c.length; continue; }
          if (nests && s.startsWith(o, i)) { d++; i += o.length; continue; }
          if (s[i] === '\n') newline();
          i++;
        }
        continue;
      }
      const lc = spec.line.find((p) => s.startsWith(p, i) && lineCommentOk(p));
      if (lc) { while (i < n && s[i] !== '\n') i++; continue; }
    }
    if (lineStart) { if (spec.indent && depth === 0 && !text) indentHere(); lineStart = false; }
    if (!text) {
      // raw / special strings
      let m;
      if (spec.rawRust && (m = /^b?r(#*)"/.exec(s.slice(i, i + 40)))) { i += m[0].length; readUntil(`"${m[1]}`, 'r:'); continue; }
      if (spec.rawCpp && (m = /^(?:u8|u|U|L)?R"([^()\\\s]{0,16})\(/.exec(s.slice(i, i + 40)))) { i += m[0].length; readUntil(`)${m[1]}"`, 'R:'); continue; }
      if (spec.verbatim && (m = /^(?:\$@|@\$|@)"/.exec(s.slice(i, i + 3)))) {
        i += m[0].length; const at = line; let v = '';
        while (i < n) { if (s[i] === '"') { if (s[i + 1] === '"') { v += '"'; i += 2; continue; } i++; break; } if (s[i] === '\n') { line++; lineBegin = i + 1; } v += s[i]; i++; }
        push('str', '@:' + v, at); continue;
      }
      if (spec.longStrings && (m = /^\[(=*)\[/.exec(s.slice(i, i + 12))) && !(out.length && ['id', 'prop'].includes(out[out.length - 1].k)) && !(out.length && [')', ']'].includes(out[out.length - 1].v))) {
        i += m[0].length; readUntil(`]${m[1]}]`, '[[:'); continue;
      }
      if (spec.charQuote && ch === "'") {
        const cm = /^'(\\u\{[0-9a-fA-F]+\}|\\.|[^\\'\n])'/.exec(s.slice(i, i + 12));
        if (cm) { push('str', 'c:' + cm[1]); i += cm[0].length; continue; }
        push('op', "'"); i++; continue; // Rust lifetime ('a)
      }
      const mq = spec.multiline.find((q) => q.length > 1 && s.startsWith(q, i));
      if (mq) { readString(mq, {}, true); continue; }
      // regex literals (JS/TS): /…/flags where an expression can start, so quotes inside aren't strings
      if (spec.regex && ch === '/' && regexCanStart(out[out.length - 1])) {
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
          push('str', s.slice(i, j)); i = j; continue;
        }
      }
      // strings (quote style is normalized: 'a' and "a" are the same token)
      if (spec.quotes.includes(ch)) {
        const triple = spec.triple && s.startsWith(ch.repeat(3), i);
        readString(triple ? ch.repeat(3) : ch, {}, triple || spec.multiline.includes(ch));
        continue;
      }
    }
    // numbers (1_000 == 1000)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i; while (j < n && /[0-9a-zA-Z_.%]/.test(s[j]) && !(s[j] === '.' && !/[0-9]/.test(s[j + 1] || ''))) j++;
      push(text ? 'str' : 'num', s.slice(i, j).replace(/_/g, '').toLowerCase()); i = j; continue;
    }
    // identifiers / keywords (CSS custom properties --x and at-words @media / @var included)
    const cssWord = spec.css && ((ch === '-' && s[i + 1] === '-' && ID_START.test(s[i + 2] || '')) || (ch === '@' && ID_START.test(s[i + 1] || '')));
    if (ID_START.test(ch) || cssWord) {
      let j = i + (cssWord ? (ch === '@' ? 1 : 2) : 1);
      while (j < n && (ID_CHAR.test(s[j]) || (spec.dash && s[j] === '-' && ID_CHAR.test(s[j + 1] || '')))) j++;
      const w = s.slice(i, j);
      // string prefixes: r'…', f"…", b'…' (Python)
      if (spec.prefixes && /^(r|u|b|f|t|br|rb|fr|rf)$/i.test(w) && (s[j] === '"' || s[j] === "'")) {
        const q = s.startsWith(s[j].repeat(3), j) ? s[j].repeat(3) : s[j];
        i = j; readString(q, { raw: /r/i.test(w), tag: `${w.toLowerCase()}:` }, q.length === 3);
        continue;
      }
      const v = spec.fold ? w.toLowerCase() : w;
      let k = 'id';
      if (text) k = 'str';
      else if (spec.kw.has(v)) k = 'kw';
      else if (spec.css) k = /^(\$|@|--)/.test(w) ? 'id' : 'prop';
      push(k, v); i = j; continue;
    }
    // operators and punctuation
    const op = OPS.find((o) => s.startsWith(o, i)) || ch;
    if ('([{'.includes(op)) depth++;
    else if (')]}'.includes(op)) depth = Math.max(0, depth - 1);
    push('op', op); i += op.length;
  }
  return out;
}

// Template expressions inside markup: {{ }} (Angular, Vue, Handlebars, Jinja, Go…), {% %}, <% %>, ${ }…
const EXPRS = [['{{{', '}}}'], ['{{', '}}'], ['{%', '%}'], ['{!!', '!!}'], ['<%=', '%>'], ['<%-', '%>'], ['<%', '%>'], ['${', '}'], ['#{', '}']];

/** HTML / XML / template tokenizer: tags, attributes (values read as code), text, <script>, <style>. */
function markup(s, spec) {
  const out = [];
  const n = s.length;
  const exprSpec = LANG.spec(spec.expr || 'js');
  let i = 0; let line = 1;
  let textFrom = 0;
  const pushT = (k, v) => out.push({ k, v, line });
  const sub = (src, sp, opts) => {
    const toks = sp === TEXT ? code(src, TEXT, { text: true }) : (opts && opts.raw ? code(src, sp) : tokenize(src, sp));
    for (const t of toks) { t.line += line - 1; out.push(t); }
    line += (src.match(/\n/g) || []).length;
  };
  const flush = (to) => { if (to > textFrom) sub(s.slice(textFrom, to), TEXT); };
  // A template comment only counts when it closes: Svelte's {#if …} is not an unclosed Jinja {# … #}.
  const comment = () => spec.block.find(([o, c]) => s.startsWith(o, i) && s.indexOf(c, i + o.length) !== -1);
  const exprAt = () => {
    const e = EXPRS.find(([o]) => s.startsWith(o, i));
    if (!e) return null;
    const close = s.indexOf(e[1], i + e[0].length);
    return close === -1 ? null : { open: e[0], close: e[1], end: close };
  };
  const skipComment = (c) => {
    const end = s.indexOf(c[1], i + c[0].length);
    const stop = end === -1 ? n : end + c[1].length;
    line += (s.slice(i, stop).match(/\n/g) || []).length;
    i = stop;
  };
  const expression = (e) => {
    pushT('op', e.open);
    sub(s.slice(i + e.open.length, e.end), exprSpec);
    pushT('op', e.close);
    i = e.end + e.close.length;
  };
  // Astro / front-matter: code between leading --- fences
  if (s.startsWith('---\n')) {
    const end = s.indexOf('\n---', 4);
    if (end !== -1) { i = 4; line = 2; sub(s.slice(4, end), LANG.spec('ts')); i = end + 4; textFrom = i; }
  }
  while (i < n) {
    const c = comment();
    if (c) { flush(i); skipComment(c); textFrom = i; continue; }
    const e = exprAt();
    if (e) { flush(i); expression(e); textFrom = i; continue; }
    if (s[i] === '{') { // Svelte / Astro / Angular blocks: { expr } without markup inside
      const close = s.indexOf('}', i + 1);
      if (close !== -1 && !/<[A-Za-z/!]/.test(s.slice(i + 1, close)) && close - i < 400) {
        flush(i); pushT('op', '{'); sub(s.slice(i + 1, close), exprSpec); pushT('op', '}'); i = close + 1; textFrom = i; continue;
      }
    }
    if (s[i] === '<' && /[A-Za-z/!?]/.test(s[i + 1] || '')) {
      flush(i);
      if (s[i + 1] === '!' || s[i + 1] === '?') { // <!DOCTYPE …>, <?xml …?>
        const end = s.indexOf('>', i);
        const stop = end === -1 ? n : end + 1;
        pushT('str', s.slice(i, stop).replace(/\s+/g, ' ').toLowerCase());
        line += (s.slice(i, stop).match(/\n/g) || []).length; i = stop; textFrom = i; continue;
      }
      const closing = s[i + 1] === '/';
      let j = i + (closing ? 2 : 1);
      const nm = /^[A-Za-z][\w:.-]*/.exec(s.slice(j, j + 80));
      if (!nm) { i++; continue; }
      const name = spec.fold ? nm[0].toLowerCase() : nm[0];
      pushT('op', closing ? '</' : '<'); pushT('prop', name);
      i = j + nm[0].length;
      const attrs = {};
      let selfClose = false;
      while (i < n) {
        if (s[i] === '\n') { line++; i++; continue; }
        if (/\s/.test(s[i])) { i++; continue; }
        if (s.startsWith('/>', i)) { pushT('op', '/>'); i += 2; selfClose = true; break; }
        if (s[i] === '>') { pushT('op', '>'); i++; break; }
        const ce = comment(); if (ce) { skipComment(ce); continue; }
        const ex = exprAt(); if (ex) { expression(ex); continue; }
        const an = /^[^\s=>/"'<]+|^\//.exec(s.slice(i, i + 200));
        if (!an) { i++; continue; }
        if (an[0] === '/') { i++; continue; }
        pushT('prop', an[0]); i += an[0].length;
        let k = i; while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
        if (s[k] !== '=') continue;
        pushT('op', '='); i = k + 1;
        while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
        const q = s[i];
        if (q === '"' || q === "'") {
          const end = s.indexOf(q, i + 1);
          const stop = end === -1 ? n : end;
          const val = s.slice(i + 1, stop);
          attrs[an[0].toLowerCase()] = val;
          pushT('op', '"'); i += 1; sub(val, exprSpec); pushT('op', '"'); i = stop + 1;
        } else if (q === '{') {
          let d = 0; let k2 = i;
          for (; k2 < n; k2++) { if (s[k2] === '{') d++; else if (s[k2] === '}' && --d === 0) break; }
          pushT('op', '{'); sub(s.slice(i + 1, k2), exprSpec); pushT('op', '}'); i = k2 + 1;
        } else {
          const uv = /^[^\s>]+/.exec(s.slice(i, i + 200));
          if (uv) { pushT('str', uv[0]); i += uv[0].length; attrs[an[0].toLowerCase()] = uv[0]; }
        }
      }
      // <script> / <style> bodies are code in their own language
      const lower = name.toLowerCase();
      if (!closing && !selfClose && (lower === 'script' || lower === 'style')) {
        const endTag = s.toLowerCase().indexOf(`</${lower}`, i);
        const stop = endTag === -1 ? n : endTag;
        const lang = (attrs.lang || attrs.type || '').toLowerCase();
        const bodySpec = lower === 'style'
          ? LANG.spec(/scss|less|stylus/.test(lang) ? 'scss' : /sass/.test(lang) ? 'sass' : 'css')
          : LANG.spec(/ts|typescript/.test(lang) ? 'ts' : /json/.test(lang) ? 'json' : 'js');
        sub(s.slice(i, stop), bodySpec);
        i = stop;
      }
      textFrom = i;
      continue;
    }
    i++;
  }
  flush(n);
  return out;
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

/**
 * The snippet read in each language it could be written in. A lock in an HTML/Vue/Svelte file may be
 * markup, or code from its <script>, <style> or a template expression; the file is read with all of
 * them, so each reading of the snippet is tried.
 */
function readings(snippet, fam) {
  const sp = LANG.spec(fam);
  const langs = sp.markup ? [fam, sp.expr || 'js', 'js', 'css', 'scss'] : [fam];
  const seen = new Set(); const out = [];
  for (const l of langs) {
    if (seen.has(l)) continue; seen.add(l);
    const need = tokenize(snippet.join('\n'), l);
    if (need.some((t) => !skippable(t))) out.push(need);
  }
  return out;
}

/** How many copies of the snippet the content holds (same tokens). */
function count(snippet, content, file) { return shape(snippet, content, file).copies; }

/**
 * { copies, siblings } of a snippet in `content`: identical copies, and look-alikes that differ only in
 * names (copy-pasted code with other variables). Recorded when a lock is made, so a later look-alike
 * isn't mistaken for the locked code having been renamed.
 */
function shape(snippet, content, file) {
  const fam = family(file);
  if (!fam || content === null || content === undefined) return { copies: 0, siblings: 0 };
  const have = tokenize(content, fam);
  let best = { copies: 0, siblings: 0 };
  for (const need of readings(snippet, fam)) {
    const copies = findAll(need, have, false).length;
    const all = findAll(need, have, true, plausibleRename(need, have)).length;
    if (copies > best.copies || (copies === best.copies && all - copies > best.siblings)) best = { copies, siblings: Math.max(0, all - copies) };
  }
  return best;
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
  const needs = readings(snippet, fam);
  if (!needs.length) return { engine: 'structural', status: 'unsupported', lines: null, renames: [] };
  const have = tokenize(content, fam);
  if (needs.length > 1) {
    // markup: use the reading that is found in the file (the first one when none is)
    const hit = needs.find((need) => findAll(need, have, false).length) || needs.find((need) => findAll(need, have, true, plausibleRename(need, have)).length);
    return verifyTokens(hit || needs[0], have, opts);
  }
  return verifyTokens(needs[0], have, opts);
}

function verifyTokens(need, have, opts) {
  const span = (m) => [have[m.start].line, have[m.last].line];
  // With several matches, report the one that covers whole lines: "fn(null, null)" on its own line,
  // not the same tokens inside "if (!user) return fn(null, null)".
  const aligned = (m) => (m.start === 0 || have[m.start - 1].line !== have[m.start].line) && (m.last === have.length - 1 || have[m.last + 1].line !== have[m.last].line);
  const best = (list) => list.find(aligned) || list[0];
  const copies = Math.max(1, opts.copies || 1);
  const siblings = Math.max(0, opts.siblings || 0);
  const exact = findAll(need, have, false);
  if (exact.length >= copies) return { engine: 'structural', status: 'intact', lines: span(best(exact)), renames: [], found: exact.length };
  const all = findAll(need, have, true, plausibleRename(need, have));
  // A rename turns the locked copy into a new look-alike: there must be more look-alikes than the
  // siblings that already existed when the lock was made.
  if (all.length >= copies + siblings && all.length - exact.length > siblings) {
    const ren = all.find((m) => [...m.map].some(([a, b]) => a !== b)) || all[0];
    return { engine: 'structural', status: 'renamed', lines: span(ren), renames: [...ren.map].filter(([a, b]) => a !== b), found: all.length };
  }
  // Fewer copies than when the lock was made: one of them was changed or removed.
  return { engine: 'structural', status: 'changed', lines: all.length ? span(best(all)) : null, renames: [], found: all.length, copies };
}

module.exports = { family, tokenize, verify, count, shape, INDENT, DEDENT };
