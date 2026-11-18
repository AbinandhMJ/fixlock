package com.algotricz.fixlock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class LockStatusTest {
    // What `fixlock status --json` prints (test/cli.js checks the CLI side of this contract).
    private val sample = """{"version":1,"setUp":true,"root":"/r","project":"shop","locks":[
        {"id":"FIX-001","type":"bug","title":"never charge zero","reason":"Refunds of 0 broke <totals>","file":"pay.py","issue":"#12","test":null,
         "owner":"@abi","approvers":["@abi"],"policy":"ask","status":"intact","range":[2,3],"renames":[],"missing":[]},
        {"id":"FEAT-001","type":"feature","title":"retry","reason":"","file":"pay.py","issue":null,"test":null,
         "owner":"Meena","approvers":[],"policy":"warn","status":"changed","range":null,"renames":[],"missing":["    retry()"]}]}""".replace("\n", "")

    @Test fun parsesStatus() {
        val s = LockStatus.parse("npx noise\n$sample\n")
        assertTrue(s.setUp)
        assertEquals(2, s.locks.size)
        val fix = s.locks[0]
        assertEquals("FIX-001", fix.id); assertEquals(2..3, fix.range); assertEquals("#12", fix.issue); assertFalse(fix.isChanged)
        val feat = s.locks[1]
        assertNull(feat.range); assertTrue(feat.isChanged); assertEquals(listOf("    retry()"), feat.missing); assertNull(feat.issue)
    }

    @Test fun notSetUp() {
        val s = LockStatus.parse("""{"version":1,"setUp":false,"gitRepo":true}""")
        assertFalse(s.setUp); assertTrue(s.gitRepo); assertTrue(s.locks.isEmpty())
    }

    @Test fun tooltipEscapesAndExplains() {
        val t = LockStatus.tooltip(LockStatus.parse(sample).locks[0])
        assertTrue(t, t.contains("Refunds of 0 broke &lt;totals&gt;"))
        assertFalse(t.contains("<totals>"))
        assertTrue(t, t.contains("Ask @abi before changing it"))
        val changed = LockStatus.tooltip(LockStatus.parse(sample).locks[1])
        assertTrue(changed, changed.contains("Locked feature") && changed.contains("undoes the locked lines") && changed.contains("Meena"))
    }

    @Test fun findsRootsAndGitRepos() {
        val tmp = Files.createTempDirectory("fixlock-jb").toFile()
        try {
            val repo = File(tmp, "repo").apply { File(this, ".git").mkdirs(); File(this, ".fixlock").mkdirs() }
            File(repo, ".fixlock/config.json").writeText("{}")
            val src = File(repo, "src/a.py").apply { parentFile.mkdirs(); writeText("x") }
            assertEquals(repo, LockStatus.findRoot(src))
            val plain = File(tmp, "plain").apply { File(this, ".git").mkdirs() }
            assertNull(LockStatus.findRoot(plain))
            assertTrue(LockStatus.inGitRepo(plain))
            assertTrue(FixlockStartup.shouldOffer(plain, false))
            assertFalse(FixlockStartup.shouldOffer(plain, true))
            assertFalse(FixlockStartup.shouldOffer(repo, false))
            assertFalse(FixlockStartup.shouldOffer(File(tmp, "nogit").apply { mkdirs() }, false))
        } finally { tmp.deleteRecursively() }
    }
}
