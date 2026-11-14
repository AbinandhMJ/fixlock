# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
**[Security → Report a vulnerability](https://github.com/AbinandhMJ/fixlock/security/advisories/new)**.

Include what you found, how to reproduce it and the version you used. You'll get a reply within 7 days, and a fix or a plan within 30 days for confirmed issues. Reporters are credited in the release notes unless they prefer not to be.

## Supported versions

Only the latest minor release gets security fixes.

## What fixlock can access

fixlock runs on developer machines, in git hooks, inside AI assistants (as a hook and an MCP server) and in CI, so here is exactly what it touches:

| | What |
|---|---|
| **Runtime dependencies** | None. The npm package is plain Node.js you can read in `src/`. |
| **Network** | None, except: the GitHub API to read PR approvals in `fixlock check` (only when `GITHUB_TOKEN` is set), and your issue tracker / webhook (only when you configure `tracker` and set its token). |
| **Telemetry** | None. fixlock never phones home. |
| **Files it writes in your repo** | `.fixlock/`, AI rules files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/fixlock.mdc`, …), `CHANGELOG.md`, `.github/CODEOWNERS` and PR template, assistant configs (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.claude/settings.json`), git hooks in `.git/hooks/`. |
| **Files outside your repo** | Only when you run `fixlock setup codex` or `setup windsurf`: one `fixlock` entry in that assistant's user config. |
| **Secrets** | Read from environment variables only; never written to disk or printed. |
| **MCP server** | stdio only, no network, read-only tools: it reads the repo and `git blame`; it never edits files. |

## Release integrity

Releases are published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). On the npm page, the provenance badge links each version to the exact commit and workflow run that built it.
