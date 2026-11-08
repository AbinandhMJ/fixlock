# AI tools

Each developer can use a different AI assistant. fixlock writes the rules into each tool's own instructions file, so every assistant gets the same message: **don't rewrite fixed or working code without telling the developer.**

## Which tools are used?

```bash
npx fixlock tools
```

fixlock looks in three places:
- **the repo**: e.g. `.claude/`, `.cursor/`, `GEMINI.md`
- **installed command-line tools**: `claude`, `codex`, `gemini`, `aider`, `cursor`, `windsurf`
- **editor extensions** in VS Code, VS Code Insiders, Cursor, Windsurf and VSCodium

`● on` tools get a rules file. `○ found` tools are installed here but not enabled. Enable them:

```bash
npx fixlock tools add cursor copilot
npx fixlock tools remove aider
```

Run `npx fixlock tools` on each developer's machine once. Teammates may use tools you don't.

## What each tool gets

| Tool | id | File written | Stops edits before they happen? |
|---|---|---|---|
| Claude Code (CLI, VS Code, JetBrains) | `claude-code` | `CLAUDE.md` + hook in `.claude/settings.json` | **Yes** |
| OpenAI Codex (CLI, IDE extension) | `codex` | `AGENTS.md` | No: rules + commit/PR checks |
| Cursor | `cursor` | `.cursor/rules/fixlock.mdc` | No |
| GitHub Copilot | `copilot` | `.github/copilot-instructions.md` | No |
| Windsurf | `windsurf` | `.windsurf/rules/fixlock.md` | No |
| Gemini CLI / Code Assist | `gemini` | `GEMINI.md` | No |
| Cline | `cline` | `.clinerules/fixlock.md` | No |
| Roo Code | `roo` | `.roo/rules/fixlock.md` | No |
| Continue | `continue` | `.continue/rules/fixlock.md` | No |
| Aider | `aider` | `CONVENTIONS.md` (+ `read:` in `.aider.conf.yml`) | No |
| Amazon Q Developer | `amazonq` | `.amazonq/rules/fixlock.md` | No |
| JetBrains Junie | `junie` | `.junie/guidelines.md` | No |

In shared files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, …) fixlock only edits the section between `<!-- fixlock:start -->` and `<!-- fixlock:end -->`. Your own instructions above and below it are kept. Files inside rules folders (like `.cursor/rules/fixlock.mdc`) belong to fixlock entirely, so don't edit them by hand.

The files are refreshed automatically on `mark`, `remove`, `autolock` and `release`. To refresh by hand: `npx fixlock sync`.

## What the rules say

Every file contains:

0. Never rewrite, delete or replace code that already works without telling the developer first.
1. Run `npx fixlock why <file>:<line>` before changing an existing line.
2. Don't change locked lines; build around them.
3. If a locked line must change, stop and say which lock and who owns it.
4. Keep diffs minimal.
5. Write Conventional Commit messages.
6. Run `npx fixlock check --staged` before finishing.

…followed by the list of current locks with owners and the lines to keep.

## Claude Code in detail

`init` (or `npx fixlock install-claude-hook`) adds a `PreToolUse` hook for `Edit`, `MultiEdit` and `Write`. Before each edit it checks:

- **Locked lines**: applies your policy (`warn`, `ask`, `block`).
- **Working code**: asks if the edit deletes or rewrites committed lines by someone else (or your own older ones).

| Result | What happens |
|---|---|
| warn | A message is shown; the edit goes ahead |
| ask | Claude Code asks the developer to approve the edit, showing fixlock's explanation |
| block | The edit is refused; Claude is told why and should work around the lines |

The owner of a lock never gets prompted for their own lock. If the hook ever fails, it stays silent rather than stopping your work.

The settings also deny Claude permission to edit `.fixlock/`, `.claude/settings.json` and `.git/hooks/`, and to run `fixlock remove` or `--no-verify`. The AI can't switch the protection off.

## Tools without a hook

For Codex, Cursor and the rest, protection is:
1. the rules file (the assistant is instructed, though it can still make mistakes),
2. the commit-time warning (`install-hook`),
3. the PR check (enforced).

Tip for Codex/Cursor users: start tasks with "follow AGENTS.md" (or the tool's rules file) to make sure the rules are loaded.
