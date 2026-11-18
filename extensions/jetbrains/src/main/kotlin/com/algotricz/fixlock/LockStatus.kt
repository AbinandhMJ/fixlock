package com.algotricz.fixlock

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File

/** One lock as `fixlock status --json` reports it. Lines are 1-based. */
data class LockInfo(
    val id: String,
    val type: String,
    val title: String,
    val reason: String,
    val file: String,
    val issue: String?,
    val owner: String,
    val approvers: List<String>,
    val policy: String?,
    val status: String, // intact | renamed | changed | missing
    val range: IntRange?,
    val missing: List<String>,
) {
    val isChanged get() = status == "changed" || status == "missing"
}

data class Status(val setUp: Boolean, val gitRepo: Boolean, val root: String?, val locks: List<LockInfo>)

object LockStatus {
    fun parse(json: String): Status {
        val line = json.lineSequence().map { it.trim() }.lastOrNull { it.startsWith("{") } ?: error("fixlock gave no JSON")
        val o = JsonParser.parseString(line).asJsonObject
        val setUp = o.bool("setUp")
        val locks = if (!setUp) emptyList() else o.getAsJsonArray("locks").map { el ->
            val l = el.asJsonObject
            val r = l.get("range")?.takeIf { it.isJsonArray }?.asJsonArray
            LockInfo(
                id = l.str("id"), type = l.str("type"), title = l.str("title"), reason = l.str("reason"), file = l.str("file"),
                issue = l.get("issue")?.takeIf { !it.isJsonNull }?.asString, owner = l.str("owner"),
                approvers = l.getAsJsonArray("approvers")?.map { it.asString } ?: emptyList(),
                policy = l.get("policy")?.takeIf { !it.isJsonNull }?.asString, status = l.str("status"),
                range = r?.let { it[0].asInt..it[1].asInt },
                missing = l.getAsJsonArray("missing")?.map { it.asString } ?: emptyList(),
            )
        }
        return Status(setUp, o.bool("gitRepo") || setUp, o.get("root")?.takeIf { !it.isJsonNull }?.asString, locks)
    }

    private fun JsonObject.str(k: String) = get(k)?.takeIf { !it.isJsonNull }?.asString ?: ""
    private fun JsonObject.bool(k: String) = get(k)?.takeIf { !it.isJsonNull }?.asBoolean ?: false

    /** The repository root that holds .fixlock/config.json for `file`, if any. */
    fun findRoot(file: File): File? {
        var d: File? = if (file.isDirectory) file else file.parentFile
        while (d != null) {
            if (File(d, ".fixlock/config.json").isFile) return d
            d = d.parentFile
        }
        return null
    }

    /** Is `dir` inside a git repository? */
    fun inGitRepo(dir: File): Boolean {
        var d: File? = dir
        while (d != null) {
            if (File(d, ".git").exists()) return true
            d = d.parentFile
        }
        return false
    }

    /** Hover text for a lock, as HTML with everything from the repository escaped. */
    fun tooltip(l: LockInfo): String {
        val e = { s: String -> s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;") }
        val kind = if (l.type == "feature") "Locked feature" else "Locked fix"
        val state = when (l.status) {
            "intact" -> ""
            "renamed" -> "<br><i>A variable was renamed; the logic is unchanged.</i>"
            else -> "<br><b>Changed:</b> this edit undoes the locked lines."
        }
        val approve = when (l.policy) {
            "block" -> "Locked: change it only with the owner"
            "ask" -> "Ask ${e(l.approvers.ifEmpty { listOf(l.owner) }.joinToString(", "))} before changing it"
            else -> "Changing it needs approval from ${e(l.approvers.ifEmpty { listOf(l.owner) }.joinToString(", "))}"
        }
        return buildString {
            append("<html><b>${e(l.id)}</b> ${e(kind)}: ${e(l.title)}")
            if (l.reason.isNotBlank() && l.reason != l.title) append("<br>${e(l.reason)}")
            if (l.issue != null) append("<br>Issue: ${e(l.issue)}")
            append("<br>Owner: ${e(l.owner)}. $approve.")
            append(state)
            append("</html>")
        }
    }
}
