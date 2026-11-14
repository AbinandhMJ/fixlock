#!/usr/bin/env node
// The accuracy benchmark's edits (bench/mutations.js), checked offline on small fixtures: each edit
// must do what its name says, and structural matching must judge it the way the benchmark expects.
'use strict';
const M = require('../bench/mutations');
const L = require('../src/locks');
const S = require('../src/structural');

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures++; console.log(`FAIL ${msg}\n${extra}`); }
};

const FIXTURES = [
  { file: 'guard.ts', range: [1, 2], text: [
    'export function guard(user, res) {',
    '  if (!user || user.role !== "admin") {',
    '    return res.status(403).json({ error: "forbidden" });',
    '  }',
    '}'] },
  { file: 'pay.py', range: [2, 3], text: [
    'def pay(order, amount):',
    '    """Charge once."""',
    '    if order is not None and amount <= 0:',
    '        raise ValueError("amount must be positive")',
    '    return gateway.charge(order.id, amount)'] },
  { file: 'flags.go', range: [1, 2], text: [
    'func check(flags []string) error {',
    '\tif len(flags) > 0 && flags[0] != "" {',
    '\t\treturn fmt.Errorf("unexpected flag %q", flags[0])',
    '\t}',
    '\treturn nil',
    '}'] },
];

for (const fx of FIXTURES) {
  fx.fam = S.family(fx.file);
  const content = fx.text.join('\n');
  const snippet = fx.text.slice(fx.range[0], fx.range[1] + 1);
  const lock = { file: fx.file, snippet };
  const judge = (after) => L.verifyLock(lock, after, { file: fx.file }).status;
  ok(judge(content) === 'intact', `${fx.file}: baseline intact`);
  for (const [name, fn] of Object.entries(M.benign)) {
    const after = M.apply(fn, fx.text, fx.range, fx.fam, fx.file);
    if (after === null) continue;
    ok(after !== content && judge(after) === 'intact', `${fx.file}: benign "${name}" changes the text but stays intact`, after);
  }
  const ren = M.apply(M.rename, fx.text, fx.range, fx.fam, fx.file);
  ok(ren !== null && /Renamed/.test(ren) && judge(ren) === 'renamed', `${fx.file}: rename is reported as a rename`, ren);
  for (const [name, fn] of Object.entries(M.harmful)) {
    const after = M.apply(fn, fx.text, fx.range, fx.fam, fx.file);
    if (after === null) continue;
    ok(judge(after) === 'changed', `${fx.file}: harmful "${name}" is caught`, after);
  }
}

// edits never land in comments or doc strings
const DOC = ['def f(x):', '    """', '    Docs say x == 1 and "quoted".', '    """', '    return x == 1'];
const flipped = M.apply(M.harmful['flip comparison'], DOC, [1, 4], 'python', 'f.py');
ok(flipped && flipped.includes('Docs say x == 1') && flipped.includes('return x != 1'), 'harmful edits skip doc strings and hit code', flipped);
ok(M.apply(M.benign['swap quote style'], FIXTURES[2].text, [1, 2], 'go', 'flags.go') === null, 'quote swap is JS/TS only (in Go \' is a rune)');
const RE = ['const m = /;\\s*charset=(?:"([^"]+)")/i.exec(t);', 'use(m);'];
ok(M.apply(M.benign['swap quote style'], RE, [0, 1], 'ts', 'a.ts') === null, 'quote swap never edits inside a regex literal');

console.log(failures ? `\n${failures} failure(s)` : '\nBENCH MUTATIONS PASS');
process.exit(failures ? 1 : 0);
