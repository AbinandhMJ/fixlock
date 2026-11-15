---
title: GitHub App
---

# GitHub App

The fixlock GitHub App runs the same check as [CI](ci-setup.md) on every pull request, with no workflow file in the repository. Install it on a repo that has a `.fixlock/` folder, and each PR gets:

- a **fixlock** check that fails when a locked fix or feature is changed without the owner's approval, and passes again as soon as they approve the PR;
- one PR comment that explains which lock changed, why it exists and who must approve. The comment is edited in place as the PR changes, and clean PRs don't get one.

It reads the code through GitHub's API. Nothing is checked out or stored, and the only code it reads is the files a PR changes plus the `.fixlock/` folder.

## How it decides

The app uses the same engine as `fixlock check`, so the results match the CLI and the GitHub Action:

| Situation | Check |
|---|---|
| The PR doesn't touch locked code, or only reformats it | Passes |
| A locked fix is removed or rewritten | Fails, until an approver (by default the lock's owner) approves the PR |
| The PR author is the lock's owner | Passes |
| The approver's latest review is "changes requested" | Fails again |
| A variable is renamed inside a lock | Passes with a note (see [`matching.renames`](configuration.md)) |
| The repo has no `.fixlock/config.json` | Neutral, with a pointer to set it up |

Locks and policies are read from the **base branch**. A PR can't approve itself by deleting a lock or loosening the policy in the same PR. A PR that sets fixlock up for the first time is judged by its own config.

To make the check mandatory, add **fixlock** as a required status check in the branch protection rules for `main`.

## App or Action?

| | GitHub App | [GitHub Action](ci-setup.md#github-actions) |
|---|---|---|
| Setup per repo | Install the app | Add a workflow file |
| Runs on | The app's server (no Actions minutes) | Your Actions runners |
| Locks and policy from | The base branch | The PR's checkout |
| Working-code rewrite warnings | Not yet | Yes |
| Tracker sync (`--notify`) | Not yet | Yes |
| GitLab, Bitbucket, Jenkins | No | Use the CLI in your CI |

Both can run together. They report the same result.

## Run your own copy

The app is a [Cloudflare Worker](https://workers.cloudflare.com/) in [`app/`](https://github.com/AbinandhMJ/fixlock/tree/main/app). The free plan is enough for most teams. Set-up takes about 15 minutes.

**1. Deploy the Worker**

```bash
git clone https://github.com/AbinandhMJ/fixlock && cd fixlock/app
npx wrangler login
npx wrangler deploy
```

Note the URL it prints, such as `https://fixlock-app.<your-subdomain>.workers.dev`. Opening it in a browser should say "fixlock GitHub App is running".

**2. Register the GitHub App**

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** (for an organization: the organization's settings → Developer settings). Fill in:

| Field | Value |
|---|---|
| GitHub App name | Anything unique, such as `fixlock-yourcompany` |
| Homepage URL | `https://abinandhmj.github.io/fixlock/` |
| Webhook URL | Your Worker URL followed by `/webhook` |
| Webhook secret | A long random string, such as the output of `openssl rand -hex 32`. Keep it for step 3 |
| Repository permissions | **Checks**: Read and write · **Contents**: Read-only · **Pull requests**: Read and write · **Metadata**: Read-only |
| Subscribe to events | **Pull request**, **Pull request review**, **Check run** |
| Where can this app be installed? | Only on this account, or Any account to let others install it |

Create the app, then on its settings page:

- note the **App ID**;
- under **Private keys**, click **Generate a private key**. A `.pem` file downloads.

**3. Give the Worker its secrets**

```bash
npx wrangler secret put APP_ID           # the App ID
npx wrangler secret put WEBHOOK_SECRET   # the webhook secret from step 2
npx wrangler secret put PRIVATE_KEY < path/to/your-app.private-key.pem
```

**4. Install it**

On the app's page, click **Install App** and choose the repositories. Open a pull request in one of them: the **fixlock** check appears within a few seconds.

On GitHub Enterprise Server, also set the `GITHUB_API` variable to your server's API URL, for example `https://github.example.com/api/v3`.

## Deploy updates from GitHub Actions

The repository's **GitHub App** workflow tests the app on every PR. When `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set as repository secrets, it also deploys every change on `main`. Create the token in Cloudflare under **My Profile → API Tokens**, using the "Edit Cloudflare Workers" template. The app's own secrets stay in Cloudflare; deploying doesn't change them.

## Troubleshooting

**No check appears.** On the app's settings page, open **Advanced → Recent Deliveries**. Each delivery should get a `202` response.

- `401 Bad signature`: the webhook secret in GitHub and in the Worker don't match.
- No deliveries at all: check that the app is subscribed to the Pull request event and installed on the repository.

**The check says "could not check this pull request".** The error is in the check's details. A malformed `.fixlock/registry.json` or `config.json` is the usual cause. Run `npx wrangler tail` in `app/` to see the Worker's logs live.

**The check is neutral.** The base branch has no `.fixlock/config.json`. Run `fixlock init` and merge it.
