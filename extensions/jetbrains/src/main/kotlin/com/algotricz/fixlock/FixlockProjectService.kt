package com.algotricz.fixlock

import com.intellij.execution.filters.TextConsoleBuilderFactory
import com.intellij.execution.process.OSProcessHandler
import com.intellij.execution.process.ProcessAdapter
import com.intellij.execution.process.ProcessEvent
import com.intellij.execution.ui.ConsoleView
import com.intellij.execution.ui.ConsoleViewContentType
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.EditorNotifications
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** Per project: lock state per file (from the CLI), the fixlock console, and change alerts. */
@Service(Service.Level.PROJECT)
class FixlockProjectService(private val project: Project) : Disposable {
    /** Absolute path → locks in that file, as of the last check. */
    private val byFile = ConcurrentHashMap<String, List<LockInfo>>()
    /** Lock ids already reported as changed this session (alert once). */
    private val alerted = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var missingCliShown = false
    private var console: ConsoleView? = null

    /** The console shown in the fixlock tool window (created once, disposed with the project). */
    fun ensureConsole(): ConsoleView = console ?: TextConsoleBuilderFactory.getInstance().createBuilder(project).console.also {
        console = it
        com.intellij.openapi.util.Disposer.register(this, it)
    }

    fun locksIn(path: String): List<LockInfo> = byFile[path] ?: emptyList()

    /**
     * Ask the CLI about `file` with `text` (the editor's current, maybe unsaved, content). Off the UI thread.
     * Returns null when fixlock isn't set up or can't run.
     */
    fun check(file: File, text: String): List<LockInfo>? {
        val root = LockStatus.findRoot(file) ?: run { byFile.remove(file.path); return null }
        val r = FixlockCli.run(root, listOf("status", file.path, "--stdin", "--json"), text, 20_000)
        if (r == null) { cliMissing(); return null }
        if (r.timedOut || r.exitCode != 0) { thisLogger().info("fixlock status failed (${r.exitCode}): ${r.stderr.take(500)}"); return null }
        val locks = try { LockStatus.parse(r.stdout).locks } catch (e: Exception) { thisLogger().info("fixlock status: ${e.message}"); return null }
        val previous = byFile.put(file.path, locks) ?: emptyList()
        LocalFileSystem.getInstance().findFileByIoFile(file)?.let { vf -> ApplicationManager.getApplication().invokeLater { if (!project.isDisposed) EditorNotifications.getInstance(project).updateNotifications(vf) } }
        alertNewlyChanged(previous, locks)
        return locks
    }

    private fun alertNewlyChanged(previous: List<LockInfo>, now: List<LockInfo>) {
        if (!FixlockSettings.getInstance().state.notifyChanges) return
        for (l in now) {
            if (!l.isChanged) { alerted.remove(l.id); continue }
            val was = previous.firstOrNull { it.id == l.id }
            if (was != null && was.isChanged) continue
            if (!alerted.add(l.id)) continue
            val who = l.approvers.ifEmpty { listOf(l.owner) }.joinToString(", ")
            NotificationGroupManager.getInstance().getNotificationGroup("fixlock")
                .createNotification(
                    "${l.id}: this edit undoes a locked ${if (l.type == "feature") "feature" else "fix"}",
                    "${esc(l.title)}<br>${if (l.reason.isNotBlank() && l.reason != l.title) "${esc(l.reason)}<br>" else ""}Merging it needs approval from ${esc(who)}.",
                    NotificationType.WARNING,
                )
                .addAction(NotificationAction.createSimple("Why is it locked?") { runInConsole(File(project.basePath ?: "."), listOf("why", l.file), "fixlock why ${l.file}") })
                .addAction(NotificationAction.createSimpleExpiring("Show the locked lines") { showLockedLines(l) })
                .notify(project)
        }
    }

    fun showLockedLines(l: LockInfo) {
        com.intellij.openapi.ui.Messages.showInfoMessage(project, l.missing.joinToString("\n").ifBlank { "(the lines are still there)" }, "${l.id}: the locked lines")
    }

    private fun cliMissing() {
        if (missingCliShown) return
        missingCliShown = true
        NotificationGroupManager.getInstance().getNotificationGroup("fixlock")
            .createNotification("fixlock isn't installed", FixlockCli.INSTALL_HINT, NotificationType.WARNING)
            .addAction(NotificationAction.createSimpleExpiring("Open settings") { com.intellij.openapi.options.ShowSettingsUtil.getInstance().showSettingsDialog(project, FixlockConfigurable::class.java) })
            .notify(project)
    }

    /** Run a fixlock command with its output in the fixlock tool window. `done` runs on exit with the exit code. */
    fun runInConsole(root: File, args: List<String>, title: String, done: ((Int) -> Unit)? = null) {
        val cl = FixlockCli.commandLine(root, args) ?: run { missingCliShown = false; cliMissing(); return }
        val tw = ToolWindowManager.getInstance(project).getToolWindow("fixlock")
        tw?.activate(null, true)
        val console = ensureConsole()
        console.print("\n$ fixlock ${args.joinToString(" ")}\n", ConsoleViewContentType.SYSTEM_OUTPUT)
        try {
            val handler = OSProcessHandler(cl)
            console.attachToProcess(handler)
            handler.addProcessListener(object : ProcessAdapter() {
                override fun processTerminated(event: ProcessEvent) {
                    ApplicationManager.getApplication().invokeLater { if (!project.isDisposed) done?.invoke(event.exitCode) }
                }
            })
            handler.startNotify()
        } catch (e: Exception) {
            console.print("Couldn't start fixlock: ${e.message}\n", ConsoleViewContentType.ERROR_OUTPUT)
        }
    }

    fun forget(vf: VirtualFile) { byFile.remove(vf.path) }

    override fun dispose() { console = null }

    companion object {
        fun getInstance(project: Project): FixlockProjectService = project.getService(FixlockProjectService::class.java)
        fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    }
}
