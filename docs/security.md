---
title: Security & privacy
---

# Security & privacy

fixlock runs in your hooks, your AI assistant and your CI, so it's built to be easy to audit.

- **Zero runtime dependencies.** What runs is the code in [`src/`](https://github.com/AbinandhMJ/fixlock/tree/main/src). Nothing else gets pulled in.
- **No telemetry.** fixlock never phones home.
- **Network only for features you turn on:** your code host's API in CI (to read approvals and post one comment), [alerts](alerts.md) to your Slack/Teams/webhook (no code is sent), [AI review](ai-judgment.md) to the provider you choose (or a local command), and your issue tracker. The [policy](https://github.com/AbinandhMJ/fixlock/blob/main/SECURITY.md#network) lists exactly what each one sends.
- **Secrets from environment variables only.** They're never written to disk or printed.
- **Read-only MCP server.** stdio only, no network; it reads files and `git blame` and never edits anything.
- **The GitHub App stores nothing.** It reads `.fixlock/` and the changed files when a pull request event arrives and keeps no database. Prefer your own servers? [Self-host it](self-hosting.md).
- **Signed, verifiable releases.** npm provenance, PyPI attestations, signed build attestations on every GitHub release file, an SBOM, and a cosign-signed Docker image. Verify any of them:

```bash
npm audit signatures                                                     # npm
gh attestation verify fixlock-bun-linux-x64-baseline -R AbinandhMJ/fixlock   # a release file
gh attestation verify oci://ghcr.io/abinandhmj/fixlock-app:latest -R AbinandhMJ/fixlock   # the App image
```

- **A hardened build.** Every action in fixlock's workflows is pinned to a commit SHA, tokens are read-only by default, and CodeQL and [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/AbinandhMJ/fixlock) check the project continuously.

How to report a vulnerability, the full list of files fixlock writes, and the GitHub App's permissions are in [SECURITY.md](https://github.com/AbinandhMJ/fixlock/blob/main/SECURITY.md).
