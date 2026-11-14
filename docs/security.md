---
title: Security & privacy
---

# Security & privacy

fixlock runs in your hooks, your AI assistant and your CI, so it's built to be easy to audit.

- **Zero runtime dependencies.** What runs is the code in [`src/`](https://github.com/AbinandhMJ/fixlock/tree/main/src). Nothing else gets pulled in.
- **No telemetry.** fixlock never phones home.
- **Network only when you ask for it:** the GitHub API to read PR approvals in CI (when `GITHUB_TOKEN` is set), and your issue tracker or webhook (when configured).
- **Secrets from environment variables only.** They're never written to disk or printed.
- **Read-only MCP server.** stdio only, no network; it reads files and `git blame` and never edits anything.
- **Never blocks your local work.** Hooks warn; if a hook fails, it stays silent. Only CI enforces.
- **Signed releases.** Every npm version is published from GitHub Actions with [provenance](https://docs.npmjs.com/generating-provenance-statements), linking it to the exact commit that built it.

The full list of files fixlock writes, and how to report a vulnerability, is in [SECURITY.md](https://github.com/AbinandhMJ/fixlock/blob/main/SECURITY.md).
