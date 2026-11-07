package dev.tuneflow

import android.content.ComponentName
import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/** Runs against the loopback fixture, verifying real native controls and drag gestures. */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class DiscoveryUiIntegrationTest {
    @Test fun discoveryPersistsShowsInfoAndQueueSupportsLongPressDragging() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val ui = instrumentation.uiAutomation
        ui.executeShellCommand("pm grant com.tuneflow.app android.permission.POST_NOTIFICATIONS").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        val session = Session(context).apply { server = "http://127.0.0.1:18010"; household = "system" }
        val signed = Api(session).obj("auth/login", "POST", JSONObject().put("household_slug", "system").put("username", "fixture").put("password", "fixture-password"), false)
        session.token = signed.getString("access_token"); session.userId = "1"
        SearchHistory(context, "${session.server}|${session.userId}").apply { rememberResults = true; clearResults(); clearHistory() }
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
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
                find(predicate)?.let { return it }
                Thread.sleep(100)
            }
            error("Could not find $description")
        }
        fun clickDescription(value: String) { assertTrue(value, waitNode(value) { it.isVisibleToUser && it.isClickable && it.contentDescription?.toString() == value }.performAction(AccessibilityNodeInfo.ACTION_CLICK)); Thread.sleep(200) }
        fun clickText(value: String) { assertTrue(value, waitNode(value) { it.isVisibleToUser && it.isClickable && it.text?.toString() == value }.performAction(AccessibilityNodeInfo.ACTION_CLICK)); Thread.sleep(200) }
        fun enter(value: String) {
            val field = waitNode("search field") { it.className?.toString() == "android.widget.EditText" }
            assertTrue(field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }))
        }
        clickDescription("YouTube")
        enter("Fixture song")
        Thread.sleep(600)
        assertNull("Typing should only suggest; YouTube search must wait for submission", find { it.text?.startsWith("Results for") == true })
        clickDescription("Search YouTube")
        waitNode("submitted results") { it.text?.toString() == "Results for “Fixture song”" }
        clickDescription("Library"); clickDescription("YouTube")
        waitNode("restored results") { it.text?.toString() == "Results for “Fixture song”" }
        clickDescription("Clear YouTube search and results")
        waitNode("recent query") { it.text?.toString() == "↖   Fixture song" }
        enter("fixtre sng")
        clickText("↖   Fixture song")
        waitNode("fuzzy suggestion search") { it.text?.toString() == "Results for “Fixture song”" }
        val firstMenu = waitNode("track menu") { it.contentDescription?.startsWith("Options for First song") == true }
        assertTrue(firstMenu.performAction(AccessibilityNodeInfo.ACTION_CLICK)); clickText("Info")
        waitNode("full selectable title") { it.isTextSelectable && it.text?.contains("deliberately long video title") == true }
        waitNode("uploader") { it.text?.toString() == "Fixture uploader" }
        waitNode("full source link") { it.text?.toString() == "https://www.youtube.com/watch?v=abc123def45" }
        clickDescription("Close track information")
        clickText("Play all · 3 tracks")
        lateinit var future: com.google.common.util.concurrent.ListenableFuture<MediaController>
        instrumentation.runOnMainSync { future = MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync() }
        val player = future.get(20, TimeUnit.SECONDS)
        fun waitPlayer(description: String, check: () -> Boolean) {
            val deadline = System.currentTimeMillis() + 10000
            while (System.currentTimeMillis() < deadline) {
                var done = false; instrumentation.runOnMainSync { done = check() }; if (done) return
                Thread.sleep(100)
            }
            error(description)
        }
        try {
            waitPlayer("Play all should start a background queue") { player.mediaItemCount == 3 && player.isPlaying }
            instrumentation.runOnMainSync { player.pause(); player.repeatMode = Player.REPEAT_MODE_OFF }
            fun addManual(prefix: String) {
                assertTrue(waitNode("menu for $prefix") { it.contentDescription?.startsWith("Options for $prefix") == true }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                clickText("Add to your queue")
            }
            addManual("Third song"); addManual("Second song")
            waitPlayer("Manual queue should precede context") { player.mediaItemCount == 5 && PlaybackQueue.lane(player.getMediaItemAt(1)) == PlaybackQueue.MANUAL }
            // The mini-player's text is clickable and opens the full player.
            assertTrue(waitNode("mini player") { it.isClickable && it.text?.startsWith("First song") == true }.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            val recycler = waitNode("scrolling player") { it.className?.toString() == "androidx.recyclerview.widget.RecyclerView" || it.className?.toString() == PlayerQueuePanel::class.java.name }
            repeat(3) {
                if (find { it.contentDescription?.startsWith("Hold and drag Third song") == true } == null) {
                    recycler.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD); Thread.sleep(300)
                }
            }
            val source = waitNode("manual drag source") { it.contentDescription?.startsWith("Hold and drag Second song") == true }
            val target = waitNode("manual drag target") { it.contentDescription?.startsWith("Hold and drag Third song") == true }
            val from = Rect(); val to = Rect(); source.getBoundsInScreen(from); target.getBoundsInScreen(to)
            val endY = to.exactCenterY() - to.height() / 3f
            val down = SystemClock.uptimeMillis()
            fun touch(action: Int, x: Float, y: Float) {
                val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0).apply { setSource(InputDevice.SOURCE_TOUCHSCREEN) }
                assertTrue(ui.injectInputEvent(event, true)); event.recycle()
            }
            touch(MotionEvent.ACTION_DOWN, from.exactCenterX(), from.exactCenterY()); Thread.sleep(650)
            for (step in 1..12) { touch(MotionEvent.ACTION_MOVE, from.exactCenterX(), from.exactCenterY() + (endY - from.exactCenterY()) * step / 12); Thread.sleep(40) }
            touch(MotionEvent.ACTION_UP, to.exactCenterX(), endY)
            waitPlayer("Drag should reorder manual requests") { player.getMediaItemAt(1).mediaId == "xyz123def45" && player.getMediaItemAt(2).mediaId == "uvw123def45" }
            val remove = waitNode("remove queued request") { it.contentDescription?.startsWith("Remove Second song") == true }
            assertTrue(remove.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            waitPlayer("Remove should update the queue") { player.mediaItemCount == 4 && player.getMediaItemAt(1).mediaId == "uvw123def45" }
            clickDescription("Collapse player")
            clickDescription("Settings")
            clickText("Keep YouTube search and results")
            clickDescription("YouTube")
            assertNull("Turning off persistence clears previous results", find { it.text?.startsWith("Results for") == true })
        } finally {
            instrumentation.runOnMainSync { player.stop(); player.clearMediaItems(); player.release(); MediaController.releaseFuture(future) }
        }
    }
}
