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
fs.writeFileSync(path.join(root, 'src', 'pay.ts'), 'export function charge(amount) {\n  if (amount <= 0) {\n    throw new Error("amount must be positive");\n  }\n  return amount;\n}\n');
fs.writeFileSync(path.join(root, FILE), ORIG);
const PAY = 'src/pay.ts'; // locked, never opened in the editor: changed on disk by "an AI in a terminal"
const PAY_OK = 'export function charge(amount) {\n  if (amount <= 0) {\n    throw new Error("amount must be positive");\n  }\n  return amount;\n}\n';
const PAY_UNDONE = 'export function charge(amount) {\n  return amount;\n}\n';
fs.writeFileSync(path.join(root, '.fixlock', 'config.json'), JSON.stringify({
  team: [{ name: 'Abi', github: 'abinandhmj', emails: ['abi@example.com'], role: 'lead' }],
}));
fs.writeFileSync(path.join(root, '.fixlock', 'registry.json'), JSON.stringify({ version: 2, locks: [{
  id: 'FIX-001', type: 'bug', title: 'admin guard', reason: 'only admins may reach this endpoint', file: FILE,
  snippet: ['  if (!user || user.role !== "admin") {', '    return res.status(403).json({ error: "forbidden" });'], owner: 'abinandhmj', issue: 'linear:ENG-7',
}, {
  id: 'FIX-002', type: 'bug', title: 'no zero charges', reason: 'zero charges crashed the ledger', file: PAY,
  snippet: ['  if (amount <= 0) {', '    throw new Error("amount must be positive");'], owner: 'abinandhmj',
}] }));

/* ---------- model ---------- */
const model = require('../model');
ok(model.findRoot(path.join(root, 'src')) === root, 'findRoot walks up to the .fixlock folder');
ok(model.findRoot(os.tmpdir()) === null || model.findRoot(os.tmpdir()) !== root, 'findRoot returns null outside a fixlock repo');
const state = model.loadState(root);
ok(state.locks.length === 2 && state.cfg.policies.bug.onEdit === 'ask' && state.cfg.matching.mode === 'structural', 'loadState merges defaults');
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
const watchers = [];
const warnings = [];
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
    showInformationMessage: async () => undefined, showWarningMessage: async (m) => { warnings.push(m); }, showErrorMessage: async () => undefined,
  },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  workspace: {
    isTrusted: true, workspaceFolders: [{ uri: Uri.file(root) }], textDocuments: [doc],
    getConfiguration: () => ({ get: (k, d) => d }),
    createFileSystemWatcher: (pattern) => { const w = { pattern, h: {}, onDidChange(f) { w.h.change = f; }, onDidCreate(f) { w.h.create = f; }, onDidDelete(f) { w.h.del = f; }, dispose() { w.disposed = true; } }; watchers.push(w); return w; },
    onDidSaveTextDocument: on('save'),
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

  // Locked code changed on disk outside the editor (an AI assistant in a terminal, a script)
  const disk = watchers.find((w) => w.pattern && w.pattern.base === root && !w.disposed);
  ok(disk && /src\/pay\.ts/.test(disk.pattern.pattern) && /src\/guard\.ts/.test(disk.pattern.pattern), 'watches the locked files on disk', JSON.stringify(watchers.map((w) => w.pattern)));
  const payUri = Uri.file(path.join(root, PAY));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.writeFileSync(path.join(root, PAY), PAY_UNDONE);
  disk.h.change(payUri);
  await wait(500);
  ok(warnings.length === 1 && /FIX-002 "no zero charges" in src\/pay\.ts was just changed outside the editor/.test(warnings[0]) && /@abinandhmj must approve/.test(warnings[0]), 'AI edit on disk to a closed file → alert naming the lock and who must approve', JSON.stringify(warnings));
  ok((diags.get(payUri.toString()) || []).length === 1, 'and a warning in Problems, though the file is not open');
  disk.h.change(payUri);
  await wait(500);
  ok(warnings.length === 1, 'still changed: no second alert');
  fs.writeFileSync(path.join(root, PAY), PAY_OK);
  disk.h.change(payUri);
  await wait(500);
  ok(warnings.length === 1 && (diags.get(payUri.toString()) || []).length === 0, 'restored: no alert, Problems cleared');
  fs.writeFileSync(path.join(root, PAY), PAY_UNDONE.replace('return amount', 'return  amount'));
  listeners.save.forEach((f) => f({ uri: payUri }));
  disk.h.change(payUri);
  await wait(500);
  ok(warnings.length === 1 && (diags.get(payUri.toString()) || []).length === 1, 'saved by the editor itself: Problems updated, no "outside the editor" alert');
  fs.writeFileSync(path.join(root, PAY), PAY_OK);

  // One-click setup: a git repo without fixlock gets a status bar button and one offer
  const elsewhere = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fixlock-setup-'));
  const plain = path.join(elsewhere, 'plain'); fs.mkdirSync(path.join(plain, '.git'), { recursive: true });
  const notGit = path.join(elsewhere, 'notgit'); fs.mkdirSync(notGit);
  ok(JSON.stringify(model.setupCandidates([root, plain, notGit])) === JSON.stringify([plain]), 'setup is offered only in git repos without fixlock');
  ok(model.setupCandidates([plain], new Set([plain])).length === 0, "not offered where the user said don't ask again");
  const offers = []; const terms = []; const items = []; const store = {};
  let answer = 'Set up fixlock';
  const savedWin = { ...vscodeMock.window }; const savedFolders = vscodeMock.workspace.workspaceFolders;
  vscodeMock.window.showInformationMessage = async (m, ...buttons) => { offers.push({ m, buttons }); return answer; };
  vscodeMock.window.createTerminal = (o) => { terms.push(o); return { show() {} }; };
  vscodeMock.window.createStatusBarItem = () => { const it = { show() { it.shown = true; }, hide() { it.shown = false; }, dispose() {} }; items.push(it); return it; };
  vscodeMock.window.activeTextEditor = undefined;
  vscodeMock.workspace.workspaceFolders = [{ uri: Uri.file(plain) }];
  const wsState = { get: (k) => store[k], update: async (k, v) => { store[k] = v; } };
  delete require.cache[require.resolve('../extension')];
  const ext3 = require('../extension');
  ext3.activate({ ...context, subscriptions: [], workspaceState: wsState });
  await wait(50);
  ok(items.some((it) => it.shown && /Set up fixlock/.test(it.text) && it.command === 'fixlock.quickstart'), 'status bar shows "Set up fixlock"', JSON.stringify(items));
  ok(offers.length === 1 && /Protect the bug fixes in plain/.test(offers[0].m) && offers[0].buttons.includes("Don't ask again"), 'offers setup once, with "Don\'t ask again"', JSON.stringify(offers));
  ok(terms.length === 1 && terms[0].cwd === plain && terms[0].shellArgs.slice(-1)[0] === 'quickstart' && /fixlock[\\/]bin[\\/]fixlock\.js$/.test(terms[0].shellArgs[0]), 'Set up fixlock runs the bundled `fixlock quickstart` in a terminal', JSON.stringify(terms));
  const pk = require('../package.json');
  ok(fs.existsSync(path.join(__dirname, '..', 'fixlock', 'src', 'commands.js')) && /cmdQuickstart/.test(fs.readFileSync(path.join(__dirname, '..', 'fixlock', 'src', 'commands.js'), 'utf8')), 'the bundled CLI has the quickstart command');
  ok(pk.contributes.configuration.properties['fixlock.suggestSetup'].default === true, 'fixlock.suggestSetup setting declared');
  answer = "Don't ask again"; offers.length = 0;
  delete require.cache[require.resolve('../extension')];
  require('../extension').activate({ ...context, subscriptions: [], workspaceState: wsState });
  await wait(50);
  ok(JSON.stringify(store['fixlock.setupDismissed']) === JSON.stringify([plain]), "Don't ask again is remembered for this folder");
  offers.length = 0; items.length = 0;
  delete require.cache[require.resolve('../extension')];
  require('../extension').activate({ ...context, subscriptions: [], workspaceState: wsState });
  await wait(50);
  ok(offers.length === 0 && !items.some((it) => it.shown), 'after "Don\'t ask again": no offer and no button');
  Object.assign(vscodeMock.window, savedWin); vscodeMock.workspace.workspaceFolders = savedFolders;
  fs.rmSync(elsewhere, { recursive: true, force: true });
  ext.deactivate();
  ok(disk.disposed, 'watchers disposed on deactivate');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failure(s)` : '\nVSCODE EXTENSION PASS');
  process.exit(failures ? 1 : 0);
}, 400);
