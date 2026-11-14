#!/usr/bin/env node
// Copies the fixlock engine (bin + src + package.json) into ./fixlock so the extension works
// without npm. Runs before packaging (vscode:prepublish) and before tests.
'use strict';
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..', '..', '..');
const out = path.join(__dirname, '..', 'fixlock');
fs.rmSync(out, { recursive: true, force: true });
for (const dir of ['bin', 'src']) fs.cpSync(path.join(repo, dir), path.join(out, dir), { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, license: pkg.license, private: true }, null, 2) + '\n');
fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(__dirname, '..', 'LICENSE'));
console.log(`bundled fixlock ${pkg.version} → ${path.relative(process.cwd(), out) || out}`);
