package com.algotricz.fixlock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File
import java.nio.file.Files

class FixlockCliTest {
    private val node = File("/usr/bin/node")

    @Test fun prefersTheProjectsCopyThenPathThenNpx() {
        val root = Files.createTempDirectory("fixlock-cli").toFile()
        try {
            val all = mapOf("node" to node, "fixlock" to File("/usr/local/bin/fixlock"), "npx" to File("/usr/bin/npx"))
            assertEquals(listOf("/usr/local/bin/fixlock"), FixlockCli.resolve(root, "", all::get)!!.command)
            val js = File(root, "node_modules/@abinandhmj/fixlock/bin/fixlock.js").apply { parentFile.mkdirs(); writeText("") }
            assertEquals(listOf(node.path, js.path), FixlockCli.resolve(root, "", all::get)!!.command)
            js.delete()
            val npxOnly = mapOf("npx" to File("/usr/bin/npx"))
            assertEquals(listOf("/usr/bin/npx", "-y", FixlockCli.NPM_PACKAGE), FixlockCli.resolve(root, "", npxOnly::get)!!.command)
            assertNull(FixlockCli.resolve(root, "", emptyMap<String, File>()::get))
        } finally { root.deleteRecursively() }
    }

    @Test fun settingsPathWins() {
        val all = mapOf("node" to node, "fixlock" to File("/usr/local/bin/fixlock"))
        assertEquals(listOf("/opt/fixlock"), FixlockCli.resolve(null, "/opt/fixlock", all::get)!!.command)
        assertEquals(listOf(node.path, "/src/fixlock/bin/fixlock.js"), FixlockCli.resolve(null, "/src/fixlock/bin/fixlock.js", all::get)!!.command)
    }
}
