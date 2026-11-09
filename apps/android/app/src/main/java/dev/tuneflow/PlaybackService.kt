package dev.tuneflow

import android.os.Bundle
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionError
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.SettableFuture
import com.google.common.util.concurrent.ListenableFuture
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
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import android.os.Handler
import android.os.Looper

@UnstableApi
class PlaybackService : MediaSessionService() {
    companion object {
        const val SELECT = "dev.tuneflow.SELECT"
        const val CANCEL_SELECTION = "dev.tuneflow.CANCEL_SELECTION"
    }
    private var stagingPlayer: ExoPlayer? = null
    private var pendingSelection: SettableFuture<SessionResult>? = null
    private var selectionTimeout: Runnable? = null
    private lateinit var sources: DefaultMediaSourceFactory
    private fun cancelSelection(code: @SessionError.Code Int = SessionError.INFO_CANCELLED) {
        selectionTimeout?.let(handler::removeCallbacks); selectionTimeout = null
        stagingPlayer?.release(); stagingPlayer = null
        pendingSelection?.set(SessionResult(code)); pendingSelection = null
    }
    private fun select(args: Bundle): ListenableFuture<SessionResult> {
        cancelSelection()
        val selected = args.getBundle("selected")?.let(MediaItem::fromBundle)
            ?: return Futures.immediateFuture(SessionResult(SessionError.ERROR_BAD_VALUE))
        val background = args.getBinder("background")?.let(BundleListRetriever::getList)?.map(MediaItem::fromBundle)
        if (selected.mediaId.startsWith("jf_")) {
            PlaybackQueue.start(player, selected, background)
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
        val result = SettableFuture.create<SessionResult>()
        pendingSelection = result
        // A silent player fills the shared disk cache before changing the audible timeline.
        val staging = ExoPlayer.Builder(this).setMediaSourceFactory(sources)
            .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(5000, 10000, 1000, 1000).build()).build()
        stagingPlayer = staging
        staging.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && stagingPlayer === staging) {
                    cancelSelection(SessionResult.RESULT_SUCCESS)
                    PlaybackQueue.start(player, selected, background)
                }
            }
            override fun onPlayerError(error: PlaybackException) {
                if (stagingPlayer === staging) cancelSelection(SessionError.ERROR_IO)
            }
        })
        selectionTimeout = Runnable { if (stagingPlayer === staging) cancelSelection(SessionError.ERROR_IO) }
            .also { handler.postDelayed(it, 35_000) }
        staging.setMediaItem(selected); staging.prepare()
        return result
    }
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
    private var preparedNext = emptyList<String>()
    private fun prepareUpcoming() {
        val next = ((player.currentMediaItemIndex + 1).coerceAtLeast(0) until minOf(player.mediaItemCount, player.currentMediaItemIndex + 3))
            .map { player.getMediaItemAt(it).mediaId }.filter { !it.startsWith("jf_") }
        if (next == preparedNext) return
        preparedNext = next
        if (next.isNotEmpty()) scope.launch {
            runCatching { api.call("music/prepare", "POST", JSONObject().put("video_ids", JSONArray(next))) }
        }
    }
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
        val http = DefaultHttpDataSource.Factory().setConnectTimeoutMs(8000).setReadTimeoutMs(30000)
            .setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${credentials.token}"))
        val source = CacheDataSource.Factory().setCache(cache)
            .setUpstreamDataSourceFactory(DefaultDataSource.Factory(this, http))
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        sources = DefaultMediaSourceFactory(source)
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(sources)
            .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(15000, 60000, 1000, 2000).build())
            .setWakeMode(C.WAKE_MODE_NETWORK).build()
        player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
        player.setHandleAudioBecomingNoisy(true)
        player.setPreloadConfiguration(ExoPlayer.PreloadConfiguration(5_000_000))
        val pending = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession.Builder(this, player).setSessionActivity(pending)
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                    if (controller.packageName != packageName && !controller.isTrusted) return MediaSession.ConnectionResult.reject()
                    val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                    if (controller.packageName == packageName) {
                        commands.add(SessionCommand(SELECT, Bundle.EMPTY))
                        commands.add(SessionCommand(CANCEL_SELECTION, Bundle.EMPTY))
                    }
                    return MediaSession.ConnectionResult.AcceptedResultBuilder(session, controller)
                        .setAvailableSessionCommands(commands.build()).build()
                }
                override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo,
                    command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> = when (command.customAction) {
                    SELECT -> select(args)
                    CANCEL_SELECTION -> { cancelSelection(); Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS)) }
                    else -> super.onCustomCommand(session, controller, command, args)
                }
                override fun onPlayerCommandRequest(session: MediaSession, controller: MediaSession.ControllerInfo, command: Int): Int {
                    if (command in listOf(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_STOP, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                        Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                        Player.COMMAND_CHANGE_MEDIA_ITEMS, Player.COMMAND_SET_MEDIA_ITEM)) cancelSelection()
                    return SessionResult.RESULT_SUCCESS
                }
            }).build()
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                recordProgress(activeItem)
                listenedMs = 0; recordedMs = 0; lastTick = 0; activeDuration = 0
                activeItem = item; playSession = java.util.UUID.randomUUID().toString()
                handler.post {
                    if (item != null && player.currentMediaItem?.let(PlaybackQueue::entry) != PlaybackQueue.entry(item)) return@post
                    // Consume in the service so background playback has the same queue semantics.
                    if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT && item != null &&
                        PlaybackQueue.lane(item) == PlaybackQueue.MANUAL && player.mediaItemCount == 1) {
                        if (player.repeatMode != Player.REPEAT_MODE_ONE) { player.stop(); player.clearMediaItems() }
                    } else PlaybackQueue.consumePlayed(player)
                    prepareUpcoming()
                }
            }
            override fun onTimelineChanged(timeline: Timeline, reason: Int) { handler.post { prepareUpcoming() } }
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) handler.post {
                    if (player.playbackState == Player.STATE_ENDED) { recordProgress(); player.clearMediaItems() }
                }
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
        cancelSelection()
        session?.release(); player.release(); cache.release()
        scope.cancel()
        super.onDestroy()
    }
}
