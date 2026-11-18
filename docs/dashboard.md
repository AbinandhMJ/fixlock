---
title: Team dashboard
---

# Team dashboard

The fixlock dashboard shows every locked fix across your repositories on one page:

- **Open pull requests waiting for approval**: which PRs fixlock is blocking right now, and why.
- **Recently stopped**: closed PRs that fixlock blocked at least once, and how each ended (approved and merged, closed, or merged while still blocked).
- **Locks to re-lock**: locks whose lines changed on the default branch, usually through an approved PR, so they no longer guard anything until they're locked on the new lines.
- **Locks and owners**: every lock, its owner and whether that owner can approve on GitHub (approvals need a GitHub username in `.fixlock/config.json`).

It's part of the [GitHub App](github-app.md). Open [fixlock-app.abinandhmurukesan.workers.dev/dashboard](https://fixlock-app.abinandhmurukesan.workers.dev/dashboard) and sign in with GitHub.

## Who sees what

You sign in with your own GitHub account, and the dashboard asks GitHub which repositories **you** can open where the fixlock App is installed. A repository you don't have access to on GitHub never appears, and opening its dashboard URL returns "Not found" without fixlock reading anything from it.

Nothing is stored. Each page is read live from GitHub (`.fixlock/` and the locked files on the default branch, open and recently closed PRs, and fixlock's check runs) and cached for 5 minutes. **Refresh now** on a repository page skips the cache. Your session is an encrypted cookie that lasts 8 hours; **Sign out** deletes it.

## Turn it on for your own copy of the App

If you [run your own copy](github-app.md#run-your-own-copy), the dashboard needs three more settings. Without them, `/dashboard` says which ones are missing and the rest of the App works as before.

**1. Add the callback URL.** On the GitHub App's settings page (**General**), under **Identifying and authorizing users**, set **Callback URL** to your Worker URL followed by `/auth/callback`, for example `https://fixlock-app.<your-subdomain>.workers.dev/auth/callback`. Save.

**2. Create a client secret.** On the same page, note the **Client ID**, and under **Client secrets** click **Generate a new client secret**. Copy it: GitHub shows it once.

**3. Give the Worker the secrets.**

```bash
npx wrangler secret put CLIENT_ID        # the Client ID, such as Iv23li...
npx wrangler secret put CLIENT_SECRET    # the client secret from step 2
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` encrypts the session cookies. Changing it signs everyone out.

No new permissions are needed: the dashboard uses the App's existing **Checks**, **Contents**, **Pull requests** and **Metadata** read access. On GitHub Enterprise Server, also set `GITHUB_WEB` to your server's web URL, such as `https://github.example.com`, next to `GITHUB_API`.

## What the states mean

| Lock state | Meaning |
|---|---|
| Intact | The locked lines are on the default branch, as locked |
| Renamed | The lines are there with a variable renamed (allowed by [`matching.renames`](configuration.md)) |
| Needs re-lock | The locked lines aren't on the default branch any more. Lock the new lines with `fixlock mark`, or remove the lock if the fix is gone for good |
| File missing | The locked file was deleted or moved |

| Stopped PR outcome | Meaning |
|---|---|
| Approved, then merged | An approver signed off on the change to the locked code |
| Closed without merging | The PR was dropped, usually because it undid a fix |
| Merged while blocked | Merged with the fixlock check failing. Make **fixlock** a required status check to prevent this |
