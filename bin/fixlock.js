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
    } else if (a === '-m') out.m = argv[++i];
    else out._.push(a);
  }
  return out;
}

const HELP = `fixlock — stop fixed bugs and finished features from coming back · by Algotricz

See it first:
  fixlock demo [--keep] [--fast]       60-second walkthrough in a throwaway repo (nothing in your projects is touched)

Setup (team lead, once):
  fixlock init                         Interactive: team, roles, GitHub users, policies, tracker, hooks
  fixlock team [list|add|remove]       Manage members: team add --name Abi --github abinandhmj --email a@x.com --role lead

AI assistants:
  fixlock setup [assistant…]           Connect claude-code, cursor, copilot, codex, gemini, windsurf (or "all")
  fixlock mcp                          Run the MCP server (assistants start this themselves)

AI tools & docs:
  fixlock tools                        Detect AI tools (repo, CLIs, VS Code/Cursor extensions) and show what is enabled
  fixlock tools add|remove <id…>       claude-code codex cursor copilot windsurf gemini cline roo continue aider amazonq junie
  fixlock sync                         Rewrite every enabled tool's rules file + CHANGELOG.md + PR template
  fixlock changelog                    Refresh [Unreleased] from locks + Conventional Commits
  fixlock release <version>            Freeze [Unreleased] as <version> in CHANGELOG.md

Daily:
  fixlock mark <file> <start>-<end> -m "why" [--type bug|feature] [--title ".."] [--issue linear:ENG-12] [--owner gh] [--test spec]
  fixlock autolock [--since ref | --all] [--dry-run]
                                       Lock lines from fix:/feat: commits (HEAD by default; --all backfills history)
  fixlock why <file>[:line]            What is locked here, who owns it, can I change it?
  fixlock list | remove <id>

CI / hooks:
  fixlock check [--base origin/main] [--pr N] [--notify] [--markdown out.md] [--json]
  fixlock check --staged               Friendly warning before commit (never blocks)
  fixlock install-hook                 git hooks on this machine: commit warning + auto-lock after fix/feat commits
  fixlock install-claude-hook          Claude Code: warn / ask / block before AI edits locked or working code
  fixlock codeowners                   Write lock owners into .github/CODEOWNERS
`;

const [, , sub, ...rest] = process.argv;
if (sub === '--version' || sub === '-v' || sub === 'version') { console.log(require('../package.json').version); process.exit(0); }
const args = parse(rest);
const alias = { ls: 'list', rm: 'remove' };
const name = alias[sub] || sub;
if (!sub || ['help', '--help', '-h'].includes(sub) || !cmd[name]) {
  console.log(HELP);
  process.exit(sub && !cmd[name] && !['help', '--help', '-h'].includes(sub) ? 1 : 0);
}
Promise.resolve()
  .then(() => cmd[name](args))
  .catch((e) => { console.error(`fixlock: ${e.message}`); process.exitCode = 2; });
