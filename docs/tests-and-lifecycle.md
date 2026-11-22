---
title: Test-linked locks and lock lifecycle
---

# Test-linked locks and lock lifecycle

## Test-linked locks

A lock says "these lines fix a bug". A test-linked lock also says "and this test proves it". That changes what a pull request needs:

| The PR changes the locked lines and… | Result |
|---|---|
| the linked test still passes, and the PR doesn't change the test | **Satisfied**: the code was restructured but the fix still works, so nobody has to approve |
| the linked test fails | **Blocked**, and the PR comment says the fix looks broken, with the test output |
| the PR also edits the linked test | **Blocked**: a test changed in the same PR can't vouch for it, so the owner approves as usual |
| no linked test | **Blocked** until the owner approves, as before |

So a safe refactor of locked code goes through on its own, and an AI edit that quietly breaks the fix is caught even when the diff looks harmless.

### Link a test

```bash
fixlock link FIX-001 tests/test_refund.py      # or: fixlock mark src/refund.py 7-10 -m "…" --test tests/test_refund.py
fixlock test                                   # run every linked test: each locked fix proved, not just present
```

`fixlock discover` and the GitHub App's setup pull request link a test automatically when the fix's commit added one.

### Turn it on in CI

With the GitHub Action, set `run-tests` and set up your language before it, as you would to run your tests:

```yaml
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
      - uses: AbinandhMJ/fixlock@v0.10.0
        with:
          run-tests: true
```

Elsewhere: `fixlock check --run-tests`, or `"tests": { "run": true }` in `.fixlock/config.json`. Only the tests of locks the change touches run, each once.

### How tests are run

fixlock picks the command from your project:

| Test file | Command |
|---|---|
| Python | `python -m pytest -q <file>` |
| JS/TS | `npx vitest run`, `npx jest` or `npx mocha` (from `package.json`); plain JS: `node --test` |
| Go | `go test ./<folder>/...` |
| Java, Kotlin | `./gradlew test --tests <Class>`, or `mvn -q test -Dtest=<Class>` |
| PHP | `vendor/bin/phpunit <file>` |
| Ruby | `bundle exec rspec <file>` (specs), else `ruby -Itest <file>` |
| Rust | `cargo test` |

Set your own per file extension in `.fixlock/config.json`; `{files}`, `{dir}` and `{class}` are filled in:

```json
"tests": {
  "run": true,
  "satisfies": true,
  "timeout": 600,
  "commands": { ".py": "poetry run pytest -q {files}", ".ts": "pnpm vitest run {files}" }
}
```

`satisfies: false` runs the tests and shows the result, but still asks for the owner's approval.

The GitHub App doesn't run tests (it has no checkout). Use the Action for test-linked locks.

## Lock lifecycle

Locks outlive the code around them: fixes get refactored on purpose, people leave, and some fixes stop mattering. These commands keep locks true.

### Re-lock after an approved change

When an approved PR restructures a locked fix, the lock still points at the old lines, and the [dashboard](dashboard.md) shows it as **Needs re-lock**.

```bash
fixlock relock --changed            # every lock whose lines changed: lock the lines that hold the fix now
fixlock relock FIX-001 --lines 40-46 -m "guard moved into validate()"
```

Without `--lines`, fixlock takes the lines between the first and last locked lines it can still find. If none are left, or they're now far apart, it asks for `--lines`. The old lines are kept in the lock's `history`.

### Hand locks over

```bash
fixlock handover ravi meena          # Ravi's locks now belong to Meena
fixlock handover ravi meena --remove # …and take Ravi off the team
```

### Review and expiry

```bash
fixlock mark src/flags.ts 12-18 -m "Holiday banner" --expires 2027-01-10
fixlock review                       # locks that need a decision
fixlock review FIX-004 --keep        # still needed: mark it reviewed (and drop a past expiry)
fixlock review FIX-004 --keep --expires 2027-06-30
fixlock review FIX-004 --remove
```

`fixlock review` lists locks that are:

- **expired**: past their `--expires` date. An expired lock only warns, it never blocks.
- **needing re-lock**: their lines changed (usually through an approved PR).
- **orphaned**: owned by someone who isn't on the team any more.
- **overdue**: not reviewed for `lifecycle.reviewAfterDays` days, if you set it (`"lifecycle": { "reviewAfterDays": 180 }`).

`fixlock review --strict` exits with 1 when anything needs a decision, for a scheduled CI job.
