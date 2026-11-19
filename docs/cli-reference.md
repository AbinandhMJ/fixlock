---
title: Command reference
---

# Command reference

Run with `npx fixlock <command>` (or `npx @abinandhmj/fixlock <command>` if not installed in the project). Installed from PyPI (`pipx install fixlock`), it's just `fixlock <command>`, and `python -m fixlock <command>` works too. `fixlock --help` prints a summary.

## Try it

### `demo`
A 60-second walkthrough in a throwaway repo: a fix is auto-locked, an AI edit that would undo it gets `ask`, the commit warns, CI blocks the PR, the owner approves. Nothing in your projects is touched.
- `--keep`: keep the demo repo afterwards and print its path.
- `--fast`: no pauses.

## Setup

### `quickstart [--no-ci] [--no-locks] [--no-git-hooks]`

Sets everything up with no questions: the same defaults as `init --yes`, then locks the past fixes `discover` is surest about (high confidence, at most 15), and adds `.github/workflows/fixlock.yml` when the repository is on GitHub and nothing runs fixlock yet. In a repository that's already set up it keeps the config and only connects this machine (hooks, AI assistants). `--no-ci` skips the workflow, `--no-locks` skips locking, `--no-git-hooks` skips this machine's hooks.

### `init`
Interactive setup: team, AI tools, rules, working-code guard, auto-lock, tracker, hooks. Safe to run again to change answers.
- `--yes`: no questions; uses the defaults: you as lead (with your GitHub username, if the GitHub CLI `gh` is logged in), detected AI tools, the Claude Code hook, MCP configs, and this machine's git hooks (commit warning and auto-lock). If it can't find your GitHub username, it says how to add it.
- `--no-git-hooks`: skip the git hooks (for CI or scripted setups).
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
| `--test <file>` | Test that proves the fix ([test-linked locks](tests-and-lifecycle.md)) |
| `--expires YYYY-MM-DD` | After this date the lock only warns |
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

### `discover`
Find past bug fixes worth locking, from any commit style, ranked by evidence: reverted-and-re-applied fixes, fix or regression wording, linked issues, a test in the same commit, guard code (null checks, error handling, bounds checks) and small, focused changes. Only lines still in the code (and still from that commit) are suggested; test files are linked, not locked.
| Flag | Meaning |
|---|---|
| *(none)* | Scan the last 1000 commits, list the top 25, ask which to lock (in a terminal) |
| `--max N` | Scan the last N commits |
| `--since <ref>` | Scan commits after `<ref>` |
| `--min N` | Minimum score (default 4; `0` shows everything). high ≥ 7, medium ≥ 4 |
| `--limit N` | How many to list (default 25) |
| `--per-commit N` | Blocks suggested per fix commit (default 2) |
| `--no-features` | Leave out `feat:` commits |
| `--apply` | Lock everything listed, without asking |
| `--dry-run` | List only |
| `--json` | Machine-readable output |

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
| `--run-tests` | Run the test linked to each changed lock: a passing, unchanged test satisfies it ([details](tests-and-lifecycle.md)) |
| `--judge` | Ask an AI model whether each changed lock's fix still works; advice only ([details](ai-judgment.md)) |
| `--comment` | In a GitLab or Bitbucket pipeline: post or update the fixlock comment ([GitLab](gitlab.md), [Bitbucket](bitbucket.md)) |
| `--alert` | Post to Slack / Teams / a webhook when something changed ([alerts](alerts.md)) |
| `--notify` | Reopen linked tracker issues |
| `--markdown <file>` | Write a PR comment |
| `--json` | JSON output |

Exit codes: `0` ok, `1` locked change without approval, `2` usage or setup error.

### `test [id…]`
Run the tests linked to locks (all, or the given ids). Exit `1` if any fails. `--json` for machine output.

### `link <id> <test file>`
Link the test that proves a lock's fix. `--remove` unlinks it.

## Lifecycle

### `relock <id…>` / `relock --changed`
After an approved change, lock the lines that hold the fix now. `--lines a-b` (one lock) says exactly which; `-m "…"` records why. Old lines go to the lock's `history`.

### `handover <from> <to>`
Give one person's locks to a teammate. `--remove` also takes them off the team.

### `review [<id>]`
Without an id: locks that are expired, need re-locking, are orphaned or are overdue for review (`--json`, `--strict` to exit `1`). With an id: `--keep [--expires YYYY-MM-DD]` or `--remove`.

### `allow <id…>`
Let Cursor and Windsurf change a locked fix (or a file under an `ask` [rule](rules.md): `fixlock allow "rule:auth"`) for a while (`--minutes`, default 30, at most 480). Without ids: what's allowed now. `--clear` takes it back. Stored in `.git`, never committed. AI agents can't run it: their shell hooks refuse it.

### `hook claude` / `hook cursor` / `hook windsurf`
Used by Claude Code; reads the tool call from stdin. You don't run this yourself.

## Docs and releases

### `sync`
Rewrite every enabled AI tool's rules file, `CHANGELOG.md` and the PR template.

### `changelog`
Refresh the `[Unreleased]` section of `CHANGELOG.md`.

### `release <version>`
Move `[Unreleased]` into `## [<version>] - <date>`. Commit and tag afterwards.
