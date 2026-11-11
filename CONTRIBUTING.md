# Contributing to fixlock

Thanks for helping! Bug reports, docs fixes and new integrations are all welcome.

## Setup

```bash
git clone https://github.com/AbinandhMJ/fixlock && cd fixlock
npm test          # no install needed: fixlock has zero runtime dependencies
npm install       # only for the docs site
npm run docs:dev  # http://localhost:5173/fixlock/
```

Tests are plain Node scripts that build throwaway git repos: `test/e2e.js` (CLI, hooks, CI check), `test/mcp.js` (MCP server + assistant setup), `test/trackers.js` (tracker APIs against a mock server). CI runs them on Linux, Windows and macOS with Node 18, 20 and 22.

## Principles

1. **Zero runtime dependencies.** Anyone should be able to read what runs in their hooks and CI.
2. **Never break someone's flow.** Local hooks warn; only CI enforces. A failing hook stays silent rather than blocking work.
3. **Explain, don't just block.** Every warning says which fix, why it exists, and who can approve.
4. **Work with every AI assistant.** Prefer open standards (MCP, AGENTS.md) over tool-specific tricks.

## Pull requests

- One change per PR, with a test.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`fix: …`, `feat: …`, `docs: …`).
- Add a line to `CHANGELOG.md` under the next version.
- New assistant integration? Add it to `src/agents.js` (rules file) and/or `src/setup.js` (MCP config), plus a page in `docs/integrations/`.

## Releasing (maintainers)

```bash
npm version minor   # or patch / major — updates package.json, commits, tags
git push --follow-tags
```

The Release workflow tests, publishes to npm with provenance and creates the GitHub release from `CHANGELOG.md`.
