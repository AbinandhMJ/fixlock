#!/usr/bin/env node
// Cross-platform end-to-end test for fixlock v0.2.
// Lead sets up the team → locks a bug fix (Linear issue moves to Done) → teammate's AI tries to
// rewrite it (Claude hook asks/blocks) → teammate's PR reverts it (CI blocks, Linear reopened)
// → owner approves the PR (CI passes).
'use strict';
const cleanEnv = require('./env');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'fixlock.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-e2e-'));
const app = path.join(tmp, 'app');
const ABI = 'abi@fluxo.dev';
const DEV = 'dev2@fluxo.dev';
const FILE = 'src/app/core/utils/date.util.ts';

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures++; console.log(`FAIL ${msg}\n${extra}`); }
};
const git = (...a) => execFileSync('git', a, { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (rel, body) => { const f = path.join(app, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };

function cli(args, { env = {}, input } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd: app, env: { ...cleanEnv(), NO_COLOR: '1', ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}

// --- mock Linear GraphQL API ---
const linearCalls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const q = JSON.parse(body);
    linearCalls.push(q);
    res.setHeader('Content-Type', 'application/json');
    if (q.query.includes('issue(id')) {
      res.end(JSON.stringify({ data: { issue: { id: 'uuid-1', team: { states: { nodes: [{ id: 's-done', name: 'Done' }, { id: 's-prog', name: 'In Progress' }] } } } } }));
    } else res.end(JSON.stringify({ data: { ok: { success: true } } }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const trackerEnv = { LINEAR_API_KEY: 'test', FIXLOCK_LINEAR_URL: `http://127.0.0.1:${server.address().port}/graphql` };
  try {
    execFileSync('git', ['init', '-q', '--bare', path.join(tmp, 'origin.git')]);
    execFileSync('git', ['clone', '-q', path.join(tmp, 'origin.git'), app], { stdio: 'ignore' });
    git('config', 'user.email', ABI); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
    git('checkout', '-q', '-b', 'main');
    write(FILE, 'export function toSapDate(d: Date): string {\n  return d.toISOString();\n}\n');
    git('add', '.'); git('commit', '-qm', 'init'); git('push', '-q', 'origin', 'HEAD:main');

    // 1. Team lead runs interactive init (answers piped in)
    const answers = [
      'Fluxo ERP',
      'Abi', 'abinandhmj', ABI, 'lead',
      'Dev Two', 'devtwo', DEV, 'developer',
      '',
      'claude-code,codex,cursor,copilot,aider',
      'ask', 'owner',        // bug fixes
      'warn', 'owner-or-lead', // features
      'ask', 'y',            // working-code guard, auto-lock
      'linear', 'Done', 'In Progress',
      'y', 'n', 'y',
    ].join('\n') + '\n';
    const init = await cli(['init', '--interactive'], { input: answers });
    ok(init.code === 0, 'interactive init succeeds', init.out);
    const cfg = JSON.parse(fs.readFileSync(path.join(app, '.fixlock/config.json'), 'utf8'));
    ok(cfg.team.length === 2 && cfg.team[1].role === 'developer' && cfg.team[0].github === 'abinandhmj', 'team + roles + GitHub saved');
    ok(cfg.policies.bug.onEdit === 'ask' && cfg.tracker.type === 'linear', 'policies + tracker saved');
    const settings = JSON.parse(fs.readFileSync(path.join(app, '.claude/settings.json'), 'utf8'));
    ok(JSON.stringify(settings).includes('fixlock hook claude'), 'Claude Code hook installed');

    // 2. Abi fixes the bug and locks it, linked to Linear
    write(FILE, [
      'export function toSapDate(d: Date): string {',
      '  // SAP B1 rejects timestamps; send yyyy-MM-dd',
      "  const p = (n: number) => String(n).padStart(2, '0');",
      '  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;',
      '}', '',
    ].join('\n'));
    const mark = await cli(['mark', FILE, '3-4', '-m', 'SAP B1 rejects ISO timestamps for DocDate', '--title', 'SAP date format', '--issue', 'linear:ENG-12'], { env: trackerEnv });
    ok(mark.code === 0 && /FIX-001 locked/.test(mark.out), 'fix locked', mark.out);
    ok(linearCalls.some((c) => c.variables && c.variables.s === 's-done'), 'Linear issue moved to Done', JSON.stringify(linearCalls));
    ok(/abinandhmj/.test(fs.readFileSync(path.join(app, '.github/CODEOWNERS'), 'utf8')), 'CODEOWNERS lists the owner');
    ok(/FIX-001\*\* SAP date format/.test(fs.readFileSync(path.join(app, 'CLAUDE.md'), 'utf8')), 'CLAUDE.md synced');
    const read = (f) => { try { return fs.readFileSync(path.join(app, f), 'utf8'); } catch { return ''; } };
    ok(/alwaysApply: true/.test(read('.cursor/rules/fixlock.mdc')) && /FIX-001/.test(read('.cursor/rules/fixlock.mdc')), 'Cursor rule (.mdc) generated');
    ok(/FIX-001/.test(read('.github/copilot-instructions.md')), 'Copilot instructions generated');
    ok(/FIX-001/.test(read('AGENTS.md')) && /FIX-001/.test(read('CONVENTIONS.md')) && /read: CONVENTIONS.md/.test(read('.aider.conf.yml')), 'Codex AGENTS.md + Aider CONVENTIONS.md generated');
    ok(/fixlock check/.test(read('.github/pull_request_template.md')), 'PR template generated');
    ok(/## \[Unreleased\][\s\S]*### Fixed[\s\S]*SAP date format \(FIX-001, @abinandhmj, linear:ENG-12\)/.test(read('CHANGELOG.md')), 'CHANGELOG Unreleased lists the fix', read('CHANGELOG.md'));
    git('add', '.'); git('commit', '-qm', 'fix: SAP date format'); git('push', '-q', 'origin', 'HEAD:main');

    // 2b. changelog picks up conventional commits; release freezes a version
    write('src/app/orders.ts', 'export const orders = [];\n');
    git('add', '.'); git('commit', '-qm', 'feat(orders): order approval screen');
    await cli(['changelog']);
    ok(/### Added[\s\S]*\*\*orders:\*\* order approval screen/.test(read('CHANGELOG.md')), 'CHANGELOG includes feat: commits', read('CHANGELOG.md'));
    const rel = await cli(['release', '1.0.0']);
    const cl = read('CHANGELOG.md');
    ok(rel.code === 0 && /## \[1\.0\.0\] - \d{4}-\d\d-\d\d[\s\S]*SAP date format/.test(cl) && /\[Unreleased\]\s+_No changes yet._/.test(cl), 'release 1.0.0 freezes the changelog', cl);
    git('add', '.'); git('commit', '-qm', 'chore: release 1.0.0'); git('push', '-q', 'origin', 'HEAD:main');

    // 2c. detection of AI tools from editor extensions
    const fakeHome = path.join(tmp, 'home');
    fs.mkdirSync(path.join(fakeHome, '.vscode', 'extensions', 'saoudrizwan.claude-dev-3.2.0'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.vscode', 'extensions', 'openai.chatgpt-0.5.1'), { recursive: true });
    const tools = await cli(['tools'], { env: { FIXLOCK_HOME: fakeHome } });
    ok(/extension: saoudrizwan\.claude-dev/.test(tools.out) && /extension: openai\.chatgpt/.test(tools.out) && /tools add[^\n]*cline/.test(tools.out), 'detects Cline + Codex from VS Code extensions and suggests enabling', tools.out);
    const add = await cli(['tools', 'add', 'cline']);
    ok(add.code === 0 && /FIX-001/.test(read('.clinerules/fixlock.md')), '`tools add cline` writes .clinerules/fixlock.md', add.out);
    git('add', '.'); git('commit', '-qm', 'chore: enable cline'); git('push', '-q', 'origin', 'HEAD:main');

    // 2d. auto-lock from a fix commit
    write('src/app/invoice.ts', 'export function total(c) {\n  if (!c || !c.lines) return 0; // customer can be null from SAP\n  return c.lines.reduce((a, l) => a + l.amount, 0);\n}\n');
    git('add', '.'); git('commit', '-qm', 'fix(ENG-15): handle null customer in invoice total');
    const al = await cli(['autolock', '--commit-result', '--no-sync']);
    const reg2 = JSON.parse(read('.fixlock/registry.json'));
    const auto1 = reg2.locks.find((l) => l.file === 'src/app/invoice.ts');
    ok(al.code === 0 && auto1 && auto1.issue === 'linear:ENG-15' && auto1.owner === 'abinandhmj' && auto1.source.auto, 'fix: commit auto-locked with owner + Linear issue', al.out);
    ok(/^chore\(fixlock\): lock FIX-/.test(git('log', '-1', '--pretty=%s')), 'locks saved in a follow-up chore(fixlock) commit');

    // 2e. backfill: an old non-conventional "fixed ... bug" commit gets locked too
    write('src/app/tax.ts', 'export const round = (n) =>\n  Math.round((n + Number.EPSILON) * 100) / 100; // was losing paise\n');
    git('add', '.'); git('commit', '-qm', 'fixed rounding bug in GST totals');
    const dry = await cli(['autolock', '--all', '--dry-run']);
    ok(/src\/app\/tax\.ts/.test(dry.out) && !/date\.util|invoice/.test(dry.out), 'backfill dry-run finds the old fix and skips already-locked ones', dry.out);
    ok(!/CODEOWNERS|\.cursor|\.aider|\.claude|copilot-instructions/.test(dry.out), 'backfill never locks files fixlock or AI tools generate', dry.out);
    await cli(['autolock', '--all', '--no-sync']);
    ok(JSON.parse(read('.fixlock/registry.json')).locks.some((l) => l.file === 'src/app/tax.ts'), 'backfill locks it');

    // 2f. unlocked but working code (not a fix commit)
    write('src/app/customer.ts', ['export function name(c) {', '  return c.firstName + " " + c.lastName;', '}', 'export function code(c) {', '  return "C-" + c.id;', '}', 'export function active(c) {', '  return c.status === "A";', '}', ''].join('\n'));
    git('add', '.'); git('commit', '-qm', 'chore: customer helpers');
    git('push', '-q', 'origin', 'HEAD:main');

    // 3. why
    const why = await cli(['why', `${FILE}:3`], { env: { FIXLOCK_USER: DEV } });
    ok(/FIX-001/.test(why.out) && /@abinandhmj/.test(why.out), '`why` explains the lock and owner', why.out);

    // 4. Claude hook: teammate's AI tries to rewrite the fix
    const abs = path.join(app, FILE);
    const hookInput = (old, neu) => JSON.stringify({ tool_name: 'Edit', cwd: app, tool_input: { file_path: abs, old_string: old, new_string: neu } });
    const revert = hookInput("  const p = (n: number) => String(n).padStart(2, '0');\n  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;", '  return d.toISOString();');
    let h = await cli(['hook', 'claude'], { env: { FIXLOCK_USER: DEV }, input: revert });
    let j = {}; try { j = JSON.parse(h.out); } catch { /* */ }
    ok(j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision === 'ask', 'hook ASKS the developer before the AI reverts the fix', h.out);
    ok(/SAP date format/.test(h.out) && /@abinandhmj/.test(h.out), 'warning names the fix and its owner');

    h = await cli(['hook', 'claude'], { env: { FIXLOCK_USER: ABI }, input: revert });
    ok(h.out.trim() === '', 'owner editing their own fix gets no prompt', h.out);

    const nearby = hookInput('  // SAP B1 rejects timestamps; send yyyy-MM-dd\n  const p', '  // SAP needs yyyy-MM-dd\n  const p');
    h = await cli(['hook', 'claude'], { env: { FIXLOCK_USER: DEV }, input: nearby });
    ok(/systemMessage/.test(h.out) && !/permissionDecision/.test(h.out), 'touching but keeping the lines only warns', h.out);

    // working-code guard
    const cust = path.join(app, 'src/app/customer.ts');
    const rewrite = JSON.stringify({ tool_name: 'Write', cwd: app, tool_input: { file_path: cust, content: 'export const name = (c) => c.fullName;\n' } });
    h = await cli(['hook', 'claude'], { env: { FIXLOCK_USER: DEV }, input: rewrite });
    ok(/"permissionDecision":"ask"/.test(h.out) && /code that already works/.test(h.out) && /@abinandhmj/.test(h.out), 'AI rewrite of someone else\'s working code ASKS the developer', h.out);
    h = await cli(['hook', 'claude'], { env: { FIXLOCK_USER: ABI }, input: rewrite });
    ok(h.out.trim() === '', 'your own fresh code can be rewritten without a prompt', h.out);
    write('src/app/draft.ts', 'a\nb\nc\nd\n');
    h = await cli(['hook', 'claude'], { env: { FIXLOCK_USER: DEV }, input: JSON.stringify({ tool_name: 'Write', cwd: app, tool_input: { file_path: path.join(app, 'src/app/draft.ts'), content: 'x\n' } }) });
    ok(h.out.trim() === '', 'uncommitted work is free to change', h.out);
    fs.rmSync(path.join(app, 'src/app/draft.ts'));
    const settings2 = JSON.parse(read('.claude/settings.json'));
    ok(settings2.permissions.deny.includes('Edit(.claude/settings.json)'), 'AI cannot edit the hook settings to switch it off');
    const rules = read('AGENTS.md');
    ok(/Never rewrite, delete or replace code that already works without telling the developer first/.test(rules), 'every AI rules file says: never rewrite working code without telling the developer');

    cfg.policies.bug.onEdit = 'block';
    fs.writeFileSync(path.join(app, '.fixlock/config.json'), JSON.stringify(cfg, null, 2));
    h = await cli(['hook', 'claude'], { env: { FIXLOCK_USER: DEV }, input: revert });
    ok(/"permissionDecision":"deny"/.test(h.out), 'block policy DENIES the AI edit', h.out);
    git('checkout', '-q', '--', '.fixlock/config.json');

    // 5. Teammate's PR reverts it anyway (git sees no conflict)
    git('checkout', '-q', '-b', 'feature/port-orders');
    git('config', 'user.email', DEV); git('config', 'user.name', 'Dev Two');
    write(FILE, 'export function toSapDate(d: Date): string {\n  return d.toISOString();\n}\n');
    write('src/app/customer.ts', 'export const name = (c) => c.fullName;\n');
    git('add', FILE, 'src/app/customer.ts');
    const st = await cli(['check', '--staged']);
    ok(st.code === 0 && /Heads up/.test(st.out), 'pre-commit check warns but does not block', st.out);
    ok(/REWRITE\s+src\/app\/customer\.ts/.test(st.out), 'pre-commit warns about rewriting working code', st.out);
    git('commit', '-qm', 'feat: port orders from legacy portal');

    let chk = await cli(['check', '--base', 'origin/main', '--notify', '--markdown', path.join(tmp, 'r.md')], { env: { ...trackerEnv, FIXLOCK_TEST_APPROVERS: '' } });
    ok(chk.code === 1 && /LOCKED/.test(chk.out) && /needs approval from @abinandhmj/.test(chk.out), 'CI blocks the PR until the owner approves', chk.out);
    ok(/REWRITE/.test(chk.out) && /Rewrite of working code/.test(fs.readFileSync(path.join(tmp, 'r.md'), 'utf8')), 'CI PR comment flags the rewrite of working code', chk.out);
    ok(linearCalls.some((c) => c.variables && c.variables.s === 's-prog'), 'Linear issue reopened (In Progress) on regression');
    ok(/Approve this PR as @abinandhmj/.test(fs.readFileSync(path.join(tmp, 'r.md'), 'utf8')), 'PR comment markdown tells who must approve');

    chk = await cli(['check', '--base', 'origin/main'], { env: { FIXLOCK_TEST_APPROVERS: 'devtwo' } });
    ok(chk.code === 1, 'approval from a non-owner does not count');
    chk = await cli(['check', '--base', 'origin/main'], { env: { FIXLOCK_TEST_APPROVERS: 'abinandhmj' } });
    ok(chk.code === 0 && /APPROVED/.test(chk.out), 'owner approval unblocks the PR', chk.out);

    // 6. non-owner cannot unlock
    const rm = await cli(['remove', 'FIX-001']);
    ok(rm.code === 2 && /belongs to/.test(rm.out), 'non-owner cannot remove the lock', rm.out);
  } catch (e) {
    failures++; console.log('FAIL unexpected error', e);
  } finally {
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir; the OS cleans it */ }
  }
  console.log(failures ? `\nE2E FAIL (${failures})` : '\nE2E PASS');
  process.exit(failures ? 1 : 0);
})();
