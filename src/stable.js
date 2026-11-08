'use strict';
// Working-code guard: protects code that is NOT explicitly locked but already committed and working.
// An edit that deletes/rewrites such lines must be confirmed by the developer.
const g = require('./git');
const { norm, trivial } = require('./locks');

const DAY = 86400;

/** Lines of `before` that are gone in `after` (multiset diff, whitespace-insensitive). Returns [{ line, text }]. */
function removedLines(before, after) {
  const counts = new Map();
  for (const l of after.split('\n')) { const k = norm(l); counts.set(k, (counts.get(k) || 0) + 1); }
  const out = [];
  before.split('\n').forEach((l, i) => {
    if (trivial(l)) return;
    const k = norm(l);
    const n = counts.get(k) || 0;
    if (n > 0) counts.set(k, n - 1); else out.push({ line: i + 1, text: l });
  });
  return out;
}

/**
 * Which removed lines count as "already working"?
 * - committed by someone else (any age), or
 * - committed by the current developer more than `olderThanDays` days ago.
 * Lines not yet committed, or the developer's own fresh work, are free to change.
 * blame: [{ line, sha, email, time, summary }] for the `before` version.
 */
function stableRemovals(removed, blame, person, opts = {}) {
  const olderThan = (opts.olderThanDays ?? 7) * DAY;
  const now = opts.now || Math.floor(Date.now() / 1000);
  const mine = new Set((person.emails || []).map((e) => e.toLowerCase()));
  const byLine = new Map(blame.map((b) => [b.line, b]));
  return removed.map((r) => ({ ...r, b: byLine.get(r.line) }))
    .filter(({ b }) => b && b.sha !== g.UNCOMMITTED && (!mine.has(b.email) || now - b.time > olderThan));
}

/** Short human summary of what would be lost. */
function summarize(cfg, hits, team) {
  const authors = [...new Set(hits.map((h) => {
    const m = team.find(cfg, h.b.email);
    return m ? team.handle(m) : h.b.email;
  }))];
  const newest = Math.max(...hits.map((h) => h.b.time));
  const days = Math.max(0, Math.round((Date.now() / 1000 - newest) / DAY));
  const commits = [...new Set(hits.map((h) => h.b.summary).filter(Boolean))].slice(0, 3);
  return { count: hits.length, authors, days, commits, sample: hits.slice(0, 4).map((h) => h.text.trim()) };
}

function describe(sum, file) {
  return `• ${sum.count} existing line(s) in ${file} would be deleted or rewritten — code that already works.\n` +
    `  Written by ${sum.authors.join(', ')}; last changed ${sum.days === 0 ? 'today' : sum.days + ' day(s) ago'}` +
    (sum.commits.length ? ` (${sum.commits.map((c) => `"${c}"`).join(', ')})` : '') + '.\n' +
    `  e.g. ${sum.sample.join(' | ')}`;
}

module.exports = { removedLines, stableRemovals, summarize, describe };
