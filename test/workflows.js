'use strict';
// Supply-chain guard for fixlock's own workflows and action.yml (see SECURITY.md):
// every third-party action pinned to a full commit SHA with its version in a comment (Dependabot keeps
// them current), every workflow with an explicit token-permissions block, no "@latest" tools in a run
// step, and no pull_request_target (which runs fork code with repository secrets).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dir = path.join(root, '.github', 'workflows');
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => path.join(dir, f)).concat(path.join(root, 'action.yml'));
let passed = 0;
const bad = [];
for (const f of files) {
  const name = path.relative(root, f);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const m = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(\s*#\s*(\S+))?/);
    if (m && !m[1].startsWith('./')) {
      const [, ref] = m[1].split('@');
      if (!/^[0-9a-f]{40}$/.test(ref || '') || !m[3]) bad.push(`${name}:${i + 1} not pinned to a commit SHA with a version comment: ${m[1]}`);
      else passed++;
    }
    if (/@latest\b/.test(line)) bad.push(`${name}:${i + 1} "@latest" runs whatever is published that day: pin a version`);
    if (/^\s*pull_request_target\s*:/.test(line)) bad.push(`${name}:${i + 1} pull_request_target runs untrusted code with secrets`);
  });
  if (!name.endsWith('action.yml')) {
    if (!lines.some((l) => /^permissions:/.test(l))) bad.push(`${name}: no top-level "permissions:" block (the token would get the repository default)`);
    else passed++;
  }
}
if (bad.length) { console.error(bad.join('\n')); console.error('WORKFLOWS FAIL'); process.exit(1); }
console.log(`WORKFLOWS PASS (${passed} checks)`);
