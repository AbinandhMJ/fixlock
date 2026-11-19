---
title: Rules for AI agents
---

# Rules for AI agents (policy as code)

Locks protect specific lines. **Rules** protect whole areas of the code, and can treat AI agents differently from people and from each other. They live in `.fixlock/config.json`, reviewed like any other code:

```json
"rules": [
  { "name": "billing", "paths": ["src/billing/**"], "ai": "block", "approval": "lead",
    "reason": "Money moves here: a person writes these changes." },
  { "name": "migrations", "paths": ["db/migrations/**"], "agents": ["cursor", "copilot"], "ai": "ask" },
  { "name": "auth", "paths": ["src/auth/**"], "ai": "ask", "approval": "approvers", "approvers": ["priya"], "aiOnly": true }
]
```

## Before an AI edit

`ai` says what an AI agent may do before it edits a matching file, any line of it:

| `ai` | Claude Code | Cursor, Windsurf | Any MCP client (`fixlock_check_edit`) |
|---|---|---|---|
| `block` | Edit denied | Edit refused | "Do not make this change" |
| `ask` | Claude asks you first | Refused until you run `fixlock allow "rule:auth"` | "Ask the developer first" |
| `warn` | Shown, allowed | Allowed | Warning |
| `allow` (default) | Nothing | Nothing | Nothing |

`agents` limits a rule to some agents: `claude-code`, `cursor`, `windsurf`, `copilot`, `codex`, `gemini`, `devin`, `aider`, `jules` (default: all of them). The hooks know which agent they run in; the MCP server learns it from the assistant's name.

## In the pull request

`approval` says what a PR that changes a matching file needs:

| `approval` | Needs |
|---|---|
| `none` (default) | Nothing |
| `lead` | Approval from a lead on the team (or anyone in `approvers`) |
| `approvers` | Approval from someone in `approvers` (GitHub, GitLab or Bitbucket usernames, or team names) |

With `"aiOnly": true`, the approval is only needed when **AI-written commits** changed the files. fixlock recognises them by their author and `Co-authored-by` lines: Claude Code, Cursor, GitHub Copilot's coding agent, Codex, Devin, Gemini, Jules, Aider and Windsurf all sign their commits that way. A person's own change passes. (The GitHub App reads this per pull request; the CLI, Action, GitLab and Bitbucket per file.)

The PR comment says which rule, why, and who can approve, and the check fails until they do, like a lock.

## Paths

Globs, like `.gitignore`: `src/billing/**` (everything under it), `src/billing` (the same), `*.sql` (any `.sql` file in any folder), `db/*.sql` (only directly in `db/`), `db/**/*.sql`.

## Compared with locks and protected paths

| | Locks | Rules | `protectedPaths` |
|---|---|---|---|
| Protects | specific lines (a fix, a feature) | every line under a path | every line under a path |
| AI edits | per lock policy | per rule and per agent | not checked |
| PR | owner approves | a lead or listed approvers, optionally only for AI-written changes | warning only |
