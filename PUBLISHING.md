# Publishing @abinandhmj/fixlock

Releases are automated by `.github/workflows/release.yml`.

## One-time setup: trusted publishing

Releases log in to npm with GitHub's OIDC identity, so no npm token is stored anywhere.

On npmjs.com, open the package → **Settings** → **Trusted Publisher** → **GitHub Actions**, and enter:

| Field | Value |
|---|---|
| Organization or user | `AbinandhMJ` |
| Repository | `fixlock` |
| Workflow filename | `release.yml` |
| Environment | *(leave empty)* |
| Allowed actions | **npm publish** (staged publish alone isn't enough) |

That's all. The workflow already has `id-token: write` and runs on Node 24, which includes npm 11.5.1+.

Once a trusted release has gone out, you can tighten the package's **Publishing access** to "Require two-factor authentication and disallow tokens". Trusted publishing keeps working, and stolen tokens can't publish. Delete any old `NPM_TOKEN` secret and npm automation tokens.

## Each release
1. Add the changes under a new version heading in `CHANGELOG.md`.
2. Run:
   ```bash
   npm version minor        # or patch / major: bumps package.json + server.json version, commits, tags
   git push --follow-tags
   ```
3. The workflow tests, publishes to npm with provenance and creates the GitHub release.

## MCP Registry
After the npm release, publish the server listing (once per version):
```bash
mcp-publisher login github
mcp-publisher publish          # reads server.json
```
