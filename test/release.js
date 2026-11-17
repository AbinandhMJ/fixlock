#!/usr/bin/env node
// Release bot (scripts/release-bot.js): versions from Conventional Commits, CHANGELOG cutting, doc refs.
'use strict';
const { parse, nextVersion, cutChangelog, sectionFromCommits, bumpRefs } = require('../scripts/release-bot');

let passed = 0;
const ok = (cond, msg, extra) => { if (!cond) { console.error(`FAIL ${msg}${extra ? `\n${extra}` : ''}`); console.error('RELEASE BOT FAIL'); process.exit(1); } passed++; };
const c = (subject, body = '') => ({ subject, body });

// parse
ok(parse('feat(app)!: new API').breaking && parse('feat(app)!: new API').scope === 'app', 'parses scope and "!"');
ok(parse('fix: x', 'BREAKING CHANGE: config renamed').breaking, '"BREAKING CHANGE:" in the body is breaking');
ok(parse('Merge pull request #3 from x/y') === null && parse('update readme') === null, 'non-conventional subjects are ignored');

// nextVersion
ok(nextVersion('0.7.1', [c('docs: typo'), c('test: more'), c('chore: deps')]) === null, 'only docs/test/chore → no release');
ok(nextVersion('0.7.1', [c('fix: crash'), c('docs: x')]) === '0.7.2', 'fix → patch');
ok(nextVersion('0.7.1', [c('perf: faster')]) === '0.7.2', 'perf → patch');
ok(nextVersion('0.7.1', [c('fix: a'), c('feat(app): b')]) === '0.8.0', 'feat → minor');
ok(nextVersion('0.7.1', [c('feat!: drop node 16')]) === '0.8.0', 'breaking on 0.x → minor');
ok(nextVersion('1.4.2', [c('feat: a'), c('fix!: b')]) === '2.0.0', 'breaking on 1.x → major');
ok(nextVersion('1.4.2', [c('feat: a')]) === '1.5.0', 'feat on 1.x → minor');

// CHANGELOG: curated Unreleased notes are kept as the release's section
const curated = '# Changelog\n\nIntro.\n\n## [Unreleased]\n\n### Fixed\n- Hand-written note.\n\n## [0.7.1] - 2026-11-15\n\n### Changed\n- Old.\n';
const a = cutChangelog(curated, '0.8.0', '2026-11-16', [c('fix: ignored because notes exist')]);
ok(a.text.includes('## [Unreleased]\n\n_No changes yet._\n\n## [0.8.0] - 2026-11-16\n\n### Fixed\n- Hand-written note.\n\n## [0.7.1] - 2026-11-15'), 'curated notes become the release section, with a new empty Unreleased', a.text);
ok(!a.text.includes('ignored because notes exist'), "commit subjects aren't added when notes were written");
ok(a.section.startsWith('## [0.8.0] - 2026-11-16'), 'returns the new section');

// CHANGELOG: empty Unreleased → written from the commits
const empty = '# Changelog\n\n## [Unreleased]\n\n_No changes yet._\n\n## [0.7.1] - 2026-11-15\n\n- Old.\n';
const b = cutChangelog(empty, '0.7.2', '2026-11-16', [c('fix(app): clearer webhook errors (#26)'), c('feat: GitHub App'), c('docs: x'), c('perf: faster matching')]);
ok(b.section.includes('### Added\n- GitHub App') && b.section.includes('### Fixed\n- **app:** clearer webhook errors') && b.section.includes('### Changed\n- faster matching'), 'empty Unreleased: notes written from feat/fix/perf commits', b.section);
ok(!b.section.includes('docs:') && !b.section.includes('(#26)'), 'docs commits and PR numbers left out', b.section);
ok(b.text.indexOf('## [Unreleased]') < b.text.indexOf('## [0.7.2]') && b.text.indexOf('## [0.7.2]') < b.text.indexOf('## [0.7.1]'), 'sections stay in order');
ok(sectionFromCommits([c('chore: x')]) === '', 'no notes for chores');
let threw = false; try { cutChangelog('# Changelog\n', '1.0.0', 'd', []); } catch { threw = true; }
ok(threw, 'a CHANGELOG without Unreleased is an error, not a silent skip');

// Doc refs
ok(bumpRefs('uses: AbinandhMJ/fixlock@v0.7.1\nnpm i x@0.7.1', '0.7.1', '0.8.0') === 'uses: AbinandhMJ/fixlock@v0.8.0\nnpm i x@0.7.1', 'only the Action reference is bumped');

console.log(`RELEASE BOT PASS (${passed} checks)`);
