#!/usr/bin/env node
// Generates docs/public/llms.txt (index) and llms-full.txt (all guides) so AI assistants can read the docs.
// Runs before the docs build. Spec: https://llmstxt.org
'use strict';
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const SITE = 'https://abinandhmj.github.io/fixlock';
const pkg = require('../package.json');

const sections = [
  ['Guides', ['getting-started', 'team-lead-guide', 'developer-guide', 'ai-tools']],
  ['AI assistants', ['integrations/index', 'integrations/claude-code', 'integrations/cursor', 'integrations/copilot', 'integrations/codex', 'integrations/mcp']],
  ['Setup', ['ci-setup', 'trackers']],
  ['Reference', ['configuration', 'cli-reference', 'troubleshooting', 'security']],
];

const read = (slug) => fs.readFileSync(path.join(DOCS, slug + '.md'), 'utf8');
const strip = (md) => md.replace(/^---[\s\S]*?---\s*/, '').replace(/^:::.*$/gm, '').trim();
const title = (md) => (md.match(/^title:\s*(.+)$/m) || md.match(/^#\s+(.+)$/m) || [, ''])[1].trim();
const firstPara = (md) => (strip(md).split('\n\n').find((p) => p && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('```')) || '').replace(/\n/g, ' ').slice(0, 180);
const url = (slug) => `${SITE}/${slug.replace(/(^|\/)index$/, '$1')}`;

let index = `# fixlock\n\n> ${pkg.description}\n\n`;
index += 'fixlock is a zero-dependency Node.js CLI (npm: `@abinandhmj/fixlock`). Teams lock the lines that hold a bug fix or feature, each with an owner. ' +
  'AI assistants check edits against locks through the fixlock MCP server (`npx fixlock mcp`, tools: fixlock_check_edit, fixlock_why, fixlock_list, fixlock_check_staged) ' +
  'or their rules file; a Claude Code hook checks edits before they happen; CI blocks PRs that revert a lock until its owner approves.\n\n';
index += 'Quick start: `npm i -D @abinandhmj/fixlock && npx fixlock init`, then `npx fixlock setup <claude-code|cursor|copilot|codex>`.\n\n';
let full = `# fixlock — full documentation\n\n> ${pkg.description}\n\n`;
for (const [name, slugs] of sections) {
  index += `## ${name}\n\n`;
  for (const slug of slugs) {
    const md = read(slug);
    index += `- [${title(md)}](${url(slug)}): ${firstPara(md)}\n`;
    full += `\n\n---\n\n<!-- ${url(slug)} -->\n\n${strip(md)}\n`;
  }
  index += '\n';
}
index += `## Optional\n\n- [Full documentation in one file](${SITE}/llms-full.txt)\n- [Source on GitHub](https://github.com/AbinandhMJ/fixlock)\n- [npm package](https://www.npmjs.com/package/@abinandhmj/fixlock)\n`;

fs.mkdirSync(path.join(DOCS, 'public'), { recursive: true });
fs.writeFileSync(path.join(DOCS, 'public', 'llms.txt'), index);
fs.writeFileSync(path.join(DOCS, 'public', 'llms-full.txt'), full.trim() + '\n');
console.log(`llms.txt (${index.length} chars), llms-full.txt (${full.length} chars)`);
