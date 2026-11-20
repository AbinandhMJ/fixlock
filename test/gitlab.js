'use strict';
// GitLab merge requests: `fixlock check --comment` in a GitLab MR pipeline, against a local fake GitLab API.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'fixlock.js');
let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2000)}` : ''}`); console.error('GITLAB FAIL'); process.exit(1); } passed++; };

const state = { approvedBy: [], author: 'meena', notes: [], calls: [], token: 'glpat-test' };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    state.calls.push(`${req.method} ${req.url}`);
    const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers['private-token'] !== state.token) return json(401, { message: '401 Unauthorized' });
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/v4/projects/42/merge_requests/7/approvals') return json(200, { approved_by: state.approvedBy.map((username) => ({ user: { username } })) });
    if (u.pathname === '/api/v4/projects/42/merge_requests/7') return json(200, { iid: 7, author: { username: state.author } });
    if (u.pathname === '/api/v4/projects/42/merge_requests/7/notes' && req.method === 'GET') return json(200, [{ id: 1, system: true, body: 'added 1 commit' }, ...state.notes]);
    if (u.pathname === '/api/v4/projects/42/merge_requests/7/notes' && req.method === 'POST') { const n = { id: 100 + state.notes.length, system: false, body: JSON.parse(body).body }; state.notes.push(n); return json(201, n); }
    const m = u.pathname.match(/^\/api\/v4\/projects\/42\/merge_requests\/7\/notes\/(\d+)$/);
    if (m && req.method === 'PUT') { const n = state.notes.find((x) => x.id === +m[1]); n.body = JSON.parse(body).body; return json(200, n); }
    json(404, { message: 'not found' });
  });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-gitlab-'));
const repo = path.join(tmp, 'shop');
fs.mkdirSync(repo);
const baseEnv = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_EVENT_PATH: '', GITHUB_REPOSITORY: '', CHANGE_ID: '', CHANGE_AUTHOR: '' };
const git = (...a) => execFileSync('git', a, { cwd: repo, env: baseEnv, encoding: 'utf8' }).trim();
const run = (args, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, ...args], { cwd: repo, env: { ...baseEnv, ...env } });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => resolve({ status, stdout, stderr }));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ci = { GITLAB_CI: 'true', CI_API_V4_URL: `http://127.0.0.1:${port}/api/v4`, CI_PROJECT_ID: '42', CI_MERGE_REQUEST_IID: '7', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main', FIXLOCK_GITLAB_TOKEN: state.token, GITLAB_USER_LOGIN: 'meena' };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'abi@x.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
    git('remote', 'add', 'origin', 'git@gitlab.com:acme/shop.git');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'pay.py'), 'def pay(amount):\n    if amount <= 0:\n        raise ValueError("amount must be positive")\n    return charge(amount)\n');
    git('add', '.'); git('commit', '-qm', 'init');
    let r = await run(['quickstart', '--no-locks', '--no-git-hooks'], {});
    ok(r.status === 0 && /PR check: \.gitlab-ci\.yml/.test(r.stdout), 'quickstart on a GitLab repo adds .gitlab-ci.yml', r.stdout + r.stderr);
    const yml = fs.readFileSync(path.join(repo, '.gitlab-ci.yml'), 'utf8');
    ok(/include:\n  - remote: https:\/\/raw\.githubusercontent\.com\/AbinandhMJ\/fixlock\/main\/ci\/gitlab\/fixlock\.gitlab-ci\.yml/.test(yml) && !fs.existsSync(path.join(repo, '.github', 'workflows', 'fixlock.yml')), 'it includes the fixlock template (no GitHub workflow)', yml);
    r = await run(['team', 'add', '--name', 'Ravi', '--gitlab', 'ravi.k', '--email', 'ravi@x.com', '--role', 'developer'], {});
    ok(r.status === 0 && JSON.parse(fs.readFileSync(path.join(repo, '.fixlock', 'config.json'), 'utf8')).team.some((m) => m.gitlab === 'ravi.k' && m.github === null), 'team add --gitlab', r.stdout + r.stderr);
    r = await run(['mark', 'src/pay.py', '2-3', '-m', 'A charge of zero crashed the ledger', '--title', 'never charge zero', '--owner', 'ravi.k'], {});
    ok(r.status === 0 && /owner @ravi\.k/.test(r.stdout), 'a lock owned by a GitLab user', r.stdout + r.stderr);
    git('add', '.'); git('commit', '-qm', 'chore: fixlock');
    git('checkout', '-qb', 'simplify');
    fs.writeFileSync(path.join(repo, 'src', 'pay.py'), 'def pay(amount):\n    return charge(amount)\n');
    git('commit', '-qam', 'refactor: simplify pay');

    // Not approved: blocked, one comment posted
    r = await run(['check', '--base', 'main', '--comment'], ci);
    ok(r.status === 1 && /LOCKED\s+FIX-001/.test(r.stdout) && /@ravi\.k/.test(r.stdout), 'MR without approval: blocked, owner named', r.stdout + r.stderr);
    ok(state.notes.length === 1 && state.notes[0].body.startsWith('<!-- fixlock -->') && /Needs approval: FIX-001/.test(state.notes[0].body) && /Approve this PR as @ravi\.k/.test(state.notes[0].body), 'one MR comment with the lock and who approves', JSON.stringify(state.notes));
    ok(state.calls.some((c) => c.includes('/merge_requests/7/approvals')), 'approvals read from the GitLab API');

    // Approved by the owner: passes, and the same comment is updated
    state.approvedBy = ['Ravi.K'];
    r = await run(['check', '--base', 'main', '--comment'], ci);
    ok(r.status === 0 && /APPROVED\s+FIX-001/.test(r.stdout), 'owner approved the MR: passes', r.stdout + r.stderr);
    ok(state.notes.length === 1 && /Approved: FIX-001/.test(state.notes[0].body) && state.calls.some((c) => c.startsWith('PUT ')), 'the same comment is edited, not a new one', JSON.stringify(state.notes));

    // Someone else approved: still blocked
    state.approvedBy = ['meena'];
    r = await run(['check', '--base', 'main'], ci);
    ok(r.status === 1, "someone else's approval doesn't count");

    // The owner opened the MR: their own change passes
    state.approvedBy = []; state.author = 'ravi.k';
    r = await run(['check', '--base', 'main'], ci);
    ok(r.status === 0, "the lock's owner opened the MR: passes", r.stdout);
    state.author = 'meena';

    // Default base from the MR's target branch
    git('update-ref', 'refs/remotes/origin/main', 'main');
    r = await run(['check'], ci);
    ok(r.status === 1 && /base origin\/main/.test(r.stdout), 'base defaults to origin/<target branch> in GitLab MR pipelines', r.stdout);

    // No token: blocked, and says how to fix it
    r = await run(['check', '--base', 'main', '--comment'], { ...ci, FIXLOCK_GITLAB_TOKEN: '' });
    ok(r.status === 1 && /FIXLOCK_GITLAB_TOKEN/.test(r.stdout), 'no token: blocked, the log says to add FIXLOCK_GITLAB_TOKEN', r.stdout);

    // Wrong token: the API error is shown, nothing crashes
    r = await run(['check', '--base', 'main', '--comment'], { ...ci, FIXLOCK_GITLAB_TOKEN: 'wrong' });
    ok(r.status === 1 && /GitLab API 401/.test(r.stdout), 'a bad token shows the API error', r.stdout + r.stderr);

    // Outside GitLab: unchanged behaviour
    r = await run(['check', '--base', 'main', '--comment'], {});
    ok(r.status === 1 && !/GitLab/.test(r.stdout), 'outside GitLab CI nothing GitLab happens');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`GITLAB PASS (${passed} checks)`);
})().catch((e) => { console.error(e); console.error('GITLAB FAIL'); process.exit(1); });
