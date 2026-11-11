---
title: GitHub Copilot
---

# GitHub Copilot

## Setup

```bash
npm i -D @abinandhmj/fixlock
npx fixlock setup copilot
```

This writes:

| File | Purpose |
|---|---|
| `.vscode/mcp.json` | Registers the `fixlock` MCP server for VS Code (Copilot agent mode) |
| `.github/copilot-instructions.md` | A managed section with the rules and current locks, read by Copilot Chat, agent mode and the Copilot coding agent |

Commit both. In VS Code, open Copilot Chat, switch to **Agent** mode, and click the tools icon: the fixlock tools should be listed. VS Code may ask you to trust and start the server the first time.

## Using it

Ask in agent mode:

- *"Check with fixlock before changing anything in src/app/core."*
- *"#fixlock_why src/app/core/utils/date.util.ts"*

## Copilot coding agent (PRs from issues)

The coding agent reads `.github/copilot-instructions.md`, and its PRs go through the same [fixlock CI check](../ci-setup.md), so a PR that reverts a locked fix is blocked until the owner approves.
