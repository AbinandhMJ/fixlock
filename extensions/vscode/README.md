# fixlock for VS Code

**Stop AI coding assistants (and teammates) from silently undoing your bug fixes.** A product of [Algotricz](https://www.linkedin.com/company/algotricz).

[fixlock](https://abinandhmj.github.io/fixlock/) locks the lines that hold a bug fix or a finished feature, each with an owner and a reason. This extension brings those locks into your editor:

- **See what's locked.** Locked lines get a lock in the gutter, a subtle highlight and a CodeLens with the lock's id, title and owner.
- **Know why before you change it.** Hover a locked line to see why it exists, the linked issue, and who has to approve a change.
- **Get warned while you type.** If your edit (or your AI's) changes what locked code does, the lock turns amber and a warning appears in Problems. Reformatting, comments and line wrapping don't count. A variable rename shows as a gentle note.
- **Catch AI edits outside the editor.** When an AI assistant in a terminal (Claude Code, Codex, Aider) or a script rewrites locked code on disk, even in a file you don't have open, you get an alert right away with **Show changes**, and it shows in Problems. No waiting for the PR.
- **Lock a fix in two clicks.** Select the lines, right-click, choose **fixlock: Lock selected lines** (`Ctrl+Alt+L` / `Cmd+Alt+L`), and give a reason.
- **Copilot checks before editing.** The extension offers fixlock's MCP tools to GitHub Copilot agent mode, so Copilot asks fixlock before changing locked code.
- **Run the CI check locally.** Use **fixlock: Check branch against main** to see what CI will say before you push.

No Node.js install needed: the extension bundles fixlock and runs it with the editor's own runtime. If your project has `@abinandhmj/fixlock` installed, that version is used instead, so the editor and CI always agree.

Works in VS Code, Cursor, Windsurf, VSCodium and other VS Code-based editors.

## Getting started

1. Open a git repository.
2. Click **Set up fixlock** in the status bar (or in the notification). It runs `fixlock quickstart` with no questions: your team, the past fixes fixlock is surest about locked, your AI assistants connected, commit hooks, and the GitHub PR check.
3. Commit the new files and push.

Want to choose every setting yourself? Run **fixlock: Set up fixlock step by step** from the Command Palette instead (the interactive `fixlock init`). Lock more fixes any time: select the lines and run **fixlock: Lock selected lines**.

Want to see it first? Run **fixlock: Run the 60-second demo**.

## Commands

| Command | What it does |
|---|---|
| fixlock: Lock selected lines | Lock the selection as a bug fix or feature, with a reason and optional issue |
| fixlock: Why is this line locked? | Show the lock under the cursor |
| fixlock: Show all locks | Search every lock in the repo and jump to it |
| fixlock: Find past fixes to lock | Rank the bug fixes already in your git history and pick which to lock |
| fixlock: Check branch against main | Run the same check as CI |
| fixlock: Check staged changes | Check what you're about to commit |
| fixlock: Set up fixlock (one click, no questions) | `fixlock quickstart` |
| fixlock: Set up fixlock step by step | Interactive `fixlock init` |
| fixlock: Connect AI assistants | Set up Claude Code, Cursor, Copilot, Codex, Gemini CLI, Windsurf |
| fixlock: Run the 60-second demo | Walkthrough in a throwaway repo |

## Settings

| Setting | Default | |
|---|---|---|
| `fixlock.highlightLockedLines` | `true` | Gutter icon and background on locked lines |
| `fixlock.codeLens` | `true` | Lock id, title and owner above locked code |
| `fixlock.notifyOutsideEdits` | `true` | Alert when locked code is changed on disk outside the editor (AI assistants in a terminal, scripts) |
| `fixlock.suggestSetup` | `true` | In a git repository without fixlock, show **Set up fixlock** in the status bar and offer it once |
| `fixlock.mcp.enabled` | `true` | Offer fixlock's MCP tools to Copilot agent mode. Turn off if you already set up `.vscode/mcp.json` with `fixlock setup copilot` |
| `fixlock.baseBranch` | `origin/main` | Base for the branch check |
| `fixlock.cliPath` | | Use a specific `bin/fixlock.js` |

## Privacy

The extension reads `.fixlock/` in your repository and runs fixlock locally. It sends nothing anywhere and has no telemetry. In untrusted workspaces, locks are shown but no commands or MCP server run.

## Links

[Docs](https://abinandhmj.github.io/fixlock/) · [GitHub](https://github.com/AbinandhMJ/fixlock) · [Issues](https://github.com/AbinandhMJ/fixlock/issues) · MIT licensed

Built and maintained by **[Algotricz](https://www.linkedin.com/company/algotricz)**.
