'use strict';
const fs = require('fs');
const path = require('path');
const g = require('./git');
const s = require('./store');
const team = require('./team');
const L = require('./locks');
const E = require('./evaluate');
const init = require('./init');
const trackers = require('./trackers');
const { prApprovers } = require('./approvals');
const agents = require('./agents');
const changelog = require('./changelog');
const auto = require('./autolock');
const stable = require('./stable');
const discovery = require('./discover');
const cli = require('./cli');
const tests = require('./tests');

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (t) => (tty ? `\x1b[${code}m${t}\x1b[0m` : t);
const c = { red: paint(31), green: paint(32), yellow: paint(33), bold: paint(1), dim: paint(2), cyan: paint(36) };

/* ---------------- init / team ---------------- */
async function cmdInit(args) {
  const log = args.quiet ? () => {} : console.log; // quickstart prints its own summary
  const cfg = s.loadConfig();
  const useDefaults = args.yes || (!process.stdin.isTTY && !args.interactive);
  const hooks = useDefaults ? init.defaults(cfg) : await init.interactive(cfg);
  if (args['no-git-hooks']) hooks.git = false; // CI, scripted setups
  if (!cfg.launcher && cli.defaultLauncher(s.root())) cfg.launcher = cli.defaultLauncher(s.root()); // pip/pipx/binary install
  s.saveConfig(cfg);
  s.saveRegistry(s.loadRegistry());
  if (hooks.claude) init.installClaudeHook();
  // Pre-edit hooks for the other agents the team uses (project files, so they apply to every teammate).
  if (hooks.claude && agents.enabled(cfg).includes('cursor')) init.installCursorHook();
  if (hooks.claude && agents.enabled(cfg).includes('windsurf')) init.installWindsurfHook();
  if (hooks.git) init.installGitHook();
  if (hooks.codeowners) writeCodeowners(true);
  let mcpDone = [];
  if (hooks.mcp) {
    const project = ['claude-code', 'cursor', 'copilot', 'gemini'].filter((id) => agents.enabled(cfg).includes(id));
    if (project.length) mcpDone = require('./setup').setup(project).results;
  }
  syncAgentFiles(args.quiet ? 'silent' : true);
  log(c.green('\n✔ fixlock is set up.'));
  log(`  team: ${cfg.team.map((m) => `${m.name} (${m.role})`).join(', ') || '(none)'}`);
  log(`  AI tools: ${agents.enabled(cfg).join(', ') || '(none)'}`);
  if (hooks.claude) log('  Claude Code hook: .claude/settings.json');
  if (mcpDone.length) log(`  MCP server connected for: ${mcpDone.map((r) => r.label).join(', ')}`);
  const userLevel = ['codex', 'windsurf'].filter((id) => agents.enabled(cfg).includes(id));
  if (hooks.mcp && userLevel.length) log(`  ${userLevel.join(' / ')} users: run  ${cli.human(s.root())} setup ${userLevel.join(' ')}  on your own machine`);
  if (hooks.git) log('  git hooks: commit warning + auto-lock of fix:/feat: commits (this machine)');
  const noGithub = cfg.team.filter((m) => !m.github && m.role !== 'reviewer');
  if (noGithub.length) {
    log(c.yellow(`\n! No GitHub username for ${noGithub.map((m) => m.name).join(', ')}. Pull requests need their approval to change a lock they own,`));
    log(c.yellow('  and GitHub approvals are matched by username. Add it:'));
    for (const m of noGithub) log(c.yellow(`    ${cli.human(s.root())} team add --name "${m.name}" --github <username>${m.emails[0] ? ` --email ${m.emails[0]}` : ''} --role ${m.role}`));
  }
  log('\nCommit .fixlock/ and the generated files above so the whole team gets them.');
  const run = cli.human(s.root());
  if (cfg.launcher === 'fixlock') log(`Every developer installs the fixlock command once:  pipx install fixlock  (or uv tool install fixlock)${hooks.git ? '  &&  fixlock install-hook' : ''}`);
  else if (fs.existsSync(path.join(s.root(), 'package.json'))) log(`Every developer runs once:  ${cli.installedIn(s.root()) ? 'npm install' : 'npm i -D @abinandhmj/fixlock'}${hooks.git ? '  &&  npx fixlock install-hook' : ''}`);
  else log(`Nothing to install: hooks and assistants run fixlock through npx (Node.js 18+).${hooks.git ? `  Each developer runs once:  ${run} install-hook` : ''}`);
  log(`Find the fixes you already have:  ${run} discover`);
  log(`Lock a fix:  ${run} mark <file> <start>-<end> -m "why" --issue linear:ENG-12`);
}

function cmdTeam(args) {
  const cfg = s.loadConfig();
  const sub = args._[0] || 'list';
  if (sub === 'add') {
    if (!args.name) throw new Error('Usage: fixlock team add --name "Abi" --github abinandhmj --email abi@x.com --role lead|developer|reviewer');
    const m = { name: args.name, github: args.github ? String(args.github).replace(/^@/, '') : null,
      ...(args.gitlab ? { gitlab: String(args.gitlab).replace(/^@/, '') } : {}),
      ...(args.bitbucket ? { bitbucket: String(args.bitbucket).replace(/^@/, '') } : {}),
      ...(args.slack ? { slack: String(args.slack) } : {}),
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
  if (!file || !range) throw new Error('Usage: fixlock mark <file> <start>[-<end>] -m "why" [--type bug|feature] [--title ".."] [--issue linear:ENG-12] [--owner github] [--test spec] [--expires YYYY-MM-DD]');
  const [start, end = start] = range.split('-').map((n) => parseInt(n, 10));
  const rel = L.repoRel(s.root(), file);
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
  if (args.expires) lock.expires = isoDate(args.expires);
  if (lock.test && !fs.existsSync(path.join(s.root(), L.repoRel(s.root(), lock.test)))) throw new Error(`Test file not found: ${lock.test}`);
  if (lock.test) lock.test = L.repoRel(s.root(), lock.test);
  L.withCopies(lock, lines.join('\n'));
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
/* ---------------- test-linked locks ---------------- */
const isoDate = (d) => {
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(String(d || '').trim());
  if (!m || isNaN(Date.parse(m[0]))) throw new Error(`Dates are YYYY-MM-DD, such as 2027-06-30 (got "${d}")`);
  return m[0];
};
const findLock = (reg, id) => {
  const lock = reg.locks.find((l) => l.id.toLowerCase() === String(id || '').toLowerCase());
  if (!lock) throw new Error(`No lock ${id || '(give an id, such as FIX-001)'}. See: fixlock list`);
  return lock;
};

/** fixlock link <id> <test file> | --remove: the test that proves a lock's fix. */
function cmdLink(args) {
  const [id, test] = args._;
  const reg = s.loadRegistry();
  const lock = findLock(reg, id);
  if (args.remove) { delete lock.test; s.saveRegistry(reg); return console.log(c.green(`✔ ${lock.id} has no linked test now`)); }
  if (!test) throw new Error('Usage: fixlock link <id> <test file>   (or --remove)');
  const rel = L.repoRel(s.root(), path.resolve(process.cwd(), test));
  if (!fs.existsSync(path.join(s.root(), rel))) throw new Error(`Test file not found: ${test}`);
  lock.test = rel;
  s.saveRegistry(reg);
  const cmd = tests.commandFor(s.root(), s.loadConfig(), rel);
  console.log(c.green(`✔ ${lock.id} is proved by ${rel}`) + c.dim(cmd ? `  (runs: ${tests.fill(cmd, [rel])})` : '  (fixlock does not know how to run it: set tests.commands in .fixlock/config.json)'));
  console.log(c.dim(`When ${lock.id}'s lines change, "fixlock check --run-tests" runs it; if it still passes, the change needs no approval.`));
}

/** fixlock test [id…]: run the linked tests, so every locked fix is proved, not just present. */
function cmdTest(args) {
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const locks = args._.length ? args._.map((id) => findLock(reg, id)) : reg.locks;
  const withTests = locks.filter((l) => l.test);
  const without = locks.filter((l) => !l.test);
  if (!withTests.length) {
    console.log(`No lock has a linked test yet. Link one: ${cli.human(s.root())} link FIX-001 tests/test_refund.py`);
    return;
  }
  const results = tests.run(s.root(), cfg, withTests.map((l) => l.test), { log: (cmd) => { if (!args.json) console.log(c.dim(`$ ${cmd}`)); } });
  if (args.json) console.log(JSON.stringify(withTests.map((l) => ({ id: l.id, test: l.test, ...results[l.test] })), null, 2));
  else {
    console.log('');
    for (const l of withTests) {
      const r = results[l.test];
      const mark = r.status === 'passed' ? c.green('✔') : r.status === 'failed' ? c.red('✖') : c.yellow('!');
      console.log(`${mark} ${c.bold(l.id)} ${l.title}  ${c.dim(`${l.test}: ${r.status}`)}`);
      if (r.status !== 'passed' && r.output) r.output.split('\n').slice(-6).forEach((x) => console.log(c.dim(`    ${x}`)));
    }
    if (without.length) console.log(c.dim(`\n${without.length} lock(s) have no test: ${without.slice(0, 6).map((l) => l.id).join(', ')}${without.length > 6 ? ', …' : ''}. Link one with: fixlock link <id> <test file>`));
  }
  if (withTests.some((l) => results[l.test].status !== 'passed')) process.exitCode = 1;
}

/* ---------------- lock lifecycle ---------------- */

/**
 * fixlock relock <id…> | --changed [--lines a-b] [-m "why"]: after an approved change, lock the lines that
 * now hold the fix. Without --lines, fixlock takes the stretch of the file between the first and last
 * locked lines it can still find. The old lines are kept in the lock's history.
 */
function cmdRelock(args) {
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const root = s.root();
  const me = team.current(cfg) || {};
  const maxLines = Math.max(40, (cfg.autoLock || {}).maxLines || 40);
  const all = !!(args.changed || args.all);
  const ids = all ? reg.locks.map((l) => l.id) : args._;
  if (!ids.length) throw new Error('Usage: fixlock relock <id…> [--lines 12-18] [-m "why"]   or   fixlock relock --changed');
  if (args.lines && ids.length !== 1) throw new Error('--lines works with one lock at a time.');
  const done = [];
  const skipped = [];
  for (const id of ids) {
    const lock = findLock(reg, id);
    const abs = path.join(root, lock.file);
    const content = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (content === null) { skipped.push(`${lock.id}: ${lock.file} is gone. Lock its new place with fixlock mark, then fixlock remove ${lock.id}.`); continue; }
    const lines = content.split('\n').map((l) => l.replace(/\r$/, ''));
    const v = L.verifyLock(lock, content, { mode: (cfg.matching || {}).mode, file: lock.file });
    if (v.status === 'intact' && !args.lines) { if (!all) skipped.push(`${lock.id}: already intact, nothing to re-lock.`); continue; }
    let start;
    let end;
    if (args.lines) {
      [start, end = start] = String(args.lines).split('-').map((n) => parseInt(n, 10));
      if (!(start >= 1 && end <= lines.length && start <= end)) throw new Error(`--lines ${args.lines} is outside ${lock.file} (1-${lines.length})`);
    } else {
      const at = L.locate(lock, lines);
      if (!at.length) { skipped.push(`${lock.id}: none of its lines are left in ${lock.file}. Say where the fix is now: fixlock relock ${lock.id} --lines <start>-<end>`); continue; }
      [start, end] = [Math.min(...at), Math.max(...at)];
      // Line the old lock up with what's left: a changed first or last locked line sits just outside the
      // lines still found, so widen by as many locked lines as come before/after them.
      const n = lines.map(L.norm);
      const sn = lock.snippet.map(L.norm);
      const first = sn.indexOf(n[start - 1]);
      const last = sn.lastIndexOf(n[end - 1]);
      if (first > 0) start = Math.max(1, start - first);
      if (last >= 0) end = Math.min(lines.length, end + (sn.length - 1 - last));
      if (end - start + 1 > maxLines) { skipped.push(`${lock.id}: its lines are now spread over ${end - start + 1} lines. Say which hold the fix: fixlock relock ${lock.id} --lines <start>-<end>`); continue; }
    }
    const snippet = lines.slice(start - 1, end).filter((l) => !L.trivial(l));
    if (!snippet.length) { skipped.push(`${lock.id}: lines ${start}-${end} are blank.`); continue; }
    lock.history = [...(lock.history || []), { date: new Date().toISOString().slice(0, 10), snippet: lock.snippet, by: team.handle(me) || me.name || '', reason: args.m || 'relocked after an approved change' }].slice(-10);
    lock.snippet = snippet;
    delete lock.siblings;
    L.withCopies(lock, content);
    done.push(`${lock.id}  ${lock.file}:${start}-${end}  ${lock.title}`);
  }
  if (done.length) { s.saveRegistry(reg); syncAgentFiles(true); }
  for (const d of done) console.log(c.green(`✔ relocked ${d}`));
  for (const x of skipped) console.log(c.yellow(`! ${x}`));
  if (!done.length && !skipped.length) console.log(c.green('✔ Every lock is intact: nothing to re-lock.'));
  if (done.length) console.log(c.dim('Commit .fixlock/registry.json so CI guards the new lines.'));
}

/** fixlock handover <from> <to>: give someone's locks to a teammate (they're leaving, or moved team). */
function cmdHandover(args) {
  const [from, to] = args._;
  if (!from || !to) throw new Error('Usage: fixlock handover <from> <to>   (names, GitHub usernames or emails from the team)');
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const a = team.find(cfg, from);
  const b = team.find(cfg, to);
  if (!b) throw new Error(`"${to}" is not in the team. Add them first: fixlock team add --name "…" --github <username> --role developer`);
  if (a === b) throw new Error('Give the locks to someone else.');
  const same = (owner) => (a ? team.find(cfg, owner) === a : String(owner || '').toLowerCase().replace(/^@/, '') === String(from).toLowerCase().replace(/^@/, ''));
  const moved = reg.locks.filter((l) => same(l.owner));
  if (!moved.length) return console.log(`No locks are owned by ${from}.`);
  for (const l of moved) { l.previousOwners = [...(l.previousOwners || []), l.owner]; l.owner = b.github || b.name; }
  s.saveRegistry(reg);
  syncAgentFiles(true);
  if (fs.existsSync(path.join(s.root(), '.github', 'CODEOWNERS'))) writeCodeowners(true);
  console.log(c.green(`✔ ${moved.length} lock(s) handed over to ${team.handle(b)}: `) + moved.map((l) => l.id).join(', '));
  if (a && args.remove) {
    cfg.team = cfg.team.filter((m) => m !== a);
    s.saveConfig(cfg);
    console.log(c.green(`✔ removed ${a.name} from the team`));
  } else if (a) console.log(c.dim(`${a.name} is still on the team. To remove them too: fixlock handover ${from} ${to} --remove`));
}

/**
 * What needs a person's decision, in one list:
 *   expired        past its "expires" date (it only warns now)
 *   needs re-lock  its lines aren't in the file as locked (usually after an approved change)
 *   orphaned       its owner isn't on the team
 *   not reviewed   older than lifecycle.reviewAfterDays since it was made or last reviewed
 */
function reviewItems(cfg, reg, root, on = new Date()) {
  const day = on.toISOString().slice(0, 10);
  const after = (cfg.lifecycle || {}).reviewAfterDays;
  const out = [];
  for (const l of reg.locks) {
    const why = [];
    if (E.expired(l, day)) why.push(`expired on ${l.expires}`);
    const abs = path.join(root, l.file);
    const content = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (content === null) why.push(`its file ${l.file} is gone`);
    else if (L.verifyLock(l, content, { mode: (cfg.matching || {}).mode, file: l.file }).status === 'changed') why.push('needs re-lock (its lines changed)');
    if (l.owner && !team.find(cfg, l.owner)) why.push(`owner ${l.owner} isn't on the team`);
    const since = l.reviewed || l.date;
    if (after && since && (on - new Date(since)) / 864e5 > after) why.push(`not reviewed since ${since}`);
    if (why.length) out.push({ lock: l, why });
  }
  return out;
}

/** fixlock review: locks that need a decision. fixlock review <id> --keep [--expires DATE] | --remove settles one. */
function cmdReview(args) {
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const id = args._[0];
  if (id) {
    const lock = findLock(reg, id);
    if (args.remove) return cmdRemove({ ...args, _: [lock.id] });
    if (!args.keep && !args.expires) throw new Error(`Usage: fixlock review ${lock.id} --keep [--expires YYYY-MM-DD]   or   --remove`);
    lock.reviewed = new Date().toISOString().slice(0, 10);
    if (args.expires) lock.expires = isoDate(args.expires);
    else if (E.expired(lock)) delete lock.expires;
    s.saveRegistry(reg);
    return console.log(c.green(`✔ ${lock.id} reviewed and kept`) + c.dim(lock.expires ? ` (expires ${lock.expires})` : ''));
  }
  const items = reviewItems(cfg, reg, s.root());
  if (args.json) return console.log(JSON.stringify(items.map((x) => ({ id: x.lock.id, file: x.lock.file, title: x.lock.title, why: x.why })), null, 2));
  if (!items.length) return console.log(c.green(`✔ All ${reg.locks.length} locks are current: none expired, orphaned or out of date.`));
  console.log(c.bold(`${items.length} lock(s) need a decision\n`));
  for (const x of items) console.log(`${c.yellow('!')} ${c.bold(x.lock.id)} ${x.lock.title}  ${c.dim(x.lock.file)}\n    ${x.why.join('; ')}`);
  const run = cli.human(s.root());
  console.log(c.dim(`\nKeep one: ${run} review <id> --keep [--expires YYYY-MM-DD] · remove one: ${run} review <id> --remove\nRe-lock moved lines: ${run} relock --changed · give someone's locks away: ${run} handover <from> <to>`));
  if (args.strict) process.exitCode = 1;
}

/**
 * Machine-readable state of the locks, for editor plugins (JetBrains, and anything else that can't load
 * fixlock as a library): `fixlock status [file] [--stdin] --json`. With --stdin, the file's content is read
 * from standard input, so an editor can check unsaved changes. Same structural matching as `check`.
 */
function cmdStatus(args) {
  let root;
  try { root = s.root(); } catch { root = null; }
  const out = (o) => { if (args.json) process.stdout.write(JSON.stringify(o) + '\n'); return o; };
  if (!root || !s.configExists()) {
    if (args.json) return out({ version: 1, setUp: false, gitRepo: !!root });
    console.log(root ? 'fixlock is not set up in this repository. Run: fixlock quickstart' : 'Not a git repository.');
    return;
  }
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const only = args._[0] ? L.repoRel(root, path.resolve(process.cwd(), args._[0])) : null;
  const stdin = args.stdin && only ? fs.readFileSync(0, 'utf8') : null;
  const files = [...new Set(reg.locks.map((l) => l.file))].filter((f) => !only || f === only);
  const locks = [];
  for (const file of files) {
    const abs = path.join(root, file);
    const text = stdin !== null ? stdin : fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    const lines = text === null ? [] : text.split('\n');
    for (const lock of reg.locks.filter((l) => l.file === file)) {
      const v = L.verifyLock(lock, text, { mode: (cfg.matching || {}).mode, file });
      const at = text === null ? [] : L.locate(lock, lines);
      locks.push({
        id: lock.id, type: lock.type, title: lock.title, reason: lock.reason || '', file, issue: lock.issue || null, test: lock.test || null,
        owner: team.handle(team.find(cfg, lock.owner)) || lock.owner || '',
        approvers: team.approvers(cfg, lock).map(team.handle).filter(Boolean),
        policy: (cfg.policies[lock.type] || cfg.policies.bug || {}).onEdit || null,
        status: text === null ? 'missing' : v.status,
        range: at.length ? [Math.min(...at), Math.max(...at)] : null,
        renames: v.renames || [], missing: v.missing || [],
      });
    }
  }
  if (args.json) return out({ version: 1, setUp: true, root, project: cfg.project || null, locks });
  if (!locks.length) return console.log(only ? `No locks in ${only}.` : 'No locks yet. Run: fixlock discover');
  for (const l of locks) {
    const mark = l.status === 'intact' ? c.green('✔') : l.status === 'renamed' ? c.yellow('~') : c.red('✖');
    console.log(`${mark} ${c.bold(l.id)} ${l.file}${l.range ? `:${l.range[0]}-${l.range[1]}` : ''}  ${l.title}  ${c.dim(`${l.status} · owner ${l.owner}`)}`);
  }
}

function cmdWhy(args) {
  const target = args._[0];
  if (!target) throw new Error('Usage: fixlock why <file>[:line[-line]]');
  const m = target.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
  const rel = L.repoRel(s.root(), m[1]);
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
    console.log(`${c.yellow('LOCKED ' + l.id)} ${l.title}  (${l.type}, owner ${team.handle(team.find(cfg, l.owner)) || l.owner})`);
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

const gitlab = require('./gitlab');
const bitbucket = require('./bitbucket');
const rules = require('./rules');
const alerts = require('./alerts');

/** The GitHub Actions event payload, or null. */
function ghEvent() {
  try { return process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : null; } catch { return null; }
}

/** Where alerts point, and the previous fixlock comment (for alert state), on GitHub. */
async function githubPr() {
  const ev = ghEvent();
  const pr = ev && ev.pull_request;
  if (!pr) return null;
  const info = { number: `#${pr.number}`, title: pr.title || '', url: pr.html_url || '', author: pr.user ? `@${pr.user.login}` : '', merged: !!pr.merged, closed: ev.action === 'closed' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const slug = require('./approvals').repoSlug();
  info.previous = null;
  if (token && slug) {
    try {
      const api = process.env.FIXLOCK_GITHUB_API || 'https://api.github.com';
      const res = await fetch(`${api}/repos/${slug}/issues/${pr.number}/comments?per_page=100`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fixlock' } });
      if (res.ok) { const mine = (await res.json()).filter((cm) => alerts.readState(cm.body)); if (mine.length) info.previous = mine[mine.length - 1].body; }
    } catch { /* no previous state: alert as on a first run */ }
  }
  return info;
}

/** Files changed by AI-written commits since base: Map file → Set of agent ids (see rules.agentOf). */
function aiAuthorship(base) {
  const out = new Map();
  let raw = '';
  try { raw = g.git(['log', `${base}..HEAD`, '--no-merges', '--name-only', '--format=%x1e%an%x1f%ae%x1f%B%x1f']); } catch { return out; }
  for (const chunk of raw.split('\x1e').filter((x) => x.trim())) {
    const [authorName, authorEmail, body, files = ''] = chunk.split('\x1f');
    const agent = rules.agentOf({ authorName, authorEmail, body });
    if (!agent) continue;
    for (const f of files.split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (!out.has(f)) out.set(f, new Set());
      out.get(f).add(agent);
    }
  }
  return out;
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
  // Code host for approvals and the PR comment when not on GitHub: GitLab or Bitbucket pipelines.
  const hostMod = staged ? null : gitlab.context() ? gitlab : bitbucket.context() ? bitbucket : null;
  const gl = hostMod ? hostMod.context() : null;
  const wantAlerts = !staged && (args.alert || (s.loadConfig().alerts || {}).enabled) && alerts.configured();
  const pr = wantAlerts ? (gl ? { previous: await hostMod.previousBody(gl), ...hostMod.prInfo(gl) } : await githubPr()) : null;
  // A PR was just closed: if it was merged while fixlock still blocked it, say so. Nothing else to check.
  if (pr && pr.closed) {
    const prev = alerts.readState(pr.previous) || {};
    const left = Object.keys(prev).filter((k) => !k.includes('#') && prev[k] === 'blocked');
    if (pr.merged && left.length) {
      const sent = await alerts.send(left.map((k) => ({ type: 'merged-blocked', key: k })), pr, s.loadConfig(), team);
      if (!args.json) console.log(`fixlock: ${pr.number} was merged while ${left.join(', ')} still needed approval.${sent.length ? ` Alerted: ${sent.map((x) => x.to + (x.ok ? '' : ` (failed: ${x.error})`)).join(', ')}.` : ''}`);
    }
    return;
  }
  const base = args.base || process.env.FIXLOCK_BASE || (gl && process.env[hostMod.baseVar] ? `origin/${process.env[hostMod.baseVar]}` : 'origin/main');
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const read = contentGetter(staged);
  const findings = [];

  // Renames between base and HEAD: follow the file.
  const renames = {};
  if (!staged) { try { for (const ch of g.changedFiles(base)) if (ch.status === 'R') renames[ch.from] = ch.file; } catch { /* no base */ } }

  // Locks that don't record their look-alike siblings: count them in the base version of the file.
  const goodRef = staged ? 'HEAD' : base;
  const good = (file) => g.git(['show', `${goodRef}:${file}`], { allowFail: true });
  findings.push(...await E.lockFindings(cfg, reg, { read, good, renames }));

  // Rules (policy as code): changes under a rule's paths need a lead's (or its approvers') approval;
  // "aiOnly" rules only count files changed by AI-written commits (author / Co-authored-by trailers).
  if (!staged && (cfg.rules || []).length) {
    try {
      const changes = g.changedFiles(base);
      findings.push(...rules.ruleFindings(cfg, changes, { aiFiles: aiAuthorship(base) }));
    } catch { /* no base */ }
  }

  // Changes inside protected paths: warnings only.
  if (!staged && cfg.protectedPaths.length) {
    try { findings.push(...E.pathFindings(cfg, g.changedFiles(base))); } catch { /* no base */ }
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
  let appr = { approvers: new Set(), source: 'none' };
  if (!staged && E.needingApproval(cfg, findings).length) appr = gl && process.env.FIXLOCK_TEST_APPROVERS === undefined ? await hostMod.approvers(gl) : await prApprovers(args.pr);
  const author = staged ? '' : ((gl && !process.env.CHANGE_AUTHOR ? await hostMod.author(gl) : prAuthor()) || '').toLowerCase(); // no PR exists yet at commit time
  let blocking = E.applyApprovals(cfg, findings, { approvers: appr.approvers, author });

  // Test-linked locks: run the tests of the locks this change touches. A passing, unchanged test satisfies
  // the lock (the fix still works); a failing one says the fix is broken.
  if (!staged && (args['run-tests'] || (cfg.tests || {}).run)) {
    const linked = findings.filter((f) => f.kind === 'lock' && f.lock.test);
    if (linked.length) {
      let changed = new Set();
      try { changed = new Set(g.changedFiles(base).flatMap((ch) => [ch.file, ch.from].filter(Boolean))); } catch { /* no base */ }
      if (!args.json) console.log(c.dim(`Running the tests of ${linked.length} changed lock(s)...`));
      const results = tests.run(s.root(), cfg, linked.map((f) => f.lock.test), { log: (cmd) => { if (!args.json) console.log(c.dim(`  $ ${cmd}`)); } });
      blocking = E.applyTests(cfg, findings, results, changed);
      if (!args.json) console.log('');
    }
  }

  // AI lock judgment: advice next to each changed lock that still needs a person. Never changes the result.
  if (!staged && (args.judge || (cfg.judge || {}).enabled)) {
    const n = await require('./judge').judgeFindings(cfg, findings, read, L, { log: (id) => { if (!args.json) console.log(c.dim(`Asking the AI reviewer about ${id}...`)); } });
    if (n && !args.json) console.log('');
  }

  // Tracker: reopen the linked issue for each blocked regression.
  if (args.notify && blocking.length) {
    const ctx = { pr: require('./approvals').prNumber(args.pr), branch: (g.git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) || '').trim(), author: author || undefined };
    for (const f of blocking) { const r = await trackers.sync(cfg, f.lock, 'regression', ctx); if (r) f.tracker = r; }
  }

  if (args.json) console.log(JSON.stringify({ base, staged, ok: !blocking.length, approvals: appr.source, findings: findings.map(({ lock, approvers, ...f }) => ({ ...f, lock: lock && lock.id, approvers: approvers && approvers.map(team.handle) })) }, null, 2));
  else report(cfg, reg, findings, { base, staged, appr, strict: !!args.strict });
  if (args.markdown) fs.writeFileSync(args.markdown, E.toMarkdown(cfg, findings, base) + alerts.stateComment(alerts.stateOf(findings)));
  // Alerts: what changed since the last run of this PR (Slack, Teams, webhook).
  if (pr) {
    const sent = await alerts.send(alerts.events(findings, alerts.readState(pr.previous)), pr, cfg, team);
    if (sent.length && !args.json) console.log(c.dim(`Alerted: ${sent.map((x) => x.to + (x.ok ? '' : ` (failed: ${x.error})`)).join(', ')}`));
  }
  // GitLab merge request / Bitbucket pull request: one fixlock comment, kept up to date.
  if (gl && args.comment) {
    try {
      const r = await hostMod.upsertComment(gl, `${E.toMarkdown(cfg, findings, base)}\n<sub>[fixlock](https://abinandhmj.github.io/fixlock/) · fixed stays fixed · a product of Algotricz</sub>\n${alerts.stateComment(alerts.stateOf(findings))}`);
      if (r.skipped && !args.json) console.log(c.yellow(`! No ${hostMod.name} comment: set ${hostMod.tokenVar} as a secret CI variable.`));
    } catch (e) { if (!args.json) console.log(c.yellow(`! Couldn't post the ${hostMod.name} comment: ${e.message}`)); }
  }
  process.exitCode = blocking.length && !staged ? 1 : (blocking.length && args.strict ? 1 : 0);
}

function report(cfg, reg, findings, { base, staged, appr, strict }) {
  console.log(c.bold(`fixlock check  (${staged ? 'staged changes' : 'base ' + base}, ${reg.locks.length} locks)\n`));
  if (!findings.length) return console.log(c.green('✔ Clean — every locked fix and feature is intact, no working code rewritten.'));
  if (appr.error) console.log(c.yellow(`! Could not read PR approvals: ${appr.error}\n`));
  for (const f of findings) {
    if (f.kind === 'path') { console.log(`${c.yellow('PATH')}  ${f.msg}`); continue; }
    if (f.kind === 'stable') { console.log(`${c.yellow('REWRITE')}  ${f.msg}`); f.sum.sample.forEach((l) => console.log(c.dim(`    - ${l}`))); continue; }
    if (f.kind === 'rule') {
      console.log(`${f.status === 'approved' ? c.green('APPROVED') : c.red('RULE')}  ${f.msg}`);
      if (f.rule.reason) console.log(c.dim(`    why: ${f.rule.reason}`));
      if (f.files.length > 1) f.files.slice(0, 8).forEach((x) => console.log(c.dim(`    - ${x}`)));
      if (f.status === 'blocked') console.log(f.unapprovable ? c.yellow(`    ! ${f.unapprovable}`) : `    → needs approval from ${f.approvers.map(team.handle).join(' or ')} on the PR.`);
      continue;
    }
    const owner = team.handle(team.find(cfg, f.lock.owner)) || f.lock.owner;
    const tag = { blocked: c.red('LOCKED'), approved: c.green('APPROVED'), warn: c.yellow('WARNING'), satisfied: c.green('TEST OK') }[f.status];
    console.log(`${tag}  ${f.lock.id} "${f.lock.title}" (${f.lock.type}, owner ${owner}) — ${f.deleted ? 'file deleted: ' : ''}${f.file}`);
    if (f.lock.reason && f.lock.reason !== f.lock.title) console.log(c.dim(`    why: ${f.lock.reason}`));
    for (const l of f.missing) console.log(c.dim(`    - ${l.trim()}`));
    if (f.copies) console.log(c.dim(`    this code appeared ${f.copies.expected} times in the file; only ${f.copies.found} identical copies are left`));
    if (f.renamed && f.renamed.length) console.log(c.dim(`    renamed (logic kept): ${f.renamed.map(([a, b]) => `${a} → ${b}`).join(', ')}`));
    if (f.test) console.log((f.test.status === 'failed' ? c.red : f.test.status === 'passed' ? c.green : c.yellow)(`    ${E.testNote(f.test).replace(/\*\*|`/g, '')}`));
    if (f.test && f.test.status === 'failed' && f.test.output) f.test.output.split('\n').slice(-8).forEach((l) => console.log(c.dim(`      ${l}`)));
    if (f.judge) console.log((f.judge.verdict === 'broken' ? c.red : f.judge.verdict === 'preserved' ? c.cyan : c.yellow)(`    ${E.judgeNote(f.judge).replace(/\*\*/g, '')}`));
    if (f.expired) console.log(c.dim(`    expired on ${f.lock.expires}: changing it only warns (fixlock review ${f.lock.id} --keep to extend)`));
    if (f.status === 'blocked') console.log(`    → needs approval from ${f.approvers.map(team.handle).join(' or ') || 'nobody on the team (no owner or lead)'}${staged ? ' when you open the PR' : ' on the PR'}, or restore these lines.`);
    if (f.status === 'blocked' && !staged && f.unapprovable) console.log(c.yellow(`    ! ${f.unapprovable}`));
    if (f.tracker) console.log(c.dim(`    tracker: ${f.tracker}`));
  }
  const b = findings.filter((f) => f.status === 'blocked').length;
  if (b && !staged) console.log(c.red(`\n✖ ${b} locked change(s) without approval.`));
  if (b && staged && strict) console.log(c.red(`\n✖ ${b} locked change(s): commit blocked (--strict). Restore the lines, or commit without the strict hook and get approval in the PR.`));
  else if (b && staged) console.log(c.yellow(`\n! Heads up: ${b} locked change(s). The commit is allowed, but CI will ask for approval.`));
  if (findings.some((f) => f.kind === 'stable')) console.log(c.yellow(`${b ? '' : '\n'}! Existing working code is being rewritten — make sure that was intended and the team knows.`));
}

/* ---------------- setup (AI assistants) ---------------- */
function cmdSetup(args) {
  const names = args._.length ? args._ : null;
  if (!names) {
    const T = require('./setup').TARGETS;
    console.log(c.bold('Connect an AI assistant to fixlock:\n'));
    for (const [id, t] of Object.entries(T)) console.log(`  ${cli.human(s.root())} setup ${id.padEnd(12)} ${t.label}${t.scope === 'user' ? c.dim('  (writes your user config)') : ''}`);
    console.log(`  ${cli.human(s.root())} setup all          every project-level one above`);
    return;
  }
  if (!s.configExists()) throw new Error(`fixlock is not set up in this repo yet. Run: ${cli.human(process.cwd())} init`);
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
  for (const l of locks) console.log(c.green(`✔ ${l.id} auto-locked`) + ` — ${l.file} (${l.snippet.length} lines) · ${l.title}${l.issue ? ' · ' + l.issue : ''}`);
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

/* ---------------- languages ---------------- */
function cmdLanguages(args) {
  const langs = require('./languages').list();
  if (args.json) { console.log(JSON.stringify(langs, null, 2)); return; }
  console.log(c.bold(`Structural matching: ${langs.length} languages and formats`) + c.dim('  (other files are matched as text)\n'));
  for (const l of langs) {
    const notes = [l.markup && 'templates', l.indent && 'indentation-aware', l.fold && 'case-insensitive'].filter(Boolean).join(', ');
    console.log(`  ${l.id.padEnd(11)} ${l.files.join(' ')}${notes ? c.dim(`  (${notes})`) : ''}`);
  }
  if (args._[0]) {
    const id = require('./languages').detect(args._[0]);
    console.log(`\n${args._[0]} → ${id ? c.green(id) : c.yellow('text matching')}`);
  }
}

/* ---------------- discover ---------------- */
async function cmdDiscover(args) {
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const sel = args.since ? { since: args.since } : { max: args.max ? +args.max : 1000 };
  const min = args.min === undefined ? 4 : +args.min;
  const { found, skipped, scanned, fixes } = discovery.discover(cfg, reg, sel, { min, features: !args['no-features'], perCommit: args['per-commit'] });
  const limit = args.limit ? +args.limit : 25;
  const shown = found.slice(0, limit);
  if (args.json) {
    console.log(JSON.stringify({ scanned, fixes, min, found: found.map((f) => ({
      file: f.file, lines: [f.start, f.end], type: f.type, score: f.score, confidence: f.confidence, signals: f.signals,
      title: auto.cleanTitle(f.commit.subject), commit: f.commit.sha, test: f.test, snippet: f.snippet,
    })), skipped }, null, 2));
    return;
  }
  if (!found.length) {
    console.log(c.green(`✔ Scanned ${scanned} commit(s): no unlocked past fixes found`) + c.dim(min > 0 ? ` (score ${min}+; try --min 0 to see weaker candidates)` : ''));
    return;
  }
  const tag = { high: c.green('high  '), medium: c.yellow('medium'), low: c.dim('low   ') };
  console.log(c.bold(`Found ${found.length} block(s) from ${fixes} past fix(es) worth locking in ${scanned} commit(s)`) + (found.length > shown.length ? c.dim(` (top ${shown.length}; --limit N for more)`) : '') + '\n');
  shown.forEach((f, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${tag[f.confidence]} ${f.type === 'feature' ? c.cyan('feature') : 'bug    '} ${c.bold(`${f.file}:${f.start}-${f.end}`)}  ${f.commit.subject}  ${c.dim(f.commit.sha.slice(0, 7))}`);
    console.log(c.dim(`       ${f.signals.join(' · ')}`));
    console.log(c.dim(`       │ ${f.snippet.slice(0, 2).map((l) => l.trim()).join('  ⏎  ')}${f.snippet.length > 2 ? `  … (+${f.snippet.length - 2})` : ''}`));
  });
  skipped.slice(0, 3).forEach((x) => console.log(c.dim(`  skipped ${x}`)));
  if (skipped.length > 3) console.log(c.dim(`  … and ${skipped.length - 3} more large blocks skipped (lock their key lines with fixlock mark)`));
  let picked;
  if (args['dry-run']) return;
  if (args.apply || args.yes) picked = shown.map((_, i) => i);
  else if (process.stdin.isTTY) {
    const p = init.prompter();
    try {
      for (;;) {
        const v = await p.ask('\nLock which? e.g. 1-3,5 · all · none', 'none');
        try { picked = discovery.parseSelection(v, shown.length); break; } catch (e) { console.log(c.yellow(`  ${e.message}`)); }
      }
    } finally { p.close(); }
  } else {
    console.log(c.dim('\nRun `fixlock discover` in a terminal to choose, or add --apply to lock all of these.'));
    return;
  }
  if (!picked.length) { console.log(c.dim('Nothing locked.')); return; }
  const locks = discovery.toLocks(picked.map((i) => shown[i]), cfg, reg);
  s.saveRegistry(reg);
  console.log('');
  for (const l of locks) console.log(c.green(`✔ ${l.id} locked`) + ` — ${l.file} (${l.snippet.length} lines) · ${l.title}${l.test ? c.dim(' · test ' + l.test) : ''}`);
  syncAgentFiles(true);
  if (fs.existsSync(path.join(s.root(), '.github', 'CODEOWNERS'))) writeCodeowners(true);
  console.log(c.dim(`\nCommit .fixlock/ so the locks apply to everyone: git add .fixlock && git commit -m "chore(fixlock): lock ${locks.length} past fix(es)"`));
}

/* ---------------- quickstart ---------------- */
const QUICK_MIN = 7; // "high" confidence in discover: reverted-and-reapplied, linked issue + test, …
const QUICK_MAX_LOCKS = 15;

/** The GitHub Actions workflow for the PR check, pinned to this version of the action. */
function ciWorkflow() {
  return `# Added by fixlock quickstart. Fails a PR that changes a locked fix until its owner approves.
name: fixlock
on:
  pull_request:
  pull_request_review:        # re-run when the owner approves
    types: [submitted, dismissed]
permissions: { contents: read, pull-requests: write }
jobs:
  fixlock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: AbinandhMJ/fixlock@v${require('../package.json').version}
`;
}

/** Is this repository hosted on GitHub (origin points at github.com)? */
function onGithub() {
  const url = (g.git(['remote', 'get-url', 'origin'], { allowFail: true }) || '').trim();
  return /github\.com[:/]/i.test(url);
}

/** Is origin a GitLab repository (gitlab.com, or a host named gitlab.*)? */
function onGitlab() {
  const url = (g.git(['remote', 'get-url', 'origin'], { allowFail: true }) || '').trim();
  return /(^|[@/.])gitlab\.[\w.]+[:/]/i.test(url);
}

const GITLAB_INCLUDE = 'https://raw.githubusercontent.com/AbinandhMJ/fixlock/main/ci/gitlab/fixlock.gitlab-ci.yml';

/** Is origin a Bitbucket Cloud repository? */
function onBitbucket() {
  const url = (g.git(['remote', 'get-url', 'origin'], { allowFail: true }) || '').trim();
  return /bitbucket\.org[:/]/i.test(url);
}

/** A bitbucket-pipelines.yml with the fixlock pull-request step. */
const BITBUCKET_PIPELINE = `# Added by fixlock quickstart: fails a pull request that changes a locked fix until its owner approves.
# Needs a secured repository variable FIXLOCK_BITBUCKET_TOKEN (repository access token, Pull requests: Write).
image: node:22
clone:
  depth: full
pipelines:
  pull-requests:
    '**':
      - step:
          name: fixlock
          script:
            - git fetch origin "+refs/heads/\${BITBUCKET_PR_DESTINATION_BRANCH}:refs/remotes/origin/\${BITBUCKET_PR_DESTINATION_BRANCH}"
            - npx -y @abinandhmj/fixlock@0 check --base "origin/\${BITBUCKET_PR_DESTINATION_BRANCH}" --comment
`;

/** Does a workflow already run fixlock? */
function hasFixlockWorkflow() {
  const dir = path.join(s.root(), '.github', 'workflows');
  try {
    return fs.readdirSync(dir).some((f) => /\.ya?ml$/.test(f) && /abinandhmj\/fixlock@|fixlock(@[\w.^~-]+)?\s+check|fixlock check/i.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  } catch { return false; }
}

/**
 * One command, no questions: set up fixlock with the defaults, lock the past fixes fixlock is most
 * sure about, connect the AI assistants, install this machine's hooks and add the PR check.
 */
async function cmdQuickstart(args) {
  try { g.repoRoot(); } catch { throw new Error('Run quickstart inside a git repository (git init first).'); }
  const run = cli.human(s.root());
  const done = [];
  const fresh = !s.configExists();
  console.log(c.bold('fixlock quickstart') + c.dim('  · no questions; change anything later in .fixlock/config.json\n'));

  // init --yes keeps an existing config (team, policies) and only fills in what's missing, so this also
  // connects a clone of a repo someone else set up (for example through the GitHub App's setup PR).
  await cmdInit({ ...args, yes: true, quiet: true });
  const setUp = s.loadConfig();
  if (!fresh) done.push('Already set up: kept your .fixlock/config.json');
  done.push(`Team: ${setUp.team.map((m) => `${m.name}${m.github ? ` (@${m.github})` : ''}, ${m.role}`).join('; ') || 'none yet'}`);
  done.push(`AI assistants: ${agents.enabled(setUp).join(', ')} get the lock rules${agents.enabled(setUp).includes('claude-code') ? '; Claude Code also gets a hook that asks before editing locked lines' : ''}`);
  if (!args['no-git-hooks']) done.push('This machine: commit warning and auto-lock of fix:/feat: commits');

  // Lock the past fixes fixlock is most sure about. The rest are a `discover` away.
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  let more = 0;
  if (!args['no-locks']) {
    const { found, scanned } = discovery.discover(cfg, reg, { max: 1000 }, { min: 0, features: true });
    const sure = found.filter((f) => f.score >= QUICK_MIN).slice(0, QUICK_MAX_LOCKS);
    more = found.filter((f) => f.score >= 4).length - sure.length;
    if (sure.length) {
      const locks = discovery.toLocks(sure, cfg, reg);
      s.saveRegistry(reg);
      syncAgentFiles('silent');
      done.push(`Locked ${locks.length} past fix(es) from ${scanned} commit(s):`);
      for (const l of locks) done.push(`  ${l.id}  ${l.file}  ${l.title}`);
    } else {
      done.push(`Scanned ${scanned} commit(s): no past fix stood out enough to lock automatically`);
    }
  }

  // The PR check.
  let ci = 'skipped (--no-ci)';
  if (!args['no-ci']) {
    if (s.loadConfig().prCheck === 'github-app') ci = 'the fixlock GitHub App';
    else if (hasFixlockWorkflow()) ci = 'a workflow already runs fixlock';
    else if (onGitlab()) {
      const file = path.join(s.root(), '.gitlab-ci.yml');
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (text && /fixlock/.test(text)) ci = '.gitlab-ci.yml already runs fixlock';
      else if (text === null) {
        fs.writeFileSync(file, `# Added by fixlock quickstart: fails a merge request that changes a locked fix until its owner approves.\n# Needs a masked CI/CD variable FIXLOCK_GITLAB_TOKEN (project access token, api scope).\ninclude:\n  - remote: ${GITLAB_INCLUDE}\n`);
        ci = '.gitlab-ci.yml (add the FIXLOCK_GITLAB_TOKEN variable: see the GitLab docs)';
      } else ci = `add this to your .gitlab-ci.yml:  include: [{ remote: ${GITLAB_INCLUDE} }]`;
    }
    else if (onBitbucket()) {
      const file = path.join(s.root(), 'bitbucket-pipelines.yml');
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (text && /fixlock/.test(text)) ci = 'bitbucket-pipelines.yml already runs fixlock';
      else if (text === null) { fs.writeFileSync(file, BITBUCKET_PIPELINE); ci = 'bitbucket-pipelines.yml (add the FIXLOCK_BITBUCKET_TOKEN variable: see the Bitbucket docs)'; }
      else ci = 'add the fixlock step to your bitbucket-pipelines.yml pull-requests pipeline (see the Bitbucket docs)';
    }
    else if (!onGithub() && !args.ci) ci = 'not on GitHub, GitLab or Bitbucket: add `fixlock check` to your CI (see the CI setup docs)';
    else {
      const file = path.join(s.root(), '.github', 'workflows', 'fixlock.yml');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, ciWorkflow());
      ci = '.github/workflows/fixlock.yml';
    }
  }
  done.push(`PR check: ${ci}`);

  console.log(c.green('✔ fixlock is set up\n'));
  for (const line of done) console.log(line.startsWith('  ') ? c.dim(line) : `  ${line}`);
  const t = s.loadConfig().team.filter((m) => !m.github && m.role !== 'reviewer');
  if (t.length) console.log(c.yellow(`\n! ${t.map((m) => m.name).join(', ')}: no GitHub username, so PR approvals can't be matched. Run  ${run} team add --name "${t[0].name}" --github <username>${t[0].emails[0] ? ` --email ${t[0].emails[0]}` : ''} --role ${t[0].role}`));
  console.log(c.bold('\nLast step: commit and push'));
  console.log('  git add -A && git commit -m "chore: set up fixlock" && git push');
  if (more > 0) console.log(c.dim(`\n${more} more past fix(es) could be worth locking: ${run} discover`));
  console.log(c.dim(`Make "fixlock" a required status check on main so blocked PRs can't merge.`));
}

/* ---------------- AI tool files / changelog / codeowners ---------------- */
function syncAgentFiles(quiet) {
  const cfg = s.loadConfig();
  const { written, notes } = agents.sync(cfg);
  if (cfg.changelog !== false) { changelog.update(); written.push('CHANGELOG.md'); }
  if (quiet === 'silent') { /* the caller reports */ } else if (quiet) console.log(c.dim(`  synced ${written.join(', ')}`));
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
  if (missing.length) console.log(c.yellow(`\nFound on this machine/repo but not enabled: ${missing.join(', ')}\n→ ${cli.human(s.root())} tools add ${missing.join(' ')}`));
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
  init: cmdInit, quickstart: cmdQuickstart, team: cmdTeam, mark: cmdMark, list: cmdList, remove: cmdRemove, why: cmdWhy, status: cmdStatus, check: cmdCheck, link: cmdLink, test: cmdTest, relock: cmdRelock, handover: cmdHandover, review: cmdReview,
  sync: () => syncAgentFiles(false),
  tools: cmdTools,
  autolock: cmdAutolock,
  discover: cmdDiscover,
  languages: cmdLanguages,
  detect: () => cmdTools({ _: ['list'] }),
  changelog: () => { console.log(c.green(`✔ ${path.relative(process.cwd(), changelog.update()) || 'CHANGELOG.md'} updated`)); },
  release: (args) => { const r = changelog.release(args._[0]); syncAgentFiles(true); console.log(c.green(`✔ ${r.version} (${r.date}) written to CHANGELOG.md`) + c.dim('  — commit it, then tag: git tag v' + r.version.replace(/^v/, ''))); },
  codeowners: () => writeCodeowners(false),
  'install-hook': () => { init.installGitHook(); console.log(c.green('✔ pre-commit warning hook installed')); },
  'install-claude-hook': () => { init.installClaudeHook(); console.log(c.green('✔ Claude Code hook added to .claude/settings.json')); },
  setup: cmdSetup,
  demo: (args) => { require('./demo').run({ keep: !!args.keep, fast: !!args.fast }); },
  mcp: () => require('./mcp').serve(),
  hook: (args) => {
    const which = args._[0];
    if (which === 'claude') return require('./hook').run();
    if (which === 'cursor') return require('./agenthooks').runCursor();
    if (which === 'windsurf' || which === 'devin') return require('./agenthooks').runWindsurf();
    throw new Error('Usage: fixlock hook claude | cursor | windsurf');
  },
  allow: (args) => {
    const ah = require('./agenthooks');
    if (args.clear) { ah.clearAllowed(); return console.log(c.green('✔ Cleared: AI assistants must ask again before changing locked lines.')); }
    if (!args._.length) {
      const now = ah.allowed();
      if (!Object.keys(now).length) return console.log('No locks are allowed right now. Allow one: fixlock allow FIX-001 [--minutes 30]');
      for (const [id, t] of Object.entries(now)) console.log(`${id}  until ${new Date(t).toLocaleTimeString()}`);
      return;
    }
    const reg = s.loadRegistry();
    const cfgNow = s.loadConfig();
    for (const id of args._) {
      const m = /^rule:(.+)$/i.exec(id);
      if (m) { if (!(cfgNow.rules || []).some((r) => rules.ruleName(r).toLowerCase() === m[1].toLowerCase())) throw new Error(`No rule "${m[1]}" in .fixlock/config.json`); continue; }
      if (!reg.locks.some((l) => l.id.toUpperCase() === id.toUpperCase())) throw new Error(`No lock ${id}. See: fixlock list`);
    }
    const minutes = Math.max(1, Math.min(480, parseInt(args.minutes || '30', 10) || 30));
    ah.allow(args._, minutes);
    console.log(c.green(`✔ Cursor and Windsurf may change ${args._.map((x) => x.toUpperCase()).join(', ')} for ${minutes} minutes.`) + c.dim(' The PR still needs the owner\'s approval. Undo: fixlock allow --clear'));
  },
};
