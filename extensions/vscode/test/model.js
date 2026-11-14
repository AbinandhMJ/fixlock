#!/usr/bin/env node
// Tests for the VS Code extension without VS Code: model.js directly, then extension.js against a
// small mock of the vscode API (activation, decorations, diagnostics, hover, CodeLens, MCP).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`ok   ${msg}`);
  else { failures++; console.log(`FAIL ${msg}\n${extra}`); }
};

/* ---------- a repo with one lock ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-vscode-'));
const root = fs.realpathSync(tmp);
const FILE = 'src/guard.ts';
const ORIG = 'export function guard(user, res) {\n  if (!user || user.role !== "admin") {\n    return res.status(403).json({ error: "forbidden" });\n  }\n}\n';
fs.mkdirSync(path.join(root, '.fixlock'), { recursive: true });
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, FILE), ORIG);
fs.writeFileSync(path.join(root, '.fixlock', 'config.json'), JSON.stringify({
  team: [{ name: 'Abi', github: 'abinandhmj', emails: ['abi@example.com'], role: 'lead' }],
}));
fs.writeFileSync(path.join(root, '.fixlock', 'registry.json'), JSON.stringify({ version: 2, locks: [{
  id: 'FIX-001', type: 'bug', title: 'admin guard', reason: 'only admins may reach this endpoint', file: FILE,
  snippet: ['  if (!user || user.role !== "admin") {', '    return res.status(403).json({ error: "forbidden" });'], owner: 'abinandhmj', issue: 'linear:ENG-7',
}] }));

/* ---------- model ---------- */
const model = require('../model');
ok(model.findRoot(path.join(root, 'src')) === root, 'findRoot walks up to the .fixlock folder');
ok(model.findRoot(os.tmpdir()) === null || model.findRoot(os.tmpdir()) !== root, 'findRoot returns null outside a fixlock repo');
const state = model.loadState(root);
ok(state.locks.length === 1 && state.cfg.policies.bug.onEdit === 'ask' && state.cfg.matching.mode === 'structural', 'loadState merges defaults');
let items = model.analyze(state, FILE, ORIG);
ok(items.length === 1 && items[0].status === 'intact' && items[0].range.join('-') === '2-3', 'analyze: intact lock and its lines', JSON.stringify(items));
ok(items[0].owner === '@abinandhmj' && items[0].approvers.includes('@abinandhmj'), 'analyze: owner and approvers');
ok(model.diagnostic(items[0]) === null, 'no diagnostic for an intact lock');
ok(/FIX-001/.test(model.hoverText(items[0])) && /only admins/.test(model.hoverText(items[0])) && /linear:ENG-7/.test(model.hoverText(items[0])), 'hover shows id, why and issue');

items = model.analyze(state, FILE, ORIG.replace("'", '"').replace('if (!user || user.role !== "admin") {', "if (!user ||\n      user.role !== 'admin') {"));
ok(items[0].status === 'intact' && items[0].range.join('-') === '2-4', 'analyze follows reformatted code', JSON.stringify(items[0].range));
items = model.analyze(state, FILE, ORIG.replace('!==', '==='));
ok(items[0].status === 'changed' && model.diagnostic(items[0]).severity === 'warning' && /approval from @abinandhmj/.test(model.diagnostic(items[0]).message), 'logic change → warning diagnostic naming the approver');
items = model.analyze(state, FILE, ORIG.replace(/\bres\b/g, 'reply'));
ok(items[0].status === 'renamed' && model.diagnostic(items[0]).severity === 'info', 'rename → info diagnostic');
ok(model.analyze(state, 'src/other.ts', 'x').length === 0, 'files without locks have no items');
ok(model.pickItems(state)[0].label.includes('FIX-001') && model.pickItems(state)[0].detail.includes('only admins'), 'picker items');
ok(model.cliPath(root, '').endsWith(path.join('fixlock', 'bin', 'fixlock.js')) && fs.existsSync(model.cliPath(root, '')), 'bundled CLI exists');
fs.mkdirSync(path.join(root, 'node_modules', '@abinandhmj', 'fixlock', 'bin'), { recursive: true });
fs.writeFileSync(path.join(root, 'node_modules', '@abinandhmj', 'fixlock', 'bin', 'fixlock.js'), '');
ok(model.cliPath(root, '').startsWith(path.join(root, 'node_modules')), 'prefers the project-installed CLI');
ok(model.cliPath(root, '/x/fixlock.js') === '/x/fixlock.js', 'cliPath setting wins');

/* ---------- extension.js against a mock vscode ---------- */
const registered = { commands: {}, hovers: [], lenses: [], mcp: null };
const setDecos = [];
const diags = new Map();
class Emitter { constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; } fire(x) { this.l.forEach((f) => f(x)); } dispose() {} }
class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
class Uri { constructor(p) { this.fsPath = p; this.scheme = 'file'; } toString() { return 'file://' + this.fsPath; } static file(p) { return new Uri(p); } static joinPath(u, ...p) { return new Uri(path.join(u.fsPath, ...p)); } }
const listeners = {};
const on = (name) => (f) => { (listeners[name] = listeners[name] || []).push(f); return { dispose() {} }; };
let text = ORIG;
const doc = { uri: Uri.file(path.join(root, FILE)), getText: () => text, lineCount: 6, isDirty: false };
const editor = { document: doc, setDecorations: (type, ranges) => setDecos.push({ type, ranges }), selection: { active: { line: 1 } } };
const vscodeMock = {
  Range, Uri, EventEmitter: Emitter,
  Hover: class { constructor(md) { this.contents = md; } },
  MarkdownString: class { constructor(v) { this.value = v; } },
  CodeLens: class { constructor(range, command) { this.range = range; this.command = command; } },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  DiagnosticSeverity: { Warning: 1, Information: 2 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  OverviewRulerLane: { Left: 1 }, StatusBarAlignment: { Left: 1 }, ProgressLocation: { Notification: 15 },
  McpStdioServerDefinition: class { constructor(label, command, args, env, version) { Object.assign(this, { label, command, args, env, version }); } },
  window: {
    activeTextEditor: editor, visibleTextEditors: [editor],
    createTextEditorDecorationType: (o) => ({ o, dispose() {} }),
    createStatusBarItem: () => ({ show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} }),
    onDidChangeActiveTextEditor: on('active'), onDidChangeVisibleTextEditors: on('visible'),
    showInformationMessage: async () => undefined, showWarningMessage: async () => undefined, showErrorMessage: async () => undefined,
  },
  workspace: {
    isTrusted: true, workspaceFolders: [{ uri: Uri.file(root) }], textDocuments: [doc],
    getConfiguration: () => ({ get: (k, d) => d }),
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
    onDidOpenTextDocument: on('open'), onDidChangeTextDocument: on('change'), onDidCloseTextDocument: on('close'),
    onDidChangeConfiguration: on('config'), onDidChangeWorkspaceFolders: on('folders'), onDidGrantWorkspaceTrust: on('trust'),
    getWorkspaceFolder: () => ({ uri: Uri.file(root) }),
  },
  languages: {
    createDiagnosticCollection: () => ({ set: (u, d) => diags.set(u.toString(), d), delete: (u) => diags.delete(u.toString()), dispose() {} }),
    registerHoverProvider: (sel, p) => { registered.hovers.push(p); return { dispose() {} }; },
    registerCodeLensProvider: (sel, p) => { registered.lenses.push(p); return { dispose() {} }; },
  },
  commands: { registerCommand: (id, f) => { registered.commands[id] = f; return { dispose() {} }; }, executeCommand: async () => {} },
  lm: { registerMcpServerDefinitionProvider: (id, p) => { registered.mcp = { id, p }; return { dispose() {} }; } },
  env: { clipboard: { writeText: async () => {} } },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : origResolve.call(this, req, ...rest); };
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeMock };

const ext = require('../extension');
const pkg = require('../package.json');
const context = { subscriptions: [], extensionUri: Uri.file(path.join(__dirname, '..')), extension: { packageJSON: pkg } };
let threw = null;
try { ext.activate(context); } catch (e) { threw = e; }
ok(!threw, 'activate() runs', threw && threw.stack);

const declared = pkg.contributes.commands.map((c) => c.command).sort();
ok(JSON.stringify(Object.keys(registered.commands).sort()) === JSON.stringify(declared), 'every declared command is registered (and nothing else)', Object.keys(registered.commands).join(','));
const intactDeco = setDecos.filter((d) => d.ranges.length).pop();
ok(intactDeco && intactDeco.ranges[0].range.start.line === 1 && intactDeco.ranges[0].range.end.line === 2, 'locked lines are decorated (lines 2-3)', JSON.stringify(setDecos));
ok((diags.get(doc.uri.toString()) || []).length === 0, 'no diagnostics while the lock is intact');

const hover = registered.hovers[0].provideHover(doc, { line: 1 });
ok(hover && /FIX-001/.test(hover.contents.value), 'hover on a locked line');
ok(registered.hovers[0].provideHover(doc, { line: 4 }) === null, 'no hover elsewhere');
const lenses = registered.lenses[0].provideCodeLenses(doc);
ok(lenses.length === 1 && /FIX-001 admin guard · @abinandhmj/.test(lenses[0].command.title) && lenses[0].command.command === 'fixlock.why', 'CodeLens above the lock');

// Edit the document so it breaks the lock: diagnostics appear after the debounce
text = ORIG.replace('403', '200');
listeners.change.forEach((f) => f({ document: doc }));
setTimeout(async () => {
  const d = diags.get(doc.uri.toString()) || [];
  ok(d.length === 1 && d[0].severity === 1 && d[0].code === 'FIX-001' && d[0].source === 'fixlock', 'editing locked code → warning in Problems', JSON.stringify(d));
  const changedDeco = setDecos.slice(-2).find((x) => x.ranges.length);
  ok(changedDeco && changedDeco.type.o.gutterIconPath.fsPath.endsWith('lock-changed.svg'), 'changed lock gets the warning decoration');
  ok(/changed by your edit/.test(registered.lenses[0].provideCodeLenses(doc)[0].command.title), 'CodeLens says the edit changes it');

  // MCP for Copilot agent mode
  ok(registered.mcp && registered.mcp.id === 'fixlock.mcp' && pkg.contributes.mcpServerDefinitionProviders[0].id === 'fixlock.mcp', 'MCP provider registered with the declared id');
  const defs = await registered.mcp.p.provideMcpServerDefinitions();
  ok(defs.length === 1 && defs[0].label === 'fixlock' && defs[0].args[1] === 'mcp' && defs[0].env.ELECTRON_RUN_AS_NODE === '1' && defs[0].cwd.fsPath === root, 'MCP server definition runs `fixlock mcp` in the repo', JSON.stringify(defs));
  vscodeMock.workspace.isTrusted = false;
  ok((await registered.mcp.p.provideMcpServerDefinitions()).length === 0, 'no MCP server in an untrusted workspace');
  vscodeMock.workspace.isTrusted = true;

  // Without the MCP API (older VS Code / forks) activation still works
  delete require.cache[require.resolve('../extension')];
  const saved = vscodeMock.lm; delete vscodeMock.lm;
  let threw2 = null;
  try { require('../extension').activate({ ...context, subscriptions: [] }); } catch (e) { threw2 = e; }
  ok(!threw2, 'activates on editors without the MCP API (older VS Code, some forks)', threw2 && threw2.stack);
  vscodeMock.lm = saved;

  ext.deactivate();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failure(s)` : '\nVSCODE EXTENSION PASS');
  process.exit(failures ? 1 : 0);
}, 400);
