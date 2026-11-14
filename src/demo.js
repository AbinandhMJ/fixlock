'use strict';
// `fixlock demo`: a 60-second story in a throwaway git repo, using fixlock's real commands.
// Abi fixes a bug → it is auto-locked → Ravi's AI tries to undo it → commit warning → CI blocks the PR → Abi approves.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'fixlock.js');
const ABI = { name: 'Abi', email: 'abi@acme.dev', github: 'abinandhmj' };
const RAVI = { name: 'Ravi', email: 'ravi@acme.dev', github: 'ravi' };
const FILE = 'src/sap/date.ts';

function colors(on) {
  const w = (code) => (t) => (on ? `\x1b[${code}m${t}\x1b[0m` : String(t));
  return { bold: w(1), dim: w(2), red: w(31), green: w(32), yellow: w(33), cyan: w(36), lime: w('38;5;155') };
}

function run(opts = {}) {
  const tty = process.stdout.isTTY && !process.env.NO_COLOR;
  const c = colors(opts.color ?? tty);
  const fast = opts.fast || !process.stdout.isTTY;
  const pause = (ms) => { if (!fast) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
  const say = (t = '') => console.log(t);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-demo-'));
  const env = (who, extra = {}) => {
    const e = { ...process.env, NO_COLOR: '1', FIXLOCK_USER: who.email, ...extra };
    for (const k of Object.keys(e)) if (/^(GITHUB_|GH_|CHANGE_)/.test(k)) delete e[k];
    return e;
  };
  const git = (who, ...args) => execFileSync('git', ['-c', `user.name=${who.name}`, '-c', `user.email=${who.email}`, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const fixlock = (who, args, extra) => {
    try { return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: env(who, extra) }) }; }
    catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
  };
  const write = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  const show = (text, pick = () => true) => text.split('\n').filter((l) => l.trim() && pick(l)).forEach((l) => say(`   ${c.dim('│')} ${paint(l)}`));
  const paint = (l) => l
    .replace(/^(LOCKED|REVERTED FIX)/, (m) => c.red(c.bold(m)))
    .replace(/^APPROVED/, (m) => c.green(c.bold(m)))
    .replace(/^(REWRITE|WARNING)/, (m) => c.yellow(c.bold(m)))
    .replace(/(✖.*)$/, (m) => c.red(m)).replace(/(✔.*)$/, (m) => c.green(m)).replace(/^(🔒.*)$/, (m) => c.lime(m));
  const step = (n, title) => { pause(700); say(); say(`${c.lime(c.bold(n))} ${c.bold(title)}`); };
  const cmd = (t) => say(`   ${c.cyan('$')} ${t}`);

  try {
    git(ABI, 'init', '-q', '-b', 'main');
    write(FILE, 'export function toSapDate(d: Date): string {\n  return d.toISOString();\n}\n');
    write('src/orders/order.ts', 'export interface Order { id: string; docDate: Date }\n');
    git(ABI, 'add', '.'); git(ABI, 'commit', '-qm', 'chore: initial');
    fixlock(ABI, ['init', '--yes']);
    fixlock(ABI, ['team', 'add', '--name', ABI.name, '--github', ABI.github, '--email', ABI.email, '--role', 'lead']);
    fixlock(ABI, ['team', 'add', '--name', RAVI.name, '--github', RAVI.github, '--email', RAVI.email, '--role', 'developer']);
    git(ABI, 'add', '.'); git(ABI, 'commit', '-qm', 'chore: set up fixlock');

    say(c.bold('fixlock demo') + c.dim(' — what happens when an AI undoes a bug fix'));
    say(c.dim(`A throwaway repo in ${dir}. Nothing in your projects is touched.`));

    // 1. Abi fixes the bug
    step('1', 'Abi fixes a bug: SAP rejects ISO timestamps, so dates must be sent as yyyy-MM-dd');
    write(FILE, [
      'export function toSapDate(d: Date): string {',
      "  const p = (n: number) => String(n).padStart(2, '0');",
      '  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;',
      '}', '',
    ].join('\n'));
    git(ABI, 'add', '.'); git(ABI, 'commit', '-qm', 'fix(ENG-12): send SAP DocDate as yyyy-MM-dd', '-m', 'SAP B1 Service Layer rejects ISO timestamps for DocDate.');
    cmd('git commit -m "fix(ENG-12): send SAP DocDate as yyyy-MM-dd"');
    const al = fixlock(ABI, ['autolock', '--commit-result', '--no-sync']);
    show(al.out, (l) => /auto-locked/.test(l));
    say(c.dim('   The post-commit hook locked the lines that fixed the bug, owned by Abi, linked to ENG-12.'));

    // 2. Ravi's AI tries to undo it
    step('2', "Weeks later, Ravi's AI ports the order screen from the old portal…");
    say(c.dim('   …and wants to bring back the old toSapDate():'));
    say(`     ${c.red('- return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;')}`);
    say(`     ${c.green('+ return d.toISOString();')}`);
    pause(500);
    say(`   ${c.cyan('AI →')} fixlock_check_edit ${c.dim('(MCP; in Claude Code the pre-edit hook does this automatically)')}`);
    const before = fs.readFileSync(path.join(dir, FILE), 'utf8');
    const after = before.replace('  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;', '  return d.toISOString();');
    const cwd = process.cwd(); const prevUser = process.env.FIXLOCK_USER;
    let verdict;
    try {
      process.chdir(dir); process.env.FIXLOCK_USER = RAVI.email;
      verdict = require('./hook').evaluate({ file: path.join(dir, FILE), before, after });
    } finally { process.chdir(cwd); if (prevUser === undefined) delete process.env.FIXLOCK_USER; else process.env.FIXLOCK_USER = prevUser; }
    const label = { ask: c.yellow(c.bold('ASK THE DEVELOPER FIRST')), block: c.red(c.bold('DO NOT MAKE THIS CHANGE')), warn: c.yellow('WARNING'), ok: c.green('OK') }[verdict ? verdict.level : 'ok'];
    say(`   ${c.dim('│')} verdict: ${label}`);
    show(verdict ? verdict.reason : '', (l) => !/^AI:/.test(l) && !/^🔒 fixlock: heads up/.test(l));
    say(c.dim('   The AI stops and asks Ravi. Most of the time, this is where the bug stays fixed.'));

    // 3. Ravi commits anyway
    step('3', 'Suppose Ravi says "go ahead" and commits');
    git(RAVI, 'checkout', '-q', '-b', 'feature/orders');
    fs.writeFileSync(path.join(dir, FILE), after);
    git(RAVI, 'add', '.');
    cmd('git commit -am "feat(orders): port order screen"');
    const st = fixlock(RAVI, ['check', '--staged']);
    show(st.out, (l) => /^(LOCKED|! Heads up|\s+→)/.test(l));
    git(RAVI, 'commit', '-qm', 'feat(orders): port order screen');
    say(c.dim('   A warning, never a block: local work is never stopped.'));

    // 4. CI blocks the PR
    step('4', "CI runs fixlock on Ravi's pull request");
    cmd('npx fixlock check --base main');
    const ci = fixlock(RAVI, ['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: '' });
    show(ci.out, (l) => /^(LOCKED|\s+→|✖)/.test(l));
    say(`   ${c.red(c.bold(`exit ${ci.code}`))} ${c.dim('→ the PR cannot merge. Git itself saw no conflict at all.')}`);

    // 5. Owner decides
    step('5', 'Abi gets asked to review, and decides');
    say(c.dim('   Either Ravi restores the line, or Abi approves the PR because the change is intended:'));
    const ok = fixlock(RAVI, ['check', '--base', 'main'], { FIXLOCK_TEST_APPROVERS: ABI.github });
    show(ok.out, (l) => /^APPROVED/.test(l));
    say(`   ${c.green(c.bold(`exit ${ok.code}`))} ${c.dim('→ merge allowed, with the owner on record.')}`);

    pause(600);
    say();
    say(`${c.bold('Without fixlock')}, step 3 merges silently and the SAP bug is back in production.`);
    say();
    say(`Try it on your repo:  ${c.lime('npx @abinandhmj/fixlock init')}`);
    say(`Docs:                 ${c.cyan('https://abinandhmj.github.io/fixlock/')}`);
    if (opts.keep) say(c.dim(`\nDemo repo kept at ${dir}. Explore it: cd "${dir}" && npx fixlock list`));
    return { dir, verdict: verdict && verdict.level, ciBlocked: ci.code === 1, ciApproved: ok.code === 0, autolocked: /auto-locked/.test(al.out), stagedWarned: /Heads up/.test(st.out) };
  } finally {
    if (!opts.keep) try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir */ }
  }
}

module.exports = { run };
