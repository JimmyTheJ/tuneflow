package dev.tuneflow

import android.content.Intent
import android.app.PendingIntent
import androidx.media3.common.*
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.cache.*
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import android.os.Handler
import android.os.Looper

@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private lateinit var cache: SimpleCache
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var credentials: Session
    private lateinit var api: Api
    private var listenedMs = 0L
    private var lastTick = 0L
    private var recordedMs = 0L
    private var activeItem: MediaItem? = null
    private var playSession = java.util.UUID.randomUUID().toString()
    private var activeDuration = 0L
    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            val now = android.os.SystemClock.elapsedRealtime()
            if (player.isPlaying && lastTick != 0L) listenedMs += (now - lastTick).coerceIn(0, 2000)
            lastTick = now
            if (player.duration > 0) activeDuration = player.duration / 1000
            if (listenedMs - recordedMs >= 30_000) recordProgress()
            handler.postDelayed(this, 1000)
        }
    }
    override fun onCreate() {
        super.onCreate()
        credentials = Session(this); api = Api(credentials, credentials.token, credentials.server)
        val identity = java.security.MessageDigest.getInstance("SHA-256").digest("${credentials.server}|${credentials.userId}".toByteArray()).joinToString("") { "%02x".format(it) }
        cache = SimpleCache(File(filesDir, "audio-cache/$identity"), LeastRecentlyUsedCacheEvictor(512L * 1024 * 1024), StandaloneDatabaseProvider(this))
        val http = DefaultHttpDataSource.Factory().setConnectTimeoutMs(8000).setReadTimeoutMs(15000)
            .setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${credentials.token}"))
        val source = CacheDataSource.Factory().setCache(cache)
            .setUpstreamDataSourceFactory(DefaultDataSource.Factory(this, http))
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(source))
            .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(15000, 60000, 1000, 2000).build())
            .setWakeMode(C.WAKE_MODE_NETWORK).build()
        player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
        player.setHandleAudioBecomingNoisy(true)
        player.setPreloadConfiguration(ExoPlayer.PreloadConfiguration(5_000_000))
        val pending = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession.Builder(this, player).setSessionActivity(pending)
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
                    if (controller.packageName == packageName || controller.isTrusted) super.onConnect(session, controller)
                    else MediaSession.ConnectionResult.reject()
            }).build()
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                recordProgress(activeItem)
                listenedMs = 0; recordedMs = 0; lastTick = 0; activeDuration = 0
                activeItem = item; playSession = java.util.UUID.randomUUID().toString()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (!isPlaying) recordProgress(activeItem) }
        })
        handler.post(ticker)
    }
    private fun recordProgress(item: MediaItem? = activeItem) {
        if (item == null) return
        val delta = (listenedMs - recordedMs) / 1000
        if (delta <= 0) return
        recordedMs = listenedMs
        val b = JSONObject().put("video_id", item.mediaId).put("title", item.mediaMetadata.title ?: "Unknown track")
            .put("artist", item.mediaMetadata.artist ?: "").put("listened_sec", listenedMs / 1000)
            .put("session_id", playSession).put("duration_sec", activeDuration.takeIf { it > 0 } ?: JSONObject.NULL)
        scope.launch { withContext(NonCancellable) { withTimeoutOrNull(5000) { runCatching { api.call("history", "POST", b) } } } }
    }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session
    override fun onTaskRemoved(rootIntent: Intent?) { if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf() }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        recordProgress()
        session?.release(); player.release(); cache.release()
        scope.cancel()
        super.onDestroy()
    }
}
