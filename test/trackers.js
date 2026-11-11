'use strict';
const cleanEnv = require('./env');
// Checks the ClickUp, Notion and webhook adapters send the right requests (mock server).
const http = require('http');
const { sync } = require('../src/trackers');
const calls = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { calls.push({ m: req.method, u: req.url, h: req.headers, b: b ? JSON.parse(b) : null }); res.setHeader('Content-Type', 'application/json'); res.end('{}'); }); });
srv.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  Object.assign(process.env, { CLICKUP_TOKEN: 'cu', NOTION_TOKEN: 'nt', FIXLOCK_CLICKUP_URL: base, FIXLOCK_NOTION_URL: base });
  const lock = { id: 'FIX-001', title: 'SAP date', type: 'bug', file: 'a.ts', owner: 'abi' };
  const r = [];
  r.push(await sync({ tracker: { onFix: 'complete', onRegression: 'reopened' } }, { ...lock, issue: 'clickup:86abc' }, 'regression', { pr: '7' }));
  r.push(await sync({ tracker: { onFix: 'Fixed', statusProperty: 'Status' } }, { ...lock, issue: 'notion:page123' }, 'fixed'));
  r.push(await sync({ tracker: { url: `${base}/hook`, onRegression: 'reopened' } }, { ...lock, issue: 'bugasura:BUG-9' }, 'regression'));
  srv.close();
  const has = (f) => calls.some(f);
  const checks = [
    ['ClickUp status update', has((c) => c.m === 'PUT' && c.u === '/task/86abc' && c.b.status === 'reopened' && c.h.authorization === 'cu')],
    ['ClickUp comment', has((c) => c.u === '/task/86abc/comment' && /PR #7/.test(c.b.comment_text))],
    ['Notion status update', has((c) => c.m === 'PATCH' && c.u === '/pages/page123' && c.b.properties.Status.status.name === 'Fixed' && c.h['notion-version'])],
    ['Notion comment', has((c) => c.u === '/comments' && c.b.parent.page_id === 'page123')],
    ['Webhook (Bugasura via Zapier/Make)', has((c) => c.u === '/hook' && c.b.issue === 'BUG-9' && c.b.status === 'reopened')],
  ];
  let bad = 0;
  for (const [n, pass] of checks) { console.log(`${pass ? 'ok  ' : 'FAIL'} ${n}`); if (!pass) bad++; }
  console.log(r.join('\n'));
  console.log(bad ? 'TRACKERS FAIL' : 'TRACKERS PASS');
  process.exit(bad ? 1 : 0);
});
