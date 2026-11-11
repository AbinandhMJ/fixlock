#!/usr/bin/env node
// Tests the MCP server over real stdio JSON-RPC, and `fixlock setup` for each assistant.
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'fixlock.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-mcp-'));
const app = path.join(tmp, 'app');
const home = path.join(tmp, 'home');
const FILE = 'src/date.ts';
let failures = 0;
const ok = (cond, msg, extra = '') => { if (cond) console.log(`ok   ${msg}`); else { failures++; console.log(`FAIL ${msg}\n${extra}`); } };
const git = (...a) => execFileSync('git', a, { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const run = (args, env = {}) => { try { return execFileSync(process.execPath, [CLI, ...args], { cwd: app, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FIXLOCK_HOME: home, ...env } }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };

/** Minimal MCP client over stdio. */
function client(env) {
  const p = spawn(process.execPath, [CLI, 'mcp'], { cwd: app, env: { ...process.env, ...env } });
  let buf = ''; const waiting = new Map(); let id = 0;
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const m = JSON.parse(line);
      if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    }
  });
  return {
    request: (method, params) => new Promise((resolve, reject) => {
      const n = ++id; waiting.set(n, resolve);
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
      setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
    }),
    notify: (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
    close: () => p.stdin.end(),
  };
}

(async () => {
  try {
    fs.mkdirSync(app, { recursive: true });
    git('init', '-q'); git('config', 'user.email', 'abi@fluxo.dev'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
    fs.mkdirSync(path.join(app, 'src'));
    fs.writeFileSync(path.join(app, FILE), [
      'export function toSapDate(d: Date): string {',
      "  const p = (n: number) => String(n).padStart(2, '0');",
      '  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;',
      '}', '',
    ].join('\n'));
    git('add', '.'); git('commit', '-qm', 'init');
    run(['init', '--yes']);
    run(['team', 'add', '--name', 'Abi', '--github', 'abinandhmj', '--email', 'abi@fluxo.dev', '--role', 'lead']);
    run(['team', 'add', '--name', 'Ravi', '--github', 'ravi', '--email', 'ravi@fluxo.dev', '--role', 'developer']);
    run(['mark', FILE, '2-3', '-m', 'SAP B1 rejects ISO timestamps', '--title', 'SAP date format']);
    git('add', '.'); git('commit', '-qm', 'chore: fixlock');

    ok(fs.existsSync(path.join(app, '.mcp.json')) && /fixlock/.test(fs.readFileSync(path.join(app, '.mcp.json'), 'utf8')), 'init --yes connects Claude Code via .mcp.json');
    ok(/fixlock_check_edit/.test(fs.readFileSync(path.join(app, 'AGENTS.md'), 'utf8')), 'rules files tell the AI to call fixlock_check_edit');

    // --- MCP protocol ---
    const c = client({ FIXLOCK_USER: 'ravi@fluxo.dev' });
    const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    ok(init.result && init.result.serverInfo.name === 'fixlock' && init.result.capabilities.tools && /fixlock_check_edit/.test(init.result.instructions), 'initialize returns server info, tools capability and instructions', JSON.stringify(init));
    c.notify('notifications/initialized');
    const old = await c.request('initialize', { protocolVersion: '1999-01-01' });
    ok(old.result.protocolVersion === '2025-06-18', 'unknown protocol version falls back to a supported one');
    const tl = await c.request('tools/list', {});
    const names = tl.result.tools.map((t) => t.name);
    ok(['fixlock_check_edit', 'fixlock_why', 'fixlock_list', 'fixlock_check_staged'].every((n) => names.includes(n)) && tl.result.tools.every((t) => t.inputSchema && t.annotations.readOnlyHint), 'tools/list exposes 4 read-only tools with schemas', names.join(','));

    const revert = await c.request('tools/call', { name: 'fixlock_check_edit', arguments: { file: FILE, old_text: '  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;', new_text: '  return d.toISOString();' } });
    const rv = revert.result;
    ok(rv.structuredContent.verdict === 'ask' && /ASK THE DEVELOPER FIRST/.test(rv.content[0].text) && /SAP date format/.test(rv.content[0].text) && /@abinandhmj/.test(rv.content[0].text), 'check_edit: reverting a locked fix → verdict ask, names fix + owner', JSON.stringify(rv));

    const abs = await c.request('tools/call', { name: 'fixlock_check_edit', arguments: { file: path.join(app, FILE), new_content: 'export const x = 1;\n' } });
    ok(abs.result.structuredContent.verdict === 'ask' && abs.result.structuredContent.locks.length === 1, 'check_edit works with an absolute path and a whole-file rewrite');

    const safe = await c.request('tools/call', { name: 'fixlock_check_edit', arguments: { file: FILE, old_text: '\n}\n', new_text: '\n}\n// end of file\n' } });
    ok(safe.result.structuredContent.verdict === 'ok' && /^OK/.test(safe.result.content[0].text), 'check_edit: harmless edit → ok', JSON.stringify(safe.result));

    const why = await c.request('tools/call', { name: 'fixlock_why', arguments: { file: FILE, line: 3 } });
    ok(/FIX-001/.test(why.result.content[0].text) && why.result.structuredContent.locks[0].youMayChange === false, 'why: explains the lock and that Ravi may not change it');
    const none = await c.request('tools/call', { name: 'fixlock_why', arguments: { file: FILE, line: 1 } });
    ok(/Nothing locked/.test(none.result.content[0].text), 'why: unlocked line reports nothing locked');

    const ls = await c.request('tools/call', { name: 'fixlock_list', arguments: {} });
    ok(ls.result.structuredContent.locks.length === 1 && /1 lock/.test(ls.result.content[0].text), 'list: returns the locks');

    fs.writeFileSync(path.join(app, FILE), 'export function toSapDate(d: Date): string {\n  return d.toISOString();\n}\n');
    git('add', FILE);
    const st = await c.request('tools/call', { name: 'fixlock_check_staged', arguments: {} });
    ok(/LOCKED FIX-001/.test(st.result.content[0].text), 'check_staged: flags the staged revert', st.result.content[0].text);
    git('checkout', 'HEAD', '--', FILE);

    const bad = await c.request('tools/call', { name: 'nope', arguments: {} });
    ok(bad.error && bad.error.code === -32602, 'unknown tool → JSON-RPC error');
    const nf = await c.request('resources/list', {});
    ok(nf.error && nf.error.code === -32601, 'unknown method → method not found');
    const noRepo = await c.request('tools/call', { name: 'fixlock_list', arguments: { repo: tmp } });
    ok(noRepo.result.isError && /git repository|not set up/.test(noRepo.result.content[0].text), 'outside a repo → friendly tool error', JSON.stringify(noRepo));
    const ping = await c.request('ping', {});
    ok(ping.result && !ping.error, 'ping');
    c.close();

    const owner = client({ FIXLOCK_USER: 'abi@fluxo.dev' });
    await owner.request('initialize', { protocolVersion: '2025-06-18' });
    const own = await owner.request('tools/call', { name: 'fixlock_check_edit', arguments: { file: FILE, old_text: '  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;', new_text: '  return d.toISOString();' } });
    ok(own.result.structuredContent.verdict === 'ok', 'owner editing their own fix → ok');
    owner.close();

    // --- setup per assistant ---
    const out = run(['setup', 'cursor', 'copilot', 'codex', 'gemini']);
    const cur = JSON.parse(fs.readFileSync(path.join(app, '.cursor/mcp.json'), 'utf8'));
    const vs = JSON.parse(fs.readFileSync(path.join(app, '.vscode/mcp.json'), 'utf8'));
    const gem = JSON.parse(fs.readFileSync(path.join(app, '.gemini/settings.json'), 'utf8'));
    const codex = fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8');
    ok(cur.mcpServers.fixlock.args.includes('mcp'), 'setup cursor → .cursor/mcp.json', out);
    ok(vs.servers.fixlock.type === 'stdio' && vs.servers.fixlock.args.includes('mcp'), 'setup copilot → .vscode/mcp.json (servers/stdio)');
    ok(gem.mcpServers.fixlock, 'setup gemini → .gemini/settings.json');
    ok(/\[mcp_servers\.fixlock\]/.test(codex) && /args = \[/.test(codex), 'setup codex → ~/.codex/config.toml');
    ok(fs.existsSync(path.join(app, '.cursor/rules/fixlock.mdc')) && fs.existsSync(path.join(app, '.github/copilot-instructions.md')), 'setup also writes the rules files for those assistants');
    fs.writeFileSync(path.join(app, '.vscode/mcp.json'), JSON.stringify({ servers: { other: { command: 'x' } } }));
    run(['setup', 'copilot']);
    const vs2 = JSON.parse(fs.readFileSync(path.join(app, '.vscode/mcp.json'), 'utf8'));
    ok(vs2.servers.other && vs2.servers.fixlock, 'setup keeps other MCP servers already configured');
    const again = run(['setup', 'codex']);
    ok(/unchanged/.test(again) && (fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8').match(/mcp_servers\.fixlock/g) || []).length === 1, 'setup is idempotent');
  } catch (e) {
    failures++; console.log('FAIL unexpected error', e);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\nMCP FAIL (${failures})` : '\nMCP PASS');
  process.exit(failures ? 1 : 0);
})();
