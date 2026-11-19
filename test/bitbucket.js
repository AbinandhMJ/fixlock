'use strict';
// Bitbucket Cloud pull requests: `fixlock check --comment` in a Bitbucket Pipelines PR pipeline, against a
// local fake Bitbucket API.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'fixlock.js');
let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2000)}` : ''}`); console.error('BITBUCKET FAIL'); process.exit(1); } passed++; };

const state = { approved: [], author: 'meena', comments: [], calls: [], token: 'bb-token' };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    state.calls.push(`${req.method} ${req.url}`);
    const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Bearer ${state.token}`) return json(401, { type: 'error' });
    const u = new URL(req.url, 'http://x');
    const P = '/2.0/repositories/acme/shop/pullrequests/9';
    if (u.pathname === P) {
      return json(200, { id: 9, title: 'Simplify pay', author: { nickname: state.author },
        participants: [{ user: { nickname: 'Meena' }, approved: false }, ...state.approved.map((n) => ({ user: { nickname: n }, approved: true }))] });
    }
    if (u.pathname === `${P}/comments` && req.method === 'GET') return json(200, { values: state.comments });
    if (u.pathname === `${P}/comments` && req.method === 'POST') { const c = { id: 500 + state.comments.length, content: { raw: JSON.parse(body).content.raw } }; state.comments.push(c); return json(201, c); }
    const m = u.pathname.match(/\/comments\/(\d+)$/);
    if (m && req.method === 'PUT') { const c = state.comments.find((x) => x.id === +m[1]); c.content.raw = JSON.parse(body).content.raw; return json(200, c); }
    json(404, { type: 'error' });
  });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-bitbucket-'));
const repo = path.join(tmp, 'shop');
fs.mkdirSync(repo);
const baseEnv = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_EVENT_PATH: '', GITHUB_REPOSITORY: '', GITLAB_CI: '', CHANGE_ID: '', CHANGE_AUTHOR: '' };
const git = (...a) => execFileSync('git', a, { cwd: repo, env: baseEnv, encoding: 'utf8' }).trim();
const run = (args, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, ...args], { cwd: repo, env: { ...baseEnv, ...env } });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => resolve({ status, stdout, stderr }));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ci = { BITBUCKET_PR_ID: '9', BITBUCKET_REPO_FULL_NAME: 'acme/shop', BITBUCKET_PR_DESTINATION_BRANCH: 'main', BITBUCKET_GIT_HTTP_ORIGIN: 'https://bitbucket.org/acme/shop', FIXLOCK_BITBUCKET_API: `http://127.0.0.1:${server.address().port}/2.0`, FIXLOCK_BITBUCKET_TOKEN: state.token };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'abi@x.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
    git('remote', 'add', 'origin', 'git@bitbucket.org:acme/shop.git');
    fs.writeFileSync(path.join(repo, 'pay.py'), 'def pay(amount):\n    if amount <= 0:\n        raise ValueError("bad")\n    return charge(amount)\n');
    git('add', '.'); git('commit', '-qm', 'init');
    let r = await run(['quickstart', '--no-locks', '--no-git-hooks'], {});
    const pipe = fs.readFileSync(path.join(repo, 'bitbucket-pipelines.yml'), 'utf8');
    ok(r.status === 0 && /PR check: bitbucket-pipelines\.yml/.test(r.stdout) && /pull-requests:/.test(pipe) && /depth: full/.test(pipe) && /\$\{BITBUCKET_PR_DESTINATION_BRANCH\}/.test(pipe) && /check --base "origin\/\$\{BITBUCKET_PR_DESTINATION_BRANCH\}" --comment/.test(pipe), 'quickstart on Bitbucket adds the PR pipeline', r.stdout + pipe);
    {
      // A host that only mentions bitbucket.org in its path is not Bitbucket
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-bb-spoof-'));
      const g2 = (...a) => execFileSync('git', a, { cwd: other, env: baseEnv, encoding: 'utf8' });
      g2('init', '-q', '-b', 'main'); g2('config', 'user.email', 'abi@x.com'); g2('config', 'user.name', 'Abi');
      g2('remote', 'add', 'origin', 'https://evil.example/bitbucket.org/acme/shop.git');
      fs.writeFileSync(path.join(other, 'a.py'), 'x = 1\n'); g2('add', '.'); g2('commit', '-qm', 'init');
      execFileSync(process.execPath, [BIN, 'quickstart', '--no-locks', '--no-git-hooks'], { cwd: other, env: baseEnv, encoding: 'utf8' });
      ok(!fs.existsSync(path.join(other, 'bitbucket-pipelines.yml')), 'a remote that only mentions bitbucket.org in its path is not treated as Bitbucket');
      fs.rmSync(other, { recursive: true, force: true });
    }
    r = await run(['team', 'add', '--name', 'Ravi', '--bitbucket', 'ravi_k', '--role', 'developer'], {});
    ok(r.status === 0, 'team add --bitbucket');
    await run(['mark', 'pay.py', '2-3', '-m', 'zero crashed the ledger', '--title', 'never charge zero', '--owner', 'ravi_k'], {});
    git('add', '.'); git('commit', '-qm', 'chore: lock');
    git('checkout', '-qb', 'simplify');
    fs.writeFileSync(path.join(repo, 'pay.py'), 'def pay(amount):\n    return charge(amount)\n');
    git('commit', '-qam', 'refactor: simplify');
    git('update-ref', 'refs/remotes/origin/main', 'main');

    r = await run(['check', '--comment'], ci);
    ok(r.status === 1 && /base origin\/main/.test(r.stdout) && /LOCKED\s+FIX-001/.test(r.stdout) && /@ravi_k/.test(r.stdout), 'PR without approval: blocked; base from the destination branch', r.stdout + r.stderr);
    ok(state.comments.length === 1 && state.comments[0].content.raw.startsWith('<!-- fixlock -->') && /Needs approval: FIX-001/.test(state.comments[0].content.raw), 'one PR comment', JSON.stringify(state.comments));

    state.approved = ['Ravi_K'];
    r = await run(['check', '--comment'], ci);
    ok(r.status === 0 && /APPROVED\s+FIX-001/.test(r.stdout) && state.comments.length === 1 && /Approved: FIX-001/.test(state.comments[0].content.raw) && state.calls.some((x) => x.startsWith('PUT ')), 'owner approved: passes, same comment edited', r.stdout);

    state.approved = []; state.author = 'ravi_k';
    r = await run(['check'], ci);
    ok(r.status === 0, "the owner opened the PR: passes");
    state.author = 'meena';

    r = await run(['check', '--comment'], { ...ci, FIXLOCK_BITBUCKET_TOKEN: '' });
    ok(r.status === 1 && /FIXLOCK_BITBUCKET_TOKEN/.test(r.stdout), 'no token: blocked, says which variable to add', r.stdout);

    // Alerts carry the Bitbucket PR link and title
    let posted = null;
    const hook = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { posted = JSON.parse(b); res.end('ok'); }); });
    await new Promise((rs) => hook.listen(0, '127.0.0.1', rs));
    state.comments = [];
    r = await run(['check', '--alert'], { ...ci, FIXLOCK_ALERT_WEBHOOK: `http://127.0.0.1:${hook.address().port}/` });
    hook.close();
    ok(posted && posted.pr.url === 'https://bitbucket.org/acme/shop/pull-requests/9' && posted.pr.title === 'Simplify pay' && posted.pr.author === '@meena', 'alerts link to the Bitbucket PR', JSON.stringify(posted));
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`BITBUCKET PASS (${passed} checks)`);
})().catch((e) => { console.error(e); console.error('BITBUCKET FAIL'); process.exit(1); });
