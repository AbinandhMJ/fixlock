package com.algotricz.fixlock

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.COLUMNS_LARGE
import com.intellij.ui.dsl.builder.panel

@Service(Service.Level.APP)
@State(name = "FixlockSettings", storages = [Storage("fixlock.xml")])
class FixlockSettings : PersistentStateComponent<FixlockSettings.State> {
    class State {
        var cliPath: String = ""
        var highlightLockedLines: Boolean = true
        var suggestSetup: Boolean = true
        var notifyChanges: Boolean = true
    }

    private var state = State()
    override fun getState(): State = state
    override fun loadState(s: State) { state = s }

    companion object {
        fun getInstance(): FixlockSettings = ApplicationManager.getApplication().getService(FixlockSettings::class.java)
    }
}

class FixlockConfigurable : BoundConfigurable("fixlock") {
    override fun createPanel(): DialogPanel {
        val s = FixlockSettings.getInstance().state
        return panel {
            row {
                checkBox("Highlight locked lines (gutter lock and background)").bindSelected(s::highlightLockedLines)
            }
            row {
                checkBox("Warn when an edit changes a locked fix").bindSelected(s::notifyChanges)
            }
            row {
                checkBox("Offer \"Set up fixlock\" in git repositories that don't use it").bindSelected(s::suggestSetup)
            }
            row("fixlock command:") {
                textField().bindText(s::cliPath).columns(COLUMNS_LARGE)
                    .comment("Leave empty to use the project's node_modules copy, then <code>fixlock</code> on PATH (<code>pipx install fixlock</code>), then npx. Or give a path to the <code>fixlock</code> binary or <code>bin/fixlock.js</code>.")
            }
        }
    }
}
