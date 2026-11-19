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
// Commits scoped to parts that ship on their own don't release the npm/PyPI package (app: deployed to
// Cloudflare on every merge; bench: not shipped). The plugins (vscode, jetbrains, wordpress) have their own
// versions: a feat(jetbrains): or fix(jetbrains): commit bumps the JetBrains plugin in the same release PR.
// When the release PR is merged, `node scripts/release-bot.js tag-plugins` tags each new plugin version
// (vscode-vX.Y.Z, jetbrains-vX.Y.Z, wordpress-vX.Y.Z) and starts its publish workflow.
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

/**
 * The next version after `current` for these commits ([{ subject, body }]), or null for no release.
 * Without `scope`: the npm/PyPI package (commits not scoped to a part that ships on its own). With
 * `scope`: one plugin (only commits with that scope).
 */
function nextVersion(current, commits, scope = null) {
  const parsed = commits.map((c) => parse(c.subject, c.body)).filter((p) => p && (scope ? p.scope === scope : !OWN_RELEASES.has(p.scope)));
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

/** Release notes for a plugin from its commits. */
const pluginNotes = (commits, scope) => commits.map((c) => parse(c.subject, c.body)).filter((p) => p && p.scope === scope && ['feat', 'fix', 'perf'].includes(p.type))
  .map((p) => p.description.replace(/\s*\(#\d+\)$/, '').replace(/^./, (ch) => ch.toUpperCase()));

/** Add a "## X.Y.Z" section at the top of a plugin's CHANGELOG.md (no change if it's there). */
function addMdSection(text, version, notes) {
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}$`, 'm').test(text)) return text;
  const i = text.indexOf('\n## ');
  const head = i === -1 ? text.trimEnd() + '\n' : text.slice(0, i + 1);
  return `${head}\n## ${version}\n\n${notes.map((n) => `- ${n}`).join('\n')}\n${i === -1 ? '' : text.slice(i)}`.replace(/\n{3,}/g, '\n\n');
}

/** Add a "= X.Y.Z =" entry under "== Changelog ==" in a WordPress readme.txt, and set its Stable tag. */
function addWpSection(text, version, notes) {
  text = text.replace(/^Stable tag:.*$/m, `Stable tag: ${version}`);
  if (text.includes(`= ${version} =`)) return text;
  return text.replace('== Changelog ==\n', `== Changelog ==\n\n= ${version} =\n${notes.map((n) => `* ${n}`).join('\n')}\n`).replace(/\n{3,}/g, '\n\n');
}

/** Replace "AbinandhMJ/fixlock@v<from>" with the new version. */
const bumpRefs = (text, from, to) => text.split(`AbinandhMJ/fixlock@v${from}`).join(`AbinandhMJ/fixlock@v${to}`);

/* ---------------- git and GitHub ---------------- */

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
const git = (...args) => sh('git', args);

function lastTag(match = 'v[0-9]*') {
  try { return git('describe', '--tags', '--abbrev=0', '--match', match); } catch { return null; }
}

const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const wr = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text);

/** The plugins that release on their own, with where their version and release notes live. */
const PLUGINS = [
  {
    key: 'vscode', name: 'VS Code extension', workflow: 'vscode-extension.yml', inputs: ['-f', 'publish=both stores'],
    version: () => JSON.parse(rd('extensions/vscode/package.json')).version,
    bump: (v) => wr('extensions/vscode/package.json', rd('extensions/vscode/package.json').replace(/"version": "[^"]+"/, `"version": "${v}"`)),
    released: (v) => new RegExp(`^## ${v.replace(/\./g, '\\.')}$`, 'm').test(rd('extensions/vscode/CHANGELOG.md')),
    notes: (v, n) => wr('extensions/vscode/CHANGELOG.md', addMdSection(rd('extensions/vscode/CHANGELOG.md'), v, n)),
  },
  {
    key: 'jetbrains', name: 'JetBrains plugin', workflow: 'jetbrains-plugin.yml', inputs: ['-f', 'publish=JetBrains Marketplace'],
    version: () => /^pluginVersion\s*=\s*(\S+)/m.exec(rd('extensions/jetbrains/gradle.properties'))[1],
    bump: (v) => wr('extensions/jetbrains/gradle.properties', rd('extensions/jetbrains/gradle.properties').replace(/^pluginVersion\s*=.*$/m, `pluginVersion = ${v}`)),
    released: (v) => new RegExp(`^## ${v.replace(/\./g, '\\.')}$`, 'm').test(rd('extensions/jetbrains/CHANGELOG.md')),
    notes: (v, n) => wr('extensions/jetbrains/CHANGELOG.md', addMdSection(rd('extensions/jetbrains/CHANGELOG.md'), v, n)),
  },
  {
    key: 'wordpress', name: 'WordPress plugin', workflow: 'wordpress-plugin.yml', inputs: ['-f', 'deploy=true'],
    version: () => /^\s*\*\s*Version:\s*(\S+)/m.exec(rd('extensions/wordpress/fixlock/fixlock.php'))[1],
    bump: (v) => wr('extensions/wordpress/fixlock/fixlock.php', rd('extensions/wordpress/fixlock/fixlock.php')
      .replace(/^(\s*\*\s*Version:\s*)\S+/m, `$1${v}`).replace(/define\( 'FIXLOCK_VERSION', '[^']+' \);/, `define( 'FIXLOCK_VERSION', '${v}' );`)),
    released: (v) => rd('extensions/wordpress/fixlock/readme.txt').includes(`= ${v} =`),
    notes: (v, n) => wr('extensions/wordpress/fixlock/readme.txt', addWpSection(rd('extensions/wordpress/fixlock/readme.txt'), v, n)),
  },
];

/** Plugins with commits to release since their last tag: [{ plugin, current, version, notes }]. */
function pluginPlans() {
  const out = [];
  for (const pl of PLUGINS) {
    const current = pl.version();
    const tag = lastTag(`${pl.key}-v[0-9]*`);
    if (!tag) continue; // never released through the bot: tag-plugins tags the current version first
    const commits = commitsSince(tag);
    const version = nextVersion(current, commits, pl.key);
    if (version) out.push({ plugin: pl, current, version, lastTag: tag, notes: pluginNotes(commits, pl.key) });
  }
  return out;
}

/**
 * After the release PR is merged: tag each plugin version that has release notes but no tag yet, and start
 * its publish workflow on that tag. (A tag pushed with the workflow token starts no workflows by itself.)
 */
function tagPlugins() {
  for (const pl of PLUGINS) {
    const v = pl.version();
    const tag = `${pl.key}-v${v}`;
    if (sh('git', ['tag', '--list', tag])) { console.log(`${pl.name} ${v}: already released (${tag}).`); continue; }
    if (!pl.released(v)) { console.log(`::warning::${pl.name} is at ${v} but has no release notes for it, so it wasn't released. Release it through the release PR.`); continue; }
    git('tag', tag);
    git('push', 'origin', tag);
    gh('workflow', 'run', pl.workflow, '--ref', tag, ...pl.inputs);
    console.log(`${pl.name} ${v}: tagged ${tag} and started ${pl.workflow}.`);
  }
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
  return { current: pkg.version, lastTag: tag, version, commits, plugins: pluginPlans() };
}

function apply(version, p = plan()) {
  for (const x of p.plugins) { x.plugin.bump(x.version); x.plugin.notes(x.version, x.notes); }
  if (!version) return '';
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
  if (!p.version && !p.plugins.length) {
    console.log(`No fix:/feat: commits since ${p.lastTag || 'the start'}: nothing to release.`);
    for (const pr of existing) gh('pr', 'close', String(pr.number), '--comment', 'Nothing to release any more.', '--delete-branch');
    return;
  }
  git('checkout', '-B', BRANCH);
  const section = apply(p.version, p);
  git('add', '-A');
  const what = [p.version, ...p.plugins.map((x) => `${x.plugin.key} ${x.version}`)].filter(Boolean).join(', ');
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-q', '-m', `chore(release): ${what}`);
  git('push', '-f', 'origin', BRANCH);

  const title = `chore(release): ${what}`;
  const releases = [
    p.version && `- **fixlock ${p.version}**: npm, PyPI, the GitHub Action tag \`v${p.version}\` and a GitHub release.`,
    ...p.plugins.map((x) => `- **${x.plugin.name} ${x.version}** (from ${x.current}): ${x.plugin.key === 'vscode' ? 'VS Code Marketplace and Open VSX' : x.plugin.key === 'jetbrains' ? 'JetBrains Marketplace' : 'WordPress.org'}, and a GitHub release with the build.`),
  ].filter(Boolean).join('\n');
  const pluginNotesMd = p.plugins.map((x) => `### ${x.plugin.name} ${x.version}\n${x.notes.map((n) => `- ${n}`).join('\n')}`).join('\n\n');
  const body = `Merging this pull request releases:

${releases}

This PR is kept up to date by the release bot as more changes are merged. Edit the release notes here before merging if they need work.

${section.replace(/^## .*\n/, '').trim()}${pluginNotesMd ? `\n\n${pluginNotesMd}` : ''}

<details><summary>${p.commits.length} commit(s) since ${p.lastTag || 'the start'}</summary>

${p.commits.map((c) => `- ${c.subject} (${c.sha.slice(0, 7)})`).join('\n')}
</details>
`;
  const bodyFile = path.join(require('os').tmpdir(), 'release-pr.md');
  fs.writeFileSync(bodyFile, body);
  if (existing.length) gh('pr', 'edit', String(existing[0].number), '--title', title, '--body-file', bodyFile);
  else gh('pr', 'create', '--head', BRANCH, '--base', 'main', '--title', title, '--body-file', bodyFile);
  console.log(`${existing.length ? 'Updated' : 'Opened'} the release PR for ${what}.`);
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'plan') { const p = plan(); console.log(JSON.stringify({ ...p, commits: p.commits.map((c) => c.subject), plugins: p.plugins.map((x) => ({ plugin: x.plugin.key, from: x.current, to: x.version, since: x.lastTag, notes: x.notes })) }, null, 2)); }
    else if (cmd === 'apply') console.log(apply(arg || plan().version));
    else if (cmd === 'pr') openPr();
    else if (cmd === 'tag-plugins') tagPlugins();
    else { console.error('Usage: release-bot.js plan | pr | apply [X.Y.Z] | tag-plugins'); process.exit(2); }
  } catch (e) { console.error(e.stderr ? String(e.stderr) : e.message); process.exit(1); }
}

module.exports = { parse, nextVersion, sectionFromCommits, cutChangelog, bumpRefs, addMdSection, addWpSection, pluginNotes, VERSION_REFS, PLUGINS };
