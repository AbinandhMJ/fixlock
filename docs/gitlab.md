---
title: GitLab
---

# GitLab

fixlock checks merge requests on GitLab.com and self-managed GitLab: a merge request that changes a locked fix fails its pipeline until the lock's owner approves the merge request, and one comment explains which fix changed, why it exists and who must approve.

## Set up

**1. Add the job.** `npx @abinandhmj/fixlock quickstart` does it for you on a GitLab repository. Or add this to `.gitlab-ci.yml`:

```yaml
include:
  - remote: https://raw.githubusercontent.com/AbinandhMJ/fixlock/main/ci/gitlab/fixlock.gitlab-ci.yml
```

It runs in merge request pipelines on `node:22` and needs no install in your project. To run it yourself (another image, a Python project):

```yaml
fixlock:
  stage: test
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: "0"
  script:
    - git fetch --no-tags origin "+refs/heads/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}:refs/remotes/origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"
    - pipx install fixlock    # or npx -y @abinandhmj/fixlock
    - fixlock check --base "origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}" --comment
```

**2. Add a token.** In the project, **Settings > Access tokens**: create a project access token with the **Developer** role and the **api** scope. Add it under **Settings > CI/CD > Variables** as `FIXLOCK_GITLAB_TOKEN`, masked. fixlock uses it to read the merge request's approvals and to post its comment. Without it, a locked change stays blocked and the job log says why.

**3. Add GitLab usernames.** Approvals are matched by username:

```bash
fixlock team add --name "Ravi" --gitlab ravi.k --email ravi@acme.com --role developer
```

A member without a `gitlab` username is matched by their `github` one.

**4. Make it required.** **Settings > Merge requests > Pipelines must succeed**, so a blocked merge request can't be merged.

## After the owner approves

GitLab doesn't re-run pipelines when someone approves, so run the pipeline again (**Pipelines > Run pipeline**, or push a commit). The job then reads the approval and passes. A merge request opened by the lock's owner passes without an approval.

## Options

| Variable | Default | |
|---|---|---|
| `FIXLOCK_VERSION` | `0` | npm version range of fixlock to run |
| `FIXLOCK_ARGS` | | Extra `fixlock check` flags, such as `--run-tests` ([test-linked locks](tests-and-lifecycle.md); use an image with your toolchain) or `--judge` ([AI review](ai-judgment.md)) |

Self-managed GitLab works the same way: fixlock uses the instance's API from `CI_API_V4_URL`.
