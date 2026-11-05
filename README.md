# fixlock

**Stop fixed bugs from coming back.**

You fix a bug. Weeks later someone's AI assistant "ports" a feature from an old codebase, rewrites the file, and your fix disappears. Git merges it with **no conflict**, because to git it's just a normal edit. Nobody notices until the bug is back in production.

fixlock gives every bug fix a memory that the AI, the developer and the CI pipeline can't skip:

1. **Fix registry**: `fixlock mark` records the exact lines that fix a bug, and why, in `.fixlock/registry.json` (committed with the code).
2. **CI gate**: `fixlock check` fails the PR if those lines are gone, or if it deletes/rewrites code written by a protected author (via `git blame`). Rename-aware, whitespace-insensitive.
3. **Agent prevention**: `fixlock sync` writes a "Known fixes, DO NOT REVERT" section into `CLAUDE.md` and `AGENTS.md`, so Claude Code and Codex see the fixes *before* they edit.

Zero dependencies. Node ≥ 18. Works with any language, and with GitHub, GitLab, Jenkins or plain git hooks.

## Quick start

```bash
npx fixlock init                      # adds your git email as a protected author
# ...fix a bug...
npx fixlock mark src/app/core/utils/date.util.ts 3-4 \
  -m "SAP B1 rejects ISO timestamps for DocDate" \
  --title "SAP date format" --test date.util.spec.ts
git add . && git commit -m "fix: SAP date format"
```

On a PR branch:

```
$ npx fixlock check --base origin/main
REVERTED FIX  FIX-001 "SAP date format" — fix lines missing from src/app/core/utils/date.util.ts
    why: SAP B1 rejects ISO timestamps for DocDate
    - const p = (n: number) => String(n).padStart(2, '0');
    - return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
PROTECTED CODE  src/app/core/utils/date.util.ts — 3 line(s) by a protected author removed or rewritten
✖ 2 blocking finding(s).   (exit code 1)
```

## Commands

| Command | What it does |
|---|---|
| `init` | Create `.fixlock/config.json` + registry |
| `mark <file> <start>-<end> -m "why" [--test spec] [--title t]` | Register fix lines (also re-syncs agent files) |
| `list` / `remove <id>` | Show / deliberately retire a fix |
| `check [--base ref] [--json] [--markdown out.md]` | Exit 1 on blocking findings |
| `sync` | Update the managed section in CLAUDE.md / AGENTS.md |
| `install-hook` | pre-push hook that runs `check` locally |

## Config (`.fixlock/config.json`)

```json
{
  "protectedAuthors": ["abi@fluxo.dev"],
  "protectedPaths": ["src/app/core/", "src/app/shared/"],
  "agentFiles": ["CLAUDE.md", "AGENTS.md"],
  "failOn": ["fix", "author"],
  "ignoreTrivialLines": true
}
```

`failOn` kinds: `fix` (registered fix reverted), `author` (protected author's lines removed), `path` (protected path changed). Anything not in `failOn` is reported as a warning.

## Wire it into CI

- **Jenkins**: `examples/Jenkinsfile.stage`
- **GitHub Actions**: `examples/github-action.yml` (posts a sticky PR comment). Mark it as a required status check on `main`.
- **Claude Code**: copy `examples/claude-settings.json` to `.claude/settings.json` so the agent can't edit the registry or skip the hook.

## How it decides

- A fix is "present" if every guarded line still exists somewhere in the (possibly renamed) file, ignoring whitespace. Moving code around is fine; deleting it isn't.
- Protected-author check: diff `merge-base..HEAD`, `git blame` the merge-base for each removed line, flag lines whose author is protected. Blank/brace-only lines are ignored.

## Limitations (v0.1)

- Text-level, not AST-level: renaming a variable inside a guarded line counts as a revert (re-`mark` it).
- Protected-author detection depends on git emails being consistent.
- It catches reverts of *known* fixes. Pair it with a regression test per fix for behavioural coverage.

## Roadmap

AST-aware matching for TS/JS, MCP server so agents can ask "is this line protected?" before editing, GitHub App with inline PR comments, `mark` from a commit (`fixlock mark --commit <sha>`).

MIT licensed.
