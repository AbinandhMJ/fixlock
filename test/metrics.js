#!/usr/bin/env node
// Weekly metrics report (scripts/metrics.js): table, change since the last report, missing sources.
'use strict';
const { report, previousValues, METRICS } = require('../scripts/metrics');
let passed = 0;
const ok = (c, m, x) => { if (!c) { console.error(`FAIL ${m}\n${x || ''}`); console.error('METRICS FAIL'); process.exit(1); } passed++; };

const first = report({ npm: 120, pypi: 30, stars: 14, forks: 2, issues: 3, vscode: 40, openvsx: 5 }, null, '2026-11-23');
ok(METRICS.every(([, label]) => first.includes(`| ${label} |`)), 'every metric has a row');
ok(/\| npm downloads \(7 days\) \| 120 \| {2}\|/.test(first), 'first report: numbers, no change column values', first);
const prev = previousValues([{ body: 'unrelated comment' }, { body: first }, { body: 'thanks!' }]);
ok(prev && prev.npm === 120 && prev.vscode === 40, 'reads the numbers back from the latest report');
const second = report({ npm: 1180, pypi: 30, stars: 20, forks: 2, issues: 1, openvsx: 9 }, prev, '2026-11-30', ['vscode: 500']);
ok(/\| npm downloads \(7 days\) \| 1,180 \| \+1,060 \|/.test(second) && /\| PyPI downloads \(7 days\) \| 30 \| 0 \|/.test(second) && /\| Open issues and PRs \| 1 \| -2 \|/.test(second), 'change since last report', second);
ok(/\| VS Code Marketplace installs \(total\) \| n\/a \| {2}\|/.test(second) && /Not available this week: vscode\./.test(second), 'a failed source shows n/a and is named', second);
ok(previousValues([{ body: 'nothing here' }]) === null, 'no earlier report → no change column');
console.log(`METRICS PASS (${passed} checks)`);
