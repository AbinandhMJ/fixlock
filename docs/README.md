---
title: Home
---

# fixlock user guides

fixlock stops fixed bugs and finished features from coming back, whether the change comes from a person or an AI assistant.

| Guide | Read it if you… |
|---|---|
| [Getting started](getting-started.md) | want fixlock running in 10 minutes |
| [Team lead guide](team-lead-guide.md) | set up the project, the team and the rules |
| [Developer guide](developer-guide.md) | write code day to day and want to know what the warnings mean |
| [AI tools](ai-tools.md) | use Claude Code, Codex, Cursor, Copilot or another assistant |
| [CI setup](ci-setup.md) | wire the PR check into GitHub Actions or Jenkins |
| [Issue trackers](trackers.md) | want Linear, ClickUp, Notion or Bugasura to update themselves |
| [Configuration reference](configuration.md) | need every setting in `.fixlock/config.json` |
| [Command reference](cli-reference.md) | need every command and flag |
| [Troubleshooting](troubleshooting.md) | hit an error |

## The idea in one minute

1. **Lock** the lines that fix a bug or hold a finished feature. Each lock has an **owner**. Locks are created by hand (`fixlock mark`) or automatically from `fix:` / `feat:` commits.
2. **Before an AI edits** a locked line, or rewrites code that already works, the developer is warned or asked first.
3. **Before a commit**, the developer sees the same warning in the terminal.
4. **On the pull request**, CI fails until the lock's owner (or a lead) approves.
5. **Your tracker updates itself**: a locked fix moves its issue to *Done*; a PR that reverts it reopens the issue.

Everything lives in the repo (`.fixlock/`), so the whole team shares the same locks and rules.
