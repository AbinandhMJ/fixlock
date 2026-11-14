---
title: CI setup
---

# CI setup

The PR check is what actually enforces locks. Everything else only warns.

## What the check does

`npx fixlock check --base origin/main`:

1. Compares the branch with `origin/main`.
2. For every lock whose lines are gone, looks for an approval from the right person on the PR (see [Team lead guide](team-lead-guide.md#choosing-the-rules)).
3. Flags rewrites of working code as warnings.
4. Exits `1` if any lock is changed without approval, `0` otherwise.

| Flag | Use |
|---|---|
| `--base <ref>` | Branch to compare with (default `origin/main`, or `FIXLOCK_BASE`) |
| `--pr <n>` | PR number, if your CI doesn't expose it |
| `--markdown <file>` | Write a PR comment |
| `--notify` | Reopen linked tracker issues for blocked locks |
| `--json` | Machine-readable output |

The check needs the full history. Fetch with `fetch-depth: 0` or fetch `main` explicitly.

## GitHub Actions

`.github/workflows/fixlock.yml`:

```yaml
name: fixlock
on:
  pull_request:
  pull_request_review:        # re-run when the owner approves
    types: [submitted, dismissed]
permissions: { contents: read, pull-requests: write }
jobs:
  fixlock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Check locked fixes
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}   # only if you use a tracker
        run: npx fixlock check --base origin/${{ github.event.pull_request.base.ref }} --notify --markdown fixlock.md
      - if: always()
        uses: marocchino/sticky-pull-request-comment@v2
        with: { path: fixlock.md, header: fixlock }
```

Then in **Settings → Branches → main**:
- require a pull request before merging
- require the **fixlock** status check
- optionally "Require review from Code Owners" (fixlock writes `.github/CODEOWNERS` from lock owners)

## Jenkins (multibranch pipeline)

Jenkins sets `CHANGE_ID` (PR number) and `CHANGE_AUTHOR`, which fixlock reads.

```groovy
stage('fixlock') {
  when { changeRequest() }
  steps {
    sh 'git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main'
    withCredentials([string(credentialsId: 'github-token', variable: 'GITHUB_TOKEN'),
                     string(credentialsId: 'linear-api-key', variable: 'LINEAR_API_KEY')]) {
      sh 'npx fixlock check --base origin/main --notify --markdown fixlock.md'
    }
  }
  post { always { archiveArtifacts artifacts: 'fixlock.md', allowEmptyArchive: true } }
}
```

- `github-token`: a GitHub token that can read pull requests on the repo.
- On Windows agents use `bat` instead of `sh`.
- Jenkins doesn't re-run on approval by itself. Re-run the job after the owner approves, or trigger builds on review events.

## How approvals are read

fixlock calls the GitHub API for the PR's reviews and uses each reviewer's **latest** review. `APPROVED` counts; a later "changes requested" cancels it. It needs `GITHUB_TOKEN` (or `GH_TOKEN`), the PR number, and the repo name (from `GITHUB_REPOSITORY` or the `origin` remote).

Without a token, no approvals can be read, so every changed lock blocks.

## Other CI systems

Any CI works if it can run Node and has the git history:

```bash
git fetch origin main
GITHUB_TOKEN=… npx fixlock check --base origin/main --pr "$PR_NUMBER" --markdown fixlock.md
```

For GitLab, see the [GitLab example](https://github.com/AbinandhMJ/fixlock/blob/main/examples/ci/gitlab-ci.yml). GitLab and Bitbucket approvals aren't supported yet; the check still works there, but locks can only be cleared by the owner opening the PR or by restoring the lines.
