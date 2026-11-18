# Changelog

## 0.9.0

- **One-click setup.** Open a git repository that doesn't use fixlock and click **Set up fixlock** in the status bar or the notification. It runs `fixlock quickstart`: no questions, past fixes locked, AI assistants and hooks connected, PR check added. **Don't ask again** turns it off for that folder; `fixlock.suggestSetup` turns it off everywhere.
- Bundles fixlock with the `quickstart` command.

## 0.8.0

- **Catches AI edits made outside the editor.** When an AI assistant in a terminal (Claude Code, Codex, Aider) or a script changes locked code on disk, even in a file you don't have open, fixlock alerts you right away with **Show changes** and **Why is it locked?**, and the change appears in Problems. Saves from the editor itself don't trigger the alert. Turn it off with `fixlock.notifyOutsideEdits`.
- Bundles fixlock 0.8.0: clearer messages when nobody can approve a lock, smoother `init`.
- Now on Open VSX too, for Cursor, Windsurf and VSCodium.

## 0.7.1

- Bundles fixlock 0.7.1.
- CodeLens, hovers and the lock picker use VS Code's own lock and warning icons instead of emojis, so they follow your theme.

## 0.7.0

- Bundles fixlock 0.7: structural matching for 63 languages and formats, including Angular, Vue, Svelte, Razor, Blade and Jinja templates, SQL, Terraform and YAML.
- Locks are understood in any language; "Find past fixes" recognizes fixes and tests across ecosystems.

## 0.6.0

First release of the fixlock extension.

- Locked lines: gutter icon, highlight, CodeLens and hover with the lock's reason, issue, owner and approvers.
- Live warnings in Problems when an edit changes locked code (structural matching: formatting and comments don't count; renames are noted).
- Commands: lock selected lines, find past fixes to lock, why, show all locks, check branch, check staged, set up, connect AI assistants, demo.
- fixlock's MCP tools for GitHub Copilot agent mode, registered automatically.
- Bundles fixlock and uses the editor's runtime, so no Node.js install is needed. Uses the project's installed fixlock when there is one.
