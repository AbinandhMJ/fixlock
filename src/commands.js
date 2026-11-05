'use strict';
const fs = require('fs');
const path = require('path');
const g = require('./git');
const s = require('./store');

const norm = (l) => l.replace(/\s+/g, ' ').trim();
const trivial = (l) => /^[\s{}()[\];,]*$/.test(l);
const c = {
  red: (t) => `\x1b[31m${t}\x1b[0m`, green: (t) => `\x1b[32m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`, bold: (t) => `\x1b[1m${t}\x1b[0m`, dim: (t) => `\x1b[2m${t}\x1b[0m`,
};

/* ---------------- init ---------------- */
function init() {
  const cfg = s.loadConfig();
  const me = g.userEmail();
  if (me && !cfg.protectedAuthors.includes(me.toLowerCase())) cfg.protectedAuthors.push(me.toLowerCase());
  s.saveConfig(cfg);
  s.saveRegistry(s.loadRegistry());
  console.log(c.green('✔ fixlock initialised in .fixlock/'));
  console.log(`  protected authors: ${cfg.protectedAuthors.join(', ') || '(none)'}`);
  console.log(`  protected paths:   ${cfg.protectedPaths.join(', ')}`);
  console.log('\nNext: mark a fix →  fixlock mark <file> <start>-<end> -m "why"');
}

/* ---------------- mark ---------------- */
function mark(args) {
  const [file, range] = args._;
  if (!file || !range) throw new Error('Usage: fixlock mark <file> <start>[-<end>] -m "reason" [--test <spec>] [--title "..."]');
  const [start, end = start] = range.split('-').map((n) => parseInt(n, 10));
  const abs = path.join(s.root(), file);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${file}`);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  if (start < 1 || end > lines.length || start > end) throw new Error(`Line range ${range} is outside ${file} (1-${lines.length})`);

  const snippet = lines.slice(start - 1, end).filter((l) => !trivial(l));
  if (!snippet.length) throw new Error('Selected lines are all blank/braces — pick the lines that hold the fix.');

  const reg = s.loadRegistry();
  const fix = {
    id: s.nextId(reg),
    title: args.title || args.m || 'Untitled fix',
    reason: args.m || '',
    file,
    snippet,
    test: args.test || null,
    author: g.userEmail(),
    date: new Date().toISOString().slice(0, 10),
  };
  reg.fixes.push(fix);
  s.saveRegistry(reg);
  console.log(c.green(`✔ ${fix.id} registered`) + ` — ${file}:${start}-${end} (${snippet.length} line(s) guarded)`);
  syncAgentFiles(true);
}

/* ---------------- list / remove ---------------- */
function list() {
  const reg = s.loadRegistry();
  if (!reg.fixes.length) return console.log('No fixes registered yet.');
  for (const f of reg.fixes) {
    console.log(`${c.bold(f.id)}  ${f.title}`);
    console.log(c.dim(`       ${f.file}  ·  ${f.author}  ·  ${f.date}${f.test ? '  ·  test: ' + f.test : ''}`));
  }
}

function remove(args) {
  const id = args._[0];
  const reg = s.loadRegistry();
  const before = reg.fixes.length;
  reg.fixes = reg.fixes.filter((f) => f.id !== id);
  if (reg.fixes.length === before) throw new Error(`No fix with id ${id}`);
  s.saveRegistry(reg);
  console.log(c.green(`✔ ${id} removed`));
  syncAgentFiles(true);
}

/* ---------------- check ---------------- */
function check(args) {
  const base = args.base || process.env.FIXLOCK_BASE || 'origin/main';
  const cfg = s.loadConfig();
  const reg = s.loadRegistry();
  const root = s.root();
  const findings = [];
  const add = (kind, msg, detail = []) => findings.push({ kind, msg, detail });

  // 1. Registered fixes must still be present in the working tree (rename-aware).
  const renames = {};
  try { for (const ch of g.changedFiles(base)) if (ch.status === 'R') renames[ch.from] = ch.file; } catch { /* no base */ }
  for (const f of reg.fixes) {
    const target = renames[f.file] || f.file;
    const abs = path.join(root, target);
    if (!fs.existsSync(abs)) {
      add('fix', `${f.id} "${f.title}" — file ${f.file} was deleted`, [f.reason]);
      continue;
    }
    const content = new Set(fs.readFileSync(abs, 'utf8').split('\n').map(norm));
    const missing = f.snippet.filter((l) => !content.has(norm(l)));
    if (missing.length) {
      add('fix', `${f.id} "${f.title}" — fix lines missing from ${target}`,
        [`why: ${f.reason || '(no reason given)'}`, ...missing.map((l) => `- ${l.trim()}`),
          f.test ? `guard test: ${f.test}` : 'tip: add --test <spec> when marking so CI also runs a test'].filter(Boolean));
    }
  }

  // 2. Lines removed by this branch that protected authors wrote; 3. protected path changes.
  let diff = null;
  try { diff = g.removedLines(base); } catch (e) {
    console.log(c.yellow(`! Could not diff against ${base} (${e.message.split('\n')[0]}). Skipping author/path checks.`));
  }
  if (diff) {
    const authors = new Set(cfg.protectedAuthors.map((a) => a.toLowerCase()));
    for (const [file, lines] of Object.entries(diff.removed)) {
      if (authors.size) {
        const blame = g.blame(diff.mergeBase, file);
        const hits = lines.filter((l) => !(cfg.ignoreTrivialLines && trivial(l.text)) && authors.has(blame.get(l.line)));
        if (hits.length) {
          add('author', `${file} — ${hits.length} line(s) by a protected author removed or rewritten`,
            hits.slice(0, 8).map((h) => `L${h.line} (${blame.get(h.line)}): ${h.text.trim()}`)
              .concat(hits.length > 8 ? [`…and ${hits.length - 8} more`] : []));
        }
      }
    }
    for (const ch of g.changedFiles(base)) {
      const hit = cfg.protectedPaths.find((pp) => ch.file.startsWith(pp) || ch.from.startsWith(pp));
      if (hit) add('path', `${ch.file} — protected path (${hit}) ${{ M: 'modified', D: 'deleted', A: 'added', R: 'renamed' }[ch.status] || 'changed'}`);
    }
  }

  // Report
  const failing = findings.filter((f) => cfg.failOn.includes(f.kind));
  const label = { fix: c.red('REVERTED FIX'), author: c.red('PROTECTED CODE'), path: c.yellow('PROTECTED PATH') };
  if (args.json) {
    console.log(JSON.stringify({ base, ok: !failing.length, findings }, null, 2));
  } else {
    console.log(c.bold(`fixlock check  (base: ${base}, ${reg.fixes.length} registered fixes)\n`));
    if (!findings.length) console.log(c.green('✔ Clean — no registered fixes reverted, no protected code touched.'));
    for (const f of findings) {
      const tag = cfg.failOn.includes(f.kind) ? label[f.kind] : c.yellow(`${f.kind.toUpperCase()} (warn)`);
      console.log(`${tag}  ${f.msg}`);
      for (const d of f.detail) console.log(c.dim(`    ${d}`));
    }
    if (failing.length) {
      console.log(c.red(`\n✖ ${failing.length} blocking finding(s). Restore the code above, or get the owner to approve`));
      console.log(c.red('  and run `fixlock remove <id>` if the fix is genuinely no longer needed.'));
    }
  }
  if (args.markdown) fs.writeFileSync(args.markdown, toMarkdown(base, findings, cfg));
  process.exitCode = failing.length ? 1 : 0;
}

function toMarkdown(base, findings, cfg) {
  if (!findings.length) return `### ✅ fixlock\nNo registered fixes reverted and no protected code touched (base \`${base}\`).\n`;
  let md = `### ${findings.some((f) => cfg.failOn.includes(f.kind)) ? '❌' : '⚠️'} fixlock found ${findings.length} issue(s)\n\n`;
  for (const f of findings) {
    md += `- **${f.kind.toUpperCase()}** ${f.msg}\n`;
    if (f.detail.length) md += '  ```\n' + f.detail.map((d) => '  ' + d).join('\n') + '\n  ```\n';
  }
  return md;
}

/* ---------------- sync (CLAUDE.md / AGENTS.md) ---------------- */
const START = '<!-- fixlock:start -->';
const END = '<!-- fixlock:end -->';

function agentSection() {
  const reg = s.loadRegistry();
  const cfg = s.loadConfig();
  let md = `${START}\n## Known fixes — DO NOT REVERT (managed by fixlock)\n`;
  md += 'These lines fix real bugs. CI fails if they disappear. Never delete, rewrite or "simplify" them,\n';
  md += 'and never overwrite these files with code from the legacy portal. If a task conflicts with a fix, STOP and say so.\n\n';
  if (!reg.fixes.length) md += '_No fixes registered yet._\n';
  for (const f of reg.fixes) {
    md += `- **${f.id}** ${f.title} — \`${f.file}\`${f.test ? ` (test: \`${f.test}\`)` : ''}\n`;
    if (f.reason && f.reason !== f.title) md += `  - Why: ${f.reason}\n`;
    md += `  - Must keep: ${f.snippet.map((l) => '`' + l.trim().replace(/`/g, "'") + '`').join(' / ')}\n`;
  }
  if (cfg.protectedAuthors.length) {
    md += `\nCode last written by ${cfg.protectedAuthors.map((a) => '`' + a + '`').join(', ')} is protected:\n`;
    md += 'check `git blame -L <start>,<end> <file>` before changing an existing line and build around those lines.\n';
  }
  md += `\nBefore finishing, run \`npx fixlock check\` and fix anything it reports.\n${END}`;
  return md;
}

function syncAgentFiles(quiet) {
  const cfg = s.loadConfig();
  const section = agentSection();
  for (const name of cfg.agentFiles) {
    const abs = path.join(s.root(), name);
    let body = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : `# ${name.replace('.md', '')}\n`;
    const re = new RegExp(`${START}[\\s\\S]*?${END}`);
    body = re.test(body) ? body.replace(re, section) : body.trimEnd() + '\n\n' + section + '\n';
    fs.writeFileSync(abs, body);
    if (!quiet) console.log(c.green(`✔ synced ${name}`));
  }
  if (quiet) console.log(c.dim(`  synced ${cfg.agentFiles.join(', ')}`));
}

/* ---------------- install-hook ---------------- */
function installHook() {
  const hookDir = path.join(s.root(), '.git', 'hooks');
  const file = path.join(hookDir, 'pre-push');
  const script = '#!/bin/sh\n# installed by fixlock\ngit fetch -q origin main 2>/dev/null\nnpx --no-install fixlock check --base origin/main || {\n  echo "\\nfixlock: push blocked. Use git push --no-verify only if the owner approved."; exit 1; }\n';
  fs.mkdirSync(hookDir, { recursive: true });
  fs.writeFileSync(file, script, { mode: 0o755 });
  console.log(c.green('✔ pre-push hook installed'));
}

module.exports = { init, mark, list, remove, check, sync: () => syncAgentFiles(false), installHook };
