'use strict';
// Cursor and Windsurf (Devin Desktop) pre-edit hooks: `fixlock hook cursor|windsurf` given the JSON those
// editors send, in a real repo with a locked fix. Also `fixlock allow` and `fixlock setup cursor|windsurf`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'fixlock.js');
let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2000)}` : ''}`); console.error('AGENT HOOKS FAIL'); process.exit(1); } passed++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-agents-'));
const repo = path.join(tmp, 'shop');
fs.mkdirSync(repo);
const env = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', FIXLOCK_HOME: path.join(tmp, 'home') };
const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' }).trim();
const fx = (args, input, cwd = repo) => spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8', input });
const PAY = "function pay(amount) {\n  if (amount <= 0) {\n    throw new Error('amount must be positive');\n  }\n  return charge(amount);\n}\n";
const file = path.join(repo, 'src', 'pay.js');

try {
  git('init', '-q'); git('config', 'user.email', 'abi@x.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, PAY);
  git('add', '.'); git('commit', '-qm', 'init');
  ok(fx(['init', '--yes', '--no-git-hooks']).status === 0, 'init');
  // Ravi owns the lock; Abi (the git user here) is the one whose AI is editing. An owner's own edits are exempt.
  const cf = path.join(repo, '.fixlock', 'config.json');
  const c0 = JSON.parse(fs.readFileSync(cf, 'utf8')); c0.team.push({ name: 'Ravi', github: 'ravi', emails: ['ravi@x.com'], role: 'developer' }); fs.writeFileSync(cf, JSON.stringify(c0, null, 2));
  ok(fx(['mark', 'src/pay.js', '2-4', '-m', 'A charge of zero crashed the ledger', '--title', 'never charge zero', '--owner', 'ravi']).status === 0, 'mark');
  git('add', '.'); git('commit', '-qm', 'chore: lock');

  /* ---- Cursor ---- */
  const cursor = (payload, cwd = tmp) => { const r = fx(['hook', 'cursor'], JSON.stringify({ hook_event_name: 'preToolUse', workspace_roots: [repo], cwd: repo, ...payload }), cwd); return { ...r, json: JSON.parse(r.stdout || '{}') }; };
  let r = cursor({ tool_name: 'StrReplace', tool_input: { file_path: file, old_string: "  if (amount <= 0) {\n    throw new Error('amount must be positive');\n  }\n", new_string: '' } });
  ok(r.json.permission === 'deny' && /FIX-001/.test(r.json.agent_message) && /fixlock allow FIX-001/.test(r.json.agent_message) && /stopped an AI edit to the locked fix FIX-001 "never charge zero" \(owner @ravi\)\. If the change is intended, run: fixlock allow FIX-001/.test(r.json.user_message), 'Cursor: removing the guard is stopped before the edit, with the fix and how to get an OK', r.stdout + r.stderr);
  r = cursor({ tool_name: 'Write', tool_input: { file_path: 'src/pay.js', contents: 'function pay(a) { return charge(a); }\n' } });
  ok(r.json.permission === 'deny', 'Cursor: rewriting the whole file (relative path) is stopped', r.stdout);
  r = cursor({ tool_name: 'Edit', tool_input: { path: file, old_str: '  return charge(amount);', new_str: '  return charge(amount, "INR");' } });
  ok(r.json.permission === 'allow', 'Cursor: an edit outside the locked lines is allowed', r.stdout);
  r = cursor({ tool_name: 'MultiEdit', tool_input: { file_path: file, edits: [{ old_string: "'amount must be positive'", new_string: '"amount must be positive"' }] } });
  ok(r.json.permission === 'allow', 'Cursor: reformatting locked lines (quote style) is allowed: structural matching', r.stdout);
  r = cursor({ tool_name: 'Delete', tool_input: { file_path: file } });
  ok(r.json.permission === 'deny', 'Cursor: deleting the file is stopped', r.stdout);
  r = cursor({ tool_name: 'ApplyPatch', tool_input: { file_path: file, patch: '*** some patch format ***' } });
  ok(r.json.permission === 'deny' && /couldn't see which lines/.test(r.json.agent_message), "Cursor: an edit fixlock can't read, in a file with locks, is stopped and says why", r.stdout);
  r = cursor({ tool_name: 'Write', tool_input: { file_path: path.join(repo, 'src', 'new.js'), contents: 'x' } });
  ok(r.json.permission === 'allow', 'Cursor: files without locks are allowed');
  r = cursor({ tool_name: 'Read', tool_input: { file_path: file } });
  ok(r.json.permission === 'allow', 'Cursor: reads are allowed');
  r = fx(['hook', 'cursor'], 'not json');
  ok(r.status === 0 && JSON.parse(r.stdout).permission === 'allow', 'Cursor: a broken payload never blocks work');
  r = cursor({ hook_event_name: 'beforeShellExecution', command: 'npx fixlock allow FIX-001' });
  ok(r.json.permission === 'deny' && /Only the developer/.test(r.json.agent_message), 'Cursor: the agent may not run fixlock allow', r.stdout);
  r = cursor({ hook_event_name: 'beforeShellExecution', command: 'git commit -am "x" --no-verify' });
  ok(r.json.permission === 'deny', 'Cursor: the agent may not skip git hooks');
  r = cursor({ hook_event_name: 'beforeShellExecution', command: 'npm test' });
  ok(r.json.permission === 'allow', 'Cursor: other commands are allowed');

  // fixlock allow: the developer's OK lets the agent through, for a while
  r = fx(['allow', 'FIX-999']);
  ok(r.status !== 0 && /No lock FIX-999/.test(r.stderr), 'allow refuses an unknown lock');
  r = fx(['allow', 'fix-001', '--minutes', '5']);
  ok(r.status === 0 && /may change FIX-001 for 5 minutes/.test(r.stdout), 'allow FIX-001', r.stdout + r.stderr);
  ok(/FIX-001\s+until/.test(fx(['allow']).stdout), 'allow with no ids lists what is allowed');
  r = cursor({ tool_name: 'StrReplace', tool_input: { file_path: file, old_string: "  if (amount <= 0) {\n", new_string: '  if (amount < 0) {\n' } });
  ok(r.json.permission === 'allow', 'Cursor: after fixlock allow, the edit goes through', r.stdout);
  ok(!git('status', '--porcelain').includes('fixlock-allow'), "the OK lives in .git, so it's never committed");
  fx(['allow', '--clear']);
  r = cursor({ tool_name: 'StrReplace', tool_input: { file_path: file, old_string: "  if (amount <= 0) {\n", new_string: '  if (amount < 0) {\n' } });
  ok(r.json.permission === 'deny', 'allow --clear: stopped again');

  // A lock with policy "block": refused, and no allow hint
  const cfgFile = path.join(repo, '.fixlock', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); cfg.policies.bug.onEdit = 'block'; fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  r = cursor({ tool_name: 'StrReplace', tool_input: { file_path: file, old_string: "  if (amount <= 0) {\n", new_string: '  if (amount < 0) {\n' } });
  ok(r.json.permission === 'deny' && /must not change these lines/.test(r.json.agent_message) && !/fixlock allow/.test(r.json.agent_message), 'block policy: refused without the allow route', r.stdout);
  cfg.policies.bug.onEdit = 'warn'; fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  r = cursor({ tool_name: 'StrReplace', tool_input: { file_path: file, old_string: "  if (amount <= 0) {\n", new_string: '  if (amount < 0) {\n' } });
  ok(r.json.permission === 'allow', 'warn policy: allowed');
  cfg.policies.bug.onEdit = 'ask'; fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

  /* ---- Windsurf / Devin Desktop ---- */
  const windsurf = (payload) => fx(['hook', 'windsurf'], JSON.stringify({ trajectory_id: 't', execution_id: 'e', timestamp: new Date().toISOString(), model_name: 'x', ...payload }), tmp);
  r = windsurf({ agent_action_name: 'pre_write_code', tool_info: { file_path: file, edits: [{ old_string: "    throw new Error('amount must be positive');\n", new_string: '' }] } });
  ok(r.status === 2 && /FIX-001/.test(r.stderr) && /fixlock allow FIX-001/.test(r.stderr), 'Windsurf: pre_write_code that removes the fix exits 2 with the reason', `${r.status}\n${r.stdout}\n${r.stderr}`);
  r = windsurf({ agent_action_name: 'pre_write_code', tool_info: { file_path: file, edits: [{ old_string: '  return charge(amount);', new_string: '  return charge(amount, 1);' }] } });
  ok(r.status === 0 && !r.stderr, 'Windsurf: an edit outside the lock is allowed');
  r = windsurf({ agent_action_name: 'pre_run_command', tool_info: { command_line: 'fixlock remove FIX-001', cwd: repo } });
  ok(r.status === 2 && /Only the developer/.test(r.stderr), 'Windsurf: the agent may not remove locks');
  r = windsurf({ agent_action_name: 'pre_read_code', tool_info: { file_path: file } });
  ok(r.status === 0, 'Windsurf: other events pass');

  /* ---- setup writes the hook files ---- */
  r = fx(['setup', 'cursor']);
  const ch = JSON.parse(fs.readFileSync(path.join(repo, '.cursor', 'hooks.json'), 'utf8'));
  ok(r.status === 0 && ch.version === 1 && /hook cursor$/.test(ch.hooks.preToolUse[0].command) && ch.hooks.preToolUse[0].matcher && /hook cursor$/.test(ch.hooks.beforeShellExecution[0].command), 'setup cursor writes .cursor/hooks.json', r.stdout + r.stderr);
  fs.writeFileSync(path.join(repo, '.cursor', 'hooks.json'), JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: 'my-own-hook' }, ch.hooks.preToolUse[0]], afterFileEdit: [{ command: 'prettier' }] } }));
  fx(['setup', 'cursor']);
  const ch2 = JSON.parse(fs.readFileSync(path.join(repo, '.cursor', 'hooks.json'), 'utf8'));
  ok(ch2.hooks.preToolUse.length === 2 && ch2.hooks.preToolUse[0].command === 'my-own-hook' && ch2.hooks.afterFileEdit[0].command === 'prettier', "setup again: other hooks kept, ours not duplicated", JSON.stringify(ch2));
  r = fx(['setup', 'windsurf']);
  for (const d of ['.devin', '.windsurf']) {
    const w = JSON.parse(fs.readFileSync(path.join(repo, d, 'hooks.json'), 'utf8'));
    ok(/hook windsurf$/.test(w.hooks.pre_write_code[0].command) && w.hooks.pre_write_code[0].show_output === true && /hook windsurf$/.test(w.hooks.pre_run_command[0].command), `setup windsurf writes ${d}/hooks.json`, r.stdout + r.stderr);
  }
  ok(fs.existsSync(path.join(tmp, 'home', '.codeium', 'windsurf', 'mcp_config.json')), 'setup windsurf still connects the MCP server (user config)');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`AGENT HOOKS PASS (${passed} checks)`);
