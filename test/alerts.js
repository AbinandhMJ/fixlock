'use strict';
// Slack / Teams / webhook alerts: what changed since the last run, one message per run, merged-while-blocked.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const A = require('../src/alerts');

const BIN = path.join(__dirname, '..', 'bin', 'fixlock.js');
let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${String(extra).slice(0, 2500)}` : ''}`); console.error('ALERTS FAIL'); process.exit(1); } passed++; };

// Pure: events only on change of state
const lock = { id: 'FIX-001', title: 'never charge zero', file: 'pay.py' };
const f = (status, extra = {}) => ({ kind: 'lock', lock, file: 'pay.py', status, approvers: [{ name: 'Ravi', github: 'ravi', slack: 'U0RAVI' }], ...extra });
ok(A.events([f('blocked')], null).map((e) => e.type).join() === 'blocked', 'first run, blocked: alert');
ok(A.events([f('blocked')], { 'FIX-001': 'blocked' }).length === 0, 'still blocked: no repeat');
ok(A.events([f('approved')], { 'FIX-001': 'blocked' }).map((e) => e.type).join() === 'approved', 'approved after blocked: alert');
ok(A.events([f('blocked', { test: { status: 'failed' } })], { 'FIX-001': 'blocked' }).map((e) => e.type).join() === 'test-failed', 'a test starts failing: alert');
ok(A.readState(`x${A.stateComment({ 'FIX-001': 'blocked' })}y`)['FIX-001'] === 'blocked' && A.readState('nothing') === null, 'state round-trips through the hidden comment');
const team = require('../src/team');
const msg = A.compose(A.events([f('blocked')], null), { number: '#12', url: 'https://gh/p/12', title: 'Simplify pay', author: '@meena' }, team);
const slack = A.slackPayload(msg, { number: '#12', url: 'https://gh/p/12', title: 'Simplify pay', author: '@meena' });
ok(/<https:\/\/gh\/p\/12\|fixlock: #12 changes a locked fix and needs approval>/.test(slack.blocks[0].text.text) && /approval from <@U0RAVI>/.test(slack.blocks[0].text.text), 'Slack: linked title, and the owner @-mentioned', JSON.stringify(slack));
const teams = A.teamsPayload(msg, { url: 'https://gh/p/12', title: 'Simplify pay' });
ok(teams.attachments[0].contentType === 'application/vnd.microsoft.card.adaptive' && teams.attachments[0].content.actions[0].url === 'https://gh/p/12' && !JSON.stringify(teams).includes('<@'), 'Teams: an Adaptive Card with a button, no Slack mentions', JSON.stringify(teams));

// End to end, with a fake GitHub API and fake webhooks
const got = { slack: [], teams: [], hook: [] };
let comments = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    if (req.url.startsWith('/slack')) got.slack.push(JSON.parse(body));
    else if (req.url.startsWith('/teams')) got.teams.push(JSON.parse(body));
    else if (req.url.startsWith('/hook')) got.hook.push(JSON.parse(body));
    else if (req.url.startsWith('/repos/acme/shop/issues/12/comments')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(comments)); }
    else if (req.url.startsWith('/repos/acme/shop/pulls/12/reviews')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('[]'); }
    res.writeHead(200); res.end('ok');
  });
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-alerts-'));
const repo = path.join(tmp, 'shop');
fs.mkdirSync(repo);
const env = { ...process.env, NO_COLOR: '1', FIXLOCK_GITHUB_LOGIN: 'abi', GITLAB_CI: '', BITBUCKET_PR_ID: '', GH_TOKEN: '' };
const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' }).trim();
const run = (args, extra) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, ...args], { cwd: repo, env: { ...env, ...extra } });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => resolve({ status, stdout, stderr }));
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const event = (action, merged = false) => { const p = path.join(tmp, `event-${action}.json`); fs.writeFileSync(p, JSON.stringify({ action, pull_request: { number: 12, title: 'Simplify pay', html_url: 'https://github.com/acme/shop/pull/12', user: { login: 'meena' }, merged } })); return p; };
  const ci = (ev) => ({ GITHUB_EVENT_PATH: ev, GITHUB_REPOSITORY: 'acme/shop', GITHUB_TOKEN: 't', FIXLOCK_GITHUB_API: base, FIXLOCK_SLACK_WEBHOOK: `${base}/slack`, FIXLOCK_TEAMS_WEBHOOK: `${base}/teams`, FIXLOCK_ALERT_WEBHOOK: `${base}/hook` });
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'abi@x.com'); git('config', 'user.name', 'Abi'); git('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(repo, 'pay.py'), 'def pay(amount):\n    if amount <= 0:\n        raise ValueError("bad")\n    return charge(amount)\n');
    git('add', '.'); git('commit', '-qm', 'init');
    await run(['init', '--yes', '--no-git-hooks'], {});
    await run(['team', 'add', '--name', 'Ravi', '--github', 'ravi', '--slack', 'U0RAVI', '--role', 'developer'], {});
    await run(['mark', 'pay.py', '2-3', '-m', 'zero crashed the ledger', '--title', 'never charge zero', '--owner', 'ravi'], {});
    git('add', '.'); git('commit', '-qm', 'chore: lock');
    git('checkout', '-qb', 'simplify');
    fs.writeFileSync(path.join(repo, 'pay.py'), 'def pay(amount):\n    return charge(amount)\n');
    git('commit', '-qam', 'refactor: simplify');

    const md = path.join(tmp, 'c.md');
    let r = await run(['check', '--base', 'main', '--markdown', md], ci(event('synchronize')));
    ok(r.status === 1 && !got.slack.length, 'no --alert: no alerts', r.stdout);
    ok(/<!-- fixlock-state \{"FIX-001":"blocked"\} -->/.test(fs.readFileSync(md, 'utf8')), 'the PR comment carries the hidden state');

    r = await run(['check', '--base', 'main', '--alert', '--markdown', md], ci(event('synchronize')));
    ok(r.status === 1 && got.slack.length === 1 && got.teams.length === 1 && got.hook.length === 1 && /Alerted: slack, teams, webhook/.test(r.stdout), 'first blocked run: one alert to each channel', r.stdout + r.stderr);
    ok(/github\.com\/acme\/shop\/pull\/12\|fixlock: #12 changes a locked fix/.test(got.slack[0].blocks[0].text.text) && /"Simplify pay" by @meena/.test(got.slack[0].blocks[0].text.text) && /<@U0RAVI>/.test(got.slack[0].blocks[0].text.text), 'Slack message: PR link, title, author, owner mention', JSON.stringify(got.slack[0]));
    ok(got.hook[0].events[0].type === 'blocked' && got.hook[0].pr.url === 'https://github.com/acme/shop/pull/12', 'webhook JSON');

    comments = [{ body: fs.readFileSync(md, 'utf8') }]; // the Action posted the comment
    r = await run(['check', '--base', 'main', '--alert', '--markdown', md], ci(event('synchronize')));
    ok(got.slack.length === 1, 'pushed again, still blocked: no repeat alert', r.stdout);

    // Merged while blocked
    r = await run(['check', '--base', 'main', '--alert', '--markdown', md], ci(event('closed', true)));
    ok(r.status === 0 && got.slack.length === 2 && /merged while a locked fix still needed approval/.test(got.slack[1].text) && /FIX-001: merged while blocked/.test(got.slack[1].blocks[0].text.text), 'merged while blocked: alert', r.stdout + JSON.stringify(got.slack[1]));
    r = await run(['check', '--base', 'main', '--alert'], ci(event('closed', false)));
    ok(r.status === 0 && got.slack.length === 2, 'closed without merging: nothing');

    // Approved after blocked
    r = await run(['check', '--base', 'main', '--alert', '--markdown', md], { ...ci(event('synchronize')), FIXLOCK_TEST_APPROVERS: 'ravi' });
    ok(r.status === 0 && got.slack.length === 3 && /FIX-001 "never charge zero" in pay\.py: approved/.test(got.slack[2].blocks[0].text.text), 'approved: alert', r.stdout + JSON.stringify(got.slack));

    // alerts.on filters event types
    const cf = path.join(repo, '.fixlock', 'config.json');
    const c = JSON.parse(fs.readFileSync(cf, 'utf8')); c.alerts = { on: ['merged-blocked'] }; fs.writeFileSync(cf, JSON.stringify(c));
    comments = [];
    r = await run(['check', '--base', 'main', '--alert'], ci(event('synchronize')));
    ok(got.slack.length === 3, 'alerts.on: only the events the team wants');

    // A webhook that fails doesn't fail the check
    c.alerts = {}; fs.writeFileSync(cf, JSON.stringify(c));
    r = await run(['check', '--base', 'main', '--alert'], { ...ci(event('synchronize')), FIXLOCK_SLACK_WEBHOOK: 'http://127.0.0.1:9/nope' });
    ok(r.status === 1 && /slack \(failed/.test(r.stdout), 'a failing webhook is reported, the result is unchanged', r.stdout);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`ALERTS PASS (${passed} checks)`);
})().catch((e) => { console.error(e); console.error('ALERTS FAIL'); process.exit(1); });
