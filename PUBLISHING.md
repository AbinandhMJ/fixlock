# Publishing @abinandhmj/fixlock

Everything releases from one pull request that the release bot keeps open: npm, PyPI, the GitHub Action, and the VS Code, JetBrains and WordPress plugins (see [Each release](#each-release)).

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

The release bot (`.github/workflows/release-bot.yml`) does it:

1. Merge pull requests with Conventional Commit titles (`fix:`, `feat:`, `perf:`; `feat!:` for breaking changes). Write user-facing notes under `## [Unreleased]` in `CHANGELOG.md` as you go; if you don't, the bot writes them from the commit subjects.
2. After each merge, the bot keeps one pull request open, **chore(release): X.Y.Z**, with the next version (from the commits), the CHANGELOG section, `server.json`, and the Action's `@vX.Y.Z` in the docs. Edit the notes in that PR if they need work.
3. Merge it when you want to release. The bot tags `vX.Y.Z` and starts the Release workflow, which tests, publishes to npm with provenance, publishes the wheels to PyPI, and creates the GitHub release.

The same release PR releases the plugins, each on its own version:

| Commit scope | Releases | Published to | Needs |
|---|---|---|---|
| `fix(vscode):`, `feat(vscode):` | VS Code extension (`extensions/vscode/package.json`) | VS Code Marketplace, Open VSX, GitHub release with the `.vsix` | `VSCE_PAT` and `OVSX_PAT` secrets, or trusted publishing on both stores |
| `fix(jetbrains):`, `feat(jetbrains):` | JetBrains plugin (`extensions/jetbrains/gradle.properties`) | JetBrains Marketplace, GitHub release with the zip | `JETBRAINS_MARKETPLACE_TOKEN` secret |
| `fix(wordpress):`, `feat(wordpress):` | WordPress plugin (`fixlock.php`, `readme.txt`) | WordPress.org, GitHub release with `fixlock.zip` | `SVN_USERNAME` and `SVN_PASSWORD` secrets, after WordPress.org approves the plugin |

The bot bumps each plugin's version and writes its notes (its CHANGELOG, or the readme's changelog for WordPress). When the release PR is merged, it tags `vscode-vX.Y.Z`, `jetbrains-vX.Y.Z` or `wordpress-vX.Y.Z` and starts that plugin's workflow. A store that already has the version (one uploaded by hand) is skipped, and a missing secret skips only that store: the GitHub release is made anyway. The GitHub App and the docs site need nothing: they deploy on every push to main.

Plugin scopes (and `app`, `bench`) don't release the npm/PyPI package. A change that should ship in both, such as a CLI command an editor plugin uses, needs a `feat(cli):` commit and a plugin commit.

One-time setting for the bot: **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**.

Releasing by hand still works: `npm version minor && git push --follow-tags`.

## MCP Registry
After the npm release, publish the server listing (once per version):
```bash
mcp-publisher login github
mcp-publisher publish          # reads server.json
```

## VS Code extension

Published by `.github/workflows/vscode-extension.yml` with trusted publishing (OIDC), so no tokens are stored.

**VS Code Marketplace**: on marketplace.visualstudio.com/manage → publisher **algotricz** → **Trusted Publishing** → create a policy:

| Field | Value |
|---|---|
| Policy name | `Release workflow` |
| Repository owner | `AbinandhMJ` |
| Repository | `fixlock` |
| Workflow | `vscode-extension.yml` |
| Environment | *(leave empty)* |

**Open VSX** (Cursor, Windsurf, VSCodium):
1. Log in to open-vsx.org with GitHub, link your Eclipse account and sign the Publisher Agreement (Settings → Profile).
2. Create an access token once and create the namespace: `npx ovsx create-namespace algotricz -p <token>`.
3. In the `algotricz` namespace settings, add a trusted publisher: GitHub, owner `AbinandhMJ`, repo `fixlock`, workflow `vscode-extension.yml`. Then delete the token.
   If you'd rather keep a token, save it as the `OVSX_PAT` secret; a token always takes precedence.

**Publish**: Actions → **VS Code extension** → **Run workflow** on `main`, tick **Publish**. Or push a `vscode-v<version>` tag.

