package dev.tuneflow

import android.content.ComponentName
import android.content.Intent
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

@UnstableApi
@RunWith(AndroidJUnit4::class)
class PlaybackIntegrationTest {
    @Test fun playsSeeksAdvancesAndContinuesInBackground() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val session = Session(context).apply { server = "http://127.0.0.1:18010"; household = "system" }
        val api = Api(session)
        val signed = api.obj("auth/login", "POST", JSONObject().put("household_slug", "system").put("username", "fixture").put("password", "fixture-password"), false)
        session.token = signed.getString("access_token"); session.userId = "1"
        val library = api.array("library/tracks")
        assertEquals(2, library.length())
        assertTrue(library.getJSONObject(0).getString("video_id").startsWith("jf_"))
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        lateinit var future: com.google.common.util.concurrent.ListenableFuture<MediaController>
        instrumentation.runOnMainSync { future = MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync() }
        val player = future.get(20, TimeUnit.SECONDS)
        val items = (0 until library.length()).map { index ->
            val track = library.getJSONObject(index)
            MediaItem.Builder().setMediaId(track.getString("video_id"))
                .setUri("${session.server}/api/music/audio/${track.getString("video_id")}")
                .setCustomCacheKey("${session.server}|${session.userId}|${track.getString("video_id")}")
                .setMediaMetadata(MediaMetadata.Builder().setTitle(track.getString("title")).setArtist("Tuneflow tests").build()).build()
        }
        instrumentation.runOnMainSync { player.setMediaItems(items); player.prepare(); player.play() }
        fun waitFor(message: String, predicate: () -> Boolean) {
            val end = System.currentTimeMillis() + 15000
            while (System.currentTimeMillis() < end) {
                var done = false; instrumentation.runOnMainSync { done = predicate() }
                if (done) return
                Thread.sleep(100)
            }
            var detail = ""; instrumentation.runOnMainSync { detail = "state=${player.playbackState}, error=${player.playerError}" }
            fail("$message: $detail")
        }
        waitFor("Audio should start") { player.isPlaying && player.currentPosition > 1000 }
        instrumentation.runOnMainSync { player.seekTo(20_000) }
        waitFor("Seeking should work") { player.currentPosition >= 20_000 && player.playbackState == Player.STATE_READY }
        instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_HOME").close()
        var before = 0L; instrumentation.runOnMainSync { before = player.currentPosition }
        Thread.sleep(1500)
        instrumentation.runOnMainSync { assertTrue("Playback continues with activity in background", player.isPlaying && player.currentPosition > before + 500) }
        instrumentation.runOnMainSync { player.seekToNextMediaItem() }
        waitFor("Queue should advance") { player.currentMediaItemIndex == 1 && player.isPlaying && player.currentPosition > 500 }
        instrumentation.runOnMainSync { player.stop(); player.clearMediaItems(); player.release(); MediaController.releaseFuture(future) }
    }
}
