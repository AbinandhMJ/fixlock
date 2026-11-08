# Issue trackers

fixlock can move issues for you:

| Event | What happens |
|---|---|
| A fix is locked (`mark --issue`, or auto-lock from a commit with an issue key) | Issue moves to your "fixed" status, with a comment |
| A PR reverts a locked fix (`check --notify` in CI) | Issue moves to your "reopened" status, with a comment naming the PR |

A tracker failure never fails CI. It's reported in the output.

## Linking issues

Use `--issue` with a prefix:

| Tracker | Example |
|---|---|
| Linear | `--issue linear:ENG-12` |
| ClickUp | `--issue clickup:86abc12` |
| Notion | `--issue notion:<page id>` |
| Bugasura / anything else | `--issue bugasura:BUG-9` or `--issue webhook:BUG-9` |

Auto-lock picks up issue keys from commit messages: `fix(ENG-15): …` or `… [ENG-15]` becomes `linear:ENG-15` (or your configured tracker), and `CU-86abc` becomes `clickup:86abc`.

## Linear

1. Linear → Settings → API → create a personal API key.
2. Set `LINEAR_API_KEY` locally and as a CI secret.
3. Config:
   ```json
   "tracker": { "type": "linear", "onFix": "Done", "onRegression": "In Progress" }
   ```
   Status names must match your team's workflow states exactly (case doesn't matter).

## ClickUp

1. ClickUp → Settings → Apps → generate an API token.
2. Set `CLICKUP_TOKEN`.
3. Config:
   ```json
   "tracker": { "type": "clickup", "onFix": "complete", "onRegression": "reopened" }
   ```
   Statuses must exist in the task's list.

## Notion

1. Create an internal integration at notion.so/my-integrations and share your bugs database with it.
2. Set `NOTION_TOKEN`.
3. Config:
   ```json
   "tracker": { "type": "notion", "statusProperty": "Status", "statusPropertyType": "status",
                "onFix": "Fixed", "onRegression": "Reopened" }
   ```
   Use `"statusPropertyType": "select"` if your column is a Select instead of a Status property. The issue id is the page id (the 32-character part of the page URL).

## Bugasura, Jira and others (webhook)

fixlock sends a JSON POST to a URL you choose. Point it at Zapier, Make or n8n and map it to Bugasura, Jira or anything else.

```json
"tracker": { "type": "webhook", "url": "https://hooks.zapier.com/…", "onFix": "fixed", "onRegression": "reopened" }
```

Payload:

```json
{
  "issue": "BUG-9",
  "status": "reopened",
  "message": "⚠️ fixlock: FIX-003 \"GST rounding\" was reverted in PR #42 …",
  "event": "regression",
  "lock": { "id": "FIX-003", "title": "GST rounding", "type": "bug", "file": "src/app/tax.ts", "owner": "abinandhmj" },
  "pr": "42", "branch": "feature/x", "author": "ravik"
}
```

Set `FIXLOCK_WEBHOOK_SECRET` to receive it in the `X-Fixlock-Secret` header, and check it on the receiving side.

## Turning it off

- Skip a single lock: `npx fixlock mark … --no-sync`
- Skip in CI: leave out `--notify`
- Remove `tracker` from the config to disable it entirely.

Note: with `--notify`, each CI run on a blocked PR adds another comment. Run the job on PR open/update rather than on every event if that gets noisy.
