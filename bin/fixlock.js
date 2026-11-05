#!/usr/bin/env node
'use strict';
const cmd = require('../src/commands');

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) out[key] = true; else { out[key] = next; i++; }
    } else if (a === '-m') { out.m = argv[++i]; }
    else out._.push(a);
  }
  return out;
}

const HELP = `fixlock — stop fixed bugs from coming back

Usage:
  fixlock init                                 Set up .fixlock/ (adds your git email as protected author)
  fixlock mark <file> <start>[-<end>] -m "why" [--test <spec>] [--title "..."]
                                                Register the lines that fix a bug
  fixlock list                                 Show registered fixes
  fixlock remove <FIX-id>                      Unregister a fix (owner only, deliberately)
  fixlock check [--base origin/main] [--json] [--markdown report.md]
                                                Fail if a registered fix or protected author's code was removed
  fixlock sync                                 Write the "Known fixes" section into CLAUDE.md / AGENTS.md
  fixlock install-hook                         Block pushes that revert fixes (pre-push hook)
`;

const [, , sub, ...rest] = process.argv;
const args = parse(rest);
const map = { init: cmd.init, mark: cmd.mark, list: cmd.list, ls: cmd.list, remove: cmd.remove, rm: cmd.remove,
  check: cmd.check, sync: cmd.sync, 'install-hook': cmd.installHook };

if (!sub || sub === 'help' || sub === '--help' || !map[sub]) {
  console.log(HELP);
  process.exit(sub && !map[sub] && sub !== 'help' && sub !== '--help' ? 1 : 0);
}
try { map[sub](args); } catch (e) { console.error(`\x1b[31mfixlock: ${e.message}\x1b[0m`); process.exit(2); }
