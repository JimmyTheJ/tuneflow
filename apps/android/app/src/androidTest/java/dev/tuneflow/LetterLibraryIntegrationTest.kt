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
class LetterLibraryIntegrationTest {
    @Test fun lettersStartCollapsedFetchOnOpenAndPageOnlyAsScrolled(): Unit = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val ui = instrumentation.uiAutomation
        ui.executeShellCommand("pm grant com.tuneflow.app android.permission.POST_NOTIFICATIONS").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        val session = Session(context).apply { server = "http://127.0.0.1:18010"; household = "system" }
        val api = Api(session)
        val signed = api.obj("auth/login", "POST", JSONObject().put("household_slug", "system").put("username", "fixture").put("password", "fixture-password"), false)
        session.token = signed.getString("access_token"); session.userId = "1"
        context.getSharedPreferences("library_views", 0).edit().putString("artists", "List").putString("albums", "List").apply()
        fun requests(): List<String> = runBlocking {
            val values = api.obj("fixture/library-requests").getJSONArray("requests")
            (0 until values.length()).map(values::getString)
        }
        val baseline = requests().size
        fun find(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
            fun visit(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
                if (node == null) return null
                if (node.packageName?.toString() == "com.tuneflow.app" && predicate(node)) return node
                for (i in 0 until node.childCount) visit(node.getChild(i))?.let { return it }
                return null
            }
            return visit(ui.rootInActiveWindow)
        }
        fun waitNode(description: String, predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo {
            val deadline = System.currentTimeMillis() + 12000
            while (System.currentTimeMillis() < deadline) {
                find(predicate)?.let { return it }; Thread.sleep(100)
            }
            ui.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, java.io.File(context.filesDir, "letter-failure.png").outputStream())
            error("Could not find $description")
        }
        fun clickText(value: String) { assertTrue(value, waitNode(value) { it.isVisibleToUser && it.isClickable && it.text?.toString() == value }.performAction(AccessibilityNodeInfo.ACTION_CLICK)); Thread.sleep(200) }
        fun clickDescription(value: String) { assertTrue(value, waitNode(value) { it.isVisibleToUser && it.isClickable && it.contentDescription?.toString() == value }.performAction(AccessibilityNodeInfo.ACTION_CLICK)); Thread.sleep(200) }
        fun browser() = waitNode("letter browser") { it.className?.toString() == "androidx.recyclerview.widget.RecyclerView" }
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        clickDescription("Library"); clickText("Artists")
        waitNode("letter index") { it.isClickable && it.contentDescription?.toString() == "Expand artists special characters" }
        assertNull("Artists must stay hidden until a group is expanded", find { it.text?.startsWith("Alpha ") == true })
        assertFalse("Collapsed groups must not load entry pages", requests().drop(baseline).any { "initial=" in it })
        clickText("A–Z · Jump to letter"); clickDescription("Jump to artists A")
        waitNode("first artist page") { it.text?.toString() == "Alpha 000" }
        clickDescription("Collapse artists A")
        assertNull(find { it.text?.toString() == "Alpha 000" })
        clickDescription("Expand artists A")
        waitNode("cached first page") { it.text?.toString() == "Alpha 000" }
        var pages = requests().drop(baseline).filter { "/artists?initial=A" in it }
        assertEquals("Opening A should fetch just the first page", 1, pages.size)
        assertTrue(pages.single().contains("offset=0"))
        assertFalse(pages.any { "offset=40" in it })
        assertTrue(waitNode("open artist") { it.isClickable && it.childCount > 0 && (0 until it.childCount).any { i -> it.getChild(i)?.text?.toString() == "Alpha 000" } }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        waitNode("artist detail") { it.text?.toString() == "1 albums · 1 songs" }
        clickDescription("Back")
        waitNode("restored open group") { it.text?.toString() == "Alpha 000" }
        // Scroll the actual RecyclerView: subsequent pages are only needed near its end.
        repeat(18) {
            if (find { node -> node.isVisibleToUser && node.text?.toString() == "Alpha 084" } == null) {
                browser().performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD); Thread.sleep(180)
            }
        }
        waitNode("last artist after lazy paging") { it.text?.toString() == "Alpha 084" }
        pages = requests().drop(baseline).filter { "/artists?initial=A" in it }
        assertTrue(pages.any { "offset=40" in it }); assertTrue(pages.any { "offset=80" in it })
        clickDescription("Library"); clickText("Albums")
        waitNode("album letters") { it.isClickable && it.contentDescription?.toString() == "Expand albums special characters" }
        val albumRequests = requests().drop(baseline).filter { "/albums?initial=" in it }
        assertTrue("Albums start collapsed too", albumRequests.isEmpty())
        clickText("A–Z · Jump to letter"); clickDescription("Jump to albums A")
        waitNode("first album") { it.text?.toString() == "A record 000" }
        clickDescription("Library"); clickText("Artists")
        // Search narrows the index without eagerly fetching the matching entries.
        browser().performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
        repeat(18) {
            if (find { node -> node.isVisibleToUser && node.className?.toString() == "android.widget.EditText" } == null) {
                browser().performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD); Thread.sleep(100)
            }
        }
        val field = waitNode("artist search") { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
        val searchBaseline = requests().size
        field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "Alpha 084") })
        waitNode("one matching artist group") { it.isClickable && it.contentDescription?.toString() == "Expand artists A" }
        assertNull(find { it.text?.toString() == "Alpha 084" && it.className?.toString() == "android.widget.TextView" })
        assertFalse(requests().drop(searchBaseline).any { "initial=" in it })
        clickText("A–Z · Jump to letter"); clickDescription("Jump to artists A")
        waitNode("filtered entry") { it.text?.toString() == "Alpha 084" && it.className?.toString() == "android.widget.TextView" }
        browser().performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
        val beforeViewChange = requests().size
        clickText("Tiles"); clickText("Details")
        waitNode("artist details") { it.text?.toString() == "1 albums · 1 songs" }
        assertEquals("Changing views reuses the loaded page", beforeViewChange, requests().size)
        clickText("List")
        val nextField = waitNode("next search") { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
        nextField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "Alpha 083") })
        // Picking immediately must apply the draft, even before the 300 ms debounce.
        clickText("A–Z · Jump to letter"); clickDescription("Jump to artists A")
        waitNode("immediate filtered jump") { it.text?.toString() == "Alpha 083" && it.className?.toString() == "android.widget.TextView" }
    }
}
