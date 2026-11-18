package com.algotricz.fixlock

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import java.io.File

private fun projectRoot(project: Project): File? = project.guessProjectDir()?.takeIf { it.isInLocalFileSystem }?.let { File(it.path) }

/** The fixlock repository for the current file, or the project's. */
private fun rootFor(e: AnActionEvent): File? {
    val project = e.project ?: return null
    val vf = e.getData(CommonDataKeys.VIRTUAL_FILE)
    return vf?.takeIf { it.isInLocalFileSystem }?.let { LockStatus.findRoot(File(it.path)) } ?: projectRoot(project)?.let { LockStatus.findRoot(it) ?: it }
}

abstract class FixlockAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun update(e: AnActionEvent) { e.presentation.isEnabledAndVisible = e.project != null }
    protected fun console(e: AnActionEvent, args: List<String>) {
        val project = e.project ?: return
        val root = rootFor(e) ?: return
        FileDocumentManager.getInstance().saveAllDocuments() // the CLI reads files from disk
        FixlockProjectService.getInstance(project).runInConsole(root, args, "fixlock ${args.first()}")
    }
}

class QuickstartAction : FixlockAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val root = projectRoot(project) ?: return
        if (!LockStatus.inGitRepo(root)) {
            Messages.showWarningDialog(project, "${root.name} isn't a git repository yet. Run \"git init\" (or open a cloned repository), then set up fixlock.", "fixlock")
            return
        }
        FileDocumentManager.getInstance().saveAllDocuments()
        FixlockStartup.quickstart(project, root)
    }
}

class LockSelectionAction : FixlockAction() {
    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        val vf = e.getData(CommonDataKeys.VIRTUAL_FILE)
        e.presentation.isEnabledAndVisible = e.project != null && editor != null && vf != null && vf.isInLocalFileSystem && LockStatus.findRoot(File(vf.path)) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val vf = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val root = LockStatus.findRoot(File(vf.path)) ?: return
        val sel = editor.selectionModel
        val doc = editor.document
        val start = doc.getLineNumber(if (sel.hasSelection()) sel.selectionStart else editor.caretModel.offset) + 1
        var end = doc.getLineNumber(if (sel.hasSelection()) sel.selectionEnd else editor.caretModel.offset) + 1
        if (sel.hasSelection() && end > start && sel.selectionEnd == doc.getLineStartOffset(end - 1)) end-- // selection ends at the start of a line
        val why = Messages.showInputDialog(project, "Why must lines $start-$end stay? (This is what teammates and AI assistants will read.)", "Lock Selected Lines", null)?.trim()
        if (why.isNullOrEmpty()) return
        val type = Messages.showDialog(project, "Is this a bug fix or a finished feature?", "Lock Selected Lines", arrayOf("Bug fix", "Feature", "Cancel"), 0, null)
        if (type !in 0..1) return
        FileDocumentManager.getInstance().saveDocument(doc)
        val rel = File(vf.path).relativeTo(root).invariantSeparatorsPath
        FixlockProjectService.getInstance(project).runInConsole(root, listOf("mark", rel, "$start-$end", "-m", why, "--type", if (type == 1) "feature" else "bug"), "fixlock mark") {
            // Re-check the file so the new lock shows up.
            com.intellij.openapi.application.ApplicationManager.getApplication().executeOnPooledThread {
                val text = com.intellij.openapi.application.ApplicationManager.getApplication().runReadAction(com.intellij.openapi.util.Computable { doc.text })
                val locks = FixlockProjectService.getInstance(project).check(File(vf.path), text) ?: return@executeOnPooledThread
                com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater { if (!editor.isDisposed) FixlockEditorListener.paint(editor, locks) }
            }
        }
    }
}

class WhyAction : FixlockAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val vf = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)
        val line = editor?.let { it.document.getLineNumber(it.caretModel.offset) + 1 }
        console(e, listOf("why", if (line != null) "${vf.path}:$line" else vf.path))
    }
}

class ShowLocksAction : FixlockAction() { override fun actionPerformed(e: AnActionEvent) = console(e, listOf("status")) }
class CheckBranchAction : FixlockAction() { override fun actionPerformed(e: AnActionEvent) = console(e, listOf("check")) }
class CheckStagedAction : FixlockAction() { override fun actionPerformed(e: AnActionEvent) = console(e, listOf("check", "--staged")) }
class DiscoverAction : FixlockAction() { override fun actionPerformed(e: AnActionEvent) = console(e, listOf("discover")) }
/** Write the lock rules for JetBrains Junie (.junie/guidelines.md), next to the other assistants' rules. */
class ConnectJunieAction : FixlockAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val root = rootFor(e) ?: return
        val svc = FixlockProjectService.getInstance(project)
        svc.runInConsole(root, listOf("tools", "add", "junie"), "fixlock tools add junie") { code -> if (code == 0) svc.runInConsole(root, listOf("sync"), "fixlock sync") }
    }
}

class FixlockToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val console = FixlockProjectService.getInstance(project).ensureConsole()
        toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(console.component, "", false))
    }
}
