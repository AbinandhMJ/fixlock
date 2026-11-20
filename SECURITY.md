# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
**[Security → Report a vulnerability](https://github.com/AbinandhMJ/fixlock/security/advisories/new)**.

Include what you found, how to reproduce it and the version you used. You'll get a reply within 7 days, and a fix or a plan within 30 days for confirmed issues. Reporters are credited in the release notes unless they prefer not to be.

## Supported versions

Only the latest minor release of the CLI, the GitHub Action, the editor plugins and the App image gets security fixes.

## What fixlock can access

fixlock runs on developer machines, in git hooks, inside AI assistants (as a hook and an MCP server) and in CI, so here is exactly what it touches:

| | What |
|---|---|
| **Runtime dependencies** | None. The npm package is plain Node.js you can read in `src/`. |
| **Telemetry** | None. fixlock never phones home. |
| **Files it writes in your repo** | `.fixlock/`, AI rules files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/fixlock.mdc`, …), `CHANGELOG.md`, `.github/CODEOWNERS` and PR template, assistant configs and hooks (`.mcp.json`, `.cursor/mcp.json`, `.cursor/hooks.json`, `.windsurf/hooks.json`, `.vscode/mcp.json`, `.claude/settings.json`), CI files it is asked to add (`.github/workflows/fixlock.yml`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`), git hooks in `.git/hooks/`, and short-lived OKs from `fixlock allow` in `.git/fixlock-allow.json`. |
| **Files outside your repo** | Only when you run `fixlock setup codex` or `setup windsurf`: one `fixlock` entry in that assistant's user config. |
| **Secrets** | Read from environment variables only; never written to disk or printed. |
| **MCP server** | stdio only, no network, read-only tools: it reads the repo and `git blame`; it never edits files. |

### Network

Nothing, unless you turn on the feature that needs it:

| Feature | Talks to | Sends |
|---|---|---|
| `fixlock check` in CI | Your code host's API: GitHub (`GITHUB_TOKEN`), GitLab (`FIXLOCK_GITLAB_TOKEN`), Bitbucket (`FIXLOCK_BITBUCKET_TOKEN`) | Reads approvals and the PR author; posts or updates one comment. |
| [Alerts](https://abinandhmj.github.io/fixlock/alerts) (`--alert`) | The Slack, Teams or webhook URL you set | PR number, title, link and author; lock IDs, titles and file names; who must approve. No code. |
| [AI review](https://abinandhmj.github.io/fixlock/ai-judgment) (`--judge`) | The provider you choose (Anthropic by default, any OpenAI-compatible URL) | The changed lock's title, reason and must-keep lines, plus up to `judge.maxLines` (400) lines of that file around it. With `"provider": "command"` it stays on your machine. Off by default; advice only. |
| [Issue trackers](https://abinandhmj.github.io/fixlock/trackers) | Your tracker | The lock or regression you asked it to file. |

## The GitHub App

The hosted App runs on Cloudflare Workers; you can also [run your own copy](https://abinandhmj.github.io/fixlock/self-hosting).

- **Permissions:** Checks (read and write), Pull requests (read and write), Contents (read and write, only to open the setup pull request on install; read-only works if you don't want that), Metadata (read).
- **What it reads:** `.fixlock/` from the pull request's base branch and the changed files of the pull request, through the GitHub API, when a pull request event arrives.
- **What it stores:** nothing. No database: it answers each webhook and forgets it. The dashboard caches per-repository summaries in memory for 5 minutes and keeps your sign-in in an encrypted, HttpOnly cookie.
- **Webhooks** are refused unless their HMAC signature matches the App's secret.

## Release integrity

Every published artifact is built by GitHub Actions from a tagged commit, with no stored publishing tokens where the store allows it (npm, PyPI, VS Code Marketplace and Open VSX use trusted publishing / OIDC).

| Artifact | How to verify it |
|---|---|
| npm `@abinandhmj/fixlock` | [npm provenance](https://docs.npmjs.com/generating-provenance-statements): `npm audit signatures`, or the badge on the npm page |
| PyPI `fixlock` | [PEP 740 attestations](https://docs.pypi.org/attestations/), shown on each file's page |
| Standalone binaries, SBOM, VS Code `.vsix`, JetBrains zip, WordPress zip (GitHub releases) | `gh attestation verify <file> -R AbinandhMJ/fixlock`; binaries also have `SHA256SUMS` |
| Docker image `ghcr.io/abinandhmj/fixlock-app` | `gh attestation verify oci://ghcr.io/abinandhmj/fixlock-app:latest -R AbinandhMJ/fixlock`, or `cosign verify ghcr.io/abinandhmj/fixlock-app:latest --certificate-identity-regexp '^https://github.com/AbinandhMJ/fixlock/' --certificate-oidc-issuer https://token.actions.githubusercontent.com`. The image also carries an SBOM and build provenance. |

Each release has a CycloneDX SBOM (`fixlock.cdx.json`). fixlock has no runtime dependencies, so it lists only fixlock itself.

## How the project is kept safe

- Every GitHub Action in fixlock's workflows and in `action.yml` is pinned to a full commit SHA; Dependabot updates them. Tools run in release steps are pinned to exact versions. A test (`test/workflows.js`) fails CI if any of this slips.
- Workflow tokens are read-only by default; each job asks only for what it needs.
- [CodeQL](https://github.com/AbinandhMJ/fixlock/security/code-scanning) scans every pull request, and [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/AbinandhMJ/fixlock) rates the project weekly.
- fixlock can't be switched off from inside a pull request: CI and the App check every PR with the base branch's locks and settings, and a PR that removes or weakens a lock, or changes the settings, needs the lock's owner or a lead. See [Changes to `.fixlock/` itself](https://abinandhmj.github.io/fixlock/ci-setup#changes-to-fixlock-itself).
- Secret scanning with push protection and Dependabot security updates are on for the repository.
