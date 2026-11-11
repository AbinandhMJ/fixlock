'use strict';
const fs = require('fs');
const path = require('path');
const g = require('./git');
const s = require('./store');
const team = require('./team');
const L = require('./locks');
const init = require('./init');
const trackers = require('./trackers');
const { prApprovers } = require('./approvals');
const agents = require('./agents');
const changelog = require('./changelog');
const auto = require('./autolock');
const stable = require('./stable');

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (t) => (tty ? `\x1b[${code}m${t}\x1b[0m` : t);
const c = { red: paint(31), green: paint(32), yellow: paint(33), bold: paint(1), dim: paint(2), cyan: paint(36) };

/* ---------------- init / team ---------------- */
async function cmdInit(args) {
  const cfg = s.loadConfig();
  const useDefaults = args.yes || (!process.stdin.isTTY && !args.interactive);
  const hooks = useDefaults ? init.defaults(cfg) : await init.interactive(cfg);
  s.saveConfig(cfg);
  s.saveRegistry(s.loadRegistry());
  if (hooks.claude) init.installClaudeHook();
  if (hooks.git) init.installGitHook();
  if (hooks.codeowners) writeCodeowners(true);
  let mcpDone = [];
  if (hooks.mcp) {
    const project = ['claude-code', 'cursor', 'copilot', 'gemini'].filter((id) => agents.enabled(cfg).includes(id));
    if (project.length) mcpDone = require('./setup').setup(project).results;
  }
  syncAgentFiles(true);
  console.log(c.green('\n✔ fixlock is set up.'));
  console.log(`  team: ${cfg.team.map((m) => `${m.name} (${m.role})`).join(', ') || '(none)'}`);
  console.log(`  AI tools: ${agents.enabled(cfg).join(', ') || '(none)'}`);
  if (hooks.claude) console.log('  Claude Code hook: .claude/settings.json');
  if (mcpDone.length) console.log(`  MCP server connected for: ${mcpDone.map((r) => r.label).join(', ')}`);
  const userLevel = ['codex', 'windsurf'].filter((id) => agents.enabled(cfg).includes(id));
  if (hooks.mcp && userLevel.length) console.log(`  ${userLevel.join(' / ')} users: run  npx fixlock setup ${userLevel.join(' ')}  on your own machine`);
  console.log('\nCommit .fixlock/ and the generated files above so the whole team gets them.');
  console.log('Every developer runs once:  npm i -D @abinandhmj/fixlock' + (hooks.git ? '  &&  npx fixlock install-hook' : ''));
  console.log('Lock a fix:  npx fixlock mark <file> <start>-<end> -m "why" --issue linear:ENG-12');
}

function cmdTeam(args) {
  const cfg = s.loadConfig();
  const sub = args._[0] || 'list';
  if (sub === 'add') {
    if (!args.name) throw new Error('Usage: fixlock team add --name "Abi" --github abinandhmj --email abi@x.com --role lead|developer|reviewer');
    const m = { name: args.name, github: args.github ? String(args.github).replace(/^@/, '') : null,
      emails: String(args.email || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean), role: args.role || 'developer' };
    cfg.team = cfg.team.filter((x) => !(m.github && x.github === m.github) && x.name !== m.name);
    cfg.team.push(m);
    s.saveConfig(cfg);
    console.log(c.green(`✔ ${m.name} added as ${m.role}`));
  } else if (sub === 'remove') {
    const who = args._[1];
    const before = cfg.team.length;
    cfg.team = cfg.team.filter((m) => m !== team.find(cfg, who));
    if (cfg.team.length === before) throw new Error(`No team member "${who}"`);
    s.saveConfig(cfg);
    console.log(c.green(`✔ removed ${who}`));
  } else {
    if (!cfg.team.length) return console.log('No team members yet. Run: fixlock init');
    for (const m of cfg.team) console.log(`${c.bold(m.name.padEnd(18))} ${m.role.padEnd(10)} ${team.handle(m).padEnd(18)} ${c.dim(m.emails.join(', '))}`);
  }
}

/* ---------------- mark / list / remove / why ---------------- */
async function cmdMark(args) {
  const [file, range] = args._;
  if (!file || !range) throw new Error('Usage: fixlock mark <file> <start>[-<end>] -m "why" [--type bug|feature] [--title ".."] [--issue linear:ENG-12] [--owner github] [--test spec]');
  const [start, end = start] = range.split('-').map((n) => parseInt(n, 10));
  const rel = L.toPosix(path.relative(s.root(), path.resolve(file)));
  const abs = path.join(s.root(), rel);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${file}`);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  if (!(start >= 1 && end <= lines.length && start <= end)) throw new Error(`Line range ${range} is outside ${rel} (1-${lines.length})`);
  const snippet = lines.slice(start - 1, end).map((l) => l.replace(/\r$/, '')).filter((l) => !L.trivial(l));
  if (!snippet.length) throw new Error('Selected lines are all blank/braces — pick the lines that hold the fix.');

  const cfg = s.loadConfig();
  const type = args.type === 'feature' ? 'feature' : 'bug';
  const me = team.current(cfg);
  const owner = args.owner ? team.find(cfg, args.owner) : me;
  if (args.owner && !owner) throw new Error(`Owner "${args.owner}" is not in the team. Add them: fixlock team add …`);
  const reg = s.loadRegistry();
  const lock = {
    id: s.nextId(reg, type), type, title: args.title || args.m || 'Untitled', reason: args.m || '',
    file: rel, snippet, owner: owner.github || owner.name, issue: args.issue || null, test: args.test || null,
    date: new Date().toISOString().slice(0, 10),
  };
  reg.locks.push(lock);
  s.saveRegistry(reg);
  console.log(c.green(`✔ ${lock.id} locked`) + ` — ${rel}:${start}-${end}, owner ${team.handle(owner)}, policy ${cfg.policies[type].onEdit}/${cfg.policies[type].approval}`);
  syncAgentFiles(true);
  if (fs.existsSync(path.join(s.root(), '.github', 'CODEOWNERS'))) writeCodeowners(true);
  if (lock.issue && !args['no-sync']) {
    const r = await trackers.sync(cfg, lock, 'fixed');
    if (r) console.log(c.dim(`  tracker: ${r}`));
  }
}

function cmdList() {
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  if (!reg.locks.length) return console.log('Nothing locked yet.');
  for (const l of reg.locks) {
    console.log(`${c.bold(l.id.padEnd(9))} ${l.type === 'feature' ? c.cyan('feature') : c.yellow('bug    ')}  ${l.title}`);
    console.log(c.dim(`          ${l.file} · owner ${team.handle(team.find(cfg, l.owner)) || l.owner}${l.issue ? ' · ' + l.issue : ''}${l.test ? ' · test ' + l.test : ''}`));
  }
}

function cmdRemove(args) {
  const id = args._[0];
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const lock = reg.locks.find((l) => l.id === id);
  if (!lock) throw new Error(`No lock with id ${id}`);
  const me = team.current(cfg);
  if (!team.exempt(cfg, lock, me) && !args.force) {
    throw new Error(`${id} belongs to ${team.approvers(cfg, lock).map(team.handle).join(' / ')}. Ask them to remove it (or use --force; CI will still ask for their approval).`);
  }
  reg.locks = reg.locks.filter((l) => l.id !== id);
  s.saveRegistry(reg);
  console.log(c.green(`✔ ${id} unlocked`));
  syncAgentFiles(true);
}

/** fixlock why <file>[:line] — what is locked here and who owns it. */
function cmdWhy(args) {
  const target = args._[0];
  if (!target) throw new Error('Usage: fixlock why <file>[:line[-line]]');
  const m = target.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
  const rel = L.toPosix(path.relative(s.root(), path.resolve(m[1])));
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const abs = path.join(s.root(), rel);
  const lines = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n') : [];
  const from = m[2] ? +m[2] : 1; const to = m[3] ? +m[3] : (m[2] ? +m[2] : Infinity);
  const hits = reg.locks.filter((l) => l.file === rel).map((l) => ({ l, at: L.locate(l, lines) }))
    .filter(({ at }) => at.some((n) => n >= from && n <= to));
  if (!hits.length) return console.log(c.green(`✔ nothing locked in ${rel}${m[2] ? ':' + m[2] + (m[3] ? '-' + m[3] : '') : ''}`));
  const me = team.current(cfg);
  for (const { l, at } of hits) {
    const pol = cfg.policies[l.type] || cfg.policies.bug;
    console.log(`${c.yellow('🔒 ' + l.id)} ${l.title}  (${l.type}, owner ${team.handle(team.find(cfg, l.owner)) || l.owner})`);
    console.log(`   lines ${at.length ? Math.min(...at) + '-' + Math.max(...at) : '?'}${l.reason && l.reason !== l.title ? ' · why: ' + l.reason : ''}`);
    console.log(c.dim(`   ${team.exempt(cfg, l, me) ? 'you can change this (you are an approver)' : `policy: ${pol.onEdit}; approval: ${team.approvers(cfg, l).map(team.handle).join(' or ') || 'none'}`}`));
  }
}

/* ---------------- check ---------------- */
function contentGetter(staged) {
  return (file) => {
    if (staged) return g.git(['show', `:${file}`], { allowFail: true });
    const abs = path.join(s.root(), file);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };
}

function prAuthor() {
  if (process.env.CHANGE_AUTHOR) return process.env.CHANGE_AUTHOR;
  if (process.env.GITHUB_EVENT_PATH) {
    try { return JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request.user.login; } catch { /* */ }
  }
  return null;
}

async function cmdCheck(args) {
  const staged = !!args.staged;
  const base = args.base || process.env.FIXLOCK_BASE || 'origin/main';
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const read = contentGetter(staged);
  const findings = [];

  // Renames between base and HEAD: follow the file.
  const renames = {};
  if (!staged) { try { for (const ch of g.changedFiles(base)) if (ch.status === 'R') renames[ch.from] = ch.file; } catch { /* no base */ } }

  for (const lock of reg.locks) {
    const target = renames[lock.file] || lock.file;
    const content = read(target);
    const missing = content === null ? lock.snippet : L.missingLines(lock, content);
    if (missing.length) findings.push({ kind: 'lock', lock, file: target, missing, deleted: content === null });
  }

  // Changes inside protected paths: warnings only.
  if (!staged && cfg.protectedPaths.length) {
    try {
      for (const ch of g.changedFiles(base)) {
        const hit = cfg.protectedPaths.find((pp) => ch.file.startsWith(pp) || ch.from.startsWith(pp));
        if (hit) findings.push({ kind: 'path', file: ch.file, msg: `${ch.file} changed (protected path ${hit})` });
      }
    } catch { /* no base */ }
  }

  // Working-code guard: committed lines by others (or your own older ones) deleted/rewritten. Warning only.
  const sc = cfg.stableCode || {};
  if (sc.enabled !== false) {
    try {
      const me = team.current(cfg);
      const ref = staged ? 'HEAD' : g.git(['merge-base', base, 'HEAD']).trim();
      const changed = staged
        ? (g.git(['diff', '--cached', '--name-only', '--diff-filter=MR']) || '').split('\n').filter(Boolean)
        : g.changedFiles(base).filter((ch) => ch.status === 'M' || ch.status === 'R').map((ch) => ch.file);
      const lockedText = new Set(reg.locks.flatMap((l) => l.snippet.map(L.norm)));
      for (const file of changed) {
        const before = g.fileAtRef(ref, file); const after = read(file);
        if (before === null || after === null) continue;
        const removed = stable.removedLines(before, after).filter((r) => !lockedText.has(L.norm(r.text)));
        if (removed.length < (sc.minLines || 1)) continue;
        const who = staged ? me : { emails: [] }; // in CI every author's older work counts
        const found = stable.stableRemovals(removed, g.blameFull(ref, file), who, sc);
        if (found.length >= (sc.minLines || 1)) {
          const sum = stable.summarize(cfg, found, team);
          findings.push({ kind: 'stable', file, sum, msg: `${file} — ${sum.count} existing working line(s) rewritten (by ${sum.authors.join(', ')})` });
        }
      }
    } catch { /* no base */ }
  }

  // Approvals: owner / lead approval on the PR clears a lock finding.
  const needApproval = findings.filter((f) => f.kind === 'lock' && (cfg.policies[f.lock.type] || cfg.policies.bug).approval !== 'none');
  let appr = { approvers: new Set(), source: 'none' };
  if (!staged && needApproval.length) appr = await prApprovers(args.pr);
  const author = staged ? '' : (prAuthor() || '').toLowerCase(); // no PR exists yet at commit time
  for (const f of findings.filter((x) => x.kind === 'lock')) {
    const pol = cfg.policies[f.lock.type] || cfg.policies.bug;
    f.approvers = team.approvers(cfg, f.lock);
    const gh = f.approvers.map((a) => (a.github || '').toLowerCase()).filter(Boolean);
    if (pol.approval === 'none') f.status = 'warn';
    else if (gh.some((u) => appr.approvers.has(u))) f.status = 'approved';
    else if (author && gh.includes(author)) f.status = 'approved';
    else f.status = 'blocked';
  }
  const blocking = findings.filter((f) => f.status === 'blocked');

  // Tracker: reopen the linked issue for each blocked regression.
  if (args.notify && blocking.length) {
    const ctx = { pr: require('./approvals').prNumber(args.pr), branch: (g.git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) || '').trim(), author: author || undefined };
    for (const f of blocking) { const r = await trackers.sync(cfg, f.lock, 'regression', ctx); if (r) f.tracker = r; }
  }

  if (args.json) console.log(JSON.stringify({ base, staged, ok: !blocking.length, approvals: appr.source, findings: findings.map(({ lock, approvers, ...f }) => ({ ...f, lock: lock && lock.id, approvers: approvers && approvers.map(team.handle) })) }, null, 2));
  else report(cfg, reg, findings, { base, staged, appr });
  if (args.markdown) fs.writeFileSync(args.markdown, toMarkdown(cfg, findings, base));
  process.exitCode = blocking.length && !staged ? 1 : (blocking.length && args.strict ? 1 : 0);
}

function report(cfg, reg, findings, { base, staged, appr }) {
  console.log(c.bold(`fixlock check  (${staged ? 'staged changes' : 'base ' + base}, ${reg.locks.length} locks)\n`));
  if (!findings.length) return console.log(c.green('✔ Clean — every locked fix and feature is intact, no working code rewritten.'));
  if (appr.error) console.log(c.yellow(`! Could not read PR approvals: ${appr.error}\n`));
  for (const f of findings) {
    if (f.kind === 'path') { console.log(`${c.yellow('PATH')}  ${f.msg}`); continue; }
    if (f.kind === 'stable') { console.log(`${c.yellow('REWRITE')}  ${f.msg}`); f.sum.sample.forEach((l) => console.log(c.dim(`    - ${l}`))); continue; }
    const owner = team.handle(team.find(cfg, f.lock.owner)) || f.lock.owner;
    const tag = { blocked: c.red('LOCKED'), approved: c.green('APPROVED'), warn: c.yellow('WARNING') }[f.status];
    console.log(`${tag}  ${f.lock.id} "${f.lock.title}" (${f.lock.type}, owner ${owner}) — ${f.deleted ? 'file deleted: ' : ''}${f.file}`);
    if (f.lock.reason && f.lock.reason !== f.lock.title) console.log(c.dim(`    why: ${f.lock.reason}`));
    for (const l of f.missing) console.log(c.dim(`    - ${l.trim()}`));
    if (f.status === 'blocked') console.log(`    → needs approval from ${f.approvers.map(team.handle).join(' or ')}${staged ? ' when you open the PR' : ' on the PR'}, or restore these lines.`);
    if (f.tracker) console.log(c.dim(`    tracker: ${f.tracker}`));
  }
  const b = findings.filter((f) => f.status === 'blocked').length;
  if (b && !staged) console.log(c.red(`\n✖ ${b} locked change(s) without approval.`));
  if (b && staged) console.log(c.yellow(`\n! Heads up: ${b} locked change(s). The commit is allowed, but CI will ask for approval.`));
  if (findings.some((f) => f.kind === 'stable')) console.log(c.yellow(`${b ? '' : '\n'}! Existing working code is being rewritten — make sure that was intended and the team knows.`));
}

function toMarkdown(cfg, findings, base) {
  if (!findings.length) return `### ✅ fixlock\nEvery locked fix and feature is intact (base \`${base}\`).\n`;
  const blocked = findings.filter((f) => f.status === 'blocked');
  let md = `### ${blocked.length ? '🔒' : '⚠️'} fixlock: ${blocked.length ? `${blocked.length} locked change(s) need approval` : 'review notes'}\n\n`;
  for (const f of findings) {
    if (f.kind === 'path') { md += `- ⚠️ ${f.msg}\n`; continue; }
    if (f.kind === 'stable') { md += `- ⚠️ **Rewrite of working code:** ${f.msg}. Check this was intended.\n`; continue; }
    const icon = { blocked: '❌', approved: '✅', warn: '⚠️' }[f.status];
    md += `- ${icon} **${f.lock.id}** ${f.lock.title} (${f.lock.type}) — \`${f.file}\`\n`;
    if (f.lock.reason && f.lock.reason !== f.lock.title) md += `  - Why it exists: ${f.lock.reason}\n`;
    md += `  - Removed/rewritten: ${f.missing.map((l) => '`' + l.trim().replace(/`/g, "'") + '`').join(', ')}\n`;
    if (f.status === 'blocked') md += `  - **Approve this PR as ${f.approvers.map(team.handle).join(' or ')}** to accept the change, or restore the lines.\n`;
    if (f.tracker) md += `  - Tracker: ${f.tracker}\n`;
  }
  return md;
}

/* ---------------- setup (AI assistants) ---------------- */
function cmdSetup(args) {
  const names = args._.length ? args._ : null;
  if (!names) {
    const T = require('./setup').TARGETS;
    console.log(c.bold('Connect an AI assistant to fixlock:\n'));
    for (const [id, t] of Object.entries(T)) console.log(`  npx fixlock setup ${id.padEnd(12)} ${t.label}${t.scope === 'user' ? c.dim('  (writes your user config)') : ''}`);
    console.log(`  npx fixlock setup all          every project-level one above`);
    return;
  }
  if (!s.configExists()) throw new Error('fixlock is not set up in this repo yet. Run: npx fixlock init');
  const { results, cmd } = require('./setup').setup(names, { includeUser: !!args.user });
  for (const r of results) {
    console.log(c.green(`✔ ${r.label}`));
    for (const f of r.files) console.log(c.dim(`    ${f.status.padEnd(9)} ${path.relative(process.cwd(), f.file) || f.file}${f.note ? '  — ' + f.note : ''}`));
  }
  syncAgentFiles(true);
  console.log(`\nServer command: ${cmd.command} ${cmd.args.join(' ')}`);
  console.log('Restart the assistant (or reload its MCP servers), then ask it: "use fixlock_why on <file>".');
  if (results.some((r) => r.scope === 'project')) console.log('Commit the generated config files so the whole team gets them.');
}

/* ---------------- autolock ---------------- */
async function cmdAutolock(args) {
  const cfg = s.loadConfig();
  if (cfg.autoLock && cfg.autoLock.enabled === false && !args.force) return;
  const reg = s.loadRegistry();
  const sel = args.all ? { all: true, max: args.max ? +args.max : 300 } : args.since ? { since: args.since } : { commit: args.commit || 'HEAD' };
  const commits = auto.listCommits(sel, cfg);
  if (!commits.length) { if (!args.quiet) console.log('No fix/feature commits to lock.'); return; }
  const { out, skipped } = auto.candidates(commits, cfg, reg);
  if (args['dry-run']) {
    console.log(c.bold(`Would lock ${out.length} block(s) from ${commits.length} commit(s):\n`));
    for (const cd of out) console.log(`  ${cd.type === 'feature' ? c.cyan('feature') : c.yellow('bug    ')}  ${cd.file}:${cd.start}-${cd.end}  ${c.dim(cd.commit.sha.slice(0, 7) + ' ' + cd.commit.subject)}`);
    skipped.forEach((x) => console.log(c.dim(`  skipped ${x}`)));
    return;
  }
  const locks = auto.toLocks(out, cfg, reg);
  if (!locks.length) { if (!args.quiet) console.log('Nothing new to lock (already locked).'); skipped.forEach((x) => console.log(c.dim(`  skipped ${x}`))); return; }
  s.saveRegistry(reg);
  for (const l of locks) console.log(c.green(`🔒 ${l.id} auto-locked`) + ` — ${l.file} (${l.snippet.length} lines) · ${l.title}${l.issue ? ' · ' + l.issue : ''}`);
  skipped.forEach((x) => console.log(c.dim(`  skipped ${x}`)));
  const written = syncAgentFiles(true) || [];
  if (fs.existsSync(path.join(s.root(), '.github', 'CODEOWNERS'))) { writeCodeowners(true); written.push('.github/CODEOWNERS'); }
  if (!args['no-sync']) for (const l of locks.filter((x) => x.issue)) { const r = await trackers.sync(cfg, l, 'fixed'); if (r) console.log(c.dim(`  tracker: ${r}`)); }
  if (args['commit-result']) {
    const files = ['.fixlock', ...written].filter((f) => fs.existsSync(path.join(s.root(), f)));
    g.git(['add', '--', ...files]);
    g.git(['commit', '--no-verify', '-q', '-m', `chore(fixlock): lock ${locks.map((l) => l.id).join(', ')}`], { env: { ...process.env, FIXLOCK_IN_HOOK: '1' } });
    console.log(c.dim(`  committed: chore(fixlock): lock ${locks.map((l) => l.id).join(', ')}`));
  }
}

/* ---------------- AI tool files / changelog / codeowners ---------------- */
function syncAgentFiles(quiet) {
  const cfg = s.loadConfig();
  const { written, notes } = agents.sync(cfg);
  if (cfg.changelog !== false) { changelog.update(); written.push('CHANGELOG.md'); }
  if (quiet) console.log(c.dim(`  synced ${written.join(', ')}`));
  else written.forEach((f) => console.log(c.green(`✔ ${f}`)));
  notes.forEach((n) => console.log(c.yellow(`! ${n}`)));
  return written;
}

function cmdTools(args) {
  const cfg = s.loadConfig();
  const sub = args._[0] || 'list';
  const on = new Set(agents.enabled(cfg));
  if (sub === 'add' || sub === 'remove') {
    const ids = args._.slice(1);
    if (!ids.length) throw new Error(`Usage: fixlock tools ${sub} <id> [id…]   (ids: ${agents.TOOLS.map((t) => t.id).join(', ')})`);
    for (const id of ids) { if (!agents.byId(id)) throw new Error(`Unknown tool "${id}". Known: ${agents.TOOLS.map((t) => t.id).join(', ')}`); sub === 'add' ? on.add(id) : on.delete(id); }
    cfg.aiTools = [...on]; s.saveConfig(cfg);
    console.log(c.green(`✔ AI tools: ${cfg.aiTools.join(', ') || '(none)'}`));
    return syncAgentFiles(false);
  }
  const found = Object.fromEntries(agents.detect().map((d) => [d.id, d.where]));
  console.log(c.bold('AI coding tools\n'));
  for (const t of agents.TOOLS) {
    const mark = on.has(t.id) ? c.green('● on   ') : found[t.id] ? c.yellow('○ found') : c.dim('○      ');
    console.log(`${mark}  ${t.id.padEnd(12)} ${t.label.padEnd(42)} ${c.dim(t.files.map((f) => f.path).join(', '))}`);
    if (found[t.id]) console.log(c.dim(`                       detected: ${found[t.id].join('; ')}`));
  }
  const missing = Object.keys(found).filter((id) => !on.has(id));
  if (missing.length) console.log(c.yellow(`\nFound on this machine/repo but not enabled: ${missing.join(', ')}\n→ npx fixlock tools add ${missing.join(' ')}`));
}

function writeCodeowners(quiet) {
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const byFile = {};
  for (const l of reg.locks) {
    const set = (byFile[l.file] = byFile[l.file] || new Set());
    team.approvers(cfg, l).filter((a) => a.github).forEach((a) => set.add('@' + a.github));
  }
  const start = '# fixlock:start (generated — run `fixlock codeowners` to update)';
  const end = '# fixlock:end';
  const block = [start, ...Object.entries(byFile).filter(([, o]) => o.size).map(([f, o]) => `/${f} ${[...o].join(' ')}`), end].join('\n');
  const file = path.join(s.root(), '.github', 'CODEOWNERS');
  let body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end}`);
  body = re.test(body) ? body.replace(re, block) : (body.trimEnd() + '\n\n' + block + '\n').trimStart();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  if (!quiet) console.log(c.green('✔ .github/CODEOWNERS updated'));
}

module.exports = {
  init: cmdInit, team: cmdTeam, mark: cmdMark, list: cmdList, remove: cmdRemove, why: cmdWhy, check: cmdCheck,
  sync: () => syncAgentFiles(false),
  tools: cmdTools,
  autolock: cmdAutolock,
  detect: () => cmdTools({ _: ['list'] }),
  changelog: () => { console.log(c.green(`✔ ${path.relative(process.cwd(), changelog.update()) || 'CHANGELOG.md'} updated`)); },
  release: (args) => { const r = changelog.release(args._[0]); syncAgentFiles(true); console.log(c.green(`✔ ${r.version} (${r.date}) written to CHANGELOG.md`) + c.dim('  — commit it, then tag: git tag v' + r.version.replace(/^v/, ''))); },
  codeowners: () => writeCodeowners(false),
  'install-hook': () => { init.installGitHook(); console.log(c.green('✔ pre-commit warning hook installed')); },
  'install-claude-hook': () => { init.installClaudeHook(); console.log(c.green('✔ Claude Code hook added to .claude/settings.json')); },
  setup: cmdSetup,
  mcp: () => require('./mcp').serve(),
  hook: (args) => { if (args._[0] !== 'claude') throw new Error('Usage: fixlock hook claude'); require('./hook').run(); },
};
