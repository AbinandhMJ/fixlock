# fixlock for VS Code

**Stop AI coding assistants (and teammates) from silently undoing your bug fixes.** A product of [Algotricz](https://www.linkedin.com/company/algotricz).

[fixlock](https://abinandhmj.github.io/fixlock/) locks the lines that hold a bug fix or a finished feature, each with an owner and a reason. This extension brings those locks into your editor:

- **See what's locked.** Locked lines get a lock in the gutter, a subtle highlight and a CodeLens with the lock's id, title and owner.
- **Know why before you change it.** Hover a locked line to see why it exists, the linked issue, and who has to approve a change.
- **Get warned while you type.** If your edit (or your AI's) changes what locked code does, the lock turns amber and a warning appears in Problems. Reformatting, comments and line wrapping don't count. A variable rename shows as a gentle note.
- **Lock a fix in two clicks.** Select the lines, right-click, choose **fixlock: Lock selected lines** (`Ctrl+Alt+L` / `Cmd+Alt+L`), and give a reason.
- **Copilot checks before editing.** The extension offers fixlock's MCP tools to GitHub Copilot agent mode, so Copilot asks fixlock before changing locked code.
- **Run the CI check locally.** Use **fixlock: Check branch against main** to see what CI will say before you push.

No Node.js install needed: the extension bundles fixlock and runs it with the editor's own runtime. If your project has `@abinandhmj/fixlock` installed, that version is used instead, so the editor and CI always agree.

Works in VS Code, Cursor, Windsurf, VSCodium and other VS Code-based editors.

## Getting started

1. Open a git repository.
2. Run **fixlock: Set up fixlock in this repository** from the Command Palette. This is the same interactive `fixlock init` as the CLI: team, roles, policies, hooks and AI assistants.
3. Select the lines of a fix and run **fixlock: Lock selected lines**. Commit the `.fixlock/` folder.
4. Add `npx fixlock check` to CI ([CI setup](https://abinandhmj.github.io/fixlock/ci-setup)) so a PR that changes a locked fix needs the owner's approval.

Want to see it first? Run **fixlock: Run the 60-second demo**.

## Commands

| Command | What it does |
|---|---|
| fixlock: Lock selected lines | Lock the selection as a bug fix or feature, with a reason and optional issue |
| fixlock: Why is this line locked? | Show the lock under the cursor |
| fixlock: Show all locks | Search every lock in the repo and jump to it |
| fixlock: Check branch against main | Run the same check as CI |
| fixlock: Check staged changes | Check what you're about to commit |
| fixlock: Set up fixlock in this repository | Interactive `fixlock init` |
| fixlock: Connect AI assistants | Set up Claude Code, Cursor, Copilot, Codex, Gemini CLI, Windsurf |
| fixlock: Run the 60-second demo | Walkthrough in a throwaway repo |

## Settings

| Setting | Default | |
|---|---|---|
| `fixlock.highlightLockedLines` | `true` | Gutter icon and background on locked lines |
| `fixlock.codeLens` | `true` | Lock id, title and owner above locked code |
| `fixlock.mcp.enabled` | `true` | Offer fixlock's MCP tools to Copilot agent mode. Turn off if you already set up `.vscode/mcp.json` with `fixlock setup copilot` |
| `fixlock.baseBranch` | `origin/main` | Base for the branch check |
| `fixlock.cliPath` | | Use a specific `bin/fixlock.js` |

## Privacy

The extension reads `.fixlock/` in your repository and runs fixlock locally. It sends nothing anywhere and has no telemetry. In untrusted workspaces, locks are shown but no commands or MCP server run.

## Links

[Docs](https://abinandhmj.github.io/fixlock/) · [GitHub](https://github.com/AbinandhMJ/fixlock) · [Issues](https://github.com/AbinandhMJ/fixlock/issues) · MIT licensed

Built and maintained by **[Algotricz](https://www.linkedin.com/company/algotricz)**.
