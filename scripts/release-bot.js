#!/usr/bin/env node
// fixlock release bot. Runs in .github/workflows/release-bot.yml on every push to main.
//
//   node scripts/release-bot.js plan           → what the next release would be (JSON), changes nothing
//   node scripts/release-bot.js pr             → open or update the "chore(release): X.Y.Z" pull request
//   node scripts/release-bot.js apply X.Y.Z    → write the version, CHANGELOG and docs changes locally
//
// The next version comes from Conventional Commits since the last vX.Y.Z tag:
//   breaking change (feat!: or "BREAKING CHANGE:") → next major (next minor while on 0.x)
//   feat:                                           → next minor
//   fix: / perf:                                    → next patch
//   anything else (docs:, test:, chore:, ci:)       → no release
// Commits scoped to parts that ship on their own (vscode: the extension's store releases; app: the
// GitHub App's Cloudflare deploy; bench: not shipped) don't release the npm/PyPI package.
// The CHANGELOG's "Unreleased" section becomes the release's section. If nobody wrote one, the bot
// writes it from the commit subjects.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BRANCH = 'release-bot/next';
const EMPTY = '_No changes yet._';
const OWN_RELEASES = new Set(['vscode', 'jetbrains', 'wordpress', 'app', 'bench']);
// Files that show the Action's version to users (the CHANGELOG keeps its history as it is).
const VERSION_REFS = ['action.yml', 'docs/any-language.md', 'docs/ci-setup.md', 'examples/ci/github-action.yml', 'python/README.md'];

/* ---------------- pure helpers (tested in test/release.js) ---------------- */

/** "feat(app)!: x" → { type: 'feat', scope: 'app', breaking: true, description: 'x' }, or null. */
function parse(subject, body = '') {
  const m = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject.trim());
  if (!m) return null;
  return { type: m[1].toLowerCase(), scope: m[2] || null, breaking: !!m[3] || /^BREAKING[ -]CHANGE:/m.test(body), description: m[4].trim() };
}

/** The next version after `current` for these commits ([{ subject, body }]), or null for no release. */
function nextVersion(current, commits) {
  const parsed = commits.map((c) => parse(c.subject, c.body)).filter((p) => p && !OWN_RELEASES.has(p.scope));
  const [major, minor, patch] = current.split('.').map(Number);
  if (parsed.some((p) => p.breaking)) return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
  if (parsed.some((p) => p.type === 'feat')) return `${major}.${minor + 1}.0`;
  if (parsed.some((p) => p.type === 'fix' || p.type === 'perf')) return `${major}.${minor}.${patch + 1}`;
  return null;
}

/** CHANGELOG bullets from commit subjects, for when the Unreleased section is empty. */
function sectionFromCommits(commits) {
  const groups = { Added: [], Fixed: [], Changed: [] };
  for (const c of commits) {
    const p = parse(c.subject, c.body);
    if (!p) continue;
    const text = `${p.scope ? `**${p.scope}:** ` : ''}${p.description.replace(/\s*\(#\d+\)$/, '')}`;
    if (p.type === 'feat') groups.Added.push(text);
    else if (p.type === 'fix') groups.Fixed.push(text);
    else if (p.type === 'perf') groups.Changed.push(text);
  }
  return Object.entries(groups).filter(([, items]) => items.length).map(([h, items]) => `### ${h}\n${items.map((t) => `- ${t}`).join('\n')}`).join('\n\n');
}

/** Turn "## [Unreleased]" into "## [version] - date" and start a new, empty Unreleased section. */
function cutChangelog(text, version, date, commits) {
  const start = text.indexOf('## [Unreleased]');
  if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  const bodyStart = text.indexOf('\n', start) + 1;
  const next = text.indexOf('\n## [', bodyStart);
  const end = next === -1 ? text.length : next + 1;
  let body = text.slice(bodyStart, end).trim();
  if (!body || body === EMPTY) body = sectionFromCommits(commits) || '### Changed\n- Maintenance release.';
  const section = `## [${version}] - ${date}\n\n${body}\n`;
  return { text: `${text.slice(0, start)}## [Unreleased]\n\n${EMPTY}\n\n${section}\n${text.slice(end)}`.replace(/\n{3,}/g, '\n\n'), section };
}

/** Replace "AbinandhMJ/fixlock@v<from>" with the new version. */
const bumpRefs = (text, from, to) => text.split(`AbinandhMJ/fixlock@v${from}`).join(`AbinandhMJ/fixlock@v${to}`);

/* ---------------- git and GitHub ---------------- */

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
const git = (...args) => sh('git', args);

function lastTag() {
  try { return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'); } catch { return null; }
}

function commitsSince(tag) {
  const raw = git('log', tag ? `${tag}..HEAD` : 'HEAD', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e');
  return raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => { const [sha, subject, body] = r.split('\x1f'); return { sha, subject, body: body || '' }; })
    .filter((c) => !/^chore\(release\)/.test(c.subject));
}

function plan() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const tag = lastTag();
  const commits = commitsSince(tag);
  const version = nextVersion(pkg.version, commits);
  return { current: pkg.version, lastTag: tag, version, commits };
}

function apply(version, p = plan()) {
  sh('npm', ['version', version, '--no-git-tag-version', '--allow-same-version']);
  const file = path.join(ROOT, 'CHANGELOG.md');
  const { text, section } = cutChangelog(fs.readFileSync(file, 'utf8'), version, new Date().toISOString().slice(0, 10), p.commits);
  fs.writeFileSync(file, text);
  for (const rel of VERSION_REFS) {
    const f = path.join(ROOT, rel);
    if (fs.existsSync(f)) fs.writeFileSync(f, bumpRefs(fs.readFileSync(f, 'utf8'), p.current, version));
  }
  return section;
}

function gh(...args) { return sh('gh', args); }

function openPr() {
  const p = plan();
  const existing = JSON.parse(gh('pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number'));
  if (!p.version) {
    console.log(`No fix:/feat: commits since ${p.lastTag || 'the start'}: nothing to release.`);
    for (const pr of existing) gh('pr', 'close', String(pr.number), '--comment', 'Nothing to release any more.', '--delete-branch');
    return;
  }
  git('checkout', '-B', BRANCH);
  const section = apply(p.version, p);
  git('add', '-A');
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-q', '-m', `chore(release): ${p.version}`);
  git('push', '-f', 'origin', BRANCH);

  const title = `chore(release): ${p.version}`;
  const body = `Merging this pull request releases **fixlock ${p.version}**: npm, PyPI, the GitHub Action tag \`v${p.version}\` and a GitHub release.

This PR is kept up to date by the release bot as more changes are merged. Edit \`CHANGELOG.md\` here before merging if the notes need work.

${section.replace(/^## .*\n/, '').trim()}

<details><summary>${p.commits.length} commit(s) since ${p.lastTag || 'the start'}</summary>

${p.commits.map((c) => `- ${c.subject} (${c.sha.slice(0, 7)})`).join('\n')}
</details>
`;
  const bodyFile = path.join(require('os').tmpdir(), 'release-pr.md');
  fs.writeFileSync(bodyFile, body);
  if (existing.length) gh('pr', 'edit', String(existing[0].number), '--title', title, '--body-file', bodyFile);
  else gh('pr', 'create', '--head', BRANCH, '--base', 'main', '--title', title, '--body-file', bodyFile);
  console.log(`${existing.length ? 'Updated' : 'Opened'} the release PR for ${p.version}.`);
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'plan') { const p = plan(); console.log(JSON.stringify({ ...p, commits: p.commits.map((c) => c.subject) }, null, 2)); }
    else if (cmd === 'apply') console.log(apply(arg || plan().version));
    else if (cmd === 'pr') openPr();
    else { console.error('Usage: release-bot.js plan | pr | apply [X.Y.Z]'); process.exit(2); }
  } catch (e) { console.error(e.stderr ? String(e.stderr) : e.message); process.exit(1); }
}

module.exports = { parse, nextVersion, sectionFromCommits, cutChangelog, bumpRefs, VERSION_REFS };
