# Publishing @abinandhmj/fixlock

Releases are automated by `.github/workflows/release.yml`.

## One-time setup
1. On npmjs.com: **Access Tokens → Generate New Token → Granular**, with read and write access to `@abinandhmj/fixlock`.
2. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**, named `NPM_TOKEN`, with that token as the value.
   (Or set up npm "trusted publishing" for this repo and the `release.yml` workflow, and skip the token.)

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
