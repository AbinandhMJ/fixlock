---
title: Cursor
---

# Cursor

## Setup

```bash
npm i -D @abinandhmj/fixlock
npx fixlock setup cursor
```

This writes:

| File | Purpose |
|---|---|
| `.cursor/mcp.json` | Registers the `fixlock` MCP server for the project |
| `.cursor/rules/fixlock.mdc` | An always-applied rule: check with fixlock before rewriting existing code, plus the current locks |

Commit both. Then in Cursor open **Settings → MCP** (Tools & Integrations) and make sure **fixlock** is enabled. It shows a green dot when it's running.

## Using it

In Agent mode, Cursor calls `fixlock_check_edit` before changing existing lines, as the rule tells it to. You can also ask directly:

- *"What's locked in src/app/billing? Use fixlock_why."*
- *"Before you refactor this file, check each change with fixlock_check_edit."*

Cursor has no pre-edit hook for fixlock, so a model that ignores the rule can still make the edit. The commit-time warning (`npx fixlock install-hook`) and the [CI check](../ci-setup.md) catch it.
