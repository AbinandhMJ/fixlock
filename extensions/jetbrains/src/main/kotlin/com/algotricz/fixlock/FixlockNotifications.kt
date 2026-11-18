package com.algotricz.fixlock

import com.intellij.ide.util.PropertiesComponent
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.EditorNotificationProvider
import java.io.File
import java.util.function.Function
import javax.swing.JComponent

/** A banner above a file whose locked lines the current edit undoes. */
class ChangedLockBanner : EditorNotificationProvider {
    override fun collectNotificationData(project: Project, file: VirtualFile): Function<in FileEditor, out JComponent?>? {
        val changed = FixlockProjectService.getInstance(project).locksIn(file.path).filter { it.isChanged }
        if (changed.isEmpty()) return null
        return Function { editor ->
            EditorNotificationPanel(editor, EditorNotificationPanel.Status.Warning).apply {
                val l = changed.first()
                val who = l.approvers.ifEmpty { listOf(l.owner) }.joinToString(", ")
                text = if (changed.size == 1) "${l.id} (${l.title}): this edit undoes a locked ${if (l.type == "feature") "feature" else "fix"}. Merging it needs approval from $who."
                else "This edit undoes ${changed.size} locked fixes (${changed.joinToString(", ") { it.id }}). Merging it needs the owners' approval."
                createActionLabel("Why is it locked?") {
                    val root = LockStatus.findRoot(File(file.path)) ?: return@createActionLabel
                    FixlockProjectService.getInstance(project).runInConsole(root, listOf("why", file.path), "fixlock why")
                }
                createActionLabel("Show the locked lines") { FixlockProjectService.getInstance(project).showLockedLines(l) }
            }
        }
    }
}

/** On opening a git repository that doesn't use fixlock: offer one-click setup (once, unless dismissed). */
class FixlockStartup : ProjectActivity {
    override suspend fun execute(project: Project) {
        if (!FixlockSettings.getInstance().state.suggestSetup) return
        val dir = project.guessProjectDir()?.takeIf { it.isInLocalFileSystem } ?: return
        val root = File(dir.path)
        if (!shouldOffer(root, PropertiesComponent.getInstance(project).getBoolean(DISMISSED))) return
        NotificationGroupManager.getInstance().getNotificationGroup("fixlock")
            .createNotification(
                "Protect the bug fixes in ${root.name}?",
                "fixlock locks your past fixes so AI assistants and pull requests can't quietly undo them. One click, no questions.",
                NotificationType.INFORMATION,
            )
            .addAction(NotificationAction.createSimpleExpiring("Set up fixlock") { quickstart(project, root) })
            .addAction(NotificationAction.createSimpleExpiring("Don't ask again") { PropertiesComponent.getInstance(project).setValue(DISMISSED, true) })
            .notify(project)
    }

    companion object {
        const val DISMISSED = "fixlock.setupDismissed"

        fun shouldOffer(root: File, dismissed: Boolean) = !dismissed && LockStatus.inGitRepo(root) && LockStatus.findRoot(root) == null

        /** Run `fixlock quickstart` in the fixlock tool window, then say what's next. */
        fun quickstart(project: Project, root: File) {
            FixlockProjectService.getInstance(project).runInConsole(root, listOf("quickstart"), "fixlock quickstart") { code ->
                LocalFileSystem.getInstance().refreshAndFindFileByIoFile(root)?.refresh(true, true)
                val group = NotificationGroupManager.getInstance().getNotificationGroup("fixlock")
                if (code == 0) group.createNotification("fixlock is set up in ${root.name}", "Commit the new files and push, so your team and the PR check get them. Reopen files to see their locks.", NotificationType.INFORMATION).notify(project)
                else group.createNotification("fixlock setup didn't finish", "See the fixlock tool window for what went wrong.", NotificationType.ERROR).notify(project)
            }
        }
    }
}
