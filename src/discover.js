'use strict';
// Fix discovery: find past bug fixes in git history that are worth locking, including the ones that
// don't follow Conventional Commits. Each candidate is scored from evidence and the reasons are shown:
//   - the fix was reverted and had to be re-applied (the bug already came back once)
//   - the message says it's a fix, mentions a regression, or links an issue
//   - the commit also changed a test
//   - the locked lines add a guard (null check, error handling, bounds check, early return…)
//   - the change is small and focused
// Only lines that still exist at HEAD and still come from that commit are suggested (git blame).
// git and the store load on first use, so this module's scoring also runs in the GitHub App (no git there)
const g = new Proxy({}, { get: (_, k) => require('./git')[k] });
const auto = require('./autolock');

const REVERT_SUBJECT = /^Revert "(.+)"$/;
const REAPPLY_SUBJECT = /^Reapply "(.+)"$/;
const REVERTS_BODY = /This reverts commit ([0-9a-f]{7,40})/i;
const CONVENTIONAL_FIX = /^(fix|bugfix|hotfix)(\([^)]*\))?!?:/i;
const CONVENTIONAL_FEAT = /^feat(\([^)]*\))?!?:/i;
const NOT_CODE = /^(chore|docs|style|test|tests|ci|build|release|refactor|perf)(\([^)]*\))?!?:/i;
const FIX_WORDS = /\b(fix(e[sd]|ing)?|bug(s|fix)?|hotfix|patch(ed)?|crash(es|ed|ing)?|resolve[sd]?|prevent(s|ed)?|broken|wrong|incorrect|edge[ -]case|handle[sd]?|guard|regress(ion|ed)?|workaround|typo in (logic|condition))\b/i;
const CAME_BACK = /\b(regress(ion|ed)?|came back|re-?fix(ed)?|still broken|broke(n)? again|reintroduc(e[sd]?|ing)|(fix(ed)?|bug) again|happen(s|ed|ing)? again)\b/i;
const ISSUE_REF = /(#\d+\b|\b[A-Z][A-Z0-9]+-\d+\b|\bCU-[a-z0-9]+\b)/g;
// Things that look like issue keys but aren't.
const NOT_ISSUES = /^(UTF|ISO|SHA|RFC|ES|HTTP|TLS|SSL|AES|MD|RSA|ECMA|IEEE|UTC|GMT|X|Y|V|H|P|IPV|WCAG|OWASP|PEP|JSR|ECDSA|BASE|INT|UINT|FLOAT|COVID)-/i;
// Test files, across ecosystems: test/ tests/ spec/ __tests__/ src/test/ e2e/ cypress/, *.test.* *.spec.*,
// *_test.go|py|rb|exs|dart|cc|cpp, test_*.py, conftest.py, *Test(s).java|kt|cs|php|swift|scala, *Spec.*, *IT.java, *_spec.rb
const TEST_FILE = /(^|\/)(tests?|spec|specs|__tests__|e2e|cypress|playwright|src\/test|[\w.]+\.Tests?)\/|\.(test|spec|e2e|cy)\.[a-z]+$|_(test|spec|unittest)\.[a-z]+$|(^|\/)(test_[^/]+|conftest)\.py$|(Tests?|Spec|Suite|IT)\.(java|kt|kts|cs|php|swift|scala|groovy|m|mm|dart)$/;

// Code that typically exists because of a bug: checks, error handling, bounds, explicit conversions.
const GUARDS = [
  { re: /(===?|!==?)\s*(null|undefined|nil|None|NULL)\b|\b(null|nil)\s*(===?|!==?)|\bis (not )?(None|null)\b|\?\.|\?\?|\?:|(\(|\|\||&&)\s*!\s*[\w$.]+\s*(\)|\|\||&&)|\bif not \w+|\.isEmpty\(\)|\bOptional\b|\.(is_none|is_some|is_empty|nil\?|blank\?|present\?|empty\?)\b|\bif let\b|\bguard let\b|\bisset\(|\bempty\(|\bis_null\(|IsNullOrEmpty|IsNullOrWhiteSpace|requireNonNull|\bIS (NOT )?NULL\b|\bCOALESCE\(|\bis_nil\b|\bunless \w+/i, label: 'null/empty check' },
  { re: /\b(try|catch|except|rescue|finally|recover)\b|\.catch\(|\berr\s*!=\s*nil\b|\.map_err\(|\bResult<|\?\s*;|\btry\?|\{:error,|\bon_error\b|\bset -e\b|\|\|\s*(exit|return)\b/, label: 'error handling' },
  { re: /\b(throw|raise|panic|abort)\b|\breturn\s+(res\.status\(4\d\d|Err\(|errors?\.New|fmt\.Errorf|http\.Error|BadRequest|NotFound|Forbidden|Unauthorized)|\bStatus(BadRequest|Forbidden|Unauthorized|NotFound)\b|\b(BAD_REQUEST|FORBIDDEN|UNAUTHORIZED)\b|\bexit [1-9]\b|ArgumentException|IllegalArgumentException|ValidationError|ValueError/, label: 'rejects bad input' },
  { re: /(\.length|\.Length|\.Count\b|\.count\b|\.size\(\)|\.len\(\)|\b(len|count|size|length|strlen|sizeof)\([^()]*\))\s*[<>=!]=?|\b(Math\.(max|min)|clamp|bounds|saturating_\w+|checked_\w+|min\(|max\()|[<>]=?\s*0\b/, label: 'bounds check' },
  { re: /\bparseInt\([^,)]+,\s*10\)|\bNumber\.isFinite\b|\bisNaN\b|\btoFixed\(|\bMath\.round\b|\bDecimal\b|\bBigInt\b|\bBigDecimal\b|\bRoundingMode\b|\bround\(|\bdecimal\.|\bmath\.isclose\b|\bf64::EPSILON\b/, label: 'numeric safety' },
  { re: /\b(timezone|tz|utc|UTC|toISOString|Intl\.|locale|encodeURIComponent|escape|sanitize|trim\(\)|strip\(\)|normalize|ZoneId|ZonedDateTime|DateTimeOffset|time\.UTC|charset|encoding)\b/i, label: 'format/encoding handling' },
  { re: /\b(mutex|semaphore|debounce|throttle|idempot\w*|race|inFlight|isLocked|already(Sent|Charged|Processed|Running)|synchronized|Mutex|RwLock|Arc<|atomic|Lock\(\)|lock\s*\(|@Transactional|FOR UPDATE|BEGIN TRANSACTION|SELECT .* FOR SHARE|once\.Do)\b/i, label: 'ordering/concurrency' },
  { re: /\b(authorize|authorized|permission|isAdmin|is_admin|hasRole|has_role|can\?|@PreAuthorize|\[Authorize|csrf|xsrf|verify_token|login_required|requireAuth|ensureAuthenticated|canActivate|rate.?limit|sql.?injection|parameterized|prepare\()\b/i, label: 'access/security check' },
  { re: /\*ngIf|\bv-if\b|\{#if\b|\{%-?\s*if\b|\bth:if\b|@if\s*\(|\bx-if\b|\bng-if\b|:disabled|\[disabled\]|\bdisabled=/, label: 'template condition' },
];

const S = require('./structural');
/** Does a snippet hold code (not only comments / doc strings)? Unknown languages: any non-comment line. */
function hasCode(snippet, file) {
  const fam = S.family(file);
  if (!fam) return snippet.some((l) => !isComment(l));
  // at least 3 code tokens: "fetch," or "var len;" is too small to mean anything on its own
  return S.tokenize(snippet.join('\n'), fam).filter((t) => t.k !== 'str' && !(t.k === 'op' && '{}()[];,'.includes(t.v))).length >= 3;
}
const COMMENT = /^\s*(\/\/|\/?\*|#(?!\[)|<!--|--\s|;;)/;
const isComment = (l) => COMMENT.test(l);

function guardsIn(lines) {
  const found = new Set();
  for (const l of lines) if (!isComment(l)) for (const gd of GUARDS) if (gd.re.test(l)) found.add(gd.label);
  return [...found];
}

/** All non-merge commits in range with their files and line counts (one git call). */
function history(sel) {
  const args = ['log', '--no-merges', '--numstat', '--pretty=format:%x1e%H%x1f%s%x1f%ae%x1f%b%x1f'];
  if (sel.since) args.push(`${sel.since}..HEAD`);
  else args.push(`-${sel.max || 1000}`);
  const out = g.git(args, { allowFail: true }) || '';
  return out.split('\x1e').map((r) => r.replace(/^\n+/, '')).filter(Boolean).map((r) => {
    const [sha, subject, email, body, stat = ''] = r.split('\x1f');
    const files = []; let added = 0;
    for (const l of stat.split('\n')) {
      const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      files.push(m[3]);
      if (m[1] !== '-') added += +m[1];
    }
    const why = (body || '').split(/\n\s*\n/)[0].split('\n').filter((l) => !/^[\w-]+:\s/.test(l) && !REVERTS_BODY.test(l)).join(' ').trim();
    return { sha, subject: subject || '', email: (email || '').toLowerCase(), body: body || '', why, files, added };
  });
}

/**
 * Score commits from their message, revert history and files. Returns
 * [{ commit, type, score, signals: [text], tests: [paths], title }] for commits with any evidence.
 */
function scoreCommits(commits) {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const find = (prefix) => bySha.get(prefix) || commits.find((c) => c.sha.startsWith(prefix));
  // which commits reverted which
  const revertOf = new Map(); // sha -> commit it reverts
  for (const c of commits) {
    const m = c.body.match(REVERTS_BODY);
    const target = m && find(m[1]);
    if (target) revertOf.set(c.sha, target);
  }
  const revertedBy = new Map(); // sha -> revert commit
  for (const [r, target] of revertOf) revertedBy.set(target.sha, bySha.get(r));

  const out = [];
  for (const c of commits) {
    const signals = []; let score = 0; let type = 'bug';
    let subject = c.subject;
    // A commit that undoes a revert re-applies the original fix: the bug already came back once.
    const reverted = revertOf.get(c.sha);
    let original = null; let m;
    if ((m = subject.match(REAPPLY_SUBJECT)) || (m = subject.match(/^Revert "Revert "(.+)""$/))) original = m[1];
    else if (reverted && revertOf.has(reverted.sha)) original = revertOf.get(reverted.sha).subject; // reverts a revert
    const reapply = !!original;
    if (reapply) {
      subject = original;
      score += 5; signals.push('was reverted and had to be re-applied (the bug already came back once)');
    } else if (REVERT_SUBJECT.test(subject) || reverted) {
      continue; // a plain revert removes code; nothing to lock
    }
    if (NOT_CODE.test(subject) && !reapply) continue;
    if (CONVENTIONAL_FEAT.test(subject)) { type = 'feature'; score += 2; signals.push('feature commit'); }
    else if (CONVENTIONAL_FIX.test(subject)) { score += 3; signals.push('fix commit'); }
    else if (FIX_WORDS.test(subject)) { score += 2; signals.push(`message says "${subject.match(FIX_WORDS)[0].toLowerCase()}"`); }
    if (!reapply && CAME_BACK.test(`${subject} ${c.why}`)) { score += 3; signals.push('message mentions a regression or repeat fix'); }
    if (revertedBy.has(c.sha) && !reapply) { score += 1; signals.push(`was reverted once in ${revertedBy.get(c.sha).sha.slice(0, 7)}`); }
    const issue = (`${subject} ${c.body}`.match(ISSUE_REF) || []).find((x) => !NOT_ISSUES.test(x));
    if (issue) { score += 1; signals.push(`links ${issue}`); }
    const tests = c.files.filter((f) => TEST_FILE.test(f));
    if (tests.length && c.files.length > tests.length) { score += 2; signals.push(`came with a test (${tests[0]})`); }
    const codeFiles = c.files.length - tests.length;
    if (score > 0 && c.added > 0 && c.added <= 20 && codeFiles <= 3) { score += 1; signals.push('small, focused change'); }
    if (score <= 0) continue;
    out.push({ commit: { ...c, subject }, type, score, signals, tests });
  }
  return out;
}

function confidence(score) { return score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low'; }

/**
 * Candidate locks found in history.
 * sel: { max, since }   opts: { min (default 4), features (default true), perCommit (default 2) }
 * Returns { found: [{ file, start, end, snippet, commit, type, score, confidence, signals, test }], skipped, scanned }
 */
function discover(cfg, reg, sel = {}, opts = {}) {
  const min = opts.min === undefined ? 4 : +opts.min;
  const commits = history(sel);
  const scored = scoreCommits(commits).filter((x) => opts.features !== false || x.type !== 'feature');
  const meta = new Map(scored.map((x) => [x.commit.sha, x]));
  const { out, skipped } = auto.candidates(scored.map((x) => x.commit), cfg, reg);
  const blocks = out
    .filter((cd) => !TEST_FILE.test(cd.file)) // tests are linked to a lock, not locked themselves
    .filter((cd) => hasCode(cd.snippet, cd.file)); // comments or a docstring alone protect nothing
  const scoredBlocks = blocks.map((cd) => {
    const m = meta.get(cd.commit.sha);
    const guards = guardsIn(cd.snippet);
    const signals = [...m.signals];
    let score = m.score;
    if (guards.length && m.type === 'bug') { score += 2; signals.push(`adds a guard (${guards.join(', ')})`); }
    return { ...cd, commit: m.commit, type: m.type, score, guards, confidence: confidence(score), signals, test: m.tests[0] || null };
  });
  // A big fix touches many places; suggest its most telling blocks (guards first, then the smallest),
  // so one commit doesn't flood the list.
  const perCommit = opts.perCommit === undefined ? 2 : +opts.perCommit;
  const byCommit = new Map();
  for (const b of scoredBlocks) (byCommit.get(b.commit.sha) || byCommit.set(b.commit.sha, []).get(b.commit.sha)).push(b);
  const found = [...byCommit.values()].flatMap((list) => list
    .sort((a, b) => b.score - a.score || b.guards.length - a.guards.length || a.snippet.length - b.snippet.length)
    .slice(0, perCommit))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score || a.snippet.length - b.snippet.length || a.file.localeCompare(b.file) || a.start - b.start);
  const keptSkips = skipped.filter((x) => !TEST_FILE.test(x.split(':')[0]));
  return { found, skipped: keptSkips, scanned: commits.length, fixes: new Set(found.map((f) => f.commit.sha)).size };
}

/** Turn accepted candidates into locks (adds them to reg). */
function toLocks(found, cfg, reg) {
  const locks = auto.toLocks(found, cfg, reg);
  locks.forEach((l, i) => {
    const f = found[i];
    if (f.test) l.test = f.test;
    if (!f.commit.why) {
      const picked = f.signals.filter((x) => !/^(fix commit|feature commit|message says)/.test(x)).slice(0, 2);
      l.reason = `${l.title} (commit ${f.commit.sha.slice(0, 7)}${picked.length ? `; ${picked.join('; ')}` : ''})`;
    }
    l.source = { commit: f.commit.sha, discovered: true, score: f.score, signals: f.signals };
  });
  return locks;
}

/** "1-3,5" → [0,1,2,4] (indexes into a list of length n) */
function parseSelection(input, n) {
  const v = String(input || '').trim().toLowerCase();
  if (!v || v === 'none' || v === 'n') return [];
  if (v === 'all' || v === 'a') return [...Array(n).keys()];
  const picked = new Set();
  for (const part of v.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Can't read "${part}". Use numbers like 1-3,5, or all / none.`);
    const a = +m[1]; const b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= n) picked.add(i - 1);
  }
  return [...picked].sort((x, y) => x - y);
}

module.exports = { TEST_FILE, history, scoreCommits, guardsIn, hasCode, discover, toLocks, parseSelection, confidence };
