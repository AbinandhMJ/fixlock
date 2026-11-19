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
| `.cursor/hooks.json` | A pre-edit hook: stops the agent before it changes a locked fix |
| `.cursor/rules/fixlock.mdc` | An always-applied rule: check with fixlock before rewriting existing code, plus the current locks |

Commit all three, so every teammate gets them. Then in Cursor open **Settings → MCP** (Tools & Integrations) and make sure **fixlock** is enabled. It shows a green dot when it's running.

## Using it

In Agent mode, Cursor calls `fixlock_check_edit` before changing existing lines, as the rule tells it to. You can also ask directly:

- *"What's locked in src/app/billing? Use fixlock_why."*
- *"Before you refactor this file, check each change with fixlock_check_edit."*

## The pre-edit hook

Cursor runs `fixlock hook cursor` before each file edit the agent makes (`preToolUse`), so a locked fix is protected even if the model ignores the rule:

| Lock policy (`onEdit`) | What the agent sees |
|---|---|
| `block` | The edit is refused: the AI must not change these lines. A person can, with approval in the PR |
| `ask` (bug fixes, by default) | The edit is refused with the fix, why it exists and who owns it. The agent explains the change to you; if you agree, run `fixlock allow FIX-001` and it tries again |
| `warn` | The edit goes through |

Edits outside locked lines, reformatting, and the lock owner's own edits always go through. `fixlock allow FIX-001` lasts 30 minutes (`--minutes 120` for longer, `--clear` to undo) and is stored in `.git`, so it's never committed. The PR still needs the owner's approval.

The hook also refuses `fixlock allow`, `fixlock remove` and `git commit --no-verify` when the agent tries to run them (`beforeShellExecution`), so only a person can unlock.

Cursor's cloud agents don't run project hooks; there the rule, the commit warning and the [CI check](../ci-setup.md) still apply.
