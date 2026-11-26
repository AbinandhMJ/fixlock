'use strict';
// Shell commands an AI agent is about to run, judged against fixlock's protection. Used by Claude Code's
// Bash tool hook, Cursor's beforeShellExecution and Windsurf's pre_run_command.
//   - forbidden: unlocking (fixlock allow / remove) or turning the git hooks off (--no-verify, -n,
//     core.hooksPath, deleting or overwriting .git/hooks)
//   - writes: repo files the command may change (sed -i, >, tee, cp / mv / rm, git checkout <ref> -- f,
//     git restore, a one-liner that writes, git revert / git reset --hard <ref>), checked against locks
//     and rules like an edit whose new text isn't known.
// This is a heuristic on purpose: a shell can always hide what it does (write a script, then run it).
// Commits and pull requests are checked again by the git hooks, CI and the GitHub App, which see the
// result rather than the command. See docs/adversarial.md for what gets through where.

const FORBIDDEN = [
  { re: /\bfixlock(?:@[\w.^~-]+)?(?:\.js)?["']?\s+(allow|remove|rm)\b/i, why: 'Only the developer can unlock or remove a fixlock lock.' },
  { re: /\bgit\b[^|;&\n]*\b(commit|push|merge|rebase|am|cherry-pick|revert)\b[^|;&\n]*\s--no-verify\b/i, why: "Skipping the git hooks (--no-verify) skips fixlock's checks." },
  { re: /\bgit\b[^|;&\n]*\bcommit\b[^|;&\n]*\s-[a-zA-Z]*n[a-zA-Z]*(?=\s|$)/, unquoted: true, why: "`git commit -n` skips the git hooks, and fixlock's checks with them." },
  { re: /core\.hookspath/i, why: "Changing core.hooksPath turns fixlock's git hooks off." },
  { re: /(^|[\s;&|(])(rm|mv|chmod|truncate|unlink|cp|ln|install)\b[^|;&\n]*\.git[\\/]hooks/i, why: "fixlock's git hooks are the developer's to change." },
  { re: />\s*["']?[^\s"'|;&]*\.git[\\/]hooks[\\/]/i, why: "fixlock's git hooks are the developer's to change." },
  // The developer's temporary OKs (fixlock allow) live here: writing it is the same as running fixlock allow.
  { re: /(>|\btee\b|\b(cp|mv|rm|sed|perl|python3?|node|ruby|echo|printf)\b|writeFile|Set-Content|Out-File)[^\n]*fixlock-allow\.json/i, why: 'Only the developer can unlock a fixlock lock.' },
];

// Writers that change the files they name (sed -i f, rm f, mv a b, git checkout <ref> -- f, a one-liner...).
const NAMED = /\bsed\b[^|;&\n]*\s-[a-zA-Z]*i|\bperl\b[^|;&\n]*\s-[a-zA-Z]*i|\b(rm|mv|unlink|truncate|dd|patch)\b|\bgit\s+(checkout|restore|rm|mv)\b|writeFile|\.write\(|\bopen\([^)]*['"][wa+]|Set-Content|Out-File|Remove-Item|Move-Item/i;

/** What a command segment writes: { all: true } when any file it names may change, plus explicit targets. */
function targetsOf(seg) {
  const t = [];
  for (const m of seg.matchAll(/(?:^|[^0-9&>])>{1,2}\s*["']?([^\s"'|;&<>]+)/g)) t.push(m[1]);   // > f, >> f (not 2>&1)
  const tee = seg.match(/\btee\b((?:\s+[^\s|;&]+)+)/);
  if (tee) t.push(...tee[1].trim().split(/\s+/).filter((a) => !a.startsWith('-')));
  const cp = seg.match(/\b(cp|install|rsync|Copy-Item)\b((?:\s+[^\s|;&]+)+)/i);                  // cp a b: b changes
  if (cp) { const args = cp[2].trim().split(/\s+/).filter((a) => !a.startsWith('-')); if (args.length) t.push(args[args.length - 1]); }
  return { all: NAMED.test(seg), targets: t.map((x) => x.replace(/^["']|["']$/g, '')) };
}

/** The command with quoted strings emptied, for flag checks ("-n" inside a commit message isn't a flag). */
const unquote = (cmd) => cmd.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');

/** Split into the parts a shell runs one after another or piped (a; b && c | d). */
const segments = (cmd) => cmd.split(/\n|;|&&|\|\||\|/).map((x) => x.trim()).filter(Boolean);

function forbidden(command) {
  const raw = String(command || '');
  for (const f of FORBIDDEN) if (f.re.test(f.unquoted ? unquote(raw) : raw)) return f.why;
  return null;
}

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Repo-relative files among `candidates` that the command may write. `git` (optional) answers
 * git(['show', '--name-only', ...]) style calls, for git revert / git reset --hard.
 */
function writes(command, candidates, git = null) {
  const out = new Set();
  const cmd = String(command || '');
  for (const seg of segments(cmd)) {
    // Reverting a commit or resetting to an older one changes the files that commit (or range) touched.
    const rev = git && seg.match(/\bgit\s+revert\b(?:\s+-\S+)*\s+([\w^~./-]+)/);
    const reset = git && seg.match(/\bgit\s+reset\b[^|;&\n]*--hard\s+([\w^~./-]+)/);
    const ref = rev ? rev[1] : reset && !/^HEAD$/i.test(reset[1]) ? reset[1] : null;
    if (ref) {
      const files = (rev ? git(['show', '--format=', '--name-only', ref]) : git(['diff', '--name-only', ref, 'HEAD'])) || '';
      for (const f of files.split('\n').map((x) => x.trim()).filter(Boolean)) if (candidates.includes(f)) out.add(f);
      continue;
    }
    const { all, targets } = targetsOf(seg);
    if (!all && !targets.length) continue;
    for (const f of candidates) {
      const base = f.split('/').pop();
      const hit = (x) => { const y = x.replace(/\\/g, '/').replace(/^\.\//, ''); return y === f || y.endsWith(`/${f}`) || y.split('/').pop() === base; };
      if (targets.some(hit)) { out.add(f); continue; }
      if (!all) continue;
      // The full path, or the file name as a whole word (a command run in the file's folder).
      if (seg.includes(f) || new RegExp(`(^|[\\s"'=/(<>])${esc(base)}($|[\\s"')<>;])`).test(seg)) out.add(f);
      else if (f.startsWith('.fixlock/') && /\.fixlock\b/.test(seg)) out.add(f);
    }
  }
  return [...out];
}

/**
 * Judge a shell command in the current repo for an agent.
 * Returns null (nothing to say) or { level: 'block' | 'ask' | 'warn', forbidden: bool, files, locks, reason }.
 * Must be called with cwd inside the repo.
 */
function judge(command, { agent = null } = {}) {
  const why = forbidden(command);
  if (why) return { level: 'block', forbidden: true, files: [], locks: [], rules: [], reason: `fixlock: ${why} Ask the developer to run it themselves if it's needed.` };
  const s = require('./store');
  if (!s.configExists()) return null;
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const rules = require('./rules');
  const team = require('./team');
  const g = require('./git');
  const person = team.current(cfg);
  const candidates = [...new Set([...reg.locks.map((l) => l.file), '.fixlock/registry.json', '.fixlock/config.json'])];
  const files = writes(command, candidates, (args) => g.git(args, { allowFail: true }));
  if (!files.length) return null;
  const RANK = { warn: 1, ask: 2, block: 3 };
  let level = null;
  const locks = [];
  const hitRules = [];
  const notes = [];
  for (const f of files) {
    const rule = rules.editRule(cfg, f, agent);
    if (rule) {
      notes.push(`${f}: ${rule.message}`);
      hitRules.push({ name: rules.ruleName(rule.rule), level: rule.level, file: f });
      if (!level || RANK[rule.level] > RANK[level]) level = rule.level;
    }
    for (const l of reg.locks.filter((x) => x.file === f && !team.exempt(cfg, x, person))) {
      const pol = (cfg.policies[l.type] || cfg.policies.bug).onEdit;
      locks.push({ id: l.id, title: l.title, file: f, level: pol });
      if (!level || RANK[pol] > RANK[level]) level = pol;
    }
  }
  if (!level) return null;
  const lockText = locks.map((l) => `${l.id} "${l.title}" (${l.file})`).join(', ');
  return {
    level, forbidden: false, files, locks, rules: hitRules,
    reason: `fixlock: this command may change ${files.join(', ')}${lockText ? `, which holds the locked ${locks.length > 1 ? 'fixes' : 'fix'} ${lockText}` : ''}, and fixlock can't see which lines from a shell command.${notes.length ? `\n${notes.join('\n')}` : ''}\n` +
      'AI: edit the file with your edit tool instead, so fixlock can check the exact lines, or explain the change to the developer first.',
  };
}

module.exports = { FORBIDDEN, NAMED, targetsOf, forbidden, writes, judge, unquote, segments };
