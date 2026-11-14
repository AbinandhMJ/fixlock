'use strict';
// fixlock for VS Code (and Cursor, Windsurf, VSCodium…): shows locked fixes and features in the editor,
// warns as soon as an edit changes one, lets you lock a selection, and gives Copilot agent mode the
// fixlock MCP tools so it checks before editing.
const vscode = require('vscode');
const path = require('path');
const { execFile } = require('child_process');
const model = require('./model');

const states = new Map(); // repo root -> { root, cfg, locks }
let diagnostics; let decoIntact; let decoChanged; let status; let codeLensEmitter;
const timers = new Map();

/* ---------------- state ---------------- */
function rootFor(uri) {
  if (!uri || uri.scheme !== 'file') return null;
  return model.findRoot(path.dirname(uri.fsPath));
}
function stateFor(root) {
  if (!root) return null;
  if (!states.has(root)) states.set(root, model.loadState(root));
  return states.get(root);
}
function analyzeDoc(doc) {
  const root = rootFor(doc.uri);
  const state = stateFor(root);
  if (!state || !state.locks.length) return { root, items: [] };
  try {
    return { root, items: model.analyze(state, model.relPath(root, doc.uri.fsPath), doc.getText().replace(/\r\n/g, '\n')) };
  } catch (e) {
    console.error('fixlock:', e);
    return { root, items: [] };
  }
}
const cfg = () => vscode.workspace.getConfiguration('fixlock');
const toRange = (doc, [a, b]) => new vscode.Range(Math.max(0, a - 1), 0, Math.max(0, Math.min(b, doc.lineCount) - 1), Number.MAX_SAFE_INTEGER);

/* ---------------- rendering ---------------- */
function refreshEditor(editor) {
  if (!editor) return;
  const doc = editor.document;
  const { items } = analyzeDoc(doc);
  const show = cfg().get('highlightLockedLines', true);
  const intact = []; const changed = [];
  for (const it of items) {
    if (!it.range) continue;
    (it.status === 'changed' ? changed : intact).push({ range: toRange(doc, it.range), hoverMessage: undefined });
  }
  editor.setDecorations(decoIntact, show ? intact : []);
  editor.setDecorations(decoChanged, show ? changed : []);
  if (editor === vscode.window.activeTextEditor) updateStatus(items);
}

function refreshDiagnostics(doc) {
  if (doc.uri.scheme !== 'file') return;
  const { items } = analyzeDoc(doc);
  const out = [];
  for (const it of items) {
    const d = model.diagnostic(it);
    if (!d) continue;
    const range = it.range ? toRange(doc, it.range) : new vscode.Range(0, 0, 0, 0);
    const diag = new vscode.Diagnostic(range, d.message, d.severity === 'info' ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning);
    diag.source = 'fixlock';
    diag.code = it.lock.id;
    out.push(diag);
  }
  diagnostics.set(doc.uri, out);
}

function updateStatus(items) {
  if (!items.length) { status.hide(); return; }
  const broken = items.filter((i) => i.status === 'changed').length;
  status.text = broken ? `$(warning) fixlock: ${broken} lock${broken > 1 ? 's' : ''} changed` : `$(lock) ${items.length} lock${items.length > 1 ? 's' : ''}`;
  status.tooltip = broken ? 'Your edits change locked code in this file. Click to see the locks.' : 'Locked fixes/features in this file. Click to list all locks.';
  status.backgroundColor = broken ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  status.show();
}

function refreshAll() {
  for (const e of vscode.window.visibleTextEditors) refreshEditor(e);
  for (const d of vscode.workspace.textDocuments) refreshDiagnostics(d);
  codeLensEmitter.fire();
}

function scheduleRefresh(doc) {
  clearTimeout(timers.get(doc.uri.toString()));
  timers.set(doc.uri.toString(), setTimeout(() => {
    refreshDiagnostics(doc);
    for (const e of vscode.window.visibleTextEditors) if (e.document === doc) refreshEditor(e);
    codeLensEmitter.fire();
  }, 250));
}

/* ---------------- providers ---------------- */
const hoverProvider = {
  provideHover(doc, pos) {
    const { items } = analyzeDoc(doc);
    const hit = items.filter((i) => i.range && pos.line + 1 >= i.range[0] && pos.line + 1 <= i.range[1]);
    if (!hit.length) return null;
    const md = new vscode.MarkdownString(hit.map(model.hoverText).join('\n\n---\n\n'));
    md.isTrusted = false;
    return new vscode.Hover(md);
  },
};

const codeLensProvider = {
  onDidChangeCodeLenses: null, // set in activate
  provideCodeLenses(doc) {
    if (!cfg().get('codeLens', true)) return [];
    const { items } = analyzeDoc(doc);
    return items.filter((i) => i.range).map((i) => new vscode.CodeLens(new vscode.Range(i.range[0] - 1, 0, i.range[0] - 1, 0), {
      title: `${i.status === 'changed' ? '⚠️' : '🔒'} ${i.lock.id} ${i.lock.title} · ${i.owner}${i.status === 'changed' ? ' · changed by your edit' : ''}`,
      command: 'fixlock.why',
      arguments: [doc.uri, i.range[0]],
    }));
  },
};

/* ---------------- CLI ---------------- */
function nodeEnv(extra = {}) {
  // Run the CLI with the editor's own Node runtime, so users don't need Node installed.
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1', ...extra };
}
function cli(root) { return model.cliPath(root, cfg().get('cliPath') || ''); }

function trusted() {
  if (vscode.workspace.isTrusted !== false) return true;
  vscode.window.showWarningMessage('fixlock commands run code from this repository, so they only work in a trusted workspace.', 'Manage Workspace Trust')
    .then((a) => { if (a) vscode.commands.executeCommand('workbench.trust.manage'); });
  return false;
}

function runCli(root, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli(root), ...args], { cwd: root, env: nodeEnv(), maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

function terminal(root, args, name = 'fixlock') {
  if (!trusted()) return null;
  const t = vscode.window.createTerminal({ name, cwd: root, shellPath: process.execPath, shellArgs: [cli(root), ...args], env: { ELECTRON_RUN_AS_NODE: '1' } });
  t.show();
  return t;
}

function workspaceRoot() {
  const ed = vscode.window.activeTextEditor;
  const fromEditor = ed && rootFor(ed.document.uri);
  if (fromEditor) return fromEditor;
  for (const f of vscode.workspace.workspaceFolders || []) { const r = model.findRoot(f.uri.fsPath); if (r) return r; }
  return null;
}
function folderForInit() {
  const ed = vscode.window.activeTextEditor;
  const f = (ed && vscode.workspace.getWorkspaceFolder(ed.document.uri)) || (vscode.workspace.workspaceFolders || [])[0];
  return f ? f.uri.fsPath : null;
}
function needRepo() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showInformationMessage('fixlock is not set up in this workspace yet.', 'Set up fixlock').then((a) => { if (a) vscode.commands.executeCommand('fixlock.init'); });
  }
  return root;
}

/* ---------------- commands ---------------- */
async function cmdMark() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.scheme !== 'file') return vscode.window.showWarningMessage('Open a file and select the lines that hold the fix.');
  const root = rootFor(ed.document.uri);
  if (!root) return needRepo();
  if (!trusted()) return;
  if (ed.document.isDirty) await ed.document.save();
  const sel = ed.selection;
  const start = sel.start.line + 1;
  const end = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
  const type = await vscode.window.showQuickPick([
    { label: '$(bug) Bug fix', value: 'bug', description: 'a fix that must not come back' },
    { label: '$(star) Feature', value: 'feature', description: 'finished behaviour that must not silently change' },
  ], { title: `Lock lines ${start}-${end}`, placeHolder: 'What are you locking?' });
  if (!type) return;
  const reason = await vscode.window.showInputBox({ title: 'Why does this code exist?', prompt: 'Shown to teammates and AI assistants before they change it', placeHolder: 'e.g. SAP B1 rejects ISO timestamps for DocDate', ignoreFocusOut: true });
  if (!reason) return;
  const title = await vscode.window.showInputBox({ title: 'Short title (optional)', value: reason.length > 60 ? reason.slice(0, 57) + '…' : reason, ignoreFocusOut: true });
  if (title === undefined) return;
  const issue = await vscode.window.showInputBox({ title: 'Linked issue (optional)', placeHolder: 'linear:ENG-12, clickup:abc123, notion:… — leave empty for none', ignoreFocusOut: true });
  if (issue === undefined) return;
  const args = ['mark', model.relPath(root, ed.document.uri.fsPath), `${start}-${end}`, '-m', reason, '--type', type.value];
  if (title) args.push('--title', title);
  if (issue) args.push('--issue', issue);
  const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'fixlock: locking…' }, () => runCli(root, args));
  if (r.code === 0) {
    states.delete(root); refreshAll();
    vscode.window.showInformationMessage(r.out.split('\n').find((l) => /locked/.test(l)) || 'Locked.', 'Commit the lock').then((a) => {
      if (a) vscode.commands.executeCommand('workbench.view.scm');
    });
  } else vscode.window.showErrorMessage(`fixlock: ${r.out || 'could not lock these lines'}`);
}

async function cmdWhy(uri, line) {
  const ed = vscode.window.activeTextEditor;
  const doc = uri ? await vscode.workspace.openTextDocument(uri) : ed && ed.document;
  if (!doc) return;
  const ln = line || (ed ? ed.selection.active.line + 1 : 1);
  const { items } = analyzeDoc(doc);
  const hit = items.filter((i) => i.range && ln >= i.range[0] && ln <= i.range[1]);
  if (!hit.length) return vscode.window.showInformationMessage(`✔ Nothing locked at line ${ln}.`);
  const i = hit[0];
  const lines = [`${i.lock.id} "${i.lock.title}" — ${i.lock.type === 'feature' ? 'feature' : 'bug fix'}, owner ${i.owner}`];
  if (i.lock.reason && i.lock.reason !== i.lock.title) lines.push(`Why: ${i.lock.reason}`);
  lines.push(`AI edits: ${i.policy.onEdit} · PR approval from ${i.approvers.join(' or ') || 'nobody'}`);
  if (i.status === 'changed') lines.push('⚠️ Your current edits change this code.');
  vscode.window.showInformationMessage(lines.join('\n'), { modal: false }, ...(i.lock.issue ? ['Copy issue'] : [])).then((a) => {
    if (a) vscode.env.clipboard.writeText(i.lock.issue);
  });
}

async function cmdList() {
  const root = needRepo();
  if (!root) return;
  const state = stateFor(root);
  if (!state.locks.length) return vscode.window.showInformationMessage('Nothing is locked yet. Select the lines of a fix and run "fixlock: Lock selected lines".');
  const pick = await vscode.window.showQuickPick(model.pickItems(state), { title: `fixlock — ${state.locks.length} lock(s)`, matchOnDescription: true, matchOnDetail: true });
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(path.join(root, pick.lock.file));
  const ed = await vscode.window.showTextDocument(doc);
  const it = model.analyze(state, pick.lock.file, doc.getText().replace(/\r\n/g, '\n')).find((x) => x.lock.id === pick.lock.id);
  if (it && it.range) {
    const r = toRange(doc, it.range);
    ed.selection = new vscode.Selection(r.start, r.start);
    ed.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

function cmdCheck() { const root = needRepo(); if (root) terminal(root, ['check', '--base', cfg().get('baseBranch', 'origin/main')], 'fixlock check'); }
function cmdCheckStaged() { const root = needRepo(); if (root) terminal(root, ['check', '--staged'], 'fixlock check'); }
function cmdInit() {
  const dir = workspaceRoot() || folderForInit();
  if (!dir) return vscode.window.showWarningMessage('Open a folder (a git repository) first.');
  terminal(dir, ['init'], 'fixlock init');
}
function cmdSetup() { const root = needRepo(); if (root) terminal(root, ['setup'], 'fixlock setup'); }
function cmdDemo() { terminal(folderForInit() || require('os').tmpdir(), ['demo'], 'fixlock demo'); }

/* ---------------- MCP (Copilot agent mode) ---------------- */
function registerMcp(context) {
  const lm = vscode.lm;
  if (!lm || typeof lm.registerMcpServerDefinitionProvider !== 'function' || typeof vscode.McpStdioServerDefinition !== 'function') return;
  const changed = new vscode.EventEmitter();
  context.subscriptions.push(changed);
  context.subscriptions.push(lm.registerMcpServerDefinitionProvider('fixlock.mcp', {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions() {
      if (!cfg().get('mcp.enabled', true) || vscode.workspace.isTrusted === false) return [];
      const roots = [...new Set((vscode.workspace.workspaceFolders || []).map((f) => model.findRoot(f.uri.fsPath)).filter(Boolean))];
      return roots.map((root) => {
        const name = roots.length > 1 ? `fixlock (${path.basename(root)})` : 'fixlock';
        const def = new vscode.McpStdioServerDefinition(name, process.execPath, [cli(root), 'mcp'], { ELECTRON_RUN_AS_NODE: '1' }, context.extension.packageJSON.version);
        def.cwd = vscode.Uri.file(root);
        return def;
      });
    },
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()));
  if (vscode.workspace.onDidGrantWorkspaceTrust) context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => changed.fire()));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('fixlock.mcp')) changed.fire(); }));
  return changed;
}

/* ---------------- activate ---------------- */
function activate(context) {
  const media = (f) => vscode.Uri.joinPath(context.extensionUri, 'media', f);
  diagnostics = vscode.languages.createDiagnosticCollection('fixlock');
  decoIntact = vscode.window.createTextEditorDecorationType({
    gutterIconPath: media('lock.svg'), gutterIconSize: '80%', isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('fixlock.lockedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('fixlock.lockedLineRuler'), overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  decoChanged = vscode.window.createTextEditorDecorationType({
    gutterIconPath: media('lock-changed.svg'), gutterIconSize: '80%', isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('fixlock.changedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'), overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'fixlock.listLocks';
  codeLensEmitter = new vscode.EventEmitter();
  codeLensProvider.onDidChangeCodeLenses = codeLensEmitter.event;

  const watcher = vscode.workspace.createFileSystemWatcher('**/.fixlock/{registry,config}.json');
  const reload = (uri) => { const r = model.findRoot(path.dirname(path.dirname(uri.fsPath))); if (r) states.delete(r); else states.clear(); refreshAll(); };
  watcher.onDidChange(reload); watcher.onDidCreate(reload); watcher.onDidDelete(reload);

  const mcpChanged = registerMcp(context);
  if (mcpChanged) watcher.onDidCreate(() => mcpChanged.fire());

  context.subscriptions.push(
    diagnostics, decoIntact, decoChanged, status, codeLensEmitter, watcher,
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
    vscode.window.onDidChangeActiveTextEditor((e) => { if (e) refreshEditor(e); else status.hide(); }),
    vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach(refreshEditor)),
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleRefresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('fixlock')) refreshAll(); }),
    vscode.commands.registerCommand('fixlock.markSelection', cmdMark),
    vscode.commands.registerCommand('fixlock.why', cmdWhy),
    vscode.commands.registerCommand('fixlock.listLocks', cmdList),
    vscode.commands.registerCommand('fixlock.check', cmdCheck),
    vscode.commands.registerCommand('fixlock.checkStaged', cmdCheckStaged),
    vscode.commands.registerCommand('fixlock.init', cmdInit),
    vscode.commands.registerCommand('fixlock.setupAssistants', cmdSetup),
    vscode.commands.registerCommand('fixlock.demo', cmdDemo),
    vscode.commands.registerCommand('fixlock.refresh', () => { states.clear(); refreshAll(); }),
  );
  refreshAll();
}

function deactivate() { for (const t of timers.values()) clearTimeout(t); }

module.exports = { activate, deactivate };
