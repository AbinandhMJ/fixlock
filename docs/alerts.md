---
title: Slack and Teams alerts
---

# Slack and Teams alerts

fixlock can post to a Slack or Microsoft Teams channel (or any webhook) when a pull request:

| Event | `alerts.on` |
|---|---|
| changes a locked fix or a rule's files and needs approval | `blocked` |
| gets that approval | `approved` |
| is vouched for by a lock's [linked test](tests-and-lifecycle.md) | `satisfied` (off by default) |
| makes a lock's linked test fail | `test-failed` |
| gets an [AI review](ai-judgment.md) saying the fix looks broken | `ai-broken` |
| is merged while still blocked | `merged-blocked` |

Each pull request alerts once per change: pushing again to a PR that's still blocked doesn't post again. (The state is kept, hidden, in fixlock's PR comment.) A message links to the PR and names who must approve; in Slack it @-mentions them if their member ID is on the team.

## Set up

**1. Make a webhook.**
- Slack: create an app with **Incoming Webhooks** for your channel (api.slack.com/apps). The URL starts with `https://hooks.slack.com/`.
- Teams: in the channel, **Workflows** → **Post to a channel when a webhook request is received**. Copy its URL.
- Anything else: any URL that accepts a JSON `POST`.

**2. Store it as a secret** and turn alerts on. GitHub Action:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, closed]   # closed: merged-while-blocked alerts
  pull_request_review:
    types: [submitted, dismissed]
...
      - uses: AbinandhMJ/fixlock@v0.10.0
        with:
          alert: true
        env:
          FIXLOCK_SLACK_WEBHOOK: ${{ secrets.FIXLOCK_SLACK_WEBHOOK }}
          # FIXLOCK_TEAMS_WEBHOOK: ${{ secrets.FIXLOCK_TEAMS_WEBHOOK }}
          # FIXLOCK_ALERT_WEBHOOK: ${{ secrets.FIXLOCK_ALERT_WEBHOOK }}
```

GitLab and Bitbucket: add the variable as a masked/secured variable and `--alert` to the check (`FIXLOCK_ARGS: "--alert"` with the GitLab template). Anywhere else: `fixlock check --alert`, or `"alerts": { "enabled": true }` in `.fixlock/config.json`.

**3. Optional: @-mentions in Slack.** Add each person's Slack member ID (Profile → ⋯ → Copy member ID):

```bash
fixlock team add --name "Ravi" --github ravi --slack U04ABCDE12 --role developer
```

## Choose the events

```json
"alerts": { "on": ["blocked", "merged-blocked"] }
```

## Webhook payload

`FIXLOCK_ALERT_WEBHOOK` receives:

```json
{ "source": "fixlock", "title": "fixlock: #12 changes a locked fix and needs approval",
  "pr": { "number": "#12", "title": "Simplify pay", "url": "https://github.com/acme/shop/pull/12", "author": "@meena" },
  "events": [{ "type": "blocked", "text": "FIX-001 \"never charge zero\" in pay.py: needs approval from @ravi" }] }
```

A failing webhook is reported in the job log and never changes the check's result.
