'use strict';
// Regression Bench cases: real bug fixes from real repositories, undone.
//
// For each corpus repo (pinned commit), `fixlock discover` lists past bug-fix commits. For each fix:
//   regression = the fix's own diff for one file, applied in reverse at the pinned commit: the code
//                goes back to exactly what it was before the fix (what an AI port from old code does)
//   control    = a harmless edit of the same lines (comments, blank lines): the fix is kept
// A case is used only if the reverse diff applies cleanly and is small (≤ MAX_LINES changed lines).
// Selection never asks fixlock whether it would catch the case.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { corpus, checkout, discoverLocks, env } = require('../corpus');
const { TEST_FILE } = require('../../src/discover');
const S = require('../../src/structural');
const M = require('../mutations');
const L = require('../../src/locks');

const MAX_LINES = 40;
const TEST_DIR = /(^|\/)(tests?|spec|__tests__)\//i;

function gitIn(dir) {
  return (args, opts = {}) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

/** Undo `sha`'s change to `file` on top of the current checkout. Returns the new content or null. */
function reverseFix(dir, sha, file) {
  const git = gitIn(dir);
  let patch;
  try { patch = git(['show', '--format=', '--no-color', '--no-ext-diff', sha, '--', file]); } catch { return null; }
  const changed = patch.split('\n').filter((l) => /^[+-](?![+-]{2} )/.test(l)).length;
  if (!patch.trim() || changed === 0 || changed > MAX_LINES) return null;
  const tmp = path.join(os.tmpdir(), `fixlock-bench-${process.pid}.patch`);
  fs.writeFileSync(tmp, patch);
  try {
    git(['apply', '-R', '--check', tmp]);
    git(['apply', '-R', tmp]);
    return fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  } finally {
    try { git(['checkout', '-q', '--', file]); } catch { /* */ }
    fs.rmSync(tmp, { force: true });
  }
}

/** A harmless edit of the lock's lines: comments and blank lines added, code untouched. */
function controlEdit(content, snippet, file) {
  const fam = S.family(file);
  const lines = content.split('\n');
  const at = L.locate({ file, snippet }, lines);
  if (!fam || at.length < snippet.length) return null;
  const range = [Math.min(...at) - 1, Math.max(...at) - 1];
  let out = M.apply(M.benign['add comments'], lines, range, fam, file);
  if (out === null) return null;
  const lines2 = out.split('\n');
  const at2 = L.locate({ file, snippet }, lines2);
  if (at2.length >= snippet.length) {
    const r2 = [Math.min(...at2) - 1, Math.max(...at2) - 1];
    out = M.apply(M.benign['blank lines'], lines2, r2, fam, file) || out;
  }
  return out === content ? null : out;
}

/**
 * Build the cases. opts.perRepo: fixes per repository (default 3); opts.repos: names to include.
 * Returns [{ id, repo, lang, url, head, file, fix: { sha, subject }, snippets, changed, base, regressed, control }]
 */
function buildCases(opts = {}) {
  const perRepo = opts.perRepo || 3;
  const cases = [];
  for (const r of corpus()) {
    if (opts.repos && !opts.repos.includes(r.name)) continue;
    if (opts.log) opts.log(`${r.name}\n`);
    const dir = checkout(r);
    const found = discoverLocks(dir, r).filter((f) => f.type === 'bug' && !TEST_FILE.test(f.file) && !TEST_DIR.test(f.file) && S.family(f.file));
    const shaOf = (f) => (typeof f.commit === 'string' ? f.commit : f.commit.sha);
    const seen = new Set();
    let n = 0;
    for (const f of found) {
      if (n >= perRepo) break;
      const sha = shaOf(f);
      if (seen.has(sha)) continue; // one case per fix commit
      const base = fs.readFileSync(path.join(dir, f.file), 'utf8').replace(/\r\n/g, '\n');
      const regressed = reverseFix(dir, sha, f.file);
      if (regressed === null || regressed === base) continue;
      // Every block fixlock would lock for this fix in this file (auto-lock locks them all).
      const snippets = found.filter((g) => shaOf(g) === sha && g.file === f.file).map((g) => g.snippet);
      const control = controlEdit(base, f.snippet, f.file);
      if (control === null) continue;
      seen.add(sha);
      n++;
      const changed = gitIn(dir)(['show', '--format=', '--numstat', sha, '--', f.file]).trim().split(/\s+/).slice(0, 2).map(Number);
      cases.push({
        id: `${r.name}-${n}`, repo: r.name, lang: r.lang, url: r.url.replace(/\.git$/, ''), head: r.sha, file: f.file,
        fix: { sha: gitIn(dir)(['rev-parse', sha]).trim(), subject: f.title }, snippets, changed: { added: changed[0], removed: changed[1] },
        base, regressed, control,
      });
    }
  }
  return cases;
}

module.exports = { buildCases, reverseFix, controlEdit, MAX_LINES };
