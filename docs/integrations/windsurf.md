---
title: Windsurf / Devin Desktop
---

# Windsurf / Devin Desktop

## Setup

```bash
npm i -D @abinandhmj/fixlock     # or: pipx install fixlock
npx fixlock setup windsurf
```

This writes:

| File | Purpose |
|---|---|
| `.devin/hooks.json`, `.windsurf/hooks.json` | Cascade hooks: stop the agent before it changes a locked fix (`.windsurf/` is for older Windsurf versions) |
| `~/.codeium/windsurf/mcp_config.json` | Registers the `fixlock` MCP server (your user config) |
| `.windsurf/rules/fixlock.md` | The lock rules, kept up to date by `fixlock sync` |

Commit the project files so every teammate gets them; each teammate runs `npx fixlock setup windsurf` once for the MCP server.

## The pre-edit hook

Before Cascade writes a file (`pre_write_code`), it runs `fixlock hook windsurf`. If the edit undoes a locked fix whose policy is `block` or `ask`, the hook stops it (exit code 2) and Cascade shows which fix, why it exists and who owns it. For `ask` locks, the agent explains the change to you; if you agree, run `fixlock allow FIX-001` (30 minutes) and it tries again. `warn` locks, edits outside locked lines, reformatting and the owner's own edits go through.

The hook also stops Cascade from running `fixlock allow`, `fixlock remove` or `git commit --no-verify` (`pre_run_command`), so only a person can unlock.

Hooks don't run while a workspace is in Restricted Mode.
