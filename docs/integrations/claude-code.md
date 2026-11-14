---
title: Claude Code
---

# Claude Code

Claude Code gets all three layers: the MCP server, the `CLAUDE.md` rules section and a **pre-edit hook** that checks every `Edit`, `MultiEdit` and `Write` even if Claude forgets to ask.

## Setup

```bash
npm i -D @abinandhmj/fixlock
npx fixlock setup claude-code
```

This writes:

| File | Purpose |
|---|---|
| `.mcp.json` | Registers the `fixlock` MCP server for the project |
| `.claude/settings.json` | Pre-edit hook, plus permissions that stop Claude from editing `.fixlock/`, the hook settings or git hooks |
| `CLAUDE.md` | A managed "Locked fixes & features" section |

Commit all three. Teammates get them on `git pull`. Claude Code asks once to approve the project's MCP server.

## What it looks like

When Claude tries to change a locked line, the hook asks you first:

```
🔒 fixlock: heads up Ravi — this change affects a locked bug fix, which may bring back old behaviour:
• FIX-001 "SAP date format" (bug fix by @abinandhmj) — src/date.ts lines 2-3
  Why it exists: SAP B1 rejects ISO timestamps for DocDate
  Policy: confirm with the developer; the PR will need approval from @abinandhmj.
```

With the MCP server, Claude can also check *while planning*: "use fixlock_why on src/app/core" lists everything locked there before it starts a refactor.

## Check it works

```bash
claude mcp list            # fixlock should be listed
```

Then ask Claude: *"Use fixlock_list and tell me what's locked."*

## Windows

If Claude Code can't start the server, change the command in `.mcp.json` to `"command": "cmd", "args": ["/c", "npx", "--no-install", "fixlock", "mcp"]`.
