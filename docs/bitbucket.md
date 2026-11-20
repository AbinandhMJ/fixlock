---
title: Bitbucket
---

# Bitbucket

fixlock checks pull requests on Bitbucket Cloud with Bitbucket Pipelines: a pull request that changes a locked fix fails its pipeline until the lock's owner approves it, and one comment explains which fix changed, why it exists and who must approve.

## Set up

**1. Add the step.** `npx @abinandhmj/fixlock quickstart` does it on a Bitbucket repository. Or add to `bitbucket-pipelines.yml`:

```yaml
image: node:22
clone:
  depth: full
pipelines:
  pull-requests:
    '**':
      - step:
          name: fixlock
          script:
            - git fetch origin "+refs/heads/${BITBUCKET_PR_DESTINATION_BRANCH}:refs/remotes/origin/${BITBUCKET_PR_DESTINATION_BRANCH}"
            - npx -y @abinandhmj/fixlock@0 check --base "origin/${BITBUCKET_PR_DESTINATION_BRANCH}" --comment
```

No Node.js in your image? `pipx install fixlock` and run `fixlock check …` instead.

**2. Add a token.** **Repository settings → Access tokens → Create**, with the **Pull requests: Write** scope. Add it under **Repository settings → Repository variables** as `FIXLOCK_BITBUCKET_TOKEN`, secured. fixlock uses it to read approvals and post its comment. Without it, a locked change stays blocked and the log says why.

**3. Add Bitbucket nicknames** (Personal settings → Nickname), which is what approvals are matched on:

```bash
fixlock team add --name "Ravi" --bitbucket ravi_k --email ravi@acme.com --role developer
```

**4. Require it.** Under **Repository settings → Branch restrictions**, require a passing build before merging (a Premium feature on Bitbucket Cloud). Otherwise the failed pipeline and the comment still show the problem.

## After the owner approves

Bitbucket doesn't re-run pipelines on approval: re-run the pipeline from the pull request, or push a commit. A pull request opened by the lock's owner passes without an approval.

Add `--run-tests`, `--judge` or `--alert` to the `check` line for [test-linked locks](tests-and-lifecycle.md), [AI review](ai-judgment.md) and [alerts](alerts.md).
