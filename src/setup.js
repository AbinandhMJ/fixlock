'use strict';
// `fixlock setup <assistant>`: connect an AI coding assistant to fixlock (MCP server + rules file + hook where supported).
const fs = require('fs');
const os = require('os');
const path = require('path');
const s = require('./store');

/** How assistants should launch the server. Uses the project's local install when there is one. */
function serverCommand(root) {
  const local = fs.existsSync(path.join(root, 'node_modules', '@abinandhmj', 'fixlock'));
  const args = local ? ['--no-install', 'fixlock', 'mcp'] : ['-y', '@abinandhmj/fixlock', 'mcp'];
  return { command: 'npx', args };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function mergeJson(file, key, entry) {
  const exists = fs.existsSync(file);
  const json = readJson(file);
  if (exists && !json) return { file, status: 'skipped', note: `${file} is not valid JSON (comments?) — add the "fixlock" server by hand` };
  const data = json || {};
  data[key] = data[key] || {};
  const had = JSON.stringify(data[key].fixlock) === JSON.stringify(entry);
  data[key].fixlock = entry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return { file, status: had ? 'unchanged' : exists ? 'updated' : 'created' };
}

const home = () => process.env.FIXLOCK_HOME || os.homedir();

const TARGETS = {
  'claude-code': {
    label: 'Claude Code',
    scope: 'project',
    apply(root, cmd) {
      const out = [mergeJson(path.join(root, '.mcp.json'), 'mcpServers', { command: cmd.command, args: cmd.args })];
      require('./init').installClaudeHook();
      out.push({ file: path.join(root, '.claude', 'settings.json'), status: 'updated', note: 'pre-edit hook' });
      return out;
    },
  },
  cursor: {
    label: 'Cursor',
    scope: 'project',
    apply: (root, cmd) => [mergeJson(path.join(root, '.cursor', 'mcp.json'), 'mcpServers', { command: cmd.command, args: cmd.args })],
  },
  copilot: {
    label: 'GitHub Copilot (VS Code agent mode)',
    scope: 'project',
    apply: (root, cmd) => [mergeJson(path.join(root, '.vscode', 'mcp.json'), 'servers', { type: 'stdio', command: cmd.command, args: cmd.args })],
  },
  gemini: {
    label: 'Gemini CLI',
    scope: 'project',
    apply: (root, cmd) => [mergeJson(path.join(root, '.gemini', 'settings.json'), 'mcpServers', { command: cmd.command, args: cmd.args })],
  },
  codex: {
    label: 'OpenAI Codex (CLI / IDE extension)',
    scope: 'user',
    apply(root, cmd) {
      const dir = process.env.CODEX_HOME || path.join(home(), '.codex');
      const file = path.join(dir, 'config.toml');
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (/^\[mcp_servers\.fixlock\]/m.test(text)) return [{ file, status: 'unchanged' }];
      const block = `\n# added by fixlock — checks edits against locked fixes before Codex changes them\n[mcp_servers.fixlock]\ncommand = "${cmd.command}"\nargs = [${cmd.args.map((a) => JSON.stringify(a)).join(', ')}]\n`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, text.trimEnd() + (text ? '\n' : '') + block);
      return [{ file, status: text ? 'updated' : 'created', note: 'your user config; applies to every repo where fixlock is set up' }];
    },
  },
  windsurf: {
    label: 'Windsurf',
    scope: 'user',
    apply: (root, cmd) => [mergeJson(path.join(home(), '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers', { command: cmd.command, args: cmd.args })],
  },
};

const ALIASES = { claude: 'claude-code', 'claude-code': 'claude-code', vscode: 'copilot', 'github-copilot': 'copilot' };

function resolve(name) { return ALIASES[name] || name; }

/** Set up the given assistants. names: ids, or ["all"] (project-scoped ones only unless includeUser). */
function setup(names, { includeUser = false } = {}) {
  const root = s.root();
  const cmd = serverCommand(root);
  const ids = names.includes('all')
    ? Object.keys(TARGETS).filter((id) => includeUser || TARGETS[id].scope === 'project')
    : names.map(resolve);
  const results = [];
  for (const id of ids) {
    const t = TARGETS[id];
    if (!t) throw new Error(`Unknown assistant "${id}". Use: ${Object.keys(TARGETS).join(', ')}, all`);
    results.push({ id, label: t.label, scope: t.scope, files: t.apply(root, cmd) });
  }
  // Make sure each assistant also gets its rules file.
  const cfg = s.loadConfig();
  const agents = require('./agents');
  const enabled = new Set(agents.enabled(cfg));
  ids.filter((id) => agents.byId(id)).forEach((id) => enabled.add(id));
  cfg.aiTools = [...enabled];
  s.saveConfig(cfg);
  return { results, cmd };
}

module.exports = { setup, TARGETS, serverCommand };
