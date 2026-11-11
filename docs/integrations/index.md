---
title: AI assistants
---

# Use fixlock with your AI assistant

fixlock plugs into AI coding assistants in up to three ways:

| | What it does | Works in |
|---|---|---|
| **MCP server** | The assistant asks fixlock *before* editing: "may I change these lines?" and gets a verdict (`ok`, `warn`, `ask`, `block`) with the reason and owner. | Claude Code, Cursor, GitHub Copilot (VS Code), Codex, Gemini CLI, Windsurf, any MCP client |
| **Rules file** | The assistant's own instructions file tells it to check before rewriting working code, and lists the current locks. | 12 assistants (see [AI tools](../ai-tools.md)) |
| **Pre-edit hook** | The edit is intercepted before it happens, even if the assistant forgets to check. | Claude Code |

Behind all of them, the git hooks warn at commit time and [CI](../ci-setup.md) blocks reverting PRs until the owner approves, whatever tool wrote the code.

## Set up

```bash
npx fixlock setup claude-code   # or: cursor, copilot, codex, gemini, windsurf, all
```

| Assistant | Guide |
|---|---|
| Claude Code | [Claude Code](claude-code.md) |
| Cursor | [Cursor](cursor.md) |
| GitHub Copilot | [GitHub Copilot](copilot.md) |
| OpenAI Codex | [Codex](codex.md) |
| Anything else with MCP | [MCP server reference](mcp.md) |
