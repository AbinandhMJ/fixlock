'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const g = require('./git');
const s = require('./store');
const agents = require('./agents');
const cli = require('./cli');

function prompter() {
  const tty = !!process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin, output: tty ? process.stdout : undefined, terminal: tty });
  const it = rl[Symbol.asyncIterator]();
  async function ask(q, def = '', options = null) {
    for (;;) {
      const hint = options ? ` [${options.join('/')}]` : '';
      process.stdout.write(`${q}${hint}${def ? ` (${def})` : ''}: `);
      const r = await it.next();
      const v = (r.done ? '' : r.value).trim();
      if (!tty) process.stdout.write(v + '\n');
      const out = v || def;
      if (!options || options.includes(out)) return out;
      if (r.done) return def;
      console.log(`  please choose one of: ${options.join(', ')}`);
    }
  }
  return { ask, close: () => rl.close() };
}

const yes = (v) => /^y(es)?$/i.test(v);

async function interactive(cfg) {
  const p = prompter();
  try {
    console.log('\nfixlock setup — run this once as the team lead / project manager.\n');
    cfg.project = await p.ask('Project name', cfg.project || path.basename(s.root()));

    console.log('\nTeam members (leave name empty to finish). GitHub username is used for PR approvals;');
    console.log('git email is how fixlock recognises who is editing.\n');
    const myEmail = g.userEmail();
    const myName = (g.git(['config', 'user.name'], { allowFail: true }) || '').trim();
    let first = !cfg.team.length;
    for (;;) {
      const name = await p.ask('  Name', first ? myName : '');
      if (!name) break;
      const github = (await p.ask('  GitHub username', '')).replace(/^@/, '');
      const emails = (await p.ask('  Git email(s), comma separated', first ? myEmail : '')).split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      const role = await p.ask('  Role', first ? 'lead' : 'developer', ['lead', 'developer', 'reviewer']);
      cfg.team = cfg.team.filter((m) => m.github !== github || !github);
      cfg.team.push({ name, github: github || null, emails, role });
      console.log(`  ✔ added ${name} (${role})\n`);
      first = false;
    }

    const found = agents.detect();
    console.log('\nAI coding tools — fixlock writes the right rules file for each one.');
    console.log(`Known: ${agents.TOOLS.map((t) => t.id).join(', ')}`);
    if (found.length) found.forEach((f) => console.log(`  found ${f.id.padEnd(12)} (${f.where.join('; ')})`));
    else console.log('  nothing detected on this machine');
    const defTools = (cfg.aiTools || [...new Set([...found.map((f) => f.id), 'claude-code', 'codex'])]).join(',');
    for (;;) {
      const list = (await p.ask('Which AI tools does the team use? (comma separated, include teammates\' tools)', defTools)).split(',').map((x) => x.trim()).filter(Boolean);
      const bad = list.filter((x) => !agents.byId(x));
      if (!bad.length) { cfg.aiTools = list; break; }
      console.log(`  unknown: ${bad.join(', ')}`);
    }

    console.log('\nWhat should happen when someone else (or their AI) changes locked lines?');
    console.log('  warn  = show a warning, allow the edit');
    console.log('  ask   = the AI must ask the developer before editing');
    console.log('  block = the AI skips those lines; a human change needs approval in the PR\n');
    for (const [type, label] of [['bug', 'Bug fixes'], ['feature', 'Features']]) {
      const cur = cfg.policies[type];
      const onEdit = await p.ask(`${label}: on edit`, cur.onEdit, ['warn', 'ask', 'block']);
      const approval = await p.ask(`${label}: PR must be approved by`, cur.approval, ['owner', 'lead', 'owner-or-lead', 'none']);
      cfg.policies[type] = { onEdit, approval };
    }

    console.log('\nWorking-code guard: AI edits that delete or rewrite code that is already committed and working');
    console.log('(written by someone else, or by you more than N days ago) need the developer\'s confirmation.');
    const guard = await p.ask('Working code: when an AI wants to rewrite it', cfg.stableCode.onEdit, ['warn', 'ask', 'block', 'off']);
    cfg.stableCode = { ...cfg.stableCode, enabled: guard !== 'off', onEdit: guard === 'off' ? 'ask' : guard };
    cfg.autoLock = { ...cfg.autoLock, enabled: yes(await p.ask('Auto-lock the lines of every fix:/feat: commit?', 'y')) };

    const tr = await p.ask('\nIssue tracker to sync', cfg.tracker ? cfg.tracker.type : 'none', ['none', 'linear', 'clickup', 'notion', 'webhook']);
    if (tr === 'none') cfg.tracker = null;
    else {
      const defaults = { linear: ['Done', 'In Progress'], clickup: ['complete', 'reopened'], notion: ['Fixed', 'Reopened'], webhook: ['fixed', 'reopened'] }[tr];
      cfg.tracker = { type: tr };
      cfg.tracker.onFix = await p.ask('  Status when a fix is locked', defaults[0]);
      cfg.tracker.onRegression = await p.ask('  Status when CI finds it reverted', defaults[1]);
      if (tr === 'notion') cfg.tracker.statusProperty = await p.ask('  Notion status property name', 'Status');
      if (tr === 'webhook') cfg.tracker.url = await p.ask('  Webhook URL (Zapier/Make/n8n → Bugasura, Jira…)', '');
      const envName = { linear: 'LINEAR_API_KEY', clickup: 'CLICKUP_TOKEN', notion: 'NOTION_TOKEN', webhook: 'FIXLOCK_WEBHOOK_SECRET (optional)' }[tr];
      console.log(`  → set ${envName} as an env var / CI secret. Tokens are never stored in the repo.`);
    }

    const hooks = {
      claude: !cfg.aiTools.includes('claude-code') ? false : yes(await p.ask('\nInstall the Claude Code hook (warns/asks/blocks before AI edits)?', 'y')),
      git: yes(await p.ask('Install the git pre-commit warning hook on this machine?', 'y')),
      codeowners: yes(await p.ask('Generate .github/CODEOWNERS from locks (GitHub asks owners to review)?', 'y')),
      mcp: yes(await p.ask('Connect your AI assistants to fixlock (MCP server config for Claude Code, Cursor, Copilot…)?', 'y')),
    };
    return hooks;
  } finally { p.close(); }
}

/** The logged-in GitHub CLI user, if gh is installed and logged in (null otherwise; never prompts). */
function githubLogin() {
  if (process.env.FIXLOCK_GITHUB_LOGIN !== undefined) return process.env.FIXLOCK_GITHUB_LOGIN || null; // tests, CI
  try {
    const r = require('child_process').spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const login = r.status === 0 ? r.stdout.trim() : '';
    return /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null;
  } catch { return null; }
}

function defaults(cfg) {
  if (!cfg.team.length) {
    const email = g.userEmail();
    const name = (g.git(['config', 'user.name'], { allowFail: true }) || '').trim() || email;
    if (email) cfg.team.push({ name, github: githubLogin(), emails: [email.toLowerCase()], role: 'lead' });
  }
  cfg.project = cfg.project || path.basename(s.root());
  if (!cfg.aiTools) cfg.aiTools = [...new Set([...agents.detect().map((f) => f.id), 'claude-code', 'codex'])];
  // Same as answering the interactive questions with their defaults, except CODEOWNERS (it changes who
  // GitHub asks to review, so it stays opt-in: `fixlock codeowners`).
  return { claude: true, git: true, codeowners: false, mcp: true };
}

function installClaudeHook() {
  const file = path.join(s.root(), '.claude', 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
  settings.hooks = settings.hooks || {};
  const pre = (settings.hooks.PreToolUse = settings.hooks.PreToolUse || []);
  const cmd = `${cli.command(s.root())} hook claude`;
  // replace any earlier fixlock hook (other version or launcher), keep everyone else's
  for (const h of pre) h.hooks = (h.hooks || []).filter((x) => !cli.isOurs(x.command) || x.command === cmd);
  settings.hooks.PreToolUse = pre.filter((h) => h.hooks.length);
  if (!settings.hooks.PreToolUse.some((h) => h.hooks.some((x) => x.command === cmd))) {
    settings.hooks.PreToolUse.push({ matcher: 'Edit|MultiEdit|Write', hooks: [{ type: 'command', command: cmd }] });
  }
  settings.permissions = settings.permissions || {};
  const deny = new Set(settings.permissions.deny || []);
  ['Edit(.fixlock/**)', 'Write(.fixlock/**)', 'Edit(.claude/settings.json)', 'Write(.claude/settings.json)', 'Edit(.git/hooks/**)', 'Write(.git/hooks/**)', 'Bash(npx fixlock remove:*)', `Bash(npx ${cli.PKG} remove:*)`, `Bash(npx -y ${cli.PKG}@${cli.pin()} remove:*)`, 'Bash(git push --no-verify:*)', 'Bash(git commit --no-verify:*)'].forEach((r) => deny.add(r));
  settings.permissions.deny = [...deny];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

/** Merge our command into a hooks.json list (replacing older fixlock entries, keeping everyone else's). */
function mergeHookList(list, entry) {
  const kept = (list || []).filter((h) => !cli.isOurs(h.command || '') || h.command === entry.command);
  if (!kept.some((h) => h.command === entry.command)) kept.push(entry);
  return kept;
}
const readJsonFile = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

/** Cursor: .cursor/hooks.json, preToolUse on file tools + beforeShellExecution. */
function installCursorHook() {
  const file = path.join(s.root(), '.cursor', 'hooks.json');
  const cfg = readJsonFile(file);
  const command = `${cli.command(s.root())} hook cursor`;
  cfg.version = cfg.version || 1;
  cfg.hooks = cfg.hooks || {};
  cfg.hooks.preToolUse = mergeHookList(cfg.hooks.preToolUse, { command, matcher: 'Write|Edit|Replace|Patch|Delete', timeout: 30 });
  cfg.hooks.beforeShellExecution = mergeHookList(cfg.hooks.beforeShellExecution, { command, timeout: 30 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return file;
}

/** Windsurf / Devin Desktop: .devin/hooks.json (and .windsurf/hooks.json for older Windsurf), pre_write_code + pre_run_command. */
function installWindsurfHook() {
  const command = `${cli.command(s.root())} hook windsurf`;
  const files = [];
  for (const dir of ['.devin', '.windsurf']) {
    const file = path.join(s.root(), dir, 'hooks.json');
    const cfg = readJsonFile(file);
    cfg.hooks = cfg.hooks || {};
    cfg.hooks.pre_write_code = mergeHookList(cfg.hooks.pre_write_code, { command, show_output: true });
    cfg.hooks.pre_run_command = mergeHookList(cfg.hooks.pre_run_command, { command, show_output: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    files.push(file);
  }
  return files;
}

function installGitHook() {
  const dir = path.join(s.root(), '.git', 'hooks');
  const run = cli.command(s.root());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pre-commit'),
    `#!/bin/sh\n# installed by fixlock — warns, never blocks; CI enforces approvals\n[ -n "$FIXLOCK_IN_HOOK" ] && exit 0\n${run} check --staged || true\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'post-commit'),
    `#!/bin/sh\n# installed by fixlock — locks lines from fix:/feat: commits in a follow-up chore commit\n[ -n "$FIXLOCK_IN_HOOK" ] && exit 0\nFIXLOCK_IN_HOOK=1 ${run} autolock --commit-result --quiet || true\n`, { mode: 0o755 });
}

module.exports = { interactive, defaults, installClaudeHook, installCursorHook, installWindsurfHook, installGitHook, prompter, githubLogin };
