package dev.tuneflow

import android.content.Intent
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlaylistUiIntegrationTest {
    @Test fun createsFamilyPlaylistShowsContributorRemovesTracksAndMovesScopes() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val ui = instrumentation.uiAutomation
        ui.executeShellCommand("pm grant com.tuneflow.app android.permission.POST_NOTIFICATIONS").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        val session = Session(context).apply { server = "http://127.0.0.1:18010"; household = "system" }
        val api = Api(session)
        val signed = api.obj("auth/login", "POST", JSONObject().put("household_slug", "system").put("username", "fixture").put("password", "fixture-password"), false)
        session.token = signed.getString("access_token"); session.userId = "1"
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        fun waitNode(description: String, predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo {
            fun visit(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
                if (node == null) return null
                if (node.packageName?.toString() == "com.tuneflow.app" && predicate(node)) return node
                for (i in 0 until node.childCount) visit(node.getChild(i))?.let { return it }
                return null
            }
            val deadline = System.currentTimeMillis() + 12000
            while (System.currentTimeMillis() < deadline) {
                visit(ui.rootInActiveWindow)?.let { return it }
                Thread.sleep(100)
            }
            error("Could not find $description")
        }
        fun clickText(value: String) {
            assertTrue(waitNode(value) { it.isVisibleToUser && it.isClickable && it.text?.toString()?.equals(value, ignoreCase = true) == true }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            Thread.sleep(150)
        }
        fun library() {
            assertTrue(waitNode("Library") { it.isClickable && it.contentDescription?.toString() == "Library" }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            clickText("Playlists and likes")
        }
        val name = "Family UI ${System.currentTimeMillis()}"
        library(); clickText("Create playlist")
        assertTrue(waitNode("name") { it.className?.toString() == "android.widget.EditText" }.performAction(
            AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, name) }))
        clickText("Family playlist"); clickText("Create")
        waitNode("created playlist") { it.text?.startsWith(name) == true }
        val playlists = api.array("playlists?scope=household")
        val playlist = (0 until playlists.length()).map(playlists::getJSONObject).single { it.optString("name") == name }
        val path = "playlists/${playlist.getLong("id")}"
        try {
            api.call("$path/tracks", "POST", JSONObject().put("video_id", "abc123def45").put("title", "Playlist UI song"))
            library()
            assertTrue(waitNode("playlist") { it.isClickable && it.text?.startsWith(name) == true }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            clickText("List")
            assertTrue(waitNode("track menu") { it.contentDescription?.toString() == "Options for Playlist UI song" }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            clickText("Info")
            waitNode("contributor") { it.text?.toString() == "Fixture" }
            assertTrue(waitNode("close info") { it.contentDescription?.toString() == "Close track information" }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            assertTrue(waitNode("track menu") { it.contentDescription?.toString() == "Options for Playlist UI song" }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            clickText("Remove from playlist"); clickText("Remove")
            waitNode("empty playlist") { it.text?.toString() == "No songs found" }
            assertEquals(0, api.obj(path).getJSONArray("tracks").length())
            clickText("Move to personal playlists"); clickText("Move")
            waitNode("personal playlist") { it.text?.toString() == "Move to family playlists" }
            assertEquals("private", api.obj(path).getString("visibility"))
            clickText("Move to family playlists"); clickText("Move")
            waitNode("family playlist") { it.text?.toString() == "Move to personal playlists" }
            assertEquals("household", api.obj(path).getString("visibility"))
        } finally { api.call(path, "DELETE") }
    }
}
