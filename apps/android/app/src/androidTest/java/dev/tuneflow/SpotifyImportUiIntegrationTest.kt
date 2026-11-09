package dev.tuneflow

import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SpotifyImportUiIntegrationTest {
    @Test fun sharingPublicPlaylistOpensReviewAndImportHistoryIsReachable() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val ui = instrumentation.uiAutomation
        ui.executeShellCommand("pm grant com.tuneflow.app android.permission.POST_NOTIFICATIONS").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        val session = Session(context).apply { server = "http://127.0.0.1:18010"; household = "system" }
        val api = Api(session)
        val signed = api.obj("auth/login", "POST", JSONObject().put("household_slug", "system").put("username", "fixture").put("password", "fixture-password"), false)
        session.token = signed.getString("access_token"); session.userId = "1"
        val before = api.array("imports").length()
        val link = "https://open.spotify.com/intl-en/playlist/0123456789abcdefghijkl?si=android"
        context.startActivity(Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_SEND; type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, "Listen to this playlist: $link")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        })
        fun node(description: String, predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo {
            fun visit(n: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
                if (n == null) return null
                if (n.packageName?.toString() == "com.tuneflow.app" && predicate(n)) return n
                for (i in 0 until n.childCount) visit(n.getChild(i))?.let { return it }
                return null
            }
            val deadline = System.currentTimeMillis() + 12000
            while (System.currentTimeMillis() < deadline) {
                visit(ui.rootInActiveWindow)?.let { return it }; Thread.sleep(100)
            }
            error("Could not find $description")
        }
        fun click(value: String) {
            assertTrue(node(value) { it.isClickable && it.text?.toString()?.equals(value, ignoreCase = true) == true }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            Thread.sleep(150)
        }
        node("shared playlist link") { it.text?.toString() == link }
        node("family scope") { it.text?.toString() == "Family playlist" }
        assertTrue(node("YouTube matching switch") { it.text?.toString() == "Match missing songs on YouTube" }.isChecked)
        node("partial playlist notice") { it.text?.contains("Compare the imported count") == true }
        assertEquals("Sharing only opens review; it must not start an import", before, api.array("imports").length())
        click("Cancel")
        assertTrue(node("Library") { it.isClickable && it.contentDescription?.toString() == "Library" }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        click("Playlists and likes"); click("Import history")
        node("history heading") { it.text?.toString() == "Import history" }
        Unit
    }
}
