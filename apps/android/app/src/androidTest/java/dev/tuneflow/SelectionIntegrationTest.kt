package dev.tuneflow

import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionError
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.util.concurrent.ListenableFuture
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.ServerSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

@UnstableApi
@RunWith(AndroidJUnit4::class)
class SelectionIntegrationTest {
    @Test fun selectionDoesNotResumePausedAudioAndLibrarySupersedesBufferingWithoutDuplicates() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val audio = File(context.cacheDir, "selection-test.wav")
        val samples = ByteArray(44 + 8000 * 2 * 45)
        ByteBuffer.wrap(samples).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(samples.size - 8); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(8000); putInt(16000); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(samples.size - 44)
        }
        audio.writeBytes(samples)
        lateinit var connection: ListenableFuture<MediaController>
        instrumentation.runOnMainSync {
            connection = MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync()
        }
        val player = connection.get(20, TimeUnit.SECONDS)
        fun local(id: String, lane: String = PlaybackQueue.CONTEXT) = PlaybackQueue.tagged(
            MediaItem.Builder().setMediaId("jf_$id").setUri(Uri.fromFile(audio)).build(), lane)
        fun waitFor(message: String, predicate: () -> Boolean) {
            val deadline = System.currentTimeMillis() + 15000
            while (System.currentTimeMillis() < deadline) {
                var done = false
                instrumentation.runOnMainSync { done = predicate() }
                if (done) return
                Thread.sleep(50)
            }
            fail(message)
        }
        fun select(item: MediaItem): ListenableFuture<SessionResult> {
            lateinit var result: ListenableFuture<SessionResult>
            instrumentation.runOnMainSync {
                result = player.sendCustomCommand(SessionCommand(PlaybackService.SELECT, Bundle.EMPTY), Bundle().apply {
                    putBundle("selected", item.toBundleIncludeLocalConfiguration())
                })
            }
            return result
        }
        val server = ServerSocket(0)
        val requested = CountDownLatch(1)
        val release = CountDownLatch(1)
        val responder = thread(isDaemon = true) {
            runCatching { server.accept().use { socket ->
                socket.soTimeout = 15000
                val reader = socket.getInputStream().bufferedReader()
                while (!reader.readLine().isNullOrEmpty()) { /* consume request headers */ }
                requested.countDown(); release.await(15, TimeUnit.SECONDS)
                socket.getOutputStream().apply {
                    write("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: ${samples.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    write(samples); flush()
                }
            } }
        }
        try {
            instrumentation.runOnMainSync {
                player.stop(); player.clearMediaItems(); player.repeatMode = Player.REPEAT_MODE_OFF
                player.setMediaItems(listOf(local("A", PlaybackQueue.MANUAL), local("B"), local("C")))
                player.prepare(); player.pause()
            }
            waitFor("Original paused audio should be prepared") { player.playbackState == Player.STATE_READY }
            val pending = select(MediaItem.Builder().setMediaId("youtube_waiting").setUri("http://127.0.0.1:${server.localPort}/slow.wav")
                .setCustomCacheKey(java.util.UUID.randomUUID().toString()).build())
            assertTrue("Silent staging should request the new audio", requested.await(10, TimeUnit.SECONDS))
            instrumentation.runOnMainSync {
                assertEquals("jf_A", player.currentMediaItem?.mediaId)
                assertFalse("Selecting YouTube must not resume paused audio", player.playWhenReady)
            }
            // A library tap cancels slow YouTube staging and starts the selected queued track.
            assertEquals(SessionResult.RESULT_SUCCESS, select(local("B", PlaybackQueue.MANUAL)).get(10, TimeUnit.SECONDS).resultCode)
            assertEquals(SessionError.INFO_CANCELLED, pending.get(10, TimeUnit.SECONDS).resultCode)
            release.countDown()
            waitFor("Library selection should play immediately") { player.currentMediaItem?.mediaId == "jf_B" && player.isPlaying }
            instrumentation.runOnMainSync {
                assertEquals(listOf("jf_B", "jf_C"), (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId })
            }
            // Exercise a successful silent preparation and ensure it replaces the current item.
            val ready = select(MediaItem.Builder().setMediaId("youtube_ready").setUri(Uri.fromFile(audio)).build())
            assertEquals(SessionResult.RESULT_SUCCESS, ready.get(15, TimeUnit.SECONDS).resultCode)
            waitFor("Buffered selection should replace current audio") { player.currentMediaItem?.mediaId == "youtube_ready" && player.isPlaying }
            instrumentation.runOnMainSync {
                assertEquals(listOf("youtube_ready", "jf_C"), (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId })
            }
        } finally {
            release.countDown(); server.close(); responder.join(1000)
            instrumentation.runOnMainSync { player.stop(); player.clearMediaItems(); player.release(); MediaController.releaseFuture(connection) }
            audio.delete()
        }
    }
}
