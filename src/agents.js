'use strict';
// Detects which AI coding tools a team uses and writes each tool's native instruction file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const s = require('./store');
const team = require('./team');

const START = '<!-- fixlock:start -->';
const END = '<!-- fixlock:end -->';

// mode "block": fixlock owns a marked section inside a shared file.
// mode "own":   fixlock owns the whole file (rules folders).
const TOOLS = [
  { id: 'claude-code', label: 'Claude Code (CLI / VS Code / JetBrains)', repo: ['CLAUDE.md', '.claude'], home: ['.claude'], ext: ['anthropic.claude-code'], bin: ['claude'],
    files: [{ path: 'CLAUDE.md', mode: 'block' }], note: 'A fixlock hook in .claude/settings.json also checks every Edit/Write before it happens.' },
  { id: 'codex', label: 'OpenAI Codex (CLI / IDE extension)', repo: ['AGENTS.md', '.codex'], home: ['.codex'], ext: ['openai.chatgpt'], bin: ['codex'],
    files: [{ path: 'AGENTS.md', mode: 'block' }] },
  { id: 'cursor', label: 'Cursor', repo: ['.cursor', '.cursorrules'], home: ['.cursor'], bin: ['cursor'],
    files: [{ path: '.cursor/rules/fixlock.mdc', mode: 'own', front: '---\ndescription: Locked fixes and features (fixlock). Check before changing existing code.\nglobs:\nalwaysApply: true\n---\n' }] },
  { id: 'copilot', label: 'GitHub Copilot', repo: ['.github/copilot-instructions.md', '.github/instructions'], ext: ['github.copilot', 'github.copilot-chat'],
    files: [{ path: '.github/copilot-instructions.md', mode: 'block' }] },
  { id: 'windsurf', label: 'Windsurf', repo: ['.windsurf', '.windsurfrules'], home: ['.codeium/windsurf'], bin: ['windsurf'],
    files: [{ path: '.windsurf/rules/fixlock.md', mode: 'own', front: '---\ntrigger: always_on\n---\n' }] },
  { id: 'gemini', label: 'Gemini CLI / Gemini Code Assist', repo: ['GEMINI.md', '.gemini'], home: ['.gemini'], ext: ['google.geminicodeassist'], bin: ['gemini'],
    files: [{ path: 'GEMINI.md', mode: 'block' }] },
  { id: 'cline', label: 'Cline', repo: ['.clinerules'], ext: ['saoudrizwan.claude-dev'],
    files: [{ path: '.clinerules/fixlock.md', mode: 'own', legacyFile: '.clinerules' }] },
  { id: 'roo', label: 'Roo Code', repo: ['.roo', '.roorules'], ext: ['rooveterinaryinc.roo-cline'],
    files: [{ path: '.roo/rules/fixlock.md', mode: 'own' }] },
  { id: 'continue', label: 'Continue', repo: ['.continue'], home: ['.continue'], ext: ['continue.continue'],
    files: [{ path: '.continue/rules/fixlock.md', mode: 'own', front: '---\nname: fixlock locked fixes\nalwaysApply: true\n---\n' }] },
  { id: 'aider', label: 'Aider', repo: ['.aider.conf.yml', 'CONVENTIONS.md'], home: ['.aider.conf.yml'], bin: ['aider'],
    files: [{ path: 'CONVENTIONS.md', mode: 'block' }], after: ensureAiderRead },
  { id: 'amazonq', label: 'Amazon Q Developer', repo: ['.amazonq'], ext: ['amazonwebservices.amazon-q-vscode'],
    files: [{ path: '.amazonq/rules/fixlock.md', mode: 'own' }] },
  { id: 'junie', label: 'JetBrains Junie', repo: ['.junie'],
    files: [{ path: '.junie/guidelines.md', mode: 'block' }] },
];

const byId = (id) => TOOLS.find((t) => t.id === id);

/* ---------------- detection ---------------- */
function extensionDirs(home) {
  return ['.vscode', '.vscode-insiders', '.vscode-server', '.cursor', '.windsurf', '.vscodium']
    .map((d) => path.join(home, d, 'extensions')).filter((d) => fs.existsSync(d));
}

function onPath(cmd) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.ps1', ''] : [''];
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .some((dir) => exts.some((e) => { try { return fs.statSync(path.join(dir, cmd + e)).isFile(); } catch { return false; } }));
}

/** Returns [{ id, label, where: ["repo: CLAUDE.md", "VS Code extension", ...] }] */
function detect(root = s.root()) {
  const home = process.env.FIXLOCK_HOME || os.homedir();
  const exts = extensionDirs(home).flatMap((d) => { try { return fs.readdirSync(d).map((n) => n.toLowerCase()); } catch { return []; } });
  const out = [];
  for (const t of TOOLS) {
    const where = [];
    for (const r of t.repo || []) if (fs.existsSync(path.join(root, r))) where.push(`repo: ${r}`);
    for (const h of t.home || []) if (fs.existsSync(path.join(home, h))) where.push(`installed (~/${h})`);
    for (const e of t.ext || []) if (exts.some((n) => n === e || n.startsWith(e + '-'))) where.push(`extension: ${e}`);
    for (const b of t.bin || []) if (onPath(b)) where.push(`command: ${b}`);
    // our own generated files don't count as evidence
    const own = t.files.map((f) => f.path);
    const real = where.filter((w) => !own.some((o) => w === `repo: ${o}` && isOnlyOurs(path.join(root, o))));
    if (real.length) out.push({ id: t.id, label: t.label, where: real });
  }
  return out;
}

function isOnlyOurs(file) {
  try {
    const body = fs.readFileSync(file, 'utf8');
    return body.includes('fixlock') && body.replace(new RegExp(`${START}[\\s\\S]*?${END}`), '').replace(/^# \w+\s*$/m, '').replace(/^---[\s\S]*?---/, '').trim().length < 5;
  } catch { return false; }
}

/* ---------------- content ---------------- */
function body(tool) {
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const members = cfg.team.map((m) => `${m.name} (${m.role}${m.github ? ', @' + m.github : ''})`).join(', ');
  let md = '## Locked fixes & features — managed by fixlock (do not edit this section)\n\n';
  if (cfg.project) md += `Project: ${cfg.project}.${members ? ` Team: ${members}.` : ''}\n\n`;
  md += 'Rules for AI assistants working in this repo:\n';
  md += '0. **Never rewrite, delete or replace code that already works without telling the developer first.** Before changing existing lines, say which lines, why, and what behaviour could change, then wait for a yes. Prefer adding new code next to existing code over rewriting it.\n';
  md += '1. Before changing an existing line, check it: if you have the fixlock MCP tools, call `fixlock_check_edit` with the file and the exact text you will replace (or `fixlock_why` for a whole file); otherwise run `npx fixlock why <file>:<line>`. Follow the verdict: block = don\'t change it, ask = ask the developer first, warn = mention it.\n';
  md += '2. Locked lines fix real bugs or hold finished features. Do not delete, rewrite or "simplify" them, and never overwrite them with code from another codebase. Build around them.\n';
  md += '3. If the task cannot be done without changing a locked line, STOP and tell the developer which lock is affected and who owns it. The PR will need that person\'s approval.\n';
  md += '4. Keep diffs minimal: no unrelated refactors, renames or formatting changes.\n';
  md += '5. Write commit messages as Conventional Commits (`fix: …`, `feat: …`, `perf: …`). CHANGELOG.md is generated from them.\n';
  md += '6. Before finishing, run `npx fixlock check --staged` (or the `fixlock_check_staged` MCP tool) and report anything it flags.\n';
  if (tool.note) md += `\n${tool.note}\n`;
  md += '\n### Current locks\n';
  if (!reg.locks.length) md += '_Nothing locked yet._\n';
  for (const l of reg.locks) {
    const pol = cfg.policies[l.type] || cfg.policies.bug;
    md += `- **${l.id}** ${l.title} (${l.type}, owner ${team.handle(team.find(cfg, l.owner)) || l.owner}, on edit: ${pol.onEdit}) — \`${l.file}\`\n`;
    if (l.reason && l.reason !== l.title) md += `  - Why: ${l.reason}\n`;
    md += `  - Must keep: ${l.snippet.map((x) => '`' + x.trim().replace(/`/g, "'") + '`').join(' / ')}\n`;
  }
  return md;
}

/* ---------------- writing ---------------- */
function writeBlock(abs, content) {
  const section = `${START}\n${content}${END}`;
  let text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : `# ${path.basename(abs, path.extname(abs))}\n`;
  const re = new RegExp(`${START}[\\s\\S]*?${END}`);
  text = re.test(text) ? text.replace(re, section) : text.trimEnd() + '\n\n' + section + '\n';
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function writeOwn(abs, content, front = '') {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${front}<!-- Generated by fixlock. Run \`npx fixlock sync\` to update; edits here are overwritten. -->\n\n${content}`);
}

function ensureAiderRead(root) {
  const file = path.join(root, '.aider.conf.yml');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/CONVENTIONS\.md/.test(text)) return null;
  if (/^read:/m.test(text)) return 'aider: add CONVENTIONS.md to the existing `read:` list in .aider.conf.yml';
  fs.writeFileSync(file, text.trimEnd() + (text ? '\n' : '') + 'read: CONVENTIONS.md   # added by fixlock\n');
  return null;
}

/** Write instruction files for the configured tools. Returns { written: [paths], notes: [] }. */
function sync(cfg = s.loadConfig()) {
  const root = s.root();
  const written = []; const notes = [];
  for (const id of enabled(cfg)) {
    const t = byId(id);
    if (!t) { notes.push(`unknown AI tool "${id}" in config`); continue; }
    const content = body(t);
    for (const f of t.files) {
      if (f.legacyFile && fs.existsSync(path.join(root, f.legacyFile)) && fs.statSync(path.join(root, f.legacyFile)).isFile()) {
        writeBlock(path.join(root, f.legacyFile), content); written.push(f.legacyFile); continue;
      }
      const abs = path.join(root, f.path);
      if (f.mode === 'block') writeBlock(abs, content); else writeOwn(abs, content, f.front);
      written.push(f.path);
    }
    if (t.after) { const n = t.after(root); if (n) notes.push(n); }
  }
  writePrTemplate(root, written);
  return { written, notes };
}

function writePrTemplate(root, written) {
  const dir = path.join(root, '.github');
  const existing = ['pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md'].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  const block = '## fixlock\n- [ ] `npx fixlock check` passes, or the owners of affected locks have approved this PR\n- [ ] Bug fixed in this PR is locked with `npx fixlock mark …`\n- [ ] Existing behaviour changed (or "None"):\n';
  writeBlock(existing || path.join(dir, 'pull_request_template.md'), block);
  written.push(path.relative(root, existing || path.join(dir, 'pull_request_template.md')).split(path.sep).join('/'));
}

/** Tools listed in config; v0.1/0.2 configs fall back to agentFiles. */
function enabled(cfg) {
  if (Array.isArray(cfg.aiTools)) return cfg.aiTools;
  const files = cfg.agentFiles || ['CLAUDE.md', 'AGENTS.md'];
  return TOOLS.filter((t) => t.files.some((f) => files.includes(f.path))).map((t) => t.id);
}

module.exports = { TOOLS, byId, detect, sync, enabled, START, END };
