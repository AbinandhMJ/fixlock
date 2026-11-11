---
title: Command reference
---

# Command reference

Run with `npx fixlock <command>` (or `npx @abinandhmj/fixlock <command>` if not installed in the project). `npx fixlock --help` prints a summary.

## Try it

### `demo`
A 60-second walkthrough in a throwaway repo: a fix is auto-locked, an AI edit that would undo it gets `ask`, the commit warns, CI blocks the PR, the owner approves. Nothing in your projects is touched.
- `--keep`: keep the demo repo afterwards and print its path.
- `--fast`: no pauses.

## Setup

### `init`
Interactive setup: team, AI tools, rules, working-code guard, auto-lock, tracker, hooks. Safe to run again to change answers.
- `--yes`: no questions; uses defaults (you as lead, detected AI tools, Claude hook).
- `--interactive`: ask questions even when input is piped.

### `team [list | add | remove]`
```bash
fixlock team
fixlock team add --name "Ravi" --github ravik --email ravi@fluxo.dev --role developer
fixlock team remove ravik
```

### `tools [list | add | remove] [ids…]`
Detect AI tools and choose which get rules files. See [AI tools](ai-tools.md).

### `setup [assistant…]`
Connect AI assistants: `claude-code`, `cursor`, `copilot`, `codex`, `gemini`, `windsurf`, or `all` (project-level ones). Writes the MCP server config and the assistant's rules file. `codex` and `windsurf` write to your user config. See [AI assistants](integrations/).

### `mcp`
Runs the MCP server over stdio. Assistants start it themselves; see the [MCP server reference](integrations/mcp.md).

### `--version`
Prints the installed version.

### `install-hook`
Installs git hooks on this machine: `pre-commit` (warning) and `post-commit` (auto-lock).

### `install-claude-hook`
Adds the Claude Code hook and permissions to `.claude/settings.json`.

### `codeowners`
Writes lock owners into `.github/CODEOWNERS` (inside a managed section).

## Locks

### `mark <file> <start>[-<end>]`
Lock lines.
| Flag | Meaning |
|---|---|
| `-m "…"` | Why it exists |
| `--title "…"` | Short name |
| `--type bug\|feature` | Default `bug` |
| `--issue <ref>` | `linear:ENG-12`, `clickup:…`, `notion:…`, `bugasura:…` |
| `--owner <github>` | Owner (default: you) |
| `--test <spec>` | Test that guards the fix |
| `--no-sync` | Don't update the tracker |

### `autolock`
Lock lines from fix/feature commits.
| Flag | Meaning |
|---|---|
| *(none)* | The last commit |
| `--commit <sha>` | A specific commit |
| `--since <ref>` | Commits after `<ref>` |
| `--all [--max N]` | Backfill the last N commits (default 300) |
| `--dry-run` | Show what would be locked |
| `--commit-result` | Commit the new locks as `chore(fixlock): …` (used by the hook) |
| `--no-sync` | Don't update the tracker |

### `why <file>[:line[-line]]`
Shows locks in a file or on given lines, the owner, and whether you can change them.

### `list` (alias `ls`)
All locks.

### `remove <id>` (alias `rm`)
Unlock. Only an approver of the lock can do this (`--force` overrides; CI will still ask for approval).

## Checks

### `check`
| Flag | Meaning |
|---|---|
| `--base <ref>` | Compare with this branch (default `origin/main`) |
| `--staged` | Check staged changes only (used by the pre-commit hook; never fails) |
| `--strict` | With `--staged`: fail when a lock is changed |
| `--pr <n>` | PR number for approvals |
| `--notify` | Reopen linked tracker issues |
| `--markdown <file>` | Write a PR comment |
| `--json` | JSON output |

Exit codes: `0` ok, `1` locked change without approval, `2` usage or setup error.

### `hook claude`
Used by Claude Code; reads the tool call from stdin. You don't run this yourself.

## Docs and releases

### `sync`
Rewrite every enabled AI tool's rules file, `CHANGELOG.md` and the PR template.

### `changelog`
Refresh the `[Unreleased]` section of `CHANGELOG.md`.

### `release <version>`
Move `[Unreleased]` into `## [<version>] - <date>`. Commit and tag afterwards.
