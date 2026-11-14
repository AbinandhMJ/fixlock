---
title: VS Code extension
---

# VS Code extension

The fixlock extension shows locks right in the editor and warns you the moment an edit changes one. It works in VS Code, Cursor, Windsurf, VSCodium and other VS Code-based editors.

Install it from the **VS Code Marketplace** (VS Code) or **Open VSX** (Cursor, Windsurf, VSCodium): search for **fixlock**.

## What you get

- **Locked lines are visible**: a lock in the gutter, a subtle highlight, and a CodeLens with the lock's id, title and owner.
- **Hover for the why**: the reason the code exists, the linked issue, and who must approve a change.
- **Live warnings**: when an edit, yours or your AI's, changes what locked code does, the lock turns amber and a warning appears in Problems. Reformatting and comments don't count ([structural matching](../how-it-works.md)); variable renames show as a note.
- **Lock in two clicks**: select lines → right-click → **fixlock: Lock selected lines** (`Ctrl+Alt+L` / `Cmd+Alt+L`).
- **Copilot agent mode checks first**: the extension registers fixlock's [MCP server](mcp.md) with VS Code automatically, so Copilot can call `fixlock_check_edit` before changing locked code. No `.vscode/mcp.json` needed.
- **Run CI locally**: **fixlock: Check branch against main** and **fixlock: Check staged changes**.

The extension bundles fixlock and runs it with the editor's own runtime, so Node.js doesn't need to be installed. If the project has `@abinandhmj/fixlock` in `node_modules`, that version is used, so the editor and CI give the same answer.

## Settings

| Setting | Default | |
|---|---|---|
| `fixlock.highlightLockedLines` | `true` | Gutter icon and background |
| `fixlock.codeLens` | `true` | Lock id, title and owner above locked code |
| `fixlock.mcp.enabled` | `true` | Offer the MCP tools to Copilot. Turn off if you set up `.vscode/mcp.json` with `fixlock setup copilot`, to avoid two servers |
| `fixlock.baseBranch` | `origin/main` | Base branch for the branch check |
| `fixlock.cliPath` | | A specific `bin/fixlock.js` to run |

## Trust and privacy

Commands and the MCP server only run in [trusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust), because they may run the project's own installed fixlock. In untrusted workspaces, locks are still shown. Nothing is sent anywhere.

## Cursor and Windsurf

Install the extension from Open VSX for the in-editor locks and warnings. For the AI side, use `npx fixlock setup cursor` (or `windsurf`): those editors read MCP servers from their own config files, not from extensions. See [Cursor](cursor.md).
