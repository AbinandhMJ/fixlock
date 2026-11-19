package com.algotricz.fixlock

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.util.EnvironmentUtil
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.util.SystemInfo
import java.io.File
import java.nio.charset.StandardCharsets

/**
 * Finds and runs the fixlock command-line tool. The plugin asks the CLI for every answer (lock state,
 * why, check), so the IDE, the git hooks and CI always agree.
 *
 * Order: the path in Settings, the project's own copy (node_modules, so the IDE uses the same version as
 * CI), a `fixlock` command on PATH (pipx/pip/npm -g, no Node.js needed for the pip one), then npx.
 */
object FixlockCli {
    const val NPM_PACKAGE = "@abinandhmj/fixlock@0.9"

    /** How to start fixlock: the command and its leading arguments, or null if nothing is installed. */
    data class Launcher(val command: List<String>, val description: String)

    /** Pure resolution, so it can be tested: `find(name)` looks a program up on PATH. */
    fun resolve(root: File?, configured: String, find: (String) -> File?): Launcher? {
        if (configured.isNotBlank()) {
            val f = File(configured)
            return if (f.name.endsWith(".js")) find("node")?.let { Launcher(listOf(it.path, f.path), "fixlock at ${f.path}") }
            else Launcher(listOf(f.path), "fixlock at ${f.path}")
        }
        val local = root?.let { File(it, "node_modules/@abinandhmj/fixlock/bin/fixlock.js") }
        if (local != null && local.isFile) find("node")?.let { return Launcher(listOf(it.path, local.path), "the project's fixlock (node_modules)") }
        find("fixlock")?.let { return Launcher(listOf(it.path), "fixlock on PATH") }
        find("npx")?.let { return Launcher(listOf(it.path, "-y", NPM_PACKAGE), "npx $NPM_PACKAGE") }
        return null
    }

    fun findOnPath(name: String): File? {
        val names = if (SystemInfo.isWindows) listOf("$name.cmd", "$name.exe", "$name.bat", name) else listOf(name)
        // The login shell's PATH (an IDE started from the Dock or Start menu doesn't inherit the terminal's).
        val path = EnvironmentUtil.getValue("PATH") ?: System.getenv("PATH") ?: return null
        for (dir in path.split(File.pathSeparatorChar).filter { it.isNotBlank() }) {
            for (n in names) {
                val f = File(dir, n)
                if (f.isFile && f.canExecute()) return f
            }
        }
        return null
    }

    fun launcher(root: File?): Launcher? = resolve(root, FixlockSettings.getInstance().state.cliPath, ::findOnPath)

    fun commandLine(root: File, args: List<String>): GeneralCommandLine? {
        val l = launcher(root) ?: return null
        return GeneralCommandLine(l.command + args)
            .withWorkDirectory(root)
            .withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE) // the shell's PATH, also when the IDE started from the Dock
            .withEnvironment("NO_COLOR", "1")
            .withEnvironment("FIXLOCK_CLIENT", "jetbrains")
            .withCharset(StandardCharsets.UTF_8)
    }

    data class Result(val exitCode: Int, val stdout: String, val stderr: String, val timedOut: Boolean)

    /** Run fixlock and wait for it (call off the UI thread). `input` goes to standard input. */
    fun run(root: File, args: List<String>, input: String? = null, timeoutMs: Int = 30_000): Result? {
        val cl = commandLine(root, args) ?: return null
        val handler = CapturingProcessHandler(cl)
        handler.processInput.use { if (input != null) it.write(input.toByteArray(StandardCharsets.UTF_8)) }
        val out = handler.runProcess(timeoutMs)
        return Result(out.exitCode, out.stdout, out.stderr, out.isTimeout)
    }

    const val INSTALL_HINT = "Install fixlock: <code>pipx install fixlock</code> (no Node.js needed) or <code>npm i -D @abinandhmj/fixlock</code>, or set its path in Settings, Tools, fixlock."
}
