package com.algotricz.fixlock

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.markup.GutterIconRenderer
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.editor.markup.RangeHighlighter
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.Key
import com.intellij.ui.JBColor
import com.intellij.util.Alarm
import java.awt.Color
import java.io.File
import javax.swing.Icon

/**
 * For every editor on a file in a fixlock repository: mark the locked lines (gutter lock, light
 * background, hover with the why) and check again shortly after each edit, so an edit that undoes a
 * locked fix is flagged while you type, by you or an AI assistant in the IDE.
 */
class FixlockEditorListener : EditorFactoryListener {
    override fun editorCreated(event: EditorFactoryEvent) {
        val editor = event.editor
        val project = editor.project ?: return
        if (editor.isViewer) return
        val vf = FileDocumentManager.getInstance().getFile(editor.document) ?: return
        if (!vf.isInLocalFileSystem) return
        val file = File(vf.path)
        if (LockStatus.findRoot(file) == null) return
        val disposable = (editor as? com.intellij.openapi.editor.ex.EditorEx)?.disposable ?: return
        val alarm = Alarm(Alarm.ThreadToUse.POOLED_THREAD, disposable)
        val refresh = {
            alarm.cancelAllRequests()
            alarm.addRequest({
                if (project.isDisposed || editor.isDisposed) return@addRequest
                val text = ReadAction.compute<String, RuntimeException> { editor.document.text }
                val locks = FixlockProjectService.getInstance(project).check(file, text) ?: return@addRequest
                ApplicationManager.getApplication().invokeLater { if (!editor.isDisposed) paint(editor, locks) }
            }, DELAY_MS)
        }
        editor.document.addDocumentListener(object : DocumentListener {
            override fun documentChanged(event: DocumentEvent) = refresh()
        }, disposable)
        refresh()
    }

    companion object {
        const val DELAY_MS = 700
        private val HIGHLIGHTERS = Key.create<List<RangeHighlighter>>("fixlock.highlighters")
        val LOCKED: Icon = IconLoader.getIcon("/icons/locked.svg", FixlockEditorListener::class.java)
        val CHANGED: Icon = IconLoader.getIcon("/icons/changed.svg", FixlockEditorListener::class.java)
        private val BACKGROUND = JBColor(Color(0xF3FADF), Color(0x2B3322))

        fun paint(editor: Editor, locks: List<LockInfo>) {
            editor.getUserData(HIGHLIGHTERS)?.forEach { editor.markupModel.removeHighlighter(it) }
            if (!FixlockSettings.getInstance().state.highlightLockedLines) { editor.putUserData(HIGHLIGHTERS, emptyList()); return }
            val doc = editor.document
            val made = mutableListOf<RangeHighlighter>()
            for (l in locks) {
                val r = l.range ?: continue
                val first = (r.first - 1).coerceIn(0, maxOf(0, doc.lineCount - 1))
                val last = (r.last - 1).coerceIn(first, maxOf(0, doc.lineCount - 1))
                val attrs = TextAttributes().apply { backgroundColor = if (l.isChanged) null else BACKGROUND }
                val h = editor.markupModel.addRangeHighlighter(doc.getLineStartOffset(first), doc.getLineEndOffset(last), HighlighterLayer.ADDITIONAL_SYNTAX, attrs, HighlighterTargetArea.LINES_IN_RANGE)
                h.gutterIconRenderer = LockGutter(l)
                made += h
            }
            editor.putUserData(HIGHLIGHTERS, made)
        }
    }

    private class LockGutter(val lock: LockInfo) : GutterIconRenderer() {
        override fun getIcon(): Icon = if (lock.isChanged || lock.status == "renamed") CHANGED else LOCKED
        override fun getTooltipText(): String = LockStatus.tooltip(lock)
        override fun getAlignment() = Alignment.LEFT
        override fun equals(other: Any?) = other is LockGutter && other.lock == lock
        override fun hashCode() = lock.hashCode()
    }
}
