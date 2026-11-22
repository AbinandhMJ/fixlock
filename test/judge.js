'use strict';
// AI lock judgment: advice only, never changes the result. Uses a local "model" command and a fake
// Anthropic API, so no real model is called.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const J = require('../src/judge');

const BIN = path.join(__dirname, '..', 'bin', 'fixlock.js');
let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2000)}` : ''}`); console.error('JUDGE FAIL'); process.exit(1); } passed++; };

// parseAnswer
ok(JSON.stringify(J.parseAnswer('{"verdict":"preserved","explanation":"guard moved to line 9"}')) === '{"verdict":"preserved","explanation":"guard moved to line 9"}', 'parses a JSON answer');
ok(J.parseAnswer('Sure! ```json\n{"verdict": "BROKEN", "explanation": "zero is charged now"}\n```').verdict === 'broken', 'parses JSON inside other text, any case');
ok(J.parseAnswer('I think it is preserved because...').verdict === 'preserved', 'falls back to a verdict word');
ok(J.parseAnswer('no idea').verdict === 'unsure' && J.parseAnswer('').explanation === 'No answer.', 'anything else: unsure');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-judge-'));
const repo = path.join(tmp, 'shop');
fs.mkdirSync(repo);
const env = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_EVENT_PATH: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GITLAB_CI: '' };
const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' }).trim();
const run = (args, extra = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, ...args], { cwd: repo, env: { ...env, ...extra } });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => resolve({ status, stdout, stderr }));
});
const cfgFile = path.join(repo, '.fixlock', 'config.json');
const setJudge = (j) => { const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); c.judge = j; fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); };

let seen = null;
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    seen = { url: req.url, headers: req.headers, body: JSON.parse(body || '{}') };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: '{"verdict":"broken","explanation":"pay(0) now reaches charge(); the guard on old lines 2-3 is gone."}' }] }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'abi@x.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'pay.py'), 'def pay(amount):\n    if amount <= 0:\n        raise ValueError("amount must be positive")\n    return charge(amount)\n');
    git('add', '.'); git('commit', '-qm', 'init');
    await run(['init', '--yes', '--no-git-hooks']);
    const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); c.team.push({ name: 'Ravi', github: 'ravi', emails: ['ravi@x.com'], role: 'developer' }); fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2));
    await run(['mark', 'src/pay.py', '2-3', '-m', 'A charge of zero crashed the ledger', '--title', 'never charge zero', '--owner', 'ravi']);
    git('add', '.'); git('commit', '-qm', 'chore: lock');
    git('checkout', '-qb', 'move-guard');
    fs.writeFileSync(path.join(repo, 'src', 'pay.py'), 'def pay(amount):\n    check_positive(amount)\n    return charge(amount)\n\ndef check_positive(n):\n    if not n > 0:\n        raise ValueError("amount must be positive")\n');
    git('commit', '-qam', 'refactor: move the guard');

    // Off by default: nothing is asked
    let r = await run(['check', '--base', 'main']);
    ok(r.status === 1 && !/AI review/.test(r.stdout), 'off by default', r.stdout);

    // A local model command (nothing leaves the machine): sees the lock and the code, answers "preserved"
    const model = path.join(tmp, 'model.js');
    fs.writeFileSync(model, `const t = require('fs').readFileSync(0, 'utf8');
require('fs').writeFileSync(${JSON.stringify(path.join(tmp, 'prompt.txt'))}, t);
console.log(JSON.stringify({ verdict: t.includes('check_positive') ? 'preserved' : 'broken', explanation: 'The guard moved into check_positive (lines 5-7), called on line 2.' }));`);
    setJudge({ enabled: true, provider: 'command', command: `"${process.execPath}" "${model}"` });
    r = await run(['check', '--base', 'main', '--markdown', path.join(tmp, 'c.md')]);
    ok(r.status === 1 && /AI review: the fix looks preserved/.test(r.stdout) && /check_positive \(lines 5-7\)/.test(r.stdout), 'local command: its answer is shown, and the check still needs approval (advice only)', r.stdout + r.stderr);
    const p = fs.readFileSync(path.join(tmp, 'prompt.txt'), 'utf8');
    ok(/never charge zero/.test(p) && /A charge of zero crashed the ledger/.test(p) && /if amount <= 0:/.test(p) && /2:     check_positive\(amount\)/.test(p) && /Answer with JSON only/.test(p), 'the prompt has the lock, why it exists, the locked lines and the numbered file', p);
    ok(/AI review: the fix looks preserved \(/.test(fs.readFileSync(path.join(tmp, 'c.md'), 'utf8')) && /still needs its owner's approval/.test(fs.readFileSync(path.join(tmp, 'c.md'), 'utf8')), 'the PR comment has the AI note, marked as advice');

    // Anthropic API (fake): key header, version, default model; "broken" is shown in bold in the comment
    setJudge({ enabled: false, provider: 'anthropic' });
    r = await run(['check', '--base', 'main', '--judge', '--markdown', path.join(tmp, 'a.md')], { ANTHROPIC_API_KEY: 'sk-test', FIXLOCK_ANTHROPIC_URL: `http://127.0.0.1:${server.address().port}` });
    ok(r.status === 1 && /AI review: the fix looks broken \(claude-haiku-5-5\)/.test(r.stdout), '--judge with Anthropic: verdict shown', r.stdout + r.stderr);
    ok(seen.url === '/v1/messages' && seen.headers['x-api-key'] === 'sk-test' && seen.headers['anthropic-version'] === '2023-06-01' && seen.body.model === 'claude-haiku-5-5' && /never charge zero/.test(seen.body.messages[0].content), 'calls the Messages API with the key, version and default model', JSON.stringify(seen && { url: seen.url, model: seen.body.model }));
    ok(/\*\*AI review: the fix looks broken\*\*/.test(fs.readFileSync(path.join(tmp, 'a.md'), 'utf8')), '"broken" stands out in the PR comment');

    // No key: says so, result unchanged
    r = await run(['check', '--base', 'main', '--judge']);
    ok(r.status === 1 && /AI review couldn't run \(set ANTHROPIC_API_KEY\)/.test(r.stdout), 'no key: the note says what to set, the result is unchanged', r.stdout);

    // Approved or test-satisfied locks aren't sent to the model
    seen = null;
    r = await run(['check', '--base', 'main', '--judge'], { ANTHROPIC_API_KEY: 'sk-test', FIXLOCK_ANTHROPIC_URL: `http://127.0.0.1:${server.address().port}`, FIXLOCK_TEST_APPROVERS: 'ravi' });
    ok(r.status === 0 && seen === null && /APPROVED/.test(r.stdout), 'an approved lock is not sent to the model', r.stdout);

    // A clean change asks nothing
    git('checkout', '-q', 'main');
    r = await run(['check', '--base', 'main', '--judge'], { ANTHROPIC_API_KEY: 'sk-test', FIXLOCK_ANTHROPIC_URL: `http://127.0.0.1:${server.address().port}` });
    ok(r.status === 0 && seen === null, 'nothing changed: no model call');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`JUDGE PASS (${passed} checks)`);
})().catch((e) => { console.error(e); console.error('JUDGE FAIL'); process.exit(1); });
