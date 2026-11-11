'use strict';
// fixlock MCP server (stdio, JSON-RPC 2.0, newline-delimited). Zero dependencies.
// Lets any MCP-capable assistant (Claude Code, Cursor, GitHub Copilot in VS Code, Codex, Windsurf, Gemini CLI…)
// ask fixlock BEFORE it edits: is this line locked, who owns it, may I change it?
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = require('../package.json').version;
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = [
  'fixlock protects bug fixes and finished features that the team has locked, and code that already works.',
  'Before you modify or delete EXISTING lines in a file, call fixlock_check_edit with the file and the exact text you plan to replace.',
  'If the verdict is "block", do not make that change: build around those lines and tell the developer which lock is involved.',
  'If the verdict is "ask", explain the finding to the developer and only continue if they agree.',
  'If the verdict is "warn", mention it in your summary. "ok" means go ahead.',
  'Use fixlock_why to see what is locked in a file before planning a refactor.',
].join(' ');

const TOOLS = [
  {
    name: 'fixlock_check_edit',
    title: 'Check an edit before making it',
    description: 'Call BEFORE modifying or deleting existing code. Says whether the change would undo a locked bug fix or feature, or rewrite code that already works, who owns it, and whether you may proceed (verdict: ok | warn | ask | block). Give either old_text + new_text (a targeted edit) or new_content (a whole-file rewrite).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path of the file to edit (absolute, or relative to the repo root).' },
        old_text: { type: 'string', description: 'Exact existing text you plan to replace.' },
        new_text: { type: 'string', description: 'Text that will replace old_text (empty to delete).' },
        new_content: { type: 'string', description: 'Full new file content, for whole-file rewrites.' },
        repo: { type: 'string', description: 'Repository root, if the file path is relative and the server runs elsewhere.' },
      },
      required: ['file'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'fixlock_why',
    title: 'What is locked here?',
    description: 'Lists locked bug fixes and features in a file (optionally only on given lines): what each one protects, why it exists, its owner, and whether the current developer may change it.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path (absolute, or relative to the repo root).' },
        line: { type: 'integer', minimum: 1, description: 'First line to check (optional).' },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to check (optional; defaults to line).' },
        repo: { type: 'string', description: 'Repository root (optional).' },
      },
      required: ['file'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'fixlock_list',
    title: 'List all locks',
    description: 'Lists every locked bug fix and feature in the repository with file, owner and reason. Useful before a large refactor or when porting code from another codebase.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'Repository root (optional).' } } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'fixlock_check_staged',
    title: 'Check staged changes',
    description: 'Runs fixlock on the currently staged git changes and reports locked fixes/features that would be changed and working code that is being rewritten. Call before committing.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'Repository root (optional).' } } },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];

/* ---------------- repo resolution ---------------- */
function gitRoot(dir) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

function existingDir(p) {
  let d = p;
  while (d && !fs.existsSync(d)) { const up = path.dirname(d); if (up === d) return null; d = up; }
  return d && fs.statSync(d).isDirectory() ? d : d && path.dirname(d);
}

/** Pick the repo for a call and chdir into it. Returns the root or throws a friendly error. */
function enterRepo(args) {
  if (args.repo && !gitRoot(path.resolve(args.repo))) {
    throw new Error(`"${args.repo}" is not inside a git repository. Pass the project root as "repo".`);
  }
  const candidates = [];
  if (args.repo) candidates.push(path.resolve(args.repo));
  if (args.file && path.isAbsolute(args.file)) candidates.push(existingDir(args.file));
  if (process.env.FIXLOCK_ROOT) candidates.push(path.resolve(process.env.FIXLOCK_ROOT));
  candidates.push(process.cwd());
  for (const c of candidates.filter(Boolean)) {
    const root = gitRoot(c);
    if (root) {
      process.chdir(root);
      if (!fs.existsSync(path.join(root, '.fixlock', 'config.json'))) {
        throw new Error(`fixlock is not set up in ${root}. Ask the developer to run "npx fixlock init".`);
      }
      return root;
    }
  }
  throw new Error('Could not find a git repository. Pass "repo" (the project root) or an absolute "file" path.');
}

function relFile(root, file) {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  return { abs, rel: require('./locks').repoRel(root, abs) };
}

/* ---------------- tools ---------------- */
const VERDICT_TEXT = {
  ok: 'OK: nothing locked or protected is affected. Go ahead.',
  warn: 'WARNING: you may proceed, but mention this to the developer.',
  ask: 'ASK THE DEVELOPER FIRST: explain the finding below and only continue if they agree.',
  block: 'DO NOT MAKE THIS CHANGE: leave these lines as they are and build around them. Tell the developer which lock is involved.',
};

function checkEdit(args) {
  const root = enterRepo(args);
  const { evaluate } = require('./hook');
  const { abs, rel } = relFile(root, args.file);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  let after; let touched = null; let note = '';
  if (typeof args.new_content === 'string') after = args.new_content;
  else if (typeof args.old_text === 'string' && args.old_text) {
    const i = before.indexOf(args.old_text);
    if (i === -1) note = 'Note: old_text was not found in the file, so only the file as a whole could be checked.';
    else touched = require('./locks').spanLines(before, i, args.old_text);
    after = i === -1 ? before : before.slice(0, i) + (args.new_text || '') + before.slice(i + args.old_text.length);
  } else {
    return { text: 'Give either old_text (+ new_text) or new_content so fixlock can see what changes.', isError: true };
  }
  const r = evaluate({ file: abs, before, after, touched });
  const verdict = r ? r.level : 'ok';
  const text = [VERDICT_TEXT[verdict], r ? r.reason : '', note].filter(Boolean).join('\n\n');
  return { text, structured: { verdict, file: rel, locks: r ? r.locks : [], workingCode: r ? r.stable : null } };
}

function why(args) {
  const root = enterRepo(args);
  const s = require('./store'); const team = require('./team'); const L = require('./locks');
  const cfg = s.loadConfig(); const reg = s.loadRegistry();
  const { abs, rel } = relFile(root, args.file);
  const lines = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n') : [];
  const from = args.line || 1; const to = args.end_line || args.line || Infinity;
  const me = team.current(cfg);
  const hits = reg.locks.filter((l) => l.file === rel).map((l) => ({ l, at: L.locate(l, lines) }))
    .filter(({ at }) => at.some((n) => n >= from && n <= to));
  if (!hits.length) return { text: `Nothing locked in ${rel}${args.line ? `:${from}${to !== from && to !== Infinity ? '-' + to : ''}` : ''}.`, structured: { file: rel, locks: [] } };
  const out = hits.map(({ l, at }) => {
    const pol = cfg.policies[l.type] || cfg.policies.bug;
    const owner = team.handle(team.find(cfg, l.owner)) || l.owner;
    return {
      id: l.id, title: l.title, type: l.type, owner, reason: l.reason || null,
      lines: at.length ? [Math.min(...at), Math.max(...at)] : null, mustKeep: l.snippet,
      onEdit: pol.onEdit, approvers: team.approvers(cfg, l).map(team.handle), youMayChange: team.exempt(cfg, l, me), issue: l.issue || null,
    };
  });
  const text = out.map((o) => `🔒 ${o.id} "${o.title}" (${o.type}, owner ${o.owner})${o.lines ? ` lines ${o.lines[0]}-${o.lines[1]}` : ''}\n` +
    (o.reason && o.reason !== o.title ? `   why: ${o.reason}\n` : '') +
    `   must keep: ${o.mustKeep.map((x) => x.trim()).join(' | ')}\n` +
    `   ${o.youMayChange ? 'the current developer may change this' : `on edit: ${o.onEdit}; PR approval from ${o.approvers.join(' or ') || 'nobody'}`}`).join('\n');
  return { text, structured: { file: rel, locks: out } };
}

function list(args) {
  enterRepo(args);
  const s = require('./store'); const team = require('./team');
  const cfg = s.loadConfig(); const reg = s.loadRegistry();
  const locks = reg.locks.map((l) => ({ id: l.id, type: l.type, title: l.title, file: l.file, owner: team.handle(team.find(cfg, l.owner)) || l.owner, reason: l.reason || null, issue: l.issue || null }));
  const text = locks.length
    ? `${locks.length} lock(s):\n` + locks.map((l) => `- ${l.id} (${l.type}) ${l.title} — ${l.file}, owner ${l.owner}`).join('\n')
    : 'Nothing is locked in this repository yet.';
  return { text, structured: { locks } };
}

function checkStaged(args) {
  const root = enterRepo(args);
  const cli = path.join(__dirname, '..', 'bin', 'fixlock.js');
  let out;
  try { out = execFileSync(process.execPath, [cli, 'check', '--staged', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }); }
  catch (e) { out = e.stdout || ''; }
  let j; try { j = JSON.parse(out); } catch { return { text: `Could not run the staged check:\n${out}`, isError: true }; }
  const lines = j.findings.map((f) => f.kind === 'lock' ? `- LOCKED ${f.lock} in ${f.file}: removed ${f.missing.map((x) => x.trim()).join(' | ')} → needs approval from ${(f.approvers || []).join(' or ')}`
    : f.kind === 'stable' ? `- REWRITE ${f.msg}` : `- ${f.kind.toUpperCase()} ${f.msg || f.file}`);
  return { text: j.findings.length ? `Staged changes affect protected code:\n${lines.join('\n')}` : 'Staged changes are clean: no locked fixes or features changed, no working code rewritten.', structured: j };
}

const HANDLERS = { fixlock_check_edit: checkEdit, fixlock_why: why, fixlock_list: list, fixlock_check_staged: checkStaged };

/* ---------------- JSON-RPC over stdio ---------------- */
function send(msg) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); }

function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;
  if (method === 'initialize') {
    const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
    return send({ id, result: { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fixlock', title: 'fixlock', version: VERSION }, instructions: INSTRUCTIONS } });
  }
  if (method === 'ping') return isRequest && send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const fn = HANDLERS[params.name];
    if (!fn) return send({ id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
    const cwd = process.cwd();
    try {
      const r = fn(params.arguments || {});
      const result = { content: [{ type: 'text', text: r.text }], isError: !!r.isError };
      if (r.structured) result.structuredContent = r.structured;
      return send({ id, result });
    } catch (e) {
      return send({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
    } finally { try { process.chdir(cwd); } catch { /* */ } }
  }
  if (isRequest) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  // notifications (initialized, cancelled, …) need no reply
}

function serve() {
  // Anything printed by shared code must not corrupt the protocol stream.
  console.log = (...a) => console.error(...a);
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      try { handle(msg); } catch (e) { if (msg.id !== undefined) send({ id: msg.id, error: { code: -32603, message: e.message } }); }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

module.exports = { serve, TOOLS, INSTRUCTIONS };
