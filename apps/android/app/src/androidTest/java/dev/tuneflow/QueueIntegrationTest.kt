package dev.tuneflow

import android.content.ComponentName
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit

@UnstableApi
@RunWith(AndroidJUnit4::class)
class QueueIntegrationTest {
    @Test fun manualRequestsPlayBeforeContextAndPlayedTracksAreConsumedByService() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        // Local WAV keeps this sequencing regression independent of provider/network availability.
        val audio = File(context.cacheDir, "queue-test.wav")
        val samples = ByteArray(44 + 22050 * 2 * 60)
        ByteBuffer.wrap(samples).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(samples.size - 8); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(22050); putInt(44100); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(samples.size - 44)
        }
        audio.writeBytes(samples)
        lateinit var future: com.google.common.util.concurrent.ListenableFuture<MediaController>
        instrumentation.runOnMainSync {
            future = MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync()
        }
        val player = future.get(20, TimeUnit.SECONDS)
        fun item(id: String, lane: String = PlaybackQueue.CONTEXT) = PlaybackQueue.tagged(
            MediaItem.Builder().setMediaId("jf_$id").setUri(android.net.Uri.fromFile(audio))
                .setMediaMetadata(MediaMetadata.Builder().setTitle(id).build()).build(), lane, "Test playlist")
        fun waitFor(message: String, condition: () -> Boolean) {
            val deadline = System.currentTimeMillis() + 10000
            while (System.currentTimeMillis() < deadline) {
                var done = false; instrumentation.runOnMainSync { done = condition() }
                if (done) return
                Thread.sleep(50)
            }
            fail(message)
        }
        fun ids() = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId.removePrefix("jf_") }
        try {
            instrumentation.runOnMainSync {
                player.stop(); player.clearMediaItems(); player.repeatMode = Player.REPEAT_MODE_OFF
                player.setMediaItems(listOf(item("A"), item("B"), item("C")))
                player.prepare(); player.play()
            }
            waitFor("Local audio should play") { player.isPlaying }
            instrumentation.runOnMainSync {
                PlaybackQueue.add(player, item("X"))
                PlaybackQueue.add(player, item("Y"))
                assertEquals(listOf("A", "X", "Y", "B", "C"), ids())
                player.moveMediaItem(2, 1)
                assertEquals(listOf("A", "Y", "X", "B", "C"), ids())
                player.seekTo(59900)
            }
            waitFor("Consumed context track should disappear") { ids() == listOf("Y", "X", "B", "C") && player.currentMediaItemIndex == 0 }
            instrumentation.runOnMainSync { player.seekToNextMediaItem() }
            waitFor("First manual request should disappear") { ids() == listOf("X", "B", "C") }
            instrumentation.runOnMainSync { player.seekToNextMediaItem() }
            waitFor("Context should resume after manual queue") { ids() == listOf("B", "C") && player.currentMediaItem?.mediaId == "jf_B" }
            instrumentation.runOnMainSync {
                PlaybackQueue.add(player, item("Z"))
                assertEquals(listOf("B", "Z", "C"), ids())
                player.removeMediaItem(1)
                assertEquals(listOf("B", "C"), ids())
                player.repeatMode = Player.REPEAT_MODE_ALL
                PlaybackQueue.add(player, item("M"))
                player.seekToNextMediaItem()
            }
            waitFor("Repeat retains context without repeating manual requests") { ids() == listOf("M", "C", "B") }
            instrumentation.runOnMainSync { player.seekToNextMediaItem() }
            waitFor("Manual request should be consumed even with playlist repeat") { ids() == listOf("C", "B") }
            instrumentation.runOnMainSync {
                player.repeatMode = Player.REPEAT_MODE_OFF
                player.removeMediaItems(1, player.mediaItemCount)
                player.seekTo(59900)
            }
            waitFor("Last completed song should leave an empty queue") { player.mediaItemCount == 0 }
        } finally {
            instrumentation.runOnMainSync { player.stop(); player.clearMediaItems(); player.release(); MediaController.releaseFuture(future) }
            audio.delete()
        }
    }
}
