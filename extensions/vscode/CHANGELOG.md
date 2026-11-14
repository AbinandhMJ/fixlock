# Changelog

## 0.6.0

First release of the fixlock extension.

- Locked lines: gutter icon, highlight, CodeLens and hover with the lock's reason, issue, owner and approvers.
- Live warnings in Problems when an edit changes locked code (structural matching: formatting and comments don't count; renames are noted).
- Commands: lock selected lines, why, show all locks, check branch, check staged, set up, connect AI assistants, demo.
- fixlock's MCP tools for GitHub Copilot agent mode, registered automatically.
- Bundles fixlock and uses the editor's runtime, so no Node.js install is needed. Uses the project's installed fixlock when there is one.
