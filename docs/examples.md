---
title: Examples
---

# Examples

Ready-to-copy configuration lives in the repo's [`examples/`](https://github.com/AbinandhMJ/fixlock/tree/main/examples) folder. Most of it is generated for you by `npx fixlock init` and `npx fixlock setup`; the files are there to read, review or adapt by hand.

## AI assistants

| Assistant | Example | Goes to |
|---|---|---|
| Claude Code | [`.mcp.json`](https://github.com/AbinandhMJ/fixlock/blob/main/examples/assistants/claude-code/.mcp.json), [`settings.json`](https://github.com/AbinandhMJ/fixlock/blob/main/examples/assistants/claude-code/settings.json) | `.mcp.json`, `.claude/settings.json` |
| Cursor | [`mcp.json`](https://github.com/AbinandhMJ/fixlock/blob/main/examples/assistants/cursor/mcp.json) | `.cursor/mcp.json` |
| GitHub Copilot | [`mcp.json`](https://github.com/AbinandhMJ/fixlock/blob/main/examples/assistants/copilot/mcp.json) | `.vscode/mcp.json` |
| OpenAI Codex | [`config.toml`](https://github.com/AbinandhMJ/fixlock/blob/main/examples/assistants/codex/config.toml) | `~/.codex/config.toml` |
| Gemini CLI | [`settings.json`](https://github.com/AbinandhMJ/fixlock/blob/main/examples/assistants/gemini/settings.json) | `.gemini/settings.json` |

The MCP entry is the same everywhere:

```json
{ "mcpServers": { "fixlock": { "command": "npx", "args": ["--no-install", "fixlock", "mcp"] } } }
```

## CI

| | |
|---|---|
| [GitHub Actions](https://github.com/AbinandhMJ/fixlock/blob/main/examples/ci/github-actions.yml) | Blocks the PR, reads approvals, posts a comment, re-runs when someone approves |
| [Jenkins](https://github.com/AbinandhMJ/fixlock/blob/main/examples/ci/Jenkinsfile) | Multibranch pipeline stage |
| [GitLab](https://github.com/AbinandhMJ/fixlock/blob/main/examples/ci/gitlab-ci.yml) | Merge request job |

## Git hook managers

| | |
|---|---|
| [Husky](https://github.com/AbinandhMJ/fixlock/tree/main/examples/hooks/husky) | `pre-commit` warning and `post-commit` auto-lock |
| [Lefthook](https://github.com/AbinandhMJ/fixlock/blob/main/examples/hooks/lefthook.yml) | Same, for `lefthook.yml` |

## A complete working setup

`npx @abinandhmj/fixlock demo --keep` builds a small repo with fixlock fully set up (team, locks, rules files, Claude Code hook, MCP config) and keeps it, so you can inspect every file.
