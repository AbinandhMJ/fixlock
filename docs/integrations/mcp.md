---
title: MCP server reference
---

# MCP server reference

`fixlock mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. It is read-only, needs no network, and has no dependencies.

## Configure any MCP client

```json
{
  "mcpServers": {
    "fixlock": { "command": "npx", "args": ["--no-install", "fixlock", "mcp"] }
  }
}
```

Use `["-y", "@abinandhmj/fixlock", "mcp"]` if fixlock isn't installed in the project. The server finds the repository from the file paths it's given, the optional `repo` argument, `FIXLOCK_ROOT`, or its working directory.

## Tools

### `fixlock_check_edit`
Call before modifying or deleting existing code.

| Argument | |
|---|---|
| `file` (required) | Absolute, or relative to the repo root |
| `old_text` + `new_text` | A targeted edit |
| `new_content` | A whole-file rewrite |
| `repo` | Repository root (optional) |

Returns a message plus `structuredContent`:

```json
{
  "verdict": "ask",
  "file": "src/date.ts",
  "locks": [{ "id": "FIX-001", "title": "SAP date format", "type": "bug", "owner": "abinandhmj",
              "level": "ask", "lines": [2, 3], "removed": ["…"], "approvers": ["@abinandhmj"] }],
  "workingCode": null
}
```

| Verdict | Meaning for the assistant |
|---|---|
| `ok` | Go ahead |
| `warn` | Go ahead, mention it to the developer |
| `ask` | Explain the finding and wait for the developer's yes |
| `block` | Don't change these lines; build around them |

The verdict follows the team's [policies](../team-lead-guide.md#choosing-the-rules). The lock's owner always gets `ok` for their own locks.

### `fixlock_why`
`file`, optional `line` / `end_line`. Lists locks there with reason, owner, the lines that must stay, and whether the current developer may change them.

### `fixlock_list`
Every lock in the repo.

### `fixlock_check_staged`
Runs the commit-time check on staged changes.

## Who is "the developer"?

The server identifies the developer by `git config user.email`, matched against the team in `.fixlock/config.json`. Override with `FIXLOCK_USER`.
