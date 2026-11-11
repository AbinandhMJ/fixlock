'use strict';
// Child processes in tests must not see the CI's own PR/GitHub variables (e.g. GitHub Actions sets the PR author),
// or fixlock would read approvals for the fixlock repo's PR instead of the test repo.
const LEAKY = /^(GITHUB_|GH_|CHANGE_|FIXLOCK_|LINEAR_|CLICKUP_|NOTION_|CODEX_HOME$)/;
module.exports = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !LEAKY.test(k)));
